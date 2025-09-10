// Chat Friend + AI bridge with memory + Provider + Optional server TTS (Piper)
// VERSION: chat.js v2.3.1 (server TTS buffered) — 2025-09-10
(() => {
  if (window.__ASSISTANT_UI_INIT__) return;
  window.__ASSISTANT_UI_INIT__ = true;

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
      if (m && m[1] && /^[A-Za-z0-9_-]{11}$/.test(m[1])) return m[1];
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

  const style = document.createElement("style");
  style.textContent = `
    .assistant{position:fixed;right:18px;bottom:18px;z-index:9999}
    .assistant__toggle{width:48px;height:48px;border-radius:50%;border:none;background:#0ea5e9;color:#fff;font-size:22px;box-shadow:0 8px 20px rgba(0,0,0,.35);cursor:pointer}
    .assistant__panel{position:fixed;right:18px;bottom:84px;width:min(92vw,520px);max-height:min(80vh,720px);display:flex;flex-direction:column;background:#111418;border:1px solid rgba(255,255,255,.06);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden}
    .assistant__header{display:flex;align-items:center;gap:.75rem;padding:.8rem 1rem;background:linear-gradient(180deg,#121821,#0e1318);border-bottom:1px solid rgba(255,255,255,.06)}
    .assistant__hdr-actions{margin-left:auto;display:flex;gap:.5rem;align-items:center}
    .assistant__ai-badge{font:600 12px; color:#9ae6b4;background:#203021;border:1px solid #2b4a2d;padding:.25rem .4rem;border-radius:6px}
    .assistant__prov-wrap{display:flex;align-items:center;gap:.35rem;color:#cbd5e1}
    .assistant__prov-wrap select{background:#0b0f14;border:1px solid #263142;color:#e8f1ff;border-radius:8px;padding:.2rem .35rem}
    .assistant__close,.assistant__gear{background:none;border:1px solid rgba(255,255,255,.14);color:#cbd5e1;width:32px;height:32px;border-radius:8px;cursor:pointer}
    .assistant__log{padding:10px 12px;overflow:auto;display:flex;flex-direction:column;gap:8px;flex:1;min-height:160px}
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

  // refs
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
  const chat = { history: [], lastIds: [], lastGenre: null, lastMood: null, nowPlaying: null };

  // Now Playing от плеера
  window.addEventListener("AM.player.track", (e) => {
    const id = e?.detail?.id || "";
    const title = String(e?.detail?.title || "");
    let artist = "", song = "";
    const m = title.split(" - ");
    if (m.length >= 2) { artist = m[0].trim(); song = m.slice(1).join(" - ").trim(); }
    chat.nowPlaying = { id, title, artist, song };
  });

  // --- Provider pref ---
  const provPref = localStorage.getItem('assistant.provider') || 'auto';
  selProv.value = provPref;
  selProv.addEventListener('change', () => {
    localStorage.setItem('assistant.provider', selProv.value);
    addMsg("note", `Режим: ${selProv.value === 'pro' ? 'Pro (OpenAI)' : selProv.value === 'free' ? 'Free (локально)' : 'Auto'}`);
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
    addMsg("note", chkTTS.checked ? 'Серверный TTS включён' : 'Серверный TTS выключен');
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

  // ─── НОВОЕ: лёгкий детект языка для Piper ───────────────────────────
  function detectLang(text = "") {
    const s = String(text);
    if (/[ґєіїҐЄІЇ]/.test(s)) return "uk";
    if (/[\u0400-\u04FF]/.test(s)) return "ru";
    return "en";
  }

  // ─── НОВОЕ: безопасный серверный TTS (буферная отдача) ───────────────
  async function speakServer(text, lang) {
    if (!API_BASE) throw new Error('no API');
    const r = await fetch(`${API_BASE}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, lang })
    });
    if (!r.ok) throw new Error(`tts unavailable ${r.status}`);
    // ЖДЁМ ПОЛНЫЙ БУФЕР, а не стримим
    const buf = await r.arrayBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    const audio = new Audio(url);
    audio.preload = 'auto';
    try { await audio.play(); } catch (e) { console.warn('[tts] play() blocked:', e); }
    audio.onended = () => URL.revokeObjectURL(url);
    audio.onerror = () => console.error('[tts] audio error:', audio.error);
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
    if (useServer) speakServer(text, detectLang(text)).catch(() => speakBrowser(text));
    else speakBrowser(text);
  }

  btnTest?.addEventListener("click", () => speak("Привет! Я твой голосовой друг."));
  btnClr?.addEventListener("click", () => { logEl.innerHTML = ""; chat.history = []; });

  // === Sleep timer (helpers) ===
  let sleepTimerId = null;
  function clearSleepTimer() {
    if (sleepTimerId) { clearTimeout(sleepTimerId); sleepTimerId = null; }
  }
  function scheduleSleep(ms) {
    clearSleepTimer();
    sleepTimerId = setTimeout(() => {
      dispatch("player-stop");
      addMsg("note", "⏰ Таймер: стоп.");
    }, ms);
  }
  function parseSleepDuration(s) {
    const r = /(\d{1,3})\s*(час(?:ов|а)?|h|hour|hours|мин(?:ут[ы|у])?|m|min|minutes|сек(?:унд[уы])?|s|sec|seconds)/i;
    const m = String(s||'').toLowerCase().match(r);
    if (!m) return null;
    const n = Number(m[1]||0);
    let unit = m[2]||'';
    if (/^час|h|hour/.test(unit)) return n*60*60*1000;
    if (/^мин|m|min/.test(unit))  return n*60*1000;
    return n*1000;
  }
  function parseSleepCommand(t) {
    // "выключись через 2 минуты", "останови через 30 сек", "stop in 10 min"
    const s = String(t || "").toLowerCase();
    const r = /(выключи(?:сь)?|останови|stop)\s*(?:через|in)?\s*(\d{1,3})\s*(сек(?:унд[уы])?|с|sec|seconds|мин(?:ут[ы|у])?|m|min|minutes|час(?:ов|а)?|h|hour|hours)/i;
    const m = s.match(r);
    if (!m) return null;
    const n = Number(m[2] || 0);
    let unit = m[3] || "";
    let ms = 0;
    if (/^час|h|hour/.test(unit)) ms = n * 60 * 60 * 1000;
    else if (/^мин|m|min/.test(unit)) ms = n * 60 * 1000;
    else ms = n * 1000;
    return ms > 0 ? ms : null;
  }
  // Доп. парсер для «подавления мгновенного stop» от ИИ
  function parseDelaySpec(text = "") {
    const s = String(text).toLowerCase();
    if (/(после\s+(этой|текущей)\s+(песни|композиции|трека)|after\s+(this|current)\s+(song|track))/.test(s)) {
      return { afterCurrent: true };
    }
    // «через 15 сек/мин/час» без обязательного слова «выключись»
    const m = s.match(/через\s+(\d{1,3})\s*(сек(?:унд[уы])?|с|sec|seconds|мин(?:ут[ы|у])?|m|min|minutes|час(?:ов|а)?|h|hour|hours)\b/);
    if (m) {
      const n = Number(m[1] || 0);
      const unit = m[2] || "";
      let ms = 0;
      if (/^час|h|hour/.test(unit)) ms = n * 3600000;
      else if (/^мин|m|min/.test(unit)) ms = n * 60000;
      else ms = n * 1000;
      if (ms > 0) return { ms };
    }
    return null;
  }

  // «после текущей песни выключись»
  let sleepAfterTrack = false;
  window.addEventListener("AM.player.ended", () => {
    if (sleepAfterTrack) {
      sleepAfterTrack = false;
      clearSleepTimer();
      dispatch("player-stop");
      addMsg("note", "⏰ Остановлено после текущего трека.");
    }
  });

  // log/history
  function addMsg(role, content) {
    const cls = role === "user" ? "assistant__msg--user"
      : role === "bot" ? "assistant__msg--bot"
      : "assistant__msg--note";
    const d = document.createElement("div");
    d.className = `assistant__msg ${cls}`;
    d.textContent = String(content || "");
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;

    if (role !== "note") {
      chat.history.push({ role: role === "user" ? "user" : "assistant", content: String(content || "") });
      chat.history = chat.history.slice(-10);
    }
  }

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
      } else if (a?.type === "ui" && a.action) {
        if (a.action === "minimize") dispatch("minimize");
        else if (a.action === "expand") dispatch("expand");
      } else if (a?.type === "play" && (a.id || a.query)) {
        dispatch("play", { id: a.id, query: a.query });
        const id = getYouTubeId(a.id || a.query);
        if (id) chat.lastIds = [id];
      }
    }
  }

  function harvestIdsFromReply(txt = "") {
    const ids = new Set();
    const urlRe = /\bhttps?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})\b/g;
    let m;
    while ((m = urlRe.exec(txt))) ids.add(m[1]);
    const idRe = /\b([A-Za-z0-9_-]{11})\b/g;
    while ((m = idRe.exec(txt))) ids.add(m[1]);
    return Array.from(ids);
  }

  // Расширенные локальные намерения ДО похода на сервер
  function tryAdvancedLocalIntents(traw) {
    const text = String(traw||'').toLowerCase();

    // 1) Таймер выключения
    const msSleep = parseSleepCommand(text);
    if (msSleep) {
      addMsg("bot", `Ок, выключу через ${Math.round(msSleep/1000)} сек.`);
      speak(`Выключу через ${Math.round(msSleep/1000)} секунд`);
      scheduleSleep(msSleep);
      return true;
    }

    // 2) Выключись после текущей песни
    if (/(после (этой|текущей) (песни|композиции|трек[аи])|after this (song|track))/i.test(text)) {
      sleepAfterTrack = true;
      addMsg("bot", "Ок, выключу после текущего трека.");
      speak("Выключу после текущего трека");
      clearSleepTimer();
      try { window.__AM_SLEEP_AFTER__ = true; } catch {}
      return true;
    }

    // 3) «хитов этого артиста 2 часа/30 минут»
    const reThisArtist = /(хит(?:ов|ы)|лучшие|best of|hits).*(этого артиста).*(\d{1,2}.*(час|мин))/i;
    const reNamed = /(хит(?:ов|ы)|лучшие|best of|hits)\s+([a-zа-яёіїє .'\-]+?)\s+(?:на|в течение|на протяжении)?\s*(\d{1,2}\s*(?:час|часа|часов|мин|минут|minutes?|hours?))/i;

    let artist = "";
    let durStr = "";

    let m = text.match(reThisArtist);
    if (m && chat.nowPlaying?.artist) {
      artist = chat.nowPlaying.artist;
      durStr = m[3] || "";
    } else {
      m = text.match(reNamed);
      if (m) {
        artist = (m[2] || "").trim();
        durStr = m[3] || "";
      }
    }

    if (artist && durStr) {
      const ms = parseSleepDuration(durStr);
      if (ms) {
        const q = `${artist} greatest hits playlist`;
        addMsg("bot", `Ок, хиты ${artist} — поехали. Выключу через ${Math.round(ms/60000)} мин.`);
        speak(`Включаю хиты ${artist}. Выключу через ${Math.round(ms/60000)} минут`);
        dispatch("play", { query: q });
        scheduleSleep(ms);
        return true;
      }
    }

    return false;
  }

  // API
  async function callAI(message) {
    if (!API_BASE) return null;
    const r = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history: chat.history, provider: providerToSend() })
    });
    if (!r.ok) throw new Error(`API ${r.status}`);
    return r.json();
  }

  async function handleUserText(text) {
    const v = String(text || "").trim();
    if (!v) return;

    addMsg("user", v);

    // Расширенные локальные намерения (таймеры/хиты) — до сервера
    if (tryAdvancedLocalIntents(v)) return;

    // Подсказка: если пользователь сказал «через ...» или «после текущей песни»,
    // а ИИ вернет мгновенный stop — мы его подавим и поставим локальный таймер.
    const delaySpec = parseDelaySpec(v);
    const suppressImmediateStop = !!(delaySpec && (delaySpec.ms || delaySpec.afterCurrent));

    // 1) Пытаемся через сервер ИИ
    try {
      const data = await callAI(v);
      if (data && isStr(data.reply)) {
        const harvested = harvestIdsFromReply(data.reply);
        if (harvested.length) chat.lastIds = harvested;

        addMsg("bot", data.reply);
        speak(data.reply);

        let actions = Array.isArray(data.actions) ? data.actions : [];
        if (actions.length) {
          // подавим немедленный stop, если просили задержку
          if (suppressImmediateStop) {
            actions = actions.filter(a => !(a?.type === 'player' && a.action === 'stop'));
          }
          const aPlay = actions.find(a => a.type === 'play' && (a.id || a.query));
          if (aPlay) {
            const id = getYouTubeId(aPlay.id || aPlay.query);
            if (id) chat.lastIds = [id];
          }
          runActions(actions);

          // после выполнения — если была задержка, ставим таймер/флаг
          if (delaySpec?.ms) {
            addMsg("note", `⏰ Выключусь через ~${Math.round(delaySpec.ms/1000)} сек.`);
            scheduleSleep(delaySpec.ms);
          } else if (delaySpec?.afterCurrent) {
            sleepAfterTrack = true;
            clearSleepTimer();
            addMsg("note", "⏰ Выключусь после текущего трека.");
            try { window.__AM_SLEEP_AFTER__ = true; } catch {}
          }
        } else {
          const localReply = handleCommandLocal(v);
          addMsg("note", "[" + localReply + "]");
          if (delaySpec?.ms) scheduleSleep(delaySpec.ms);
          else if (delaySpec?.afterCurrent) {
            sleepAfterTrack = true;
            clearSleepTimer();
            addMsg("note", "⏰ Выключусь после текущего трека.");
            try { window.__AM_SLEEP_AFTER__ = true; } catch {}
          }
        }

        if (isStr(data.explain)) addMsg("note", "[" + data.explain + "]");
        return;
      }
    } catch (e) {
      console.warn("AI API error", e);
    }

    // 2) Фоллбэк
    const reply = handleCommandLocal(v);
    addMsg("bot", reply);
    speak(reply);
  }

  // Простой локальный фоллбэк (управление/жанры/муд)
  function handleCommandLocal(t) {
    const text = (t || "").toLowerCase();
    const wantsPlay = /включ|поставь|play|запусти|вруби|сыграй/.test(text);

    if (/list|список|лист ?вью/.test(text)) { dispatch("view", { mode: "list" }); return "Включаю список"; }
    if (/grid|сетка|карточк/.test(text))   { dispatch("view", { mode: "grid" }); return "Включаю сетку"; }
    if (/next|след/.test(text))            { dispatch("player-next"); return "Следующий трек"; }
    if (/prev|пред/.test(text))            { dispatch("player-prev"); return "Предыдущий трек"; }
    if (/пауза|стоп|pause|останов/.test(text)) { dispatch("player-pause"); dispatch("player-stop"); return "Пауза"; }

    // Отмена таймера
    if (/(отмени|сбрось|cancel).*(таймер|timer)/.test(text)) { clearSleepTimer(); return "Таймер отменён"; }

    // «другую песню / ещё»
    if (/(друг(ую|ой)|ещё|еще|another)/.test(text)) { dispatch("player-next"); return "Следующий трек"; }

    // «включи»
    if (/play|плей|включи|вруби|сыграй/.test(text)) {
      if (chat.lastIds.length) dispatch("play", { id: chat.lastIds[0] }); else dispatch("mixradio", { start: true });
      return "Играю";
    }

    if (/тише|quieter|volume down|поменьше/.test(text)) { dispatch("volume", { delta: -0.1 }); return "Тише"; }
    if (/громче|louder|volume up|погромче/.test(text))  { dispatch("volume", { delta: +0.1 }); return "Громче"; }
    if (/(mix ?radio|микс|радио|random)/.test(text))    { dispatch("mixradio", { start: true }); return "Mix Radio"; }

    if (/^(?:включи|поставь|запусти|найди|знайди)\s+.+/i.test(text)) {
      const like = text.replace(/^(?:включи|поставь|запусти|найди|знайди)\s+/i, "").trim();
      if (like) { dispatch("recommend", { like, autoplay: true }); return "Шукаю та вмикаю…"; }
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

    if (/из (этого|того) списка|из предложенного|любой из списка/.test(text)) {
      if (chat.lastIds.length) { dispatch("play", { id: chat.lastIds[0] }); return "Запускаю из последнего списка"; }
      dispatch("mixradio", { start: true }); return "Включаю из своих рекомендаций";
    }

    return "Я здесь. Могу переключать вид, управлять треком и подбирать музыку по настроению.";
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
        rec.onerror = () => { addMsg("bot","Не вышло распознать голос"); };
        rec.onend = () => btnMic.classList.remove("is-on");
        rec.start();
      } catch {
        addMsg("bot","Розпізнавач недоступний");
      }
    });
  }

  // wiring
  root.querySelector(".assistant__toggle").addEventListener("click", () => { panel.hidden = !panel.hidden; });
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
