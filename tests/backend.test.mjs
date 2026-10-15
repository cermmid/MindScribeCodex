import test from 'node:test';
import assert from 'node:assert/strict';
import {geminiText,scribeTranscript,transcribe,redact,checkGemini} from '../work/testbuild/ai.js';
import {session,sameOrigin,consume} from '../work/testbuild/access.js';

test('Scribe retains speaker turns, unknown roles and times',()=>{
  const text=scribeTranscript({words:[{type:'word',text:'Dawniej',speaker_id:'a',start:1},{type:'word',text:'tak.',speaker_id:'a',start:2},{type:'word',text:'A teraz?',speaker_id:'b',start:3},{type:'word',text:'Nie.',speaker_id:'a',start:65}]});
  assert.match(text,/\[00:01\] MÓWCA 1: Dawniej tak\./);
  assert.match(text,/\[00:03\] MÓWCA 2: A teraz\?/);
  assert.match(text,/\[01:05\] MÓWCA 1: Nie\./);
  assert.ok(!text.includes('LEKARZ:'));
});
test('Missing speakers are not silently assigned',()=>{
  assert.match(scribeTranscript({words:[{type:'word',text:'Dobrze'}]}),/MÓWCA NIEUSTALONY/);
  assert.match(scribeTranscript({text:'Dobrze'}),/Nie ustalono mówców/);
  assert.throws(()=>scribeTranscript({text:'',words:[]}));
});
test('Partial and blocked model results never become documentation',()=>{
  assert.throws(()=>geminiText({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'unfinished'}]}}]}));
  assert.throws(()=>geminiText({}));
  assert.equal(geminiText({candidates:[{finishReason:'STOP',content:{parts:[{text:'secret thought',thought:true},{text:'Gotowe.'}]}}]}),'Gotowe.');
});
test('Only server-held keys are used; ElevenLabs uses diarization and preserves corrections',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    assert.equal(url,'https://api.elevenlabs.io/v1/speech-to-text');
    assert.equal(init.headers['xi-api-key'],'test-secret');
    assert.equal(init.body.get('model_id'),'scribe_v2');
    assert.equal(init.body.get('diarize'),'true');
    assert.equal(init.body.get('no_verbatim'),'false');
    assert.equal(init.body.get('language_code'),'pol');
    return Response.json({text:'Nie, pięćdziesiąt.'});
  };
  try { assert.match(await transcribe({ELEVENLABS_API_KEY:'test-secret'},'elevenlabs',new Uint8Array(3000),'audio/webm'),/pięćdziesiąt/); }
  finally {globalThis.fetch=original;}
});
test('Note prompt is separated from visit and demo is never included',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    const body=JSON.parse(init.body);
    assert.equal(JSON.parse(body.contents[0].parts[0].text).transkrypcja_konsultacji,'PACJENT: dawniej, obecnie nie.');
    assert.match(body.systemInstruction.parts[0].text,/Temat myśli samobójczych nie został poruszony/);
    assert.ok(!JSON.stringify(body).includes('Pacjent, 38 lat'));
    assert.equal(body.generationConfig.thinkingConfig,undefined);
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'Pierwsze.\n\nDrugie.'}]}}]});
  };
  try {assert.equal(await redact({GEMINI_API_KEY:'test'},'PACJENT: dawniej, obecnie nie.'),'Pierwsze. Drugie.');}
  finally {globalThis.fetch=original;}
});
test('No provider key means no network request',async()=>{
  await assert.rejects(transcribe({},'elevenlabs',new Uint8Array(3000),'audio/webm'),/klucz|podłączone/);
  await assert.rejects(redact({},'tekst'),/klucz/);
});
test('Provider errors do not leak source or secrets',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response('secret key and patient',{status:401});
  try {await assert.rejects(redact({GEMINI_API_KEY:'test'},'tekst'),e=>e.status===502 && !e.message.includes('patient'));}
  finally {globalThis.fetch=original;}
});
test('Anonymous test session is signed, scoped and tamper-resistant',async()=>{
  const req=new Request('https://site.example/api/config');
  const s=await session(req,'test-server-secret',true);
  assert.match(s.cookie,/HttpOnly; Secure; SameSite=Strict/);
  const cookie=s.cookie.split(';')[0];
  assert.equal((await session(new Request(req,{headers:{cookie}}),'test-server-secret')).id,s.id);
  await assert.rejects(session(new Request(req,{headers:{cookie}}),'another-key'));
  await assert.rejects(session(req,'test-server-secret'));
});
test('Cross-site API calls are rejected',()=>{
  assert.throws(()=>sameOrigin(new Request('https://site.example/api/note',{headers:{origin:'https://evil.example','x-mindscribe-request':'1'}})));
  assert.throws(()=>sameOrigin(new Request('https://site.example/api/note')));
  sameOrigin(new Request('https://site.example/api/note',{headers:{origin:'https://site.example','x-mindscribe-request':'1'}}));
});
test('Quota failures reject processing instead of bypassing protection',async()=>{
  const db={prepare(){return{bind(){return{first:async()=>null}}}}};
  await assert.rejects(consume(db,'session','audio'),e=>e.status===429);
});

