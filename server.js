const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '15mb' }));

// Data storage setup
const DATA_DIR = path.join(__dirname, 'data');
const DATA_PATH = path.join(DATA_DIR, 'jarvis-data.json');
const KEY_PATH = path.join(DATA_DIR, 'cloud-api-key.txt');

const DEFAULTS = {
  aiMode: 'gemini',
  localModel: 'llama3.2',
  cloudModel: 'gemini-3.8-flash',
  voiceLanguage: 'auto',
  wakeMode: 'low',
  wakeOnLaunch: false,
  autoStart: false,
  speakResponses: true,
  providerMigrationV1: true
};

const pairToken = crypto.randomBytes(32).toString('hex');
const timers = new Map();
const sseClients = new Set();

let store = {
  settings: { ...DEFAULTS },
  notes: [],
  reminders: [],
  history: []
};

function saveStore() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_PATH, JSON.stringify(store, null, 2), { encoding: 'utf8' });
  } catch (e) {
    console.error('Save failed:', e.message);
  }
}

function loadStore() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      const d = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
      const previous = d.settings || {};
      store = {
        settings: { ...DEFAULTS, ...previous },
        notes: Array.isArray(d.notes) ? d.notes.slice(-100) : [],
        reminders: Array.isArray(d.reminders) ? d.reminders.slice(-100) : [],
        history: Array.isArray(d.history) ? d.history.slice(-40) : []
      };
      if (previous.aiMode === 'local' && !previous.providerMigrationV1) {
        store.settings.aiMode = 'gemini';
        store.settings.cloudModel = 'gemini-3.8-flash';
      }
      store.settings.providerMigrationV1 = true;
      saveStore();
    } else {
      store.settings.providerMigrationV1 = true;
      saveStore();
    }
  } catch (e) {
    store.settings.providerMigrationV1 = true;
    saveStore();
  }
}

loadStore();

function getApiKey() {
  if (process.env.GEMINI_API_KEY && store.settings.aiMode === 'gemini') {
    return process.env.GEMINI_API_KEY;
  }
  if (process.env.OPENAI_API_KEY && store.settings.aiMode === 'cloud') {
    return process.env.OPENAI_API_KEY;
  }
  try {
    if (fs.existsSync(KEY_PATH)) {
      return fs.readFileSync(KEY_PATH, 'utf8').trim();
    }
  } catch {}
  return process.env.GEMINI_API_KEY || '';
}

function setApiKey(k) {
  if (!k) {
    try { fs.rmSync(KEY_PATH, { force: true }); } catch {}
    return { ok: true };
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(KEY_PATH, String(k).trim(), { encoding: 'utf8' });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: 'Could not safely store API key.' };
  }
}

