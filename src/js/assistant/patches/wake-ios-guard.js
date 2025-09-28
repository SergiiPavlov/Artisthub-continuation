// iOS wake guard: block unintended mic starts that cause system ducking on iOS.
// - Prevents webkitSpeechRecognition.start() unless preceded by a trusted user gesture
// - Ignores programmatic enabling of the wake checkbox (#as-voice) on iOS
// - No effect on Android/Desktop
(() => {
  const UA = navigator.userAgent || '';
  const IS_IOS = /iP(hone|ad|od)/.test(UA);

  if (!IS_IOS) return;

  let allowUntil = 0;
  const ARM_MS = 1500;

  function armAllow() { allowUntil = Date.now() + ARM_MS; }
  function isAllowed() { return Date.now() <= allowUntil; }

  // Mark recent *trusted* user gestures
  ['pointerdown', 'touchstart', 'click', 'keydown'].forEach(ev => {
    window.addEventListener(ev, (e) => {
      try {
        if (e && e.isTrusted === true) {
          // Ignore pure modifier keys to avoid accidental arming on desktop Safari
          if (ev === 'keydown') {
            const k = String(e.key || '').toLowerCase();
            if (['shift','alt','meta','control','tab'].includes(k)) return;
          }
          armAllow();
        }
      } catch {}
    }, { capture: true, passive: true });
  });

  // Patch webkitSpeechRecognition.start to require a trusted gesture window
  try {
    const SR = window.webkitSpeechRecognition;
    if (SR && SR.prototype && !SR.prototype.__am_ios_guard__) {
      const origStart = SR.prototype.start;
      SR.prototype.start = function guardedStart() {
        if (!isAllowed()) {
          console.warn('[wake-ios-guard] Blocked recognition.start() without recent user gesture.');
          // Soft-fail: do nothing; caller can handle onerror/onend if needed
          return;
        }
        allowUntil = 0;
        return origStart.apply(this, arguments);
      };
      SR.prototype.__am_ios_guard__ = true;
      console.log('[wake-ios-guard] Patched webkitSpeechRecognition.start');
    }
  } catch {}

  // Guard wake checkbox: prevent programmatic enable without user gesture
  function hookWakeCheckbox(chk) {
    if (!chk || chk.__am_ios_guard__) return;

    const onChange = (e) => {
      try {
        // If turned on but outside the allowed gesture window — revert
        if (chk.checked && !isAllowed()) {
          console.warn('[wake-ios-guard] Reverting programmatic wake enable on iOS.');
          chk.checked = false;
          // Stop event propagation if the change was synthetic
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
    return document.querySelector('#as-voice') || // your primary id
           document.querySelector('[data-voice-wake]') || null;
  }

  // Install once DOM is ready
  const onReady = () => {
    const chk = findWakeCheckbox();
    if (chk) hookWakeCheckbox(chk);

    // Watch for the checkbox appearing later (SPA)
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
