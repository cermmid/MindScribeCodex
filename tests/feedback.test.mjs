import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {saveVisit,getVisit} from '../work/testbuild/visits.js';
import {sendFeedback,withdrawFeedback,feedbackDetail} from '../work/testbuild/feedback.js';
function setup(){const sql=new DatabaseSync(':memory:');for(const file of ['0001_wet_deathbird.sql','0003_mighty_malice.sql'])sql.exec(readFileSync('drizzle/'+file,'utf8'));const db={prepare:q=>({bind:(...a)=>({first:async()=>sql.prepare(q).get(...a)||null,run:async()=>sql.prepare(q).run(...a),all:async()=>({results:sql.prepare(q).all(...a)})})})};return {db,sql};}
const alice={userId:'alice',email:'alice@example.test'},bob={userId:'bob',email:'bob@example.test'};
const visit=()=>({id:crypto.randomUUID(),revision:0,title:'Prywatny tytuł',transcript:'Prywatna transkrypcja',note:'Ręcznie edytowana notatka',originalNote:'Oryginalny wynik AI'});
const feedback=v=>({id:crypto.randomUUID(),visitId:v.id,revision:1,share:true,corrected:'Wersja poprawiona',comment:'Za dużo dygresji'});
test('Only explicit sharing of own saved visit creates feedback; private material never included',async()=>{
 const {db,sql}=setup(),v=visit();await saveVisit(db,alice.userId,v);const f=feedback(v);
 assert.equal(sql.prepare('SELECT count(*) n FROM feedback').get().n,0);
 await assert.rejects(sendFeedback(db,alice,{...f,share:false}));
 await assert.rejects(sendFeedback(db,bob,f),e=>e.status===409);
 await assert.rejects(sendFeedback(db,alice,{...f,revision:2}),e=>e.status===409);
 await sendFeedback(db,alice,{...f,original:'Forged original'});
 const row=await feedbackDetail(db,f.id);assert.equal(row.original,v.originalNote);assert.equal(row.original_kind,'generated');
 assert.equal(row.corrected,f.corrected);assert.equal('transcript' in row,false);assert.equal('title' in row,false);
 assert.equal((await getVisit(db,alice.userId,v.id)).note,v.note);
});
test('Retries are idempotent and later visit edits never change a shared snapshot; withdrawal owner scoped',async()=>{
 const {db,sql}=setup(),v=visit();await saveVisit(db,alice.userId,v);const f=feedback(v);await sendFeedback(db,alice,f);await sendFeedback(db,alice,f);
 assert.equal(sql.prepare('SELECT count(*) n FROM feedback').get().n,1);
 await saveVisit(db,alice.userId,{...v,revision:1,note:'Kolejna edycja',originalNote:'Kolejna generacja'});
 await sendFeedback(db,alice,f);assert.equal((await feedbackDetail(db,f.id)).original,v.originalNote);
 await withdrawFeedback(db,bob.userId,f.id);assert.ok(await feedbackDetail(db,f.id));
 await withdrawFeedback(db,alice.userId,f.id);await assert.rejects(feedbackDetail(db,f.id),e=>e.status===404);
});
test('Legacy notes use a clearly marked saved version; AI original survives ordinary editing',async()=>{
 const {db}=setup(),v=visit();await saveVisit(db,alice.userId,v);await saveVisit(db,alice.userId,{...v,revision:1,note:'Poprawiony tekst'});
 assert.equal((await getVisit(db,alice.userId,v.id)).original_note,v.originalNote);
 const old={...visit(),originalNote:null};await saveVisit(db,alice.userId,old);const f=feedback(old);await sendFeedback(db,alice,f);const row=await feedbackDetail(db,f.id);assert.equal(row.original_kind,'saved');assert.equal(row.original,old.note);
});