// SSE broadcast for real-time notifications
function send(channel, data) {
  const payload = `data: ${JSON.stringify({ channel, data })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function activity(text, type = 'info') {
  send('jarvis:activity', { text, type, at: Date.now() });
}

function scheduleReminder(r) {
  if (!r || r.done) return;
  const d = Math.max(0, r.dueAt - Date.now());
  if (d > 2147480000) {
    const t = setTimeout(() => {
      timers.delete(r.id);
      scheduleReminder(r);
    }, 2147480000);
    timers.set(r.id, t);
    return;
  }
  const t = setTimeout(() => {
    r.done = true;
    saveStore();
    timers.delete(r.id);
    activity('Reminder: ' + r.text, 'reminder');
    send('jarvis:reminders', store.reminders);
    send('jarvis:reminder-fired', r);
  }, d);
  timers.set(r.id, t);
}

for (const r of store.reminders) {
  if (!r.done) scheduleReminder(r);
}

function addNote(text) {
  const t = String(text || '').trim().slice(0, 3000);
  if (!t) return { ok: false, message: 'Note text is empty.' };
  store.notes.push({ id: crypto.randomUUID(), text: t, createdAt: Date.now() });
  store.notes = store.notes.slice(-100);
  saveStore();
  send('jarvis:notes', store.notes);
  activity('Memory note saved', 'success');
  return { ok: true, message: 'Yaad rakh liya: ' + t };
}

function deleteNote(id) {
  store.notes = store.notes.filter(n => n.id !== id);
  saveStore();
  send('jarvis:notes', store.notes);
  return store.notes;
}

function addReminder(text, delay) {
  const t = String(text || '').trim().slice(0, 500);
  if (!t || !Number.isFinite(delay) || delay < 10000 || delay > 30 * 86400000) {
    return { ok: false, message: 'Reminder must be between 10 seconds and 30 days.' };
  }
  const r = { id: crypto.randomUUID(), text: t, dueAt: Date.now() + delay, done: false };
  store.reminders.push(r);
  store.reminders = store.reminders.slice(-100);
  saveStore();
  scheduleReminder(r);
  send('jarvis:reminders', store.reminders);
  activity('Reminder scheduled', 'success');
  return { ok: true, message: 'Reminder set: ' + t + ' — ' + new Date(r.dueAt).toLocaleString() };
}

function deleteReminder(id) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  store.reminders = store.reminders.filter(r => r.id !== id);
  saveStore();
  send('jarvis:reminders', store.reminders);
  return store.reminders;
}

function parseReminder(s) {
  const m = String(s).match(/^(?:remind me in|reminder in|yaad dilana in)\s+(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)\s+(?:to\s+)?(.+)$/i);
  if (!m) return null;
  const u = m[2].toLowerCase();
  const f = u.startsWith('sec') ? 1000 : u.startsWith('min') ? 60000 : (u.startsWith('hour') || u.startsWith('hr')) ? 3600000 : 86400000;
  return { text: m[3], delay: Number(m[1]) * f };
}

async function localAIStatus() {
  try {
    const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1200) });
    if (!r.ok) return { available: false, models: [] };
    const d = await r.json();
    return { available: true, models: (d.models || []).map(x => x.name).slice(0, 30) };
  } catch {
    return { available: false, models: [] };
  }
}

async function askAI(text) {
  const key = getApiKey();
  const notes = store.notes.slice(-10).map(n => '- ' + n.text).join('\n');
  const system = 'You are JARVIS, a concise, capable Hindi-English personal assistant. Reply naturally in the user language, like a calm, polished personal AI. Never claim you performed actions unless the app confirms success. Saved notes:\n' + (notes || '(none)');
  try {
    let answer;
    if (store.settings.aiMode === 'gemini') {
      if (!key) return { ok: false, message: 'Add a Gemini API key in AI Configuration. Get one from Google AI Studio.' };
      const model = store.settings.cloudModel || 'gemini-3.8-flash';
      const contents = [
        ...store.history.slice(-6).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        { role: 'user', parts: [{ text }] }
      ];
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.4, maxOutputTokens: 420 } }),
        signal: AbortSignal.timeout(45000)
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error?.message || 'Gemini API error ' + r.status);
      answer = (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
    } else if (store.settings.aiMode === 'cloud') {
      if (!key) return { ok: false, message: 'Add your OpenAI API key in AI Configuration.' };
      const messages = [{ role: 'system', content: system }, ...store.history.slice(-12).map(m => ({ role: m.role, content: m.content })), { role: 'user', content: text }];
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: store.settings.cloudModel || 'gpt-4o-mini', messages, temperature: 0.5 }),
        signal: AbortSignal.timeout(45000)
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error?.message || 'API error ' + r.status);
      answer = d.choices?.[0]?.message?.content?.trim();
    } else {
      const messages = [{ role: 'system', content: system }, ...store.history.slice(-12).map(m => ({ role: m.role, content: m.content })), { role: 'user', content: text }];
      const r = await fetch('http://127.0.0.1:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: store.settings.localModel || 'llama3.2', messages, stream: false }),
        signal: AbortSignal.timeout(60000)
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || 'Ollama error ' + r.status);
      answer = d.message?.content?.trim();
    }
    if (!answer) throw Error('Empty answer');
    store.history.push({ role: 'user', content: text, at: Date.now() }, { role: 'assistant', content: answer, at: Date.now() });
    store.history = store.history.slice(-40);
    saveStore();
    return { ok: true, message: answer, source: store.settings.aiMode };
  } catch (e) {
    return {
      ok: false,
      message: (store.settings.aiMode === 'local' ? 'Local AI unavailable. Install/start Ollama and download a model such as llama3.2. ' : store.settings.aiMode === 'gemini' ? 'Gemini AI failed. Check your key, selected model and internet connection. ' : 'OpenAI Cloud AI failed. ') + e.message
    };
  }
}

async function openApp(name) {
  const k = String(name || '').toLowerCase().trim();
  const webApps = {
    chrome: { name: 'Google Chrome', url: 'https://www.google.com' },
    vscode: { name: 'VS Code', url: 'https://vscode.dev' },
    finder: { name: 'File Explorer', url: '#' },
    explorer: { name: 'File Explorer', url: '#' },
    safari: { name: 'Safari / Edge', url: 'https://www.bing.com' },
    edge: { name: 'Microsoft Edge', url: 'https://www.bing.com' }
  };
  const appInfo = webApps[k];
  if (!appInfo) {
    return { ok: false, message: 'Supported: Chrome, VS Code, Finder/File Explorer, Safari/Edge.' };
  }
  activity('Opened ' + appInfo.name, 'success');
  return { ok: true, message: 'Opening ' + appInfo.name + '…', url: appInfo.url };
}

async function openUrl(value) {
  try {
    let s = String(value || '').trim();
    if (s && !/^https?:\/\//i.test(s)) s = 'https://' + s;
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol) || !u.hostname.includes('.')) throw Error();
    activity('Opened ' + u.hostname, 'success');
    return { ok: true, message: 'Opening ' + u.hostname + '…', url: u.toString() };
  } catch {
    return { ok: false, message: 'Invalid website URL. Example: open google.com' };
  }
}

async function openFolder(name) {
  const folder = String(name || '').toLowerCase();
  activity('Browsing ' + folder + ' folder', 'info');
  return { ok: true, message: name + ' folder opened.' };
}

async function findFiles(term) {
  const q = String(term || '').trim().toLowerCase();
  if (q.length < 2) return { ok: false, message: 'File name is too short.' };
  const found = [];
  try {
    const entries = await fs.promises.readdir(path.join(__dirname, 'src'));
    for (const e of entries) {
      if (e.toLowerCase().includes(q)) found.push(e);
    }
  } catch {}
  return {
    ok: true,
    message: found.length
      ? 'Matches found in workspace:\n' + found.join('\n')
      : 'No matching file found for “' + term + '”.'
  };
}

async function runCommand(raw, source = 'desktop') {
  let c = String(raw || '').trim().slice(0, 3000);
  if (!c) return { ok: false, message: 'Command was empty.' };
  const original = c;
  c = c.replace(/^(?:hey\s+)?jarvis[\s,.:;-]*/i, '')
       .replace(/^(?:please\s+)?(?:can|could|would)\s+you\s+/i, '')
       .replace(/^please\s+/i, '')
       .replace(/\s+(?:for me|please)$/i, '')
       .trim() || original;

  send('jarvis:user-command', { command: original, source, at: Date.now() });

  const l = c.toLowerCase().replace(/[!?.,]+$/g, '').trim();

  if (/^(help|commands|madad|kya kar sakte ho|what can you do)$/i.test(l)) {
    return { ok: true, message: 'I can open apps/sites, search Google, find files, save notes, set reminders, and answer with Gemini/OpenAI AI. Use "Speak a command" for voice!' };
  }
  if (/\b(what time|time is it|current time|kitne baje|time batao)\b/i.test(l)) {
    return { ok: true, message: 'Abhi ' + new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) + ' hai.' };
  }
  if (/\b(what date|today.s date|date today|aaj ki date|date batao|today date)\b/i.test(l)) {
    return { ok: true, message: 'Aaj ' + new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + ' hai.' };
  }

  const rem = parseReminder(c);
  if (rem) return addReminder(rem.text, rem.delay);

  if (/^(show reminders|list reminders|my reminders|reminders dikhao)$/i.test(l)) {
    const rs = store.reminders.filter(r => !r.done);
    return { ok: true, message: rs.length ? rs.map(r => r.text + ' — ' + new Date(r.dueAt).toLocaleString()).join('\n') : 'No pending reminders.' };
  }

  const note = c.match(/^(?:remember(?: that)?|save note|note this|yaad rakh(?:na)?)\s*[:, -]?\s*(.+)$/i);
  if (note) return addNote(note[1]);

  if (/^(show notes|my notes|list notes|notes dikhao|what do you remember)$/i.test(l)) {
    return { ok: true, message: store.notes.length ? store.notes.slice(-20).map(n => '- ' + n.text).join('\n') : 'No saved notes yet.' };
  }

  const a = l.match(/^(?:jarvis[, ]*)?(?:please )?(?:open|launch|start|kholo|khol do|chalao)\s+(chrome|google chrome|vs code|vscode|visual studio code|finder|explorer|file explorer|safari|edge)$/i);
  if (a) {
    const n = a[1].replace('google chrome', 'chrome').replace('visual studio code', 'vscode').replace('vs code', 'vscode').replace('file explorer', 'explorer');
    return openApp(n);
  }

  const f = l.match(/^(?:open|kholo|khol do)\s+(?:my\s+)?(downloads|desktop|documents)(?:\s+folder)?$/i);
  if (f) return openFolder(f[1]);

  if (/^(run|execute|chalao)\s+(my\s+)?python\s+(script|file|program)$/i.test(l)) {
    send('jarvis:pick-python-request', {});
    return { ok: true, message: 'Python execution request received.' };
  }

  const fm = c.match(/^(?:find|search for|locate|dhoondho|dhundo|file search)\s+(.+?)(?:\s+file)?$/i);
  if (fm) return findFiles(fm[1].replace(/\s+file$/i, ''));

  const sm = c.match(/^(?:search (?:the web )?for|search google for|google|internet par search karo)\s+(.+)$/i);
  if (sm) {
    const q = sm[1].trim();
    const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(q);
    activity('Google search for ' + q, 'success');
    return { ok: true, message: 'Google search: ' + q, url: searchUrl };
  }

  const url = c.match(/^(?:open|visit|go to|website kholo)\s+((?:https?:\/\/)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/\S*)?)$/i);
  if (url) return openUrl(url[1]);

  return askAI(c);
}

async function transcribeAudio(payload) {
  if (!['gemini', 'cloud'].includes(store.settings.aiMode)) {
    return { ok: false, message: 'Voice commands need cloud transcription. Open AI Configuration, select Gemini AI, enter your Gemini API key, and save settings.' };
  }
  const key = getApiKey();
  if (!key) {
    return { ok: false, message: store.settings.aiMode === 'gemini' ? 'Add a Gemini API key in AI Configuration and save settings.' : 'Add an OpenAI API key in AI Configuration and save settings.' };
  }
  const encoded = String(payload?.audio || '');
  if (!encoded || encoded.length > 14 * 1024 * 1024) {
    return { ok: false, message: 'Recording is empty or too long. Try a shorter command.' };
  }
  const mime = String(payload?.mimeType || 'audio/webm').split(';')[0].toLowerCase();
  const allowed = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/x-m4a'];
  if (!allowed.includes(mime)) return { ok: false, message: 'Unsupported recording format: ' + mime };

  try {
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) return { ok: false, message: 'Recording must be under 10 MB.' };

    if (store.settings.aiMode === 'gemini') {
      const model = store.settings.cloudModel || 'gemini-3.8-flash';
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: 'Transcribe the spoken audio exactly. Preserve Hindi and English words as spoken. Return only the transcript, with no explanation.' },
              { inlineData: { mimeType: mime, data: encoded } }
            ]
          }],
          generationConfig: { temperature: 0 }
        }),
        signal: AbortSignal.timeout(45000)
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error?.message || 'Gemini transcription error ' + r.status);
      const text = (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
      return text ? { ok: true, text } : { ok: false, message: 'Gemini did not detect speech. Try again.' };
    }

    // OpenAI Whisper
    const form = new FormData();
    const ext = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/x-m4a': 'm4a' }[mime] || 'webm';
    form.append('file', new Blob([bytes], { type: mime }), 'jarvis-voice.' + ext);
    form.append('model', 'whisper-1');
    if (store.settings.voiceLanguage === 'hi-IN') form.append('language', 'hi');
    if (store.settings.voiceLanguage === 'en-IN') form.append('language', 'en');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key },
      body: form,
      signal: AbortSignal.timeout(45000)
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error?.message || ('Transcription API error ' + response.status));
    const text = String(data.text || '').trim();
    return text ? { ok: true, text } : { ok: false, message: 'No speech detected. Click Speak a command and try again.' };
  } catch (e) {
    return { ok: false, message: 'Voice transcription failed: ' + e.message };
  }
}

async function generateGeminiSpeech(text) {
  const key = getApiKey();
  if (!key) return { ok: false, message: 'Add your Gemini API key and select Gemini Cloud to use the natural JARVIS voice.' };
  const clean = String(text || '').trim().slice(0, 750);
  if (!clean) return { ok: false, message: 'Nothing to speak.' };

  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        model: 'gemini-3.8-flash-lite-tts',
        input: 'Speak the following response as a calm, polished, confident personal AI assistant. Use a mature, smooth, low-mid male-presenting voice, measured pacing, precise diction, subtle pauses, and a warm but composed cinematic delivery. Speak Hindi and Hinglish naturally when present; speak English clearly with a refined neutral accent. Do not sound robotic, overdramatic, or imitate any specific actor or copyrighted character. Read only the text after RESPONSE.\nRESPONSE:\n' + clean,
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice: 'Charon' }] }
      }),
      signal: AbortSignal.timeout(60000)
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error?.message || 'Gemini TTS error ' + response.status);
    const audio = data.output_audio?.data || data.outputAudio?.data || data.steps?.flatMap(s => s.content || []).find(p => p.type === 'audio')?.data;
    if (!audio) throw Error('Gemini did not return audio data.');
    let pcm = Buffer.from(audio, 'base64'), wav = pcm;
    if (pcm.length < 12 || pcm.subarray(0, 4).toString('ascii') !== 'RIFF') {
      const header = Buffer.alloc(44), sampleRate = 24000, channels = 1, bits = 16, byteRate = sampleRate * channels * bits / 8, blockAlign = channels * bits / 8;
      header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
      header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22); header.writeUInt32LE(sampleRate, 24);
      header.writeUInt32LE(byteRate, 28); header.writeUInt16LE(blockAlign, 32); header.writeUInt16LE(bits, 34); header.write('data', 36);
      header.writeUInt32LE(pcm.length, 40); wav = Buffer.concat([header, pcm]);
    }
    return { ok: true, audio: wav.toString('base64'), mimeType: 'audio/wav' };
  } catch (e) {
    return { ok: false, message: 'Gemini voice failed: ' + e.message };
  }
}

function authorized(req) {
  const h = req.get('authorization') || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  return t.length === pairToken.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(pairToken));
}

async function companionInfo(req) {
  const host = req.get('host') || ('localhost:' + PORT);
  const protocol = req.protocol || 'http';
  const url = `${protocol}://${host}/mobile?token=${pairToken}`;
  let qr = '';
  try {
    qr = await QRCode.toDataURL(url, { width: 200, margin: 1, color: { dark: '#09223a', light: '#ffffff' } });
  } catch {}
  return {
    port: PORT,
    links: [{ ip: host.split(':')[0], url, qr }],
    warning: 'Keep this pairing link private.'
  };
}

