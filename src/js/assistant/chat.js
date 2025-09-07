/* Chat Friend + Wake Word + AI
   - Говорит/слушает, поддерживает диалог, дергает события assistant:* на фронте
   - Для AI нужен сервер на VITE_API_URL (или http://localhost:8787 в dev)
*/
(() => {
  const hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  // ---------- API base ----------
  const API_BASE =
    (import.meta?.env?.VITE_API_URL && import.meta.env.VITE_API_URL.replace(/\/+$/, '')) ||
    (location.hostname === 'localhost' ? 'http://localhost:8787' : '');

  // ---------- UI ----------
  const root = document.createElement('div');
  root.id = 'assistant-root';
  root.className = 'assistant';
  root.innerHTML = `
    <button class="assistant__toggle" aria-label="Чат-ассистент">🤖</button>
    <div class="assistant__panel" hidden>
      <div class="assistant__header">
        <strong>Чат-друг</strong>
        <div class="assistant__hdr-actions">
          <span class="assistant__badge" title="Связь с AI">${API_BASE ? 'AI' : 'OFF'}</span>
          <button class="assistant__gear" aria-label="Настройки">⚙️</button>
          <button class="assistant__close" aria-label="Закрыть">✕</button>
        </div>
      </div>

      <div class="assistant__log" id="assistantLog"></div>

      <div class="assistant__controls">
        ${hasSR ? '<button class="assistant__mic" aria-label="Голос">🎤</button>' : ''}
        <input class="assistant__input" type="text" placeholder="Скажи або напиши…"/>
        <button class="assistant__send">Отправить</button>
      </div>

      <div class="assistant__settings" hidden>
        <label class="assistant__row">
          <span>Голос озвучки</span>
          <select id="as-voice"></select>
        </label>
        <label class="assistant__row">
          <span>Активация фразой</span>
          <input id="as-wake" type="checkbox" />
          <small class="assistant__hint">Фразы: «привіт артист», «привет друг», «hey assistant»</small>
        </label>
        <div class="assistant__row">
          <button id="as-test-voice" type="button">Проба голоса</button>
          <button id="as-clear-log" type="button">Очистить чат</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const panel   = root.querySelector('.assistant__panel');
  const btnOpen = root.querySelector('.assistant__toggle');
  const btnClose= root.querySelector('.assistant__close');
  const btnGear = root.querySelector('.assistant__gear');
  const logEl   = root.querySelector('#assistantLog');
  const inputEl = root.querySelector('.assistant__input');
  const btnSend = root.querySelector('.assistant__send');
  const btnMic  = root.querySelector('.assistant__mic');
  const settings= root.querySelector('.assistant__settings');
  const selVoice= root.querySelector('#as-voice');
  const chkWake = root.querySelector('#as-wake');
  const btnTest = root.querySelector('#as-test-voice');
  const btnClr  = root.querySelector('#as-clear-log');

  // ---------- state ----------
  const state = {
    listening: false,
    srCmd: null,         // SR для «команды»
    srWake: null,        // SR для «активации»
    wakeEnabled: localStorage.getItem('assistant.wake') === '1',
    voiceName: localStorage.getItem('assistant.voice') || ''
  };

  // ---------- speech synthesis ----------
  function speak(text) {
    try {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      if (state.voiceName) {
        const v = window.speechSynthesis.getVoices().find(v => v.name === state.voiceName);
        if (v) u.voice = v;
      } else {
        const lang = (navigator.language || '').toLowerCase();
        u.lang = lang.startsWith('uk') ? 'uk-UA' : lang.startsWith('ru') ? 'ru-RU' : 'en-US';
      }
      u.rate = 1; u.pitch = 1;
      window.speechSynthesis.speak(u);
    } catch (e) {
      console.warn('speak failed', e);
    }
  }

  function populateVoices() {
    try {
      const voices = window.speechSynthesis.getVoices();
      selVoice.innerHTML = `<option value="">Системный</option>` +
        voices.map(v => `<option value="${v.name}">${v.name} — ${v.lang}</option>`).join('');
      if (state.voiceName) selVoice.value = state.voiceName;
    } catch {}
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = populateVoices;
    // «Прогрев» TTS после первого клика по странице
    const arm = () => { document.removeEventListener('pointerdown', arm, true); try { populateVoices(); speak(''); } catch {} };
    document.addEventListener('pointerdown', arm, true);
    setTimeout(populateVoices, 400);
  }

  // ---------- helpers ----------
  function log(text, who = 'bot') {
    const item = document.createElement('div');
    item.className = `assistant__msg assistant__msg--${who}`;
    item.textContent = text;
    logEl.appendChild(item);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function dispatch(name, detail = {}) {
    document.dispatchEvent(new CustomEvent(`assistant:${name}`, { detail }));
  }
  function setListView(on) {
    document.documentElement.classList.toggle('list-view', !!on);
    dispatch('view', { mode: on ? 'list' : 'grid' });
  }

  // ---------- локальные команды (фоллбэк) ----------
  function handleCommandLocal(text) {
    const t = (text || '').toLowerCase();

    if (/(list|список|лист( ?вью)?)/.test(t)) { setListView(true); return 'Включаю список'; }
    if (/(grid|сетка|карточк)/.test(t))     { setListView(false); return 'Включаю сетку'; }

    if (/(next|след)/.test(t))              { dispatch('player-next');  return 'Следующий трек'; }
    if (/(prev|пред)/.test(t))              { dispatch('player-prev');  return 'Предыдущий трек'; }
    if (/(пауза|pause|стоп)/.test(t))       { dispatch('player-pause'); return 'Пауза'; }
    if (/(play|плей|включи)/.test(t))       { dispatch('player-play');  return 'Играю'; }

    if (/(тише|quieter|volume down)/.test(t)) { dispatch('volume', { delta: -0.1 }); return 'Тише'; }
    if (/(громче|louder|volume up)/.test(t))  { dispatch('volume', { delta: +0.1 }); return 'Громче'; }

    const moods = [
      { re: /(весел|радіс|радост|happy|joy)/, mood: 'happy' },
      { re: /(спок|calm|chill|relax)/,        mood: 'calm' },
      { re: /(сум|sad|minor)/,                mood: 'sad' },
      { re: /(енерг|drive|бадьор|рок|rock)/,  mood: 'energetic' }
    ];
    const m = moods.find(m => m.re.test(t));
    if (m) { dispatch('recommend', { mood: m.mood }); return `Підбираю під настрій: ${m.mood}`; }

    const g = t.match(/жанр\s*([a-zа-яёіїє-]+)/i);
    if (g && g[1]) { dispatch('recommend', { genre: g[1] }); return `Жанр: ${g[1]}`; }

    const like = t.match(/(хочу|знайди|найди)\s+(.+)/i);
    if (like && like[2]) { dispatch('recommend', { like: like[2].trim() }); return `Шукаю: ${like[2].trim()}`; }

    return 'Я здесь. Могу переключать вид, управлять треком и подбирать музыку по настроению.';
  }

function runActions(actions = []) {
  for (const a of actions) {
    if (a.type === 'player' && a.action) {
      dispatch('player-' + a.action);
    } else if (a.type === 'view' && a.mode) {
      dispatch('view', { mode: a.mode });
    } else if (a.type === 'recommend') {
      dispatch('recommend', a);
    } else if (a.type === 'volume') {
      dispatch('volume', a);
    } else if (a.type === 'play') {
      // новое: точечный запуск по id/строке
      if (a.id) dispatch('play', { id: a.id });
      else if (a.query) dispatch('play-query', { query: a.query });
    }
  }
}

  // ---------- AI вызов ----------
  async function callAI(message) {
    if (!API_BASE) return null;
    const r = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    if (!r.ok) throw new Error(`API ${r.status}`);
    return r.json(); // { reply, explain?, actions? }
  }

  async function handleUserText(text) {
    const v = String(text || '').trim();
    if (!v) return;
    log(v, 'user');

    try {
      const data = await callAI(v);
      if (data && data.reply) {
        log(data.reply, 'bot');
        speak(data.reply);
        runActions(data.actions);
        if (data.explain) log('[' + data.explain + ']', 'note');
        return;
      }
    } catch (e) {
      console.warn('AI API error', e);
    }

    // Фоллбэк
    const reply = handleCommandLocal(v);
    log(reply, 'bot');
    speak(reply);
  }

  // ---------- SR (mic) ----------
  function startCommandSR() {
    if (!hasSR) return;
    stopCommandSR();

    const rec = new SR();
    state.srCmd = rec;
    rec.lang = (navigator.language || 'ru-RU');
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = ev => {
      const text = ev.results?.[0]?.[0]?.transcript || '';
      if (text) handleUserText(text);
    };
    rec.onerror = e => { console.warn('SR cmd error', e?.error || e); };
    rec.onend = () => { state.listening = false; btnMic?.classList.remove('is-on'); };

    try { rec.start(); state.listening = true; btnMic?.classList.add('is-on'); }
    catch (e) { console.warn('SR start failed', e); }
  }
  function stopCommandSR() {
    try { state.srCmd?.stop?.(); } catch {}
    state.srCmd = null;
  }

  // ---------- Wake word ----------
  const wakePatterns = [
    /прив(е|і)т\s+(друг|артист|ассистент)/i,
    /прив(е|і)т/i,
    /hey\s+(assistant|buddy|artist)/i,
    /ok\s+(assistant|buddy|artist)/i
  ];
  function matchesWake(text) { return wakePatterns.some(re => re.test(text || '')); }

  function startWakeSR() {
    if (!hasSR || state.srWake) return;
    const rec = new SR();
    state.srWake = rec;
    rec.lang = (navigator.language || 'ru-RU');
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    rec.onresult = (ev) => {
      const res = ev.results[ev.results.length - 1];
      const text = res[0]?.transcript || '';
      if (matchesWake(text)) {
        log('Слушаю…', 'bot'); speak('Слушаю');
        try { state.srWake.stop(); } catch {}
        state.srWake = null;
        startCommandSR();
        const back = () => { if (state.wakeEnabled) startWakeSR(); document.removeEventListener('assistant:cmd-done', back); };
        document.addEventListener('assistant:cmd-done', back);
      }
    };
    rec.onerror = e => { console.warn('SR wake error', e?.error || e); };
    rec.onend   = () => { if (state.wakeEnabled) setTimeout(() => { try { startWakeSR(); } catch {} }, 200); };

    try { rec.start(); } catch (e) { console.warn('wake start failed', e); }
  }
  function stopWakeSR() { try { state.srWake?.stop?.(); } catch {}; state.srWake = null; }

  // ---------- wiring ----------
  function sendText() {
    const v = inputEl.value.trim();
    if (!v) return;
    inputEl.value = '';
    handleUserText(v);
    document.dispatchEvent(new CustomEvent('assistant:cmd-done'));
  }

  btnOpen.addEventListener('click', () => { panel.hidden = !panel.hidden; });
  btnClose.addEventListener('click', () => { panel.hidden = true; });
  btnGear.addEventListener('click', () => { settings.hidden = !settings.hidden; });
  btnSend.addEventListener('click', sendText);
  inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendText(); });

  if (btnMic && hasSR) {
    btnMic.addEventListener('click', () => {
      if (state.listening) { stopCommandSR(); return; }
      startCommandSR();
    });
  }

  selVoice?.addEventListener('change', () => {
    state.voiceName = selVoice.value || '';
    localStorage.setItem('assistant.voice', state.voiceName);
    speak('Голос выбран');
  });
  btnTest?.addEventListener('click', () => speak('Привет! Я твой голосовой друг.'));
  btnClr?.addEventListener('click', () => { logEl.innerHTML = ''; });

  chkWake?.addEventListener('change', () => {
    state.wakeEnabled = chkWake.checked;
    localStorage.setItem('assistant.wake', state.wakeEnabled ? '1' : '0');
    if (state.wakeEnabled) {
      // один тихий запуск, чтобы браузер дал доступ к микрофону
      if (!state.listening && hasSR) {
        try { startCommandSR(); setTimeout(() => { stopCommandSR(); startWakeSR(); }, 350); } catch {}
      } else {
        startWakeSR();
      }
      log('Горячая фраза включена. Скажи: «привет друг».', 'bot');
    } else {
      stopWakeSR(); stopCommandSR();
      log('Горячая фраза выключена.', 'bot');
    }
  });

  // восстановление настроек
  if (chkWake) chkWake.checked = state.wakeEnabled;
  if (state.wakeEnabled) {
    const arm = () => { document.removeEventListener('pointerdown', arm, true);
      try { startCommandSR(); setTimeout(() => { stopCommandSR(); startWakeSR(); }, 350); } catch {}
    };
    document.addEventListener('pointerdown', arm, true);
  }
})();
