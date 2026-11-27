#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>readFileSync(join(root,f),'utf8');
const json=f=>JSON.parse(read(f));
const check=process.argv.includes('--check');
const schema=json('data-tables/schema.json');
const config=json('config/integrations.example.json');
const schedules=json('config/schedules.example.json');
const {feeds,topics}=json('config/providers.example.json');
const watch=json('config/watchlist.example.json');
config.news.feeds=feeds.filter(x=>x.category!=='quantum');
config['quantum-news'].feeds=feeds.filter(x=>x.category==='quantum');
config.research.topics=topics;
config.stocks.symbols=watch.stocks;
config.kraken.symbols=watch.kraken;
config.metals.symbols=watch.metals;
config['metal-history'].symbols=watch.metals;
Object.assign(config.reports,json('config/report-settings.example.json'));
Object.assign(config.maintenance,json('config/retention.example.json'));
const CORE=read('src/core.js');
const PROVIDERS=read('src/providers.js');
const ACTIONS=read('src/actions.js');
const REPORTS=read('src/reports.js');
const id=(key)=>createHash('sha256').update('TRC-AI/n8n/'+key).digest('hex').slice(0,16);
const defaultSettings={executionOrder:'v1',timezone:'Europe/Vienna',saveDataErrorExecution:'none',
  saveDataSuccessExecution:'none',saveExecutionProgress:false,saveManualExecutions:false,executionTimeout:420,
  callerPolicy:'workflowsFromSameOwner'};
const manifest=[];
const expected=new Set();
function put(file,data){
  expected.add(file);
  const full=join(root,file);
  if(check){if(readFileSync(full,'utf8')!==data) throw Error('Export veraltet: '+file);}
  else {mkdirSync(dirname(full),{recursive:true});writeFileSync(full,data);}
}
function builder(key,dir,title,description) {
  const flow={id:id(key),name:'TRC · '+title,active:false,settings:{...defaultSettings},nodes:[],connections:{},
    tags:[],meta:{templateCredsSetupCompleted:false}};
  function add(name,node,typeVersion,parameters={},other={}) {
    const n={parameters,id:id(key+'/'+name),name,type:'n8n-nodes-base.'+node,typeVersion,
      position:[flow.nodes.length*220,0], ...other};
    flow.nodes.push(n);return name;
  }
  function link(a,b,lane=0) {
    const outputs=(flow.connections[a]??={main:[]}).main;
    while(outputs.length<=lane) outputs.push([]);
    outputs[lane].push({node:b,type:'main',index:0});
  }
  function chain(...nodes) { for(let i=1;i<nodes.length;i++)link(nodes[i-1],nodes[i]); }
  function code(name,source,extra='',other={}) {
    return add(name,'code',2,{jsCode:CORE+'\n'+extra+'\n'+source},other);
  }
  function manual() {return add('Manuell','manualTrigger',1);}
  function sub() {return add('Aufruf','executeWorkflowTrigger',1.1,{inputSource:'passthrough'});}
  function scheduled(name=key) {
    if (!(name in schedules)) throw Error('Zeitplan fehlt: '+name);
    return add('Zeitplan','scheduleTrigger',1.3,{rule:{interval:[{field:'cronExpression',expression:schedules[name]}]}});
  }
  function call(name,target,{optional=false}={}) {
    return add(name,'executeWorkflow',1.3,{source:'database',workflowId:{__rl:true,value:optional?E(JSON.stringify(id(target))):id(target),mode:'id'},
      workflowInputs:{mappingMode:'defineBelow',value:{},matchingColumns:[],schema:[],attemptToConvertTypes:false,convertFieldsToString:false},
      mode:'once',options:{waitForSubWorkflow:true}});
  }
  function at(name,x,y) {flow.nodes.find(n=>n.name===name).position=[x,y];}
  function done({errors=true}={}){
    const path='workflows/'+dir+'/'+key+'.json';
    if(errors) flow.settings.errorWorkflow=id('errors');
    if(flow.nodes.length===0) throw Error('Kein Workflow');
    const credentials=flow.nodes.flatMap(node=>Object.values(node.credentials||{}).map(c=>c.name));
    const calls=flow.nodes.filter(node=>node.type==='n8n-nodes-base.executeWorkflow').map(node=>{
      const value=node.parameters.workflowId.value;
      const optional=value.startsWith('=');
      return {node:node.name,targetId:optional?JSON.parse(value.slice(4,-3)):value,optional};
    });
    manifest.push({key,id:flow.id,name:flow.name,path,description,credentials:[...new Set(credentials)],calls,active:false,
      schedule:flow.nodes.some(n=>n.type.endsWith('.scheduleTrigger'))});
    put(path,JSON.stringify(flow,null,2)+'\n');
  }
  return {add,link,chain,code,manual,sub,scheduled,call,at,done,flow};
}
const E=body=>'={{ '+body+' }}';
const field=key=>E('$json.'+key);
const cond=(keyName,keyValue,condition='eq')=>({keyName,condition,keyValue});
const byKey=cond('key',field('key'));
const byID=cond('id',field('id'));
const colEntry=([id,type])=>({id,displayName:id,required:false,defaultMatch:false,display:true,type,canBeUsedToMatch:true});
function dt(w,name,table,operation,{filters=[],take=100,sort,keys,always=false}={}) {
  const params={resource:'row',operation,dataTableId:{__rl:true,mode:'name',value:table}};
  if (filters.length) Object.assign(params,{filters:{conditions:filters},matchType:'allConditions'});
  if(operation==='get') Object.assign(params,{returnAll:false,limit:take,
     ...(sort?{orderBy:true,orderByColumn:sort[0],orderByDirection:sort[1]}:{})});
  if(['upsert','insert','update'].includes(operation)) {
    const entries=Object.entries(schema[table]).filter(([key])=>!keys||keys.includes(key));
    params.columns={mappingMode:'defineBelow',value:Object.fromEntries(entries.map(([key])=>[key,field(key)])),
      schema:entries.map(colEntry),matchingColumns:[],attemptToConvertTypes:false,convertFieldsToString:false};
  }
  return w.add(name,'dataTable',1.1,params,always?{alwaysOutputData:true}:{});
}
const addresses={dav:'nextcloud','dav-download':'nextcloud','dav-export':'nextcloud',talk:'nextcloud',
  'talk-write':'nextcloud',couch:'couchDb',home:'homeAssistant','ha-write':'homeAssistant',
  'ha-health':'homeAssistant','nextcloud-health':'nextcloud','talk-health':'nextcloud','couch-health':'couchDb',
  'hermes-health':'hermes','ollama-health':'ollama'};
