import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {session as realSession,sameOrigin as realSameOrigin} from '../work/testbuild/access.js';
import {measureUsage} from '../work/testbuild/usage.js';
import {AppError,transcribe as realTranscribe} from '../work/testbuild/ai.js';
const source=readFileSync('app/api/[action]/route.ts','utf8').replace(/^import .*;\n/gm,'');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
let serial=0;
async function setup(useRealAI=false,overrides={}){
 const events=[];const settings={DB:{prepare:()=>({bind:(...args)=>({run:async()=>{events.at(-1).audio=args;}})})},BUCKET:{get:async()=>({size:4000,arrayBuffer:async()=>new ArrayBuffer(4000)})},SESSION_SECRET:'test',GEMINI_API_KEY:'fake',TRANSCRIPTION_MODEL:'flash'};
 globalThis.routeDeps={measureUsage,env:settings,getChatGPTUser:async()=>({userId:'owner',email:'test@example.test',displayName:'Test'}),audioRecord:async()=>({visit_id:'saved-visit',object_key:'key',duration_ms:1000,bytes:4000,mime:'audio/webm'}),AppError,MAX_AUDIO:24*1024*1024,sameOrigin:()=>{},session:async()=>({id:'session'}),consume:async()=>{},beginTest:async(db,user,stage,provider,duration,context)=>{events.push({stage,context});return 'event';},finishTest:async(db,id,status,elapsed,code,details)=>Object.assign(events.at(-1),{status,code,details}),json:(d,s=200,headers={})=>Response.json(d,{status:s,headers}),transcribe:async()=>{throw new AppError('Gemini HTTP 524. Kod: abc12345.',502,{diagnosticId:'abc12345',upstreamStatus:524,source:'upstream_http'});},redact:async()=> 'note',checkGemini:async()=>({})};
 if(useRealAI)globalThis.routeDeps.transcribe=realTranscribe;
 Object.assign(globalThis.routeDeps,overrides);
 const module=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(globalThis.routeDeps).join(',')+'}=globalThis.routeDeps;\n'+js+'\n//'+serial++).toString('base64'));
 return {events,settings,POST:module.POST};
}
test('User and admin receive identical diagnostic ID/message while upstream 524 stays separate from app 502',async()=>{
 const {POST,events}=await setup();const r=await POST(new Request('https://example.test/api/transcribe',{method:'POST',headers:{'x-saved-audio-id':'saved','x-transcription-provider':'gemini'}}));const body=await r.json();assert.equal(r.status,502);assert.equal(events[0].code,502);assert.equal(events[0].details.upstreamStatus,524);assert.equal(events[0].details.userMessage,body.error);assert.equal(events[0].details.diagnosticId,body.diagnosticId);assert.equal(events[0].audio[0],'saved-visit');
});
test('Failure before AI is recorded with the same safe message shown to user',async()=>{
 const {POST,events,settings}=await setup();settings.GEMINI_API_KEY='';const r=await POST(new Request('https://example.test/api/transcribe',{method:'POST',headers:{'x-transcription-provider':'gemini'}}));const body=await r.json();assert.equal(r.status,503);assert.equal(events.length,1);assert.equal(events[0].status,'failure');assert.equal(events[0].details.userMessage,body.error);assert.ok(body.error.includes(body.diagnosticId));assert.equal(events[0].context.model,'flash');
});

test('Actual Gemini validation failure survives route persistence with HTTP 200, reason, usage, timings and identical user message',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({responseId:'response-test-1',modelVersion:'gemini-3.8-flash',usageMetadata:{promptTokenCount:20091,totalTokenCount:20091},candidates:[{finishReason:'MAX_TOKENS'}]},{headers:{'x-request-id':'request-test-1','cf-ray':'abcd-XYZ'}});
 try{
  const {POST,events}=await setup(true);
  const response=await POST(new Request('https://example.test/api/transcribe',{method:'POST',headers:{'x-saved-audio-id':'saved','x-transcription-provider':'gemini','cf-ray':'incoming-ABC'}}));
  const body=await response.json(),d=events[0].details;
  assert.equal(response.status,502);assert.equal(d.upstreamStatus,200);assert.equal(d.source,'response_validation');assert.equal(d.validation.code,'OUTPUT_TOKEN_LIMIT');
  assert.equal(d.response.candidates[0].finishReason,'MAX_TOKENS');assert.equal(d.response.responseId,'response-test-1');assert.equal(d.responseHeaders.requestId,'request-test-1');assert.equal(d.incomingCfRay,'incoming-ABC');
  assert.equal(d.request.generationConfig.maxOutputTokens,30000);assert.equal(d.request.timeoutMs,240000);assert.equal(d.request.promptSha256.length,64);assert.equal(d.audioBytesRead,4000);assert.equal(d.savedAudioId,'saved');
  assert.equal(d.usage.promptTokens,20091);assert.equal(d.userMessage,body.error);assert.equal(d.diagnosticId,body.diagnosticId);assert.equal(d.pipelinePhase,'ai');assert.ok(d.pipelineTimings.some(t=>t.phase==='audio_storage_read'));
  assert.equal(d.diagnosticSchema,2);assert.ok(!JSON.stringify(d).includes('fake'));
 }finally{globalThis.fetch=previous;}
});

