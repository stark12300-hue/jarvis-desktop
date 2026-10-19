const $ = id => document.getElementById(id);
const chatList = $('chat-list');
const activityLine = $('activity-line');

let settings = {
  aiMode: 'gemini',
  localModel: 'llama3.2',
  cloudModel: 'gemini-3.8-flash',
  voiceLanguage: 'auto',
  wakeMode: 'low',
  wakeOnLaunch: false,
  autoStart: false,
  speakResponses: true
};

let wakeEnabled = false;
let wakeRecognizer = null;
let commandRecognizer = null;
let processingVoice = false;
let isSpeaking = false;
let companionUrl = '';
let voiceStream = null;
let voiceRecorder = null;

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

function status(t) {
  $('system-status').textContent = String(t).toUpperCase();
}

function activity(t) {
  activityLine.textContent = String(t || '');
}

function addMessage(role, text, source) {
  const box = document.createElement('div');
  box.className = 'message ' + role;
  const who = document.createElement('div');
  who.className = 'message-role';
  who.textContent = role === 'assistant' ? 'JARVIS' : source === 'android' ? 'ANDROID' : 'YOU';
  const body = document.createElement('div');
  body.textContent = String(text || '');
  box.append(who, body);
  chatList.append(box);
  while (chatList.children.length > 40) chatList.removeChild(chatList.firstChild);
  chatList.scrollTop = chatList.scrollHeight;
}

function hindi(t) {
  return /[\u0900-\u097F]|\b(haan|nahi|kya|kaise|aaj|kal|kholo|batao|yaad|sun|sunoji|shukriya|namaste|theek|kardo)\b/i.test(t);
}

async function speak(t, after) {
  if (!$('speak-responses').checked || !t) {
    if (after) after();
    return;
  }

  isSpeaking = true;
  // Temporarily pause wake word while assistant speaks to prevent self-triggering
  if (wakeRecognizer) {
    try { wakeRecognizer.stop(); } catch (e) {}
  }

  const resumeWake = () => {
    isSpeaking = false;
    if (after) after();
    if (wakeEnabled && !processingVoice) {
      setTimeout(startWakeRecognizer, 400);
    }
  };

  if (settings.aiMode === 'gemini') {
    let url = '';
    try {
      activity('Generating natural voice reply…');
      const result = await window.jarvis.speakText(String(t).slice(0, 1600));
      if (result?.ok && result.audio) {
        const bin = atob(result.audio);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType || 'audio/wav' }));
        const audio = new Audio(url);
        audio.onended = () => {
          URL.revokeObjectURL(url);
          resumeWake();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          resumeWake();
        };
        await audio.play();
        return;
      }
    } catch (e) {
      if (url) URL.revokeObjectURL(url);
      activity('Using browser voice: ' + e.message);
    }
  }

  const synth = window.speechSynthesis;
  if (!synth || !window.SpeechSynthesisUtterance) {
    activity('System speech unavailable.');
    resumeWake();
    return;
  }

  synth.cancel();
  const u = new SpeechSynthesisUtterance(String(t).slice(0, 1800));
  const isHi = hindi(t);
  const lang = settings.voiceLanguage === 'auto' ? (isHi ? 'hi-IN' : 'en-IN') : settings.voiceLanguage;
  u.lang = lang;
  u.rate = 0.98;
  u.pitch = 0.9;

  const vs = synth.getVoices();
  const v = vs.find(x => x.lang.toLowerCase() === lang.toLowerCase()) ||
            vs.find(x => x.lang.toLowerCase().startsWith(lang.split('-')[0])) ||
            vs.find(x => x.lang.includes('en'));
  if (v) u.voice = v;

  u.onend = () => resumeWake();
  u.onerror = () => resumeWake();
  synth.speak(u);
}

