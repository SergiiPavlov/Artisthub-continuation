// Chat Friend + AI bridge with memory + Provider + Optional server TTS (Piper)
// ВНИМАНИЕ: здесь НЕТ импорта player-patch — мост монтируется в artists/index.js
(() => {
  const API_BASE =
    (import.meta?.env?.VITE_API_URL && import.meta.env.VITE_API_URL.replace(/\/+$/, "")) ||
    (location.hostname === "localhost" ? "http://localhost:8787" : "");

  // --- helpers ---
  function getYouTubeId(urlOrId) {
    if (!urlOrId) return "";
    if (/^[\w-]{11}$/.test(urlOrId)) return urlOrId;
    try {
      const u = new URL(urlOrId, location.href);
      if (/youtu\.be$/i.test(u.hostname)) return u.pathname.slice(1);
      const v = u.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/\/(?:embed|v|shorts)\/([^/?#]+)/i);
      if (m && m[1] && /^[\w-]{11}$/.test(m[1])) return m[1];
    } catch {}
    return "";
  }
  const isStr = (v) => typeof v === "string" && v.length > 0;

  // --- UI ---
  const root = document.createElement("div");
  root.id = "assistant-root";
  root.className = "assistant";
  root.innerHTML = `
    <button class="assistant__toggle" aria-label="Чат-ассистент">🤖</button>
    <div class="assistant__panel" hidden>
      <div class="assistant__header">
        <strong>Чат-друг</strong>
        <div class="assistant__hdr-actions">
          <span class="assistant__ai-badge">${API_BASE ? "AI" : ""}</span>

          <label class="assistant__prov-wrap" title="Режим ИИ">
            <span class="assistant__prov-label">Режим</span>
            <select id="as-provider">
              <option value="auto">Auto</option>
              <option value="free">Free</option>
              <option value="pro">Pro</option>
            </select>
          </label>

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

        <label class="assistant__row">
          <span>Серверный TTS (Piper)</span>
          <input id="as-tts-server" type="checkbox" />
          <small class="assistant__hint">Нужно настроить /api/tts на сервере. Иначе будет браузерный голос.</small>
        </label>

        <div class="assistant__row">
          <button id="as-test-voice" type="button">Проба голоса</button>
          <button id="as-clear-log" type="button">Очистить чат</button>
        </div>

        <div class="assistant__row">
          <small class="assistant__hint">
            Подсказка: в Microsoft Edge доступны более естественные голоса (SpeechSynthesis).
            На Windows можно поставить дополнительные языковые пакеты — появятся новые голоса.
          </small>
        </div>
      </div>
    </div>`;
  document.body.appendChild(root);

  // quick styles (минимальные, не трогаю общий CSS)
  const style = document.createElement("style");
  style.textContent = `
    .assistant{position:fixed;right:18px;bottom:18px;z-index:9999}
    .assistant__toggle{width:48px;height:48px;border-radius:50%;border:none;background:#0ea5e9;color:#fff;font-size:22px;box-shadow:0 8px 20px rgba(0,0,0,.35);cursor:pointer}
    .assistant__panel{position:fixed;right:18px;bottom:84px;width:min(92vw,520px);max-height:min(80vh,720px);display:flex;flex-direction:column;background:#111418;border:1px solid rgba(255,255,255,.06);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden}
    .assistant__header{display:flex;align-items:center;gap:.75rem;padding:.8rem 1rem;background:linear-gradient(180deg,#121821,#0e1318);border-bottom:1px solid rgba(255,255,255,.06)}
    .assistant__hdr-actions{margin-left:auto;display:flex;gap:.5rem;align-items:center}
    .assistant__ai-badge{font:600 12px/1.2 ui-sans-serif,system-ui,Segoe UI,Arial;color:#9ae6b4;background:#203021;border:1px solid #2b4a2d;padding:.25rem .4rem;border-radius:6px}
    .assistant__prov-wrap{display:flex;align-items:center;gap:.35rem;color:#cbd5e1}
    .assistant__prov-wrap select{background:#0b0f14;border:1px solid #263142;color:#e8f1ff;border-radius:8px;padding:.2rem .35rem}
    .assistant__close,.assistant__gear{background:none;border:1px solid rgba(255,255,255,.14);color:#cbd5e1;width:32px;height:32px;border-radius:8px;cursor:pointer}
    .assistant__log{padding:10px 12px;overflow:auto;display:flex;flex-direction:column;gap:8px;height:360px}
    .assistant__msg{padding:.6rem .9rem;border-radius:12px;max-width:85%;white-space:pre-wrap}
    .assistant__msg--user{margin-left:auto;background:#243244;color:#e7f0ff}
    .assistant__msg--bot{background:#171b21;color:#dfe6ef}
    .assistant__msg--note{align-self:center;opacity:.7;font-size:.9em}
    .assistant__controls{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(255,255,255,.08);background:#0f1216}
    .assistant__controls input{flex:1;min-width:0;padding:.65rem .8rem;border-radius:10px;background:#0b0f14;border:1px solid #263142;color:#e8f1ff}
    .assistant__controls button{border-radius:10px;background:#0ea5e9;color:#fff;border:none;padding:.65rem .9rem;cursor:pointer}
    .assistant__mic{background:#1f2836 !important;border:1px solid #2a3a52 !important;color:#cbd5e1 !important}
    .assistant__mic.is-on{outline:2px solid #0ea5e9}
    .assistant__settings{padding:.75rem;border-top:1px solid rgba(255,255,255,.08);background:#0f1216}
    .assistant__row{display:flex;align-items:center;gap:.5rem;margin:.45rem 0}
    .assistant__row > span{min-width:150px;opacity:.85}
    .assistant__hint{opacity:.7}
    #as-voice{flex:1;min-width:0;padding:.45rem .55rem;border-radius:8px;background:#0b0f14;border:1px solid #263142;color:#e8f1ff}
  `;
  document.head.appendChild(style);

  const panel    = root.querySelector(".assistant__panel");
  const btnOpen  = root.querySelector(".assistant__toggle");
  const btnClose = root.querySelector(".assistant__close");
  const btnGear  = root.querySelector(".assistant__gear");
  const logEl    = root.querySelector("#assistantLog");
  const inputEl  = root.querySelector(".assistant__input");
  const btnSend  = root.querySelector(".assistant__send");
  const btnMic   = root.querySelector(".assistant__mic");
  const selVoice = root.querySelector("#as-voice");
  const selProv  = root.querySelector("#as-provider");
  const chkTTS   = root.querySelector("#as-tts-server");
  const btnTest  = root.querySelector("#as-test-voice");
  const btnClr   = root.querySelector("#as-clear-log");

  // --- memory (короткая) ---
  const chat = {
    history: [],            // [{role:'user'|'assistant', content:string}]
    lastIds: [],            // последние YT id/urls, встреченные в ответах
    lastGenre: null,
    lastMood: null
  };

  // --- Provider pref ---
  const provPref = localStorage.getItem('assistant.provider') || 'auto';
  selProv.value = provPref;
  selProv.addEventListener('change', () => {
    localStorage.setItem('assistant.provider', selProv.value);
    log(`Режим: ${selProv.value === 'pro' ? 'Pro (OpenAI)' : selProv.value === 'free' ? 'Free (локально)' : 'Auto'}`, 'note');
  });
  function providerToSend() {
    const p = localStorage.getItem('assistant.provider') || 'auto';
    if (p === 'pro')  return 'openai';
    if (p === 'free') return 'lmstudio';
    return undefined; // auto
  }

  // --- Server TTS pref ---
  chkTTS.checked = localStorage.getItem('assistant.ttsServer') === '1';
  chkTTS.addEventListener('change', () => {
    localStorage.setItem('assistant.ttsServer', chkTTS.checked ? '1' : '0');
    log(chkTTS.checked ? 'Серверный TTS включён' : 'Серверный TTS выключен', 'note');
  });

  // --- TTS ---
  const tts = { voiceName: localStorage.getItem("assistant.voice") || "" };
  function populateVoices() {
    try {
      const V = window.speechSynthesis?.getVoices?.() || [];
      selVoice.innerHTML =
        `<option value="">Системный / лучший доступный</option>` +
        V.map(v => `<option value="${v.name}">${v.name} — ${v.lang}</option>`).join("");
      if (tts.voiceName) selVoice.value = tts.voiceName;
    } catch {}
  }
  if ("speechSynthesis" in window) {
    try { window.speechSynthesis.onvoiceschanged = populateVoices; } catch {}
    setTimeout(populateVoices, 300);
  }
  selVoice?.addEventListener("change", () => {
    tts.voiceName = selVoice.value || "";
    localStorage.setItem("assistant.voice", tts.voiceName);
    speak("Голос выбран");
  });

  async function speakServer(text) {
    if (!API_BASE) throw new Error('no API');
    const r = await fetch(`${API_BASE}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!r.ok) throw new Error('tts unavailable');
    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play().catch(() => {});
  }

  function speakBrowser(text) {
    try {
      if (!("speechSynthesis" in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      if (tts.voiceName) {
        const v = window.speechSynthesis.getVoices().find(v => v.name === tts.voiceName);
        if (v) u.voice = v;
      } else {
        const lang = (navigator.language || "en-US").toLowerCase();
        u.lang = lang.startsWith("uk") ? "uk-UA" : lang.startsWith("ru") ? "ru-RU" : "en-US";
      }
      u.rate = 1; u.pitch = 1;
      window.speechSynthesis.speak(u);
    } catch {}
  }

  function speak(text) {
    const useServer = chkTTS.checked && !!API_BASE;
    if (useServer) speakServer(text).catch(() => speakBrowser(text));
    else speakBrowser(text);
  }

  btnTest?.addEventListener("click", () => speak("Привет! Я твой голосовой друг."));
  btnClr?.addEventListener("click", () => { logEl.innerHTML = ""; chat.history = []; });

  // log + история
  function log(text, who = "bot") {
    const d = document.createElement("div");
    d.className = `assistant__msg assistant__msg--${who}`;
    d.textContent = text;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;

    chat.history.push({ role: who === 'user' ? 'user' : 'assistant', content: text });
    chat.history = chat.history.slice(-10);
  }

  // Диспатчим и на window, и на document — для совместимости
  function dispatch(name, detail = {}) {
    const ev = new CustomEvent(`assistant:${name}`, { detail, bubbles:true, composed:true });
    window.dispatchEvent(ev);
    document.dispatchEvent(new CustomEvent(`assistant:${name}`, { detail, bubbles:true, composed:true }));
  }

  function runActions(actions = []) {
    for (const a of actions) {
      if (a?.type === "player" && a.action) {
        dispatch("player-" + a.action);
      } else if (a?.type === "view" && a.mode) {
        dispatch("view", { mode: a.mode });
      } else if (a?.type === "recommend") {
        dispatch("recommend", a);
        if (a.genre) chat.lastGenre = a.genre;
        if (a.mood)  chat.lastMood  = a.mood;
      } else if (a?.type === "volume") {
        dispatch("volume", a);
      } else if (a?.type === "mixradio") {
        dispatch("mixradio", { start: true });
      } else if (a?.type === "play" && (a.id || a.query)) {
        dispatch("play", { id: a.id, query: a.query });
        const id = getYouTubeId(a.id || a.query);
        if (id) chat.lastIds = [id];
      }
    }
  }

  // выцепим ID из текста ответа и сохраним как кандидаты
  function harvestIdsFromReply(txt = "") {
    const ids = new Set();
    const urlRe = /\bhttps?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})\b/g;
    let m;
    while ((m = urlRe.exec(txt))) ids.add(m[1]);
    const idRe = /\b([A-Za-z0-9_-]{11})\b/g;
    while ((m = idRe.exec(txt))) ids.add(m[1]);
    return Array.from(ids);
  }

  // локальные команды (fallback) — ДЕЙСТВИТЕЛЬНЫЕ!
  function handleCommandLocal(t) {
    const text = (t || "").toLowerCase();
    const wantsPlay = /включ|поставь|play|запусти/.test(text);

    if (/list|список|лист ?вью/.test(text)) { dispatch("view", { mode: "list" }); return "Включаю список"; }
    if (/grid|сетка|карточк/.test(text))   { dispatch("view", { mode: "grid" }); return "Включаю сетку"; }
    if (/next|след/.test(text))            { dispatch("player-next"); return "Следующий трек"; }
    if (/prev|пред/.test(text))            { dispatch("player-prev"); return "Предыдущий трек"; }
    if (/пауза|стоп|pause|останов/.test(text)) { dispatch("player-pause"); dispatch("player-stop"); return "Пауза"; }

    // Ключевая правка: «включи» без уточнений → Mix Radio, если нет последних ID
    if (/play|плей|включи/.test(text)) {
      if (chat.lastIds.length) {
        dispatch("play", { id: chat.lastIds[0] });
      } else {
        dispatch("mixradio", { start: true });
      }
      return "Играю";
    }

    if (/тише|quieter|volume down|поменьше/.test(text)) { dispatch("volume", { delta: -0.1 }); return "Тише"; }
    if (/громче|louder|volume up|погромче/.test(text))  { dispatch("volume", { delta: +0.1 }); return "Громче"; }
    if (/(mix ?radio|микс|радио|random)/.test(text))    { dispatch("mixradio", { start: true }); return "Mix Radio"; }

    // Явные запросы на трек/артиста
    if (/^(?:включи|поставь|запусти|найди|знайди)\s+.+/i.test(text)) {
      const like = text.replace(/^(?:включи|поставь|запусти|найди|знайди)\s+/i, "").trim();
      if (like) { dispatch("recommend", { like, autoplay: true }); return "Шукаю та запускаю…"; }
    }

    // Настроение
    const moods = [
      { re: /(весел|радіс|радост|happy|joy)/, mood: "happy" },
      { re: /(спок|calm|chill|relax)/,        mood: "calm" },
      { re: /(сум|sad|minor)/,                mood: "sad" },
      { re: /(енерг|drive|бадьор|рок|rock)/,  mood: "energetic" }
    ];
    const m = moods.find(m => m.re.test(text));
    if (m) { dispatch("recommend", { mood: m.mood, autoplay: wantsPlay }); chat.lastMood = m.mood; return wantsPlay ? "Підбираю та вмикаю…" : "Підбираю під настрій"; }

    // Жанр
    const g = text.match(/жанр\s*([a-zа-яёіїє-]+)/i);
    if (g && g[1]) { dispatch("recommend", { genre: g[1], autoplay: wantsPlay }); chat.lastGenre = g[1]; return wantsPlay ? `Жанр ${g[1]}, запускаю…` : `Жанр: ${g[1]}`; }

    // «включи из списка»
    if (/из (этого|того) списка|из предложенного|любой из списка/.test(text)) {
      if (chat.lastIds.length) {
        dispatch("play", { id: chat.lastIds[0] });
        return "Запускаю из последнего списка";
      }
      dispatch("mixradio", { start: true });
      return "Включаю из своих рекомендаций";
    }

    return "Я здесь. Могу переключать вид, управлять треком и подбирать музыку по настроению.";
  }

  // API
  async function callAI(message) {
    if (!API_BASE) return null;
    const r = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        history: chat.history,
        provider: providerToSend()
      })
    });
    if (!r.ok) throw new Error(`API ${r.status}`);
    return r.json();
  }

  async function handleUserText(text) {
    const v = String(text || "").trim();
    if (!v) return;

    log(v, "user");

    // 1) Пытаемся через сервер ИИ
    try {
      const data = await callAI(v);
      if (data && isStr(data.reply)) {
        const harvested = harvestIdsFromReply(data.reply);
        if (harvested.length) chat.lastIds = harvested;

        log(data.reply, "bot");
        speak(data.reply);

        const actions = Array.isArray(data.actions) ? data.actions : [];
        if (actions.length) {
          // нормальный путь: сервер дал экшены
          const aPlay = actions.find(a => a.type === 'play' && (a.id || a.query));
          if (aPlay) {
            const id = getYouTubeId(aPlay.id || aPlay.query);
            if (id) chat.lastIds = [id];
          }
          runActions(actions);
        } else {
          // ВАЖНО: нет actions — ДОЖИМАЕМ ЛОКАЛЬНО (не логируем второй «бот-ответ», только заметку)
          const localReply = handleCommandLocal(v);
          log("[" + localReply + "]", "note");
        }

        if (isStr(data.explain)) log("[" + data.explain + "]", "note");
        return;
      }
    } catch (e) {
      console.warn("AI API error", e);
    }

    // 2) Фоллбэк (сервер молчит/ошибка/пусто)
    const reply = handleCommandLocal(v);
    log(reply, "bot");
    speak(reply);
  }

  // Mic
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (btnMic && SR) {
    btnMic.addEventListener("click", () => {
      try {
        const rec = new SR();
        rec.lang = (navigator.language || "ru-RU");
        rec.interimResults = false; rec.maxAlternatives = 1;
        btnMic.classList.add("is-on");
        rec.onresult = ev => {
          const t = ev.results?.[0]?.[0]?.transcript || "";
          handleUserText(t);
        };
        rec.onerror = () => { log("Не вышло распознать голос", "bot"); };
        rec.onend = () => btnMic.classList.remove("is-on");
        rec.start();
      } catch {
        log("Розпізнавач недоступний", "bot");
      }
    });
  }

  // wiring
  btnOpen.addEventListener("click", () => { panel.hidden = !panel.hidden; });
  btnClose.addEventListener("click", () => { panel.hidden = true; });
  btnGear.addEventListener("click", () => {
    const s = root.querySelector(".assistant__settings");
    if (s) s.hidden = !s.hidden;
  });
  btnSend.addEventListener("click", () => {
    const t = inputEl.value; inputEl.value = ""; handleUserText(t);
  });
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { const t = inputEl.value; inputEl.value = ""; handleUserText(t); }
  });
})();
