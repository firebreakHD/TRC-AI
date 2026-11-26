import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(join(root,p),'utf8');
const files=p=>readdirSync(p,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(join(p,x.name)):[join(p,x.name)]);
for(const path of files(root)) if(path.endsWith('.json')) JSON.parse(readFileSync(path,'utf8'));
execFileSync(process.execPath,[join(root,'scripts/build.mjs'),'--check'],{stdio:'inherit'});
const manifest=JSON.parse(read('MANIFEST.json'));
const permitted={
  'manualTrigger':[1], 'executeWorkflowTrigger':[1.1], 'scheduleTrigger':[1.3], 'code':[2], 'dataTable':[1.1],
  'httpRequest':[4.5], 'executeWorkflow':[1.3], 'xml':[1], 'emailSend':[2.1], 'errorTrigger':[1],
};
const ids=new Set(manifest.workflows.map(w=>w.id));
assert.equal(ids.size,manifest.workflows.length);
for(const f of manifest.workflows) {
  const definition=JSON.parse(read(f.path));
  assert.equal(definition.id,f.id);
  assert.equal(definition.active,false);
  assert.equal(definition.settings.timezone,'Europe/Vienna');
  assert.ok(definition.nodes.length>=3);
  const names=new Set(definition.nodes.map(n=>n.name));
  assert.equal(names.size,definition.nodes.length);
  if(definition.settings.errorWorkflow) assert.ok(ids.has(definition.settings.errorWorkflow));
  for (const [from,channels] of Object.entries(definition.connections)) {
    assert.ok(names.has(from));
    for(const lane of channels.main) for(const to of lane) assert.ok(names.has(to.node));
  }
  for(const n of definition.nodes) {
    const type=n.type.replace('n8n-nodes-base.','');
    assert.ok(permitted[type]?.includes(n.typeVersion),n.type);
    if(type==='code') new Function(n.parameters.jsCode);
    if(type==='executeWorkflow'){
      const value=n.parameters.workflowId.value;
      const ref=f.calls.find(ref=>ref.node===n.name);
      assert.equal(value,ref.optional?'={{ '+JSON.stringify(ref.targetId)+' }}':ref.targetId);
      assert.ok(ids.has(ref.targetId));
    }
    if(type==='httpRequest') {
      assert.equal(n.parameters.options.redirect.redirect.followRedirects,false);
      assert.ok(n.parameters.options.timeout>0);
      assert.equal(n.parameters.options.allowUnauthorizedCerts,undefined);
    }
    for(const cred of Object.values(n.credentials||{})) assert.deepEqual(Object.keys(cred),['name']);
  }
  assert.ok(!/BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|Bearer [A-Za-z0-9_-]{16,}|(?:ghp|sk)_[A-Za-z0-9]{24,}/.test(read(f.path)));
}
const cfg=JSON.parse(read('data-tables/config-default.json'));
assert.ok(cfg.every(c=>c.key==='addresses'||JSON.parse(c.value_json).enabled===false));
assert.ok(!manifest.workflows.some(f=>/beeper|jarvis|friday/.test(f.key)));
console.info(manifest.workflows.length+' deaktivierte Workflows, Typen, Verbindungen und JS-Syntax geprüft.');