async function runCommand(command, voice = false, source = 'desktop') {
  const t = String(command || '').trim();
  if (!t) return;
  addMessage('user', t, source);
  activity('Processing command…');
  $('send-command').disabled = true;

  try {
    const r = await window.jarvis.runCommand(t);
    const reply = r.message || 'Done.';
    addMessage('assistant', reply);
    activity(reply);
    if (r.url) {
      try { window.open(r.url, '_blank'); } catch (e) {}
    }
    if (voice || $('speak-responses').checked) {
      speak(reply);
    }
    return r;
  } catch (e) {
    addMessage('assistant', 'Command failed: ' + e.message);
    activity('Command failed: ' + e.message);
  } finally {
    $('send-command').disabled = false;
    $('chat-input').value = '';
  }
}

function renderNotes(items) {
  const ul = $('notes-list');
  ul.replaceChildren();
  const a = (items || []).slice().reverse();
  if (!a.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No saved notes yet.';
    ul.append(li);
    return;
  }
  a.forEach(n => {
    const li = document.createElement('li');
    const s = document.createElement('span');
    const b = document.createElement('button');
    s.textContent = n.text;
    b.className = 'delete-btn';
    b.textContent = '×';
    b.title = 'Delete note';
    b.onclick = () => window.jarvis.deleteNote(n.id);
    li.append(s, b);
    ul.append(li);
  });
}

function renderReminders(items) {
  const ul = $('reminders-list');
  ul.replaceChildren();
  const a = (items || []).filter(r => !r.done).sort((x, y) => x.dueAt - y.dueAt);
  if (!a.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No pending reminders.';
    ul.append(li);
    return;
  }
  a.slice(0, 20).forEach(r => {
    const li = document.createElement('li');
    const w = document.createElement('div');
    const s = document.createElement('span');
    const tm = document.createElement('small');
    const b = document.createElement('button');
    s.textContent = r.text;
    tm.textContent = new Date(r.dueAt).toLocaleString();
    w.append(s, tm);
    b.className = 'delete-btn';
    b.textContent = '×';
    b.title = 'Cancel reminder';
    b.onclick = () => window.jarvis.deleteReminder(r.id);
    li.append(w, b);
    ul.append(li);
  });
}

function localStatus(d) {
  if (!d || !d.available) {
    $('ai-status').textContent = 'Ollama not detected. In cloud web mode, Gemini AI is ready to respond.';
    $('ai-status').className = 'small-note warning';
  } else {
    $('ai-status').textContent = 'Ollama running. Models: ' + ((d.models || []).join(', ') || 'none downloaded') + '.';
    $('ai-status').className = 'small-note success';
  }
}

function updateWake() {
  if (wakeEnabled) {
    $('wake-toggle').textContent = '🟢 “Jarvis” Wake Word: Active';
    $('wake-toggle').title = 'Click to stop listening for wake word';
    $('wake-mode-label').textContent = 'WAKE: ACTIVE';
    $('hero-state').textContent = processingVoice ? 'Processing voice command…' : 'Listening for “Jarvis”…';
    $('orb-wrap').classList.add('active');
    $('wake-status').textContent = 'Wake word active! Say “Jarvis [your command]” or just “Jarvis” anytime to speak.';
  } else {
    $('wake-toggle').textContent = '🎙 Enable “Jarvis” Wake Word';
    $('wake-toggle').title = 'Click to start hands-free wake word listening';
    $('wake-mode-label').textContent = settings.wakeMode === 'smart' ? 'SMART READY' : 'LOW POWER';
    $('hero-state').textContent = processingVoice ? 'Listening to voice…' : 'At your service.';
    $('orb-wrap').classList.toggle('active', processingVoice);
    $('wake-status').textContent = 'Say “Jarvis [command]” after enabling wake word, or tap “Speak a command” below.';
  }
}

function extractWakeCommand(text) {
  if (!text) return null;
  const clean = text.trim();
  // Match "Hey Jarvis", "Jarvis", "जार्विस", "हे जार्विस" followed by optional command
  const patterns = [
    /^(?:hey\s+|hi\s+|ok\s+|hello\s+)?jarvis[\s,.:;-]*(.*)$/i,
    /^(?:हे\s+|सुनो\s+)?(?:जार्विस|जार्विसजी)[\s,.:;-]*(.*)$/i,
    /(?:^|\s)(?:hey\s+|hi\s+|ok\s+)?jarvis[\s,.:;-]+(.+)$/i
  ];
  for (const p of patterns) {
    const m = clean.match(p);
    if (m) return { matched: true, command: (m[1] || '').trim() };
  }
  if (/\b(?:jarvis|जार्विस)\b/i.test(clean)) {
    return { matched: true, command: clean.replace(/\b(?:jarvis|जार्विस)\b/gi, '').trim() };
  }
  return null;
}