function loadConfig(w,key){
  if(!addresses[key]) return dt(w,'Konfiguration','trc_config','get',{filters:[cond('key',key)],take:1});
  const cfg=dt(w,'Diensteinstellungen','trc_config','get',{filters:[cond('key',key)],take:1});
  const central=dt(w,'Interne Dienstadressen','trc_config','get',{filters:[cond('key','addresses')],take:1});
  const joined=w.code('Konfiguration',
    'const entry=$("Diensteinstellungen").first().json,c=parse(entry.value_json);const addr=parse($input.first().json.value_json);'+
    'return OUT([{...entry,value_json:JSON.stringify({...c,baseUrl:addr['+JSON.stringify(addresses[key])+']||""})}]);');
  w.chain(cfg,central,joined);
  return cfg;
}
const runInput="($('Aufruf').isExecuted ? $('Aufruf').first().json : {})";
function settingsNode(key,node){return addresses[key] ? 'Konfiguration' : node;}
function headers(values) {return {parameters:Object.entries(values).map(([name,value])=>({name,value}))};}
const cred=(type,name)=>({type,name});
const credentials={
  gmail:cred('httpOAuth2Api','TRC Gmail lesen'), 'gmail-write':cred('httpOAuth2Api','TRC Gmail schreiben'),
  calendar:cred('httpOAuth2Api','TRC Kalender lesen'), 'calendar-write':cred('httpOAuth2Api','TRC Kalender schreiben'),
  tasks:cred('httpOAuth2Api','TRC Aufgaben lesen'), 'tasks-write':cred('httpOAuth2Api','TRC Aufgaben schreiben'),
  dav:cred('httpBasicAuth','TRC Nextcloud WebDAV lesen'), 'dav-export':cred('httpBasicAuth','TRC Nextcloud WebDAV schreiben'),
  talk:cred('httpBasicAuth','TRC Nextcloud Talk lesen'), 'talk-write':cred('httpBasicAuth','TRC Nextcloud Talk schreiben'),
  home:cred('httpHeaderAuth','TRC Home Assistant lesen'), 'ha-write':cred('httpHeaderAuth','TRC Home Assistant Aktionen'),
  stocks:cred('httpQueryAuth','TRC Massive'), couch:cred('httpBasicAuth','TRC CouchDB lesen'),
  trc:cred('httpBearerAuth','TRC Workflow-API'), hermes:cred('httpHeaderAuth','TRC Hermes Gateway'), 'smtp-write':cred('smtp','TRC SMTP'),
};
function http(w,name,{url=field('url'),method='GET',credential,format,customHeaders={},bodyType,body,sendBody=true,timeout=12000,pages,batchInterval=0}={}) {
  const params={method,url,options:{timeout,redirect:{redirect:{followRedirects:false}},
    response:{response:{fullResponse:true,neverError:true,...(format?{responseFormat:format}:{})}}}};
  if(credential) Object.assign(params,{authentication:'genericCredentialType',genericAuthType:credential.type});
  if(Object.keys(customHeaders).length) Object.assign(params,{sendHeaders:true,headerParameters:headers(customHeaders)});
  if(bodyType) Object.assign(params,{sendBody,contentType:'raw',rawContentType:bodyType,body});
  if(pages) params.options.pagination=pages;
  if(batchInterval) params.options.batching={batch:{batchSize:1,batchInterval}};
  return w.add(name,'httpRequest',4.5,params,{onError:'continueRegularOutput',
    ...(credential?{credentials:{[credential.type]:{name:credential.name}}}:{})});
}
const googlePages={pagination:{paginationMode:'updateAParameterInEachRequest',
  parameters:{parameters:[{type:'qs',name:'pageToken',value:E("$response.body?.nextPageToken || ''")}]},
  paginationCompleteWhen:'other',completeExpression:E('$response.statusCode >= 400 || !$response.body?.nextPageToken'),
  limitPagesFetched:true,maxRequests:12,requestInterval:250}};
const talkPages={pagination:{paginationMode:'updateAParameterInEachRequest',
  parameters:{parameters:[{type:'qs',name:'lastKnownMessageId',value:E("$response.headers['x-chat-last-given'] || '0'")}]},
  paginationCompleteWhen:'other',completeExpression:E("$response.statusCode !== 200 || !$response.headers['x-chat-last-given'] || ($response.body?.ocs?.data?.length || 0) < 100"),
  limitPagesFetched:true,maxRequests:8,requestInterval:250}};
const upper=['calendar','tasks','talk','dav','couch','home','stocks','kraken','ecb','metals','metal-history','dealer','news','research'];
const names={gmail:'Gmail synchronisieren',calendar:'Kalender synchronisieren','calendar-agenda':'Kalender-Terminfenster',
 tasks:'Google Tasks synchronisieren',talk:'Talk lesen',dav:'Dateiänderungen per WebDAV',couch:'Obsidian-Datenbankstatus',
 home:'Home-Assistant-Entitäten',stocks:'US-Aktien',kraken:'Kraken-Tagesdaten',ecb:'EZB-Referenzkurse',metals:'Edelmetall-Spotpreise',
 'metal-history':'Edelmetall-Tageshistorie',dealer:'Händler-Geld- und Briefkurse',news:'KI- und Technikmeldungen',
 'quantum-news':'Quantum-Meldungen',research:'arXiv-Recherche'};
const dirs={calendar:'google/calendar','calendar-agenda':'google/calendar',tasks:'google/tasks',gmail:'google/gmail',talk:'nextcloud',dav:'nextcloud',
 couch:'obsidian',home:'homeassistant',stocks:'markets',kraken:'markets',ecb:'markets',metals:'markets','metal-history':'markets',
 dealer:'markets',news:'news','quantum-news':'news',research:'research'};
