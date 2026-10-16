export type TestContext={visitId?:string|null;runId?:string|null;model?:string;audioBytes?:number|null;audioFormat?:string|null};
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value)?value:null;
export async function beginTest(db:D1Database,user:{userId:string;email:string;displayName:string},stage:string,provider:string,duration:string|null,context:TestContext={}) {
 const n=duration===null?NaN:Number(duration);
 const durationMs=stage==='transcribe' && Number.isFinite(n) && n>0 && n<=86400000?Math.round(n):null;
 const id=crypto.randomUUID();
 await db.prepare('INSERT INTO test_events (id,user_id,email,display_name,stage,provider,status,started_at,duration_ms,visit_id,run_id,model,audio_bytes,audio_format) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,user.userId,user.email,user.displayName,stage,provider,'pending',Date.now(),durationMs,uuid(context.visitId),uuid(context.runId),context.model??null,context.audioBytes??null,context.audioFormat??null).run();
 return id;
}
export async function finishTest(db:D1Database,id:string,status:string,elapsedMs:number|null,errorCode:number|null=null,diagnostics:Record<string,unknown>|null=null) {
 await db.prepare('UPDATE test_events SET status=?,elapsed_ms=?,error_code=?,diagnostics=? WHERE id=?').bind(status,elapsedMs,errorCode,diagnostics?JSON.stringify(diagnostics):null,id).run();
}
