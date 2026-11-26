import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const require=createRequire(import.meta.url);
const sources=['core','providers','actions','reports'].map(name=>readFileSync(new URL('../src/'+name+'.js',import.meta.url),'utf8')).join('\n');
const api=new Function('require',sources+'\nreturn {baseUrl,configFrom,batches,retry,normalized,localDay,periods,marketSummary,makeReport,sourcePlans,sourceRows,prepareAction,deliveryOutcome,pathSegments,csv,gmailText};')(require);
const ts='2026-11-26T12:00:00.000Z';
test('TRC-Batches sind eindeutig, UTF-8-beschränkt und stabil',()=>{
  const records=Array.from({length:220},(_,i)=>api.normalized('tasks','test','t'+i,ts,{title:'🧪'.repeat(1800)}));
  const jobs=api.batches([...records,records[0]],ts);
  assert.equal(jobs.reduce((n,j)=>n+JSON.parse(j.body).records.length,0),220);
  assert.ok(jobs.every(j=>Buffer.byteLength(j.body)<=524288&&JSON.parse(j.body).records.length<=100));
  assert.deepEqual(jobs,api.batches([...records,records[0]],ts));
  assert.throws(()=>api.batches([api.normalized('tasks','test','x',ts,{t:'🧪'.repeat(131100)})],ts));
});
test('503/429 bleiben wiederholbar, 409 und 422 werden isoliert',()=>{
  const job=api.batches([api.normalized('tasks','test','one',ts,{title:'Prüfen'})],ts)[0];
  assert.equal(api.retry(job,503,60,ts).next_at,'2026-11-26T12:01:00.000Z');
  assert.equal(api.retry(job,429,'Thu, 26 Nov 2026 12:02:00 GMT',ts).status,'pending');
  for(const status of [401,409,413,415,422]) assert.equal(api.retry(job,status,null,ts).status,'dead');
  assert.equal(api.retry({...job,attempts:3},503,null,ts).status,'dead');
  assert.equal(api.retry(job,201,null,ts).status,'sent');
});
test('Calendar 410 invalidiert den Cursor und ganztägige Termine bleiben lokale Tage',()=>{
  const config={source:'test',calendarIds:['x']};
  const states=[{key:'calendar\ntest\nx',value_json:'{"syncToken":"OLD"}'}];
  const [job]=api.sourcePlans('calendar',config,states,ts);
  assert.match(job.url,/syncToken=OLD/);
  assert.deepEqual(api.sourceRows(job,{}, {},410).cursor,{});
  const out=api.sourceRows(job,{items:[{id:'one',summary:'Termin',start:{date:'2026-11-26'},end:{date:'2026-11-27'},status:'confirmed'}],nextSyncToken:'NEW'});
  assert.equal(out.rows[0].payload.start,'2026-11-26');
  assert.equal(out.rows[0].payload.allDay,true);
  assert.equal(out.cursor.syncToken,'NEW');
});
test('Google Tasks behält Konten, Listen und Google-Datumsfelder bei',()=>{
  const [job]=api.sourcePlans('tasks',{source:'account-a',taskListIds:['list/a'],manual:{mode:'overdue'}},[],ts);
  assert.match(job.url,/list%2Fa/);
  const out=api.sourceRows(job,{items:[{id:'x',title:'Alt',status:'needsAction',due:'2026-11-25T00:00:00Z'},
    {id:'y',title:'Neu',status:'completed',due:'2026-11-20T00:00:00Z'}]});
  assert.equal(out.rows.length,1);
  assert.equal(out.rows[0].external_id,'list/a:x');
  assert.equal(out.cursor,null);
});
test('FX, Monatsgrenze, Prozent und Feinunze sind nachvollziehbar',()=>{
  const m=(d,p)=>({symbol:'XAU',source:'test',category:'metal',currency:'USD',unit:'troy-ounce',timestamp:d+'T12:00:00Z',price:p});
  const fx=(d,p)=>({symbol:'USD',source:'ecb',category:'fx',currency:'EUR',timestamp:d+'T00:00:00Z',price:p});
  const result=api.marketSummary([m('2026-03-31',2200),m('2026-02-28',2000),fx('2026-03-30',1.1),fx('2026-02-27',1)],'2026-04-01T12:00:00Z')[0];
  assert.ok(Math.abs(result.changes.month.pct-10)<1e-8);
  assert.ok(Math.abs(result.eur-2000)<1e-8);
  assert.ok(Math.abs(result.eurPerGram-2000/31.1034768)<1e-8);
  assert.equal(result.changes.year,null);
});
test('Bericht kennt fehlende Daten und escapet HTML',()=>{
  const report=api.makeReport('daily',{},[{area:'emails',record:{title:'<img src=x>',important:true,unread:true}}],ts);
  assert.match(report.html,/&lt;img src=x&gt;/);
  assert.ok(!report.html.includes('<img'));
  assert.match(report.markdown,/Keine Daten vorhanden/);
  assert.equal(api.localDay('2026-03-28T23:30:00Z'),'2026-03-29');
  assert.deepEqual(api.periods('weekly','2026-11-29T20:00:00Z'),{today:'2026-11-29',from:'2026-11-23',to:'2026-11-30'});
});
test('Schreibsperren, Ziel-Allowlist und abgelehnter bzw. unklarer Versand',()=>{
  const params={action:'send',requestId:'test-01',to:'receiver@example.invalid',subject:'Test',text:'Synthetisch',confirm:true};
  const cfg={actions:['send'],recipients:[params.to],writesEnabled:true};
  assert.throws(()=>api.prepareAction('gmail-write',cfg,{...params,confirm:false}));
  assert.throws(()=>api.prepareAction('gmail-write',cfg,{...params,to:'other@example.invalid'}));
  assert.throws(()=>api.prepareAction('gmail-write',cfg,{...params,subject:'Test\r\nCc:evil'}));
  const result=api.prepareAction('gmail-write',cfg,params);
  assert.ok(result.content.raw);
  assert.equal(api.deliveryOutcome('smtp-write',{code:0}).status,'uncertain');
  assert.equal(api.deliveryOutcome('gmail-write',{code:400}).status,'rejected');
  assert.equal(api.deliveryOutcome('talk-write',{code:200,body:{ocs:{meta:{statuscode:403}}}}).status,'uncertain');
});
test('URL- und DAV-Dateigrenzen halten Dienstgrenzen ein',()=>{
  assert.equal(api.baseUrl('https://example.invalid/nextcloud/'),'https://example.invalid/nextcloud');
  assert.throws(()=>api.baseUrl('https://user:pwd@example.invalid'));
  assert.throws(()=>api.pathSegments('work/../secret'));
  assert.throws(()=>api.pathSegments('work/%2e%2e/secret'));
  assert.equal(api.pathSegments('Eingang/Akt 1.pdf'),'Eingang/Akt%201.pdf');
  assert.deepEqual(api.csv('CURRENCY,TIME_PERIOD,OBS_VALUE\nUSD,2026-11-25,"1.25"\n'),[{CURRENCY:'USD',TIME_PERIOD:'2026-11-25',OBS_VALUE:'1.25'}]);
});
test('unvollständige Kraken-Kerze und gefälschte Talk-Antwort',()=>{
  const [job]=api.sourcePlans('kraken',{source:'kraken',symbols:[{name:'Bitcoin',symbol:'BTC',pair:'XBTUSD',currency:'USD',category:'crypto'}]},[],ts);
  const vals=api.sourceRows(job,{error:[],result:{XXBTZUSD:[[100,1,1,1,20],[200,1,1,1,30]],last:200}});
  assert.equal(vals.rows[0].payload.price,20);
  assert.equal(vals.rows.length,1);
  const [t]=api.sourcePlans('talk',{source:'talk',baseUrl:'https://example.invalid',rooms:['abcde']},[],ts);
  assert.throws(()=>api.sourceRows(t,{ocs:{meta:{statuscode:403},data:[]}}));
});


