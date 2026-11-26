"""Loopback HTTPS proxy fixture run inside the isolated app test container."""

import json
import ssl
import sys
from http.client import HTTPConnection, HTTPSConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

TOKEN = sys.argv[1]
CERT, KEY = sys.argv[2:4]
PREFIX = "/api/hassio_ingress/test-token/"
NETWORK = "/api/v1/admin/network"
OLD_HOST = "before.example.invalid"
NEW_HOST = "after.example.invalid"


class Proxy(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        path = (
            "/" + self.path.removeprefix(PREFIX)
            if self.path.startswith(PREFIX)
            else self.path
        )
        backend = HTTPConnection("127.0.0.1", 8099, timeout=6)
        try:
            forwarded = {
                "Host": self.headers["Host"],
                "X-Forwarded-Host": self.headers["Host"],
                "X-Forwarded-Proto": "https",
                "X-Forwarded-For": "198.51.100.8",
            }
            if self.headers.get("Authorization"):
                forwarded["Authorization"] = self.headers["Authorization"]
            backend.request("GET", path, headers=forwarded)
            response = backend.getresponse()
            body = response.read()
            self.send_response(response.status)
            self.send_header("Content-Type", response.getheader("Content-Type"))
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        finally:
            backend.close()


with ThreadingHTTPServer(("127.0.0.1", 0), Proxy) as proxy:
    server_tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_tls.load_cert_chain(CERT, KEY)
    proxy.socket = server_tls.wrap_socket(proxy.socket, server_side=True)
    worker = Thread(target=proxy.serve_forever, daemon=True)
    worker.start()
    client_tls = ssl.create_default_context(cafile=CERT)

    def get(path, host):
        client = HTTPSConnection(
            "127.0.0.1", proxy.server_port, timeout=6, context=client_tls
        )
        try:
            client.request(
                "GET",
                path,
                headers={
                    "Host": host,
                    "Authorization": "Bearer " + TOKEN,
                    "X-Forwarded-Host": "spoof.example.invalid",
                },
            )
            response = client.getresponse()
            return response.status, response.read()
        finally:
            client.close()

    for host in (OLD_HOST, NEW_HOST):
        status, data = get(NETWORK, host)
        assert status == 200
        config = json.loads(data)
        assert config["connection"] == {
            "scheme": "https",
            "trusted_proxy": True,
            "forwarded_host": host,
        }
        assert config["startup"]["network_public_url"] == f"https://{NEW_HOST}"
    response, body = get(PREFIX, NEW_HOST)
    assert response == 200 and b"./ui/app.js" in body
    response, body = get(PREFIX + "ui/app.js", NEW_HOST)
    assert response == 200 and b"document.baseURI" in body
    status, data = get(PREFIX + NETWORK.removeprefix("/"), NEW_HOST)
    assert status == 200 and json.loads(data)["connection"]["scheme"] == "https"
    proxy.shutdown()
    worker.join()
print(
    "HTTPS-Reverse-Proxy, Hostwechsel, Header-Überschreibung und simulierter Ingress-Präfix geprüft."
)
