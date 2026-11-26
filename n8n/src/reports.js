function periods(kind,t,{from,to,scheduled=false}={}) {
  const today=localDay(t),[y,m,d]=today.split('-').map(Number);
  const stamp=Date.UTC(y,m-1,d), cut=ms=>new Date(ms).toISOString().slice(0,10);
  const week=stamp-((new Date(stamp).getUTCDay()+6)%7)*86400000;
  if (kind==='manual' && (from||to)) {
    const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&date(value)?.slice(0,10)===value;
    if (!day(from)||!day(to)||from>=to||Date.parse(to)-Date.parse(from)>366*86400000) throw Error('Ungültiger Berichtszeitraum');
    return {today,from,to};
  }
  if (scheduled&&kind==='monthly') return {today,from:cut(Date.UTC(y,m-2,1)),to:cut(Date.UTC(y,m-1,1))};
  if (scheduled&&kind==='yearly') return {today,from:(y-1)+'-01-01',to:y+'-01-01'};
  return {today,from:kind==='weekly'?cut(week):kind==='monthly'?today.slice(0,7)+'-01':kind==='yearly'?y+'-01-01':today,
    to:kind==='weekly'?cut(week+7*86400000):kind==='monthly'?cut(Date.UTC(y,m,1)):kind==='yearly'?cut(Date.UTC(y+1,0,1)):cut(stamp+86400000)};
}
function marketSummary(data,t) {
  const candidates=data.filter(it=>it.timestamp&&Number(it.price)>0);
  const fx=Object.groupBy(candidates.filter(it=>it.category==='fx'),it=>it.symbol);
  function eur(row) {
    const day=localDay(row.timestamp);
    if (row.currency==='EUR') return {value:row.price,day};
    const match=(fx[row.currency]||[]).filter(it=>it.timestamp.slice(0,10)<=day).sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp))[0];
    if (!match||Date.parse(day)-Date.parse(match.timestamp)>7*86400000) return null;
    return {value:row.price/match.price,day:match.timestamp.slice(0,10)};
  }
  const groups=Object.groupBy(candidates.filter(it=>it.category!=='fx'),it=>it.source+'\n'+it.symbol);
  return Object.values(groups).map(series=>{
    series.sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp));
    const current=series[0],currency=eur(current),changes={};
    const priorMonth=count=>{
      const ts=new Date(current.timestamp),day=ts.getUTCDate();
      ts.setUTCDate(1);
      ts.setUTCMonth(ts.getUTCMonth()-count);
      const last=new Date(Date.UTC(ts.getUTCFullYear(),ts.getUTCMonth()+1,0)).getUTCDate();
      ts.setUTCDate(Math.min(day,last));
      return ts.toISOString();
    };
    const comparisons={day:earlier(current.timestamp,86400000),week:earlier(current.timestamp,7*86400000),
      month:priorMonth(1),year:priorMonth(12)};
    for (const [name,limit] of Object.entries(comparisons)) {
      const last=series.find(row=>Date.parse(row.timestamp)<=Date.parse(limit));
      const historical=last?eur(last):null;
      changes[name]=last?{at:last.timestamp,absolute:current.price-last.price,pct:100*(current.price/last.price-1),
        eurAbsolute:currency&&historical?currency.value-historical.value:null,eurPct:currency&&historical?100*(currency.value/historical.value-1):null}:null;
    }
    return {...current,eur:currency?.value??null,fxDate:currency?.day??null,
      eurPerGram:current.unit==='troy-ounce'&&currency?currency.value/31.1034768:null,
      ageHours:(Date.parse(t)-Date.parse(current.timestamp))/3600000,changes};
  });
}
function asSnapshot(rows) {
  return rows.filter(row=>row.area&&row.payload_json).map(row=>({area:row.area,source:row.source,record:parse(row.payload_json)}));
}
function makeReport(kind,c,data,t=now()) {
  const p=periods(kind,t,{from:c.manual?.from,to:c.manual?.to,scheduled:c.scheduled}),of=area=>data.filter(x=>x.area===area).map(x=>x.record);
  const day=s=>s&&(s.length===10?s:date(s)?localDay(s):'');
  const title=x=>str(x.title||x.name||x.symbol,300);
  const eventLine=x=>(x.start.length===10?x.start:new Intl.DateTimeFormat('de-AT',{timeZone:TZ,dateStyle:'short',timeStyle:'short'}).format(new Date(x.start)))+' · '+title(x);
  const events=of('calendar').filter(x=>x.status!=='cancelled'&&day(x.start)).sort((a,b)=>a.start.localeCompare(b.start));
  const tasks=of('tasks').filter(x=>!x.deleted&&x.state==='needsAction');
  const market=marketSummary(of('market-prices'),t);
  const show=x=>{
    const n=(v,d=2)=>new Intl.NumberFormat('de-AT',{maximumFractionDigits:d}).format(v);
    const change=x.changes.day;
    return x.symbol+' · '+n(x.price,4)+' '+x.currency+(x.unit==='troy-ounce'?' je Feinunze':'')+
      (x.eur!=null?' · '+n(x.eur)+' EUR':'')+(x.eurPerGram!=null?' · '+n(x.eurPerGram,4)+' EUR/g':'')+
      (change?' · Δ '+n(change.absolute,4)+' '+x.currency+' ('+n(change.pct)+' %)':'')+
      ' · '+x.source+' · '+x.timestamp.slice(0,10)+' · '+x.quality+(x.attribution?' · '+x.attribution:'');
  };
  const link=x=>title(x)+' · '+x.url;
  const recent=x=>!x.publishedAt || x.publishedAt>=earlier(t,Math.max(14,Math.ceil((Date.parse(p.to)-Date.parse(p.from))/86400000))*86400000);
  const sections={
    calendar:[['Termine im Zeitraum',events.filter(x=>day(x.start)>=p.from&&day(x.start)<p.to).map(eventLine)],
              ['Kommende Termine',events.filter(x=>day(x.start)>p.today&&day(x.start)<localDay(earlier(t,-8*86400000))).map(eventLine)]],
    tasks:[['Offene Aufgaben',tasks.map(x=>title(x)+(x.due?' · '+x.due:''))],
           ['Fällig und überfällig',tasks.filter(x=>x.due&&x.due<=p.today).map(x=>x.due+' · '+title(x))]],
    emails:[['Wichtige ungelesene E-Mails',of('emails').filter(x=>x.important&&x.unread).map(x=>title(x)+' · '+str(x.from,100))]],
    talk:[['Wichtige Talk-Nachrichten',of('messenger').filter(x=>x.mentioned||list(c.importantRooms).includes(x.room)).map(x=>str(x.actor,150)+' · '+str(x.text,300))]],
    metals:[['Gold und Silber',market.filter(x=>x.category==='metal').map(show)]],
    tech:[['Technologieaktien',market.filter(x=>x.group==='tech').map(show)]],
    ai:[['KI-Aktien',market.filter(x=>x.group==='ai').map(show)]],
    quantum:[['Quantum-Aktien',market.filter(x=>x.group==='quantum').map(show)]],
    crypto:[['Kryptowährungen',market.filter(x=>x.category==='crypto').map(show)]],
    news:[['KI- und Technologiemeldungen',of('news').filter(x=>x.category!=='quantum'&&recent(x)).map(link)]],
    quantumNews:[['Quantum-Meldungen',of('news').filter(x=>x.category==='quantum'&&recent(x)).map(link)]],
    research:[['Wissenschaftliche Veröffentlichungen',of('research').filter(recent).map(link)]],
    system:[['Systemmeldungen',of('notifications').filter(x=>x.title!=='TRC-AI').map(x=>title(x)+' · '+str(x.status||x.state,50))],
      ['TRC-AI',of('notifications').filter(x=>x.title==='TRC-AI').map(x=>title(x)+' · '+str(x.status,50))]],
  };
  const explicit={market:['metals','tech','ai','quantum','crypto'],system:['system'],ai:['news','ai','research'],quantum:['quantumNews','quantum','research']};
  const order=list(c.sections).length?c.sections:explicit[kind]||Object.keys(sections),max=limits(c.maxRows,12,60);
  const groups=order.flatMap(key=>sections[key]||[]).map(([title,lines])=>({title,items:[...new Set(lines)].slice(0,max)}));
  const label={daily:'Tagesbericht',weekly:'Wochenbericht',monthly:'Monatsbericht',yearly:'Jahresbericht',
    market:'Marktbericht',system:'Systembericht',ai:'KI-News-Bericht',quantum:'Quantum-Bericht',manual:'Manueller Bericht'}[kind];
  if (!label) throw Error('Unbekannter Berichtstyp');
  const missing='Keine Daten vorhanden.';
  const text=groups.map(section=>section.title+'\n'+(section.items.join('\n')||missing)).join('\n\n');
  const md=groups.map(section=>'## '+section.title+'\n\n'+(section.items.length?section.items.map(x=>'- '+escaped(x).replace(/[\r\n]/g,' ')).join('\n'):missing)).join('\n\n');
  const html='<!doctype html><meta charset="utf-8"><h1>'+escaped(label)+'</h1>'+groups.map(s=>
    '<h2>'+escaped(s.title)+'</h2><ul>'+(s.items.length?s.items:[missing]).map(x=>'<li>'+escaped(x)+'</li>').join('')+'</ul>').join('');
  return {title:label,period:{from:p.from,to:p.to,zone:TZ},sections:groups,text:label+'\n\n'+text,markdown:'# '+label+'\n\n'+md,html,
    market:['market','manual'].includes(kind)?market.slice(0,100):undefined,generatedAt:t};
}
