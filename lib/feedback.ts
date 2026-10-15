import {AppError} from './ai';
import {visitId} from './visits';
export async function sendFeedback(db:D1Database,user:{userId:string;email:string},data:any) {
 if(!user?.userId) throw new AppError('Zaloguj się.',401);
 if(data?.share!==true) throw new AppError('Potwierdź udostępnienie obu wersji i komentarza.');
 const id=visitId(data.id),visit=visitId(data.visitId);
 if(typeof data.corrected!=='string'||!data.corrected.trim()||data.corrected.length>200000||typeof data.comment!=='string'||data.comment.length>10000) throw new AppError('Wpisz poprawioną wersję (do 200 000 znaków) i opcjonalne uwagi (do 10 000 znaków).');
 const existing=await db.prepare('SELECT id,owner_id,visit_id,corrected,comment FROM feedback WHERE id=?').bind(id).first<any>();
 if(existing){if(existing.owner_id===user.userId&&existing.visit_id===visit&&existing.corrected===data.corrected&&existing.comment===data.comment)return {id};throw new AppError('Ten identyfikator feedbacku jest już używany.',409);}
 if(!Number.isSafeInteger(data.revision)||data.revision<1)throw new AppError('Nieprawidłowa wersja wizyty.');
 // Capture the original on the server; never accept another user's text or an original from the client.
 const row=await db.prepare(`INSERT INTO feedback (id,owner_id,email,visit_id,original,original_kind,corrected,comment,created_at)
 SELECT ?,owner_id,?,id,COALESCE(original_note,note),CASE WHEN original_note IS NULL THEN 'saved' ELSE 'generated' END,?,?,?
 FROM visits WHERE id=? AND owner_id=? AND revision=? AND length(COALESCE(original_note,note))>0
 ON CONFLICT(id) DO NOTHING RETURNING id`).bind(id,user.email,data.corrected,data.comment,Date.now(),visit,user.userId,data.revision).first();
 if(!row)throw new AppError('Wizyta zmieniła się, została usunięta lub nie ma notatki. Otwórz feedback ponownie; skopiuj najpierw swoje poprawki.',409);
 return row;
}
export async function feedbackDetail(db:D1Database,id:string) {
 const row=await db.prepare('SELECT id,email,original,original_kind,corrected,comment,created_at FROM feedback WHERE id=?').bind(visitId(id)).first();
 if(!row)throw new AppError('Nie znaleziono feedbacku.',404);return row;
}
export async function withdrawFeedback(db:D1Database,userId:string,id:string) {
 if(!userId)throw new AppError('Zaloguj się.',401);
 await db.prepare('DELETE FROM feedback WHERE id=? AND owner_id=?').bind(visitId(id),userId).run();
}
