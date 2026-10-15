import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function app(persisted=true) {
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{
      value:'',hidden:false,disabled:false,textContent:'',listeners:{},open:false,
      addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);},
      showModal(){this.open=true;},
      close(value){this.returnValue=value;this.open=false;const fns=this.listeners.close||[];this.listeners.close=[];fns.forEach(fn=>fn());},
      replaceChildren(){},
      removeAttribute(name){delete this[name];},load(){},
    });
    return elements.get(id);
  };
  const ctx=vm.createContext({
    document:{getElementById:element},window:{addEventListener(){}},
    URL:{createObjectURL:()=> 'blob:test-audio',revokeObjectURL(){}},Blob,
    Date,console,AbortController,performance,crypto,confirm:()=>true,
    setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
    fetch:async()=>({ok:true,json:async()=>({configured:true,defaultProvider:'gemini',providers:{gemini:true}})}),
  });
  vm.runInContext(readFileSync('public/app.js','utf8'),ctx);
  vm.runInContext("config={configured:true,providers:{gemini:true}}; selectedProvider='gemini'; attachAudio(new Blob(['test audio'],{type:'audio/webm'}));",ctx);
  if(persisted)vm.runInContext("savedAudioId='11111111-1111-1111-1111-111111111111';",ctx);
  return {ctx,element,run:code=>vm.runInContext(code,ctx)};
}

test('No AI call before explicit continue; download preserves dialog; cancel keeps audio',async()=>{
  const {run,element}=app();
  run("globalThis.calls=[]; api=async(path)=>{calls.push(path);return {transcript:'test',note:'note'};}");
  const pending=run('processAudio()');
  await Promise.resolve();
  assert.equal(element('audio-backup').open,true);
  assert.equal(run('calls.length'),0);
  assert.equal(element('backup-download').href,'blob:test-audio');
  assert.equal(element('backup-download').download,'wizyta.webm');
  element('backup-download').onclick();
  assert.equal(element('audio-backup').open,true);
  assert.equal(run('calls.length'),0);
  element('backup-cancel').onclick();
  await pending;
  assert.equal(run('calls.length'),0);
  assert.equal(element('audio-download').href,'blob:test-audio');
  assert.equal(element('audio-area').hidden,false);
  assert.equal(element('record').disabled,false);
});

test('Continue calls transcription once; failure keeps download and retry prompts again',async()=>{
  const {run,element}=app();
  run("globalThis.calls=[]; api=async(path)=>{calls.push(path);throw new Error('Gemini HTTP 503');}");
  const pending=run('processAudio()');
  await Promise.resolve();
  await run('processAudio()'); // duplicate click while dialog is open
  element('backup-continue').onclick();
  await pending;
  assert.equal(run('calls.length'),1);
  assert.equal(element('audio-download').href,'blob:test-audio');
  assert.equal(element('audio-area').hidden,false);
  assert.match(element('error').textContent,/503/);
  const retry=run('processAudio()');
  await Promise.resolve();
  assert.equal(element('audio-backup').open,true);
  element('backup-cancel').onclick();
  await retry;
  assert.equal(run('calls.length'),1);
});

test('Escape cancels; download is offered even without configured key',async()=>{
  const {run,element}=app();
  run('config={configured:false};');
  const pending=run('processAudio()');
  await Promise.resolve();
  assert.equal(element('audio-backup').open,true);
  element('audio-backup').close('cancel');
  await pending;
  assert.equal(run('backupPending'),false);
});

test('Browser container takes priority over misleading extension, with fallback for unknown MIME',()=>{
  const {run}=app();
  assert.equal(run("audioMime('audio/webm;codecs=opus','wizyta.wav')"),'audio/webm');
  assert.equal(run("audioMime('video/mp4','wizyta.wav')"),'audio/mp4');
  assert.equal(run("audioMime('application/octet-stream','wizyta.MP3')"),'audio/mpeg');
  assert.equal(run("audioMime('','file.unknown')"),undefined);
});

test('History saves edited text, retains dirty changes on failure, retries the same id',async()=>{
  const {run,element}=app();
  await new Promise(resolve=>setImmediate(resolve));
  run("config.user={displayName:'Test'}; resetVisitHistory(); globalThis.saved=[]; api=async(path,options)=>{saved.push(JSON.parse(options.body));throw new Error('offline');};");
  element('visit-title').value='Rozmowa testowa';
  element('transcript').value='Transkrypcja';element('note').value='Poprawiona notatka';
  run('historyChanged()');
  assert.equal(await run('saveHistory()'),false);
  assert.equal(run('historyDirty'),true);
  assert.match(element('save-status').textContent,/Nie zapisano/);
  assert.equal(element('note').value,'Poprawiona notatka');
  const id=run('visitId');
  run("api=async(path,options)=>{saved.push(JSON.parse(options.body));return {visit:{id:visitId,revision:1,updated_at:Date.now()}};};");
  assert.equal(await run('saveHistory()'),true);
  assert.equal(run('visitId'),id);
  assert.equal(run('saved[1].id'),run('saved[0].id'));
  assert.equal(run('saved[1].note'),'Poprawiona notatka');
  assert.equal(run('historyDirty'),false);
  assert.match(element('save-status').textContent,/Zapisano/);
});