function source(key,type=key) {
  const w=builder(key,dirs[key],names[key],'Ruft eine konfigurierte Quelle ab, normalisiert Inhalte und speichert Belege im Cache. TRC-Import ist optional.');
  const [manual,sub,schedule,cfg]=[w.manual(),w.sub(),w.scheduled(),loadConfig(w,key)];
  for(const trigger of [manual,sub,schedule]) w.link(trigger,cfg);
  const state=dt(w,'Cursor','trc_state','get',{take:1500,always:true});
  const jobs=w.code('Anfragen',
     'const c=configFrom($("Konfiguration").first().json,'+JSON.stringify(key)+','+runInput+');\n'+
     'return c ? OUT(sourcePlans('+JSON.stringify(type)+',c,objects($input.all())).map(job=>({...job,configKey:'+JSON.stringify(key)+'}))) : [];',
     PROVIDERS);
  // A separate config key also acts as a separate cursor namespace when using the same adapter.
  if(key!==type) {
    const node=w.flow.nodes.find(n=>n.name===jobs);
    node.parameters.jsCode=node.parameters.jsCode.replace('objects($input.all())).map','objects($input.all()).map(row=>({...row,key:row.key?.replace(/^'+key+'\\n/,"'+type+'\\n")}))).map');
  }
  const xml=['dav','news','research'].includes(type);
  const raw=http(w,'Abruf',{method:type==='dav'?'PROPFIND':'GET',credential:credentials[type],
    format:xml||type==='ecb'?'text':undefined,
    customHeaders:type==='dav'?{Depth:'1'}:type==='talk'?{'OCS-APIRequest':'true',Accept:'application/json'}:{},
    pages:['calendar','tasks'].includes(type)?googlePages:type==='talk'?talkPages:undefined,
    batchInterval:type==='stocks'?13500:['research','kraken','metals','metal-history'].includes(type)?3100:0});
  w.chain(settingsNode(key,cfg),state,jobs,raw);
  const quota=w.code('Rate-Limit protokollieren',
    'const errors=$input.all().map(httpResult).filter(r=>r.code===429);if(!errors.length)return [];'+
    'const source='+JSON.stringify(key)+';return OUT([{key:"rate:"+source,source,status:"rate_limited",seen_at:now(),'+
    'details_json:JSON.stringify({http:429,count:errors.length})}]);');
  w.chain(raw,quota,dt(w,'Rate-Limit sichern','trc_events','upsert',{filters:[byKey]}));
  w.at(quota,1500,0);
  let sourceResponse=raw;
  if(xml) {
    const isolate=['news','research'].includes(type);
    const compact=w.code('XML prüfen',
      'const isolated='+JSON.stringify(isolate)+';const entries=$input.all().flatMap((item,i)=>{const r=httpResult(item);'+
      'const valid=r.code>=200&&r.code<300&&typeof r.body==="string"&&bytes(r.body)<=6000000&&!/<!DOCTYPE|<!ENTITY/i.test(r.body);'+
      'if(!valid){if(isolated)return [];assertOk(r,"XML");throw Error("Unzulässiges XML");}'+
      'return [{json:{data:r.body},pairedItem:{item:i}}];});if(!entries.length)throw Error("Keine XML-Quelle erreichbar");return entries;');
    const parse=w.add('XML lesen','xml',1,{mode:'xmlToJson',dataPropertyName:'data',options:{explicitArray:false,mergeAttrs:false}},
      isolate?{onError:'continueRegularOutput'}:{});
    w.chain(raw,compact,parse); sourceResponse=parse;
  }
  const transform=w.code('Normalisieren',
    'const prepared=$("Anfragen").all(); const all=$input.all(); const buckets=new Map();\n'+
    'for(let i=0;i<all.length;i++){const linked=$("Anfragen").itemMatching(i); const job=linked.json;const key=job.type+"\\n"+job.target; if(!buckets.has(key))buckets.set(key,{job,pages:[]});\n'+
    (xml?'buckets.get(key).pages.push({body:all[i].json,code:200,headers:{}});':'buckets.get(key).pages.push(httpResult(all[i]));')+
    '}\nconst rows=[],cursors=[],catalog=[];for(const {job,pages} of buckets.values()){\n'+
    'const last=pages.at(-1);if(last.body?.nextPageToken) throw Error("Seitenlimit erreicht, Cursor bleibt erhalten");\n'+
    'if(job.type==="talk"&&last.code===200&&last.body?.ocs?.data?.length>=100&&pages.length>=8) throw Error("Talk-Seitenlimit erreicht");\n'+
    'let cursor=null;for(const [i,r] of pages.entries()){assertOk(r,job.type,job.type==="calendar"?[410]:job.type==="talk"?[304]:[]);\n'+
    'if(["news","research"].includes(job.type)&&r.body?.error)continue;'+
    'const out=sourceRows(job,r.body,r.headers,r.code);rows.push(...out.rows);catalog.push(...out.catalog);\n'+
    'if(out.cursor!==null)cursor=out.cursor;}if(cursor!==null)cursors.push({key:job.configKey+"\\n"+job.source+"\\n"+job.target,value_json:JSON.stringify(cursor),updated_at:now()});}\n'+
    'return OUT([{rows,cursors,catalog,import_trc:prepared[0]?.json.import_trc===true}]);',PROVIDERS);
  const persist=w.call('Cache und Importwarteschlange','persist');
  w.chain(sourceResponse,transform,persist);
  if(xml) w.at('XML prüfen',1500,220);
  else w.at(transform,1500,220);
  w.done();
}
for(const type of upper) source(type);
source('calendar-agenda','calendar');
source('quantum-news','news');

function gmail() {
  const w=builder('gmail',dirs.gmail,names.gmail,'Ruft Nachrichten-Metadaten mit Gmail-History-Cursor oder Suchfilter ab. Ein abgelaufener Cursor löst einen begrenzten Neuabgleich aus.');
  const cfg=loadConfig(w,'gmail');
  for(const t of [w.manual(),w.sub(),w.scheduled()])w.link(t,cfg);
  const state=dt(w,'Cursor','trc_state','get',{take:1500,always:true});
  const jobs=w.code('Anfragen','const c=configFrom($("Konfiguration").first().json,"gmail",'+runInput+');return c?OUT(sourcePlans("gmail",c,objects($input.all()))):[];',PROVIDERS);
  const prof=http(w,'Gmail-Profil',{url:field('profile'),credential:credentials.gmail});
  const scan=w.code('History oder Suche',
    'const job=$("Anfragen").first().json;const r=httpResult($input.first());assertOk(r,"Gmail-Profil");if(!/^\\d+$/.test(String(r.body?.historyId)))throw Error("Gmail-History-ID fehlt");return OUT([{...job,watermark:String(r.body.historyId)}]);');
  const listing=http(w,'Gmail-Liste',{credential:credentials.gmail,pages:googlePages});
  const decide=w.code('Gmail-IDs',
   'const plan=$("History oder Suche").first().json;const pages=$input.all().map(httpResult);const recovery=plan.history&&pages.some(r=>r.code===404);\n'+
   'if(!recovery){for(const p of pages)assertOk(p,"Gmail-Liste"); if(pages.at(-1).body?.nextPageToken)throw Error("Gmail-Seitenlimit erreicht");}\n'+
   'return OUT([{...plan,recovery,url:plan.fallback,ids:recovery?[]:pages.flatMap(r=>plan.history?list(r.body?.history).flatMap(h=>[...list(h.messagesAdded).map(v=>v.message?.id),...list(h.labelsAdded).map(v=>v.message?.id),...list(h.labelsRemoved).map(v=>v.message?.id),...list(h.messagesDeleted).map(v=>v.message?.id)]):list(r.body?.messages).map(m=>m.id))}]);');
  const pick=w.code('Neuabgleich bei abgelaufenem Cursor','return $input.first().json.recovery ? $input.all() : [];');
  const recovery=http(w,'Gmail-Neuabgleich',{credential:credentials.gmail,pages:googlePages});
  const select=w.code('Details planen',
    'const plan=$("Gmail-IDs").first().json;let ids=plan.ids;if(plan.recovery){const pages=$input.all().map(httpResult);for(const p of pages)assertOk(p,"Gmail-Neuabgleich");'+
    'if(pages.at(-1).body?.nextPageToken)throw Error("Gmail-Neuabgleich zu groß");ids=pages.flatMap(r=>list(r.body?.messages).map(m=>m.id));}\n'+
    'const clean=[...new Set(ids.filter(id=>typeof id==="string"&&/^[A-Za-z0-9_-]+$/.test(id)))];if(clean.length>400)throw Error("Gmail-Detailgrenze erreicht");'+
    'return OUT(clean.length?clean.map(id=>({id,url:plan.details+"/"+part(id)+(plan.snippet?"?format=full":"?format=metadata&metadataHeaders=From&metadataHeaders=Subject")})):[{empty:true}]);');
  const bypass=w.code('Direkt zu den Details','return $input.first().json.recovery?[]:$input.all();');
  // Orange branch handles 404. The direct branch exits when recovery is selected.
  w.chain(cfg,state,jobs,prof,scan,listing,decide);
  w.chain(decide,pick,recovery,select);
  w.chain(decide,bypass,select);
  const details=http(w,'Gmail-Metadaten',{credential:credentials.gmail,batchInterval:250});
  const finish=w.code('Gmail normalisieren',
   'const p=$("Gmail-IDs").first().json,rows=[];for(const [i,item] of $input.all().entries()){const r=httpResult(item);'+
   'if(r.code===404){const id=$("Details planen").itemMatching(i).json.id;if(id)rows.push(normalized("emails",p.source,id,p.fetched,{deleted:true},p.fetched));continue;}assertOk(r,"Gmail-Metadaten");rows.push(gmailRows(p,r.body));}'+
   'return OUT([{rows,cursors:p.sync?[{key:"gmail\\n"+p.source+"\\nmail",value_json:JSON.stringify({historyId:p.watermark}),updated_at:now()}]:[],catalog:[],import_trc:p.import_trc}]);',PROVIDERS);
  const nonempty=w.code('Mit Nachrichten','return $input.first().json.empty?[]:$input.all();');
  const empty=w.code('Ohne Nachrichten','const p=$("Gmail-IDs").first().json;if(!$input.first().json.empty)return [];return OUT([{rows:[],cursors:p.sync?[{key:"gmail\\n"+p.source+"\\nmail",value_json:JSON.stringify({historyId:p.watermark}),updated_at:now()}]:[],catalog:[],import_trc:p.import_trc}]);');
  const save=w.call('Cache und Importwarteschlange','persist');
  w.chain(select,nonempty,details,finish,save);
  w.chain(select,empty,save);
  w.done();
}
gmail();

