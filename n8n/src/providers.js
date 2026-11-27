const GOOGLE = {
  gmail:'https://gmail.googleapis.com/gmail/v1/users/me',
  calendar:'https://www.googleapis.com/calendar/v3',
  tasks:'https://tasks.googleapis.com/tasks/v1',
};
const textOf = value => typeof value === 'object' && value !== null ? String(value._ ?? value['#text'] ?? '') : String(value ?? '');
const xmlField = (node, name) => Object.entries(node || {}).find(([key]) => key.split(':').pop() === name)?.[1];
const targeted = (c, field, limit = 10) => {
  const values = c[field];
  if (!Array.isArray(values) || values.length > limit || values.some(value=>!validText(value,256)))
    throw Error('Ungültige Zielliste '+field);
  return [...new Set(values)];
};
function sourcePlans(type, c, states, t = now()) {
  function entry(url, target = '', state = {}, extra = {}) {
    return {url,target,state,type,source:c.source,fetched:t,import_trc:c.importTrc===true, ...extra};
  }
  const stateFor = target => parse(states.find(row=>row.key===type+'\n'+c.source+'\n'+target)?.value_json);
  const body = c.manual || {};
  const mode = body.mode || '';
  switch (type) {
    case 'gmail': {
      const state = stateFor('mail');
      const v = body.query ?? c.query ?? 'newer_than:30d';
      if (typeof v !== 'string' || v.length > 500) throw Error('Ungültiger Gmail-Filter');
      if (mode && !['search','unread','important'].includes(mode)) throw Error('Unbekannter Gmail-Suchmodus');
      const filters={q:[v, body.unread===true||mode==='unread' ? 'is:unread' : '',
        mode==='important'?'is:important':'',
        body.category && /^\w+$/.test(body.category) ? 'category:'+body.category : ''].filter(Boolean).join(' '),
        labelIds:body.labels ? targeted(body,'labels',10) : targeted(c,'labels',10),maxResults:100};
      const sync = !mode;
      const useHistory = sync && state.historyId && c.history !== false && v==='newer_than:30d' && !filters.labelIds.length;
      return [entry(useHistory ? q(GOOGLE.gmail+'/history',{startHistoryId:state.historyId,maxResults:100}) :
        q(GOOGLE.gmail+'/messages',filters), 'mail', state,
        {sync,history:!!useHistory,fallback:q(GOOGLE.gmail+'/messages',filters),
         profile:GOOGLE.gmail+'/profile', details:GOOGLE.gmail+'/messages', snippet:c.snippet===true})];
    }
    case 'calendar': {
      if (mode==='lists') return [entry(q(GOOGLE.calendar+'/users/me/calendarList',{maxResults:100}),'lists',{}, {catalog:true})];
      const ids = targeted(c,'calendarIds',8);
      return ids.map(id=>{
        const state=stateFor(id);
        const agenda=mode==='agenda'||c.syncToken===false;
        const end = new Date(Date.parse(t)+limits(body.days??c.agendaDays,31,366)*86400000).toISOString();
        const options = agenda ? {singleEvents:true,showDeleted:false,timeMin:body.timeMin ? iso(body.timeMin,t) : earlier(t,86400000*2),timeMax:end,orderBy:'startTime',maxResults:250} :
          {singleEvents:false,showDeleted:true,maxResults:250,syncToken:state.syncToken};
        return entry(q(GOOGLE.calendar+'/calendars/'+part(id)+'/events',options),id,state,{sync:!agenda});
      });
    }
    case 'tasks': {
      if (mode==='lists') return [entry(q(GOOGLE.tasks+'/users/@me/lists',{maxResults:100}),'lists',{}, {catalog:true})];
      return targeted(c,'taskListIds',8).map(id=>{
        const state=stateFor(id);
        return entry(q(GOOGLE.tasks+'/lists/'+part(id)+'/tasks',
          {maxResults:100,showCompleted:true,showDeleted:true,showHidden:true,
           updatedMin:state.updatedMin ? earlier(state.updatedMin,300000) : ''}),id,state,{sync:true,filter:mode});
      });
    }
    case 'dav': {
      const base=baseUrl(c.baseUrl);
      if (!validText(c.user,200)) throw Error('Nextcloud-Benutzer fehlt');
      const root=base+'/remote.php/dav/files/'+part(c.user);
      return targeted(c,'directories',20).map(dir=>{
        const path=dir==='/' ? '' : pathSegments(dir);
        return entry(root+'/'+path,dir,{}, {method:'PROPFIND',root,
          maxBytes:limits(c.maxFileBytes,20971520,52428800),extensions:c.extensions || ['.md','.pdf','.docx','.xlsx','.txt'],
          exclude:c.exclude || []});
      });
    }
    case 'talk': {
      const base=baseUrl(c.baseUrl)+'/ocs/v2.php/apps/spreed/api';
      if (mode==='lists') return [entry(q(base+'/v4/room',{format:'json'}),'lists',{}, {catalog:true})];
      return targeted(c,'rooms',10).map(room=>{
        if (!/^[a-z0-9]{4,30}$/.test(room)) throw Error('Ungültiger Talk-Raum');
        const state=stateFor(room);
        return entry(q(base+'/v1/chat/'+room,{format:'json',lookIntoFuture:1,timeout:0,setReadMarker:0,
          lastKnownMessageId:state.lastKnownMessageId || 0,limit:100}),room,state,{sync:true});
      });
    }
    case 'couch':
    case 'home':
    case 'health': {
      if (type==='health') return (c.services || []).slice(0,15).map(service=>{
        if (!validText(service.name,64)) throw Error('Ungültiger Dienstname');
        return entry(baseUrl(service.url), service.name,{}, {expect:service.expect || 'http'});
      });
      const base=baseUrl(c.baseUrl);
      if (type==='couch') {
        if (!validText(c.database,200) || !/^[a-z0-9_$()+/-]+$/.test(c.database)) throw Error('CouchDB-Datenbank fehlt');
        return [entry(base+'/'+part(c.database),c.database)];
      }
      if (mode==='states') return [entry(base+'/api/states','states',{}, {catalog:true})];
      const entity=targeted(c,'entities',50);
      return entity.map(id=>{
        if (!/^\w+\.\w+$/.test(id)) throw Error('Ungültige HA-Entität');
        return entry(base+'/api/states/'+part(id),id);
      });
    }
    case 'stocks': {
      const days=limits(c.historyDays,60,730);
      return (c.symbols || []).slice(0,25).map(item=>{
        if (!/^[A-Z][A-Z0-9.]{0,14}$/.test(item.symbol)) throw Error('Ungültiges US-Aktiensymbol');
        const state=stateFor(item.symbol);
        const end=localDay(t);
        const start=localDay(earlier(t,(state.complete ? Math.min(14,days):days)*86400000));
        return entry(q('https://api.massive.com/v2/aggs/ticker/'+part(item.symbol)+'/range/1/day/'+start+'/'+end,
          {adjusted:true,sort:'asc',limit:50000}),item.symbol,state,{asset:item,currency:'USD',sync:true});
      });
    }
    case 'kraken':
      return (c.symbols || []).slice(0,16).map(item=>{
        if (!/^[A-Z0-9]{5,14}$/.test(item.pair) || !/^[A-Z]{3}$/.test(item.currency||'')) throw Error('Ungültiges Kraken-Paar');
        const state=stateFor(item.symbol);
        return entry(q('https://api.kraken.com/0/public/OHLC',{pair:item.pair,interval:1440,since:state.since}),item.symbol,state,
                     {asset:item,currency:item.currency,sync:true});
      });
    case 'ecb': {
      const curr=targeted(c,'currencies',16);
      if (!curr.length || curr.some(v=>!/^[A-Z]{3}$/.test(v))) throw Error('Ungültige EZB-Währungen');
      const since=localDay(earlier(t,limits(c.historyDays,730,3650)*86400000));
      return [entry(q('https://data-api.ecb.europa.eu/service/data/EXR/D.'+curr.join('+')+'.EUR.SP00.A',
        {startPeriod:since,format:'csvdata'}),'fx')];
    }
    case 'dealer': return [entry('https://standardbullion.com/spot-prices.json','dealer')];
    case 'metals':
    case 'metal-history': return (c.symbols || []).slice(0,4).map(item=>{
      if (!['XAU','XAG','XPT','XPD'].includes(item.symbol)) throw Error('Ungültiges Edelmetall');
      return entry(type==='metals'?'https://api.gold-api.com/price/'+item.symbol:
        q('https://standardbullion.com/api/v1/market/history',{metal:item.symbol,range:'1y'}),item.symbol,{}, {asset:item,currency:'USD'});
    });
    case 'news':
      return (c.feeds || []).slice(0,16).map(feed=>entry(baseUrl(feed.url,true),cleanId(feed.name),{},
        {category:feed.category, keywords:list(c.keywords).map(s=>str(s,100).toLowerCase()),limit:limits(c.limit,30,100)}));
    case 'research':
      return (c.topics || []).slice(0,8).map(topic=>{
        if (!validText(topic.query,500)) throw Error('Ungültiges arXiv-Thema');
        return entry(q('https://export.arxiv.org/api/query',
          {search_query:topic.query,start:0,max_results:limits(c.limit,30,100),sortBy:'submittedDate',sortOrder:'descending'}),
          cleanId(topic.name),{}, {category:topic.name,limit:limits(c.limit,30,100)});
      });
    default: throw Error('Unbekannter Anbieter');
  }
}
function sourceRows(job, body, headers = {}, code = 200) {
  const {type,source,target,fetched:t,state} = job;
  const make = (area,id,stamp,payload)=>normalized(area,source,id,stamp,payload,t);
  let rows=[], cursor=null, catalog=[];
  switch(type) {
    case 'calendar':
      if (job.catalog) catalog=list(body.items).map(it=>({id:it.id,name:it.summary,timezone:it.timeZone}));
      else if (code===410 && job.sync) cursor={};
      else {
        rows=list(body.items).map(it=>make('calendar',target+':'+it.id,it.updated,{
          title:str(it.summary),start:it.start?.dateTime||it.start?.date||null,end:it.end?.dateTime||it.end?.date||null,
          allDay:!!it.start?.date,calendar:target,status:it.status,recurrence:it.recurrence||[],
          originalStart:it.originalStartTime?.dateTime||it.originalStartTime?.date||null,
          recurringId:it.recurringEventId||null,timezone:it.start?.timeZone||null,link:it.htmlLink||null}));
        if (job.sync && body.nextSyncToken) cursor={syncToken:body.nextSyncToken};
      }
      break;
    case 'tasks':
      if (job.catalog) catalog=list(body.items).map(it=>({id:it.id,name:it.title}));
      else {
        rows=list(body.items).filter(it=>!job.filter||job.filter==='completed'&&it.status==='completed'||
          job.filter==='open'&&it.status==='needsAction'||['due','overdue'].includes(job.filter)&&it.status==='needsAction'&&it.due&&
          (job.filter==='due'?it.due.slice(0,10)===localDay(t):it.due.slice(0,10)<localDay(t)))
          .map(it=>make('tasks',target+':'+it.id,it.updated,{title:str(it.title),state:it.status,deleted:it.deleted===true,
            list:target,due:it.due?.slice(0,10)||null,completed:it.completed||null,link:it.webViewLink||null}));
        if (!job.filter) cursor={updatedMin:t};
      }
      break;
    case 'talk': {
      if (code===304) break;
      if (!Array.isArray(body.ocs?.data) || ![100,200].includes(Number(body.ocs?.meta?.statuscode)))
        throw Error('Ungültige Talk-OCS-Antwort');
      if (job.catalog) catalog=body.ocs.data.map(it=>({token:it.token,name:it.displayName}));
      else {
        rows=body.ocs.data.filter(it=>it.id!=null && it.messageType!=='system').map(it=>make('messenger',target+':'+it.id,
          date(Number(it.timestamp)*1000),{room:target,actor:str(it.actorDisplayName,150),text:str(it.message,2500),
          type:it.messageType,mentioned:it.isMentioned===true}));
        const offset=Math.max(Number(state.lastKnownMessageId)||0, Number(headers['x-chat-last-given'])||0,
          ...body.ocs.data.map(it=>Number(it.id)||0));
        cursor={lastKnownMessageId:offset};
      }
      break;
    }
    case 'dav': {
      const multi=xmlField(body,'multistatus');
      if (!multi) throw Error('Ungültige WebDAV-Antwort');
      const rootPath=new URL(job.root).pathname;
      rows=list(xmlField(multi,'response')).flatMap(item=>{
        const href=textOf(xmlField(item,'href'));
        const url=new URL(href,job.root);
        if (url.origin!==new URL(job.root).origin || !url.pathname.startsWith(rootPath+'/')) return [];
        const path=decodeURIComponent(url.pathname.slice(rootPath.length+1));
        if (!path || path.endsWith('/') || job.exclude.some(s=>path.startsWith(s))) return [];
        const properties=list(xmlField(item,'propstat')).find(row=>textOf(xmlField(row,'status')).includes(' 200 '));
        const prop=xmlField(properties,'prop');
        if (!prop || xmlField(xmlField(prop,'resourcetype'),'collection')!=null) return [];
        const size=Number(textOf(xmlField(prop,'getcontentlength')));
        const etag=textOf(xmlField(prop,'getetag'));
        if (!Number.isFinite(size)||size<0||size>job.maxBytes||!etag||!job.extensions.some(ext=>path.toLowerCase().endsWith(ext.toLowerCase()))) return [];
        return [{
          key:sha('dav\n'+source+'\n'+path),area:'documents',source,external_id:cleanId(path),
          observed_at:iso(textOf(xmlField(prop,'getlastmodified')),t),
          payload:{path,etag,size,mime:textOf(xmlField(prop,'getcontenttype')),type:'document-metadata'},
        }];
      });
      break;
    }
    case 'couch':
      if (typeof body.db_name!=='string'||body.update_seq==null) throw Error('Ungültiger CouchDB-Status');
      rows=[make('notifications','obsidian:'+target,t,{title:'CouchDB erreichbar',database:body.db_name,
        documentCount:body.doc_count,sequence:str(body.update_seq,200),status:'available'})]; break;
    case 'home':
      if (job.catalog) catalog=list(body).map(item=>({entity:item.entity_id,state:item.state}));
      else if (body.entity_id===target) rows=[make('notifications','ha:'+target,body.last_updated,
        {title:target,state:str(body.state),status:'available'})];
      else throw Error('HA-Entität fehlt');
      break;
    case 'stocks':
      if (!['OK','DELAYED'].includes(body.status)||body.next_url) throw Error('Massive-Daten unvollständig oder Tarif nicht freigegeben');
      rows=list(body.results).flatMap(it=>market(job,it.c,date(it.t), 'daily-close'));
      if (rows.length) cursor={complete:true}; break;
    case 'kraken': {
      if (list(body.error).length || !body.result) throw Error('Kraken-OHLC fehlgeschlagen');
      const candle=Object.entries(body.result).find(([key])=>key!=='last')?.[1];
      if (!Array.isArray(candle)) throw Error('Kraken-Paar fehlt');
      rows=candle.slice(0,-1).flatMap(it=>market(job,it[4], date(Number(it[0])*1000), 'daily-close'));
      if (body.result.last!=null) cursor={since:body.result.last}; break;
    }
    case 'ecb':
      rows=csv(String(body)).filter(it=>it.CURRENCY && it.TIME_PERIOD).flatMap(it=>
        market({...job,asset:{symbol:it.CURRENCY,name:'EZB '+it.CURRENCY,category:'fx'},currency:'EUR'},it.OBS_VALUE,date(it.TIME_PERIOD),'reference-fx'));
      break;
    case 'metals':
      if (body.symbol !== target) throw Error('Gold API lieferte ein anderes Symbol');
      rows=market(job,body.price,date(body.updatedAt)||date(body.timestamp),'spot'); break;
    case 'metal-history': {
      if (body.metal!==target || !Array.isArray(body.points) || !body.attribution) throw Error('Standard-Bullion-Historie ungültig');
      rows=body.points.flatMap(it=>market({...job,attribution:body.attribution},it.price,date(it.t),'daily-close'));
      break;
    }
    case 'dealer': {
      if (!Array.isArray(body.metals)||!body.attribution) throw Error('Händlerfeed ungültig');
      rows=body.metals.flatMap(item=>{
        const stamp=date(body.updated)||date(item.updated);
        const base={...job,asset:{symbol:item.symbol,name:item.name,category:'metal',exchange:'Standard Bullion'},currency:'USD',attribution:body.attribution};
        return ['bid','ask'].flatMap(side=>market({...base,asset:{...base.asset,symbol:item.symbol+'-'+side}},
          item[side],stamp,'dealer-'+side));
      });
      break;
    }
    case 'news':
    case 'research': {
      const feed=xmlField(body,'feed') || xmlField(xmlField(body,'rss'),'channel');
      if (!feed) throw Error('Ungültiger RSS- oder Atom-Feed');
      const entries=list(xmlField(feed,'entry')||xmlField(feed,'item'));
      for (const item of entries.slice(0,job.limit)) {
        const title=str(textOf(xmlField(item,'title')));
        const link=list(xmlField(item,'link')).find(link=> (link?.$?.rel||'alternate')==='alternate');
        const rawLink=link?.$?.href||textOf(link);
        if (!/^https?:\/\/[^\s]+$/.test(rawLink)||!title) continue;
        const description=str(textOf(xmlField(item,'summary')||xmlField(item,'description')),500);
        const terms=list(job.keywords).filter(term=>(title+' '+description).toLowerCase().includes(term));
        if (job.keywords?.length && !terms.length) continue;
        const stamp=date(textOf(xmlField(item,'published')||xmlField(item,'pubDate')||xmlField(item,'updated')));
        const stable=sha(rawLink.split('#')[0]);
        rows.push(make(type==='news'?'news':'research',stable,stamp||t,
          {title,url:rawLink,description,publishedAt:stamp,fetchedAt:t,category:job.category||target,match:terms,feed:target}));
      }
      break;
    }
    default: throw Error('Unbekannte Antwort');
  }
  return {rows,cursor,catalog};
}
function market(job, raw, timestamp, quality) {
  const price=Number(raw);
  if (raw===''||!Number.isFinite(price)||price<=0||!timestamp) return [];
  const item=job.asset;
  const fetched=job.fetched;
  const status=quality==='daily-close'||quality==='reference-fx' ? 'reference' :
    Date.parse(fetched)-Date.parse(timestamp)>3600000 ? 'stale' : 'recent';
  return [normalized('market-prices',job.source,item.symbol+':'+timestamp,timestamp,
    {symbol:item.symbol,name:item.name,category:item.category,group:item.group||null,price,
     currency:job.currency,unit:item.category==='metal'?'troy-ounce':item.category==='fx'?'units-per-eur':'unit',
     exchange:item.exchange||null,timestamp,fetchedAt:fetched,source:job.source,attribution:job.attribution||null,quality,status},fetched)];
}
function gmailRows(job, reply) {
  const headers=Object.fromEntries(list(reply.payload?.headers).map(row=>[String(row.name).toLowerCase(),row.value]));
  const labels=list(reply.labelIds);
  const received=reply.internalDate ? date(Number(reply.internalDate)) : null;
  const attachmentCount=(function count(part){
    return Number(!!part?.body?.attachmentId)+list(part?.parts).reduce((total,child)=>total+count(child),0);
  })(reply.payload);
  if (!reply.id) throw Error('Gmail-Nachricht ohne Kennung');
  return normalized('emails',job.source,reply.id,job.fetched,{title:str(headers.subject),receivedAt:received,
    from:str(headers.from,180),labels,unread:labels.includes('UNREAD'),important:labels.includes('IMPORTANT')||labels.includes('STARRED'),
    attachmentCount,snippet:job.snippet?str(reply.snippet,600):null,thread:reply.threadId||null},job.fetched);
}


function gmailText(message, maxBytes) {
  let remaining=maxBytes;
  const fragments=[];
  function visit(part,depth) {
    if (!part || depth>20 || remaining<=0) return;
    if (part.mimeType==='text/plain' && !part.filename && typeof part.body?.data==='string') {
      const encoded=part.body.data;
      if (encoded.length<=Math.ceil(remaining/3)*4 && /^[A-Za-z0-9_=-]+$/.test(encoded)) {
        const raw=Buffer.from(encoded,'base64url');
        if (raw.length<=remaining) {
          fragments.push(raw.toString('utf8'));
          remaining-=raw.length;
        }
      }
    }
    for (const child of list(part.parts).slice(0,100)) visit(child,depth+1);
  }
  visit(message.payload,0);
  return {id:String(message.id),text:fragments.join(String.fromCharCode(10)),truncated:!fragments.length};
}
