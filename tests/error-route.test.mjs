import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {measureUsage} from '../work/testbuild/usage.js';
import {AppError} from '../work/testbuild/ai.js';
const source=readFileSync('app/api/[action]/route.ts','utf8').replace(/^import .*;\n/gm,'');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
let serial=0;
async function setup(){
 const events=[];const settings={DB:{prepare:()=>({bind:(...args)=>({run:async()=>{events.at(-1).audio=args;}})})},BUCKET:{get:async()=>({size:4000,arrayBuffer:async()=>new ArrayBuffer(4000)})},SESSION_SECRET:'test',GEMINI_API_KEY:'fake',TRANSCRIPTION_MODEL:'flash'};
 globalThis.routeDeps={measureUsage,env:settings,getChatGPTUser:async()=>({userId:'owner',email:'test@example.test',displayName:'Test'}),audioRecord:async()=>({visit_id:'saved-visit',object_key:'key',duration_ms:1000,bytes:4000,mime:'audio/webm'}),AppError,MAX_AUDIO:24*1024*1024,sameOrigin:()=>{},session:async()=>({id:'session'}),consume:async()=>{},beginTest:async(db,user,stage,provider,duration,context)=>{events.push({stage,context});return 'event';},finishTest:async(db,id,status,elapsed,code,details)=>Object.assign(events.at(-1),{status,code,details}),json:(d,s=200)=>Response.json(d,{status:s}),transcribe:async()=>{throw new AppError('Gemini HTTP 524. Kod: abc12345.',502,{diagnosticId:'abc12345',upstreamStatus:524,source:'upstream_http'});},redact:async()=> 'note',checkGemini:async()=>({})};
 const module=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(globalThis.routeDeps).join(',')+'}=globalThis.routeDeps;\n'+js+'\n//'+serial++).toString('base64'));
 return {events,settings,POST:module.POST};
}
test('User and admin receive identical diagnostic ID/message while upstream 524 stays separate from app 502',async()=>{
 const {POST,events}=await setup();const r=await POST(new Request('https://example.test/api/transcribe',{method:'POST',headers:{'x-saved-audio-id':'saved','x-transcription-provider':'gemini'}}));const body=await r.json();assert.equal(r.status,502);assert.equal(events[0].code,502);assert.equal(events[0].details.upstreamStatus,524);assert.equal(events[0].details.userMessage,body.error);assert.equal(events[0].details.diagnosticId,body.diagnosticId);assert.equal(events[0].audio[0],'saved-visit');
});
test('Failure before AI is recorded with the same safe message shown to user',async()=>{
 const {POST,events,settings}=await setup();settings.GEMINI_API_KEY='';const r=await POST(new Request('https://example.test/api/transcribe',{method:'POST',headers:{'x-transcription-provider':'gemini'}}));const body=await r.json();assert.equal(r.status,503);assert.equal(events.length,1);assert.equal(events[0].status,'failure');assert.equal(events[0].details.userMessage,body.error);assert.ok(body.error.includes(body.diagnosticId));assert.equal(events[0].context.model,'flash');
});
