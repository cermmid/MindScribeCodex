import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync('public/transport.js','utf8');
function setup(fetch,shared=new Map()){
 const listeners={};const document={visibilityState:'visible',addEventListener:(name,fn)=>listeners[name]=fn};const navigator={onLine:false};
 const context=vm.createContext({window:{addEventListener:(name,fn)=>listeners[name]=fn},document,navigator,localStorage:{getItem:key=>shared.get(key),setItem:(key,value)=>shared.set(key,value)},Date,crypto,AbortController,fetch,setTimeout,clearTimeout,console});vm.runInContext(code,context);return {t:context.window.MindScribeTransport,shared,navigator,listeners};
}
test('HTML HTTP 502 report preserves status, type, IDs and excludes body; persisted report survives reload and reconnect',async()=>{
 const first=setup(async()=>new Response('<html>PRIVATE BODY</html>',{status:502,headers:{'content-type':'text/html','cf-ray':'abcd1234abcd1234','x-request-id':'11111111-1111-4111-8111-111111111111'}}));
 await assert.rejects(first.t.request('/api/jobs',{method:'POST'},{visitId:'22222222-2222-4222-8222-222222222222'}),/HTTP: 502/);
 const stored=first.shared.get('mindscribe-diagnostics-v18');assert.ok(!stored.includes('PRIVATE'));const row=JSON.parse(stored)[0];assert.equal(row.kind,'NON_JSON');assert.equal(row.status,502);assert.equal(row.contentType,'text/html');assert.equal(row.cfRay,'abcd1234abcd1234');
 let sent;const second=setup(async(url,init)=>{sent=JSON.parse(init.body);return Response.json({saved:true});},first.shared);second.navigator.onLine=true;await second.t.flush();assert.equal(sent.id,row.id);assert.equal(JSON.parse(first.shared.get('mindscribe-diagnostics-v18')).length,0);
});
test('Failed telemetry delivery keeps report queued; network absence remains unknown HTTP',async()=>{
 const {t,shared,navigator}=setup(async()=>{throw new TypeError('PRIVATE');});await assert.rejects(t.request('/api/jobs'),/brak odpowiedzi/);navigator.onLine=true;await t.flush();const rows=JSON.parse(shared.get('mindscribe-diagnostics-v18'));assert.equal(rows.length,1);assert.equal(rows[0].kind,'NETWORK');assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
});
test('Body stream interruption is distinguished from bad JSON and preserves received HTTP',async()=>{
 const {t,shared}=setup(async()=>new Response(new ReadableStream({start(c){c.error(new Error('PRIVATE'));}}),{status:200}));await assert.rejects(t.request('/api/jobs'),/HTTP: 200/);assert.equal(JSON.parse(shared.get('mindscribe-diagnostics-v18'))[0].kind,'BODY_READ');
});
test('Hidden page, offline and unload events share job ID and survive storage',()=>{
 const {t,listeners,shared}=setup(async()=>Response.json({}));t.setContext({visitId:'v',jobId:'j'});listeners.offline();listeners.pagehide();const rows=JSON.parse(shared.get('mindscribe-diagnostics-v18'));assert.deepEqual(rows.map(x=>x.kind),['OFFLINE','PAGE_UNLOAD']);assert.ok(rows.every(x=>x.jobId==='j'));
});

test('Editing input after a completed job creates a new job instead of a permanent 409',async()=>{
 const shared=new Map([['mindscribe-jobs-v18',JSON.stringify({'visit:note':'old-job'})]]);let creates=0;
 const {t}=setup(async(path,options)=>{
  if(!options.method)return Response.json({job:{id:'old-job',visitId:'visit',state:'succeeded',result:{note:'old'}}});
  const data=JSON.parse(options.body);
  if(data.id==='old-job')return Response.json({error:'Different input'},{status:409});
  creates++;return Response.json({job:{id:data.id,visitId:'visit',state:'succeeded',result:{note:'updated'}}});
 },shared);
 assert.equal((await t.run({visitId:'visit',stage:'note',transcript:'new synthetic input'})).note,'updated');assert.equal(creates,1);
});
test('Changed input cannot replace a running job or start a duplicate generation',async()=>{
 const shared=new Map([['mindscribe-jobs-v18',JSON.stringify({'visit:note':'old-job'})]]);let creates=0;
 const {t}=setup(async(path,options)=>{
  if(!options.method)return Response.json({job:{id:'old-job',visitId:'visit',state:'running'}});
  if(JSON.parse(options.body).id!=='old-job')creates++;
  return Response.json({error:'Different input'},{status:409});
 },shared);
 await assert.rejects(t.run({visitId:'visit',stage:'note',transcript:'changed'}),/Different input/);assert.equal(creates,0);
});