{
  const w=builder('bootstrap','core','Data Tables einrichten','Legt fehlende Tabellen und fehlende Konfigurationszeilen an. Bestehende Einstellungen bleiben erhalten.');
  const start=w.manual();
  const tables=Object.entries(schema).map(([table,columns])=>w.add('Tabelle '+table,'dataTable',1.1,{
    resource:'table',operation:'create',tableName:table,
    columns:{column:Object.entries(columns).map(([name,type])=>({name,type}))},options:{createIfNotExists:true}}));
  const settings=w.code('Standardeinstellungen','return OUT('+JSON.stringify(Object.entries(config).map(([key,value])=>({key,value_json:JSON.stringify(value)})))+');');
  w.chain(start,...tables,settings,
    dt(w,'Fehlende Einstellungen','trc_config','rowNotExists',{filters:[byKey]}),
    dt(w,'Einstellungen eintragen','trc_config','insert'));
  w.done({errors:false});
}
{
  const w=builder('errors','system','Ausführungsfehler protokollieren','Speichert Fehlerklasse und Workflow. Rohfehler, Credentials und Inhaltsdaten bleiben aus der Tabelle.');
  const start=w.add('Ausführungsfehler','errorTrigger',1);
  const event=w.code('Fehler begrenzen',
    'const e=$input.first().json; const name=str(e.workflow?.name,160); const identifier=str(e.execution?.id,120);'+
    'const lastNode=str(e.execution?.lastNodeExecuted,160); return OUT([{key:sha(name+"\\n"+(identifier||now())),source:name,status:"error",'+
    'seen_at:now(),details_json:JSON.stringify({workflow:name,execution:identifier,lastNode})}]);');
  w.chain(start,event,dt(w,'Fehler ablegen','trc_events','upsert',{filters:[byKey]}));w.done({errors:false});
}
{
  const w=builder('persist','core','Quellbelege und Importaufträge sichern','Persistiert Änderungen und optional unveränderliche API-Aufträge. Erst danach wird der Quellcursor gespeichert.');
  const start=w.sub();
  const prep=w.code('Quellpacket prüfen',
   'const p=$input.first().json; if(!Array.isArray(p.rows)||!Array.isArray(p.cursors)||p.rows.length>15000)throw Error("Quellpaket ungültig");'+
   'const groups=new Set(p.rows.map(r=>r.area+"\\n"+r.source));if(groups.size>1)throw Error("Mehrere Quellen in einem Paket");'+
   'return OUT([{...p,area:p.rows[0]?.area||"__none",source:p.rows[0]?.source||"__none"}]);');
  const old=dt(w,'Lokaler Stand','trc_cache','get',{filters:[cond('source',field('source')),cond('area',field('area'))],take:24001,always:true});
  const dedup=w.code('Änderungen auswählen',
   'const p=$("Quellpacket prüfen").first().json,old=new Map(objects($input.all()).filter(r=>r.key).map(r=>[r.key,r]));'+
   'if(old.size>24000)throw Error("Cache pro Quelle überschreitet 24000 Einträge");'+
   'const next=new Map();for(const r of p.rows){const before=next.get(r.key)||old.get(r.key);const payload_json=JSON.stringify(r.payload);'+
   'if(before&&(before.payload_json===payload_json||before.observed_at>r.observed_at))continue;'+
   'if(bytes(payload_json)>32000)throw Error("Cache-Datensatz zu groß");next.set(r.key,{...r,payload_json,stored_at:now()});}'+
   'return OUT([{...p,changes:[...next.values()]}]);');
  w.chain(start,prep,old,dedup);
  // With TRC imports enabled, ensure the immutable outbox exists before committing the cache/cursor.
  const queue=w.code('Importaufträge bilden',
    'const p=$input.first().json;return p.import_trc ? OUT(batches(p.changes.filter(r=>AREAS.has(r.area)))) : [];');
  const queueGuard=dt(w,'Nur neue Aufträge','trc_queue','rowNotExists',{filters:[byKey]});
  const queueWrite=dt(w,'Aufträge ablegen','trc_queue','insert');
  const cache=w.code('Cachezeilen bilden','return OUT($input.first().json.changes);');
  const cacheWrite=dt(w,'Cache aktualisieren','trc_cache','upsert',{filters:[byKey]});
  const cursors=w.code('Cursorzeilen bilden','return OUT($input.first().json.cursors);');
  const cursorWrite=dt(w,'Cursor speichern','trc_state','upsert',{filters:[byKey]});
  const summary=w.code('Quellergebnis',
    'const p=$input.first().json; return OUT([{source:p.source,area:p.area,seen:p.rows.length,updated:p.changes.length,'+
    'records:p.rows.slice(0,120).map(r=>r.payload),catalog:p.catalog||[],advance:p.cursors.length}]);');
  w.chain(dedup,queue,queueGuard,queueWrite);w.chain(dedup,cache,cacheWrite);w.chain(dedup,cursors,cursorWrite);w.link(dedup,summary);
  [queue,cache,cursors,summary].forEach((node,i)=>w.at(node,1000,i*220));
  w.done();
}
{
  const w=builder('queue','core','TRC-Importwarteschlange verarbeiten','Sendet persistente Aufträge an die verifizierte TRC-API. Fehler werden begrenzt und mit identischer UUID erneut versucht.');
  const cfg=loadConfig(w,'trc');w.link(w.manual(),cfg);w.link(w.scheduled(),cfg);
  const enabled=w.code('TRC-Freigabe',
    'const c=configFrom($input.first().json,"trc");if(!c)return [];return OUT([{base:baseUrl(c.baseUrl),max:limits(c.maxAttempts,4,10),limit:limits(c.batchLimit,20,40)}]);');
  const pending=dt(w,'Fällige Aufträge','trc_queue','get',{filters:[cond('status','pending'),cond('next_at',E('$now.toUTC().toISO()'),'lte')],take:field('limit'),sort:['next_at','ASC']});
  const jobs=w.code('Unveränderte Aufträge',
   'const c=$("TRC-Freigabe").first().json;return OUT(objects($input.all()).map(row=>{if(!AREAS.has(row.area)||!/^[-0-9a-f]{36}$/.test(row.key)||bytes(row.body)>512*1024)throw Error("Gespeicherter Importauftrag ungültig");'+
   'return {...row,url:c.base+"/api/v1/workflow/records/"+row.area};}));');
  const send=http(w,'Batches senden',{method:'POST',credential:credentials.trc,bodyType:'application/json',body:field('body'),
    customHeaders:{'Idempotency-Key':field('key')},batchInterval:250});
  const mark=w.code('Ergebnis und Backoff',
    'return OUT($input.all().map((item,i)=>{const row=$("Unveränderte Aufträge").itemMatching(i).json;const r=httpResult(item);'+
    'return retry(row,r.code,r.headers["retry-after"],now(),$("TRC-Freigabe").first().json.max);}));');
  w.chain(cfg,enabled,pending,jobs,send,mark,dt(w,'Status aktualisieren','trc_queue','update',{filters:[byID],keys:['status','attempts','finished_at','next_at','error']}));
  w.done();
}
{
  const w=builder('queue-retry','maintenance','Einzelnen Import erneut freigeben','Setzt einen Fehlerauftrag nach Sichtprüfung auf ausstehend. Body und UUID bleiben erhalten.');
  const start=w.sub();
  const prep=w.code('Freigabe prüfen',
    'const job=$input.first().json;if(job.confirm!==true||!/^[-0-9a-f]{36}$/.test(job.key||""))throw Error("UUID und explizite Freigabe erforderlich");return OUT([{key:job.key,status:"pending",attempts:0,next_at:now(),finished_at:"",error:""}]);');
  w.chain(start,prep,dt(w,'Fehlerauftrag freigeben','trc_queue','update',{filters:[byKey,cond('status','dead')],
    keys:['status','attempts','next_at','finished_at','error']}));
  w.done();
}
const actionNames={'gmail-write':'Gmail senden und Entwurf erstellen','calendar-write':'Kalenderänderung freigeben',
  'tasks-write':'Aufgabenänderung freigeben','talk-write':'Talk-Nachricht freigeben','ha-write':'Home-Assistant-Aktion freigeben',
  'smtp-write':'SMTP-Nachricht freigeben','dav-export':'Markdown-Bericht zu WebDAV exportieren'};
