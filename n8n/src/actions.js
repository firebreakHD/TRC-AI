const mailAddress = value => /^[^\s<>(),;:\"@]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(String(value||''));
const bodyText = value => typeof value==='string'&&value.length>0&&value.length<=28000&&!value.includes('\0');
const actions = {'gmail-write':['send','draft'],'calendar-write':['create','update','delete'],
  'tasks-write':['create','update','complete'],'talk-write':['send'],'ha-write':['service'],'dav-export':['put'],'smtp-write':['send']};
function authorizedId(value,c,key) {
  if (!validText(value,256)||!list(c[key]).includes(value)) throw Error('Ziel ist nicht freigegeben');
  return value;
}
function mailPayload(action,data,c) {
  const to=authorizedId(data.to,c,'recipients');
  if (!mailAddress(to)||!validText(data.subject,150)||!bodyText(data.text)) throw Error('Ungültige E-Mail-Parameter');
  const words=Array.from(data.subject);
  const subject=[];
  for (let i=0;i<words.length;i+=10) subject.push('=?UTF-8?B?'+Buffer.from(words.slice(i,i+10).join('')).toString('base64')+'?=');
  const encoded=Buffer.from(data.text).toString('base64').match(/.{1,76}/g).join('\r\n');
  const mime=['To: '+to,'Subject: '+subject.join('\r\n '),'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64','',encoded].join('\r\n');
  const raw=Buffer.from(mime).toString('base64url');
  return action==='draft'?{message:{raw}}:{raw};
}
function prepareAction(name,c,data) {
  if (c.writesEnabled!==true || data.confirm!==true) throw Error('Explizite Schreibfreigabe erforderlich');
  if (!validText(data.requestId,120)||!actions[name]?.includes(data.action)||!list(c.actions).includes(data.action))
    throw Error('Aktion oder Anforderungs-ID ungültig');
  const {action}=data;
  let method='POST',url='',content={};
  switch(name) {
    case 'gmail-write':
      url=GOOGLE.gmail+(action==='send'?'/messages/send':'/drafts'); content=mailPayload(action,data,c); break;
    case 'smtp-write':
      mailPayload(action,data,c);
      if (!mailAddress(c.from)) throw Error('SMTP-Absender fehlt');
      content={from:c.from,to:data.to,subject:data.subject,text:data.text}; break;
    case 'calendar-write': {
      url=GOOGLE.calendar+'/calendars/'+part(authorizedId(data.calendarId,c,'calendarIds'))+'/events';
      if (action!=='create') {if (!validText(data.eventId,256)) throw Error('Termin-ID fehlt'); url+='/'+part(data.eventId);}
      if (action==='delete') method='DELETE';
      else {
        method=action==='update'?'PATCH':'POST';
        if (!validText(data.title,300)) throw Error('Termintitel fehlt');
        const start=date(data.start),end=date(data.end),allDay=data.allDay===true;
        if (!start||!end||end<=start) throw Error('Ungültiger Terminzeitraum');
        if (allDay&&![data.start,data.end].every(d=>/^\d{4}-\d\d-\d\d$/.test(d))) throw Error('Ganztägige Termine brauchen Datumswerte');
        content={summary:data.title,start:allDay?{date:data.start}:{dateTime:start,timeZone:TZ},
          end:allDay?{date:data.end}:{dateTime:end,timeZone:TZ},...(data.description?{description:str(data.description,4000)}:{})};
        if (list(data.recurrence).length>10||list(data.recurrence).some(rule=>!validText(rule,300)||!/^RRULE:/.test(rule))) throw Error('Ungültige Serienregel');
        if (data.recurrence) content.recurrence=list(data.recurrence);
      }
      url=q(url,{sendUpdates:'none'}); break;
    }
    case 'tasks-write': {
      url=GOOGLE.tasks+'/lists/'+part(authorizedId(data.taskListId,c,'taskListIds'))+'/tasks';
      if (action!=='create') {method='PATCH'; if (!validText(data.taskId,256)) throw Error('Aufgaben-ID fehlt'); url+='/'+part(data.taskId);}
      if (action==='complete') content={status:'completed'};
      else {
        if (!validText(data.title,300)) throw Error('Aufgabentitel fehlt');
        content={title:data.title,...(data.notes?{notes:str(data.notes,4000)}:{})};
        if (data.due) {
          if (!/^\d{4}-\d\d-\d\d$/.test(data.due)||!date(data.due)) throw Error('Aufgabenfälligkeit muss ein Datum sein');
          content.due=date(data.due);
        }
      }
      break;
    }
    case 'talk-write': {
      const target=authorizedId(data.room,c,'rooms');
      if (!/^[a-z0-9]{4,30}$/.test(target)||!bodyText(data.text)||data.text.length>8000) throw Error('Ungültige Talk-Nachricht');
      url=baseUrl(c.baseUrl)+'/ocs/v2.php/apps/spreed/api/v1/chat/'+target+'?format=json';
      content={message:data.text}; break;
    }
    case 'ha-write': {
      const service=authorizedId(data.service,c,'services');
      if (!/^\w+\.\w+$/.test(service)) throw Error('Ungültiger HA-Dienst');
      const [domain,verb]=service.split('.');
      const payload=data.payload||{};
      if (typeof payload!=='object'||Array.isArray(payload)||bytes(JSON.stringify(payload))>8192) throw Error('Ungültige Serviceparameter');
      if (domain==='notify') {
        if (Object.keys(payload).some(key=>!['message','title'].includes(key))||!bodyText(payload.message)) throw Error('Nur Titel und Nachricht sind bei Notify freigegeben');
      } else {
        if (Object.keys(payload).some(key=>!['entity_id','brightness','temperature','hvac_mode','value'].includes(key))) throw Error('Unzulässige HA-Parameter');
        if (!list(payload.entity_id).length) throw Error('Entitäts-Allowlist erforderlich');
        list(payload.entity_id).forEach(id=>authorizedId(id,c,'entities'));
      }
      url=baseUrl(c.baseUrl)+'/api/services/'+domain+'/'+verb; content=payload; break;
    }
    case 'dav-export': {
      const directory=c.directory?.replace(/^\/+|\/+$/g,'');
      if (!validText(c.user,200)||!validText(directory,500)||!bodyText(data.text)||
          !/^[A-Za-z0-9_-]{1,80}\.md$/.test(data.filename)) throw Error('Ungültiger Markdown-Export');
      url=baseUrl(c.baseUrl)+'/remote.php/dav/files/'+part(c.user)+'/'+pathSegments(directory)+'/'+part(data.filename);
      method='PUT'; content=data.text; break;
    }
  }
  return {url,method,content,channel:name,key:sha(name+'\n'+data.requestId),digest:sha(JSON.stringify({url,method,content})),requestId:data.requestId};
}
function deliveryOutcome(name,result) {
  if (name==='talk-write'&&result.code>=200&&result.code<300&&
      (![100,200,201].includes(Number(result.body?.ocs?.meta?.statuscode))||!result.body?.ocs?.data?.id))
    return {status:'uncertain',error:'unbestätigte_ocs_antwort'};
  if (result.code>=200&&result.code<300) return {status:'sent',error:''};
  if ([400,401,403,404,405,409,412,415,422].includes(result.code)) return {status:'rejected',error:'http_'+result.code};
  return {status:'uncertain',error:result.code?'http_'+result.code:'transport'};
}