// Routes
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sseClients.add(res);
  res.write(`data: ${JSON.stringify({ channel: 'jarvis:activity', data: { text: 'System connected', type: 'info' } })}\n\n`);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

app.get('/api/initial', async (req, res) => {
  res.json({
    settings: { ...store.settings },
    hasApiKey: Boolean(getApiKey()),
    localAI: await localAIStatus(),
    notes: store.notes.slice().reverse(),
    reminders: store.reminders.slice().reverse(),
    history: store.history.slice(-20),
    companion: await companionInfo(req),
    platform: 'web'
  });
});

app.post('/api/command', async (req, res) => {
  const c = String(req.body?.command || '').trim();
  const source = req.body?.source || 'desktop';
  res.json(await runCommand(c, source));
});

app.post('/api/open-app', async (req, res) => {
  res.json(await openApp(req.body?.name));
});

app.post('/api/open-url', async (req, res) => {
  res.json(await openUrl(req.body?.url));
});

app.post('/api/save-note', (req, res) => {
  res.json(addNote(req.body?.text));
});

app.post('/api/delete-note', (req, res) => {
  res.json(deleteNote(req.body?.id));
});

app.post('/api/add-reminder', (req, res) => {
  res.json(addReminder(req.body?.text, Number(req.body?.delayMs)));
});

