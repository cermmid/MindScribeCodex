import {AppError,MAX_AUDIO} from './ai';
import {getVisit,visitId} from './visits';
export async function audioRecord(db:D1Database,owner:string,id:string){
 if(!owner)throw new AppError('Zaloguj się.',401);
 const row=await db.prepare('SELECT a.* FROM visit_audio a JOIN visits v ON v.id=a.visit_id AND v.owner_id=a.owner_id WHERE a.id=? AND a.owner_id=?').bind(visitId(id),owner).first<any>();
 if(!row)throw new AppError('Nie znaleziono nagrania na Twoim koncie.',404);return row;
}
export async function saveAudio(db:D1Database,bucket:R2Bucket,owner:string,visit:string,id:string,mime:string,bytes:Uint8Array,duration:number|null){
 await getVisit(db,owner,visit);visitId(id);
 if(!['audio/webm','audio/mp4','audio/mpeg','audio/wav','audio/ogg','audio/flac','audio/aac'].includes(mime))throw new AppError('Nieobsługiwany format audio.',415);
 if(bytes.length<1||bytes.length>MAX_AUDIO)throw new AppError('Nagranie musi mieć od 1 bajtu do 24 MB.',413);
 const hash=await crypto.subtle.digest('SHA-256',bytes as BufferSource);
 const digest=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
 const existing=await db.prepare('SELECT * FROM visit_audio WHERE id=?').bind(id).first<any>();
 if(existing){if(existing.owner_id===owner&&existing.visit_id===visit&&existing.digest===digest){const stored=await bucket.head(existing.object_key);if(stored?.size===bytes.length)return {id,visitId:visit,bytes:bytes.length,durationMs:existing.duration_ms};}throw new AppError('Konflikt zapisu nagrania. Zachowaj lokalną kopię.',409);}
 const key='audio/'+owner+'/'+visit+'/'+id+'/'+digest;
 await bucket.put(key,bytes,{httpMetadata:{contentType:mime}});
 const head=await bucket.head(key);if(!head||head.size!==bytes.length)throw new AppError('Nie potwierdzono zapisu pliku. Spróbuj ponownie.',503);
 const length=duration!==null&&Number.isFinite(duration)&&duration>0&&duration<=86400000?Math.round(duration):null;
 // Conditional insert prevents linking to a visit deleted while upload was in progress.
 const row=await db.prepare('INSERT INTO visit_audio (id,visit_id,owner_id,object_key,mime,bytes,duration_ms,digest,created_at) SELECT ?,id,owner_id,?,?,?,?,?,? FROM visits WHERE id=? AND owner_id=? ON CONFLICT(id) DO NOTHING RETURNING id').bind(id,key,mime,bytes.length,length,digest,Date.now(),visit,owner).first();
 if(!row){const winner=await db.prepare('SELECT object_key FROM visit_audio WHERE id=? AND owner_id=?').bind(id,owner).first<any>();if(winner?.object_key===key)return {id,visitId:visit,bytes:bytes.length,durationMs:length};await bucket.delete(key);throw new AppError('Wizyta zmieniła się podczas zapisu audio. Ponów zapis.',409);}
 return {id,visitId:visit,bytes:bytes.length,durationMs:length};
}
export async function listAudio(db:D1Database,owner:string,visit:string){await getVisit(db,owner,visit);return (await db.prepare('SELECT id,mime,bytes,duration_ms,created_at FROM visit_audio WHERE owner_id=? AND visit_id=? ORDER BY created_at DESC').bind(owner,visit).all()).results;}

// Deleted visits are inaccessible immediately. Retry failed physical deletion on history access.
export async function cleanupAudio(db:D1Database,bucket:R2Bucket,owner:string){
 const rows=(await db.prepare('SELECT a.id,a.object_key FROM visit_audio a WHERE a.owner_id=? AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.id=a.visit_id AND v.owner_id=a.owner_id) LIMIT 100').bind(owner).all()).results as {id:string;object_key:string}[];
 for(const row of rows){await bucket.delete(row.object_key);await db.prepare('DELETE FROM visit_audio WHERE id=? AND owner_id=?').bind(row.id,owner).run();}
 return rows.length===100;
}
