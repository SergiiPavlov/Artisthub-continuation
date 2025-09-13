import { withBase } from './apiBase.js';

/** Универсальный fetch с таймаутом и ретраями (помогает при «пробуждении» Render) */
async function fetchWithRetry(url, options = {}, tries = 2, timeoutMs = 20000) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const r = await fetch(url, { ...options, signal: ctrl.signal });
      clearTimeout(t);
      // На «пробуждении» часто бывают 502/503 — пробуем повтор.
      if (r.status === 502 || r.status === 503) throw new Error(`bad_gateway_${r.status}`);
      return r;
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise(res => setTimeout(res, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

/** Чат с сервером (/api/chat) */
export async function sendChat({ message, history = [], provider, langHint } = {}) {
  const r = await fetchWithRetry(withBase('/api/chat'), {
    method: 'POST',
    credentials: 'include', // cookie-сессии
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ message, history, provider, langHint }),
    cache: 'no-store',
  }, 2);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json(); // { reply, actions, provider, ... }
}

/** Поиск YouTube через сервер (/api/yt/search) */
export async function ytSearch({ q, max = 25, exclude = [], shuffle = true } = {}) {
  const r = await fetchWithRetry(withBase('/api/yt/search'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ q, max, exclude, shuffle }),
    cache: 'no-store',
  }, 2);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json(); // { ids: [...] }
}

/**
 * Голос: сначала пробуем серверный TTS (/api/tts?lang=...), при ошибке — Web Speech API.
 * Поддерживает вызовы:
 *   - ttsSpeak({ text, lang, voice })
 *   - ttsSpeak(text, lang, voiceOrOptions)
 * Возвращает true, если звук озвучен (сервером или браузером), иначе false.
 */
export async function ttsSpeak(arg1, langMaybe, third) {
  let text = '';
  let lang = 'ru';
  let voice = '';

  if (arg1 && typeof arg1 === 'object' && 'text' in arg1) {
    // форма: ttsSpeak({ text, lang, voice })
    text = String(arg1.text || '');
    lang = String(arg1.lang || 'ru');
    voice = arg1.voice ? String(arg1.voice) : '';
  } else {
    // форма: ttsSpeak(text, lang, voiceOrOptions)
    text = String(arg1 || '');
    lang = String(langMaybe || 'ru');
    if (typeof third === 'string') voice = third;
    else if (third && typeof third === 'object' && 'voice' in third) voice = String(third.voice || '');
  }

  if (!text) return false;

  // 1) Серверный TTS
  try {
    const r = await fetchWithRetry(
      withBase(`/api/tts?lang=${encodeURIComponent(lang)}`),
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(voice ? { text, lang, voice } : { text, lang }),
        cache: 'no-store',
      },
      2,
      20000
    );

    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (r.ok && (ct.includes('audio/') || ct.includes('octet-stream'))) {
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.preload = 'auto';
      audio.play().catch(() => {}); // может быть заблокировано политикой автоплея
      audio.onended = () => URL.revokeObjectURL(url);
      audio.onerror = () => URL.revokeObjectURL(url);
      return true;
    }
  } catch {
    // сервер недоступен → фолбэк на браузер
  }

  // 2) Браузерный TTS (fallback)
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = toBCP47(lang);
    try {
      const voices = window.speechSynthesis.getVoices?.() || [];
      const pref = u.lang.slice(0, 2).toLowerCase();
      const byLang = voices.filter(v => String(v.lang || '').toLowerCase().startsWith(pref));
      if (voice) {
        const byName = voices.find(v => v.name === voice);
        if (byName) u.voice = byName;
        else if (byLang.length) u.voice = byLang[0];
      } else if (byLang.length) {
        u.voice = byLang[0];
      }
    } catch {}
    window.speechSynthesis.speak(u);
    return true;
  }

  return false;
}

function toBCP47(code) {
  const c = String(code || '').toLowerCase();
  if (c === 'ru' || c.startsWith('ru')) return 'ru-RU';
  if (c === 'uk' || c.startsWith('uk')) return 'uk-UA';
  if (c === 'en' || c.startsWith('en')) return 'en-US';
  return c || 'ru-RU';
}

