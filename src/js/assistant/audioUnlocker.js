// audioUnlocker.js — browser-safe IIFE with __ensureAudioUnlocked Promise API
// Exposes:
//   window.AudioUnlocker: { isUnlocked(), getContext(), unlockNow() }
//   window.__unlockAudioNow(): void
//   window.__ensureAudioUnlocked(): Promise<boolean>
// No ESM 'export' keywords — safe for <script> without type="module".

(function (global) {
  'use strict';

  var Ctx = global.AudioContext || global.webkitAudioContext;

  // No WebAudio? Expose no-op API that resolves immediately.
  if (!Ctx) {
    var resolvedTrue = Promise.resolve(true);
    var noop = {
      isUnlocked: function () { return true; },
      getContext: function () { return null; },
      unlockNow: function () { /* no-op */ }
    };
    global.AudioUnlocker = noop;
    global.__unlockAudioNow = function () {};
    global.__ensureAudioUnlocked = function () { return resolvedTrue; };
    return;
  }

  var ctx = null;
  var unlocked = false;
  var waiters = []; // pending resolvers waiting for unlock

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

  function playVeryShortSilence(c) {
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
    // Resolve all pending promises
    for (var i = 0; i < waiters.length; i++) {
      try { waiters[i](true); } catch (e) {}
    }
    waiters.length = 0;
    // Detach listeners; we are done
    detachGlobalListeners();
  }

  function doUnlock() {
    if (unlocked) return;
    var c = getContext();
    if (!c) { unlocked = true; notifyUnlocked(); return; }
    try { if (c.state === 'suspended') c.resume(); } catch (e) {}
    try { playVeryShortSilence(c); } catch (e) {}
    setTimeout(function () {
      try { if (c.state === 'suspended') c.resume(); } catch (e) {}
    }, 0);
    unlocked = true;
    notifyUnlocked();
  }

  function tryUnlockOnce() {
    if (unlocked) return;
    doUnlock();
  }

  // Promise API used by other modules (await window.__ensureAudioUnlocked())
  function ensureAudioUnlocked() {
    if (unlocked) return Promise.resolve(true);
    return new Promise(function (resolve) {
      waiters.push(resolve);
    });
  }

  var UNLOCK_EVENTS = ['pointerdown','mousedown','touchstart','keydown','click'];
  var UNLOCK_TARGETS = [];
  if (typeof window !== 'undefined') UNLOCK_TARGETS.push(window);
  if (typeof document !== 'undefined') UNLOCK_TARGETS.push(document);
  if (typeof document !== 'undefined' && document.body) UNLOCK_TARGETS.push(document.body);

  function attachGlobalListeners() {
    for (var i=0; i<UNLOCK_TARGETS.length; i++) {
      var t = UNLOCK_TARGETS[i];
      for (var j=0; j<UNLOCK_EVENTS.length; j++) {
        var ev = UNLOCK_EVENTS[j];
        try {
          t.addEventListener(ev, tryUnlockOnce, { once: true, passive: true, capture: true });
        } catch (e) {}
      }
    }
  }

  function detachGlobalListeners() {
    for (var i=0; i<UNLOCK_TARGETS.length; i++) {
      var t = UNLOCK_TARGETS[i];
      for (var j=0; j<UNLOCK_EVENTS.length; j++) {
        var ev = UNLOCK_EVENTS[j];
        try { t.removeEventListener(ev, tryUnlockOnce, { capture: true }); } catch (e) {}
      }
    }
  }

  // Public API
  var API = {
    isUnlocked: function () { return unlocked; },
    getContext: getContext,
    unlockNow: function () { tryUnlockOnce(); }
  };

  global.AudioUnlocker = API;
  global.__unlockAudioNow = API.unlockNow;
  global.__ensureAudioUnlocked = ensureAudioUnlocked;

  // Attach listeners immediately so the first gesture unlocks audio
  attachGlobalListeners();

})(typeof window !== 'undefined' ? window : this);
