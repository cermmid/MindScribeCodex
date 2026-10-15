import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {isAdmin} from '../work/testbuild/admin.js';
import {beginTest,finishTest} from '../work/testbuild/test-events.js';
test('Admin access fails closed for anonymous, other users and missing configuration',()=>{
 const settings={ADMIN_EMAIL:'owner@example.test'};
 assert.equal(isAdmin(null,settings),false);
 assert.equal(isAdmin({email:'tester@example.test',isAdmin:true},settings),false);
 assert.equal(isAdmin({email:'owner@example.test.evil'},settings),false);
 assert.equal(isAdmin({email:'owner@example.test'},{}),false);
 assert.equal(isAdmin({email:'OWNER@example.test'},settings),true);
});
test('Events retain unfinished attempts, count retries and exclude content; invalid durations remain unknown',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync('drizzle/0002_curly_wendigo.sql','utf8'));sql.exec(readFileSync('drizzle/0004_past_hex.sql','utf8'));
 const db={prepare:q=>({bind:(...args)=>({run:async()=>sql.prepare(q).run(...args)})})};
 const user={userId:'a',email:'a@example.test',displayName:'Tester'};
 const id=await beginTest(db,user,'transcribe','gemini','120000');
 await finishTest(db,id,'success',15000);
 const retry=await beginTest(db,user,'transcribe','gemini','Infinity');await finishTest(db,retry,'failure',2000,502);
 await beginTest(db,{...user,userId:'b'},'note','gemini',null);
 const rows=sql.prepare('SELECT * FROM test_events ORDER BY rowid').all();
 assert.equal(rows.length,3);assert.equal(rows[0].duration_ms,120000);assert.equal(rows[0].elapsed_ms,15000);
 assert.equal(rows[1].duration_ms,null);assert.equal(rows[1].error_code,502);assert.equal(rows[2].status,'pending');
 assert.equal(rows[2].user_id,'b');assert.equal('transcript' in rows[0],false);
 // Execute exactly the aggregation used by the admin endpoint, against real SQLite.
 const source=readFileSync('app/api/admin/route.ts','utf8');const query=source.match(/prepare\(`([\s\S]*?)`\)/)[1];
 const summary=sql.prepare(query).all().find(r=>r.user_id==='a');
 assert.equal(summary.audio_attempts,2);assert.equal(summary.successes,1);assert.equal(summary.failures,1);assert.equal(summary.unknown_durations,1);assert.equal(summary.audio_ms,120000);
});

test('Diagnostic records retain user message, original HTTP status, model, audio metadata and attempt linkage',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync('drizzle/0002_curly_wendigo.sql','utf8'));sql.exec(readFileSync('drizzle/0004_past_hex.sql','utf8'));
 const db={prepare:q=>({bind:(...args)=>({run:async()=>sql.prepare(q).run(...args)})})};
 const user={userId:'tester',email:'tester@example.test',displayName:'Tester'};
 const visitId=crypto.randomUUID(),runId=crypto.randomUUID();
 const context={visitId,runId,model:'test-flash',audioBytes:19297901,audioFormat:'audio/webm'};
 const id=await beginTest(db,user,'transcribe','gemini','2979820',context);
 const details={diagnosticId:'321e410d',upstreamStatus:524,userMessage:'Gemini — HTTP 524. Kod: 321e410d.',exceptionType:'UpstreamHttpError'};
 await finishTest(db,id,'failure',128075,502,details);
 await beginTest(db,user,'transcribe','gemini','2979820',context);
 const rows=sql.prepare('SELECT * FROM test_events WHERE user_id=? AND run_id=?').all(user.userId,runId);
 assert.equal(rows.length,2);const failed=rows.find(r=>r.id===id);assert.equal(failed.visit_id,visitId);assert.equal(failed.model,'test-flash');assert.equal(failed.audio_bytes,19297901);
 assert.equal(failed.error_code,502);assert.deepEqual(JSON.parse(failed.diagnostics),details);
});
