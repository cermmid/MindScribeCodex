'use strict';
const $ = id => document.getElementById(id);
let selectedProvider = 'elevenlabs';
let config, recorder, stream, chunks = [], blob, audioUrl, audioContext, analyser, meterFrame;
let busy = false, recording = false, paused = false, starting = false, demoMode = false, interrupted = false;
let accumulated = 0, startedAt = 0, bytes = 0, timerInterval, toastTimeout;
let progressInterval;
let originalNote=null;
let processingRunId=null;
let savedAudioId=null,audioUploadId=null,audioSaving=false;
let audioDurationMs = null;
let backupPending = false, finalizing = false;
let visitId = null, visitRevision = 0, historyDirty = false, historyWriting = false, historyLoading = false, historyTimer, historyNext = null;
const MAX_AUDIO = 24 * 1024 * 1024;
const extension = mime => ({'audio/mp4':'m4a','audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/ogg':'ogg','audio/flac':'flac','audio/aac':'aac'}[mime.split(';')[0]] || 'webm');
function audioMime(declared, filename) {
  const cleaned = (declared || '').split(';')[0].trim().toLowerCase();
  const aliases = {'audio/x-wav':'audio/wav','audio/wave':'audio/wav','video/webm':'audio/webm','video/mp4':'audio/mp4','audio/x-m4a':'audio/mp4'};
  const mime = aliases[cleaned] || cleaned;
  if (['audio/webm','audio/mp4','audio/mpeg','audio/wav','audio/ogg','audio/flac','audio/aac'].includes(mime)) return mime;
  return {webm:'audio/webm',mp3:'audio/mpeg',m4a:'audio/mp4',mp4:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg',oga:'audio/ogg',flac:'audio/flac',aac:'audio/aac'}[(filename || '').split('.').pop().toLowerCase()];
}

function showError(message) { $('error').textContent = message; $('error').hidden = !message; }
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimeout); toastTimeout = setTimeout(() => $('toast').hidden = true, 3500); }
function hasMaterial() { return Boolean(blob || $('transcript').value.trim() || $('note').value.trim()); }
function controls() {
  const locked = audioSaving || busy || recording || starting || backupPending || finalizing || historyWriting || historyLoading;
  for (const id of ['upload-button','paste-button','demo','new-visit','settings-open','setup-button','generate','process-audio']) $(id).disabled = locked;
  $('save-audio').disabled = locked || !blob || Boolean(savedAudioId);
  $('record').disabled = audioSaving || busy || starting || backupPending || finalizing || historyWriting || historyLoading;
  $('history-open').disabled = locked;
  $('save-visit').disabled = locked || !config?.user || demoMode;
  $('visit-title').disabled = audioSaving || historyWriting || historyLoading;
  $('copy').disabled = busy || !$('note').value.trim();
  $('transcript').readOnly = locked;
  $('note').readOnly = audioSaving || busy || historyWriting || historyLoading;
  $('pause').hidden = !recording;
}
function updateCount() { const n = $('note').value.trim(); $('word-count').textContent = n ? `${n.split(/\s+/u).length} słów · Sprawdź treść przed skopiowaniem.` : 'Ostateczna treść należy do Ciebie.'; controls(); }
function setBusy(value, stage='') {
  clearInterval(progressInterval);
  busy = value; $('progress').hidden = !value;
  $('progress-title').textContent = stage;
  if (value) {
    const start = Date.now();
    const update = () => {
      const seconds = Math.floor((Date.now()-start)/1000);
      const time = `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
      const provider = stage.startsWith('1') ? (selectedProvider === 'gemini' ? 'Gemini' : 'ElevenLabs') : 'Gemini';
      $('progress-detail').textContent = `${provider} · ${time} oczekiwania. ` + (seconds >= 60 ? 'To trwa dłużej niż oczekiwano. Nagranie pozostaje w tej karcie i można je pobrać. Nie odświeżaj strony.' : 'Czekam na odpowiedź usługi. Zachowaj tę kartę otwartą.');
    };
    update(); progressInterval = setInterval(update,1000);
  }
  if (value) $('document-status').textContent = 'Przetwarzanie';
  controls();
  if (!value && historyDirty) scheduleHistorySave();
}
async function api(path, options={}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), (path.startsWith('/api/visits')||path.startsWith('/api/feedback')) ? 20000 : 270000);
  try {
    const tracking={};
    if(path==='/api/transcribe'||path==='/api/note'){visitId ||= crypto.randomUUID();processingRunId ||= crypto.randomUUID();tracking['X-Visit-Id']=visitId;tracking['X-Processing-Run-Id']=processingRunId;}
    const response = await fetch(path, {...options, signal: controller.signal, headers: {...options.headers, ...tracking, 'X-MindScribe-Request': '1'}});
    let data;
    try { data = await response.json(); } catch { throw new Error('Serwer zwrócił nieczytelną odpowiedź. Spróbuj ponownie za chwilę.'); }
    if (!response.ok) throw new Error(data.error || 'Nie udało się przetworzyć wizyty.');
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Upłynął czas oczekiwania. Materiał pozostał w tej karcie. Serwer może jeszcze kończyć poprzednie zadanie.');
    if (error instanceof TypeError) throw new Error('Nie udało się połączyć z serwerem. Sprawdź internet. Materiał pozostał w tej karcie.');
    throw error;
  } finally { clearTimeout(timeout); }
}
function clearAudio() {
  $('saved-audio-list').replaceChildren();$('audio-save-status').textContent='';
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  savedAudioId=null;audioUploadId=null; audioDurationMs = null; audioUrl = null; blob = null; chunks = []; $('playback').removeAttribute('src'); $('playback').load();
  $('audio-download').removeAttribute('href'); $('audio-area').hidden = true;
}
function reset(keepVisit=false) {
  if(!keepVisit) resetVisitHistory();
  originalNote=null; clearAudio(); $('transcript').value = ''; $('note').value = ''; demoMode = false;
  $('demo-banner').hidden = true; $('note').hidden = true; $('empty-state').hidden = false;
  $('document-status').textContent = 'Oczekuje na rozmowę'; $('transcript-details').open = false;
  $('transcript-hint').textContent = 'Zachowaj oznaczenia mówców i kolejność wypowiedzi.';
  $('timer').textContent = '00:00'; $('record-state').textContent = 'Gotowe, kiedy Ty jesteś'; showError(''); updateCount();
}
function allowReplace() { return (!hasMaterial() && !historyDirty) || confirm(historyDirty ? 'Masz niezapisane zmiany. Zastąpić je? Anuluj, aby najpierw zapisać wizytę.' : 'Zastąpić zawartość tej karty? Zapisane wizyty i nagrania pozostaną w historii. Niezapisane audio zostanie utracone.'); }
function attachAudio(value, durationMs=null) {
  savedAudioId=null;audioUploadId=crypto.randomUUID();
  audioDurationMs=durationMs;
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  blob = value; audioUrl = URL.createObjectURL(blob);
  const currentUrl=audioUrl;
  $('playback').onloadedmetadata=()=>{const seconds=$('playback').duration;if(audioUrl===currentUrl && audioDurationMs===null && Number.isFinite(seconds) && seconds>0) audioDurationMs=Math.round(seconds*1000);};
  $('playback').src = audioUrl; $('audio-download').href = audioUrl;
  $('audio-download').download = `wizyta.${extension(blob.type)}`;
  $('audio-size').textContent = `${(blob.size/1024/1024).toFixed(1)} MB`;
  $('audio-area').hidden = false;
}
function confirmAudioBackup() {
  if (backupPending || !blob || !audioUrl) return Promise.resolve(false);
  backupPending = true; controls();
  const dialog = $('audio-backup');
  const download = $('backup-download');
  download.href = audioUrl;
  download.download = $('audio-download').download;
  $('backup-status').textContent = 'Pobierz plik, sprawdź czy został zapisany, a potem rozpocznij transkrypcję. Możesz też przejść dalej bez pobierania.';
  dialog.returnValue = 'cancel';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      backupPending = false; controls();
      if(historyDirty) scheduleHistorySave();
      resolve(dialog.returnValue === 'continue');
    }, {once:true});
    dialog.showModal();
  });
}
function openSettings() {
  $('settings-error').hidden = true;
  $('provider').value = selectedProvider;
  $('elevenlabs-status').textContent = config?.providers?.elevenlabs ? 'ElevenLabs: klucz ustawiony, połączenie niezweryfikowane' : 'ElevenLabs: brak klucza';
  $('gemini-status').textContent = config?.providers?.gemini ? 'Gemini: klucz ustawiony. Użyj testu, aby sprawdzić oba modele.' : 'Gemini: brak klucza';
  $('note-model-info').textContent = 'Gemini · ' + (config?.noteModel || 'oczekiwanie na konfigurację');
  $('settings').showModal();
}
function requireKey(forAudio=false) {
  if(config?.configured && (!forAudio || config?.providers?.[selectedProvider])) return true;
  showError('Ta funkcja czeka na podłączenie kluczy API przez właściciela aplikacji. Nie musisz wpisywać własnego klucza. Możesz nagrać i odsłuchać próbę lub obejrzeć przykład.');
  return false;
}
function renderNote(note) {
  $('note').value = note; $('note').hidden = false; $('empty-state').hidden = true;
  $('document-status').textContent = demoMode ? 'Przykład' : 'Do sprawdzenia'; updateCount();
}
async function generateNote() {
  if (!$('transcript').value.trim()) { showError('Wklej transkrypcję albo nagraj rozmowę.'); return; }
  if (!requireKey()) return;
  if ($('note').value.trim() && !confirm('Przygotować zapis ponownie? Obecne poprawki w zapisie zostaną zastąpione nowym wynikiem po udanym przetworzeniu.')) return;
  processingRunId=crypto.randomUUID();
  showError(''); setBusy(true, '2 z 2 · Przygotowuję zapis wizyty');
  try {
    const result = await api('/api/note', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({transcript:$('transcript').value})});
    originalNote=result.note; renderNote(result.note);
    historyChanged();
    if (demoMode) $('demo-banner').textContent = 'PRZYKŁAD · Fikcyjna transkrypcja. Ten zapis został teraz wygenerowany przez AI.';
  } catch (error) { showError(error.message); $('document-status').textContent = 'Wymaga ponowienia'; }
  finally { setBusy(false); }
}
async function processAudio() {
  if (!blob || busy || audioSaving || backupPending || finalizing) return;
  if (blob.size > MAX_AUDIO) { showError('Nagranie przekracza 24 MB. Pobierz je i skróć lub skompresuj przed ponownym wczytaniem.'); return; }
  if ($('transcript').value.trim() && !confirm('Ponownie odczytać nagranie? Poprawki w transkrypcji zostaną zastąpione. Aby je zachować, użyj „Przygotuj zapis z tekstu”.')) return;
  if ($('note').value.trim() && !confirm('Nowy zapis zastąpi obecny tekst i Twoje poprawki po udanym przetworzeniu. Kontynuować?')) return;
  if (!await ensureAudioSaved()) return;
  if (!await confirmAudioBackup()) return;
  if (!requireKey(true)) return;
  processingRunId=crypto.randomUUID();
  showError(''); setBusy(true, '1 z 2 · Tworzę transkrypcję');
  try {
    const result = await api('/api/transcribe', {method:'POST', headers:{'X-Saved-Audio-Id':savedAudioId,'X-Transcription-Provider':selectedProvider}});
    $('transcript').value = result.transcript;
    if (interrupted) $('transcript').value = '[NAGRANIE PRZERWANE — DOSTĘPNY JEST TYLKO FRAGMENT KONSULTACJI]\n' + $('transcript').value;
    demoMode = false; $('demo-banner').hidden = true;
    historyChanged();
    setBusy(true, '2 z 2 · Przygotowuję zapis wizyty');
    const note = await api('/api/note', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({transcript:$('transcript').value})});
    originalNote=note.note; renderNote(note.note);
    historyChanged();
  } catch (error) {
    showError(error.message); $('document-status').textContent = 'Wymaga ponowienia';
    if ($('transcript').value) { $('transcript-details').open = true; $('transcript-hint').textContent = 'Transkrypcja jest zachowana. Ponów tylko przygotowanie zapisu przyciskiem obok.'; }
  } finally { setBusy(false); }
}
function elapsed() { return accumulated + (recording && !paused ? performance.now()-startedAt : 0); }
function tick() { const s = Math.floor(elapsed()/1000); $('timer').textContent = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
function cleanupMicrophone() {
  clearInterval(timerInterval); cancelAnimationFrame(meterFrame);
  if (stream) for (const track of stream.getTracks()) track.stop();
  stream = null;
  if (audioContext) audioContext.close().catch(()=>{});
  audioContext = null; $('level').hidden = true;
  $('recording-visual').className = 'recording-visual';
}
function stopRecording(unexpected=false) {
  if (!recording || !recorder) return;
  interrupted ||= unexpected;
  if (!paused) accumulated += performance.now()-startedAt;
  recording = false; paused = false; finalizing = true; tick();
  if (recorder.state !== 'inactive') recorder.stop();
  cleanupMicrophone();
  $('record').textContent = '● Rozpocznij nagrywanie'; $('pause').textContent = 'Wstrzymaj'; controls();
}
async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { showError('Ta przeglądarka nie obsługuje nagrywania. Otwórz link bezpośrednio w Chrome lub Edge, albo wczytaj plik.'); return; }
  if (hasMaterial() && !allowReplace()) return;
  const keepVisit = !hasMaterial();
  starting = true; controls(); showError('');
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
    const mime = ['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
    if (!mime) throw new Error('Brak obsługi formatu audio. Użyj Chrome lub Edge.');
    recorder = new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:32000});
    reset(keepVisit); interrupted = false; chunks = []; bytes = 0; accumulated = 0; paused = false;
    recorder.ondataavailable = event => {
      if (event.data.size) { chunks.push(event.data); bytes += event.data.size; }
      if (bytes >= MAX_AUDIO - 150000 && recording) stopRecording(true);
    };
    recorder.onerror = () => { interrupted = true; stopRecording(true); showError('Nagrywanie zostało przerwane. Odsłuchaj i pobierz zachowany fragment.'); };
    recorder.onstop = async () => {
      // Some browsers stop automatically after microphone removal.
      if (recording) { interrupted = true; stopRecording(true); }
      attachAudio(new Blob(chunks,{type:recorder.mimeType || mime}),accumulated); chunks = [];
      finalizing = false; controls();
      $('record-state').textContent = interrupted ? 'Nagranie przerwane — sprawdź fragment' : 'Nagranie zakończone';
      if(!await ensureAudioSaved())return;
      if (interrupted) { showError('Nagrywanie zostało przerwane (mikrofon lub limit 24 MB). Odsłuchaj zachowany fragment. Możesz go pobrać albo przetworzyć jako niepełną konsultację.'); return; }
      await processAudio();
    };
    for (const track of stream.getAudioTracks()) track.addEventListener('ended',()=>stopRecording(true));
    recorder.start(1000); recording = true; startedAt = performance.now();
    $('record').textContent = '■ Zakończ i przygotuj zapis'; $('record-state').textContent = 'Nagrywanie w toku';
    $('recording-visual').classList.add('active'); timerInterval = setInterval(tick,500);
    try {
      audioContext = new AudioContext(); await audioContext.resume(); analyser = audioContext.createAnalyser(); analyser.fftSize = 256;
      audioContext.createMediaStreamSource(stream).connect(analyser); const data = new Uint8Array(analyser.fftSize); $('level').hidden = false;
      const draw = () => { analyser.getByteTimeDomainData(data); $('level').value = paused ? 0 : Math.min(1,Math.sqrt(data.reduce((s,n)=>s+((n-128)/128)**2,0)/data.length)*5); meterFrame=requestAnimationFrame(draw); }; draw();
    } catch { /* Meter is optional; recording continues without it. */ }
  } catch (error) {
    cleanupMicrophone();
    showError(error.name === 'NotAllowedError' ? 'Brak zgody na mikrofon. Zezwól na dostęp w przeglądarce i spróbuj ponownie.' : error.name === 'NotFoundError' ? 'Nie znaleziono mikrofonu. Podłącz go lub wczytaj nagranie.' : error.message || 'Nie udało się rozpocząć nagrywania.');
  } finally { starting = false; controls(); }
}

$('record').onclick = () => recording ? stopRecording() : startRecording();
$('pause').onclick = () => {
  if (!recording) return;
  if (paused) { recorder.resume(); startedAt = performance.now(); paused = false; }
  else { recorder.pause(); accumulated += performance.now()-startedAt; paused = true; }
  $('pause').textContent = paused ? 'Wznów nagrywanie' : 'Wstrzymaj';
  $('record-state').textContent = paused ? 'Nagrywanie wstrzymane' : 'Nagrywanie w toku';
  $('recording-visual').classList.toggle('paused',paused); tick();
};
$('process-audio').onclick = processAudio;
$('backup-download').onclick = () => {
  $('backup-status').textContent = 'Pobieranie zostało zlecone przeglądarce. Sprawdź zapisany plik. Transkrypcja ruszy dopiero po kliknięciu „Rozpocznij transkrypcję”.';
};
$('backup-continue').onclick = () => $('audio-backup').close('continue');
$('backup-cancel').onclick = () => $('audio-backup').close('cancel');
$('generate').onclick = generateNote;
$('upload-button').onclick = () => $('audio-file').click();
$('audio-file').onchange = async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  // As in the reference app, the declared container wins over the filename.
  const mime = audioMime(file.type, file.name);
  if (!mime) { showError('Wybierz plik WEBM, MP3, M4A, MP4, WAV, OGG, FLAC lub AAC.'); return; }
  if (file.size > MAX_AUDIO || file.size < 2000) { showError('Wybierz niepuste nagranie do 24 MB. Długie nagranie WAV trzeba najpierw skompresować.'); return; }
  if (hasMaterial() && !allowReplace()) return;
  reset(!hasMaterial()); interrupted = false; attachAudio(file.slice(0,file.size,mime)); $('record-state').textContent = 'Nagranie gotowe do przetworzenia'; await ensureAudioSaved();
};
$('paste-button').onclick = () => { $('transcript-details').open = true; $('transcript').focus(); $('transcript-details').scrollIntoView({block:'center',behavior:'smooth'}); };
$('transcript').oninput = () => { if ($('note').value) $('document-status').textContent = 'Transkrypcja zmieniona'; historyChanged(); };
$('note').oninput = () => { $('document-status').textContent = demoMode ? 'Przykład · edytowany' : 'Edytowany przez Ciebie'; updateCount(); historyChanged(); };
$('note').addEventListener('blur',()=> { const value=$('note').value.replace(/\s*\n\s*/g,' ').trim(); if(value!==$('note').value){$('note').value=value;historyChanged();} updateCount(); });
$('copy').onclick = async () => {
  const text = $('note').value.replace(/\s*\n\s*/g,' ').trim(); if (!text) return;
  try { await navigator.clipboard.writeText(text); toast('Zapis skopiowany'); }
  catch { $('note').focus(); $('note').select(); toast('Zaznaczono tekst. Naciśnij Ctrl+C, aby skopiować.'); }
};
$('new-visit').onclick = () => { if (allowReplace()) reset(); };
$('demo').onclick = async () => {
  if (!allowReplace()) return;
  try { const data = await api('/api/demo'); reset(); demoMode = true; $('transcript').value = data.transcript; $('demo-banner').textContent = 'PRZYKŁAD · Fikcyjna wizyta i ręcznie przygotowany zapis. To nie jest wynik działania AI.'; $('demo-banner').hidden = false; renderNote(data.note); }
  catch(error) { showError(error.message); }
};
$('settings-open').onclick = openSettings; $('setup-button').onclick = openSettings;
$('check-gemini').onclick = async()=>{
  $('check-gemini').disabled=true;
  $('gemini-status').textContent='Sprawdzam odpowiedź modeli Gemini…';
  try {
    const result=await api('/api/check',{method:'POST'});
    $('gemini-status').textContent=result.checks.map(c=>`${c.stage==='transcription'?'Transkrypcja':'Podsumowanie'} (${c.model}): ${c.ok?'odpowiedź OK w '+(c.elapsedMs/1000).toFixed(1)+' s':c.error}`).join('\n');
  }catch(error){$('gemini-status').textContent=error.message;}
  finally{$('check-gemini').disabled=false;}
};
$('settings-close').onclick = () => $('settings').close();
$('settings-form').onsubmit = event => {
  event.preventDefault(); selectedProvider=$('provider').value;
  $('settings').close(); toast('Transkrypcja: '+(selectedProvider==='elevenlabs'?'ElevenLabs Scribe v2':'Gemini'));
};
$('share-link').onclick = async () => {
  try { await navigator.clipboard.writeText(location.origin); toast('Link skopiowany. Możesz wysłać go testerowi.'); }
  catch { prompt('Skopiuj link do aplikacji:',location.origin); }
};
window.addEventListener('beforeunload',event=> { if (audioSaving || recording || busy || blob || historyDirty || historyWriting) { event.preventDefault(); event.returnValue=''; } });
$('session-date').textContent = new Date().toLocaleDateString('pl-PL',{day:'numeric',month:'short'});
api('/api/config').then(data=> { config=data; $('admin-link').hidden=!data.isAdmin; selectedProvider=data.defaultProvider; $('setup-banner').hidden=data.configured; initHistory(); controls(); }).catch(error=>showError(error.message));

function resetVisitHistory() {
  clearTimeout(historyTimer); visitId=null; processingRunId=null; visitRevision=0; historyDirty=false;
  $('visit-title').value='Wizyta · '+new Date().toLocaleString('pl-PL',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  $('save-status').textContent=config?.user?'Nowa wizyta. Tekst będzie zapisywany automatycznie.':'Zaloguj się przed nagrywaniem, aby zachować historię.';
}
function initHistory() {
  $('account-label').textContent=config.user?`Zalogowano: ${config.user.displayName}`:'Historia jest dostępna po zalogowaniu.';
  $('account-link').textContent=config.user?'Wyloguj':'Zaloguj, aby zapisywać historię';
  $('account-link').href=config.user?config.signOutPath:config.signInPath;
  $('history-login').href=config.signInPath;
  if(!$('visit-title').value) resetVisitHistory();
  if(historyDirty) scheduleHistorySave();
}
function historyChanged() {
  if(demoMode) return;
  historyDirty=true;
  $('save-status').textContent=config?.user?'Niezapisane zmiany…':'Tekst jest tylko w tej karcie. Historia wymaga zalogowania.';
  scheduleHistorySave();
}
function scheduleHistorySave() {
  clearTimeout(historyTimer);
  if(config?.user && historyDirty && !demoMode) historyTimer=setTimeout(()=>saveHistory(),900);
}
async function saveHistory() {
  clearTimeout(historyTimer);
  if(!config?.user || demoMode || !historyDirty || historyWriting || historyLoading || busy || recording || backupPending || finalizing) return false;
  if(!$('visit-title').value.trim()) {$('save-status').textContent='Nadaj nazwę wizycie, aby ją zapisać.';return false;}
  visitId ||= crypto.randomUUID();
  const snapshot={id:visitId,revision:visitRevision,title:$('visit-title').value,transcript:$('transcript').value,note:$('note').value,originalNote};
  historyWriting=true; controls(); $('save-status').textContent='Zapisuję w historii…';
  try {
    const result=await api('/api/visits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot)});
    visitRevision=result.visit.revision; historyDirty=false;
    $('save-status').textContent='Zapisano w historii · '+new Date(result.visit.updated_at).toLocaleTimeString('pl-PL',{hour:'2-digit',minute:'2-digit'});
    return true;
  } catch(error) {
    $('save-status').textContent='Nie zapisano. '+error.message+' Użyj „Zapisz wizytę”, aby ponowić.';
    return false;
  } finally {historyWriting=false;controls();}
}
async function loadHistory(offset=0) {
  $('history-message').textContent='Wczytuję historię…'; $('history-more').disabled=true;
  if(!offset) $('history-list').replaceChildren();
  try {
    const data=await api('/api/visits?offset='+offset);
    for(const visit of data.visits) {
      const row=document.createElement('div');row.className='history-row';
      const open=document.createElement('button');open.type='button';open.className='history-entry';
      const title=document.createElement('strong');title.textContent=visit.title;
      const date=document.createElement('span');date.textContent='Utworzono '+new Date(visit.created_at).toLocaleString('pl-PL')+' · Zmieniono '+new Date(visit.updated_at).toLocaleString('pl-PL');
      open.append(title,date);open.onclick=()=>openVisit(visit.id);
      const remove=document.createElement('button');remove.type='button';remove.className='quiet history-delete';remove.textContent='Usuń';remove.setAttribute('aria-label','Usuń wizytę '+visit.title);
      remove.onclick=async()=>{
        if(!confirm(`Usunąć wizytę „${visit.title}” razem z jej nagraniami? Nie można tego cofnąć.`)) return;
        remove.disabled=true;open.disabled=true;
        try {
          const deletion=await api('/api/visits',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:visit.id,revision:visit.revision})});
          if(visitId===visit.id){savedAudioId=null;audioUploadId=crypto.randomUUID();$('saved-audio-list').replaceChildren();$('audio-save-status').textContent='Usunięto zapis audio z historii. Kopia pozostaje w tej karcie.';clearTimeout(historyTimer);visitId=null;visitRevision=0;historyDirty=false;$('save-status').textContent='Usunięto z historii. Tekst pozostaje w tej karcie.';}
          await loadHistory(0);
          if(deletion.cleanupPending)$('history-message').textContent='Wizyta jest usunięta. Usuwanie pliku audio wymaga ponowienia — otwórz historię ponownie.';
        } catch(error){$('history-message').textContent=error.message;remove.disabled=false;open.disabled=false;}
      };
      const feedbackButton=document.createElement('button');feedbackButton.type='button';feedbackButton.className='quiet';feedbackButton.textContent='Przekaż feedback';feedbackButton.onclick=()=>openFeedback(visit.id);
      const retry=document.createElement('button');retry.type='button';retry.className='secondary';retry.textContent='Ponów próbę zrobienia notatki';retry.hidden=!visit.hasAudio;retry.onclick=()=>retryVisit(visit.id);
      row.append(open,retry,feedbackButton,remove);$('history-list').append(row);
    }
    historyNext=data.nextOffset;
    $('history-more').hidden=historyNext===null;
    $('history-message').textContent=$('history-list').children.length?'Wybierz wizytę, aby wrócić do tekstu.':'Nie masz jeszcze zapisanych wizyt.';
  } catch(error){$('history-message').textContent=error.message;}
  finally {$('history-more').disabled=false;}
}
async function openVisit(id) {
  if(busy || recording || audioSaving || historyLoading || historyWriting || !allowReplace())return false;
  clearTimeout(historyTimer);historyLoading=true;controls();
  $('history-message').textContent='Otwieram wizytę…';
  try {
    const {visit}=await api('/api/visits?id='+encodeURIComponent(id));
    reset(); processingRunId=null; visitId=visit.id;visitRevision=visit.revision;
    $('visit-title').value=visit.title;$('transcript').value=visit.transcript;
    originalNote=visit.original_note??null;
    if(visit.note)renderNote(visit.note);
    $('transcript-details').open=Boolean(visit.transcript)&&!visit.note;
    $('save-status').textContent='Wizyta z historii. Zmiany zapisują się automatycznie.';
    await loadVisitAudio(visit.id);
    $('record-state').textContent=savedAudioId?'Wczytano wizytę z nagraniem':'Wczytano tekst wizyty';
    $('history-dialog').close();
    return true;
  } catch(error){$('history-message').textContent=error.message;return false;}
  finally {historyLoading=false;controls();}
}
$('visit-title').oninput=historyChanged;
$('save-visit').onclick=()=>{if(!historyDirty)historyDirty=true;saveHistory();};
$('history-open').onclick=async()=>{
  if(historyDirty && config?.user) await saveHistory();
  $('history-dialog').showModal();
  $('history-login').hidden=Boolean(config?.user);
  if(!config?.user){$('history-list').replaceChildren();$('history-more').hidden=true;$('history-message').textContent='Zaloguj się przez ChatGPT. Każda osoba widzi tylko swoje wizyty.';return;}
  await loadHistory();
};
$('history-close').onclick=()=>$('history-dialog').close();
$('history-more').onclick=()=>{if(historyNext!==null)loadHistory(historyNext);};
$('account-link').onclick=$('history-login').onclick=event=>{
  if((hasMaterial()||historyDirty)&&!confirm('Logowanie lub wylogowanie opuści tę kartę. Najpierw pobierz audio i zachowaj niezapisany tekst. Kontynuować?'))event.preventDefault();
};

let feedbackVisit=null,feedbackSending=false,feedbackDirty=false,feedbackRequestId=null;
async function openFeedback(id){
 if(feedbackSending)return;
 // Freeze a server-saved snapshot. Feedback edits never change the visit itself.
 $('feedback-error').textContent='';$('feedback-send').disabled=true;$('feedback-original').value='';$('feedback-corrected').value='';$('feedback-comment').value='';$('feedback-share').checked=false;
 feedbackVisit=null;feedbackDirty=false;feedbackRequestId=crypto.randomUUID();$('feedback-sent').replaceChildren();$('feedback-dialog').showModal();
 try{const {visit}=await api('/api/visits?id='+encodeURIComponent(id));if(!$('feedback-dialog').open)return;
 feedbackVisit=visit;$('feedback-original').value=visit.original_note??visit.note;$('feedback-corrected').value=visit.note;
 $('feedback-original-label').textContent=visit.original_note==null?'Wersja zapisana w historii (dla tej wizyty nie zachowano wyniku AI sprzed edycji)':'Oryginalny wynik AI';
 $('feedback-send').disabled=!$('feedback-original').value.trim();
 if($('feedback-send').disabled)$('feedback-error').textContent='Ta wizyta nie ma jeszcze zapisanej notatki.';
 await loadSentFeedback();
 }catch(e){$('feedback-error').textContent=e.message;}
}
async function loadSentFeedback(){if(!feedbackVisit)return;const data=await api('/api/feedback?visitId='+encodeURIComponent(feedbackVisit.id));$('feedback-sent').replaceChildren();for(const item of data.feedback){const row=document.createElement('p'),button=document.createElement('button');row.textContent='Wysłano '+new Date(item.created_at).toLocaleString('pl-PL')+' ';button.type='button';button.className='quiet';button.textContent='Wycofaj udostępnienie';button.onclick=async()=>{if(!confirm('Usunąć ten feedback z panelu właściciela? Nie cofnie to ewentualnych kopii wykonanych wcześniej.'))return;button.disabled=true;try{await api('/api/feedback',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id})});await loadSentFeedback();}catch(e){$('feedback-error').textContent=e.message;button.disabled=false;}};row.append(button);$('feedback-sent').append(row);}}
for(const id of ['feedback-corrected','feedback-comment'])$(id).oninput=()=>{feedbackDirty=true;feedbackRequestId=crypto.randomUUID();};
function closeFeedback(){if(feedbackSending)return;if(feedbackDirty&&!confirm('Odrzucić niewysłany feedback?'))return;feedbackDirty=false;$('feedback-dialog').close();}
$('feedback-close').onclick=closeFeedback;
$('feedback-dialog').addEventListener('cancel',e=>{e.preventDefault();closeFeedback();});
$('feedback-send').onclick=async()=>{
 if(feedbackSending||!feedbackVisit)return;
 if(!$('feedback-share').checked){$('feedback-error').textContent='Zaznacz zgodę na udostępnienie obu wersji i komentarza.';return;}
 feedbackSending=true;$('feedback-send').disabled=true;$('feedback-close').disabled=true;$('feedback-corrected').readOnly=true;$('feedback-comment').readOnly=true;
 $('feedback-error').textContent='Wysyłam…';
 try{await api('/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:feedbackRequestId,visitId:feedbackVisit.id,revision:feedbackVisit.revision,corrected:$('feedback-corrected').value,comment:$('feedback-comment').value,share:true})});feedbackDirty=false;$('feedback-share').checked=false;$('feedback-error').textContent='Wysłano. Właściciel widzi teraz obie wersje i komentarz. Notatka w historii pozostaje bez zmian.';await loadSentFeedback();}
 catch(e){$('feedback-error').textContent=e.message;}
 finally{feedbackSending=false;$('feedback-send').disabled=false;$('feedback-close').disabled=false;$('feedback-corrected').readOnly=false;$('feedback-comment').readOnly=false;}
};
window.addEventListener('beforeunload',e=>{if(feedbackDirty||feedbackSending){e.preventDefault();e.returnValue='';}});

async function ensureAudioSaved(){
 if(savedAudioId)return true;if(!blob||audioSaving)return false;
 audioSaving=true;controls();$('record-state').textContent='Zapisuję audio w historii — nie zamykaj karty…';
 try{
  if(!visitId||visitRevision===0||historyDirty){historyDirty=true;if(!await saveHistory())throw new Error('Nie udało się zapisać wizyty. Użyj „Zapisz wizytę”, a następnie ponów zapis audio.');}
  audioUploadId ||= crypto.randomUUID();
  const result=await api('/api/audio',{method:'POST',headers:{'Content-Type':blob.type.split(';')[0],'X-Visit-Id':visitId,'X-Audio-Id':audioUploadId,...(audioDurationMs>0?{'X-Audio-Duration-Ms':String(Math.round(audioDurationMs))}:{})},body:blob});
  savedAudioId=result.audio.id;$('record-state').textContent='Audio zapisane w historii';$('audio-save-status').textContent='Nagranie zapisane — możesz wrócić do niego z historii.';return true;
 }catch(e){$('audio-save-status').textContent='Audio NIE zostało zapisane. Nie zamykaj karty. Ponów zapis albo pobierz plik.';showError(e.message);return false;}
 finally{audioSaving=false;controls();}
}
async function loadVisitAudio(id){
 $('saved-audio-list').replaceChildren();
 const data=await api('/api/audio?visitId='+encodeURIComponent(id));
 for(const item of data.audio){const row=document.createElement('div'),button=document.createElement('button'),download=document.createElement('a');button.className='quiet';button.type='button';button.textContent='Wczytaj nagranie · '+new Date(item.created_at).toLocaleString('pl-PL')+' · '+(item.bytes/1024/1024).toFixed(1)+' MB';download.href='/api/audio?id='+encodeURIComponent(item.id);download.className='quiet';download.textContent='Pobierz';download.download='nagranie';button.onclick=async()=>{if(busy||recording||audioSaving)return;historyLoading=true;controls();try{await fetchSavedAudio(item);}catch(e){showError(e.message);}finally{historyLoading=false;controls();}};row.append(button,download);$('saved-audio-list').append(row);}
 if(data.audio.length)await fetchSavedAudio(data.audio[0]);
}
async function fetchSavedAudio(item){const response=await fetch('/api/audio?id='+encodeURIComponent(item.id));if(!response.ok)throw new Error('Nie udało się wczytać nagrania. Spróbuj ponownie z historii.');const file=await response.blob();attachAudio(file,item.duration_ms);savedAudioId=item.id;audioUploadId=item.id;$('audio-save-status').textContent='Nagranie wczytane z historii.';}
$('save-audio').onclick=()=>ensureAudioSaved();

async function retryVisit(id){
 if(!await openVisit(id))return;
 if(!savedAudioId){showError('Nie ma zapisanego nagrania dla tej wizyty.');return;}
 if($('transcript').value.trim()){
  await generateNote();
 }else await processAudio();
 if(historyDirty&&!busy)await saveHistory();
}