function startWakeRecognizer() {
  if (!SpeechRec) {
    activity('Voice recognition is supported in Chrome, Edge, Safari, and Android.');
    wakeEnabled = false;
    updateWake();
    return;
  }

  stopWakeRecognizer();

  try {
    wakeRecognizer = new SpeechRec();
    wakeRecognizer.continuous = true;
    wakeRecognizer.interimResults = true;
    wakeRecognizer.lang = settings.voiceLanguage === 'hi-IN' ? 'hi-IN' : settings.voiceLanguage === 'en-IN' ? 'en-IN' : 'en-IN';

    wakeRecognizer.onstart = () => {
      activity('Listening for “Jarvis” wake word…');
    };

    wakeRecognizer.onresult = (event) => {
      if (processingVoice || isSpeaking) return;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        const wakeCheck = extractWakeCommand(transcript);

        if (wakeCheck && wakeCheck.matched) {
          stopWakeRecognizer();
          const cmd = wakeCheck.command;
          if (cmd) {
            activity('Heard: “Jarvis, ' + cmd + '”');
            runVoice(cmd);
          } else {
            activity('Wake word detected! Listening for your command…');
            speak('Yes, I am listening.', () => {
              listenOnce();
            });
          }
          return;
        }
      }
    };

    wakeRecognizer.onerror = (e) => {
      if (e.error === 'no-speech') return; // Natural timeout, keep going
      if (e.error === 'not-allowed') {
        activity('Microphone access was denied. Please allow microphone in browser.');
        wakeEnabled = false;
        updateWake();
      }
    };

    wakeRecognizer.onend = () => {
      if (wakeEnabled && !processingVoice && !isSpeaking) {
        setTimeout(() => {
          if (wakeEnabled && !processingVoice && !isSpeaking) {
            try { wakeRecognizer?.start(); } catch (e) {}
          }
        }, 300);
      }
    };

    wakeRecognizer.start();
  } catch (e) {
    console.warn('Wake recognizer start error:', e);
  }
}

function stopWakeRecognizer() {
  if (wakeRecognizer) {
    try {
      wakeRecognizer.onend = null;
      wakeRecognizer.onerror = null;
      wakeRecognizer.stop();
    } catch (e) {}
    wakeRecognizer = null;
  }
}

function runVoice(text) {
  processingVoice = true;
  updateWake();
  runCommand(text, true).finally(() => {
    processingVoice = false;
    updateWake();
    if (wakeEnabled && !isSpeaking) {
      setTimeout(startWakeRecognizer, 500);
    }
  });
}