const actionDirs={'gmail-write':'google/gmail','calendar-write':'google/calendar','tasks-write':'google/tasks',
  'talk-write':'nextcloud','ha-write':'homeassistant','smtp-write':'notifications','dav-export':'obsidian'};
for(const [key,title] of Object.entries(actionNames)){
  const w=builder(key,actionDirs[key],title,'Ausschließlich bestätigte Aufrufe mit konfiguriertem Ziel. Unklarer Versand wird nicht automatisch wiederholt.');
  const cfg=loadConfig(w,key);
  w.link(w.sub(),cfg);
  const plan=w.code('Ziel und Freigabe prüfen',
    'const c=configFrom($input.first().json,'+JSON.stringify(key)+');return c?OUT([prepareAction('+JSON.stringify(key)+',c,$("Aufruf").first().json)]):[];',PROVIDERS+ACTIONS);
  const previous=dt(w,'Vorherige Ausführung','trc_delivery','get',{filters:[byKey],take:1,always:true});
  const reserve=w.code('Wiederholungen verhindern',
    'const old=$input.first().json, job=$("Ziel und Freigabe prüfen").first().json;'+
    'if(old.key){if(old.digest!==job.digest)throw Error("Anforderungs-ID für geänderte Aktion wiederverwendet");return OUT([{...job,already:true,status:old.status}]);}'+
    'return OUT([{...job,already:false,status:"reserved",error:"",sent_at:now()}]);');
  w.chain(settingsNode(key,cfg),plan,previous,reserve);
  const newOnly=w.code('Erstausführung','return $input.first().json.already?[]:$input.all();');
  const known=w.code('Bereits protokolliert','const p=$input.first().json;return p.already?OUT([{channel:p.channel,key:p.key,status:p.status,replayed:true}]):[];');
  const insert=dt(w,'Ausführung reservieren','trc_delivery','insert');
  w.chain(reserve,newOnly,insert);w.link(reserve,known);w.at(newOnly,960,0);w.at(known,960,200);
  const send=key==='smtp-write'?w.add('Aktion ausführen','emailSend',2.1,
    {fromEmail:E('$("Erstausführung").first().json.content.from'),toEmail:E('$("Erstausführung").first().json.content.to'),
     subject:E('$("Erstausführung").first().json.content.subject'),emailFormat:'text',text:E('$("Erstausführung").first().json.content.text'),
     options:{appendAttribution:false}}, {credentials:{smtp:{name:credentials[key].name}},onError:'continueRegularOutput'}):
     http(w,'Aktion ausführen',{url:E('$("Erstausführung").first().json.url'),method:E('$("Erstausführung").first().json.method'),
       credential:credentials[key],bodyType:key==='dav-export'?'text/markdown; charset=utf-8':'application/json',
       sendBody:key==='calendar-write'?E('$("Erstausführung").first().json.method !== "DELETE"'):true,
       body:E(key==='dav-export'?'$("Erstausführung").first().json.content':'JSON.stringify($("Erstausführung").first().json.content)'),
       customHeaders:key==='talk-write'?{'OCS-APIRequest':'true',Accept:'application/json'}:key==='dav-export'?{'If-None-Match':'*'}:{}});
  const outcome=w.code('Ergebnis klassifizieren',
    'const job=$("Erstausführung").first().json; const result='+
    (key==='smtp-write'?'($input.first().json.error?{code:0}:{code:200})':'httpResult($input.first())')+
    ';return OUT([{key:job.key,channel:job.channel,...deliveryOutcome(job.channel,result),sent_at:now()}]);',PROVIDERS+ACTIONS);
  w.chain(insert,send,outcome,dt(w,'Versandstatus sichern','trc_delivery','update',{filters:[byKey],keys:['status','error','sent_at']}));
  w.done();
}

{
  const w=builder('dispatch','notifications','Benachrichtigung zustellen','Ruft den freigegebenen Kanal auf und wechselt nach eindeutiger Ablehnung auf maximal einen konfigurierten Ersatzkanal.');
  const start=w.sub(),cfg=loadConfig(w,'dispatch');
  const plan=w.code('Kanal und Auftrag prüfen',
    'const c=configFrom($input.first().json,"dispatch");const p=$("Aufruf").first().json;'+
    'if(!c)return [];if(p.confirm!==true||!validText(p.requestId,120)||!bodyText(p.text))throw Error("Versandauftrag ungültig");'+
    'const channels=["gmail-write","smtp-write","talk-write","ha-write"];const first=p.channel;'+
    'const second=(c.fallbackOrder||[]).find(name=>channels.includes(name)&&name!==first);'+
    'if(!channels.includes(first)||!["low","normal","high"].includes(p.priority||"normal"))throw Error("Unzulässiger Versandkanal");'+
    'return OUT([{...p,channel:first,secondary:second||null}]);',PROVIDERS+ACTIONS);
  w.chain(start,cfg,plan);
  const adapters={
    'gmail-write': '{...p,action:"send",to:p.to||p.targets?.email}',
    'smtp-write': '{...p,action:"send",to:p.to||p.targets?.email}',
    'talk-write':'{...p,action:"send",room:p.room||p.targets?.room}',
    'ha-write':'{...p,action:"service",service:p.service||p.targets?.service,payload:{title:p.subject||"TRC-AI",message:p.text}}'
  };
  Object.entries(adapters).forEach(([key,adapt],i)=>{
    const route=w.code('Kanal '+key,'const p=$input.first().json;return p.channel==='+JSON.stringify(key)+'?OUT(['+adapt+']):[];');
    const call=w.call('Zustellen '+key,key,{optional:true});
    w.chain(plan,route,call);w.at(route,1060,i*260);
    const fallback=w.code('Ersatz nach Ablehnung '+key,'const p=$("Kanal und Auftrag prüfen").first().json;return $input.first().json.status==="rejected"&&p.secondary?OUT([p]):[];');
    w.link(call,fallback);
    Object.entries(adapters).filter(([name])=>name!==key).forEach(([name,adapter],j)=>{
      const choose=w.code('Ersatz '+key+' '+name,'const p=$input.first().json;return p.secondary==='+JSON.stringify(name)+'?OUT(['+adapter+']):[];');
      w.at(choose,1720,i*620+j*135);
      w.chain(fallback,choose,w.call('Ersatz zustellen '+key+' '+name,name,{optional:true}));
    });
  });
  w.done();
}