test('Gmail-MIME ignoriert HTML und Anhänge und berücksichtigt Suchmodi',()=>{
  const full={id:'message',payload:{mimeType:'multipart/mixed',parts:[
    {mimeType:'text/plain',body:{data:Buffer.from('Prüftext').toString('base64url')}},
    {mimeType:'text/html',body:{data:'PHNjcmlwdD4'}},
    {mimeType:'text/plain',filename:'attachment.txt',body:{data:'c2VjcmV0'}}
  ]}};
  assert.deepEqual(api.gmailText(full,100),{id:'message',text:'Prüftext',truncated:false});
  assert.equal(api.gmailText(full,2).text,'');
  for(const mode of ['unread','important']){
    const [job]=api.sourcePlans('gmail',{source:'mail',labels:[],manual:{mode}},[]);
    assert.match(new URL(job.url).searchParams.get('q'),new RegExp('is:'+mode));
  }
});

test('Geplanter Monats- und Jahresbericht betrachtet abgeschlossene Zeiträume',()=>{
  assert.deepEqual(api.periods('monthly','2026-03-01T17:00:00Z',{scheduled:true}),
    {today:'2026-03-01',from:'2026-02-01',to:'2026-03-01'});
  assert.deepEqual(api.periods('yearly','2026-01-01T17:00:00Z',{scheduled:true}),
    {today:'2026-01-01',from:'2025-01-01',to:'2026-01-01'});
  assert.throws(()=>api.periods('manual','2026-01-01T17:00:00Z',{from:'2026-02-30',to:'2026-03-03'}));
});
