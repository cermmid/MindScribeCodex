import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
import {createJob,advanceJob,getJob,jobView} from '../work/testbuild/jobs.js';
import {cleanClientReport,saveClientReport} from '../work/testbuild/client-reports.js';
import {inspectInteraction} from '../work/testbuild/background-ai.js';
const user={userId:'owner',email:'test@example.test',displayName:'Tester'};
const visit='11111111-1111-4111-8111-111111111111';
function setup(){const sql=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));
 sql.prepare('INSERT INTO visits(id,owner_id,title,transcript,note,created_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?)').run(visit,'owner','Synthetic','','',1,1,1);
 const statement=(q,args=[])=>({bind:(...a)=>statement(q,a),run:async()=>sql.prepare(q).run(...args),first:async()=>sql.prepare(q).get(...args)||null,all:async()=>({results:sql.prepare(q).all(...args)})});
 const DB={prepare:statement,batch:async(stmts)=>{sql.exec('BEGIN');try{const results=[];for(const s of stmts)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,env:{DB,BUCKET:{},GEMINI_API_KEY:'test-key',NOTE_MODEL:'gemini-3.8-flash'}};
}
const input=()=>({id:crypto.randomUUID(),visitId:visit,stage:'note',transcript:'Synthetic private sentence'});
const completed={id:'v1_synthetic',status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'Synthetic result'}]}],usage:{total_input_tokens:10,total_output_tokens:5,total_thought_tokens:0,total_tokens:15}};
async function fetchMock(fn,run){const original=globalThis.fetch;globalThis.fetch=fn;try{await run();}finally{globalThis.fetch=original;}}

test('Durable job completes after browser return; repeated polls never repeat generation and diagnostics exclude content',async()=>{
 const {sql,env}=setup();const data=input();const job=await createJob(env,user,data);let submissions=0,retrievals=0;
 await fetchMock(async(url,init)=>{if(init.method==='DELETE')return new Response(null,{status:204});if(init.method==='POST'){submissions++;const body=JSON.parse(init.body);assert.equal(body.background,true);assert.equal(body.store,true);assert.equal(body.generation_config.max_output_tokens,30000);return Response.json({id:'v1_synthetic',status:'in_progress'});}retrievals++;return Response.json(completed);},async()=>{
  const running=await advanceJob(env,user,job.id);assert.equal(running.state,'running');assert.equal(submissions,1);
  // Same request and second tab resume the existing job even with a fresh request ID.
  assert.equal((await createJob(env,user,data)).id,job.id);assert.equal((await createJob(env,user,{...data,id:crypto.randomUUID()})).id,job.id);
  sql.prepare('UPDATE processing_jobs SET lease_until=0 WHERE id=?').run(job.id);
  const finished=await advanceJob(env,user,job.id);assert.equal(finished.state,'succeeded');assert.equal(jobView(finished).result.note,'Synthetic result');
  await advanceJob(env,user,job.id);assert.equal(submissions,1);assert.equal(retrievals,1);
  const event=sql.prepare('SELECT * FROM test_events WHERE id=?').get(job.id);assert.equal(event.status,'success');assert.equal(JSON.parse(event.diagnostics).usage.totalTokens,15);
  const diagnostics=JSON.stringify(sql.prepare('SELECT details FROM processing_steps').all())+event.diagnostics;assert.ok(!diagnostics.includes('Synthetic private'));assert.ok(!diagnostics.includes('Synthetic result'));assert.ok(!diagnostics.includes('test-key'));
  assert.ok(sql.prepare("SELECT id FROM processing_steps WHERE phase='provider_submit_started'").get());assert.ok(sql.prepare("SELECT id FROM processing_steps WHERE phase='provider_accepted'").get());
 });
});
test('Unknown submission outcome is durable, blocks automatic duplicate charge and does not fake success',async()=>{
 const {env}=setup();const j=await createJob(env,user,input());let calls=0;
 await fetchMock(async()=>{calls++;throw new TypeError('private upstream message');},async()=>{assert.equal((await advanceJob(env,user,j.id)).state,'uncertain');assert.equal((await advanceJob(env,user,j.id)).state,'uncertain');assert.equal(calls,1);});
});
test('Worker stopped before submission receipt is reported as uncertain after lease expiry',async()=>{
 const {env,sql}=setup();const j=await createJob(env,user,input());sql.prepare("UPDATE processing_jobs SET state='submitting',lease_until=1 WHERE id=?").run(j.id);
 const result=await advanceJob(env,user,j.id);assert.equal(result.state,'uncertain');assert.equal(JSON.parse(result.diagnostics).technicalMessage,'SUBMISSION_OUTCOME_UNKNOWN');
});
test('Temporary status fetch error is recoverable and never resubmits generation',async()=>{
 const {env,sql}=setup();const j=await createJob(env,user,input());let sends=0,polls=0;
 await fetchMock(async(url,init)=>{if(init.method==='POST'){sends++;return Response.json({id:'v1_synthetic',status:'in_progress'});}if(init.method==='DELETE')return new Response(null,{status:204});if(++polls===1)return new Response('gateway',{status:502});return Response.json(completed);},async()=>{
  await advanceJob(env,user,j.id);sql.prepare('UPDATE processing_jobs SET lease_until=0').run();assert.equal((await advanceJob(env,user,j.id)).state,'running');sql.prepare('UPDATE processing_jobs SET lease_until=0').run();assert.equal((await advanceJob(env,user,j.id)).state,'succeeded');assert.equal(sends,1);
 });
});
test('Ownership, deleted visits and changed input cannot resume or replace another job',async()=>{
 const {env,sql}=setup();const d=input();const j=await createJob(env,user,d);
 await assert.rejects(getJob(env.DB,'other',j.id),e=>e.status===404);await assert.rejects(createJob(env,user,{...d,transcript:'changed'}),e=>e.status===409);
 sql.prepare('DELETE FROM visits').run();await assert.rejects(getJob(env.DB,user.userId,j.id),e=>e.status===404);
});
test('Incomplete, empty and unrecognized provider outputs are rejected with distinct structured status',()=>{
 for(const status of ['incomplete','failed','cancelled','private string']){const d={};assert.throws(()=>inspectInteraction({...completed,status},'gemini-3.8-flash',d));assert.equal(d.interaction.status,status==='private string'?'unknown':status);}
 assert.throws(()=>inspectInteraction({...completed,steps:[]},'gemini-3.8-flash',{}),e=>e.diagnostics.technicalMessage==='INTERACTION_EMPTY_TEXT');
});
test('Client reports are strict metadata, owner-scoped and idempotent',async()=>{
 const {env,sql}=setup();const raw={id:crypto.randomUUID(),visitId:visit,kind:'NON_JSON',path:'/api/jobs',status:502,contentType:'text/html',message:'PATIENT',body:'PATIENT',headers:{cookie:'SECRET'},cfRay:'abcd1234abcd1234'};
 assert.ok(!JSON.stringify(cleanClientReport(raw)).includes('PATIENT'));await saveClientReport(env.DB,user,raw);await saveClientReport(env.DB,user,raw);assert.equal(sql.prepare('SELECT count(*) AS n FROM client_reports').get().n,1);
 await assert.rejects(saveClientReport(env.DB,{...user,userId:'other'},raw),e=>e.status===404);
});


