import {cleanupJobData,type JobEnv} from '../../../lib/jobs';
import {cleanupAudio} from '../../../lib/audio-storage';
import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {sameOrigin} from '../../../lib/access';
import {AppError} from '../../../lib/ai';
import {json} from '../../../lib/http';
import {listVisits,getVisit,saveVisit,deleteVisit} from '../../../lib/visits';
export const dynamic='force-dynamic';
import {readJsonBody as body} from '../../../lib/request-body';

async function handle(request:Request) {
  try {
    const user=await getChatGPTUser();
    if(!user) throw new AppError('Zaloguj się, aby korzystać z historii.',401);
    const db=(env as unknown as {DB?:D1Database}).DB;
    if(!db) throw new AppError('Historia jest chwilowo niedostępna.',503);
    const bucket=(env as unknown as {BUCKET?:R2Bucket}).BUCKET;
    if(bucket){try{await cleanupAudio(db,bucket,user.userId);}catch{console.error('audio_cleanup_pending');}}
    const params=new URL(request.url).searchParams;
    if(request.method==='GET') {
      if(params.has('id')) return json({visit:await getVisit(db,user.userId,params.get('id')!)});
      const offset=Number(params.get('offset')||0);
      if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new AppError('Nieprawidłowa strona historii.');
      const rows=await listVisits(db,user.userId,offset);
      const visits=await Promise.all(rows.slice(0,50).map(async(row:any)=>({...row,hasAudio:Boolean(await db.prepare('SELECT id FROM visit_audio WHERE owner_id=? AND visit_id=? LIMIT 1').bind(user.userId,row.id).first())})));
      return json({visits,nextOffset:rows.length>50?offset+50:null});
    }
    sameOrigin(request);
    const data=await body(request);
    if(request.method==='POST') return json({visit:await saveVisit(db,user.userId,data)});
    if(!bucket)throw new AppError('Magazyn audio jest niedostępny. Spróbuj usunąć wizytę później.',503);
    await deleteVisit(db,user.userId,data.id,data.revision);
    await cleanupJobData(env as unknown as JobEnv,user.userId);
    try{const pending=await cleanupAudio(db,bucket,user.userId);if(pending)return json({deleted:true,cleanupPending:true});}catch{console.error('audio_cleanup_pending');return json({deleted:true,cleanupPending:true});}

    return json({deleted:true});
  } catch(error) {
    return json({error:error instanceof AppError?error.message:'Nie udało się zapisać lub odczytać historii. Tekst w karcie nie został usunięty.'},error instanceof AppError?error.status:500);
  }
}
export const GET=handle,POST=handle,DELETE=handle;
