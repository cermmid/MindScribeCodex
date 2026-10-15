import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {sameOrigin} from '../../../lib/access';
import {json} from '../../../lib/http';
import {AppError} from '../../../lib/ai';
import {readJsonBody} from '../../../lib/request-body';
import {sendFeedback,withdrawFeedback,feedbackDetail} from '../../../lib/feedback';
import {isAdmin} from '../../../lib/admin';
import {visitId} from '../../../lib/visits';
export const dynamic='force-dynamic';
async function handle(request:Request){try{
 const user=await getChatGPTUser();if(!user)throw new AppError('Zaloguj się.',401);
 const settings=env as unknown as {DB:D1Database;ADMIN_EMAIL?:string};
 const db=settings.DB,params=new URL(request.url).searchParams;
 if(request.method==='GET'){
  if(params.get('admin')==='1'){
   if(!isAdmin(user,settings))throw new AppError('Panel jest dostępny tylko dla właściciela.',403);
   if(params.has('id'))return json({feedback:await feedbackDetail(db,params.get('id')!)});
   const offset=Number(params.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new AppError('Nieprawidłowa strona.');
   const rows=(await db.prepare('SELECT id,email,created_at FROM feedback ORDER BY created_at DESC,id LIMIT 21 OFFSET ?').bind(offset).all()).results;
   return json({feedback:rows.slice(0,20),nextOffset:rows.length>20?offset+20:null});
  }
  const rows=(await db.prepare('SELECT id,created_at FROM feedback WHERE owner_id=? AND visit_id=? ORDER BY created_at DESC').bind(user.userId,visitId(params.get('visitId'))).all()).results;
  return json({feedback:rows});
 }
 sameOrigin(request);const data=await readJsonBody(request);
 if(request.method==='POST')return json({feedback:await sendFeedback(db,user,data)});
 await withdrawFeedback(db,user.userId,data.id);return json({deleted:true});
 }catch(e){return json({error:e instanceof AppError?e.message:'Nie udało się obsłużyć feedbacku. Zachowaj tekst i spróbuj ponownie.'},e instanceof AppError?e.status:500);}}
export const GET=handle,POST=handle,DELETE=handle;
