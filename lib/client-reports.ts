import {AppError} from './ai';
const uuid=(v:any)=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v)?v:null;
const integer=(v:any,max:number)=>Number.isSafeInteger(v)&&v>=0&&v<=max?v:null;
const choice=(v:any,list:string[])=>list.includes(v)?v:null;
export function cleanClientReport(raw:any){
 const id=uuid(raw?.id);if(!id)throw new AppError('Nieprawidłowe ID raportu.');
 return {id,visitId:uuid(raw.visitId),jobId:uuid(raw.jobId),requestId:uuid(raw.requestId),serverRequestId:uuid(raw.serverRequestId),
  version:'18-browser-1',kind:choice(raw.kind,['HTTP_ERROR','NON_JSON','BODY_READ','NETWORK','TIMEOUT','PAGE_HIDDEN','PAGE_UNLOAD','OFFLINE','ONLINE','JOB_WAIT_PAUSED']),
  path:choice(raw.path,['/api/jobs','/api/transcribe','/api/note','/api/config','/api/visits','/api/audio','/api/feedback']),
  method:choice(raw.method,['GET','POST','DELETE']),status:integer(raw.status,599),elapsedMs:integer(raw.elapsedMs,86400000),at:integer(raw.at,9999999999999),
  contentType:choice(raw.contentType,['application/json','text/html','text/plain','other']),redirected:typeof raw.redirected==='boolean'?raw.redirected:null,
  online:typeof raw.online==='boolean'?raw.online:null,visibility:choice(raw.visibility,['visible','hidden']),
  cfRay:typeof raw.cfRay==='string'&&/^[a-f0-9]{16,32}(?:-[A-Z]{3})?$/.test(raw.cfRay)?raw.cfRay:null};
}
export async function saveClientReport(db:D1Database,user:{userId:string;email:string},raw:any){
 const d=cleanClientReport(raw);if(!d.kind)throw new AppError('Nieprawidłowy raport.');
 if(d.visitId&&!await db.prepare('SELECT id FROM visits WHERE id=? AND owner_id=?').bind(d.visitId,user.userId).first())throw new AppError('Nie znaleziono wizyty.',404);
 if(d.jobId&&!await db.prepare('SELECT id FROM processing_jobs WHERE id=? AND owner_id=? AND visit_id=?').bind(d.jobId,user.userId,d.visitId).first())d.jobId=null;
 // Idempotent retry, bounded to 100 diagnostic submissions per user/hour.
 await db.prepare('INSERT OR IGNORE INTO client_reports(id,owner_id,email,visit_id,job_id,received_at,details) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM client_reports WHERE owner_id=? AND received_at>?)<100').bind(d.id,user.userId,user.email,d.visitId,d.jobId,Date.now(),JSON.stringify(d),user.userId,Date.now()-3600000).run();
 if(!await db.prepare('SELECT id FROM client_reports WHERE id=? AND owner_id=?').bind(d.id,user.userId).first())throw new AppError('Limit raportów. Raport pozostaje w przeglądarce.',429);
}
