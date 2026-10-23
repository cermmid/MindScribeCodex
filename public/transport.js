'use strict';
(()=>{
 const queueKey='mindscribe-diagnostics-v18',jobKey='mindscribe-jobs-v18';
 const memory={},volatile=new Set();
 const read=(key,fallback)=>{try{if(volatile.has(key))return memory[key]||fallback;return JSON.parse(localStorage.getItem(key)||'null')||fallback;}catch{return memory[key]||fallback;}};
 const write=(key,value)=>{memory[key]=value;try{localStorage.setItem(key,JSON.stringify(value));volatile.delete(key);return true;}catch{volatile.add(key);return false;}};
 let context={},flushing=false;
 function report(data){
  const row={id:crypto.randomUUID(),at:Date.now(),online:navigator.onLine,visibility:document.visibilityState,...context,...data};
  const queue=read(queueKey,[]);queue.push(row);write(queueKey,queue.slice(-50));void flush();return row.id;
 }
 async function flush(){
  if(flushing||navigator.onLine===false)return;flushing=true;
  try{for(const row of read(queueKey,[])){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
   let response;try{response=await fetch('/api/client-report',{method:'POST',headers:{'Content-Type':'application/json','X-MindScribe-Request':'1'},body:JSON.stringify(row),signal:controller.signal});}catch{break;}finally{clearTimeout(timer);}
   if(!response.ok)break;
   write(queueKey,read(queueKey,[]).filter(x=>x.id!==row.id));
  }}finally{flushing=false;}
 }
 async function request(path,options={},extra={}){
  const started=Date.now(),requestId=crypto.randomUUID(),controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),extra.timeoutMs||30000);
  const d={...extra,path:path.split('?')[0],method:options.method||'GET',requestId};delete d.timeoutMs;
  let response;
  try{
   response=await fetch(path,{...options,signal:controller.signal,headers:{...options.headers,'X-MindScribe-Request':'1','X-Client-Request-Id':requestId}});
   Object.assign(d,{status:response.status,redirected:response.redirected,contentType:(response.headers.get('content-type')||'').split(';')[0],cfRay:response.headers.get('cf-ray'),serverRequestId:response.headers.get('x-request-id')});
   if(!['application/json','text/html','text/plain'].includes(d.contentType))d.contentType='other';
   let raw;try{raw=await response.text();}catch(e){e.transportKind='BODY_READ';throw e;}
   let data;try{data=JSON.parse(raw);}catch{const e=new Error('Serwer zwrócił odpowiedź w nieprawidłowym formacie.');e.transportKind='NON_JSON';throw e;}
   if(!response.ok){const e=new Error(typeof data.error==='string'?data.error:'Błąd serwera.');e.transportKind='HTTP_ERROR';throw e;}
   return data;
  }catch(error){
   const kind=controller.signal.aborted?'TIMEOUT':error.transportKind||'NETWORK';
   const id=report({...d,kind,elapsedMs:Date.now()-started});
   const e=new Error((kind==='HTTP_ERROR'?error.message:kind==='NON_JSON'?'Serwer nie zwrócił prawidłowego JSON.':kind==='TIMEOUT'?'Przekroczono czas pojedynczego połączenia.':'Przerwano odbieranie odpowiedzi serwera.')+' HTTP: '+(d.status??'brak odpowiedzi')+'. Raport: '+id+'.');
   e.retryable=kind!=='HTTP_ERROR'||d.status===429||d.status>=500;e.status=d.status;throw e;
  }finally{clearTimeout(timer);}
 }
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function wait(job,onProgress){
  context={visitId:job.visitId,jobId:job.id,path:'/api/jobs'};
  const deadline=Date.now()+12*60*1000;let failures=0;
  while(true){
   onProgress?.(job);
   if(job.state==='succeeded')return job.result;
   if(['failed','uncertain'].includes(job.state))throw new Error(job.error||'Zadanie wymaga sprawdzenia. ID: '+job.id);
   if(Date.now()>deadline){report({kind:'JOB_WAIT_PAUSED'});throw new Error('Zadanie nadal jest zapisane. Wróć do wizyty z historii, aby sprawdzić wynik. ID: '+job.id);}
   await delay(2500);
   try{job=(await request('/api/jobs?id='+encodeURIComponent(job.id),{method:'POST'},{visitId:job.visitId,jobId:job.id})).job;failures=0;}
   catch(e){if(!e.retryable||++failures>=5)throw new Error(e.message+' Zadanie pozostaje zapisane. Otwórz wizytę z historii, aby wznowić sprawdzanie.');await delay(5000);}
  }
 }
 async function run(input,onProgress){
  const key=input.visitId+':'+input.stage;const saved=read(jobKey,{});let job;
  if(saved[key]){
   try{job=(await request('/api/jobs?id='+encodeURIComponent(saved[key]),{},{visitId:input.visitId,jobId:saved[key]})).job;}
   catch(e){if(e.status!==404)throw e;delete saved[key];write(jobKey,saved);}
   if(job?.state==='failed'){delete saved[key];write(jobKey,saved);job=null;}
  }
  if(!job){
   input.id=input.id||crypto.randomUUID();saved[key]=input.id;write(jobKey,saved);
   job=(await request('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)},{visitId:input.visitId,jobId:input.id})).job;
   saved[key]=job.id;write(jobKey,saved);
  }
  if(job && input.id!==job.id){
   try{await request('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,id:job.id})},{visitId:input.visitId,jobId:job.id});}
   catch(e){
    // A completed job is reusable only for the same input. Never release an active job.
    if(e.status!==409||job.state!=='succeeded')throw e;
    delete saved[key];write(jobKey,saved);return run({...input,id:crypto.randomUUID()},onProgress);
   }
  }
  return await wait(job,onProgress);
 }
 function acknowledged(visitId){const saved=read(jobKey,{});for(const key of Object.keys(saved))if(key.startsWith(visitId+':'))delete saved[key];write(jobKey,saved);}
 for(const name of ['offline','online','pagehide'])window.addEventListener(name,()=>{if(context.jobId)report({kind:name==='offline'?'OFFLINE':name==='online'?'ONLINE':'PAGE_UNLOAD'});if(name==='online')void flush();});
 document.addEventListener('visibilitychange',()=>{if(context.jobId&&document.visibilityState==='hidden')report({kind:'PAGE_HIDDEN'});});
 window.MindScribeTransport={request,run,wait,report,flush,acknowledged,setContext:value=>{context=value;}};
 void flush();
})();