test('Persisted provider handle recovers after worker crash without a second submission',async()=>{
 const {env,sql}=setup();const j=await createJob(env,user,input());
 sql.prepare("UPDATE processing_jobs SET state='submitting',provider_id='v1_synthetic',lease_until=1 WHERE id=?").run(j.id);
 let submissions=0;
 await fetchMock(async(url,init)=>{if(init.method==='POST')submissions++;if(init.method==='DELETE')return new Response(null,{status:204});return Response.json(completed);},async()=>{assert.equal((await advanceJob(env,user,j.id)).state,'succeeded');assert.equal(submissions,0);});
});

test('Diagnostic feed excludes clinical fields, paginates and sees updated jobs',async()=>{
 const {diagnosticFeed,safeDiagnostics}=await import('../work/testbuild/diagnostic-feed.js');
 const {env,sql}=setup();const j=await createJob(env,user,input());
 const report=await diagnosticFeed(env.DB,{stream:'jobs',limit:1});assert.equal(report.records.length,1);
 assert.ok(!JSON.stringify(report).includes('Synthetic private'));assert.ok(!('input' in report.records[0]));
 assert.deepEqual(safeDiagnostics({secret:'KEY',transcript:'PATIENT',response:{promptFeedback:{blockReason:'OTHER'},text:'PATIENT'}}),{response:{promptFeedback:{blockReason:'OTHER'}}});
 assert.equal((await diagnosticFeed(env.DB,{stream:'jobs',...report.next})).records.length,0);
 sql.prepare('UPDATE processing_jobs SET updated_at=updated_at+1 WHERE id=?').run(j.id);
 assert.equal((await diagnosticFeed(env.DB,{stream:'jobs',...report.next})).records.length,1);
 await assert.rejects(diagnosticFeed(env.DB,{stream:'visits'}));
});
