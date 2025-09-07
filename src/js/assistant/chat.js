/* Chat Friend (AI + локальные правила) v4
   - работает и с серверным AI (/api/chat), и без него
   - если в ответе ИИ нет actions, эвристически дергаем нужные (play/pause/next/mixradio/genre/like/volume)
   - события в остальную часть фронта: assistant:player-*, assistant:view, assistant:recommend, assistant:volume, assistant:mixradio
*/

(() => {
  // ===== API base (env -> локалка) =====
  const API_BASE =
    (import.meta?.env?.VITE_API_URL && import.meta.env.VITE_API_URL.replace(/\/+$/,'')) ||
    (location.hostname === 'localhost' ? 'http://localhost:8787' : '');

  // ===== UI =====
  const root = document.createElement('div');
  root.id = 'assistant-root';
  root.className = 'assistant';
  root.innerHTML = `
    <button class="assistant__toggle" aria-label="Чат-ассистент">🤖</button>
    <div class="assistant__panel" hidden>
      <div class="assistant__header">
        <strong>Чат-друг</strong>
        <div class="assistant__hdr-actions">
          <span class="assistant__ai-badge" title="AI сервер">${API_BASE ? 'AI' : ''}</span>
          <button class="assistant__gear" aria-label="Настройки">⚙️</button>
          <button class="assistant__close" aria-label="Закрыть">✕</button>
        </div>
      </div>

      <div class="assistant__log" id="assistantLog"></div>

      <div class="assistant__controls">
        <button class="assistant__mic" aria-label="Голос">🎤</button>
        <input class="assistant__input" type="text" placeholder="Скажи або напиши…"/>
        <button class="assistant__send">Отправить</button>
      </div>

      <div class="assistant__settings" hidden>
        <label class="assistant__row">
          <span>Голос озвучки</span>
          <select id="as-voice"></select>
        </label>
        <div class="assistant__row">
          <button id="as-test-voice" type="button">Проба голоса</button>
          <button id="as-clear-log" type="button">Очистить чат</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const style = document.createElement('style');
  style.textContent = `
    .assistant { position: fixed; right: 18px; bottom: 18px; z-index: 9999; }
    .assistant__toggle{ width:48px;height:48px;border-radius:50%;border:none;background:#0ea5e9;color:#fff;font-size:22px;box-shadow:0 8px 20px rgba(0,0,0,.35);cursor:pointer }
    .assistant__panel{ position: fixed; right: 18px; bottom: 84px; width:min(92vw,520px); max-height:min(80vh,720px); display:flex; flex-direction:column; background:#111418; border:1px solid rgba(255,255,255,.06); border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,.6); overflow:hidden }
    .assistant__header{ display:flex; align-items:center; gap:.75rem; padding:.8rem 1rem; background:linear-gradient(180deg,#121821,#0e1318); border-bottom:1px solid rgba(255,255,255,.06) }
    .assistant__hdr-actions{ margin-left:auto; display:flex; gap:.5rem; align-items:center }
    .assistant__ai-badge{ font:600 12px/1.2 ui-sans-serif,system-ui,Segoe UI,Arial; color:#9ae6b4; background:#203021; border:1px solid #2b4a2d; padding:.25rem .4rem; border-radius:6px }
    .assistant__close,.assistant__gear{ background:none;border:1px solid rgba(255,255,255,.14); color:#cbd5e1; width:32px;height:32px;border-radius:8px;cursor:pointer }
    .assistant__log{ padding:10px 12px; overflow:auto; display:flex; flex-direction:column; gap:8px; height:360px; }
    .assistant__msg{ padding:.6rem .9rem; border-radius:12px; max-width:85%; white-space:pre-wrap; }
    .assistant__msg--user{ margin-left:auto; background:#243244; color:#e7f0ff }
    .assistant__msg--bot{ background:#171b21; color:#dfe6ef }
    .assistant__msg--note{ align-self:center; opacity:.7; font-size:.9em }
    .assistant__controls{ display:flex; gap:8px; padding:10px; border-top:1px solid rgba(255,255,255,.08); background:#0f1216 }
    .assistant__controls input{ flex:1; min-width:0; padding:.65rem .8rem; border-radius:10px; background:#0b0f14; border:1px solid #263142; color:#e8f1ff }
    .assistant__controls button{ border-radius:10px; background:#0ea5e9; color:#fff; border:none; padding:.65rem .9rem; cursor:pointer }
    .assistant__mic{ background:#1f2836 !important; border:1px solid #2a3a52 !important; color:#cbd5e1 !important }
    .assistant__mic.is-on{ outline:2px solid #0ea5e9 }
    .assistant__settings{ padding:.75rem; border-top:1px solid rgba(255,255,255,.08); background:#0f1216 }
    .assistant__row{ display:flex; align-items:center; gap:.5rem; margin:.45rem 0 }
    .assistant__row > span { min-width: 150px; opacity:.85 }
    #as-voice{ flex:1; min-width:0; padding:.45rem .55rem; border-radius:8px; background:#0b0f14; border:1px solid #263142; color:#e8f1ff }
  `;
  document.head.appendChild(style);

  const panel    = root.querySelector('.assistant__panel');
  const btnOpen  = root.querySelector('.assistant__toggle');
  const btnClose = root.querySelector('.assistant__close');
  const btnGear  = root.querySelector('.assistant__gear');
  const logEl    = root.querySelector('#assistantLog');
  const inputEl  = root.querySelector('.assistant__input');
  const btnSend  = root.querySelector('.assistant__send');
  const btnMic   = root.querySelector('.assistant__mic');
  const selVoice = root.querySelector('#as-voice');
  const btnTest  = root.querySelector('#as-test-voice');
  const btnClr   = root.querySelector('#as-clear-log');

  // ===== Speech Synthesis =====
  const tts = { voiceName: localStorage.getItem('assistant.voice') || '' };

  function populateVoices() {
    try {
      const V = window.speechSynthesis?.getVoices?.() || [];
      selVoice.innerHTML = `<option value="">Системный</option>` +
        V.map(v => `<option value="${v.name}">${v.name} — ${v.lang}</option>`).join('');
      if (tts.voiceName) selVoice.value = tts.voiceName;
    } catch {}
  }
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.onvoiceschanged = populateVoices; } catch {}
    setTimeout(populateVoices, 300);
  }

  function speak(text) {
    try {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      if (tts.voiceName) {
        const v = window.speechSynthesis.getVoices().find(v => v.name === tts.voiceName);
        if (v) u.voice = v;
      } else {
        const lang = (navigator.language || 'en-US').toLowerCase();
        u.lang = lang.startsWith('uk') ? 'uk-UA' : lang.startsWith('ru') ? 'ru-RU' : 'en-US';
      }
      u.rate = 1; u.pitch = 1;
      window.speechSynthesis.speak(u);
    } catch {}
  }

  selVoice?.addEventListener('change', () => {
    tts.voiceName = selVoice.value || '';
    localStorage.setItem('assistant.voice', tts.voiceName);
    speak('Голос выбран');
  });
  btnTest?.addEventListener('click', () => speak('Привет! Я твой голосовой друг.'));
  btnClr?.addEventListener('click', () => { logEl.innerHTML = ''; });

  // ===== Log =====
  function log(text, who = 'bot') {
    const item = document.createElement('div');
    item.className = `assistant__msg assistant__msg--${who}`;
    item.textContent = text;
    logEl.appendChild(item);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ===== Dispatch =====
  function dispatch(name, detail = {}) {
    document.dispatchEvent(new CustomEvent(`assistant:${name}`, { detail }));
  }
  function runActions(actions = []) {
    for (const a of actions) {
      if (a?.type === 'player' && a.action) {
        dispatch('player-' + a.action);
      } else if (a?.type === 'view' && a.mode) {
        dispatch('view', { mode: a.mode });
      } else if (a?.type === 'recommend') {
        dispatch('recommend', a);
      } else if (a?.type === 'volume') {
        dispatch('volume', a);
      } else if (a?.type === 'mixradio') {
        dispatch('mixradio', { start: true });
      }
    }
  }

  // ===== Локальные правила (ручные) =====
  function handleCommandLocal(t) {
    const text = (t || '').toLowerCase();

    if (/list|список|лист ?вью/.test(text)) { dispatch('view', { mode: 'list' }); return 'Включаю список'; }
    if (/grid|сетка|карточк/.test(text))     { dispatch('view', { mode: 'grid' }); return 'Включаю сетку'; }

    if (/next|след/.test(text))         { dispatch('player-next');  return 'Следующий трек'; }
    if (/prev|пред/.test(text))         { dispatch('player-prev');  return 'Предыдущий трек'; }
    if (/пауза|стоп|pause/.test(text))  { dispatch('player-pause'); return 'Пауза'; }
    if (/play|плей|включи/.test(text))  { dispatch('player-play');  return 'Играю'; }

    if (/тише|quieter|volume down|поменьше/.test(text)) { dispatch('volume', { delta: -0.1 }); return 'Тише'; }
    if (/громче|louder|volume up|погромче/.test(text))  { dispatch('volume', { delta: +0.1 }); return 'Громче'; }

    if (/(mix ?radio|микс|радио|random)/.test(text)) { dispatch('mixradio', { start:true }); return 'Mix Radio'; }

    const moods = [
      { re: /(весел|радіс|радост|happy|joy)/, mood: 'happy' },
      { re: /(спок|calm|chill|relax)/,        mood: 'calm' },
      { re: /(сум|sad|minor)/,               mood: 'sad' },
      { re: /(енерг|drive|бадьор|рок|rock)/,  mood: 'energetic' }
    ];
    const m = moods.find(m => m.re.test(text));
    if (m) { dispatch('recommend', { mood: m.mood }); return 'Підбираю під настрій'; }

    const g = text.match(/жанр\s*([a-zа-яёіїє-]+)/i);
    if (g && g[1]) { dispatch('recommend', { genre: g[1] }); return `Жанр: ${g[1]}`; }

    const like = text.match(/(?:хочу|знайд[и]|найд[и]|включи|поставь)\s+(.+)/i);
    if (like && like[1]) { dispatch('recommend', { like: like[1].trim() }); return 'Шукаю…'; }

    return 'Я здесь. Могу переключать вид, управлять треком и подбирать музыку по настроению.';
  }

  // ===== Эвристика: выводим действия из фразы ИИ =====
  function inferActionsFromBotReply(reply = '') {
    const t = reply.toLowerCase();
    const acts = [];

    if (/включаю|запускаю|play|играю/.test(t)) acts.push({ type:'player', action:'play' });
    if (/пауза|приостанавлива|ставлю на паузу|pause/.test(t)) acts.push({ type:'player', action:'pause' });
    if (/следующ/.test(t)) acts.push({ type:'player', action:'next' });
    if (/предыд/.test(t)) acts.push({ type:'player', action:'prev' });
    if (/микс|radio/.test(t)) acts.push({ type:'mixradio' });

    if (/громче|увеличу громкость|louder/.test(t)) acts.push({ type:'volume', delta:+0.1 });
    if (/тише|уменьшу громкость|quieter/.test(t)) acts.push({ type:'volume', delta:-0.1 });

    // «включу что-нибудь из рекомендованного»
    if (/рекоменд/.test(t) && /включ/.test(t)) acts.push({ type:'mixradio' });

    return acts;
  }

  // ===== Вызов AI API (если поднят сервер) =====
  async function callAI(message) {
    if (!API_BASE) return null;
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ message })
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json(); // ожидаем { reply, explain?, actions? }
  }

  async function handleUserText(text) {
    const v = String(text || '').trim();
    if (!v) return;
    log(v, 'user');

    // 1) пробуем серверный AI
    try {
      const data = await callAI(v);
      if (data && data.reply) {
        log(data.reply, 'bot');
        speak(data.reply);

        const actions = Array.isArray(data.actions) ? data.actions : [];
        // если сервер не прислал actions — пытаемся понять из текста бота
        const inferred = actions.length ? [] : inferActionsFromBotReply(data.reply);
        runActions(actions.length ? actions : inferred);

        if (data.explain) log('[' + data.explain + ']', 'note');
        return;
      }
    } catch (e) {
      // просто переходим к локальным правилам
      console.warn('AI API error', e);
    }

    // 2) локальный фоллбэк
    const reply = handleCommandLocal(v);
    log(reply, 'bot');
    speak(reply);
  }

  // ===== Mic =====
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (btnMic && SR) {
    btnMic.addEventListener('click', () => {
      try {
        const rec = new SR();
        rec.lang = (navigator.language || 'ru-RU');
        rec.interimResults = false; rec.maxAlternatives = 1;
        btnMic.classList.add('is-on');
        rec.onresult = ev => {
          const text = ev.results?.[0]?.[0]?.transcript || '';
          handleUserText(text);
        };
        rec.onerror = () => { log('Не вышло распознать голос','bot'); };
        rec.onend = () => btnMic.classList.remove('is-on');
        rec.start();
      } catch { log('Розпізнавач недоступний','bot'); }
    });
  }

  // ===== Кнопки/ввод =====
  btnOpen.addEventListener('click', () => { panel.hidden = !panel.hidden; });
  btnClose.addEventListener('click', () => { panel.hidden = true; });
  btnGear.addEventListener('click', () => {
    const s = root.querySelector('.assistant__settings');
    s.hidden = !s.hidden;
  });
  btnSend.addEventListener('click', () => { const t = inputEl.value; inputEl.value=''; handleUserText(t); });
  inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const t = inputEl.value; inputEl.value=''; handleUserText(t); } });
})();
