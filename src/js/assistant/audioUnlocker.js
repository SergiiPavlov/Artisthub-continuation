// src/js/assistant/audioUnlocker.js
(() => {
  if (window.__AUDIO_UNLOCKER_INIT__) return;
  window.__AUDIO_UNLOCKER_INIT__ = true;

  let unlocked = false;
  let waiters = [];

  function resolveAll() { waiters.splice(0).forEach(fn => fn()); }

  // Публичное API: дождаться «разлочки»
  window.__ensureAudioUnlocked = function () {
    if (unlocked) return Promise.resolve();
    return new Promise(res => waiters.push(res));
  };

  function tryUnlock() {
    if (unlocked) return;

    // 1) Разбудим AudioContext
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        const ctx = new AC();
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      }
    } catch {}

    // 2) Проиграем крошечную тишину
    try {
      const a = new Audio();
      a.src = 'data:audio/mp3;base64,//uQZAAAAAAAAAAAAAAAAAAAA'; //  минимальный «пшик»
      a.play().finally(() => {
        unlocked = true;
        resolveAll();
      });
    } catch {
      unlocked = true;
      resolveAll();
    }
  }

  // На первый пользовательский жест — «разлочим»
  ['click','touchstart','keydown'].forEach(ev =>
    window.addEventListener(ev, tryUnlock, { once: true, passive: true })
  );
})();
