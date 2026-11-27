import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { request as toBackend } from 'node:http';
import { createServer, request } from 'node:https';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

export async function startHttpsProxy(temp, backendPort) {
  const certPath = join(temp, 'test-ca.pem');
  const keyPath = join(temp, 'test-key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=n8n-https-fixture', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:before.example.invalid,DNS:after.example.invalid',
    '-out', certPath, '-keyout', keyPath], { stdio: 'ignore' });
  const cert = readFileSync(certPath);
  const sockets = new Set();
  function transport(incoming) {
    return toBackend({
      hostname: '127.0.0.1', port: backendPort, path: incoming.url, method: incoming.method,
      headers: { ...incoming.headers, 'x-forwarded-for': '198.51.100.8',
        'x-forwarded-host': incoming.headers.host, 'x-forwarded-proto': 'https' },
      signal: AbortSignal.timeout(75000),
    });
  }
  const proxy = createServer({ key: readFileSync(keyPath), cert }, (incoming, response) => {
    const upstream = transport(incoming);
    upstream.on('response', reply => {
      response.writeHead(reply.statusCode, reply.headers);
      reply.pipe(response);
    });
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    response.on('close', () => upstream.destroy());
    incoming.pipe(upstream);
  });
  proxy.on('upgrade', (incoming, socket, head) => {
    sockets.add(socket);
    const upstream = transport(incoming);
    upstream.on('upgrade', (reply, connection, upstreamHead) => {
      sockets.add(connection);
      socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
        reply.rawHeaders.reduce((all, name, index) => index % 2 ? all + name + '\r\n' : all + name + ': ', '') + '\r\n');
      if (head.length) connection.write(head);
      if (upstreamHead.length) socket.write(upstreamHead);
      socket.pipe(connection).pipe(socket);
      socket.on('close', () => connection.destroy());
      connection.on('close', () => { sockets.delete(connection); socket.destroy(); });
    });
    upstream.on('response', reply => { reply.resume(); socket.destroy(); });
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    upstream.end();
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));

  function fetch(host, path, { headers = {}, mode = 'response' } = {}) {
    return new Promise((resolve, reject) => {
      const client = request({ hostname: '127.0.0.1', port: proxy.address().port, path, ca: cert,
        headers: { Host: host, Origin: 'https://' + host, ...headers }, signal: AbortSignal.timeout(15000) });
      client.on('error', reject);
      client.on('upgrade', (reply, socket) => {
        socket.on('error', reject);
        socket.once('data', () => {
          socket.destroy();
          reject(Error('n8n hat die WebSocket-Verbindung nach dem Upgrade abgelehnt'));
        });
        setTimeout(() => { socket.destroy(); resolve({ status: reply.statusCode }); }, 300);
      });
      client.on('response', reply => {
        if (mode === 'sse') {
          reply.once('data', chunk => {
            resolve({ status: reply.statusCode, headers: reply.headers, body: chunk.toString() });
            reply.destroy();
          });
          return;
        }
        const body = [];
        reply.on('data', chunk => body.push(chunk));
        reply.on('end', () => resolve({ status: reply.statusCode, headers: reply.headers, body: Buffer.concat(body).toString() }));
      });
      client.end();
    });
  }
  return {
    fetch,
    async close() {
      for (const socket of sockets) socket.destroy();
      proxy.closeAllConnections();
      await new Promise(resolve => proxy.close(resolve));
    },
  };
}

export async function verifyProxy(proxy, host, cookie, pushBackend) {
  const headers = { Cookie: cookie };
  const settingsReply = await proxy.fetch(host, '/rest/settings', { headers });
  assert.equal(settingsReply.status, 200);
  const settings = JSON.parse(settingsReply.body).data;
  assert.equal(settings.urlBaseEditor, 'https://' + host);
  assert.equal(settings.urlBaseWebhook, 'https://' + host + '/');
  assert.equal(settings.oauthCallbackUrls.oauth2, 'https://' + host + '/rest/oauth2-credential/callback');

  const path = '/rest/push?pushRef=' + randomBytes(10).toString('hex');
  if (pushBackend === 'websocket') {
    const socket = await proxy.fetch(host, path, { headers: { ...headers, Connection: 'Upgrade', Upgrade: 'websocket',
      'Sec-WebSocket-Key': randomBytes(16).toString('base64'), 'Sec-WebSocket-Version': '13' } });
    assert.equal(socket.status, 101);
  } else {
    const stream = await proxy.fetch(host, path, { mode: 'sse', headers: { ...headers, Accept: 'text/event-stream' } });
    assert.equal(stream.status, 200);
    assert.match(stream.headers['content-type'], /text\/event-stream/);
    assert.match(stream.body, /^:ok/);
  }
}