async function listenOnce() {
  // If already listening, stop
  if (commandRecognizer) {
    try { commandRecognizer.stop(); } catch (e) {}
    commandRecognizer = null;
    $('listen-once').textContent = 'Speak a command';
    processingVoice = false;
    updateWake();
    if (wakeEnabled && !isSpeaking) startWakeRecognizer();
    return;
  }

  // If wake recognizer is running, stop it while user speaks command
  stopWakeRecognizer();

  if (SpeechRec) {
    try {
      commandRecognizer = new SpeechRec();
      commandRecognizer.continuous = false;
      commandRecognizer.interimResults = true;
      commandRecognizer.lang = settings.voiceLanguage === 'hi-IN' ? 'hi-IN' : 'en-IN';

      processingVoice = true;
      updateWake();
      $('listen-once').textContent = '⏹ Stop listening';
      activity('Listening… Speak now (Hindi or English).');

      let finalCaptured = '';

      commandRecognizer.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; ++i) {
          if (e.results[i].isFinal) {
            finalCaptured += e.results[i][0].transcript;
          } else {
            interim += e.results[i][0].transcript;
          }
        }
        if (interim) {
          $('chat-input').value = interim;
          activity('Hearing: “' + interim + '”…');
        }
        if (finalCaptured) {
          $('chat-input').value = finalCaptured;
          activity('Command: “' + finalCaptured + '”');
        }
      };

      commandRecognizer.onerror = (e) => {
        console.warn('Speech error:', e.error);
        if (e.error === 'no-speech') {
          activity('No speech detected. Please speak clearly and try again.');
        } else if (e.error === 'not-allowed') {
          activity('Microphone access denied. Please allow microphone access.');
        } else {
          activity('Voice recognition error: ' + e.error);
        }
        processingVoice = false;
        $('listen-once').textContent = 'Speak a command';
        updateWake();
        if (wakeEnabled && !isSpeaking) startWakeRecognizer();
      };

      commandRecognizer.onend = () => {
        commandRecognizer = null;
        $('listen-once').textContent = 'Speak a command';
        if (finalCaptured && finalCaptured.trim()) {
          runVoice(finalCaptured.trim());
        } else {
          processingVoice = false;
          updateWake();
          if (wakeEnabled && !isSpeaking) startWakeRecognizer();
        }
      };

      commandRecognizer.start();
      return;
    } catch (e) {
      console.warn('Speech recognition start failed, trying media recorder fallback', e);
    }
  }

  // MediaRecorder Fallback (for browsers without SpeechRecognition)
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    activity('Voice input is not supported in this browser. Please type your command.');
    return;
  }

  try {
    const permission = await window.jarvis.requestMicrophone();
    if (!permission?.ok) {
      activity(permission?.message || 'Microphone access denied.');
      return;
    }

    voiceStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    const voiceChunks = [];
    const mt = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(x => MediaRecorder.isTypeSupported(x));
    voiceRecorder = new MediaRecorder(voiceStream, mt ? { mimeType: mt } : undefined);

    voiceRecorder.ondataavailable = e => {
      if (e.data && e.data.size) voiceChunks.push(e.data);
    };

    voiceRecorder.onstop = async () => {
      if (voiceStream) voiceStream.getTracks().forEach(t => t.stop());
      voiceStream = null;
      $('listen-once').textContent = 'Speak a command';

      const blob = new Blob(voiceChunks, { type: voiceRecorder?.mimeType || 'audio/webm' });
      voiceRecorder = null;

      if (blob.size < 1000) {
        processingVoice = false;
        updateWake();
        activity('No clear audio recorded. Try speaking again.');
        if (wakeEnabled) startWakeRecognizer();
        return;
      }

      activity('Transcribing audio with Gemini…');
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        const result = await window.jarvis.transcribeAudio({
          audio: btoa(binary),
          mimeType: (blob.type || 'audio/webm').split(';')[0]
        });

        if (!result?.ok) {
          addMessage('assistant', result?.message || 'Could not transcribe voice.');
          activity(result?.message || 'Transcription failed.');
          return;
        }

        const transcript = String(result.text || '').trim();
        if (transcript) {
          await runCommand(transcript, true);
        } else {
          activity('No speech detected. Please try again.');
        }
      } catch (e) {
        activity('Voice error: ' + e.message);
      } finally {
        processingVoice = false;
        updateWake();
        if (wakeEnabled && !isSpeaking) startWakeRecognizer();
      }
    };

    voiceRecorder.start();
    processingVoice = true;
    updateWake();
    $('listen-once').textContent = '⏹ Stop recording';
    activity('Recording audio… Tap “Stop recording” when finished speaking.');
  } catch (e) {
    if (voiceStream) voiceStream.getTracks().forEach(t => t.stop());
    voiceStream = null;
    voiceRecorder = null;
    processingVoice = false;
    updateWake();
    activity('Microphone error: ' + e.message);
  }
}

