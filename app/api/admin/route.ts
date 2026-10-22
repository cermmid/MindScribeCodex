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
  let event=await settings.DB.prepare('SELECT * FROM test_events WHERE id=?').bind(id).first<any>();
  if(!event){const c=await settings.DB.prepare('SELECT * FROM client_reports WHERE id=?').bind(id).first<any>();if(c)event={id:c.id,user_id:c.owner_id,email:c.email,visit_id:c.visit_id,stage:'client',status:'failure',started_at:c.received_at,error_code:JSON.parse(c.details).status,diagnostics:JSON.stringify({source:'browser',clientReport:JSON.parse(c.details)})};}
  if(!event)return json({error:'Nie znaleziono próby.'},404);
  let attempts=event.visit_id?(await settings.DB.prepare('SELECT * FROM test_events WHERE user_id=? AND visit_id=? ORDER BY started_at DESC,id DESC LIMIT 501').bind(event.user_id,event.visit_id).all()).results:event.run_id?(await settings.DB.prepare('SELECT * FROM test_events WHERE user_id=? AND run_id=? ORDER BY started_at DESC,id DESC LIMIT 501').bind(event.user_id,event.run_id).all()).results:[event];
  const attemptsTruncated=attempts.length>500;attempts=attempts.slice(0,500).reverse();
  if(!attempts.some((a:any)=>a.id===event.id)){attempts.shift();attempts.push(event);attempts.sort((a:any,b:any)=>a.started_at-b.started_at);}
  const clientReports=(await settings.DB.prepare('SELECT id,job_id,received_at,details FROM client_reports WHERE owner_id=? AND (visit_id=? OR id=?) ORDER BY received_at LIMIT 501').bind(event.user_id,event.visit_id??null,event.id).all()).results;
  const jobSteps=(await settings.DB.prepare('SELECT s.* FROM processing_steps s JOIN processing_jobs j ON j.id=s.job_id WHERE j.owner_id=? AND j.visit_id=? ORDER BY s.at DESC LIMIT 2001').bind(event.user_id,event.visit_id??null).all()).results;
  const jobStates=(await settings.DB.prepare('SELECT id,stage,state,created_at,updated_at,lease_until FROM processing_jobs WHERE owner_id=? AND visit_id=? ORDER BY created_at LIMIT 501').bind(event.user_id,event.visit_id??null).all()).results;
  return json({event,attempts,attemptsTruncated,clientReports:clientReports.slice(0,500),jobSteps:jobSteps.slice(0,2000).reverse(),jobStates:jobStates.slice(0,500),diagnosticHistoryTruncated:clientReports.length>500||jobSteps.length>2000||jobStates.length>500});
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
 const browserErrors=(await settings.DB.prepare('SELECT id,email,received_at,details FROM client_reports ORDER BY received_at DESC LIMIT 100').all()).results;
 return json({browserErrors,users:users.results,events:events.results,costs,monthCosts,stageCosts,userCosts,monthStart});
 } catch {return json({error:'Nie udało się odczytać statystyk. Spróbuj ponownie.'},503);}
}
