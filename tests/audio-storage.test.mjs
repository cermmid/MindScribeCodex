import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {saveVisit,deleteVisit} from '../work/testbuild/visits.js';
import {saveAudio,audioRecord,listAudio,cleanupAudio} from '../work/testbuild/audio-storage.js';
async function setup(){
 const sql=new DatabaseSync(':memory:');for(const name of ['0001_wet_deathbird','0003_mighty_malice','0005_loving_hellcat'])sql.exec(readFileSync(`drizzle/${name}.sql`,'utf8'));
 const db={prepare(query){return{bind(...args){return{async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return sql.prepare(query).run(...args);}};}};}};
 const files=new Map();const bucket={async put(key,bytes){files.set(key,bytes.slice());},async head(key){return files.has(key)?{size:files.get(key).length}:null;},async delete(key){files.delete(key);}};
 const visit={id:crypto.randomUUID(),revision:0,title:'Test',transcript:'',note:''};await saveVisit(db,'alice',visit);
 const id=crypto.randomUUID(),bytes=new Uint8Array(4096).fill(7);
 const save=(owner='alice')=>saveAudio(db,bucket,owner,visit.id,id,'audio/webm',bytes,2979820);
 return {db,bucket,files,visit,id,bytes,save};
}
test('Audio persists with metadata, idempotent retries, and owner isolation',async()=>{
 const f=await setup();await assert.rejects(f.save('bob'),e=>e.status===404);assert.equal(f.files.size,0);
 await f.save();await f.save();assert.equal(f.files.size,1);assert.equal((await listAudio(f.db,'alice',f.visit.id)).length,1);
 const row=await audioRecord(f.db,'alice',f.id);assert.equal(row.duration_ms,2979820);assert.equal(row.bytes,4096);assert.equal(row.mime,'audio/webm');assert.deepEqual(f.files.get(row.object_key),f.bytes);
 await assert.rejects(audioRecord(f.db,'bob',f.id),e=>e.status===404);await assert.rejects(listAudio(f.db,'bob',f.visit.id),e=>e.status===404);
 await assert.rejects(saveAudio(f.db,f.bucket,'alice',f.visit.id,f.id,'audio/webm',new Uint8Array(99),1),e=>e.status===409);assert.deepEqual(f.files.get(row.object_key),f.bytes);
});
test('Storage failure never confirms save; retry succeeds',async()=>{
 const f=await setup(),put=f.bucket.put;f.bucket.put=async()=>{throw new Error('offline');};await assert.rejects(f.save());assert.equal((await listAudio(f.db,'alice',f.visit.id)).length,0);
 f.bucket.put=put;await f.save();assert.equal((await listAudio(f.db,'alice',f.visit.id)).length,1);
});
test('Concurrent visit deletion cannot leave an accessible or unlinked upload',async()=>{
 const f=await setup(),put=f.bucket.put;f.bucket.put=async(...args)=>{await put(...args);await deleteVisit(f.db,'alice',f.visit.id,1);};await assert.rejects(f.save(),e=>e.status===409);assert.equal(f.files.size,0);await assert.rejects(audioRecord(f.db,'alice',f.id),e=>e.status===404);
});
test('Deleted visits immediately hide audio; interrupted physical deletion retries safely',async()=>{
 const f=await setup();await f.save();await deleteVisit(f.db,'alice',f.visit.id,1);await assert.rejects(audioRecord(f.db,'alice',f.id),e=>e.status===404);
 const del=f.bucket.delete;f.bucket.delete=async()=>{throw new Error('offline');};await assert.rejects(cleanupAudio(f.db,f.bucket,'alice'));assert.equal(f.files.size,1);
 f.bucket.delete=del;await cleanupAudio(f.db,f.bucket,'alice');assert.equal(f.files.size,0);assert.equal((await f.db.prepare('SELECT * FROM visit_audio').bind().all()).results.length,0);
});
