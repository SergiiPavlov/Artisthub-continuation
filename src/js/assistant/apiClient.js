import { withBase } from './apiBase.js';

/** Чат с твоим сервером (/api/chat) */
export async function sendChat({ message, history = [], provider, langHint }) {
  const r = await fetch(withBase('/api/chat'), {
    method: 'POST',
    credentials: 'include', // cookie-сессии
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, provider, langHint }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json(); // { reply, actions, provider, ... }
}

/** Поиск YouTube через твой сервер (/api/yt/search) */
export async function ytSearch({ q, max = 25, exclude = [], shuffle = true }) {
  const r = await fetch(withBase('/api/yt/search'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, max, exclude, shuffle }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json(); // { ids: [...] }
}

/** Голос: сначала пробуем серверный TTS (/api/tts), при ошибке — Web Speech API */
export async function ttsSpeak({ text, lang = 'ru' }) {
  if (!text) return false;

  // 1) Серверный TTS (если включён на проде)
  try {
    const r = await fetch(withBase('/api/tts'), {
         method: 'POST',
         credentials: 'include',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ text, lang, voice }), // ← добавили voice
    });
    if (r.ok && r.headers.get('content-type')?.includes('audio')) {
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      await audio.play();
      return true;
    }
  } catch (_) { /* fallthrough */ }

  // 2) Браузерный TTS (fallback)
  if ('speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang || 'ru';
    window.speechSynthesis.speak(u);
    return true;
  }
  return false;
}
