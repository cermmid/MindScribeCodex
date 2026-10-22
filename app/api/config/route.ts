import { env } from 'cloudflare:workers';
import { session } from '../../../lib/access';
import { json } from '../../../lib/http';
import type { Settings } from '../../../lib/ai';
import {getChatGPTUser,chatGPTSignInPath,chatGPTSignOutPath} from '../../chatgpt-auth';
import {isAdmin} from '../../../lib/admin';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  const settings=env as unknown as Settings & {SESSION_SECRET?:string;ADMIN_EMAIL?:string};
  if(!settings.SESSION_SECRET) return json({error:'Trwa konfiguracja serwera. Spróbuj za chwilę.'},503);
  const user=await getChatGPTUser();
  if(!user) return json({error:'Zaloguj się przez ChatGPT, aby korzystać z aplikacji.'},401);
  const s=await session(request,settings.SESSION_SECRET,true);
  const gemini=Boolean(settings.GEMINI_API_KEY), elevenlabs=Boolean(settings.ELEVENLABS_API_KEY);
  return json({backgroundJobs:true,isAdmin:isAdmin(user,settings),user:user?{displayName:user.displayName}:null,signInPath:chatGPTSignInPath('/'),signOutPath:chatGPTSignOutPath('/'),configured:gemini,providers:{gemini,elevenlabs},defaultProvider:settings.DEFAULT_TRANSCRIPTION_PROVIDER || (elevenlabs?'elevenlabs':'gemini'),transcriptionModel:settings.TRANSCRIPTION_MODEL||'gemini-3.8-flash',noteModel:settings.NOTE_MODEL||'gemini-3.1-pro-preview',maxAudioBytes:24*1024*1024},200,s.cookie?{'Set-Cookie':s.cookie}:{});
}