app.post('/api/delete-reminder', (req, res) => {
  res.json(deleteReminder(req.body?.id));
});

app.post('/api/save-settings', (req, res) => {
  const n = req.body || {};
  if (['local', 'cloud', 'gemini'].includes(n.aiMode)) store.settings.aiMode = n.aiMode;
  if (typeof n.localModel === 'string' && /^[\w.:-]{1,100}$/.test(n.localModel)) store.settings.localModel = n.localModel;
  if (typeof n.cloudModel === 'string' && /^[\w.:-]{1,100}$/.test(n.cloudModel)) store.settings.cloudModel = n.cloudModel;
  if (['low', 'smart'].includes(n.wakeMode)) store.settings.wakeMode = n.wakeMode;
  if (['auto', 'en-IN', 'hi-IN'].includes(n.voiceLanguage)) store.settings.voiceLanguage = n.voiceLanguage;
  for (const k of ['wakeOnLaunch', 'autoStart', 'speakResponses']) {
    if (typeof n[k] === 'boolean') store.settings[k] = n[k];
  }
  if (typeof n.apiKey === 'string' && n.apiKey.trim()) {
    const r = setApiKey(n.apiKey.trim());
    if (!r.ok) return res.json(r);
  }
  if (n.clearApiKey && !(n.apiKey && String(n.apiKey).trim())) {
    setApiKey('');
  }
  saveStore();
  res.json({
    ok: true,
    settings: { ...store.settings },
    hasApiKey: Boolean(getApiKey()),
    message: 'Settings saved.'
  });
});

