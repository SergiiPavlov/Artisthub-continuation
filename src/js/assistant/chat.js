/* Chat Friend + Wake Word (Web Speech) v3
   - микрофон по кнопке ИЛИ по фразе-активатору (после одного разрешения микрофона)
   - команды: play/пауза/след/пред/громче/тише/лист/сетка/микс радио/жанр/настроение и т.д.
   - совместим с мостом assistant/bridge.js (генерим события assistant:*)

   Ограничения браузеров:
   - первый запуск микрофона ВСЕГДА требует пользовательский жест (клик).
   - если вкладка невидима, Chrome может «притушить» распознавание.
*/

(() => {
  const hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

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
          <button class="assistant__gear" aria-label="Настройки">⚙️</button>
          <button class="assistant__close" aria-label="Закрыть">✕</button>
        </div>
      </div>

      <div class="assistant__log" id="assistantLog"></div>

      <div class="assistant__controls">
        ${hasSR ? '<button class="assistant__mic" aria-label="Голос">🎤</button>' : ''}
        <input class="assistant__input" type="text" placeholder="Скажи або напиши…" />
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

  // кратенькие стили, чтобы было видно
  const style = document.createElement('style');
  style.textContent = `
    .assistant__hdr-actions { display:flex; gap:.5rem; margin-left:auto; }
    .assistant__settings { padding:.75rem; border-top:1px solid rgba(255,255,255,.08); }
    .assistant__row { display:flex; align-items:center; gap:.5rem; margin:.5rem 0; }
    .assistant__row > span { min-width: 160px; opacity:.85; }
    .assistant__hint { opacity:.6; }
    .assistant__msg { padding:.5rem .75rem; border-radius:.75rem; margin:.4rem 0; max-width:85%; }
    .assistant__msg--user { background:#233043; color:#e8f1ff; margin-left:auto; }
    .assistant__msg--bot  { background:#1c1f24; color:#dfe6ef; }
  `;
  document.head.appendChild(style);

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
    srWake: null,        // SR для «активации фразой»
    wakeEnabled: false,
    voices: [],
    voiceName: localStorage.getItem('assistant.voice') || '',
  };

  // ---------- speech synthesis ----------
  function speak(text) {
    try {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      const lang = navigator.language?.toLowerCase();
      if (state.voiceName) {
        const v = window.speechSynthesis.getVoices().find(v => v.name === state.voiceName);
        if (v) u.voice = v;
      }
      if (!u.voice) {
        u.lang =
          lang?.startsWith('uk') ? 'uk-UA' :
          lang?.startsWith('ru') ? 'ru-RU' : 'en-US';
      }
      u.rate = 1; u.pitch = 1;
      window.speechSynthesis.speak(u);
    } catch (e) {
      console.warn('speak failed', e);
    }
  }

  function populateVoices() {
    try {
      state.voices = window.speechSynthesis.getVoices();
      selVoice.innerHTML = `<option value="">Системный</option>` +
        state.voices.map(v => `<option value="${v.name}">${v.name} — ${v.lang}</option>`).join('');
      if (state.voiceName) selVoice.value = state.voiceName;
    } catch (e) {
      console.warn('voices failed', e);
    }
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = populateVoices;
    populateVoices();
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

  // ---------- commands ----------
  function handleCommand(text) {
    const t = (text || '').toLowerCase();

    // вид
    if (/(list|список|лист( ?вью)?)/i.test(t)) { setListView(true); speak('Включаю список'); return log('Включаю список','bot'); }
    if (/(grid|сетка|карточки)/i.test(t)) { setListView(false); speak('Включаю сетку'); return log('Включаю сетку','bot'); }

    // транспорт
    if (/(след|next)/i.test(t)) { dispatch('player-next'); return log('Следующий трек','bot'); }
    if (/(пред|prev)/i.test(t)) { dispatch('player-prev'); return log('Предыдущий трек','bot'); }
    if (/(пауза|pause|стоп)/i.test(t)) { dispatch('player-pause'); return log('Пауза','bot'); }
    if (/(плей|play|включи)/i.test(t)) { dispatch('player-play'); return log('Играет','bot'); }

    // громкость
    if (/(тише|quieter|volume down|поменьше)/i.test(t)) { dispatch('volume', { delta: -0.1 }); return log('Тише','bot'); }
    if (/(громче|louder|volume up|погромче)/i.test(t)) { dispatch('volume', { delta: +0.1 }); return log('Громче','bot'); }

    // микс-радио
    if (/(mix ?radio|микс|радио|random)/i.test(t)) {
      const btn = document.getElementById('random-radio');
      if (btn) btn.click();
      else dispatch('player-play');
      return log('Mix Radio','bot');
    }

    // настроение / жанр / поиск
    const moods = [
      { re: /(весел|радіс|радост|happy|joy)/i, mood: 'happy' },
      { re: /(спок|calm|chill|relax)/i, mood: 'calm' },
      { re: /(сум|sad|minor)/i, mood: 'sad' },
      { re: /(енерг|drive|бадьор|рок|rock)/i, mood: 'energetic' }
    ];
    const m = moods.find(m => m.re.test(t));
    if (m) { dispatch('recommend', { mood: m.mood }); log(`Підбираю під настрій: ${m.mood}`,'bot'); speak(`Підбираю музику під настрій ${m.mood}`); return; }

    const g = t.match(/жанр\s*([a-zа-яёіїє-]+)/i);
    if (g && g[1]) { dispatch('recommend', { genre: g[1] }); log(`Жанр: ${g[1]}`,'bot'); return; }

    // лайк/поиск по слову
    const like = t.match(/(хочу|знайди|найди)\s+(.+)/i);
    if (like && like[2]) { dispatch('recommend', { like: like[2].trim() }); log(`Шукаю: ${like[2].trim()}`,'bot'); return; }

    log('Я здесь. Могу переключать вид, управлять треком и подбирать музыку по настроению.','bot');
  }

  // ---------- SR for one-shot command ----------
  function startCommandSR() {
    if (!hasSR) return;
    stopCommandSR();

    const rec = new SR();
    state.srCmd = rec;
    rec.lang = (navigator.language || 'ru-RU');
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = (ev) => {
      const text = ev.results?.[0]?.[0]?.transcript || '';
      if (text) { log(text, 'user'); handleCommand(text); }
    };
    rec.onerror = (e) => { console.warn('SR cmd error', e?.error || e); };
    rec.onend = () => { state.listening = false; btnMic?.classList.remove('is-on'); };

    try { rec.start(); state.listening = true; btnMic?.classList.add('is-on'); }
    catch (e) { console.warn('SR start failed', e); }
  }
  function stopCommandSR() {
    try { state.srCmd?.stop?.(); } catch (e) { /* noop */ }
    state.srCmd = null;
  }

  // ---------- SR for wake word ----------
  const wakePatterns = [
    /прив(е|і)т\s+(друг|артист|ассистент)/i,
    /прив(е|і)т/i,
    /hey\s+(assistant|buddy|artist)/i,
    /ok\s+(assistant|buddy|artist)/i,
  ];

  function matchesWake(text) {
    return wakePatterns.some(re => re.test(text || ''));
  }

  function startWakeSR() {
    if (!hasSR || state.srWake) return;
    const rec = new SR();
    state.srWake = rec;
    rec.lang = (navigator.language || 'ru-RU');
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    let lastHeard = '';

    rec.onresult = (ev) => {
      const res = ev.results[ev.results.length - 1];
      const text = res[0]?.transcript || '';
      if (!text) return;
      lastHeard = text;

      if (matchesWake(text)) {
        log('Слушаю…','bot'); speak('Слушаю');
        // перезапускаем «cmd»-режим: одна следующая фраза — и выполняем команду
        try { state.srWake.stop(); } catch (e) { /* ignore */ }
        state.srWake = null;
        startCommandSR();
        // после завершения команды – снова включим wake, если чекбокс вкл
        const back = () => { if (state.wakeEnabled) startWakeSR(); document.removeEventListener('assistant:cmd-done', back); };
        document.addEventListener('assistant:cmd-done', back);
      }
    };
    rec.onerror = (e) => { console.warn('SR wake error', e?.error || e); };
    rec.onend = () => {
      // автоперезапуск в режиме wake
      if (state.wakeEnabled) {
        setTimeout(() => { try { startWakeSR(); } catch (e) {} }, 200);
      }
    };

    try { rec.start(); }
    catch (e) { console.warn('wake start failed', e); }
  }
  function stopWakeSR() {
    try { state.srWake?.stop?.(); } catch (e) { /* noop */ }
    state.srWake = null;
  }

  // ---------- wiring ----------
  function sendText() {
    const v = inputEl.value.trim();
    if (!v) return;
    log(v, 'user');
    inputEl.value = '';
    handleCommand(v);
    // сообщим, что команда выполнена (для возврата в wake)
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
      startCommandSR(); // первый жест разрешит микрофон
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
      // чтобы браузер дал доступ к микрофону, сделаем один немой запуск SR команд
      if (!state.listening && hasSR) {
        try { startCommandSR(); setTimeout(() => { stopCommandSR(); startWakeSR(); }, 350); }
        catch (e) { console.warn('prime mic failed', e); }
      } else {
        startWakeSR();
      }
      log('Горячая фраза включена. Скажи: «привет друг».','bot');
    } else {
      stopWakeSR(); stopCommandSR();
      log('Горячая фраза выключена.','bot');
    }
  });

  // восстановим настройки
  state.wakeEnabled = localStorage.getItem('assistant.wake') === '1';
  if (chkWake) chkWake.checked = state.wakeEnabled;
  if (state.wakeEnabled) {
    // активируем после первого пользовательского жеста на странице
    const arm = () => { document.removeEventListener('pointerdown', arm, true); try { startCommandSR(); setTimeout(() => { stopCommandSR(); startWakeSR(); }, 350); } catch (e) {} };
    document.addEventListener('pointerdown', arm, true);
  }

})();