{
  const w=builder('gmail-message','google/gmail','Freigegebene Gmail-Nachricht lesen','Gibt begrenzten MIME-Klartext zu einer ausdrücklich angeforderten ID aus. Speichert keinen Nachrichtentext.');
  const start=w.sub(),cfg=loadConfig(w,'gmail-message');
  const jobs=w.code('Nachricht freigeben',
    'const c=configFrom($input.first().json,"gmail-message"),p=$("Aufruf").first().json;if(!c)return [];'+
    'if(p.confirm!==true||!validText(p.messageId,120)||!/^[A-Za-z0-9_-]+$/.test(p.messageId))throw Error("Nachricht muss ausdrücklich angefordert werden");'+
    'return OUT([{url:GOOGLE.gmail+"/messages/"+part(p.messageId)+"?format=full",max:limits(c.maxBytes,65536,262144)}]);',PROVIDERS);
  const fetch=http(w,'Nachricht abrufen',{credential:credentials.gmail});
  const result=w.code('MIME-Klartext ausgeben',
    'const r=httpResult($input.first());assertOk(r,"Gmail");const j=$("Nachricht freigeben").first().json;return OUT([gmailText(r.body,j.max)]);',PROVIDERS);
  w.chain(start,cfg,jobs,fetch,result);w.done();
}
{
  const w=builder('gmail-attachment','google/gmail','Gmail-Anhang kontrolliert lesen','Prüft den in Google gemeldeten Dateiumfang und gibt nur einen ausdrücklich angeforderten Anhang als Base64 aus.');
  const start=w.sub(),cfg=loadConfig(w,'gmail-attachment');
  const jobs=w.code('Anhang beantragen',
    'const c=configFrom($input.first().json,"gmail-attachment"),p=$("Aufruf").first().json; if(!c)return [];'+
    'if(p.confirm!==true||!validText(p.messageId,120)||!validText(p.attachmentId,480))throw Error("Anhang muss ausdrücklich angefordert werden");'+
    'return OUT([{base:GOOGLE.gmail+"/messages/"+part(p.messageId),attachment:p.attachmentId,max:limits(c.maxBytes,10485760,20971520)}]);',PROVIDERS);
  const inspect=http(w,'Nachrichtenstruktur abrufen',{url:E('$json.base + "?format=full"'),credential:credentials.gmail});
  const permit=w.code('MIME-Struktur und Länge prüfen',
    'const j=$("Anhang beantragen").first().json,r=httpResult($input.first());assertOk(r,"Gmail");'+
    'function parts(body){return [body,...list(body?.parts).flatMap(parts)];}const match=parts(r.body.payload).find(x=>x?.body?.attachmentId===j.attachment);'+
    'if(!match||!(match.body.size>0&&match.body.size<=j.max))throw Error("Anhang fehlt oder überschreitet das Limit");'+
    'return OUT([{url:j.base+"/attachments/"+part(j.attachment),name:str(match.filename,200),mime:str(match.mimeType,100),size:match.body.size,max:j.max}]);');
  const fetch=http(w,'Anhang abrufen',{credential:credentials.gmail});
  const readonly=w.code('Anhang ausgeben',
    'const j=$("MIME-Struktur und Länge prüfen").first().json,r=httpResult($input.first());assertOk(r,"Gmail");'+
    'if(typeof r.body.data!=="string"||r.body.data.length>Math.ceil(j.max*4/3)+4||r.body.size!==j.size)throw Error("Anhangsgröße unerwartet");'+
    'return OUT([{filename:j.name,mime:j.mime,size:j.size,data_base64url:r.body.data}]);');
  w.chain(start,cfg,jobs,inspect,permit,fetch,readonly);w.done();
}
{
  const w=builder('dav-download','nextcloud','WebDAV-Datei kontrolliert übernehmen','Ausschließlich bestätigter Download unterhalb einer erlaubten Quelle, mit HEAD-Prüfung und ETag-Bedingung.');
  const start=w.sub(),cfg=loadConfig(w,'dav-download');
  const jobs=w.code('Pfad und Freigabe prüfen',
    'const c=configFrom($input.first().json,"dav-download"),p=$("Aufruf").first().json;if(!c)return [];'+
    'if(p.confirm!==true||!validText(c.user,200)||!validText(p.path,1500))throw Error("Explizite Dateifreigabe erforderlich");'+
    'const file=pathSegments(p.path);const allow=targeted(c,"directories",20).some(dir=>{const prefix=dir==="/"?"":pathSegments(dir);return !prefix||file.startsWith(prefix+"/");});'+
    'if(!allow)throw Error("Datei außerhalb der erlaubten Ordner");return OUT([{url:baseUrl(c.baseUrl)+"/remote.php/dav/files/"+part(c.user)+"/"+file,max:limits(c.maxBytes,20971520,52428800)}]);',PROVIDERS);
  const inspect=http(w,'Dateigröße abrufen',{method:'HEAD',credential:credentials.dav,format:'text'});
  const permit=w.code('Länge und ETag prüfen',
    'const j=$("Pfad und Freigabe prüfen").first().json,r=httpResult($input.first());assertOk(r,"WebDAV");'+
    'const size=Number(r.headers["content-length"]),etag=r.headers.etag;if(!Number.isInteger(size)||size<0||size>j.max||!etag)throw Error("Datei fehlt oder Größen-/ETag-Prüfung fehlgeschlagen");'+
    'return OUT([{url:j.url,size,etag}]);');
  const fetch=http(w,'Datei abrufen',{credential:credentials.dav,format:'file',customHeaders:{'If-Match':field('etag')},timeout:35000});
  const output=w.code('Dateiergebnis prüfen',
    'const item=$input.first(),r=httpResult(item);assertOk(r,"WebDAV-Datei");if(!item.binary)throw Error("Dateidaten fehlen");return [item];');
  w.link(start,cfg);w.chain(settingsNode("dav-download",cfg),jobs,inspect,permit,fetch,output);w.done();
}
const reportTypes={daily:'Tagesbericht',weekly:'Wochenbericht',monthly:'Monatsbericht',yearly:'Jahresbericht',manual:'Manueller Bericht',
  market:'Marktbericht',system:'Systembericht',ai:'KI-News-Bericht',quantum:'Quantum-Bericht'};
