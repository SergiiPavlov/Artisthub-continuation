// src/js/assistant/wakeFocus.js
(() => {
  if (window.__WAKE_FOCUS_INIT__) return;
  window.__WAKE_FOCUS_INIT__ = true;

  const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (!isMobile) return;

  let autoPaused = false;

  window.addEventListener('AM.player.state', (e) => {
    const st = String(e?.detail?.state || '').toLowerCase(); // 'playing'|'paused'|'stopped'|'ended'
    const W = window.Assistant?.wake;
    if (!W) return;

    if (st === 'playing') {
      if (W.isOn()) {
        W.disable();
        autoPaused = true;
      }
    } else if ((st === 'paused' || st === 'stopped') && autoPaused) {
      autoPaused = false;
      W.enable();
    }
  });
})();
