import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {geminiText,transcribe,redact,responseSnapshot} from '../work/testbuild/ai.js';

for(const [label,response,code] of [
 ['token limit',{candidates:[{finishReason:'MAX_TOKENS'}]},'OUTPUT_TOKEN_LIMIT'],
 ['safety',{candidates:[{finishReason:'SAFETY',safetyRatings:[{category:'HARM_CATEGORY_DANGEROUS_CONTENT',probability:'HIGH',blocked:true}]}]},'FINISH_SAFETY'],
 ['recitation',{candidates:[{finishReason:'RECITATION'}]},'FINISH_RECITATION'],
 ['prompt block',{promptFeedback:{blockReason:'PROHIBITED_CONTENT'}},'PROMPT_BLOCKED'],
 ['no candidates',{},'NO_CANDIDATES'],
 ['missing finish',{candidates:[{}]},'MISSING_FINISH_REASON'],
 ['empty text',{candidates:[{finishReason:'STOP',content:{parts:[{text:'   '}]}}]},'EMPTY_VISIBLE_TEXT'],
 ['thought only',{candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'private thought'}]}}]},'EMPTY_VISIBLE_TEXT'],
 ['bad shape',{candidates:{}},'MALFORMED_RESPONSE_SHAPE'],
 ['null',null,'MALFORMED_RESPONSE_SHAPE'],
 ['invalid parts',{candidates:[{finishReason:'STOP',content:{parts:{}}}]},'MISSING_OR_INVALID_PARTS'],
 ['invalid text',{candidates:[{finishReason:'STOP',content:{parts:[{text:{}}]}}]},'MALFORMED_PART'],
 ['unknown enum',{candidates:[{finishReason:'SENSITIVE PATIENT TEXT'}]},'FINISH_UNRECOGNIZED_VALUE'],
 ['continuation',{candidates:[{finishReason:'CONTINUATION'}]},'CONTINUATION_REQUIRED'],
])test('Distinct diagnostic: '+label,()=>{
 assert.throws(()=>geminiText(response),e=>{assert.equal(e.diagnostics.validation.code,code);assert.equal(e.diagnostics.source,'response_validation');assert.ok(!JSON.stringify(e.diagnostics).includes('SENSITIVE PATIENT'));return true;});
});

test('Snapshot excludes conversation, reasoning, raw messages, citations, signatures and arbitrary fields',()=>{
 const secret='PRIVATE PATIENT TEXT';
 const snapshot=responseSnapshot({responseId:'response-123',modelVersion:'gemini-3.8-flash',secret,promptFeedback:{blockReasonMessage:secret},candidates:[{finishReason:'STOP',finishMessage:secret,content:{parts:[{text:secret},{text:secret,thought:true},{functionCall:{args:{secret}},thoughtSignature:secret}]},citationMetadata:{secret},safetyRatings:[{category:secret,probability:secret,blocked:true,secret}]}]});
 assert.ok(!JSON.stringify(snapshot).includes(secret));assert.equal(snapshot.candidates[0].visibleTextCharacters,secret.length);assert.equal(snapshot.candidates[0].thoughtPartCount,1);assert.equal(snapshot.candidates[0].nonTextPartCount,1);assert.equal(snapshot.candidates[0].finishMessagePresent,true);
});

async function withFetch(mock,fn){const old=globalThis.fetch;globalThis.fetch=mock;try{await fn();}finally{globalThis.fetch=old;}}
const run=ctx=>transcribe({GEMINI_API_KEY:'PRIVATE_KEY',TRANSCRIPTION_MODEL:'gemini-3.8-flash'},'gemini',new Uint8Array(3000),'audio/webm',undefined,ctx);

