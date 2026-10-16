import {measureUsage} from '../../../lib/usage';
import {audioRecord} from '../../../lib/audio-storage';
import { getChatGPTUser } from '../../chatgpt-auth';
import { beginTest, finishTest } from '../../../lib/test-events';
import { env } from 'cloudflare:workers';
import { AppError, MAX_AUDIO, transcribe, redact, checkGemini, type Settings } from '../../../lib/ai';
import { sameOrigin, session, consume } from '../../../lib/access';
import { json } from '../../../lib/http';

async function readBounded(request:Request,limit:number) {
  const n=Number(request.headers.get('content-length'));
  if(n>limit) throw new AppError('Przekroczono limit danych. Maksymalny rozmiar nagrania to 24 MB.',413);
  const reader=request.body?.getReader(); if(!reader) throw new AppError('Brak materiału.');
  const chunks:Uint8Array[]=[]; let size=0;
  while(true) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>limit) { await reader.cancel(); throw new AppError('Przekroczono limit danych.',413); } chunks.push(value); }
  const bytes=new Uint8Array(size); let offset=0; for(const c of chunks) { bytes.set(c,offset); offset+=c.length; }
  return bytes;
}
export async function POST(request:Request) {
  const started = Date.now();
  const action=new URL(request.url).pathname.split('/').pop();
  const metric = (outcome:string) => console.info(JSON.stringify({event:'processing_stage',stage:action==='transcribe'?'transcribe':action==='note'?'note':'unknown',outcome,elapsedMs:Date.now()-started}));
  const diagnosticContext:Record<string,any>={diagnosticSchema:2,appVersion:'16-diagnostics-1',upstreamStatus:null,aiPhase:'not_started',automaticRetries:0};
  const incomingRay=request.headers.get('cf-ray');
  diagnosticContext.incomingCfRay=incomingRay&&/^[a-zA-Z0-9-]{1,80}$/.test(incomingRay)?incomingRay:null;
  const phases:{phase:string,startedMs:number,durationMs:number}[]=[];
  let phase='authentication',phaseStarted=started;
  const mark=(next:string)=>{const now=Date.now();phases.push({phase,startedMs:phaseStarted-started,durationMs:now-phaseStarted});phase=next;phaseStarted=now;};
  let usage:ReturnType<typeof measureUsage>=null;
  const onUsage=(raw:unknown,model:string)=>{usage=measureUsage(raw,model);};
  let eventId:string|null=null; let eventDB:D1Database|undefined;
  const complete=async(status:string,code:number|null=null,details:Record<string,unknown>|null=null)=>{if(eventDB&&eventId) {try {await finishTest(eventDB,eventId,status,status==='pending'?null:Date.now()-started,code,{...diagnosticContext,...details,usage,pipelinePhase:phase,pipelineTimings:[...phases,{phase,startedMs:phaseStarted-started,durationMs:Date.now()-phaseStarted}]});} catch {console.error('test_metric_finish_failed');}}};
  try {
    const user=await getChatGPTUser();
    if(!user) throw new AppError('Zaloguj się przez ChatGPT, aby korzystać z aplikacji.',401);
    sameOrigin(request);
    const settings=env as unknown as Settings & {SESSION_SECRET?:string,DB?:D1Database,BUCKET?:R2Bucket};
    if(!settings.SESSION_SECRET || !settings.DB) throw new AppError('Serwer nie jest jeszcze gotowy do przetwarzania.',503);
    if(action==='transcribe'||action==='note'){
      const provider=action==='note'?'gemini':request.headers.get('x-transcription-provider')==='elevenlabs'?'elevenlabs':'gemini';
      eventDB=settings.DB;eventId=await beginTest(eventDB,user,action,provider,null,{visitId:request.headers.get('x-visit-id'),runId:request.headers.get('x-processing-run-id'),model:provider==='elevenlabs'?'scribe_v2':action==='transcribe'?(settings.TRANSCRIPTION_MODEL||'gemini-3.8-flash'):(settings.NOTE_MODEL||'gemini-3.8-flash')});
    }
    mark('session_validation');
    await session(request,settings.SESSION_SECRET);
    if(action==='check') {
      await consume(settings.DB,user.userId,'check');
      return json(await checkGemini(settings));
    }
    if(action==='transcribe') {
      mark('configuration');
      const provider=request.headers.get('x-transcription-provider') || 'elevenlabs';
      if(!['gemini','elevenlabs'].includes(provider)) throw new AppError('Nieznany dostawca transkrypcji.');
      if(!settings.GEMINI_API_KEY || (provider==='elevenlabs'&&!settings.ELEVENLABS_API_KEY)) throw new AppError('Właściciel aplikacji musi najpierw podłączyć klucze API. Nagranie pozostaje w tej karcie.',503);
      if(!settings.BUCKET)throw new AppError('Magazyn audio jest niedostępny.',503);
      const savedId=request.headers.get('x-saved-audio-id');
      if(!savedId)throw new AppError('Najpierw zapisz nagranie w historii. Odśwież aplikację dopiero po pobraniu lokalnej kopii.',409);
      mark('audio_metadata');
      const saved=await audioRecord(settings.DB,user.userId,savedId);
      await settings.DB.prepare('UPDATE test_events SET visit_id=?,duration_ms=?,audio_bytes=?,audio_format=? WHERE id=?').bind(saved.visit_id,saved.duration_ms,saved.bytes,saved.mime,eventId).run();
      diagnosticContext.savedAudioId=savedId;
      mark('audio_storage_read');
      const stored=await settings.BUCKET.get(saved.object_key);
      if(!stored)throw new AppError('Nie odnaleziono zapisanego audio. Transkrypcja nie została rozpoczęta.',409);
      if(stored.size>MAX_AUDIO)throw new AppError('Nagranie przekracza 24 MB.',413);
      const mime=saved.mime;
      const audio=new Uint8Array(await stored.arrayBuffer());
      if(audio.length<2000) throw new AppError('Nagranie jest puste lub zbyt krótkie.',422);
      diagnosticContext.audioBytesRead=audio.length;
      mark('quota');
      await consume(settings.DB,user.userId,'audio');

      mark('ai');
      diagnosticContext.aiPhase='preparing_request';
      await complete('pending');
      const transcript = await transcribe(settings,provider,audio,mime,onUsage,diagnosticContext);
      mark('result_ready');
      await complete('success',200);
      metric('success');
      return json({transcript,provider});
    }
    if(action==='note') {
      mark('note_input');
      if(!settings.GEMINI_API_KEY) throw new AppError('Redakcja tekstu czeka na podłączenie Gemini przez właściciela.',503);
      if(!request.headers.get('content-type')?.startsWith('application/json')) throw new AppError('Wymagany format JSON.',415);
      let data; try {data=JSON.parse(new TextDecoder().decode(await readBounded(request,1000000)));} catch(e) {if(e instanceof AppError) throw e; throw new AppError('Nieprawidłowe dane.');}
      const text=data?.transcript;
      if(typeof text!=='string'||!text.trim()) throw new AppError('Brak czytelnej transkrypcji.',422);
      if(text.length>200000) throw new AppError('Transkrypcja przekracza 200 000 znaków.',413);
      diagnosticContext.inputTextCharacters=text.length;
      mark('quota');
      await consume(settings.DB,user.userId,'note');

      mark('ai');
      diagnosticContext.aiPhase='preparing_request';
      await complete('pending');
      const note = await redact(settings,text,onUsage,diagnosticContext);
      mark('result_ready');
      await complete('success',200);
      metric('success');
      return json({note});
    }
    throw new AppError('Nie znaleziono operacji.',404);
  } catch(error) {
    const baseMessage=error instanceof AppError?error.message:'Wystąpił błąd serwera. Materiał pozostał w tej karcie; spróbuj ponownie.';
    const diagnosticId=String(error instanceof AppError&&error.diagnostics.diagnosticId||crypto.randomUUID().slice(0,8));
    const message=baseMessage.includes('Kod: '+diagnosticId)?baseMessage:baseMessage+' Kod: '+diagnosticId+'.';
    const details={diagnosticId,source:'application',exceptionType:error instanceof AppError?'AppError':error instanceof Error&&['TypeError','RangeError','SyntaxError','AbortError','TimeoutError','Error'].includes(error.name)?error.name:'InternalError',technicalMessage:'Application processing failed',...(error instanceof AppError?error.diagnostics:{}),userMessage:message,applicationStatus:error instanceof AppError?error.status:500};
    await complete('failure',error instanceof AppError?error.status:500,details);
    metric('failure');
    return json({error:message,diagnosticId:details.diagnosticId},error instanceof AppError?error.status:500);
  }
}
