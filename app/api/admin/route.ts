import {COST_COLUMNS} from '../../../lib/usage';
import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {isAdmin} from '../../../lib/admin';
import {json} from '../../../lib/http';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
 const user=await getChatGPTUser();
 const settings=env as unknown as {ADMIN_EMAIL?:string;DB:D1Database};
 if(!user) return json({error:'Zaloguj się przez ChatGPT.'},401);
 if(!isAdmin(user,settings)) return json({error:'Panel jest dostępny tylko dla właściciela.'},403);
 try {
 const id=new URL(request.url).searchParams.get('id');
 if(id){
  if(!/^[a-f0-9-]{36}$/.test(id))return json({error:'Nieprawidłowy identyfikator.'},400);
  const event=await settings.DB.prepare('SELECT * FROM test_events WHERE id=?').bind(id).first<any>();
  if(!event)return json({error:'Nie znaleziono próby.'},404);
  let attempts=event.visit_id?(await settings.DB.prepare('SELECT * FROM test_events WHERE user_id=? AND visit_id=? ORDER BY started_at DESC,id DESC LIMIT 501').bind(event.user_id,event.visit_id).all()).results:event.run_id?(await settings.DB.prepare('SELECT * FROM test_events WHERE user_id=? AND run_id=? ORDER BY started_at DESC,id DESC LIMIT 501').bind(event.user_id,event.run_id).all()).results:[event];
  const attemptsTruncated=attempts.length>500;attempts=attempts.slice(0,500).reverse();
  if(!attempts.some((a:any)=>a.id===event.id)){attempts.shift();attempts.push(event);attempts.sort((a:any,b:any)=>a.started_at-b.started_at);}
  return json({event,attempts,attemptsTruncated});
 }
 const users=await settings.DB.prepare(`SELECT user_id,email,display_name,
 SUM(stage='transcribe') AS audio_attempts,SUM(stage='note') AS note_attempts,
 SUM(status='success') AS successes,SUM(status='failure') AS failures,SUM(status='pending') AS unfinished,
 SUM(CASE WHEN stage='transcribe' THEN duration_ms ELSE 0 END) AS audio_ms,
 SUM(stage='transcribe' AND duration_ms IS NULL) AS unknown_durations,
 AVG(elapsed_ms) AS avg_ms,MAX(started_at) AS last_at
 FROM test_events GROUP BY user_id ORDER BY last_at DESC LIMIT 200`).all();
 const events=await settings.DB.prepare('SELECT id,email,stage,provider,status,started_at,elapsed_ms,duration_ms,error_code,diagnostics FROM test_events ORDER BY started_at DESC LIMIT 200').all();
 const monthStart=Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),1);
 const costs=(await settings.DB.prepare('SELECT '+COST_COLUMNS+' FROM test_events').first());
 const monthCosts=(await settings.DB.prepare('SELECT '+COST_COLUMNS+' FROM test_events WHERE started_at>=?').bind(monthStart).first());
 const stageCosts=(await settings.DB.prepare('SELECT stage,'+COST_COLUMNS+' FROM test_events GROUP BY stage').all()).results;
 const userCosts=(await settings.DB.prepare('SELECT user_id,'+COST_COLUMNS+' FROM test_events GROUP BY user_id').all()).results;
 return json({users:users.results,events:events.results,costs,monthCosts,stageCosts,userCosts,monthStart});
 } catch {return json({error:'Nie udało się odczytać statystyk. Spróbuj ponownie.'},503);}
}