test('Successful response retains transport and validation, with unchanged generation parameters',async()=>{
 const d={};await withFetch(async(url,init)=>{const body=JSON.parse(init.body);assert.equal(body.generationConfig.maxOutputTokens,30000);assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,'low');return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'Synthetic test'}]}}]});},async()=>{assert.equal(await run(d),'Synthetic test');assert.equal(d.upstreamStatus,200);assert.equal(d.validation.code,'COMPLETE_TEXT');assert.ok(d.headersReceivedMs>=0);assert.ok(d.bodyReadMs>=0);assert.ok(d.responseBodyBytes>0);assert.ok(!JSON.stringify(d).includes('PRIVATE_KEY'));assert.ok(!JSON.stringify(d).includes('Synthetic test'));});
});
test('Malformed JSON retains actual HTTP 200 and identifies parser failure',async()=>{
 await withFetch(async()=>new Response('<html>PRIVATE</html>'),async()=>{await assert.rejects(run({}),e=>{assert.equal(e.diagnostics.upstreamStatus,200);assert.equal(e.diagnostics.aiPhase,'json_parse_failed');assert.equal(e.diagnostics.exceptionType,'SyntaxError');assert.ok(!JSON.stringify(e.diagnostics).includes('PRIVATE'));return true;});});
});
test('Broken body is distinguished from malformed JSON',async()=>{
 await withFetch(async()=>new Response(new ReadableStream({start(c){c.error(new Error('PRIVATE BODY'));}})),async()=>{await assert.rejects(run({}),e=>{assert.equal(e.diagnostics.upstreamStatus,200);assert.equal(e.diagnostics.aiPhase,'body_read_failed');assert.ok(!JSON.stringify(e.diagnostics).includes('PRIVATE'));return true;});});
});
for(const name of ['TypeError','TimeoutError'])test('Network failure '+name+' preserves deadline without leaking exception text',async()=>{
 await withFetch(async()=>{const e=new Error('PRIVATE KEY');e.name=name;throw e;},async()=>{await assert.rejects(run({}),e=>{assert.equal(e.diagnostics.upstreamStatus,null);assert.equal(e.diagnostics.source,name==='TimeoutError'?'request_timeout':'network');assert.equal(e.diagnostics.request.timeoutMs,240000);assert.ok(!JSON.stringify(e.diagnostics).includes('PRIVATE'));return true;});});
});
test('HTTP error only retains allowlisted RPC metadata and headers; body size is bounded',async()=>{
 await withFetch(async()=>Response.json({error:{code:429,status:'RESOURCE_EXHAUSTED',message:'PRIVATE PATIENT',details:[{secret:'PRIVATE KEY'}]}},{status:429,headers:{'retry-after':'30','set-cookie':'PRIVATE COOKIE','x-request-id':'req-1'}}),async()=>{await assert.rejects(run({}),e=>{assert.equal(e.diagnostics.upstreamStatus,429);assert.equal(e.diagnostics.providerError.status,'RESOURCE_EXHAUSTED');assert.equal(e.diagnostics.responseHeaders.retryAfterSeconds,30);assert.ok(!JSON.stringify(e.diagnostics).includes('PRIVATE'));return true;});});
 await withFetch(async()=>new Response('x'.repeat(40000),{status:502}),async()=>{await assert.rejects(run({}),e=>e.diagnostics.errorBodyState==='over_limit');});
});
test('No readable speech preserves upstream response context',async()=>{
 await withFetch(async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'[BRAK CZYTELNEJ MOWY]'}]}}]}),async()=>{await assert.rejects(run({}),e=>e.status===422&&e.diagnostics.upstreamStatus===200&&e.diagnostics.validation.code==='NO_READABLE_SPEECH');});
});

test('Copy report includes all stored technical metadata for selected attempt and retries; legacy entries are explicit',()=>{
 const source=readFileSync('public/admin.js','utf8');
 const safe=source.slice(source.indexOf('function safeDetails'),source.indexOf('function diagnosticButton'));
 const report=source.slice(source.indexOf('function reportFor'),source.indexOf('async function showDiagnostics'));
 const context=vm.createContext({});vm.runInContext(safe+report+';this.reportFor=reportFor;',context);
 const details={diagnosticSchema:2,appVersion:'16-diagnostics-1',upstreamStatus:200,response:{candidates:[{finishReason:'MAX_TOKENS'}]},request:{generationConfig:{maxOutputTokens:30000}},futureSafeMetadata:{number:42}};
 const event={id:'attempt1',started_at:1000,stage:'transcribe',status:'failure',run_id:'run',elapsed_ms:42000,error_code:502,diagnostics:JSON.stringify(details)};
 const second={...event,id:'attempt2',diagnostics:JSON.stringify({...details,response:{candidates:[{finishReason:'SAFETY'}]}})};
 const result=context.reportFor(event,[event,second]);
 assert.equal(JSON.stringify(result.diagnostyka.szczegolyTechniczne),JSON.stringify(details));assert.equal(result.ponowienia.proby[1].szczegolyTechniczne.response.candidates[0].finishReason,'SAFETY');assert.equal(result.http.kodPolaczeniaAI,200);
 assert.equal(context.reportFor({...event,diagnostics:null},[event]).kompletnoscDiagnostyki.zapisRozszerzony,false);
 assert.equal(context.reportFor({...event,status:'pending'},[event]).kompletnoscDiagnostyki.probaZakonczona,false);
});

test('HTTP 400 identifies background rejection in durable diagnostics and logs without patient text',async()=>{
 const {call}=await import('../work/testbuild/ai.js');const logs=[];const old=console.error;console.error=x=>logs.push(JSON.parse(x));
 try{await withFetch(async()=>Response.json({error:{code:400,status:'INVALID_ARGUMENT',message:'Model does not support background interactions. PRIVATE PATIENT'}},{status:400}),async()=>{
  const d={jobId:'test-job'};await assert.rejects(call('https://generativelanguage.googleapis.com/v1beta/interactions',{},1000,d));
  assert.equal(d.providerError.reason,'BACKGROUND_NOT_SUPPORTED');assert.equal(logs[0].providerError.reason,'BACKGROUND_NOT_SUPPORTED');assert.equal(logs[0].jobId,'test-job');assert.ok(!JSON.stringify([d,logs]).includes('PRIVATE PATIENT'));
 });}finally{console.error=old;}
});
test('Unknown provider messages cannot leak arbitrary input through classifications',async()=>{
 const {providerErrorSnapshot}=await import('../work/testbuild/ai.js');
 assert.equal(providerErrorSnapshot({error:{message:'PRIVATE PATIENT'}}).reason,'UNCLASSIFIED_PROVIDER_ERROR');
 assert.ok(!JSON.stringify(providerErrorSnapshot({error:{message:'PRIVATE PATIENT'}})).includes('PRIVATE PATIENT'));
});
