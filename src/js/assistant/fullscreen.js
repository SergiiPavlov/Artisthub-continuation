// src/js/assistant/fullscreen.js
(() => {
  if (window.__ASSISTANT_FS_INIT__) return;
  window.__ASSISTANT_FS_INIT__ = true;

  // на каком контейнере разворачивать – при необходимости поменяй селектор
  function host() {
    return document.querySelector('#app') || document.documentElement;
  }

  function enterFS() {
    const el = host();
    if (!document.fullscreenElement && el?.requestFullscreen) {
      el.requestFullscreen().catch(()=>{});
    }
  }
  function exitFS() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(()=>{});
    }
  }

  window.addEventListener('assistant:fullscreen', enterFS);
  window.addEventListener('assistant:exit-fullscreen', exitFS);

  // (опционально) клавиша F — переключатель
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'f') {
      if (document.fullscreenElement) exitFS(); else enterFS();
    }
  });
})();
