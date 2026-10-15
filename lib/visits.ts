import { AppError } from './ai';
type VisitInput = {id?:unknown,title?:unknown,transcript?:unknown,note?:unknown,revision?:unknown,originalNote?:unknown};
function owner(value:string) { if(!value) throw new AppError('Zaloguj się, aby korzystać z historii.',401); return value; }
export function visitId(value:unknown):string {
  if(typeof value!=='string' || !/^[a-f0-9-]{36}$/.test(value)) throw new AppError('Nieprawidłowy identyfikator wizyty.');
  return value;
}
export async function listVisits(db:D1Database,user:string,offset=0) {
  return (await db.prepare('SELECT id,title,created_at,updated_at,revision FROM visits WHERE owner_id = ? ORDER BY updated_at DESC,id LIMIT 51 OFFSET ?').bind(owner(user),offset).all()).results;
}
export async function getVisit(db:D1Database,user:string,id:string) {
  const row=await db.prepare('SELECT id,title,transcript,note,original_note,created_at,updated_at,revision FROM visits WHERE owner_id = ? AND id = ?').bind(owner(user),visitId(id)).first();
  if(!row) throw new AppError('Nie znaleziono wizyty na Twoim koncie.',404);
  return row;
}
export async function saveVisit(db:D1Database,user:string,input:VisitInput) {
  const userId=owner(user), id=visitId(input.id);
  if(typeof input.title!=='string' || !input.title.trim() || input.title.length>120) throw new AppError('Nazwa wizyty musi mieć od 1 do 120 znaków.');
  if(typeof input.transcript!=='string' || input.transcript.length>200000 || typeof input.note!=='string' || input.note.length>200000) throw new AppError('Nieprawidłowa długość tekstu wizyty.');
  if(!Number.isSafeInteger(input.revision) || Number(input.revision)<0) throw new AppError('Nieprawidłowa wersja wizyty.');
  if(input.originalNote!==undefined && input.originalNote!==null && (typeof input.originalNote!=='string'||input.originalNote.length>200000)) throw new AppError('Nieprawidłowy oryginał notatki.');
  const original=typeof input.originalNote==='string'?input.originalNote:null;
  const now=Date.now();
  if(input.revision===0) {
    const row=await db.prepare('INSERT INTO visits (id,owner_id,title,transcript,note,original_note,created_at,updated_at,revision) VALUES (?,?,?,?,?,?,?,?,1) ON CONFLICT(id) DO NOTHING RETURNING id,revision,updated_at').bind(id,userId,input.title.trim(),input.transcript,input.note,original,now,now).first();
    if(row) return row;
    const existing=await db.prepare('SELECT id,revision,updated_at FROM visits WHERE id = ? AND owner_id = ? AND title = ? AND transcript = ? AND note = ? AND original_note IS ?').bind(id,userId,input.title.trim(),input.transcript,input.note,original).first();
    if(existing) return existing;
  } else {
    const row=await db.prepare('UPDATE visits SET title = ?,transcript = ?,note = ?,original_note = ?,updated_at = ?,revision = revision + 1 WHERE owner_id = ? AND id = ? AND revision = ? RETURNING id,revision,updated_at').bind(input.title.trim(),input.transcript,input.note,original,now,userId,id,input.revision).first();
    if(row) return row;
    const existing=await db.prepare('SELECT id,revision,updated_at FROM visits WHERE id = ? AND owner_id = ? AND revision = ? AND title = ? AND transcript = ? AND note = ? AND original_note IS ?').bind(id,userId,Number(input.revision)+1,input.title.trim(),input.transcript,input.note,original).first();
    if(existing) return existing;
  }
  throw new AppError('Wizyta zmieniła się w innej karcie albo została usunięta. Skopiuj swoje zmiany i otwórz wizytę ponownie z historii.',409);
}
export async function deleteVisit(db:D1Database,user:string,id:string,revision:number) {
  if(!Number.isSafeInteger(revision)||revision<1) throw new AppError('Nieprawidłowa wersja wizyty.');
  const row=await db.prepare('DELETE FROM visits WHERE owner_id = ? AND id = ? AND revision = ? RETURNING id').bind(owner(user),visitId(id),revision).first();
  if(!row) throw new AppError('Wizyta zmieniła się albo nie istnieje na Twoim koncie. Odśwież historię.',409);
}
