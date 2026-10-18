const $=id=>document.getElementById(id),chatList=$('chat-list'),activityLine=$('activity-line');let settings={aiMode:'local',localModel:'llama3.2',cloudModel:'gpt-4o-mini',voiceLanguage:'auto',wakeMode:'low',wakeOnLaunch:false,autoStart:false,speakResponses:true},wakeEnabled=false,wakeRecognizer=null,commandRecognizer=null,commandTimeout=null,processingVoice=false,companionUrl='';
function status(t){$('system-status').textContent=String(t).toUpperCase();}function activity(t){activityLine.textContent=String(t||'');}
function addMessage(role,text,source){const box=document.createElement('div');box.className='message '+role;const who=document.createElement('div');who.className='message-role';who.textContent=role==='assistant'?'JARVIS':source==='android'?'ANDROID':'YOU';const body=document.createElement('div');body.textContent=String(text||'');box.append(who,body);chatList.append(box);while(chatList.children.length>40)chatList.removeChild(chatList.firstChild);chatList.scrollTop=chatList.scrollHeight;}
function hindi(t){return /[\u0900-\u097F]|\b(haan|nahi|kya|kaise|aaj|kal|kholo|batao|yaad)\b/i.test(t);}function speak(t,after){if(!$('speak-responses').checked||!speechSynthesis||!t){if(after)after();return;}speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(String(t).slice(0,1800)),lang=settings.voiceLanguage==='auto'?(hindi(t)?'hi-IN':'en-IN'):settings.voiceLanguage;u.lang=lang;u.rate=1.02;const vs=speechSynthesis.getVoices(),v=vs.find(x=>x.lang.toLowerCase()===lang.toLowerCase())||vs.find(x=>x.lang.toLowerCase().startsWith(lang.split('-')[0]));if(v)u.voice=v;u.onend=()=>after&&after();u.onerror=()=>after&&after();speechSynthesis.speak(u);}
async function runCommand(command,voice=false,source='desktop'){const t=String(command||'').trim();if(!t)return;addMessage('user',t,source);activity('Processing command…');$('send-command').disabled=true;try{const r=await window.jarvis.runCommand(t);addMessage('assistant',r.message||'Done.');activity(r.message||'Command completed.');if(voice||$('speak-responses').checked)speak(r.message||'Done.');return r;}catch(e){addMessage('assistant','Command failed: '+e.message);activity('Command failed.');}finally{$('send-command').disabled=false;$('chat-input').value='';}}
function renderNotes(items){const ul=$('notes-list');ul.replaceChildren();const a=(items||[]).slice().reverse();if(!a.length){const li=document.createElement('li');li.className='empty';li.textContent='No saved notes yet.';ul.append(li);return;}a.forEach(n=>{const li=document.createElement('li'),s=document.createElement('span'),b=document.createElement('button');s.textContent=n.text;b.className='delete-btn';b.textContent='×';b.title='Delete note';b.onclick=()=>window.jarvis.deleteNote(n.id);li.append(s,b);ul.append(li);});}
function renderReminders(items){const ul=$('reminders-list');ul.replaceChildren();const a=(items||[]).filter(r=>!r.done).sort((x,y)=>x.dueAt-y.dueAt);if(!a.length){const li=document.createElement('li');li.className='empty';li.textContent='No pending reminders.';ul.append(li);return;}a.slice(0,20).forEach(r=>{const li=document.createElement('li'),w=document.createElement('div'),s=document.createElement('span'),tm=document.createElement('small'),b=document.createElement('button');s.textContent=r.text;tm.textContent=new Date(r.dueAt).toLocaleString();w.append(s,tm);b.className='delete-btn';b.textContent='×';b.title='Cancel reminder';b.onclick=()=>window.jarvis.deleteReminder(r.id);li.append(w,b);ul.append(li);});}
function localStatus(d){if(!d||!d.available){$('ai-status').textContent='Ollama not detected. Install it, start it, and download a model such as llama3.2.';$('ai-status').className='small-note warning';}else{$('ai-status').textContent='Ollama running. Models: '+((d.models||[]).join(', ')||'none downloaded')+'.';$('ai-status').className='small-note success';}}
async function init(){try{const d=await window.jarvis.getInitial();settings=d.settings||settings;$('platform-label').textContent=String(d.platform||'desktop').toUpperCase();$('ai-mode').value=settings.aiMode;$('local-model').value=settings.localModel;$('cloud-model').value=settings.cloudModel;$('voice-language').value=settings.voiceLanguage;$('wake-mode').value=settings.wakeMode;$('auto-start').checked=!!settings.autoStart;$('wake-on-launch').checked=!!settings.wakeOnLaunch;$('speak-responses').checked=settings.speakResponses!==false;$('ai-mode-label').textContent=settings.aiMode==='cloud'?'CLOUD AI':'LOCAL AI';$('wake-mode-label').textContent=settings.wakeMode==='smart'?'SMART READY':'LOW POWER';$('voice-engine-label').textContent=d.hasApiKey?'CLOUD KEY SAVED':'VOICE READY';renderNotes(d.notes||[]);renderReminders(d.reminders||[]);localStatus(d.localAI);const f=(d.companion?.links||[])[0];if(f){companionUrl=f.url;$('companion-url').textContent=f.url;$('companion-url').href=f.url;$('pairing-qr').src=f.qr;$('pairing-qr').hidden=false;$('copy-companion').disabled=false;$('companion-status').textContent='Android companion ready: '+f.ip+':'+d.companion.port;}else{$('companion-status').textContent='No active Wi-Fi/LAN address. Connect to Wi-Fi and restart JARVIS.';$('companion-url').textContent='No local network link found';} (d.history||[]).forEach(m=>addMessage(m.role==='assistant'?'assistant':'user',m.content));status('System ready');if(settings.wakeOnLaunch){wakeEnabled=false;updateWake();activity('Always-on wake word is unavailable in this Electron build. Use Speak a command.');}}catch(e){activity('Could not load settings: '+e.message);}}
function updateWake(){
 $('wake-toggle').textContent='Always-on wake word unavailable';
 $('wake-toggle').disabled=true;
 $('wake-toggle').title='Use the Speak a command button instead.';
 $('hero-state').textContent=processingVoice?'Recording / transcribing…':'At your service.';
 $('orb-wrap').classList.toggle('active',processingVoice);
 $('wake-status').textContent='Tap “Speak a command” to record. Transcription sends audio to OpenAI and may incur API charges. Always-on “Jarvis” wake word is not supported in this Electron build.';
}
function stopSpeech(){if(voiceRecorder&&voiceRecorder.state!=='inactive'){try{voiceRecorder.stop();}catch{}}}
async function startWake(){wakeEnabled=false;updateWake();}
function runVoice(t){processingVoice=true;updateWake();runCommand(t,true).finally(()=>{processingVoice=false;updateWake();});}
let voiceRecorder=null,voiceStream=null,voiceChunks=[];
async function listenOnce(){
 if(voiceRecorder&&voiceRecorder.state==='recording'){voiceRecorder.stop();return;}
 if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){activity('Microphone recording is unavailable in this build. You can type a command.');return;}
 try{
  const permission=await window.jarvis.requestMicrophone();
  if(!permission?.ok){activity(permission?.message||'Microphone permission was not granted.');return;}
  voiceStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  voiceChunks=[];
  const mt=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(x=>MediaRecorder.isTypeSupported(x));
  voiceRecorder=new MediaRecorder(voiceStream,mt?{mimeType:mt}:undefined);
  const recorder=voiceRecorder;
  recorder.ondataavailable=e=>{if(e.data&&e.data.size)voiceChunks.push(e.data);};
  recorder.onerror=e=>activity('Recording error: '+(e.error?.message||'microphone failed'));
  recorder.onstop=async()=>{
   const stream=voiceStream;voiceStream=null;
   if(stream)stream.getTracks().forEach(t=>t.stop());
   $('listen-once').textContent='Speak a command';
   const blob=new Blob(voiceChunks,{type:recorder.mimeType||'audio/webm'});
   voiceChunks=[];voiceRecorder=null;
   if(blob.size<1500){processingVoice=false;updateWake();activity('No clear audio captured. Please try again.');return;}
   processingVoice=true;updateWake();activity('Transcribing audio securely through your saved OpenAI API key…');
   try{
    const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
    for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
    const result=await window.jarvis.transcribeAudio({audio:btoa(binary),mimeType:(blob.type||'audio/webm').split(';')[0]});
    if(!result?.ok){addMessage('assistant',result?.message||'Could not transcribe voice.');activity(result?.message||'Transcription failed.');return;}
    const transcript=String(result.text||'').trim();
    if(!transcript){activity('No speech detected. Please try again.');return;}
    await runCommand(transcript,true);
   }catch(e){addMessage('assistant','Voice input failed: '+e.message);activity('Voice input failed: '+e.message);}
   finally{processingVoice=false;updateWake();}
  };
  recorder.start();
  processingVoice=true;updateWake();
  $('listen-once').textContent='Stop recording';
  activity('Recording microphone. Speak your command, then tap Stop recording.');
 }catch(e){
  if(voiceStream)voiceStream.getTracks().forEach(t=>t.stop());voiceStream=null;voiceRecorder=null;processingVoice=false;updateWake();
  activity('Could not access microphone: '+e.message+'. Check System Settings → Privacy & Security → Microphone.');
 }
}
$('wake-toggle').onclick=()=>{activity('Always-on wake word is unavailable in this Electron build. Tap Speak a command to record your voice.');};
$('listen-once').onclick=()=>listenOnce();
$('chat-form').onsubmit=async e=>{e.preventDefault();await runCommand($('chat-input').value);};$('clear-chat').onclick=()=>{chatList.replaceChildren();addMessage('assistant','Conversation cleared from this window. Saved notes remain.');};
document.querySelectorAll('[data-app]').forEach(b=>b.onclick=async()=>{const r=await window.jarvis.openApp(b.dataset.app);addMessage('assistant',r.message);activity(r.message);if(r.ok)speak(r.message);});document.querySelectorAll('[data-command]').forEach(b=>b.onclick=()=>runCommand(b.dataset.command));
$('open-url').onclick=async()=>{const r=await window.jarvis.openUrl($('url-input').value.trim());addMessage('assistant',r.message);activity(r.message);if(r.ok)speak(r.message);};$('url-input').onkeydown=e=>{if(e.key==='Enter')$('open-url').click();};
$('run-python').onclick=async()=>{const r=await window.jarvis.pickPython();if(r.message){addMessage('assistant',r.message);activity(r.message);}};
$('save-note').onclick=async()=>{const t=$('note-input').value.trim();if(!t)return;const r=await window.jarvis.saveNote(t);$('note-input').value='';addMessage('assistant',r.message);activity(r.message);};$('note-input').onkeydown=e=>{if(e.key==='Enter')$('save-note').click();};
$('reminder-form').onsubmit=async e=>{e.preventDefault();const v=$('reminder-text').value.trim(),m=v.match(/^(.+?)\s+in\s+(\d+)\s*(seconds?|minutes?|mins?|hours?|hrs?|days?)$/i)||v.match(/^remind me in\s+(\d+)\s*(seconds?|minutes?|mins?|hours?|hrs?|days?)\s+to\s+(.+)$/i);if(!m){activity('Format: “Take a break in 10 minutes”');return;}let task,count,unit;if(v.toLowerCase().startsWith('remind me')){count=+m[1];unit=m[2].toLowerCase();task=m[3];}else{task=m[1];count=+m[2];unit=m[3].toLowerCase();}const mult=unit.startsWith('sec')?1000:unit.startsWith('min')?60000:unit.startsWith('hour')||unit.startsWith('hr')?3600000:86400000;const r=await window.jarvis.addReminder({text:task,delayMs:count*mult});addMessage('assistant',r.message);activity(r.message);$('reminder-text').value='';};
$('save-settings').onclick=async()=>{const r=await window.jarvis.saveSettings({aiMode:$('ai-mode').value,localModel:$('local-model').value.trim(),cloudModel:$('cloud-model').value.trim(),voiceLanguage:$('voice-language').value,wakeMode:$('wake-mode').value,wakeOnLaunch:$('wake-on-launch').checked,autoStart:$('auto-start').checked,speakResponses:$('speak-responses').checked,apiKey:$('api-key').value,clearApiKey:$('clear-api-key').checked});if(!r.ok){activity(r.message||'Could not save settings.');return;}settings=r.settings;$('api-key').value='';$('clear-api-key').checked=false;$('ai-mode-label').textContent=settings.aiMode==='cloud'?'CLOUD AI':'LOCAL AI';$('wake-mode-label').textContent=settings.wakeMode==='smart'?'SMART READY':'LOW POWER';$('voice-engine-label').textContent=r.hasApiKey?'CLOUD KEY SAVED':'VOICE READY';activity(r.message);if(wakeEnabled){wakeEnabled=false;stopSpeech();updateWake();activity('Settings saved. Enable wake word again to apply changes.');}};
$('check-local').onclick=async()=>{const r=await window.jarvis.getInitial();localStatus(r.localAI);activity('Local AI status refreshed.');};$('copy-companion').onclick=async()=>{if(companionUrl){await window.jarvis.copyText(companionUrl);activity('Pairing link copied. Keep it private.');}};
$('speak-responses').onchange=async()=>{const r=await window.jarvis.saveSettings({speakResponses:$('speak-responses').checked});if(r.ok)settings=r.settings;};$('wake-mode').onchange=()=>activity($('wake-mode').value==='smart'?'Smart mode may use more battery.':'Low-power mode may miss wake words between phrases.');
window.jarvis.on('jarvis:notes',renderNotes);window.jarvis.on('jarvis:reminders',renderReminders);window.jarvis.on('jarvis:activity',e=>activity(e.text));window.jarvis.on('jarvis:user-command',e=>{if(e.source==='android'){addMessage('user',e.command,'android');activity('Command received from Android.');}});window.jarvis.on('jarvis:reminder-fired',r=>{addMessage('assistant','Reminder: '+r.text);speak('Reminder. '+r.text);});window.jarvis.on('jarvis:pick-python-request',async()=>{const r=await window.jarvis.pickPython();if(r.message){addMessage('assistant',r.message);activity(r.message);}});updateWake();init();