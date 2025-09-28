// src/js/assistant/audioUnlocker.js
// Надёжная «разлочка» звука через WebAudio (без <audio>) + публичный await-хук.
// Главное: НИКАКИХ await до resume()/start — всё синхронно в жесте.

(() => {
  if (window.__AUDIO_UNLOCKER_INIT__) return;
  window.__AUDIO_UNLOCKER_INIT__ = true;

  let unlocked = false;
  const waiters = [];

  function resolveAll() {
    while (waiters.length) {
      try { waiters.shift()?.(); } catch {}
    }
  }

  // Публичный API: дождаться, пока звук «разлочен»
  window.__ensureAudioUnlocked = function () {
    if (unlocked) return Promise.resolve();
    return new Promise(res => waiters.push(res));
  };

  // Разлочка строго в контексте пользовательского жеста
  function doUnlock() {
    if (unlocked) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        unlocked = true;        // нет WebAudio — считаем ок
        resolveAll();
        return;
      }

      const ctx = new AC();     // создаём лениво (не на уровне модуля)

      // ВАЖНО: без await — синхронно в жесте
      try { ctx.resume?.(); } catch {}

      // 1 сэмпл «тишины» — подтверждает user gesture
      const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      try { src.start(0); src.stop(0); } catch {}

      unlocked = true;
      resolveAll();
      // дальше пусть живёт свой жизнью; слушатели снимутся сами (once:true)
    } catch {
      // Не блокируем UX: считаем разлоченным, чтобы код дальше не завис
      unlocked = true;
      resolveAll();
    }
  }

  function tryUnlockOnce() {
    if (unlocked) return;
    // Запускаем разлочку синхронно в контексте жеста:
    doUnlock();
  }

  // На ПЕРВЫЙ пользовательский жест — разлочка
  ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click'].forEach(ev => {
    window.addEventListener(ev, tryUnlockOnce, { once: true, passive: true, capture: true });
  });
})();