test('Opening a saved visit restores name, text and revision; failed load preserves current text',async()=>{
  const {run,element}=app();
  await new Promise(resolve=>setImmediate(resolve));
  run("loadVisitAudio=async()=>{};api=async()=>({visit:{id:'saved-id',revision:3,title:'Z historii',transcript:'Rozmowa',note:'Zapis'}});");
  await run("openVisit('saved-id')");
  assert.equal(element('visit-title').value,'Z historii');
  assert.equal(element('note').value,'Zapis');
  assert.equal(run('visitRevision'),3);
  assert.equal(run('historyDirty'),false);
  run("api=async()=>{throw new Error('offline')};");
  await run("openVisit('other-id')");
  assert.equal(element('note').value,'Zapis');
  assert.equal(run('visitId'),'saved-id');
});

test('Anonymous visitors never send visit content to history',async()=>{
  const {run}=app();
  await new Promise(resolve=>setImmediate(resolve));
  run("config.user=null; globalThis.count=0;api=async()=>{count++;};historyDirty=true;");
  assert.equal(await run('saveHistory()'),false);
  assert.equal(run('count'),0);
});

test('Feedback sends only after consent, preserves drafts on failure and does not edit the visit',async()=>{
 const {run,element}=app();element('feedback-sent').replaceChildren=()=>{};
 element('note').value='Private editor text';
 run(`globalThis.feedbackCalls=[]; api=async(path,opts)=>{feedbackCalls.push({path,opts});if(path.startsWith('/api/visits'))return {visit:{id:'11111111-1111-1111-1111-111111111111',revision:1,note:'Saved edited text',original_note:'AI original'}};return {feedback:[]};};`);
 await run("openFeedback('11111111-1111-1111-1111-111111111111')");
 assert.equal(element('feedback-original').value,'AI original');assert.equal(element('feedback-corrected').value,'Saved edited text');
 await element('feedback-send').onclick();assert.equal(run("feedbackCalls.filter(c=>c.opts?.method==='POST').length"),0);
 element('feedback-corrected').value='My correction';element('feedback-comment').value='Too verbose';element('feedback-share').checked=true;
 run("api=async(path,opts)=>{feedbackCalls.push({path,opts});throw new Error('Network error');};");
 await element('feedback-send').onclick();assert.equal(element('feedback-corrected').value,'My correction');assert.equal(element('note').value,'Private editor text');
 const sent=JSON.parse(run('feedbackCalls.at(-1).opts.body'));assert.equal(sent.share,true);assert.equal(sent.corrected,'My correction');assert.equal('original' in sent,false);assert.equal('transcript' in sent,false);
 assert.equal(element('feedback-send').disabled,false);
});

 test('Failed durable upload blocks AI and retains local audio; retry keeps upload id',async()=>{
 const {run,element}=app(false);await new Promise(r=>setImmediate(r));
 run("config.user={displayName:'Test'};visitId=crypto.randomUUID();visitRevision=1;historyDirty=false;globalThis.calls=[];api=async(path,opts)=>{calls.push({path,opts});throw new Error('Storage offline');};");
 const id=run('audioUploadId');await run('processAudio()');
 assert.equal(run('calls.length'),1);assert.equal(run('calls[0].path'),'/api/audio');assert.equal(run('savedAudioId'),null);assert.equal(element('audio-backup').open,false);assert.match(element('audio-save-status').textContent,/NIE/);assert.ok(run('blob'));
 run("api=async(path,opts)=>{calls.push({path,opts});return {audio:{id:audioUploadId}};}");
 assert.equal(await run('ensureAudioSaved()'),true);assert.equal(run('savedAudioId'),id);assert.equal(run("calls.filter(c=>c.path==='/api/transcribe').length"),0);
 });
 test('AI receives only saved audio ID after durable upload and confirmation',async()=>{
 const {run,element}=app(false);await new Promise(r=>setImmediate(r));
 run("config.user={displayName:'Test'};visitId=crypto.randomUUID();visitRevision=1;historyDirty=false;globalThis.calls=[];api=async(path,opts)=>{calls.push({path,opts});if(path==='/api/audio')return {audio:{id:audioUploadId}};throw new Error('AI timeout');};");
 const pending=run('processAudio()');await new Promise(r=>setImmediate(r));assert.equal(element('audio-backup').open,true);assert.equal(run('calls.length'),1);
 element('backup-continue').onclick();await pending;
 assert.equal(run('calls[1].path'),'/api/transcribe');assert.equal(run("calls[1].opts.headers['X-Saved-Audio-Id']"),run('audioUploadId'));assert.equal(run('calls[1].opts.body'),undefined);assert.ok(run('savedAudioId'));
 });

test('History retry reuses transcript after note failure and saves result',async()=>{
 const {run,element}=app();
 element('transcript').value='Saved transcript';element('note').value='';
 run("globalThis.flow=[];openVisit=async()=>{flow.push('open');return true;};generateNote=async()=>{flow.push('note');historyDirty=true;};processAudio=async()=>flow.push('transcribe');saveHistory=async()=>flow.push('save');");
 await run("retryVisit('visit')");assert.equal(run("flow.join(',')"),'open,note,save');
});
test('History retry transcribes saved audio only when transcript is absent; failed open cannot process another visit',async()=>{
 const {run,element}=app();element('transcript').value='';
 run("globalThis.flow=[];openVisit=async()=>true;processAudio=async()=>flow.push('transcribe');generateNote=async()=>flow.push('note');historyDirty=false;");
 await run("retryVisit('visit')");assert.equal(run("flow.join(',')"),'transcribe');
 run('openVisit=async()=>false;');await run("retryVisit('missing')");assert.equal(run('flow.length'),1);
});
