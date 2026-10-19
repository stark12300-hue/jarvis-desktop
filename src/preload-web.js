// Web client adapter replacing Electron IPC with REST & Server-Sent Events (SSE)
(function() {
  const listeners = new Map();

  // Connect to SSE for server-broadcast events
  function initEventStream() {
    try {
      const source = new EventSource('/api/events');
      source.onmessage = function(event) {
        try {
          const payload = JSON.parse(event.data);
          const { channel, data } = payload;
          const set = listeners.get(channel);
          if (set) {
            set.forEach(cb => {
              try { cb(data); } catch (e) { console.error('Listener error for ' + channel, e); }
            });
          }
        } catch (e) {
          console.error('SSE parse error:', e);
        }
      };
      source.onerror = function() {
        // EventSource will automatically retry connecting
      };
    } catch (e) {
      console.warn('SSE not supported or failed to connect:', e);
    }
  }

  initEventStream();

  async function postJson(endpoint, data) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {})
    });
    return res.json();
  }

  window.jarvis = {
    getInitial: async () => {
      const res = await fetch('/api/initial');
      return res.json();
    },
    requestMicrophone: async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        return { ok: false, message: 'Microphone access is not supported in this browser.' };
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Stop the probe stream immediately so audio is released until recording starts
        stream.getTracks().forEach(t => t.stop());
        return { ok: true, message: 'Microphone permission granted.' };
      } catch (e) {
        return { ok: false, message: 'Microphone permission denied: ' + e.message };
      }
    },
    transcribeAudio: async (payload) => {
      return postJson('/api/transcribe-audio', payload);
    },
    speakText: async (text) => {
      return postJson('/api/speak-text', { text });
    },
    runCommand: async (command) => {
      return postJson('/api/command', { command });
    },
    openApp: async (name) => {
      return postJson('/api/open-app', { name });
    },
    openUrl: async (url) => {
      return postJson('/api/open-url', { url });
    },
    saveNote: async (text) => {
      return postJson('/api/save-note', { text });
    },
    deleteNote: async (id) => {
      return postJson('/api/delete-note', { id });
    },
    addReminder: async (d) => {
      return postJson('/api/add-reminder', d);
    },
    deleteReminder: async (id) => {
      return postJson('/api/delete-reminder', { id });
    },
    saveSettings: async (settings) => {
      return postJson('/api/save-settings', settings);
    },
    pickPython: async () => {
      return postJson('/api/pick-python', {});
    },
    copyText: async (text) => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(String(text || ''));
          return true;
        }
      } catch (e) {}
      return false;
    },
    on: (channel, callback) => {
      const allowed = [
        'jarvis:activity',
        'jarvis:notes',
        'jarvis:reminders',
        'jarvis:user-command',
        'jarvis:reminder-fired',
        'jarvis:pick-python-request'
      ];
      if (!allowed.includes(channel) || typeof callback !== 'function') return () => {};
      if (!listeners.has(channel)) {
        listeners.set(channel, new Set());
      }
      listeners.get(channel).add(callback);
      return () => {
        const set = listeners.get(channel);
        if (set) set.delete(callback);
      };
    }
  };
})();