async function init() {
  try {
    const d = await window.jarvis.getInitial();
    settings = d.settings || settings;
    $('platform-label').textContent = 'WEB & CLOUD';
    $('ai-mode').value = settings.aiMode;
    $('local-model').value = settings.localModel;
    $('cloud-model').value = settings.cloudModel;
    $('voice-language').value = settings.voiceLanguage;
    $('wake-mode').value = settings.wakeMode;
    $('auto-start').checked = !!settings.autoStart;
    $('wake-on-launch').checked = !!settings.wakeOnLaunch;
    $('speak-responses').checked = settings.speakResponses !== false;
    $('ai-mode-label').textContent = settings.aiMode === 'gemini' ? 'GEMINI AI' : settings.aiMode === 'cloud' ? 'OPENAI AI' : 'LOCAL AI';
    $('voice-engine-label').textContent = settings.aiMode === 'gemini' ? (d.hasApiKey ? 'GEMINI NATURAL VOICE' : 'ADD GEMINI API KEY') : d.hasApiKey ? 'CLOUD KEY SAVED' : 'VOICE READY';

    renderNotes(d.notes || []);
    renderReminders(d.reminders || []);
    localStatus(d.localAI);

    const f = (d.companion?.links || [])[0];
    if (f) {
      companionUrl = f.url;
      $('companion-url').textContent = f.url;
      $('companion-url').href = f.url;
      if (f.qr) {
        $('pairing-qr').src = f.qr;
        $('pairing-qr').hidden = false;
      }
      $('copy-companion').disabled = false;
      $('companion-status').textContent = 'Android companion ready';
    }

    (d.history || []).forEach(m => addMessage(m.role === 'assistant' ? 'assistant' : 'user', m.content));
    status('System ready');

    if (settings.wakeOnLaunch) {
      wakeEnabled = true;
      startWakeRecognizer();
    }
    updateWake();
  } catch (e) {
    activity('Could not load settings: ' + e.message);
  }
}

// Event Listeners
$('wake-toggle').onclick = () => {
  wakeEnabled = !wakeEnabled;
  if (wakeEnabled) {
    startWakeRecognizer();
    activity('Wake word enabled! Say “Jarvis [command]” or “Hey Jarvis”.');
  } else {
    stopWakeRecognizer();
    activity('Wake word disabled.');
  }
  updateWake();
};

$('listen-once').onclick = () => listenOnce();

$('chat-form').onsubmit = async e => {
  e.preventDefault();
  await runCommand($('chat-input').value);
};

$('clear-chat').onclick = () => {
  chatList.replaceChildren();
  addMessage('assistant', 'Conversation cleared. Saved notes and reminders remain.');
};

document.querySelectorAll('[data-app]').forEach(b => {
  b.onclick = async () => {
    const r = await window.jarvis.openApp(b.dataset.app);
    addMessage('assistant', r.message);
    activity(r.message);
    if (r.url && r.url !== '#') {
      try { window.open(r.url, '_blank'); } catch (e) {}
    }
    if (r.ok) speak(r.message);
  };
});

document.querySelectorAll('[data-command]').forEach(b => {
  b.onclick = () => runCommand(b.dataset.command);
});

$('open-url').onclick = async () => {
  const r = await window.jarvis.openUrl($('url-input').value.trim());
  addMessage('assistant', r.message);
  activity(r.message);
  if (r.url) {
    try { window.open(r.url, '_blank'); } catch (e) {}
  }
  if (r.ok) speak(r.message);
};

$('url-input').onkeydown = e => {
  if (e.key === 'Enter') $('open-url').click();
};

$('run-python').onclick = async () => {
  const r = await window.jarvis.pickPython();
  if (r.message) {
    addMessage('assistant', r.message);
    activity(r.message);
  }
};

$('save-note').onclick = async () => {
  const t = $('note-input').value.trim();
  if (!t) return;
  const r = await window.jarvis.saveNote(t);
  $('note-input').value = '';
  addMessage('assistant', r.message);
  activity(r.message);
};

$('note-input').onkeydown = e => {
  if (e.key === 'Enter') $('save-note').click();
};

