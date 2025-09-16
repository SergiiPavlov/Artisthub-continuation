import { withBase } from './apiBase.js';

/** Чат с сервером (/api/chat) */
export async function sendChat({ message, history = [], provider, langHint } = {}) {
  const r = await fetch(withBase('/api/chat'), {
    method: 'POST',
    credentials: 'include', // cookie-сессии
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ message, history, provider, langHint }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json(); // { reply, actions, provider, ... }
}

/** Поиск YouTube через сервер (/api/yt/search) */
export async function ytSearch({ q, max = 25, exclude = [], shuffle = true } = {}) {
  const r = await fetch(withBase('/api/yt/search'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ q, max, exclude, shuffle }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json(); // { ids: [...] } или { items: [...] }
}

/**
 * TTS: сначала серверный (/api/tts?lang=...), при ошибке — Web Speech API.
 * Поддерживает оба стиля:
 *   - ttsSpeak({ text, lang, voice })
 *   - ttsSpeak(text, lang, voiceOrOptions)
 * Возвращает true/false — удалось ли озвучить.
 */
export async function ttsSpeak(arg1, langMaybe, third) {
  let text = '';
  let lang = 'ru';
  let voice = '';

  if (arg1 && typeof arg1 === 'object' && 'text' in arg1) {
    text = String(arg1.text || '');
    lang = String(arg1.lang || 'ru');
    voice = arg1.voice ? String(arg1.voice) : '';
  } else {
    text = String(arg1 || '');
    lang = String(langMaybe || 'ru');
    if (typeof third === 'string') voice = third;
    else if (third && typeof third === 'object' && 'voice' in third) voice = String(third.voice || '');
  }

  if (!text) return false;

  // 1) Серверный TTS (если доступен): принимаем только audio/*
  try {
    const r = await fetch(withBase(`/api/tts?lang=${encodeURIComponent(lang)}`), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(voice ? { text, lang, voice } : { text, lang }),
    });

    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (r.ok && (ct.startsWith('audio/') || ct.includes('octet-stream'))) {
      // дождёмся «разлочки» звука в контексте пользовательского жеста
      if (typeof window !== 'undefined' && typeof window.__ensureAudioUnlocked === 'function') {
        try { await window.__ensureAudioUnlocked(); } catch {}
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.preload = 'auto';
      try {
        await audio.play();                // ждём промис
        audio.onended = () => URL.revokeObjectURL(url);
        audio.onerror = () => URL.revokeObjectURL(url);
        return true;                       // успех → не нужен fallback
      } catch (e) {
        URL.revokeObjectURL(url);          // не сыграло → пойдём в браузерный TTS
      }
    }
  } catch {
    // сервер не ответил/вернул не-аудио — пойдём в браузерный TTS
  }

  // 2) Браузерный TTS (fallback)
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = toBCP47(lang);
    try {
      const voices = window.speechSynthesis.getVoices?.() || [];
      // пробуем подобрать голос по языку
      const pref = String(u.lang || '').slice(0,2).toLowerCase();
      const byLang = voices.filter(v => String(v.lang || '').toLowerCase().startsWith(pref));
      if (voice) {
        const byName = voices.find(v => String(v.name || '').toLowerCase().includes(String(voice).toLowerCase()));
        if (byName) u.voice = byName;
        else if (byLang.length) u.voice = byLang[0];
      } else if (byLang.length) {
        u.voice = byLang[0];
      }
    } catch {}
    try { window.speechSynthesis.cancel(); } catch {}
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

