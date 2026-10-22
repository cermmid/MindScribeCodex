import {AppError,call,TRANSCRIPTION_PROMPT,promptHash, type Settings} from './ai';
import {NOTE_PROMPT} from './note-prompt';
import {measureUsage} from './usage';
const endpoint='https://generativelanguage.googleapis.com/v1beta/interactions';
export const providerId=(id:unknown):id is string=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,512}$/.test(id);
const allowedStatus=['in_progress','queued','completed','failed','cancelled','incomplete','requires_action'];
export function inspectInteraction(raw:any,model:string,d:Record<string,any>){
 const status=allowedStatus.includes(raw?.status)?raw.status:'unknown';
 const steps=Array.isArray(raw?.steps)?raw.steps:[];
 const parts=steps.filter((s:any)=>s?.type==='model_output').flatMap((s:any)=>Array.isArray(s.content)?s.content:[]);
 const text=parts.filter((p:any)=>p?.type==='text'&&typeof p.text==='string').map((p:any)=>p.text).join('\n').trim();
 d.interaction={status,id:providerId(raw?.id)?raw.id:null,stepCount:steps.length,textCharacters:text.length,nonTextPartCount:parts.filter((p:any)=>p?.type!=='text').length,errorPresent:raw?.error!=null};
 const u=raw?.usage;
 if(u){const measured=measureUsage({promptTokenCount:u.total_input_tokens,candidatesTokenCount:u.total_output_tokens,thoughtsTokenCount:u.total_thought_tokens,totalTokenCount:u.total_tokens,cachedContentTokenCount:u.total_cached_tokens,toolUsePromptTokenCount:u.total_tool_use_tokens,serviceTier:raw.service_tier?.toUpperCase()},model);d.usage=measured?{...measured,source:'gemini_interactions_usage'}:null;}
 if(status==='completed'){
  if(!text)throw new AppError('Gemini zakończyło zadanie bez tekstu.',502,{...d,technicalMessage:'INTERACTION_EMPTY_TEXT'});
  if(text==='[BRAK CZYTELNEJ MOWY]')throw new AppError('Nie rozpoznano czytelnej mowy. Odsłuchaj zapisane nagranie.',422,{...d,technicalMessage:'NO_READABLE_SPEECH'});
  if(text.length>200000)throw new AppError('Wynik przekracza limit tekstu wizyty.',502,{...d,technicalMessage:'RESULT_TOO_LARGE'});
  return {status,text};
 }
 if(!['queued','in_progress'].includes(status))throw new AppError('Gemini zakończyło zadanie ze statusem: '+status+'. Pełny wynik nie został zapisany.',502,{...d,technicalMessage:'INTERACTION_'+status.toUpperCase()});
 return {status,text:null};
}
function headers(settings:Settings){if(!settings.GEMINI_API_KEY)throw new AppError('Brak klucza Gemini.',503);return {'Content-Type':'application/json','x-goog-api-key':settings.GEMINI_API_KEY,'Api-Revision':'2026-05-20'};}
export async function submitInteraction(settings:Settings,model:string,stage:string,input:string,audio:Uint8Array|null,mime:string|null,d:Record<string,any>){
 if(!/^[a-zA-Z0-9._-]+$/.test(model))throw new AppError('Nieprawidłowy model.',503);
 const system=stage==='transcribe'?TRANSCRIPTION_PROMPT:NOTE_PROMPT;
 const generation_config={max_output_tokens:30000,...(stage==='transcribe'?{thinking_level:'low'}:{})};
 d.request={model,operation:stage,background:true,store:true,apiRevision:'2026-05-20',generationConfig:generation_config,promptSha256:await promptHash(system)};
 const raw=await call(endpoint,{method:'POST',headers:headers(settings),body:JSON.stringify({model,system_instruction:system,background:true,store:true,generation_config,input:stage==='transcribe'?[{type:'audio',data:Buffer.from(audio!).toString('base64'),mime_type:mime},{type:'text',text:'Przepisz całe nagranie.'}]:JSON.stringify({transkrypcja_konsultacji:input})})},20000,d);
 if(!providerId((raw as any)?.id))throw new AppError('Nie otrzymano identyfikatora zadania Gemini. Nie uruchomiono automatycznie drugiej próby.',502,{...d,technicalMessage:'MISSING_INTERACTION_ID'});
 return raw as any;
}
export async function retrieveInteraction(settings:Settings,id:string,d:Record<string,any>){if(!providerId(id))throw new AppError('Nieprawidłowe ID zadania.',500);return await call(endpoint+'/'+id,{headers:headers(settings)},15000,d) as any;}
export async function deleteInteraction(settings:Settings,id:string){
 if(!providerId(id))return false;
 const response=await fetch(endpoint+'/'+id,{method:'DELETE',headers:headers(settings),signal:AbortSignal.timeout(5000)});
 await response.body?.cancel();return response.ok||response.status===404;
}