app.post('/api/transcribe-audio', async (req, res) => {
  res.json(await transcribeAudio(req.body));
});

app.post('/api/speak-text', async (req, res) => {
  res.json(await generateGeminiSpeech(req.body?.text));
});

app.post('/api/pick-python', (req, res) => {
  res.json({
    ok: true,
    message: 'Python script support: In this web runtime, scripts run in an isolated sandboxed environment.'
  });
});

// Companion endpoints
app.get('/api/status', (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Pairing link invalid. Scan current QR again.' });
  res.json({
    settings: { aiMode: store.settings.aiMode },
    notes: store.notes.slice(-20),
    reminders: store.reminders.filter(r => !r.done).slice(-20),
    time: Date.now()
  });
});

// Companion command
app.post('/api/companion/command', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Pairing required.' });
  const c = String(req.body?.command || '').trim();
  if (!c || c.length > 3000) return res.status(400).json({ error: 'Command is empty or too long.' });
  res.json(await runCommand(c, 'android'));
});

// Static assets & HTML views
app.get('/mobile', (_req, res) => res.sendFile(path.join(__dirname, 'src', 'mobile.html')));
app.get('/manifest.json', (_req, res) => res.json({
  name: 'JARVIS Companion',
  short_name: 'JARVIS',
  start_url: '/mobile',
  display: 'standalone',
  theme_color: '#071323',
  background_color: '#050b16'
}));

app.use(express.static(path.join(__dirname, 'src')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`JARVIS web server listening on http://0.0.0.0:${PORT}`);
});
