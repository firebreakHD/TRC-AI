/* Shared functions embedded in n8n Code nodes by scripts/build.mjs. */
const crypto = require('crypto');
const {URL} = require("url");
const AREAS = new Set(['emails', 'calendar', 'tasks', 'messenger', 'market-prices', 'news', 'research', 'reports', 'notifications']);
const TZ = 'Europe/Vienna';
const OUT = values => values.map(json => ({json}));
const objects = items => items.map(item => item.json);
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const str = (value, limit = 300) => String(value ?? '').slice(0, limit);
const date = value => {
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value)) value += 'T00:00:00Z';
  if (typeof value === "string" && !/(?:Z|[+-]\d\d:\d\d|GMT|UTC)$/i.test(value)) {
    if (/^\d{4}-\d\d-\d\dT/.test(value)) return null;
  }
  const t = new Date(value);
  return value != null && Number.isFinite(t.getTime()) ? t.toISOString() : null;
};
const earlier = (t, ms) => new Date(Date.parse(t) - ms).toISOString();
const now = () => new Date().toISOString();
const localDay = value => new Intl.DateTimeFormat('en-CA', {timeZone:TZ, year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(value));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function uuid(content) {
  const h = sha(content);
  return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);
}
const iso = (value, fallback) => date(value) || fallback;
const cleanId = value => {
  const id = String(value ?? '');
  if (!id || /[\u0000-\u001f]/u.test(id)) throw Error('Ungültige externe ID');
  return id.length <= 256 ? id : sha(id);
};
const sourceId = (key, config) => {
  const name = (config.source || key).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) throw Error('Ungültige Quellkennung');
  return name;
};
const bytes = value => Buffer.byteLength(value, 'utf8');
const parse = (value, defaultValue = {}) => typeof value === 'string' && value.length ? JSON.parse(value) : value ?? defaultValue;
const escaped = value => str(value, 10000).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validText = (s, max = 500) => typeof s === 'string' && s.length > 0 && s.length <= max && !/[\r\n\0]/.test(s);
const part = value => encodeURIComponent(String(value));
const limits = (v, fallback, max) => {
  if (v == null) return fallback;
  if (!Number.isInteger(v) || v < 1 || v > max) throw Error('Ungültiges Limit');
  return v;
};
function baseUrl(s, external = false) {
  if (typeof s !== 'string') throw Error('Dienstadresse fehlt');
  const u = new URL(s);
  if ((external ? u.protocol !== 'https:' : !['https:','http:'].includes(u.protocol)) || u.username || u.password || u.search || u.hash)
    throw Error('Ungültige Dienstadresse');
  return u.toString().replace(/\/+$/, '');
}
const q = (url, fields) => {
  const u = new URL(url);
  for (const [key, value] of Object.entries(fields)) if (value !== '' && value != null) {
    for (const item of list(value)) u.searchParams.append(key, String(item));
  }
  return u.toString();
};
const normalized = (area, source, externalId, updated, payload, fetched = now()) => {
  if (!AREAS.has(area)) throw Error('Unbekannter Datenbereich');
  return {key:sha(area+'\n'+source+'\n'+cleanId(externalId)),area,source,external_id:cleanId(externalId),
          observed_at:iso(updated,fetched),payload};
};
function batches(records, t = now()) {
  const groups = new Map();
  for (const record of records) {
    if (!AREAS.has(record.area)) throw Error('Unbekannter Importbereich');
    const key = record.area+'\n'+record.source;
    if (!groups.has(key)) groups.set(key, new Map());
    const unique = groups.get(key);
    const old = unique.get(record.external_id);
    if (!old || record.observed_at > old.observed_at) unique.set(record.external_id, record);
  }
  const out = [];
  for (const [group, unique] of groups) {
    const [area, source] = group.split('\n');
    let buffer = [];
    function emit() {
      const body = JSON.stringify({source, records:buffer});
      const key = uuid(area+'\n'+body);
      out.push({key,area,source,body,status:'pending',attempts:0,next_at:t,finished_at:'',error:''});
      buffer = [];
    }
    for (const {external_id, observed_at, payload} of unique.values()) {
      const row = {external_id,observed_at,payload};
      if (bytes(JSON.stringify({source,records:[row]})) > 512*1024) throw Error('Einzelner Datensatz überschreitet 512 KiB');
      if (buffer.length === 100 || bytes(JSON.stringify({source,records:[...buffer,row]})) > 512*1024) emit();
      buffer.push(row);
    }
    if (buffer.length) emit();
  }
  return out;
}
function retry(row, statusCode, retryAfter, t = now(), maxAttempts = 4) {
  const attempts = Number(row.attempts) + 1;
  let status = 'dead';
  let next_at = '';
  let finished_at = t;
  let error = statusCode ? 'http_'+statusCode : 'transport';
  if (statusCode >= 200 && statusCode < 300) {
    status = 'sent';
    error = '';
  } else if ((!statusCode || [408,425,429].includes(statusCode) || (statusCode >= 500 && statusCode <= 599))
             && attempts < maxAttempts) {
    status = 'pending';
    const seconds = /^\d+$/.test(String(retryAfter ?? '')) ? Number(retryAfter) :
      Math.max(0, (Date.parse(retryAfter) - Date.parse(t))/1000 || 0);
    const ms = Math.max([5,15,45,180,600][Math.min(attempts-1,4)]*1000, Math.min(seconds,86400)*1000);
    next_at = new Date(Date.parse(t)+ms).toISOString();
    finished_at = '';
  }
  return {id:row.id,key:row.key,status,attempts,next_at,finished_at,error};
}
function httpResult(item) {
  const data = item?.json || {};
  const code = Number(data.statusCode) || 0;
  return {code, headers:data.headers || {}, body:Object.hasOwn(data,'body')?data.body:data.data};
}
function configFrom(row, key, manual = {}) {
  if (row.key !== key) return null;
  const config = parse(row.value_json);
  if (config.enabled !== true) return null;
  return {...config, source:sourceId(key, config), manual};
}
function assertOk(result, service, allowed = []) {
  if (result.code < 200 || result.code >= 300) {
    if (!allowed.includes(result.code)) throw Error(service+' HTTP '+(result.code || 'Transportfehler'));
  }
}
function csv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i=0; i<text.length; i++) {
    const ch = text[i];
    if (quoted && ch === '"' && text[i+1] === '"') {field += '"'; i++;}
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {row.push(field); field = '';}
    else if (ch === '\n' && !quoted) {row.push(field.replace(/\r$/,'')); rows.push(row); row=[]; field='';}
    else field += ch;
  }
  if (quoted) throw Error('CSV-Feld nicht geschlossen');
  if (field || row.length) rows.push([...row,field.replace(/\r$/,'')]);
  const head = rows.shift() || [];
  return rows.filter(row => row.length===head.length).map(row => Object.fromEntries(row.map((value,i)=>[head[i],value])));
}
function pathSegments(path) {
  const parts = String(path).split('/').filter(Boolean);
  if (!parts.length || parts.length > 20 || parts.some(p=>!validText(p,200)||p==='.'||p==='..'||p.includes('\\')||p.includes('%')))
    throw Error('Ungültiger Datei- oder Ordnerpfad');
  return parts.map(part).join('/');
}
