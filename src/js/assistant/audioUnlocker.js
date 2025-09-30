/* Audio unlock helper (no ESM). Exposes:
   window.AudioUnlocker: { isUnlocked(), getContext(), unlockNow() }
   window.__unlockAudioNow(): void
   window.__ensureAudioUnlocked(): Promise<boolean>
*/
(function (global) {
  'use strict';

  var Ctx = global.AudioContext || global.webkitAudioContext;

  // If WebAudio is unavailable — provide no-op API that always resolves.
  if (!Ctx) {
    var resolvedTrue = Promise.resolve(true);
    var noop = {
      isUnlocked: function () { return true; },
      getContext: function () { return null; },
      unlockNow: function () {}
    };
    global.AudioUnlocker = noop;
    global.__unlockAudioNow = function () {};
    global.__ensureAudioUnlocked = function () { return resolvedTrue; };
    return;
  }

  var ctx = null;
  var unlocked = false;
  var waiters = []; // resolvers awaiting unlock

  function getContext() {
    if (!ctx) {
      try {
        ctx = new Ctx({ latencyHint: 'interactive' });
      } catch (e) {
        ctx = new Ctx();
      }
    }
    return ctx;
  }

  function playTinySilence(c) {
    try {
      var sr = c.sampleRate || 44100;
      var buffer = c.createBuffer(1, Math.max(1, Math.floor(sr * 0.001)), sr);
      var src = c.createBufferSource();
      src.buffer = buffer;
      src.connect(c.destination);
      src.start(0);
      src.stop(c.currentTime + 0.001);
    } catch (e) {}
  }

  function notifyUnlocked() {
    if (!unlocked) return;
    for (var i = 0; i < waiters.length; i++) {
      try { waiters[i](true); } catch (e) {}
    }
    waiters.length = 0;
    detachGlobalListeners();
  }

  // Only mark unlocked after resume() actually yields running
  function doUnlockSyncAttempt() {
    if (unlocked) return false;
    var c = getContext();
    if (!c) { unlocked = true; notifyUnlocked(); return true; }

    try { playTinySilence(c); } catch (e) {}

    try {
      if (c.state === 'suspended' && typeof c.resume === 'function') {
        c.resume().then(function () {
          if (c.state === 'running') {
            unlocked = true;
            notifyUnlocked();
          }
        }).catch(function () {
          // keep listeners for the next real gesture
        });
      } else if (c.state === 'running') {
        unlocked = true;
        notifyUnlocked();
      }
    } catch (e) {
      // ignore; try again on the next gesture
    }

    return unlocked;
  }

  function tryUnlockOnce(ev) {
    if (unlocked) return;
    // Keydown: only treat Enter/Space as a real gesture
    if (ev && ev.type === 'keydown') {
      var k = (ev.key || '').toLowerCase();
      if (k !== ' ' && k !== 'spacebar' && k !== 'enter') return;
    }
    doUnlockSyncAttempt();
  }

  // Promise API used elsewhere: await window.__ensureAudioUnlocked()
  function ensureAudioUnlocked() {
    if (unlocked) return Promise.resolve(true);
    return new Promise(function (resolve) { waiters.push(resolve); });
  }

  var UNLOCK_EVENTS = ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown'];
  var UNLOCK_TARGETS = [];
  if (typeof window !== 'undefined') UNLOCK_TARGETS.push(window);
  if (typeof document !== 'undefined') UNLOCK_TARGETS.push(document);
  if (typeof document !== 'undefined' && document.body) UNLOCK_TARGETS.push(document.body);

  function attachGlobalListeners() {
    for (var i = 0; i < UNLOCK_TARGETS.length; i++) {
      var t = UNLOCK_TARGETS[i];
      for (var j = 0; j < UNLOCK_EVENTS.length; j++) {
        var ev = UNLOCK_EVENTS[j];
        try {
          // capture:true — чтобы поймать самый первый жест; passive:true — мы не preventDefault
          t.addEventListener(ev, tryUnlockOnce, { once: false, passive: true, capture: true });
        } catch (e) {}
      }
    }
  }

  function detachGlobalListeners() {
    for (var i = 0; i < UNLOCK_TARGETS.length; i++) {
      var t = UNLOCK_TARGETS[i];
      for (var j = 0; j < UNLOCK_EVENTS.length; j++) {
        var ev = UNLOCK_EVENTS[j];
        try { t.removeEventListener(ev, tryUnlockOnce, { capture: true }); } catch (e) {}
      }
    }
  }

  // Public API
  var API = {
    isUnlocked: function () { return unlocked; },
    getContext: getContext,
    unlockNow: function () { tryUnlockOnce({ type: 'click' }); } // synthetic "gesture"
  };

  global.AudioUnlocker = API;
  global.__unlockAudioNow = API.unlockNow;
  global.__ensureAudioUnlocked = ensureAudioUnlocked;

  attachGlobalListeners();

})(typeof window !== 'undefined' ? window : this);
