// audioUnlocker.iife.js — browser-safe (no ESM exports)
// Attach to window.AudioUnlocker and window.__unlockAudioNow, no 'export' keywords.

(function (global) {
  'use strict';

  var Ctx = global.AudioContext || global.webkitAudioContext;

  // No WebAudio? Expose no-op API.
  if (!Ctx) {
    var noop = {
      isUnlocked: function () { return true; },
      getContext: function () { return null; },
      unlockNow: function () {}
    };
    global.AudioUnlocker = noop;
    global.__unlockAudioNow = noop.unlockNow;
    return;
  }

  var ctx = null;
  var unlocked = false;

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

  function doUnlock() {
    if (unlocked) return;
    var c = getContext();
    if (!c) { unlocked = true; return; }
    try { if (c.state === 'suspended') c.resume(); } catch (e) {}
    try { playVeryShortSilence(c); } catch (e) {}
    setTimeout(function () {
      try { if (c.state === 'suspended') c.resume(); } catch (e) {}
    }, 0);
    unlocked = true;
  }

  function tryUnlockOnce() {
    if (unlocked) return;
    doUnlock();
    detachGlobalListeners();
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

  var API = {
    isUnlocked: function () { return unlocked; },
    getContext: getContext,
    unlockNow: tryUnlockOnce
  };

  global.AudioUnlocker = API;
  global.__unlockAudioNow = API.unlockNow;

  attachGlobalListeners();

})(typeof window !== 'undefined' ? window : this);