for(const [kind,title] of Object.entries(reportTypes)){
  const w=builder(kind,'reports',title,'Erstellt aus dem unabhängigen n8n-Cache Text, Markdown, HTML und JSON. Optionale Archivierung oder freigegebene Zustellung.');
  const cfg=loadConfig(w,'reports');
  for(const t of [w.manual(),w.sub(),...(schedules[kind]?[w.scheduled()]:[])])w.link(t,cfg);
  const settings=w.code('Berichtseinstellungen',
    'const c=configFrom($input.first().json,"reports",'+runInput+');return c?OUT([{...c,scheduled:'+
    (schedules[kind]?'$("Zeitplan").isExecuted':'false')+',limit:limits(c.maxCacheRows,24000,24000)}]):[];');
  const cache=dt(w,'Lokal verfügbare Belege','trc_cache','get',{take:field('limit'),sort:['stored_at','DESC'],always:true});
  const build=w.code('Bericht erzeugen',
    'const c=$("Berichtseinstellungen").first().json; const r=makeReport('+JSON.stringify(kind)+',c,asSnapshot(objects($input.all())));'+
    'return OUT([{...r,cacheLimitReached:$input.all().length>=c.limit}]);',REPORTS);
  w.chain(cfg,settings,cache,build);
  const archive=w.code('Archivierung planen',
    'const c=$("Berichtseinstellungen").first().json,r=$input.first().json;if(c.importTrc!==true)return [];'+
    'const format=["text","markdown","html"].includes(c.format)?c.format:"markdown";'+
    'const payload={title:r.title,period:r.period,format,body:str(r[format],27000),generatedAt:r.generatedAt};'+
    'return OUT([{rows:[normalized("reports",c.source,'+JSON.stringify(kind)+'+":"+r.period.from,r.generatedAt,payload)],cursors:[],import_trc:true}]);');
  w.chain(build,archive,w.call('Bericht zur TRC-Übertragung vormerken','persist'));w.at(archive,1200,0);
  const deliver=w.code('Zustellung vorbereiten',
    'const c=$("Berichtseinstellungen").first().json,r=$input.first().json,d=c.delivery;'+
    'if(!d||d.enabled!==true||d.confirm!==true)return [];'+
    // A user can configure the report producer and channel separately. Scheduled runs never acquire those authorizations on their own.
    'return OUT([{...d,confirm:true,requestId:"report:"+'+JSON.stringify(kind)+'+":"+r.period.from,subject:r.title,text:str(r.text,27000),priority:c.priority||"normal"}]);');
  w.chain(build,deliver,w.call('Freigegeben zustellen','dispatch',{optional:true}));w.at(deliver,1200,220);
  const end=w.code('Bericht ausgeben','return $input.all();');w.link(build,end);w.at(end,1200,470);
  w.done();
}
{
  const healthDefs={
    health:{label:'Dienste prüfen',config:'health',credential:undefined},
    'trc-health':{label:'TRC-API prüfen',config:'trc',credential:credentials.trc,path:'/api/v1/system/status',target:'TRC-AI',expect:'trc'},
    'ha-health':{label:'Home Assistant prüfen',credential:credentials.home,path:'/api/',target:'Home Assistant',expect:'ha'},
    'nextcloud-health':{label:'Nextcloud prüfen',path:'/status.php',target:'Nextcloud',expect:'nextcloud'},
    'talk-health':{label:'Nextcloud Talk prüfen',credential:credentials.talk,path:'/ocs/v2.php/cloud/capabilities?format=json',target:'Nextcloud Talk',expect:'talk'},
    'couch-health':{label:'CouchDB prüfen',credential:credentials.couch,path:'/_up',target:'CouchDB',expect:'couch-up'},
    'hermes-health':{label:'Hermes-Gateway prüfen',credential:credentials.hermes,path:'/health/detailed',target:'Hermes',expect:'hermes'},
    'ollama-health':{label:'Ollama prüfen',path:'/api/version',target:'Ollama',expect:'ollama'}
  };
  for(const [key,def] of Object.entries(healthDefs)){
    const w=builder(key,'system',def.label,'Prüft konfigurierte Verfügbarkeitsendpunkte und hält den letzten beobachteten Status fest.');
    const cfg=loadConfig(w,def.config||key);
    w.link(w.manual(),cfg);w.link(w.scheduled(),cfg);
    const plan=w.code('Prüfziele',
      'const c=configFrom($input.first().json,'+JSON.stringify(def.config||key)+');if(!c)return [];'+
      (def.path?'return OUT([{url:baseUrl(c.baseUrl)+'+JSON.stringify(def.path)+',target:'+JSON.stringify(def.target)+
        ',expect:'+JSON.stringify(def.expect)+',source:'+JSON.stringify(key)+'}]);':'return OUT(sourcePlans("health",c,[]));'),PROVIDERS);
    const fetch=http(w,'Verfügbarkeit prüfen',{credential:def.credential,timeout:8000,batchInterval:300,
      customHeaders:key==='talk-health'?{'OCS-APIRequest':'true',Accept:'application/json'}:{}});
    const outcome=w.code('Status ermitteln',
      'const t=now(),rows=$input.all().map((item,i)=>{const j=$("Prüfziele").itemMatching(i).json,r=httpResult(item);'+
      'let ok=r.code>=200&&r.code<300;if(j.expect==="trc")ok=ok&&typeof r.body?.version==="string";'+
      'if(j.expect==="nextcloud")ok=ok&&r.body?.installed===true&&r.body?.maintenance!==true;'+
      'if(j.expect==="ha")ok=ok&&r.body?.message==="API running.";'+
      'if(j.expect==="talk")ok=ok&&typeof r.body?.ocs?.data?.capabilities?.spreed==="object";'+
      'if(j.expect==="couch-up")ok=ok&&r.body?.status==="ok";'+
      'if(j.expect==="hermes")ok=ok&&!!r.body&&typeof r.body==="object";'+
      'if(j.expect==="couchdb")ok=ok&&r.body?.couchdb==="Welcome";if(j.expect==="ollama")ok=ok&&typeof r.body?.version==="string";'+
      'return normalized("notifications",j.source,"status:"+j.target,t,{title:j.target,status:ok?"available":"unavailable",http:r.code});});'+
      'return OUT([{rows,cursors:[],import_trc:$("Konfiguration").first().json.value_json&&parse($("Konfiguration").first().json.value_json).importTrc===true}]);');
    w.chain(settingsNode(def.config||key,cfg),plan,fetch,outcome,w.call('Status sichern','persist'));
    w.done();
  }
}
{
  const w=builder('maintenance','maintenance','Tabellen prüfen und pflegen','Entfernt zeitlich abgelaufene Cache- und Erfolgszeilen. Ausstehende oder fehlerhafte Importaufträge bleiben erhalten.');
  const cfg=loadConfig(w,'maintenance');w.link(w.manual(),cfg);w.link(w.scheduled(),cfg);
  const enabled=w.code('Aufbewahrung prüfen','const c=configFrom($input.first().json,"maintenance");return c?OUT([c]):[];');
  w.link(cfg,enabled);
  const options=[
    ['trc_cache','stored_at','cacheDays',750,24001],['trc_queue','finished_at','sentDays',14,5001],
    ['trc_events','seen_at','eventDays',30,5001],['trc_delivery','sent_at','deliveryDays',180,5001],
    ['trc_state','updated_at',null,0,1501],['trc_config','key',null,0,1501],
  ];
  for(const [i,[table,stamp,setting,days,limit]] of options.entries()){
    const get=dt(w,'Zeilen '+table,table,'get',{take:limit,sort:[stamp,'ASC'],always:true});
    const assess=w.code('Prüfen '+table,'const c=$("Aufbewahrung prüfen").first().json,rows=objects($input.all()).filter(r=>r.key);'+
      'const t=now(),size=rows.reduce((sum,row)=>sum+bytes(JSON.stringify(row)),0);'+
      'const cap=limits(c.purgeLimit,250,1000);const table='+JSON.stringify(table)+',stamp='+JSON.stringify(stamp)+',setting='+JSON.stringify(setting)+';'+
      'const deletion=setting?rows.filter(r=>{if(table==="trc_queue"&&r.status!=="sent")return false;'+
      'if(table==="trc_delivery"&&r.status!=="sent"&&r.status!=="rejected")return false;'+
      'const personal=table==="trc_cache"&&["emails","calendar","tasks","messenger"].includes(r.area);'+
      'const cutoff=earlier(t,limits(personal?c.personalDays:c[setting],personal?30:'+days+',3650)*86400000);'+
      'return r[stamp]&&r[stamp]<cutoff;}).slice(0,cap):[];'+
      'return OUT([{table,rows:rows.length,size,truncated:rows.length==='+limit+',deletion}]);');
    w.chain(enabled,get,assess);w.at(get,710,i*190);
    if(setting){
      const select=w.code('Abgelaufen '+table,'return OUT($input.first().json.deletion.map(row=>({id:row.id})));');
      const filters=table==='trc_queue'?[byID,cond('status','sent')]:[byID];
      w.chain(assess,select,dt(w,'Abgelaufenes löschen '+table,table,'deleteRows',{filters}));
    }
  }
  const summary=w.code('Speicher und Warnstatus',
    'const c=$("Aufbewahrung prüfen").first().json;const a='+JSON.stringify(options.map(opt=>'Prüfen '+opt[0]))+'.map(name=>$(name).first().json);'+
    'const bytesEstimated=a.reduce((sum,r)=>sum+r.size,0);const warning=bytesEstimated>=Number(c.warnBytes)||a.some(r=>r.truncated);'+
    'const queue=a.find(r=>r.table==="trc_queue");'+
    'return OUT([{key:"maintenance",source:"maintenance",seen_at:now(),status:warning?"warning":"ok",details_json:JSON.stringify({bytesEstimated,'+
    'declaredLimit:c.dataTableLimitBytes,queueRows:queue.rows,tables:a.map(({deletion,...meta})=>meta)})}]);');
  w.link(enabled,summary);w.at(summary,710,options.length*190);
  w.chain(summary,dt(w,'Speicherstatus sichern','trc_events','upsert',{filters:[byKey]}));w.done();
}
{
  const w=builder('queue-status','system','Importwarteschlange einsehen','Zeigt Stichprobenzahlen und Fehleraufträge ohne Request-Bodies.');
  const read=dt(w,'Aufträge lesen','trc_queue','get',{take:12001,sort:['next_at','ASC'],always:true});
  const summary=w.code('Status ohne Inhalte',
    'const rows=objects($input.all()).filter(r=>r.key),counts={pending:0,dead:0,sent:0};'+
    'for(const job of rows)if(Object.hasOwn(counts,job.status))counts[job.status]++;'+
    'return OUT([{counts,truncated:rows.length===12001,dead:rows.filter(r=>r.status==="dead").slice(0,100)'+
    '.map(({key,area,source,attempts,error})=>({key,area,source,attempts,error}))}]);');
  w.link(w.manual(),read);w.link(w.sub(),read);w.link(read,summary);w.done();
}
{
  const w=builder('system-alerts','system','Systemwarnungen und Wiederherstellung','Erkennt Dienstfehler, gestoppte Importe, Workflowfehler, Speicherwarnungen und veraltete Quellen. Optionale deduplizierte Zustellung.');
  const cfg=loadConfig(w,'alerts');
  const enabled=w.code('Überwachung prüfen','const c=configFrom($input.first().json,"alerts");return c?OUT([c]):[];');
  const cache=dt(w,'Cache-Status','trc_cache','get',{take:24001,sort:['stored_at','DESC'],always:true});
  const queue=dt(w,'Importfehler','trc_queue','get',{filters:[cond('status','dead')],take:100,always:true});
  const events=dt(w,'Letzte Ereignisse','trc_events','get',{take:200,sort:['seen_at','DESC'],always:true});
  const state=dt(w,'Voriger Warnstatus','trc_state','get',{filters:[cond('key','health-alerts')],take:1,always:true});
  const compare=w.code('Warnungen vergleichen',
    'const c=$("Überwachung prüfen").first().json,t=now(),prev=parse($input.first().json.value_json),'+
    'cache=objects($("Cache-Status").all()),events=objects($("Letzte Ereignisse").all()),issues=[];'+
    'const maxAge=limits(c.maxAgeHours,72,720)*3600000;for(const row of cache){if(row.area!=="notifications"||!row.external_id?.startsWith("status:"))continue;'+
    'if(parse(row.payload_json).status==="unavailable")issues.push(str(row.external_id.slice(7),80)+" ist nicht erreichbar");}'+
    'const sources=c.sourceMaxAgeHours||{};for(const [source,age] of Object.entries(sources).slice(0,40)){'+
    'const last=cache.find(row=>row.source===source);if(!last||last.stored_at<earlier(t,limits(age,24,720)*3600000))issues.push(str(source,64)+" ist veraltet");}'+
    'if($("Importfehler").all().some(i=>i.json.key))issues.push("Fehleraufträge in der Importwarteschlange");'+
    'if(events.some(r=>r.key==="maintenance"&&r.status==="warning"))issues.push("Warnung zum Data-Table-Speicher");'+
    'if(events.some(r=>r.status==="error"&&r.seen_at>=earlier(t,maxAge)))issues.push("Fehlgeschlagene Workflow-Ausführungen");'+
    'if(events.some(r=>r.status==="rate_limited"&&r.seen_at>=earlier(t,maxAge)))issues.push("API-Abfragelimit erreicht");'+
    'const unique=[...new Set(issues)].sort().slice(0,64);const signature=unique.length?sha(JSON.stringify(unique)):"ok";'+
    'const recovered=prev.signature&&prev.signature!=="ok"&&signature==="ok";const cooldown=limits(c.minutes,120,1440)*60000;'+
    'const last=prev.at||"";const delivery=c.delivery;const alert=delivery?.enabled===true&&delivery.confirm===true&&'+
    '(unique.length>0&&(signature!==prev.signature||last<earlier(t,cooldown))||recovered&&c.recovery===true);'+
    'const due=Number.isFinite(cooldown)?Math.floor(Date.parse(t)/cooldown):0;'+
    'return OUT([{issues:unique,signature,alert,delivery,requestId:"health:"+signature.slice(0,40)+":"+due,'+
    'key:"health-alerts",value_json:JSON.stringify({signature,at:alert?t:last}),updated_at:t}]);');
  w.link(w.manual(),cfg);w.link(w.scheduled(),cfg);
  w.chain(cfg,enabled,cache,queue,events,state,compare);
  const reserve=dt(w,'Warnstand sichern','trc_state','upsert',{filters:[byKey]});
  const prepare=w.code('Freigegebene Warnung',
    'const j=$("Warnungen vergleichen").first().json;return j.alert?OUT([{...j.delivery,confirm:true,requestId:j.requestId,'+
    'priority:"high",subject:"TRC-AI – Systemstatus",text:j.issues.length?j.issues.join(String.fromCharCode(10)):"Die überwachten Dienste sind wieder verfügbar."}]):[];');
  const result=w.code('Warnstatus ausgeben','const {issues,signature}= $("Warnungen vergleichen").first().json;return OUT([{issues,status:signature==="ok"?"ok":"warning"}]);');
  w.chain(compare,reserve,prepare,w.call('Warnung über freigegebenen Kanal','dispatch',{optional:true}));
  w.link(compare,result);w.at(reserve,1600,0);w.at(result,1600,260);w.done();
}
const configFile='data-tables/config-default.json';
put(configFile,JSON.stringify(Object.entries(config).map(([key,value])=>({key,value_json:JSON.stringify(value)})),null,2)+'\n');
put('MANIFEST.json',JSON.stringify({name:'TRC-AI n8n',version:'1.0.0',n8n:'2.49.7',trcApi:'0.1.0',zone:'Europe/Vienna',workflows:manifest},null,2)+'\n');
function walk(path){return readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(path,entry.name)):[join(path,entry.name)]);}
for(const file of walk(join(root,'workflows'))) if(!expected.has(relative(root,file))) throw Error('Unbekannter Export: '+relative(root,file));
console.log(manifest.length+' Arbeitsabläufe '+(check?'geprüft':'erzeugt'));
