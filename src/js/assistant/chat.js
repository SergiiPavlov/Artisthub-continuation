/* Chat Friend + AI bridge with memory */
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
    </div>`;
  document.body.appendChild(root);

  // quick styles
  const style = document.createElement("style");
  style.textContent = `
    .assistant{position:fixed;right:18px;bottom:18px;z-index:9999}
    .assistant__toggle{width:48px;height:48px;border-radius:50%;border:none;background:#0ea5e9;color:#fff;font-size:22px;box-shadow:0 8px 20px rgba(0,0,0,.35);cursor:pointer}
    .assistant__panel{position:fixed;right:18px;bottom:84px;width:min(92vw,520px);max-height:min(80vh,720px);display:flex;flex-direction:column;background:#111418;border:1px solid rgba(255,255,255,.06);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden}
    .assistant__header{display:flex;align-items:center;gap:.75rem;padding:.8rem 1rem;background:linear-gradient(180deg,#121821,#0e1318);border-bottom:1px solid rgba(255,255,255,.06)}
    .assistant__hdr-actions{margin-left:auto;display:flex;gap:.5rem;align-items:center}
    .assistant__ai-badge{font:600 12px/1.2 ui-sans-serif,system-ui,Segoe UI,Arial;color:#9ae6b4;background:#203021;border:1px solid #2b4a2d;padding:.25rem .4rem;border-radius:6px}
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
    #as-voice{flex:1;min-width:0;padding:.45rem .55rem;border-radius:8px;background:#0b0f14;border:1px solid #263142;color:#e8f1ff}
  `;
  document.head.appendChild(style);

  const panel = root.querySelector(".assistant__panel");
  const btnOpen = root.querySelector(".assistant__toggle");
  const btnClose = root.querySelector(".assistant__close");
  const btnGear = root.querySelector(".assistant__gear");
  const logEl = root.querySelector("#assistantLog");
  const inputEl = root.querySelector(".assistant__input");
  const btnSend = root.querySelector(".assistant__send");
  const btnMic = root.querySelector(".assistant__mic");
  const selVoice = root.querySelector("#as-voice");
  const btnTest = root.querySelector("#as-test-voice");
  const btnClr = root.querySelector("#as-clear-log");

  // --- memory (короткая) ---
  const chat = {
    history: [],            // [{role:'user'|'assistant', content:string}]
    lastIds: [],            // последние найденные YT id/urls из ответа ассистента
    lastGenre: null,
    lastMood: null
  };

  // TTS
  const tts = { voiceName: localStorage.getItem("assistant.voice") || "" };
  function populateVoices() {
    try {
      const V = window.speechSynthesis?.getVoices?.() || [];
      selVoice.innerHTML =
        `<option value="">Системный</option>` +
        V.map(v => `<option value="${v.name}">${v.name} — ${v.lang}</option>`).join("");
      if (tts.voiceName) selVoice.value = tts.voiceName;
    } catch {}
  }
  if ("speechSynthesis" in window) {
    try { window.speechSynthesis.onvoiceschanged = populateVoices; } catch {}
    setTimeout(populateVoices, 300);
  }
  function speak(text) {
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
  selVoice?.addEventListener("change", () => {
    tts.voiceName = selVoice.value || "";
    localStorage.setItem("assistant.voice", tts.voiceName);
    speak("Голос выбран");
  });
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
    chat.history = chat.history.slice(-10); // ограничим память на клиенте
  }

  function dispatch(name, detail = {}) {
    document.dispatchEvent(new CustomEvent(`assistant:${name}`, { detail }));
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

  // евристика: выцепим ID из текста ответа и сохраним как кандидаты
  function harvestIdsFromReply(txt = "") {
    const ids = new Set();
    const urlRe = /\bhttps?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})\b/g;
    let m;
    while ((m = urlRe.exec(txt))) ids.add(m[1]);
    // просто на всякий — пробуем 11-символьные токены
    const idRe = /\b([A-Za-z0-9_-]{11})\b/g;
    while ((m = idRe.exec(txt))) ids.add(m[1]);
    return Array.from(ids);
  }

  // локальные команды (fallback)
  function handleCommandLocal(t) {
    const text = (t || "").toLowerCase();
    const wantsPlay = /включ|поставь|play|запуств|запусти/.test(text);

    if (/list|список|лист ?вью/.test(text)) { dispatch("view", { mode: "list" }); return "Включаю список"; }
    if (/grid|сетка|карточк/.test(text))   { dispatch("view", { mode: "grid" }); return "Включаю сетку"; }
    if (/next|след/.test(text))            { dispatch("player-next"); return "Следующий трек"; }
    if (/prev|пред/.test(text))            { dispatch("player-prev"); return "Предыдущий трек"; }
    if (/пауза|стоп|pause|останов/.test(text)) { dispatch("player-pause"); dispatch("player-stop"); return "Пауза"; }
    if (/play|плей|включи/.test(text))     { dispatch("player-play"); return "Играю"; }
    if (/тише|quieter|volume down|поменьше/.test(text)) { dispatch("volume", { delta: -0.1 }); return "Тише"; }
    if (/громче|louder|volume up|погромче/.test(text))  { dispatch("volume", { delta: +0.1 }); return "Громче"; }
    if (/(mix ?radio|микс|радио|random)/.test(text))    { dispatch("mixradio", { start: true }); return "Mix Radio"; }

    // «включи из этого списка»
    if (/из (этого|того) списка|из предложенного|любой из списка/.test(text)) {
      if (chat.lastIds.length) {
        dispatch("play", { id: chat.lastIds[0] });
        return "Запускаю из последнего списка";
      }
      // если совсем нечего — запустим что-то приятное
      dispatch("mixradio", { start: true });
      return "Включаю из своих рекомендаций";
    }

    const moods = [
      { re: /(весел|радіс|радост|happy|joy)/, mood: "happy" },
      { re: /(спок|calm|chill|relax)/,        mood: "calm" },
      { re: /(сум|sad|minor)/,                mood: "sad" },
      { re: /(енерг|drive|бадьор|рок|rock)/,  mood: "energetic" }
    ];
    const m = moods.find(m => m.re.test(text));
    if (m) { dispatch("recommend", { mood: m.mood, autoplay: wantsPlay }); chat.lastMood = m.mood; return wantsPlay ? "Підбираю та вмикаю…" : "Підбираю під настрій"; }

    const g = text.match(/жанр\s*([a-zа-яёіїє-]+)/i);
    if (g && g[1]) { dispatch("recommend", { genre: g[1], autoplay: wantsPlay }); chat.lastGenre = g[1]; return wantsPlay ? `Жанр ${g[1]}, запускаю…` : `Жанр: ${g[1]}`; }

    const like = text.match(/(?:включи|поставь|запусти|найди|знайди)\s+(.+)/i);
    if (like && like[1]) { dispatch("recommend", { like: like[1].trim(), autoplay: true }); return "Шукаю та запускаю…"; }

    if (/рекоменд/.test(text) && /включ/.test(text)) { dispatch("mixradio", { start: true }); dispatch("player-play"); return "Включаю из рекомендаций…"; }

    return "Я здесь. Могу переключать вид, управлять треком и подбирать музыку по настроению.";
  }

  // API
  async function callAI(message) {
    if (!API_BASE) return null;
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history: chat.history })
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
  }

  async function handleUserText(text) {
    const v = String(text || "").trim();
    if (!v) return;

    log(v, "user");

    try {
      const data = await callAI(v);
      if (data && data.reply) {
        // сохраняем кандидатов из текста
        const harvested = harvestIdsFromReply(data.reply);
        if (harvested.length) chat.lastIds = harvested;

        log(data.reply, "bot");
        speak(data.reply);

        const actions = Array.isArray(data.actions) ? data.actions : [];
        if (actions.length) {
          // если в actions есть play с id — перепишем lastIds
          const aPlay = actions.find(a => a.type === 'play' && (a.id || a.query));
          if (aPlay) {
            const id = getYouTubeId(aPlay.id || aPlay.query);
            if (id) chat.lastIds = [id];
          }
        }
        // выполнить
        runActions(actions.length ? actions : []);

        if (data.explain) log("[" + data.explain + "]", "note");
        return;
      }
    } catch (e) {
      console.warn("AI API error", e);
    }

    // fallback
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
