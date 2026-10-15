import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {measureUsage,COST_COLUMNS} from '../work/testbuild/usage.js';
import {redact} from '../work/testbuild/ai.js';
const now=Date.parse('2026-10-15T12:00:00Z');
const raw={promptTokenCount:10000,cachedContentTokenCount:2000,candidatesTokenCount:1000,thoughtsTokenCount:500,totalTokenCount:11500};
test('Uses API counts, discounts cached input once and includes thinking in output price',()=>{
 const u=measureUsage({...raw,patient:'secret'},'gemini-3.8-flash',now);
 assert.equal(u.estimateUsd,(8000*.75+2000*.075+1500*3.75)/1e6);
 assert.equal(u.totalTokens,11500);assert.equal(JSON.stringify(u).includes('secret'),false);
});
test('Unknown/malformed/incomplete usage, unsupported prices and expired rate never become zero cost',()=>{
 assert.equal(measureUsage(null,'gemini-3.8-flash',now),null);
 for(const [r,m,t] of [[{},'gemini-3.8-flash',now],[{...raw,totalTokenCount:99999},'gemini-3.8-flash',now],[raw,'unknown',now],[raw,'gemini-3.8-flash',Date.parse('2027-01-01')],[{...raw,serviceTier:'PRIORITY'},'gemini-3.8-flash',now]])assert.equal(measureUsage(r,m,t).estimateUsd,null);
});
test('API accounting is captured even when model response is unusable',async()=>{
 const previous=globalThis.fetch;let captured;
 globalThis.fetch=async()=>Response.json({usageMetadata:raw,candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'partial'}]}}]});
 try{await assert.rejects(redact({GEMINI_API_KEY:'test',NOTE_MODEL:'gemini-3.8-flash'},'fictional',(r,m)=>captured=measureUsage(r,m,now)));assert.equal(captured.totalTokens,11500);assert.ok(captured.estimateUsd>0);}finally{globalThis.fetch=previous;}
});
test('Totals include retries and failed generations with usage, while unknown attempts remain separate',()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync('drizzle/0002_curly_wendigo.sql','utf8'));db.exec(readFileSync('drizzle/0004_past_hex.sql','utf8'));
 const usage=measureUsage(raw,'gemini-3.8-flash',now);
 for(const [id,status,diagnostics] of [['one','success',{usage}],['two','failure',{usage}],['three','failure',null]])db.prepare('INSERT INTO test_events(id,user_id,email,display_name,stage,provider,status,started_at,diagnostics) VALUES(?,?,?,?,?,?,?,?,?)').run(id,'owner','test@example.test','Test','transcribe','gemini',status,now,diagnostics?JSON.stringify(diagnostics):null);
 const row=db.prepare('SELECT '+COST_COLUMNS+' FROM test_events').get();assert.equal(row.attempts,3);assert.equal(row.measured,2);assert.equal(row.priced,2);assert.equal(row.tokens,23000);assert.equal(row.estimated_usd,usage.estimateUsd*2);
});
