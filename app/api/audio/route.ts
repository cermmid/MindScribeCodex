import {getVisit,visitId} from '../../../lib/visits';
import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {AppError,MAX_AUDIO} from '../../../lib/ai';
import {sameOrigin} from '../../../lib/access';
import {headers,json} from '../../../lib/http';
import {audioRecord,saveAudio,listAudio} from '../../../lib/audio-storage';
export const dynamic='force-dynamic';
async function handle(request:Request){try{
 const user=await getChatGPTUser();if(!user)throw new AppError('Zaloguj się, aby zapisać lub odczytać audio.',401);
 const {DB:db,BUCKET:bucket}=env as unknown as {DB:D1Database;BUCKET:R2Bucket};
 if(!db||!bucket)throw new AppError('Magazyn nagrań jest chwilowo niedostępny.',503);
 const params=new URL(request.url).searchParams;
 if(request.method==='GET'){
  if(params.has('visitId'))return json({audio:await listAudio(db,user.userId,params.get('visitId')!)});
  const row=await audioRecord(db,user.userId,params.get('id')!);const file=await bucket.get(row.object_key);
  if(!file)throw new AppError('Nie odnaleziono zapisanego pliku audio.',404);
  const ext=({'audio/webm':'webm','audio/mp4':'m4a','audio/mpeg':'mp3','audio/wav':'wav','audio/ogg':'ogg','audio/flac':'flac','audio/aac':'aac'} as Record<string,string>)[row.mime]||'audio';
  return new Response(file.body,{headers:{...headers,'Content-Type':row.mime,'Content-Length':String(file.size),'Content-Disposition':`attachment; filename="nagranie.${ext}"`}});
 }
 sameOrigin(request);
 await getVisit(db,user.userId,request.headers.get("x-visit-id")!);visitId(request.headers.get("x-audio-id")!);
 if(Number(request.headers.get('content-length'))>MAX_AUDIO)throw new AppError('Limit nagrania to 24 MB.',413);
 const reader=request.body?.getReader();if(!reader)throw new AppError('Brak nagrania.');let size=0;const parts:Uint8Array[]=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_AUDIO){await reader.cancel();throw new AppError('Limit nagrania to 24 MB.',413);}parts.push(value);}
 const data=new Uint8Array(size);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.length;}
 const saved=await saveAudio(db,bucket,user.userId,request.headers.get('x-visit-id')!,request.headers.get('x-audio-id')!,(request.headers.get('content-type')||'').split(';')[0],data,request.headers.has('x-audio-duration-ms')?Number(request.headers.get('x-audio-duration-ms')):null);
 return json({audio:saved});
 }catch(e){return json({error:e instanceof AppError?e.message:'Nie udało się zapisać lub odczytać audio. Transkrypcja nie została rozpoczęta. Zachowaj otwartą kartę i ponów zapis.'},e instanceof AppError?e.status:503);}}
export const GET=handle,POST=handle;
