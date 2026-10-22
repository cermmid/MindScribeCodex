import {AppError,MAX_AUDIO,promptHash,type Settings} from './ai';
import {audioRecord} from './audio-storage';
import {getVisit,visitId} from './visits';
import {consume} from './access';
import {submitInteraction,retrieveInteraction,inspectInteraction,deleteInteraction} from './background-ai';
export type JobEnv=Settings&{DB:D1Database;BUCKET:R2Bucket};
type User={userId:string;email:string;displayName:string};
const active=['queued','preparing','submitting','running','polling','uncertain'];
export async function getJob(db:D1Database,owner:string,id:string){
 const job=await db.prepare('SELECT j.* FROM processing_jobs j JOIN visits v ON v.id=j.visit_id AND v.owner_id=j.owner_id WHERE j.id=? AND j.owner_id=?').bind(visitId(id),owner).first<any>();
 if(!job)throw new AppError('Nie znaleziono zadania na Twoim koncie.',404);return job;
}
export const jobView=(j:any)=>({id:j.id,visitId:j.visit_id,stage:j.stage,state:j.state,updatedAt:j.updated_at,error:j.error,...(j.state==='succeeded'?{result:j.stage==='transcribe'?{transcript:j.result}:{note:j.result}}:{})});
export async function checkpoint(env:JobEnv,j:any,phase:string,details:Record<string,any>={}){
 const now=Date.now(),d={...JSON.parse(j.diagnostics),...details,diagnosticSchema:3,appVersion:'18-background-1',jobId:j.id,diagnosticId:j.id.slice(0,8),pipelinePhase:phase,lastCheckpointAt:now};
 j.diagnostics=JSON.stringify(d);
 await env.DB.batch([
  env.DB.prepare('INSERT INTO processing_steps(id,job_id,at,phase,details) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),j.id,now,phase,JSON.stringify(details)),
  env.DB.prepare('UPDATE processing_jobs SET diagnostics=?,updated_at=? WHERE id=?').bind(j.diagnostics,now,j.id),
  env.DB.prepare('UPDATE test_events SET diagnostics=? WHERE id=?').bind(j.diagnostics,j.event_id)
 ]);
}
export async function createJob(env:JobEnv,user:User,data:any){
 const id=visitId(data.id),visit=visitId(data.visitId);await getVisit(env.DB,user.userId,visit);
 const stage=data.stage;if(!['transcribe','note'].includes(stage))throw new AppError('Nieprawidłowy etap.');
 let audio:any=null,input='';
 if(stage==='transcribe'){audio=await audioRecord(env.DB,user.userId,data.audioId);if(audio.visit_id!==visit)throw new AppError('Nagranie należy do innej wizyty.',409);}
 else{input=data.transcript;if(typeof input!=='string'||!input.trim()||input.length>200000)throw new AppError('Nieprawidłowa transkrypcja.',422);}
 const hash=await promptHash(stage==='transcribe'?audio.id:input),now=Date.now(),model=stage==='transcribe'?(env.TRANSCRIPTION_MODEL||'gemini-3.8-flash'):(env.NOTE_MODEL||'gemini-3.8-flash');
 const d=JSON.stringify({diagnosticSchema:3,appVersion:'18-background-1',jobId:id,diagnosticId:id.slice(0,8),pipelinePhase:'queued',aiPhase:'not_started',automaticRetries:0});
 await env.DB.batch([
  env.DB.prepare('INSERT OR IGNORE INTO processing_jobs(id,owner_id,visit_id,event_id,stage,state,audio_id,input,input_hash,model,created_at,updated_at,lease_until,diagnostics) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,?)').bind(id,user.userId,visit,id,stage,'queued',audio?.id??null,input,hash,model,now,now,d),
  env.DB.prepare("INSERT OR IGNORE INTO test_events(id,user_id,email,display_name,stage,provider,status,started_at,duration_ms,visit_id,run_id,model,audio_bytes,audio_format,diagnostics) SELECT id,owner_id,?,?,stage,'gemini','pending',created_at,?,visit_id,id,model,?,?,diagnostics FROM processing_jobs WHERE id=? AND owner_id=?").bind(user.email,user.displayName,audio?.duration_ms??null,audio?.bytes??null,audio?.mime??null,id,user.userId)
 ]);
 let job=await env.DB.prepare('SELECT * FROM processing_jobs WHERE id=? AND owner_id=?').bind(id,user.userId).first<any>();
 if(!job)job=await env.DB.prepare("SELECT * FROM processing_jobs WHERE owner_id=? AND visit_id=? AND stage=? AND state IN ('queued','preparing','submitting','running','polling','uncertain')").bind(user.userId,visit,stage).first<any>();
 if(!job||job.input_hash!==hash||job.visit_id!==visit||job.stage!==stage)throw new AppError('Inne zadanie tej wizyty jest już w toku. Otwórz je z historii.',409);
 return job;
}
async function finish(env:JobEnv,j:any,state:string,text:string|null,error:string|null,code:number,d:Record<string,any>){
 await checkpoint(env,j,state,d);
 await env.DB.batch([
  env.DB.prepare('UPDATE processing_jobs SET state=?,result=?,error=?,input=NULL,lease_until=0 WHERE id=?').bind(state,text,error,j.id),
  env.DB.prepare('UPDATE test_events SET status=?,elapsed_ms=?,error_code=?,diagnostics=? WHERE id=?').bind(state==='succeeded'?'success':'failure',Date.now()-j.created_at,code,j.diagnostics,j.event_id)
 ]);
}
export async function advanceJob(env:JobEnv,user:User,id:string){
 let j=await getJob(env.DB,user.userId,id);const now=Date.now();
 if(['succeeded','failed'].includes(j.state))return j;
 if(j.state==='uncertain')return j;
 if(['preparing','submitting'].includes(j.state)&&j.lease_until<now&&j.provider_id){
  await env.DB.prepare("UPDATE processing_jobs SET state='running',lease_until=0 WHERE id=? AND provider_id IS NOT NULL AND lease_until<?").bind(j.id,now).run();j=await getJob(env.DB,user.userId,id);
 }
 if(['preparing','submitting'].includes(j.state)&&j.lease_until<now){
  const message='Przerwano przyjmowanie zadania. Nie wiadomo, czy Gemini je przyjęło. Nie powtórzono płatnego wywołania. Kod: '+j.id.slice(0,8)+'.';
  await env.DB.prepare("UPDATE processing_jobs SET state='uncertain',error=? WHERE id=? AND state IN ('preparing','submitting') AND lease_until<?").bind(message,j.id,now).run();
  await checkpoint(env,j,'submission_outcome_unknown',{technicalMessage:'SUBMISSION_OUTCOME_UNKNOWN',source:'job_watchdog',userMessage:message});return getJob(env.DB,user.userId,id);
 }
 const submitting=j.state==='queued';
 const claimed=await env.DB.prepare("UPDATE processing_jobs SET state=?,lease_until=? WHERE id=? AND (state='queued' OR (state IN ('running','polling') AND lease_until<?)) RETURNING *").bind(submitting?'preparing':'polling',now+45000,j.id,now).first<any>();
 if(!claimed)return j;j=claimed;
 const d:Record<string,any>={};
 try{
  let raw:any;
  if(submitting){
   await checkpoint(env,j,'audio_or_text_read');
   let bytes:Uint8Array|null=null,mime:string|null=null;
   if(j.stage==='transcribe'){
    const audio=await audioRecord(env.DB,user.userId,j.audio_id);const stored=await env.BUCKET.get(audio.object_key);
    if(!stored)throw new AppError('Brak zapisanego nagrania.',404);if(stored.size>MAX_AUDIO)throw new AppError('Nagranie przekracza 24 MB.',413);
    bytes=new Uint8Array(await stored.arrayBuffer());mime=audio.mime;
    await checkpoint(env,j,'audio_loaded',{savedAudioId:audio.id,audioBytesRead:bytes.length});
   }
   await checkpoint(env,j,'quota_check');await consume(env.DB,user.userId,j.stage==='transcribe'?'audio':'note');
   await env.DB.prepare("UPDATE processing_jobs SET state='submitting' WHERE id=?").bind(j.id).run();
   await checkpoint(env,j,'provider_submit_started',{request:{model:j.model,background:true,store:true,timeoutMs:20000,maxOutputTokens:30000}});
   raw=await submitInteraction(env,j.model,j.stage,j.input,bytes,mime,d);
   // Save the provider handle before interpreting any returned output.
   await env.DB.prepare("UPDATE processing_jobs SET provider_id=?,input=NULL WHERE id=?").bind(raw.id,j.id).run();j.provider_id=raw.id;
   await checkpoint(env,j,'provider_accepted',d);
  }else{
   await checkpoint(env,j,'provider_status_requested');raw=await retrieveInteraction(env,j.provider_id,d);
   await checkpoint(env,j,'provider_status_received',d);
  }
  const result=inspectInteraction(raw,j.model,d);
  if(result.status==='completed'){
   await finish(env,j,'succeeded',j.stage==='note'?result.text!.replace(/\s+/gu,' ').trim():result.text,null,200,d);
   try{const deleted=await deleteInteraction(env,j.provider_id);await checkpoint(env,j,'provider_cleanup',{providerDeleted:deleted});}catch{await checkpoint(env,j,'provider_cleanup',{providerDeleted:false});}
  }else{
   await checkpoint(env,j,'provider_running',d);
   await env.DB.prepare("UPDATE processing_jobs SET state='running',lease_until=? WHERE id=?").bind(Date.now()+2000,j.id).run();
  }
 }catch(error){
  const detail=error instanceof AppError?error.diagnostics:{};
  Object.assign(d,detail,{source:detail.source||'job',exceptionType:error instanceof AppError?'AppError':'InternalError'});
  if(!submitting&&(!d.upstreamStatus||d.upstreamStatus===429||d.upstreamStatus>=500)&&!d.interaction){
   await checkpoint(env,j,'poll_failed_retryable',{...d,technicalMessage:'STATUS_POLL_FAILED_NO_NEW_GENERATION'});
   await env.DB.prepare("UPDATE processing_jobs SET state='running',lease_until=? WHERE id=?").bind(Date.now()+5000,j.id).run();
  }else if(submitting&&!j.provider_id&&JSON.parse(j.diagnostics).pipelinePhase==='provider_submit_started'&&(!d.upstreamStatus||d.upstreamStatus>=500||d.upstreamStatus===200)){
   const message='Nie potwierdzono przyjęcia zadania przez Gemini. Aby uniknąć podwójnego kosztu, nie ponowiono go automatycznie. Kod: '+j.id.slice(0,8)+'.';
   await checkpoint(env,j,'submission_outcome_unknown',{...d,technicalMessage:'SUBMISSION_OUTCOME_UNKNOWN',userMessage:message});
   await env.DB.prepare("UPDATE processing_jobs SET state='uncertain',error=?,lease_until=0 WHERE id=?").bind(message,j.id).run();
  }else{
   const message=(error instanceof AppError?error.message:'Błąd obsługi zadania na serwerze.')+' Kod zadania: '+j.id.slice(0,8)+'.';
   await finish(env,j,'failed',null,message,error instanceof AppError?error.status:500,{...d,userMessage:message});
  }
 }
 return getJob(env.DB,user.userId,id);
}

export async function cleanupJobData(env:JobEnv,owner:string){
 const rows=(await env.DB.prepare('SELECT id,provider_id FROM processing_jobs WHERE owner_id=? AND NOT EXISTS(SELECT 1 FROM visits WHERE visits.id=processing_jobs.visit_id AND visits.owner_id=processing_jobs.owner_id)').bind(owner).all()).results as any[];
 for(const row of rows){
  await env.DB.prepare("UPDATE processing_jobs SET input=NULL,result=NULL,state='deleted' WHERE id=?").bind(row.id).run();
  if(row.provider_id){try{if(await deleteInteraction(env,row.provider_id))await env.DB.prepare('UPDATE processing_jobs SET provider_id=NULL WHERE id=?').bind(row.id).run();}catch{console.error('job_provider_cleanup_pending');}}
 }
}
