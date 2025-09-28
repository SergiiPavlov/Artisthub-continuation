// src/js/assistant/patches/wake-ios-guard.js
// iOS wake guard: block unintended mic starts that cause system ducking on iOS.
// - Prevents webkitSpeechRecognition.start() unless preceded by a trusted user gesture
// - Ignores programmatic enabling of the wake checkbox (#as-voice) on iOS
// - No effect on Android/Desktop
(() => {
  const UA = navigator.userAgent || '';
  // Classic iOS UA
  const isIOSUA = /iP(hone|od|ad)/.test(UA);
  // iPadOS 13+: Safari маскируется под Mac, но с multitouch
  const isIpadOS13Plus = (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const IS_IOS = isIOSUA || isIpadOS13Plus;

  if (!IS_IOS) return;

  let allowUntil = 0;
  const ARM_MS = 1500;

  function armAllow() { allowUntil = Date.now() + ARM_MS; }
  function isAllowed() { return Date.now() <= allowUntil; }

  // Маркируем последние *доверенные* пользовательские жесты
  ['pointerdown', 'touchstart', 'click', 'keydown'].forEach(ev => {
    window.addEventListener(ev, (e) => {
      try {
        if (e && e.isTrusted === true) {
          if (ev === 'keydown') {
            const k = String(e.key || '').toLowerCase();
            if (['shift','alt','meta','control','tab'].includes(k)) return;
          }
          armAllow();
        }
      } catch {}
    }, { capture: true, passive: true });
  });

  // Патчим webkitSpeechRecognition.start: требуем окно после жеста
  try {
    const SR = window.webkitSpeechRecognition;
    if (SR && SR.prototype && !SR.prototype.__am_ios_guard__) {
      const origStart = SR.prototype.start;
      SR.prototype.start = function guardedStart() {
        if (!isAllowed()) {
          console.warn('[wake-ios-guard] Blocked recognition.start() without recent user gesture.');
          return;
        }
        allowUntil = 0;
        return origStart.apply(this, arguments);
      };
      SR.prototype.__am_ios_guard__ = true;
      console.log('[wake-ios-guard] Patched webkitSpeechRecognition.start');
    }
  } catch {}

  // Гардим чекбокс пробуждения: запрещаем программное включение без жеста
  function hookWakeCheckbox(chk) {
    if (!chk || chk.__am_ios_guard__) return;

    const onChange = (e) => {
      try {
        if (chk.checked && !isAllowed()) {
          console.warn('[wake-ios-guard] Reverting programmatic wake enable on iOS.');
          chk.checked = false;
          if (e && e.isTrusted === false) {
            e.stopImmediatePropagation?.();
            e.preventDefault?.();
          }
        }
      } catch {}
    };

    chk.addEventListener('change', onChange, true);
    chk.__am_ios_guard__ = { onChange };
  }

  function findWakeCheckbox() {
    return document.querySelector('#as-voice') || // основной id
           document.querySelector('[data-voice-wake]') || null;
  }

  // Ставим гарды при готовности DOM
  const onReady = () => {
    const chk = findWakeCheckbox();
    if (chk) hookWakeCheckbox(chk);

    // Следим за появлением чекбокса позже (SPA)
    const mo = new MutationObserver(() => {
      const el = findWakeCheckbox();
      if (el) hookWakeCheckbox(el);
    });
    try {
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch {}

    // tiny API
    window.AM_WakeIOSGuard = {
      uninstall() {
        try {
          const el = findWakeCheckbox();
          if (el?.__am_ios_guard__) {
            el.removeEventListener('change', el.__am_ios_guard__.onChange, true);
            delete el.__am_ios_guard__;
          }
        } catch {}
        console.log('[wake-ios-guard] Uninstalled');
      }
    };
    console.log('[wake-ios-guard] Installed');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }
})();
