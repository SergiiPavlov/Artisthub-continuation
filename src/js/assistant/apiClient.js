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
  return r.json(); // { ids: [...] }
}

/**
 * Голос: сначала серверный TTS (/api/tts?lang=...), при ошибке — Web Speech API.
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

  text = (text || '').trim();
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
    if (r.ok && (ct.includes('audio/') || ct.includes('octet-stream'))) {
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.preload = 'auto';
      try { audio.playsInline = true; } catch {}
      try { audio.setAttribute && audio.setAttribute('playsinline',''); } catch {}

      // Если есть анлокер — прогрей аудио-контекст перед play()
      if (typeof window.__ensureAudioUnlocked === 'function') {
        try {
          const ok = await window.__ensureAudioUnlocked(800);
          // even if ok===false (timeout), proceed to try .play(); fallback below will handle reject
        } catch {}
      }

      try {
        // ВАЖНО: ждём промис — если автоплей заблокирован, пойдём в браузерный TTS
        await audio.play();
        audio.onended = () => URL.revokeObjectURL(url);
        audio.onerror = () => URL.revokeObjectURL(url);
        return true; // серверный TTS успешно озвучил
      } catch {
        URL.revokeObjectURL(url); // не сыграло — пробуем браузерный TTS
      }
    }
  } catch {
    // игнор — уйдём на браузерный TTS
  }

  // 2) Браузерный TTS (Web Speech API)
  try {
    if (!('speechSynthesis' in window)) return false;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = toBCP47(lang);
    u.rate = 1; u.pitch = 1;
    const pickVoice = () => {
      if (voice) {
        const vs = window.speechSynthesis.getVoices?.() || [];
        u.voice = vs.find(v => v.name === voice) || null;
      }
      if (!u.voice) {
        const vs2 = window.speechSynthesis.getVoices?.() || [];
        const pref = u.lang.slice(0,2).toLowerCase();
        const byLang = vs2.filter(v => String(v.lang||'').toLowerCase().startsWith(pref));
        if (byLang.length) u.voice = byLang[0];
      }
    };
    pickVoice();
    try { window.speechSynthesis.cancel(); } catch {}
    try { window.speechSynthesis.resume && window.speechSynthesis.resume(); } catch {}
    if (!u.voice && (window.speechSynthesis.getVoices?.()||[]).length === 0) {
      // iOS sometimes populates voices async — wait once, but don't block forever
      await new Promise((res) => {
        let done=false; const onv=() => { if(done) return; done=true; try{ window.speechSynthesis.removeEventListener('voiceschanged', onv); }catch{} res(); };
        try{ window.speechSynthesis.addEventListener('voiceschanged', onv, { once:true }); }catch{}
        setTimeout(onv, 800);
      });
      pickVoice();
    }
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    // как последний шанс — ничего не делаем
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