const requestForSession=(cookie)=>new Request('https://example.test/api/transcribe',{method:'POST',headers:{origin:'https://example.test','x-mindscribe-request':'1','x-transcription-provider':'gemini','x-saved-audio-id':'saved',...(cookie?{cookie}:{})}});
async function oldCookie(){
 const now=Date.now;Date.now=()=>now()-25*60*60*1000;
 try{return (await realSession(new Request('https://example.test'),'test',true)).cookie.split(';')[0];}finally{Date.now=now;}
}
for(const state of ['missing','expired','invalid_signature'])test('Authenticated processing recovers '+state+' auxiliary session without reload and calls AI once',async()=>{
 let cookie=state==='expired'?await oldCookie():state==='invalid_signature'?(await realSession(new Request('https://example.test'),'another-secret',true)).cookie.split(';')[0]:null;
 await assert.rejects(realSession(requestForSession(cookie),'test'),e=>e.status===403&&e.diagnostics.session.previousState===state);
 let calls=0,quotaUser;
 const {POST,events}=await setup(false,{session:realSession,sameOrigin:realSameOrigin,consume:async(db,id)=>{quotaUser=id;},transcribe:async()=>{calls++;return 'Synthetic transcription';}});
 const r=await POST(requestForSession(cookie));assert.equal(r.status,200);assert.equal(calls,1);assert.equal(quotaUser,'owner');
 assert.equal(events[0].details.session.previousState,state);assert.equal(events[0].details.session.renewed,true);
 const newCookie=r.headers.get('set-cookie');assert.ok(newCookie);assert.match(newCookie,/HttpOnly; Secure; SameSite=Strict/);
 const checked=await realSession(requestForSession(newCookie.split(';')[0]),'test');assert.equal(checked.diagnostics.previousState,'valid');assert.equal(checked.cookie,null);
 assert.ok(!JSON.stringify(events[0].details).includes('mindscribe_session='));
});
test('Renewed cookie is returned even when AI subsequently fails',async()=>{
 const {POST,events}=await setup(false,{session:realSession,sameOrigin:realSameOrigin});
 const r=await POST(requestForSession());assert.equal(r.status,502);assert.ok(r.headers.get('set-cookie'));assert.equal(events[0].details.session.renewed,true);assert.equal(events[0].details.upstreamStatus,524);
});
for(const mode of ['anonymous','cross_origin'])test('Session renewal never bypasses '+mode+' rejection',async()=>{
 let sessionCalls=0,aiCalls=0;
 const overrides={session:async(...args)=>{sessionCalls++;return realSession(...args);},sameOrigin:realSameOrigin,transcribe:async()=>{aiCalls++;return 'Never';}};
 if(mode==='anonymous')overrides.getChatGPTUser=async()=>null;
 const {POST}=await setup(false,overrides);const request=requestForSession();if(mode==='cross_origin')request.headers.set('origin','https://evil.test');
 const r=await POST(request);assert.equal(r.status,mode==='anonymous'?401:403);assert.equal(sessionCalls,0);assert.equal(aiCalls,0);assert.equal(r.headers.get('set-cookie'),null);
});
test('Renewal retains quota rejection before AI',async()=>{
 let aiCalls=0;const {POST}=await setup(false,{session:realSession,sameOrigin:realSameOrigin,consume:async()=>{throw new AppError('Limit',429);},transcribe:async()=>{aiCalls++;return 'Never';}});
 const r=await POST(requestForSession());assert.equal(r.status,429);assert.equal(aiCalls,0);assert.ok(r.headers.get('set-cookie'));
});
