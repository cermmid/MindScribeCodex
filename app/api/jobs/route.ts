import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {sameOrigin} from '../../../lib/access';
import {AppError} from '../../../lib/ai';
import {json} from '../../../lib/http';
import {readJsonBody} from '../../../lib/request-body';
import {getVisit} from '../../../lib/visits';
import {createJob,getJob,jobView,advanceJob,checkpoint,type JobEnv} from '../../../lib/jobs';
export const dynamic='force-dynamic';
async function handle(request:Request){
 const requestId=crypto.randomUUID();
 try{
  const user=await getChatGPTUser();if(!user)throw new AppError('Zaloguj się przez ChatGPT.',401);
  const settings=env as unknown as JobEnv;const q=new URL(request.url).searchParams;
  if(request.method==='GET'){
   if(q.has('id'))return json({job:jobView(await getJob(settings.DB,user.userId,q.get('id')!))},200,{'X-Request-Id':requestId});
   const id=q.get('visitId')!;await getVisit(settings.DB,user.userId,id);
   const rows=(await settings.DB.prepare('SELECT * FROM processing_jobs WHERE owner_id=? AND visit_id=? ORDER BY created_at DESC LIMIT 20').bind(user.userId,id).all()).results;
   return json({jobs:rows.map(jobView)},200,{'X-Request-Id':requestId});
  }
  sameOrigin(request);
  if(q.has('id')){
   const job=await getJob(settings.DB,user.userId,q.get('id')!);
   if(q.get('action')==='retry-uncertain'){
    const data=await readJsonBody(request);if(data.confirm!==true||job.state!=='uncertain')throw new AppError('Brak potwierdzenia ponowienia.',409);
    await checkpoint(settings,job,'uncertain_retry_authorized',{source:'user_action',possibleDuplicateChargeAcknowledged:true});
    await settings.DB.batch([settings.DB.prepare("UPDATE processing_jobs SET state='failed',input=NULL WHERE id=? AND state='uncertain'").bind(job.id),settings.DB.prepare("UPDATE test_events SET status='failure',error_code=409,elapsed_ms=? WHERE id=?").bind(Date.now()-job.created_at,job.event_id)]);
    return json({released:true},200,{'X-Request-Id':requestId});
   }
   const client=request.headers.get('x-client-request-id'),ray=request.headers.get('cf-ray');
   await settings.DB.prepare('INSERT INTO processing_steps(id,job_id,at,phase,details) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),job.id,Date.now(),'client_status_request',JSON.stringify({serverRequestId:requestId,clientRequestId:client&&/^[a-f0-9-]{36}$/.test(client)?client:null,cfRay:ray&&/^[a-zA-Z0-9-]{1,80}$/.test(ray)?ray:null})).run();
   return json({job:jobView(await advanceJob(settings,user,job.id))},200,{'X-Request-Id':requestId});
  }
  return json({job:jobView(await createJob(settings,user,await readJsonBody(request)))},202,{'X-Request-Id':requestId});
 }catch(e){return json({error:(e instanceof AppError?e.message:'Błąd obsługi zadania.')+' ID żądania: '+requestId,diagnosticId:requestId},e instanceof AppError?e.status:500,{'X-Request-Id':requestId});}
}
export const GET=handle,POST=handle;
