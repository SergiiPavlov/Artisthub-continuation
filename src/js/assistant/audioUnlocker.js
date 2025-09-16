// src/js/assistant/audioUnlocker.js
// Надёжная «разлочка» звука через WebAudio (без <audio>), + публичный await-хук.

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

  // Реальная разлочка через WebAudio (без воспроизведения файлов)
  async function doUnlock() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        // Нечего «разлочивать» — считаем ок
        unlocked = true;
        resolveAll();
        return;
      }

      const ctx = new AC();
      // Некоторым браузерам нужно явно resume()
      try { await ctx.resume?.(); } catch {}

      // 1 сэмпл тишины
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      try { src.start(0); } catch {}

      // Маленькая пауза, чтобы движок проснулся
      await new Promise(r => setTimeout(r, 0));

      unlocked = true;
      resolveAll();
    } catch {
      // Даже если не получилось — не блокируем UX
      unlocked = true;
      resolveAll();
    }
  }

  function tryUnlockOnce() {
    if (unlocked) return;
    // Запускаем разлочку «в контексте» пользовательского жеста
    doUnlock();
  }

  // На ПЕРВЫЙ пользовательский жест — разлочка
  ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click'].forEach(ev => {
    window.addEventListener(ev, tryUnlockOnce, { once: true, passive: true, capture: true });
  });
})();
