import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {listVisits,getVisit,saveVisit,deleteVisit} from '../work/testbuild/visits.js';
function database(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('drizzle/0001_wet_deathbird.sql','utf8'));
  sqlite.exec(readFileSync('drizzle/0003_mighty_malice.sql','utf8'));
  return {prepare(sql){return{bind(...args){return{async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return{results:sqlite.prepare(sql).all(...args)};}};}};}};
}
const input=(title='Test')=>({id:crypto.randomUUID(),revision:0,title,transcript:'Fikcyjny tekst rozmowy.',note:'Fikcyjne podsumowanie.'});
test('History is isolated by authenticated owner for list, read, write and delete',async()=>{
  const db=database(),visit=input();await saveVisit(db,'alice',visit);
  assert.equal((await listVisits(db,'alice')).length,1);
  assert.equal((await listVisits(db,'bob')).length,0);
  await assert.rejects(getVisit(db,'bob',visit.id),e=>e.status===404);
  await assert.rejects(saveVisit(db,'bob',{...visit,revision:1,note:'stolen'}),e=>e.status===409);
  await assert.rejects(saveVisit(db,'bob',visit),e=>e.status===409);
  await assert.rejects(deleteVisit(db,'bob',visit.id,1),e=>e.status===409);
  assert.equal((await getVisit(db,'alice',visit.id)).note,visit.note);
});
test('Lost-response retries are idempotent; stale writes do not overwrite newer text',async()=>{
  const db=database(),visit=input();
  const saved=await saveVisit(db,'alice',visit);
  assert.equal((await saveVisit(db,'alice',visit)).revision,saved.revision);
  assert.equal((await listVisits(db,'alice')).length,1);
  const next={...visit,revision:1,note:'Poprawiono tekst.'};
  assert.equal((await saveVisit(db,'alice',next)).revision,2);
  assert.equal((await saveVisit(db,'alice',next)).revision,2);
  await assert.rejects(saveVisit(db,'alice',{...next,note:'Starsza karta.'}),e=>e.status===409);
  await assert.rejects(deleteVisit(db,'alice',visit.id,1),e=>e.status===409);
  await deleteVisit(db,'alice',visit.id,2);
  await assert.rejects(getVisit(db,'alice',visit.id),e=>e.status===404);
  await assert.rejects(saveVisit(db,'alice',{...next,revision:2}),e=>e.status===409);
});
test('Missing identity and invalid payloads cannot create history',async()=>{
  const db=database(),visit=input();
  await assert.rejects(saveVisit(db,'',visit),e=>e.status===401);
  await assert.rejects(listVisits(db,''),e=>e.status===401);
  await assert.rejects(saveVisit(db,'alice',{...visit,title:' '}));
  await assert.rejects(saveVisit(db,'alice',{...visit,note:'x'.repeat(200001)}));
  assert.equal((await listVisits(db,'alice')).length,0);
});