test('Flash transcription disables reasoning without dropping audio or transcription instructions',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    const body=JSON.parse(init.body);
    assert.match(url,/gemini-2.5-flash:generateContent$/);
    assert.equal(body.generationConfig.thinkingConfig.thinkingBudget,0);
    assert.equal(body.contents[0].parts[0].inlineData.mimeType,'audio/webm');
    assert.equal(Buffer.from(body.contents[0].parts[0].inlineData.data,'base64').length,3000);
    assert.match(body.systemInstruction.parts[0].text,/bez streszczania/);
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'Dawka: pięćdziesiąt miligramów.'}]}}]});
  };
  try {assert.match(await transcribe({GEMINI_API_KEY:'test',TRANSCRIPTION_MODEL:'gemini-2.5-flash'},'gemini',new Uint8Array(3000),'audio/webm'),/pięćdziesiąt/);}
  finally {globalThis.fetch=original;}
});

test('Transient failures expose provider status and correlate safe diagnostics without logging source',async()=>{
  const original=globalThis.fetch, log=console.error, events=[];
  globalThis.fetch=async()=>new Response('patient transcript and secret-key',{status:503});
  console.error=(event)=>events.push(JSON.parse(event));
  try {
    await assert.rejects(redact({GEMINI_API_KEY:'secret-key'},'patient transcript'),e=>{
      assert.match(e.message,/Gemini — HTTP 503/);
      assert.match(e.message,new RegExp(events[0].diagnosticId));
      return e.status===502;
    });
    assert.equal(events[0].upstreamStatus,503);
    assert.ok(!JSON.stringify(events).includes('patient'));
    assert.ok(!JSON.stringify(events).includes('secret-key'));
  } finally {globalThis.fetch=original;console.error=log;}
});


test('Connection check makes real generation requests and discovers models after provider failure',async()=>{
  const original=globalThis.fetch; const calls=[];
  globalThis.fetch=async(url,init)=>{
    calls.push(url);
    assert.equal(init.headers['x-goog-api-key'],'test-only-key');
    if(url.includes('gemini-2.5-pro:')) return new Response('{}',{status:404});
    if(url.includes('?pageSize=')) return Response.json({models:[{name:'models/gemini-test-pro',supportedGenerationMethods:['generateContent']},{name:'models/embedding',supportedGenerationMethods:['embedContent']}]});
    assert.equal(JSON.parse(init.body).contents[0].parts[0].text,'Reply with exactly the word OK.');
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'OK'}]}}]});
  };
  try {
    const result=await checkGemini({GEMINI_API_KEY:'test-only-key',TRANSCRIPTION_MODEL:'gemini-2.5-flash',NOTE_MODEL:'gemini-2.5-pro'});
    assert.equal(result.checks[0].ok,true);
    assert.equal(result.checks[1].ok,false);
    assert.match(result.checks[1].error,/HTTP 404/);
    assert.deepEqual(result.availableModels,['gemini-test-pro']);
    assert.equal(calls.length,3);
    assert.ok(!JSON.stringify(result).includes('test-only-key'));
  }finally{globalThis.fetch=original;}
});

test('524 retains upstream code separately from application 502 and never includes raw provider content',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>new Response('SECRET_PATIENT_AND_API_KEY',{status:524});
 try{await assert.rejects(transcribe({GEMINI_API_KEY:'secret'},'gemini',new Uint8Array(4000),'audio/webm'),e=>{
 assert.equal(e.status,502);assert.equal(e.diagnostics.upstreamStatus,524);assert.equal(e.diagnostics.source,'upstream_http');
 assert.equal(e.diagnostics.exceptionType,'UpstreamHttpError');assert.match(e.message,/Przekroczono czas/);assert.ok(e.message.includes(e.diagnostics.diagnosticId));
 assert.ok(!JSON.stringify(e.diagnostics).includes('SECRET_PATIENT'));return true;});}finally{globalThis.fetch=old;}
});
