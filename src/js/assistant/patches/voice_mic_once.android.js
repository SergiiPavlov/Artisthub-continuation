/**
 * src/js/assistant/patches/voice_mic_once.android.js
 * Goal: Only one mic permission prompt per session on Android/Chrome.
 * - Request getUserMedia({audio:true}) exactly ONCE after an explicit user gesture.
 * - Reuse the same MediaStream + SpeechRecognition instance for all subsequent clicks.
 * - Avoid re-creating SR / re-requesting permission each time the mic button is pressed.
 *
 * Usage:
 *   1) Include this file after your core assistant scripts.
 *   2) Ensure your mic button has [data-assistant-mic] (or call window.assistantEnsureMic() yourself).
 *   3) On the first click, the file initializes mic & SR and dispatches "assistant:mic.ready".
 *   4) Your existing handlers can continue to start/stop SR without new permission prompts.
 */
(function voiceMicOnceAndroid(){
  const w = window;
  const d = document;

  let micStream = null;
  let SR = null;
  let audioCtx = null;

  function log(...a){ try{ console.log('[mic-once]', ...a);}catch{} }

  async function getMicOnce(){
    if (micStream) return micStream;
    // Ask only after a user gesture — this function should be called from a click handler
    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
    };
    micStream = await navigator.mediaDevices.getUserMedia(constraints);
    // Keep stream "alive" with a muted audio graph (prevents some devices from suspending tracks)
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
      const src = audioCtx.createMediaStreamSource(micStream);
      const gain = audioCtx.createGain();
      gain.gain.value = 0; // muted
      src.connect(gain);
      gain.connect(audioCtx.destination);
      await audioCtx.resume().catch(()=>{});
    } catch(e){ /* non-fatal */ }
    return micStream;
  }

  function getSR(){
    if (SR) return SR;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return null;
    SR = new Ctor();
    SR.continuous = true;
    SR.interimResults = false;
    // Basic auto-restart safety (Android may stop SR on background)
    SR.addEventListener('end', () => {
      // Don't auto-start here — leave control to the app.
      // The important part is we reuse the same SR instance.
    });
    return SR;
  }

  async function ensureMicAndSR(){
    const stream = await getMicOnce();
    const sr = getSR();
    // Let the app know mic is ready
    try { w.dispatchEvent(new CustomEvent('assistant:mic.ready', { detail: { stream, sr } })); } catch {}
    return { stream, sr };
  }

  // Public API if you want to call from your code
  w.assistantEnsureMic = ensureMicAndSR;

  // Wire to any mic button with data-assistant-mic (capture so we run before other handlers)
  d.addEventListener('click', async (ev) => {
    const t = ev.target instanceof Element ? ev.target : null;
    if (!t) return;
    if (t.closest('[data-assistant-mic]')){
      try {
        await ensureMicAndSR();
        // Do NOT preventDefault; we only prepare mic & SR so your existing logic can proceed.
      } catch (e) {
        console.warn('[mic-once] mic init failed', e);
      }
    }
  }, true);

  // Expose a small helper to check if mic/SR are ready
  w.assistantMicStatus = function(){
    return { hasStream: !!(micStream && micStream.active), hasSR: !!SR, audioCtxState: audioCtx ? audioCtx.state : 'none' };
  };

  console.log('[mic-once] Android mic one-time init active');
})();
