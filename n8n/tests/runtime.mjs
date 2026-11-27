/* Isolated test profile. The real n8n binary is explicitly supplied; no production URLs are read. */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { startHttpsProxy, verifyProxy } from './proxy.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(readFileSync(join(root,'MANIFEST.json'),'utf8'));
const id=key=>manifest.workflows.find(w=>w.key===key).id;
const bin=process.env.TRC_N8N_BIN;
if(!bin) throw Error('TRC_N8N_BIN muss auf die Testversion 2.49.7 zeigen');
async function unusedPort(){
  const listener=createServer();
  await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  const port=listener.address().port;
  await new Promise(resolve=>listener.close(resolve));
  return port;
}
const temp=mkdtempSync(join(tmpdir(),'trc-n8n-'));
const defs=join(temp,'definitions');
mkdirSync(defs);
const token=randomBytes(30).toString('hex');
const env={PATH:process.env.PATH,LANG:'C.UTF-8',DB_TYPE:'sqlite',N8N_USER_FOLDER:temp,N8N_ENCRYPTION_KEY:randomBytes(30).toString('hex'),
  N8N_DIAGNOSTICS_ENABLED:'false',N8N_VERSION_NOTIFICATIONS_ENABLED:'false',
  N8N_PERSONALIZATION_ENABLED:'false',N8N_LOG_LEVEL:'info',
  N8N_RUNNERS_MODE:'internal',NODE_FUNCTION_ALLOW_BUILTIN:'crypto,url',
  N8N_CONCURRENCY_PRODUCTION_LIMIT:'1',N8N_BLOCK_ENV_ACCESS_IN_NODE:'true',EXECUTIONS_MODE:'regular'};
const port=await unusedPort();
Object.assign(env,{N8N_PORT:String(port),N8N_LISTEN_ADDRESS:'127.0.0.1',N8N_SECURE_COOKIE:'false',
  N8N_PUBLIC_API_DISABLED:'true',N8N_RUNNERS_BROKER_PORT:String(await unusedPort()),NODE_ENV:'production'});
