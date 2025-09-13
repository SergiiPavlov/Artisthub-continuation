// src/js/assistant/help.js
(() => {
  if (window.__ASSISTANT_HELP_INIT__) return;
  window.__ASSISTANT_HELP_INIT__ = true;

  // Styles (scoped, no global CSS edits required)
  const css = `
  .assistant-help__overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);z-index:11000;display:none}
  .assistant-help__wrap{position:fixed;right:18px;bottom:84px;width:min(94vw,680px);max-height:calc(100vh - 120px);overflow:auto;background:#0f1216;color:#e8f1ff;border:1px solid rgba(255,255,255,.08);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.55);z-index:11001;display:none}
  .assistant-help__hdr{display:flex;align-items:center;gap:.5rem;padding:.9rem 1rem;background:linear-gradient(180deg,#121821,#0e1318);border-bottom:1px solid rgba(255,255,255,.06)}
  .assistant-help__title{font-weight:700}
  .assistant-help__close{margin-left:auto;background:transparent;border:1px solid rgba(255,255,255,.18);color:#cbd5e1;border-radius:8px;padding:.35rem .6rem;cursor:pointer}
  .assistant-help__body{padding:1rem 1.1rem;line-height:1.5}
  .assistant-help__body h4{margin:.9rem 0 .35rem;font-size:1.05rem}
  .assistant-help__body code{background:#141a22;border:1px solid #263142;border-radius:6px;padding:.05rem .35rem}
  .assistant-help__list{margin:.3rem 0 .8rem;padding-left:1.1rem}
  .assistant-help__note{opacity:.8;font-size:.92rem}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // Markup
  const overlay = document.createElement('div');
  overlay.className = 'assistant-help__overlay';
  const wrap = document.createElement('div');
  wrap.className = 'assistant-help__wrap';
  wrap.innerHTML = `
    <div class="assistant-help__hdr">
      <div class="assistant-help__title">How to use the chat</div>
      <button class="assistant-help__close" type="button" aria-label="Close">✕</button>
    </div>
    <div class="assistant-help__body">
      <p class="assistant-help__note">
        The Chat-Friend controls the player, finds music, and can speak responses.
        Choose <b>Auto / Free / Pro</b> mode, pick a language, and (optionally) enable server TTS.
      </p>

      <h4>Quick start</h4>
      <ul class="assistant-help__list">
        <li>Press the mic or type — the assistant replies with text and voice.</li>
        <li>In <b>Settings</b> choose language (RU/UK/EN), a voice, and TTS mode.</li>
        <li>Modes: <b>Free</b> = Groq, <b>Pro</b> = OpenAI, <b>Auto</b> = picks automatically.</li>
      </ul>

      <h4>Player controls</h4>
      <ul class="assistant-help__list">
        <li><code>Next</code>, <code>Previous</code></li>
        <li><code>Pause</code>, <code>Stop</code>, <code>Play</code></li>
        <li><code>Louder</code> / <code>Quieter</code></li>
        <li><code>minimize the window</code> / <code>maximize the window</code></li>
        <li><code>Mix radio</code> — endless flow by taste</li>
        <li><code>What’s playing?</code> — speaks the current track title</li>
      </ul>

      <h4>Play a track / genre / artist</h4>
      <ul class="assistant-help__list">
        <li><code>Play The Prodigy</code>, <code>Play classic rock</code></li>
        <li>Or just a query: <code>lofi hip hop radio</code></li>
        <li>Links/IDs from YouTube are understood (IDs are extracted from text).</li>
      </ul>

      <h4>By mood</h4>
      <ul class="assistant-help__list">
        <li><code>Calm</code>, <code>Happy</code>, <code>Sad</code>, <code>Energetic</code></li>
        <li>Example: <code>Pick something calm</code></li>
      </ul>

      <h4>Timers & “after current”</h4>
      <ul class="assistant-help__list">
        <li><code>Pause in 30 seconds</code>, <code>Stop in 1:30</code>, <code>Stop in one minute</code></li>
        <li><code>Pause after current track</code> or <code>Stop after current</code></li>
        <li>Cancel: <code>Cancel the timer</code></li>
      </ul>

      <h4>Hands-free (wake word)</h4>
      <ul class="assistant-help__list">
        <li>Enable <b>Always listening</b> and set wake words (e.g. <code>dj</code>).</li>
        <li>Works while the tab is active and mic permission is granted.</li>
      </ul>

      <h4>Voice output</h4>
      <ul class="assistant-help__list">
        <li><b>Server TTS (Piper)</b> — better quality, no browser voices; needs a working backend.</li>
        <li><b>Browser TTS</b> — system voices. If autoplay is blocked, press “Voice test”.</li>
      </ul>

      <h4>If nothing speaks</h4>
      <ul class="assistant-help__list">
        <li>Give the page a click first (browsers block sound before user gesture).</li>
        <li>Allow microphone and sound for the site.</li>
        <li>Check the green <code>AI</code> badge and that <code>window.API_BASE</code> points to your server.</li>
      </ul>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(wrap);

  function open() {
    // If triggered from the mobile menu — close it first
    try { window.closeMenu?.(); } catch {}
    overlay.style.display = 'block';
    wrap.style.display = 'block';
  }
  function close() {
    overlay.style.display = 'none';
    wrap.style.display = 'none';
  }

  overlay.addEventListener('click', close);
  wrap.querySelector('.assistant-help__close')?.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  // Export
  window.Assistant = window.Assistant || {};
  window.Assistant.showHelp = open;

  // Delegated click from header (desktop + mobile)
  document.addEventListener('click', (e) => {
    const el = e.target.closest('.js-assistant-howto');
    if (el) { e.preventDefault(); open(); }
  });
})();