$('reminder-form').onsubmit = async e => {
  e.preventDefault();
  const v = $('reminder-text').value.trim();
  const m = v.match(/^(.+?)\s+in\s+(\d+)\s*(seconds?|minutes?|mins?|hours?|hrs?|days?)$/i) ||
            v.match(/^remind me in\s+(\d+)\s*(seconds?|minutes?|mins?|hours?|hrs?|days?)\s+to\s+(.+)$/i);
  if (!m) {
    activity('Format: “Take a break in 10 minutes”');
    return;
  }
  let task, count, unit;
  if (v.toLowerCase().startsWith('remind me')) {
    count = +m[1];
    unit = m[2].toLowerCase();
    task = m[3];
  } else {
    task = m[1];
    count = +m[2];
    unit = m[3].toLowerCase();
  }
  const mult = unit.startsWith('sec') ? 1000 : unit.startsWith('min') ? 60000 : (unit.startsWith('hour') || unit.startsWith('hr')) ? 3600000 : 86400000;
  const r = await window.jarvis.addReminder({ text: task, delayMs: count * mult });
  addMessage('assistant', r.message);
  activity(r.message);
  $('reminder-text').value = '';
};

$('save-settings').onclick = async () => {
  const r = await window.jarvis.saveSettings({
    aiMode: $('ai-mode').value,
    localModel: $('local-model').value.trim(),
    cloudModel: $('cloud-model').value.trim(),
    voiceLanguage: $('voice-language').value,
    wakeMode: $('wake-mode').value,
    wakeOnLaunch: $('wake-on-launch').checked,
    autoStart: $('auto-start').checked,
    speakResponses: $('speak-responses').checked,
    apiKey: $('api-key').value,
    clearApiKey: $('clear-api-key').checked
  });
  if (!r.ok) {
    activity(r.message || 'Could not save settings.');
    return;
  }
  settings = r.settings;
  $('api-key').value = '';
  $('clear-api-key').checked = false;
  $('ai-mode-label').textContent = settings.aiMode === 'gemini' ? 'GEMINI AI' : settings.aiMode === 'cloud' ? 'OPENAI AI' : 'LOCAL AI';
  $('voice-engine-label').textContent = settings.aiMode === 'gemini' ? 'GEMINI NATURAL VOICE' : r.hasApiKey ? 'CLOUD KEY SAVED' : 'VOICE READY';
  activity(r.message);
  if (wakeEnabled) {
    startWakeRecognizer();
  }
};

$('ai-mode').onchange = () => {
  const mode = $('ai-mode').value;
  const field = $('cloud-model');
  if (mode === 'gemini' && (!field.value || field.value === 'gpt-4o-mini')) field.value = 'gemini-3.8-flash';
  else if (mode === 'cloud' && field.value === 'gemini-3.8-flash') field.value = 'gpt-4o-mini';
  activity(mode === 'gemini' ? 'Gemini mode uses natural generated voice and chat.' : mode === 'cloud' ? 'OpenAI Cloud mode uses an OpenAI API key.' : 'Local mode requires Ollama.');
};

$('check-local').onclick = async () => {
  const r = await window.jarvis.getInitial();
  localStatus(r.localAI);
  activity('AI status checked.');
};

$('copy-companion').onclick = async () => {
  if (companionUrl) {
    await window.jarvis.copyText(companionUrl);
    activity('Pairing link copied. Keep it private.');
  }
};

$('speak-responses').onchange = async () => {
  const r = await window.jarvis.saveSettings({ speakResponses: $('speak-responses').checked });
  if (r.ok) settings = r.settings;
};

$('voice-language').onchange = () => {
  if (wakeEnabled) startWakeRecognizer();
};

window.jarvis.on('jarvis:notes', renderNotes);
window.jarvis.on('jarvis:reminders', renderReminders);
window.jarvis.on('jarvis:activity', e => activity(e.text));
window.jarvis.on('jarvis:user-command', e => {
  if (e.source === 'android') {
    addMessage('user', e.command, 'android');
    activity('Command received from Android.');
  }
});
window.jarvis.on('jarvis:reminder-fired', r => {
  addMessage('assistant', 'Reminder: ' + r.text);
  speak('Reminder. ' + r.text);
});
window.jarvis.on('jarvis:pick-python-request', async () => {
  const r = await window.jarvis.pickPython();
  if (r.message) {
    addMessage('assistant', r.message);
    activity(r.message);
  }
});

updateWake();
init();