const captures=[];
let expectedStatus=503;
let authenticated=true;
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://test.invalid').pathname;
  if(path==='/remote.php/dav/files/Marcel/Docs'&&req.method==='PROPFIND'){
    if(req.headers.authorization!==basic||req.headers.depth!=='1'){res.writeHead(401);res.end();return;}
    res.writeHead(207,{'Content-Type':'application/xml'});
    res.end('<d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/files/Marcel/Docs/test.md</d:href>'+
      '<d:propstat><d:prop><d:getcontentlength>15</d:getcontentlength><d:getetag>"fixture"</d:getetag>'+
      '<d:getlastmodified>Thu, 26 Nov 2026 12:00:00 GMT</d:getlastmodified></d:prop>'+
      '<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>');
    return;
  }
  if(path==='/ocs/v2.php/apps/spreed/api/v1/chat/testroom'&&req.method==='GET'){
    if(req.headers.authorization!==basic||req.headers['ocs-apirequest']!=='true'){res.writeHead(401);res.end();return;}
    res.writeHead(200,{'Content-Type':'application/json','x-chat-last-given':'14'});
    res.end(JSON.stringify({ocs:{meta:{statuscode:200},data:[{id:14,message:'Synthetische Talk-Nachricht',
      timestamp:Math.floor(Date.now()/1000),actorId:'test-actor',messageParameters:{}}]}}));
    return;
  }
  if(!['/api/v1/workflow/records/tasks','/changed/api/v1/workflow/records/tasks'].includes(path)||req.method!=='POST'){
    res.writeHead(404);res.end();return;
  }
  authenticated&&=req.headers.authorization==='Bearer '+token;
  const data=[];
  req.on('data',chunk=>data.push(chunk));
  req.on('end',()=>{
    captures.push({path,key:req.headers['idempotency-key'],raw:Buffer.concat(data).toString()});
    res.writeHead(expectedStatus,{'Content-Type':'application/json',...(expectedStatus===503?{'Retry-After':'1'}:{})});
    res.end(JSON.stringify(expectedStatus===503?{code:'database_unavailable'}:{inserted:1}));
  });
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const credentialId='TrcTestCredOnly1';
const basicCredentialId='TrcTestBasicOnly';
const basic='Basic '+Buffer.from('Marcel:'+token).toString('base64');
function write(file,data){writeFileSync(file,JSON.stringify(data),{mode:0o600});}
function run(...args){
  return new Promise((resolve,reject)=>{
    const child=spawn(bin,args,{env,stdio:['ignore','pipe','pipe']});
    let out='',err='';
    child.stdout.on('data',x=>out+=x);
    child.stderr.on('data',x=>err+=x);
    child.on('error',reject);
    child.on('exit',code=>{
      if(code===0&&!/Execution failed|There was an error running/i.test(out)) resolve(out);
      else reject(Error(args[0]+' fehlgeschlagen: '+(out+'\n'+err).slice(-4500).replaceAll(token,'[redacted]')));
    });
  });
}
function node(name,type,typeVersion,parameters){
  return {id:name,name,type:'n8n-nodes-base.'+type,typeVersion,parameters,position:[0,0]};
}
function chain(key,title,nodes){
  return {id:key,name:title,active:false,settings:{timezone:'Europe/Vienna',executionOrder:'v1'},nodes,
    connections:Object.fromEntries(nodes.slice(0,-1).map((n,i)=>[n.name,{main:[[{node:nodes[i+1].name,type:'main',index:0}]]}]))};
}
const trigger=()=>node('Manuell','manualTrigger',1,{});
const code=(name,jsCode)=>node(name,'code',2,{jsCode});
const locator=table=>({__rl:true,mode:'name',value:table});
const get=table=>node('Lesen','dataTable',1.1,{resource:'row',operation:'get',dataTableId:locator(table),returnAll:true});
const update=(table,key,value)=>{
  const fields=Object.entries(value);
  return node('Schreiben','dataTable',1.1,{resource:'row',operation:'update',dataTableId:locator(table),matchType:'allConditions',
    filters:{conditions:[{keyName:'key',keyValue:key,condition:'eq'}]},columns:{mappingMode:'defineBelow',value,
      schema:fields.map(([id,v])=>({id,type:typeof v,displayName:id,display:true,canBeUsedToMatch:true}))}});
};
let runtime;
let proxy;
let runtimeLog='';
const hooks=new Map();
function fixture(flow){
  const manual=flow.nodes.find(n=>n.type==='n8n-nodes-base.manualTrigger');
  assert.ok(manual,flow.name);
  const path='fixture-'+flow.id;
  manual.type='n8n-nodes-base.webhook';
  manual.typeVersion=2;
  manual.webhookId=path;
  manual.parameters={httpMethod:'GET',path,responseMode:'lastNode',responseData:'allEntries',options:{}};
  hooks.set(flow.id,path);
}
try {
  assert.match(await run('--version'),/2\.49\.7/);
  const require=createRequire(realpathSync(bin));
  require('reflect-metadata');
  const moduleRoot=join(dirname(dirname(realpathSync(bin))),'..','n8n-nodes-base');
  const known=JSON.parse(readFileSync(join(moduleRoot,'dist/known/nodes.json'),'utf8'));
  const types=new Map();
  for(const f of manifest.workflows){
    const wf=JSON.parse(readFileSync(join(root,f.path),'utf8'));
    for(const n of wf.nodes){
      const key=n.type.slice('n8n-nodes-base.'.length);
      if(!types.has(key)){
        const {sourcePath,className}=known[key];
        const Type=require(join(moduleRoot,sourcePath))[className];
        const instance=new Type();
        types.set(key,version=>instance.nodeVersions?.[version] ||
          (Array.isArray(instance.description.version)?instance.description.version.includes(version):instance.description.version===version));
      }
      assert.ok(types.get(key)(n.typeVersion),n.type+'@'+n.typeVersion);
      if(n.credentials?.httpBearerAuth?.name==='TRC Workflow-API') n.credentials.httpBearerAuth.id=credentialId;
      if(['TRC Nextcloud Talk lesen','TRC Nextcloud WebDAV lesen'].includes(n.credentials?.httpBasicAuth?.name))
        n.credentials.httpBasicAuth.id=basicCredentialId;
    }
      if(['bootstrap','queue','queue-status','dav','talk','daily'].includes(f.key)) {
      for(const n of wf.nodes) if(n.type==='n8n-nodes-base.scheduleTrigger') n.disabled=true;
      fixture(wf);
    }
    write(join(defs,f.key+'.json'),wf);
  }
  const settings={enabled:true,baseUrl:base,maxAttempts:4,batchLimit:3};
  const configureRow=(key,value)=>{
    const entry=update('trc_config',key,{value_json:JSON.stringify(value)});
    return {...entry,id:key,name:'Konfigurieren '+key};
  };
  const configure=chain('TrcTestSetupOnly','Testkonfiguration',[trigger(),configureRow('trc',settings),
    configureRow('addresses',{nextcloud:base}),configureRow('dav',{enabled:true,user:'Marcel',directories:['Docs'],extensions:['.md']}),
    configureRow('talk',{enabled:true,rooms:['testroom'],source:'fixture-talk'}),
    configureRow('reports',{enabled:true})]);
  const change=chain('TrcTestChangeURL','Neue TRC-Adresse',[trigger(),configureRow('trc',{...settings,baseUrl:base+'/changed'})]);
  const sample={key:'test-cache',area:'tasks',source:'test-source',external_id:'synthetic-one',
    observed_at:'2026-11-26T12:00:00.000Z',payload:{title:'Synthetisch',state:'needsAction'}};
  function ingestFixture(needsRetry=false){
    const fixtureId=needsRetry?'TrcTestIngestTwo':'TrcTestIngestOne';
    const row=needsRetry?{...sample,key:'test-cache-2',external_id:'synthetic-two'}:sample;
    return chain(fixtureId,'Testimport',[trigger(),code('Testdatensatz','return [{json:'+JSON.stringify({
      rows:[row],cursors:[{key:'test-cursor',value_json:'{"position":1}',updated_at:'2026-11-26T12:00:00Z'}],import_trc:true
    })+'}];'),node('Persistieren','executeWorkflow',1.3,{source:'database',workflowId:{__rl:true,mode:'id',value:id('persist')},mode:'once',options:{waitForSubWorkflow:true}})]);
  }
  const ingest=ingestFixture();
  const badIngest=ingestFixture(true);
  const states=chain('TrcTestCheckQueue','Warteschlange prüfen',[trigger(),get('trc_queue'),code('Ausgabe',
    'return $input.all().map(i=>({json:{marker:"TRC_RUNTIME_QUEUE",status:i.json.status,key:i.json.key,attempts:i.json.attempts}}));')]);
  const checkCursor=chain('TrcTestCheckState','Cursor prüfen',[trigger(),get('trc_state'),code('Ausgabe',
    'return $input.all().map(i=>({json:{marker:"TRC_RUNTIME_CURSOR",key:i.json.key}}));')]);
  for(const f of [configure,change,ingest,badIngest,states,checkCursor]) {fixture(f);write(join(defs,f.id+'.json'),f);}
  const creds=join(temp,'credential.json');
  write(creds,[{id:credentialId,name:'TRC Workflow-API',type:'httpBearerAuth',data:{token}},
    {id:basicCredentialId,name:'Nextcloud isoliert',type:'httpBasicAuth',data:{user:'Marcel',password:token}}]);
  await run('import:credentials','--input='+creds);
  const imported=await run('import:workflow','--separate','--input='+defs);
  assert.match(imported,/success|import/i);
  await run('publish:workflow','--id='+id('persist'));
  for(const workflowId of hooks.keys()) await run('publish:workflow','--id='+workflowId);
  async function start(host, pushBackend='websocket'){
    runtimeLog='';
    const runtimeEnv=host?{...env,N8N_HOST:host,N8N_PROTOCOL:'https',N8N_EDITOR_BASE_URL:'https://'+host,
      WEBHOOK_URL:'https://'+host+'/',N8N_PROXY_HOPS:'1',N8N_PUSH_BACKEND:pushBackend}:env;
    runtime=spawn(bin,['start'],{env:runtimeEnv,stdio:['ignore','pipe','pipe']});
    for (const stream of [runtime.stdout,runtime.stderr]) stream.on('data',value=>runtimeLog+=value);
    for(let i=0;i<150;i++){
      if(runtime.exitCode!==null) break;
      try {
        const ready=await fetch('http://127.0.0.1:'+port+'/healthz/readiness',{signal:AbortSignal.timeout(800)});
        if(ready.ok) return;
      } catch {}
      await delay(250);
    }
    throw Error('n8n nicht bereit: '+runtimeLog.slice(-5000).replaceAll(token,'[redacted]'));
  }
  async function stop(){
    if(runtime?.exitCode===null){
      const exited=new Promise(resolve=>runtime.once('exit',resolve));
      runtime.kill('SIGTERM');
      const result=await Promise.race([exited,delay(10000,'timeout',{ref:false})]);
      if(result==='timeout'){runtime.kill('SIGKILL');await exited;}
    }
  }
  async function exec(key){
    const url='http://127.0.0.1:'+port+'/webhook/'+hooks.get(key);
    let request,body;
    for(let attempt=0;attempt<40;attempt++){
      request=await fetch(url,{signal:AbortSignal.timeout(65000)});
      body=await request.text();
      if(request.status!==404 || !body.includes('not registered')) break;
      await delay(250);
    }
    assert.ok(request.ok,key+': '+body.slice(0,300)+' '+runtimeLog.slice(-5000).replaceAll(token,'[redacted]'));
    return body;
  }
  await start();
  await exec(id('bootstrap'));
  await exec(id('bootstrap'));
  await exec(configure.id);
  assert.match(await exec(id('dav')),/test\.md/);
  assert.match(await exec(id('talk')),/Synthetische Talk-Nachricht/);
  assert.match(await exec(id('daily')),/"markdown"/);
  await exec(ingest.id);
  await exec(ingest.id);
  assert.match(await exec(checkCursor.id),/"key"\s*:\s*"test-cursor"/);
  await exec(id('queue'));
  assert.equal(captures.length,1);
  assert.ok(authenticated);
  assert.match(await exec(states.id),/"status"\s*:\s*"pending"/);
  const owner=await fetch('http://127.0.0.1:'+port+'/rest/owner/setup',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'fixture@example.invalid',
      firstName:'Automation',lastName:'Fixture',password:'Test1!'+randomBytes(18).toString('hex')})});
  assert.ok(owner.ok,'Das isolierte n8n-Eigentümerkonto konnte nicht eingerichtet werden');
  const cookie=owner.headers.getSetCookie().find(value=>value.startsWith('n8n-auth='))?.split(';')[0];
  assert.ok(cookie);
  await owner.arrayBuffer();
  await stop();
  expectedStatus=200;
  const initialHost='before.example.invalid';
  const shiftedHost='after.example.invalid';
  proxy=await startHttpsProxy(temp,port);
  await start(initialHost);
  await verifyProxy(proxy,initialHost,cookie,'websocket');
  await delay(5200);
  await exec(id('queue'));
  assert.equal(captures.length,2);
  assert.deepEqual(captures[0],captures[1]);
  assert.match(await exec(states.id),/"status"\s*:\s*"sent"/);
  await exec(id('queue'));
  assert.equal(captures.length,2);
  await stop();
  await start(shiftedHost,'sse');
  await verifyProxy(proxy,shiftedHost,cookie,'sse');
  const throughProxy=await proxy.fetch(shiftedHost,'/webhook/'+hooks.get(states.id));
  assert.equal(throughProxy.status,200);
  assert.match(throughProxy.body,/"status"\s*:\s*"sent"/);
  await exec(change.id);
  await exec(badIngest.id);
  expectedStatus=422;
  await exec(id('queue'));
  assert.equal(captures.length,3);
  assert.match(captures[2].path,/^\/changed\//);
  const overview=await exec(id('queue-status'));
  assert.match(overview,/"dead"\s*:\s*1/);
  assert.doesNotMatch(overview,/synthetic-two/);
  console.log(manifest.workflows.length+' Exporte und Node-Versionen geprüft. Bootstrap, lokale Berichte, WebDAV, Talk, persistente Queue, Retry, Adresswechsel, HTTPS-Webhook, OAuth-Callback-URLs, WebSocket und SSE erfolgreich.');
} finally {
  if(proxy) await proxy.close();
  if(runtime?.exitCode===null){
    const exited=new Promise(resolve=>runtime.once('exit',resolve));
    runtime.kill('SIGTERM');
    const result=await Promise.race([exited,delay(10000,'timeout',{ref:false})]);
    if(result==='timeout'){runtime.kill('SIGKILL');await exited;}
  }
  await new Promise(resolve=>server.close(resolve));
  if(!process.env.TRC_KEEP_TEST_PROFILE) rmSync(temp,{recursive:true,force:true});
}
