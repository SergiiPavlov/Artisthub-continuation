// Chat Friend + AI bridge with memory + Provider + Server/Browser TTS
// VERSION: chat.js v2.8.1 (anti AB-loop + correct pause/stop timers + wake/mic coexist) — 2025-09-10
(() => {
  if (window.__ASSISTANT_UI_INIT__) return;
  window.__ASSISTANT_UI_INIT__ = true;

  const API_BASE =
    (import.meta?.env?.VITE_API_URL && import.meta.env.VITE_API_URL.replace(/\/+$/, "")) ||
    (location.hostname === "localhost" ? "http://localhost:8787" : "");

  // ─── helpers ─────────────────────────────────────────────────────────
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
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // всё, что похоже на «следующая/другая/another/next/skip»
  const NEXT_RE = /\b(следующ(ую|ий|ая)|друг(ую|ой)|ин(ую|ой)|нов(ую|ый)|another|next|skip|скип)\b/i;

  // ─── language lock (только из настроек) ──────────────────────────────
  const state = {
    langPref:
      (localStorage.getItem("assistant.lang") || "").toLowerCase() ||
      ((navigator.language || "").toLowerCase().startsWith("uk")
        ? "uk"
        : (navigator.language || "").toLowerCase().startsWith("en")
        ? "en"
        : "ru"),
  };
  function pinLang(lang) {
    const v = (lang || "").toLowerCase();
    if (v === "ru" || v === "uk" || v === "en") {
      state.langPref = v;
      try { localStorage.setItem("assistant.lang", v); } catch {}
      addMsg("note", `Язык речи закреплён: ${v.toUpperCase()}`);
    }
  }
  function codeToBCP47(v) { return v === "uk" ? "uk-UA" : v === "ru" ? "ru-RU" : "en-US"; }

  // ─── UI ──────────────────────────────────────────────────────────────
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
          <span>Язык (RU/UK/EN)</span>
          <select id="as-lang">
            <option value="ru">Русский</option>
            <option value="uk">Українська</option>
            <option value="en">English</option>
          </select>
        </label>
        <label class="assistant__row">
          <span>Голос озвучки</span>
          <select id="as-voice"></select>
        </label>
        <label class="assistant__row">
          <span>Серверный TTS (Piper)</span>
          <input id="as-tts-server" type="checkbox" />
          <small class="assistant__hint">Нужно настроить /api/tts на сервере. Иначе будет браузерный голос.</small>
        </label>
        <label class="assistant__row">
          <span>Пост. прослушивание (wake word)</span>
          <input id="as-wake-on" type="checkbox" />
        </label>
        <label class="assistant__row">
          <span>Фраза активации</span>
          <input id="as-wake-phrase" type="text" value="диджей,dj" />
        </label>
        <div class="assistant__row">
          <button id="as-test-voice" type="button">Проба голоса</button>
          <button id="as-clear-log" type="button">Очистить чат</button>
          <button id="as-hide-settings" type="button">Свернуть настройки</button>
        </div>
        <div class="assistant__row">
          <small class="assistant__hint">
            Фоновое прослушивание работает только при активной вкладке и выданном доступе к микрофону.
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
    #as-voice,#as-lang{flex:1;min-width:0;padding:.45rem .55rem;border-radius:8px;background:#0b0f14;border:1px solid #263142;color:#e8f1ff}
  `;
  document.head.appendChild(style);

  // refs
  const panel    = root.querySelector(".assistant__panel");
  const btnClose = root.querySelector(".assistant__close");
  const btnGear  = root.querySelector(".assistant__gear");
  const logEl    = root.querySelector("#assistantLog");
  const inputEl  = root.querySelector(".assistant__input");
  const btnSend  = root.querySelector(".assistant__send");
  const btnMic   = root.querySelector(".assistant__mic");
  const selLang  = root.querySelector("#as-lang");
  const selVoice = root.querySelector("#as-voice");
  const selProv  = root.querySelector("#as-provider");
  const chkTTS   = root.querySelector("#as-tts-server");
  const btnTest  = root.querySelector("#as-test-voice");
  const btnClr   = root.querySelector("#as-clear-log");
  const btnHideSettings = root.querySelector("#as-hide-settings");
  const chkWake  = root.querySelector("#as-wake-on");
  const inpWake  = root.querySelector("#as-wake-phrase");

  // ─── memory ───────────────────────────────────────────────────────────
  const chat = {
    history: [], lastIds: [], lastGenre: null, lastMood: null,
    nowPlaying: null, lastQuery: ""
  };

  // кольцо последних ID (до 25) для exclude
  const recent = {
    ids: [],
    add(id) {
      if (!id) return;
      this.ids = this.ids.filter((x) => x !== id);
      this.ids.push(id);
      if (this.ids.length > 25) this.ids.shift();
    },
    has(id){ return this.ids.includes(id); },
    list() { return [...this.ids]; },
  };

  // клиентская очередь (управляем сами)
  const cQueue = {
    ids: [],
    seed: "",
    busy: false,
    clear(){ this.ids = []; this.seed = ""; },
    async refill(q) {
      if (!API_BASE || this.busy) return;
      this.busy = true;
      try {
        const r = await fetch(`${API_BASE}/api/yt/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q, max: 30, exclude: recent.list(), shuffle: true })
        });
        const j = await r.json().catch(()=>({ ids: [] }));
        const got = Array.isArray(j.ids) ? j.ids : [];
        this.seed = q;
        // жёсткий дедуп: выкидываем недавние
        this.ids = got.filter(id => /^[A-Za-z0-9_-]{11}$/.test(id) && !recent.has(id));
      } catch (e) {
        console.warn("[queue] refill failed", e);
      } finally { this.busy = false; }
    },
    take() {
      while (this.ids.length) {
        const id = this.ids.shift();
        if (!recent.has(id)) return id;
      }
      return "";
    },
    dropCurrent(id) {
      if (!id) return;
      this.ids = this.ids.filter(x => x !== id);
    }
  };

  // ─── Anti AB-loop detector ───────────────────────────────────────────
  const loop = {
    last: [],
    lastBreak: 0,
    push(id) {
      if (!id) return;
      this.last.push(id);
      if (this.last.length > 8) this.last.shift();
    },
    isABPattern() {
      if (this.last.length < 6) return false;
      const a = this.last.slice(-6);
      const uniq = Array.from(new Set(a));
      if (uniq.length !== 2) return false;
      if (a[0] === a[1]) return false;
      for (let i = 2; i < a.length; i++) {
        if (a[i] !== a[i-2]) return false;
      }
      return true; // A,B,A,B,A,B
    }
  };

  window.addEventListener("AM.player.track", (e) => {
    const id = e?.detail?.id || "";
    const title = String(e?.detail?.title || "");
    let artist = "", song = "";
    const m = title.split(" - ");
    if (m.length >= 2) { artist = m[0].trim(); song = m.slice(1).join(" - ").trim(); }
    chat.nowPlaying = { id, title, artist, song };
    if (id) {
      recent.add(id);
      chat.lastIds = [id];
      cQueue.dropCurrent(id);
      loop.push(id);

      // разрыв «A-B-A-B» зацикливания
      if (loop.isABPattern() && (Date.now() - loop.lastBreak > 5000)) {
        loop.lastBreak = Date.now();
        const seed = chat.lastQuery || randomMixSeed();
        (async () => {
          await cQueue.refill(seed);
          const nid = cQueue.take();
          if (nid) dispatch("play", { id: nid });
          else dispatch("play", { query: seed, exclude: recent.list(), shuffle: true });
          addMsg("note", "[anti-loop] Пересобрал поток, чтобы не заедало.");
        })();
      }
    }
  });

  // ─── Provider pref ───────────────────────────────────────────────────
  const provPref = localStorage.getItem("assistant.provider") || "auto";
  selProv.value = provPref;
  selProv.addEventListener("change", () => {
    localStorage.setItem("assistant.provider", selProv.value);
    addMsg("note", `Режим: ${selProv.value === "pro" ? "Pro (OpenAI)" : selProv.value === "free" ? "Free (локально)" : "Auto"}`);
  });
  function providerToSend() {
    const p = localStorage.getItem("assistant.provider") || "auto";
    if (p === "pro") return "openai";
    if (p === "free") return "lmstudio";
    return undefined; // auto
  }

  // ─── Language select ─────────────────────────────────────────────────
  if (selLang) {
    selLang.value = state.langPref;
    selLang.addEventListener("change", () => {
      pinLang(selLang.value);
      speak(sampleByLang(state.langPref));
      // перезапуск wake-word с новым языком
      if (SR && isWakeOn()) startWakeLoop(true);
    });
  }

  // ─── Server TTS pref ─────────────────────────────────────────────────
  chkTTS.checked = localStorage.getItem("assistant.ttsServer") === "1";
  chkTTS.addEventListener("change", () => {
    localStorage.setItem("assistant.ttsServer", chkTTS.checked ? "1" : "0");
    addMsg("note", chkTTS.checked ? "Серверный TTS включён" : "Серверный TTS выключен");
  });

  // ─── Voices list (browser) ───────────────────────────────────────────
  const tts = { voiceName: localStorage.getItem("assistant.voice") || "" };
  function populateVoices() {
    try {
      const V = window.speechSynthesis?.getVoices?.() || [];
      selVoice.innerHTML =
        `<option value="">Системный / лучший доступный</option>` +
        V.map((v) => `<option value="${v.name}">${v.name} — ${v.lang}</option>`).join("");
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
    speak(sampleByLang(state.langPref));
  });

  // ─── server TTS (buffered, explicit lang) ────────────────────────────
  async function speakServer(text, lang) {
    if (!API_BASE) throw new Error("no API");
    const url = `${API_BASE}/api/tts?lang=${encodeURIComponent(lang || "")}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ text, lang }),
    });
    if (!r.ok) {
      let msg = `tts ${r.status}`;
      try { const j = await r.json(); if (j?.error) msg += ` ${j.error}`; } catch {}
      throw new Error(msg);
    }
    const buf = await r.arrayBuffer();
    const urlObj = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
    const audio = new Audio(urlObj);
    audio.preload = "auto";
    try { await audio.play(); } catch (e) { console.warn("[tts] play() blocked:", e); }
    audio.onended = () => URL.revokeObjectURL(urlObj);
    audio.onerror = () => console.error("[tts] audio error:", audio.error);
  }
  async function ttsServerSpeak(text, lang) { return speakServer(text, lang); }

  // ─── browser TTS (strict voice match) ────────────────────────────────
  function speakBrowser(text, lang) {
    try {
      if (!("speechSynthesis" in window)) return;
      try { window.speechSynthesis.cancel(); } catch {}
      const u = new SpeechSynthesisUtterance(text);
      const want = codeToBCP47(lang);
      const wantPrefix = want.slice(0,2);
      const voices = (window.speechSynthesis.getVoices?.() || [])
        .filter(v => String(v.lang||"").toLowerCase().startsWith(wantPrefix));
      // если пользователь выбрал голос, но он не совпадает по языку — игнорируем
      let v = voices.find(v => v.name === tts.voiceName);
      if (!v) v = voices[0]; // первый подходящий
      if (v) u.voice = v;
      u.lang = want; u.rate = 1; u.pitch = 1;
      window.speechSynthesis.speak(u);
    } catch {}
  }

  // ─── public speak() ──────────────────────────────────────────────────
  function speak(text) {
    const lang = state.langPref;
    const useServer = chkTTS.checked && !!API_BASE;
    if (useServer) {
      speakServer(text, lang).catch((err) => {
        console.warn("[tts] server failed → browser fallback:", err?.message || err);
        addMsg("note", `[TTS fallback → ${lang}]`);
        speakBrowser(text, lang);
      });
    } else {
      speakBrowser(text, lang);
    }
  }
  function sampleByLang(lang) {
    return lang === "uk" ? "Привіт! Перевірка голосу."
         : lang === "en" ? "Hello! This is a voice test."
         : "Привет! Проверка голоса.";
  }

  btnTest?.addEventListener("click", () => speak(sampleByLang(state.langPref)));
  btnClr?.addEventListener("click", () => { logEl.innerHTML = ""; chat.history = []; });
  btnHideSettings?.addEventListener("click", () => {
    const s = root.querySelector(".assistant__settings");
    if (s) s.hidden = true;
  });

  // === Sleep timer (helpers) ===========================================
  let sleepTimerId = null, sleepAfterTrack = false, sleepAfterAction = "stop";
  function clearSleepTimer() { if (sleepTimerId) { clearTimeout(sleepTimerId); sleepTimerId = null; } }
  function scheduleActionLater(ms, op) {
    clearSleepTimer();
    sleepTimerId = setTimeout(() => {
      if (op === "pause") {
        dispatch("player-pause");
        addMsg("note", "⏰ Таймер: пауза.");
      } else {
        dispatch("player-stop");
        addMsg("note", "⏰ Таймер: стоп.");
      }
    }, ms);
  }
  function parseSleepDuration(s) {
    const r = /(\d{1,3})\s*(час(?:ов|а)?|h|hour|hours|мин(?:ут[ы|у])?|m|min|minutes|сек(?:унд[уы])?|s|sec|seconds)/i;
    const m = String(s||"").toLowerCase().match(r);
    if (!m) return null;
    const n = Number(m[1]||0); let unit = m[2]||"";
    if (/^час|h|hour/.test(unit)) return n*3600*1000;
    if (/^мин|m|min/.test(unit))  return n*60*1000;
    return n*1000;
  }
  window.addEventListener("AM.player.ended", () => {
    if (sleepAfterTrack) {
      sleepAfterTrack = false;
      clearSleepTimer();
      if (sleepAfterAction === "pause") dispatch("player-pause");
      else dispatch("player-stop");
      addMsg("note", sleepAfterAction === "pause" ? "⏰ Пауза после текущего трека." : "⏰ Остановлено после текущего трека.");
    }
  });

  // ─── log/history ─────────────────────────────────────────────────────
  function addMsg(role, content) {
    const cls = role === "user" ? "assistant__msg--user" : role === "bot" ? "assistant__msg--bot" : "assistant__msg--note";
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

  // ─── mix seeds (рандом, без подряд-повторов) ─────────────────────────
  const MIX_SEEDS = [
    "lofi hip hop radio","classic rock hits","best jazz music relaxing","indie rock playlist","hip hop playlist",
    "edm house techno mix","ambient music long playlist","pop hits playlist","latin hits playlist",
    "rnb soul classics playlist","best reggae mix",
  ];
  let lastMixSeed = "";
  function randomMixSeed() {
    if (!MIX_SEEDS.length) return "music radio mix";
    let tries = 0, seed = MIX_SEEDS[(Math.random()*MIX_SEEDS.length)|0];
    while (MIX_SEEDS.length > 1 && seed === lastMixSeed && tries < 6) { seed = MIX_SEEDS[(Math.random()*MIX_SEEDS.length)|0]; tries++; }
    lastMixSeed = seed; return seed;
  }
  function ensureMoodQuery(mood) {
    const m = String(mood||"").toLowerCase();
    if (m === "happy") return "upbeat feel good hits";
    if (m === "calm")  return "lofi chill beats to relax";
    if (m === "sad")   return "sad emotional songs playlist";
    if (m === "energetic") return "high energy workout rock mix";
    return "music radio mix";
  }
  function ensureGenreQuery(genre) {
    const g = String(genre||"").toLowerCase();
    const map = {
      "джаз":"best jazz music relaxing","рок":"classic rock hits","поп":"pop hits playlist","электрон":"edm house techno mix",
      "lofi":"lofi hip hop radio","классик":"classical symphony playlist","рэп":"hip hop playlist","инди":"indie rock playlist",
      "ambient":"ambient music long playlist","блюз":"best blues songs playlist","шансон":"russian chanson mix",
      "folk":"folk acoustic playlist","rnb":"rnb soul classics playlist","latin":"latin hits playlist","reggae":"best reggae mix",
      "k-pop":"kpop hits playlist","j-pop":"jpop hits playlist","soundtrack":"movie soundtrack playlist"
    };
    return map[g] || `${g} music playlist`;
  }

  // ─── Клиентский NEXT с очередью (анти-залипание) ─────────────────────
  async function nextWithGuard() {
    // если есть клиентская очередь — берём оттуда
    let id = cQueue.take();
    if (!id && chat.lastQuery) {
      await cQueue.refill(chat.lastQuery);
      id = cQueue.take();
    }
    if (id) {
      dispatch("play", { id });
      return;
    }

    // иначе — сторож для встроенного плейлиста
    const prevId = chat.nowPlaying?.id || "";
    dispatch("player-next");
    await sleep(700);
    const cur1 = chat.nowPlaying?.id || "";
    if (cur1 && cur1 !== prevId) return;

    dispatch("player-next");
    await sleep(1200);
    const cur2 = chat.nowPlaying?.id || "";
    if (cur2 && cur2 !== prevId) return;

    const seed = chat.lastQuery || randomMixSeed();
    dispatch("play", { query: seed, exclude: recent.list(), shuffle: true });
    await sleep(750);
    dispatch("player-next");
  }

  // ─── actions runner ──────────────────────────────────────────────────
  async function runActions(actions = []) {
    for (const a of actions) {
      if (a?.type === "player" && a.action) {
        if (a.action === "next") await nextWithGuard();
        else dispatch("player-" + a.action);
      } else if (a?.type === "view" && a.mode) {
        dispatch("view", { mode: a.mode });
      } else if (a?.type === "recommend") {
        dispatch("recommend", a);
        if (a.genre) chat.lastGenre = a.genre;
        if (a.mood)  chat.lastMood  = a.mood;
        if (a.autoplay && (a.genre || a.mood || a.like)) {
          const q = a.like ? a.like : a.genre ? ensureGenreQuery(a.genre) : ensureMoodQuery(a.mood);
          chat.lastQuery = q;
          // префетчим очередь, стартуем с первого id
          await cQueue.refill(q);
          const id = cQueue.take();
          if (id) dispatch("play", { id });
          else dispatch("play", { query: q, exclude: recent.list(), shuffle: true });
        }
      } else if (a?.type === "volume") {
        dispatch("volume", a);
      } else if (a?.type === "mixradio") {
        const seed = randomMixSeed();
        chat.lastQuery = seed;
        await cQueue.refill(seed);
        const id = cQueue.take();
        if (id) dispatch("play", { id });
        else dispatch("play", { query: seed, exclude: recent.list(), shuffle: true });
      } else if (a?.type === "ui" && a.action) {
        if (a.action === "minimize") dispatch("minimize");
        else if (a.action === "expand") dispatch("expand");
      } else if (a?.type === "play" && (a.id || a.query)) {
        if (a.query) {
          chat.lastQuery = a.query;
          await cQueue.refill(a.query);
          const id = cQueue.take();
          if (id) { dispatch("play", { id }); continue; }
        }
        dispatch("play", { id: a.id, query: a.query, exclude: recent.list(), shuffle: true });
        const idd = getYouTubeId(a.id || a.query);
        if (idd) { chat.lastIds = [idd]; recent.add(idd); cQueue.dropCurrent(idd); }
      }
    }
  }

  function harvestIdsFromReply(txt = "") {
    const ids = new Set();
    const urlRe = /\bhttps?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})\b/g;
    let m; while ((m = urlRe.exec(txt))) ids.add(m[1]);
    const idRe = /\b([A-Za-z0-9_-]{11})\b/g;
    while ((m = idRe.exec(txt))) ids.add(m[1]);
    return Array.from(ids);
  }

  // ─── Delay/After-current parsing ─────────────────────────────────────
  function parseDelaySpec(s = "") {
    const t = s.toLowerCase();
    const wantsPause = /(пауз|pause)/.test(t);
    const wantsStop  = /(выключ|останов|stop)/.test(t);
    const op = wantsPause ? "pause" : wantsStop ? "stop" : null;

    const afterCurrent = /(после\s+(этой|текущей)\s+(песни|композиции|трека)|after\s+(this|current)\s+(song|track))/.test(t);

    let ms = null;
    const m = t.match(/через\s+(\d{1,3})\s*(сек(?:унд[уы])?|с|sec|seconds|мин(?:ут[ы|у])?|m|min|minutes|час(?:ов|а)?|h|hour|hours)\b/);
    if (m) {
      const n = Number(m[1] || 0); const u = m[2] || "";
      if (/^час|h|hour/.test(u)) ms = n * 3600000;
      else if (/^мин|m|min/.test(u)) ms = n * 60000;
      else ms = n * 1000;
    }

    if (afterCurrent || ms) {
      return { ms, afterCurrent, op: op || (afterCurrent ? "stop" : "pause") };
    }
    return null;
  }

  // ─── Local intents (таймер/«после текущего»/хиты N часов) ────────────
  function tryAdvancedLocalIntents(traw) {
    const text = String(traw||"");
    const ds = parseDelaySpec(text);
    if (ds?.ms) {
      const secs = Math.round(ds.ms / 1000);
      const verb = ds.op === "pause" ? "поставлю на паузу" : "выключу";
      addMsg("bot", `Ок, ${verb} через ${secs} сек.`);
      speak(`${verb} через ${secs} секунд`);
      scheduleActionLater(ds.ms, ds.op);
      return true;
    }
    if (ds?.afterCurrent) {
      sleepAfterTrack = true;
      sleepAfterAction = ds.op || "stop";
      clearSleepTimer();
      addMsg("bot", ds.op === "pause" ? "Ок, поставлю на паузу после текущего трека." : "Ок, выключу после текущего трека.");
      speak(ds.op === "pause" ? "Поставлю на паузу после текущего трека" : "Выключу после текущего трека");
      try { window.__AM_SLEEP_AFTER__ = true; } catch {}
      return true;
    }

    // «хиты <артист> на 2 часа»
    const reThisArtist = /(хит(?:ов|ы)|лучшие|best of|hits).*(этого артиста).*(\d{1,2}.*(час|мин))/i;
    const reNamed = /(хит(?:ов|ы)|лучшие|best of|hits)\s+([a-zа-яёіїє .'\-]+?)\s+(?:на|в течение|на протяжении)?\s*(\d{1,2}\s*(?:час|часа|часов|мин|минут|minutes?|hours?))/i;
    let artist = "", durStr = ""; let m = text.toLowerCase().match(reThisArtist);
    if (m && chat.nowPlaying?.artist) { artist = chat.nowPlaying.artist; durStr = m[3] || ""; }
    else { m = text.toLowerCase().match(reNamed); if (m) { artist = (m[2] || "").trim(); durStr = m[3] || ""; } }
    if (artist && durStr) {
      const ms = parseSleepDuration(durStr);
      if (ms) {
        const q = `${artist} greatest hits playlist`;
        chat.lastQuery = q;
        addMsg("bot", `Ок, хиты ${artist} — поехали. Выключу через ${Math.round(ms/60000)} мин.`);
        speak(`Включаю хиты ${artist}. Выключу через ${Math.round(ms/60000)} минут`);
        (async () => {
          await cQueue.refill(q);
          const id = cQueue.take();
          if (id) dispatch("play", { id });
          else dispatch("play", { query: q, exclude: recent.list(), shuffle: true });
        })();
        scheduleActionLater(ms, "stop");
        return true;
      }
    }
    return false;
  }

  // ─── API ─────────────────────────────────────────────────────────────
  async function callAI(message) {
    if (!API_BASE) return null;
    const r = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message, history: chat.history, provider: providerToSend(),
        langHint: state.langPref
      }),
    });
    if (!r.ok) throw new Error(`API ${r.status}`);
    return r.json();
  }

  async function handleUserText(text) {
    const v = String(text || "").trim();
    if (!v) return;

    addMsg("user", v);
    if (tryAdvancedLocalIntents(v)) return;

    // таймер авто-стоп/паузы в тексте
    const delaySpec = parseDelaySpec(v);
    const suppressImmediatePauseStop = !!(delaySpec && (delaySpec.ms || delaySpec.afterCurrent));
    const forcedNext = NEXT_RE.test(v);

    try {
      const data = await callAI(v);
      if (data && isStr(data.reply)) {
        const harvested = harvestIdsFromReply(data.reply);
        if (harvested.length) { chat.lastIds = harvested; harvested.forEach((id) => recent.add(id)); }

        addMsg("bot", data.reply);
        speak(data.reply);

        let actions = Array.isArray(data.actions) ? data.actions : [];

        if (forcedNext) {
          await nextWithGuard();
        } else if (actions.length) {
          if (suppressImmediatePauseStop) {
            actions = actions.filter((a) => !(a?.type === "player" && (a.action === "stop" || a.action === "pause")));
          }
          const aPlay = actions.find((a) => a.type === "play" && (a.id || a.query));
          if (aPlay) {
            const id = getYouTubeId(aPlay.id || aPlay.query);
            if (id) { chat.lastIds = [id]; recent.add(id); cQueue.dropCurrent(id); }
            if (aPlay.query) chat.lastQuery = aPlay.query;
          }
          await runActions(actions);

          if (delaySpec?.ms) {
            const secs = Math.round(delaySpec.ms/1000);
            addMsg("note", delaySpec.op === "pause" ? `⏰ Поставлю на паузу через ~${secs} сек.` : `⏰ Выключусь через ~${secs} сек.`);
            scheduleActionLater(delaySpec.ms, delaySpec.op);
          } else if (delaySpec?.afterCurrent) {
            sleepAfterTrack = true;
            sleepAfterAction = delaySpec.op || "stop";
            clearSleepTimer();
            addMsg("note", sleepAfterAction === "pause" ? "⏰ Пауза после текущего трека." : "⏰ Выключусь после текущего трека.");
            try { window.__AM_SLEEP_AFTER__ = true; } catch {}
          }
        } else {
          const localReply = await handleCommandLocal(v);
          addMsg("note", "[" + localReply + "]");
          if (delaySpec?.ms) scheduleActionLater(delaySpec.ms, delaySpec.op);
          else if (delaySpec?.afterCurrent) {
            sleepAfterTrack = true;
            sleepAfterAction = delaySpec.op || "stop";
            clearSleepTimer();
            addMsg("note", sleepAfterAction === "pause" ? "⏰ Пауза после текущего трека." : "⏰ Выключусь после текущего трека.");
            try { window.__AM_SLEEP_AFTER__ = true; } catch {}
          }
        }

        if (isStr(data.explain)) addMsg("note", "[" + data.explain + "]");
        return;
      }
    } catch (e) {
      console.warn("AI API error", e);
    }

    const reply = await handleCommandLocal(v);
    addMsg("bot", reply);
    speak(reply);
  }

  // ─── local fallback for simple commands ──────────────────────────────
  async function handleCommandLocal(t) {
    const text = (t || "").toLowerCase();
    const wantsPlay = /включ|поставь|play|запусти|вруби|сыграй/.test(text);

    if (/list|список|лист ?вью/.test(text)) { dispatch("view", { mode: "list" }); return "Включаю список"; }
    if (/grid|сетка|карточк/.test(text))   { dispatch("view", { mode: "grid" }); return "Включаю сетку"; }

    if (NEXT_RE.test(text)) { await nextWithGuard(); return "Следующий трек"; }

    if (/prev|пред/.test(text))            { dispatch("player-prev"); return "Предыдущий трек"; }
    if (/\b(пауза|pause)\b|останов/.test(text)) { dispatch("player-pause"); return "Пауза"; }

    if (/(отмени|сбрось|cancel).*(таймер|timer)/.test(text)) { clearSleepTimer(); sleepAfterTrack=false; return "Таймер отменён"; }

    if (/play|плей|включи|вруби|сыграй/.test(text)) {
      if (chat.lastIds.length) {
        dispatch("play", { id: chat.lastIds[0] });
      } else {
        const seed = randomMixSeed();
        chat.lastQuery = seed;
        await cQueue.refill(seed);
        const id = cQueue.take();
        if (id) dispatch("play", { id });
        else dispatch("play", { query: seed, exclude: recent.list(), shuffle: true });
      }
      return "Играю";
    }

    if (/тише|quieter|volume down|поменьше/.test(text)) { dispatch("volume", { delta: -0.1 }); return "Тише"; }
    if (/громче|louder|volume up|погромче/.test(text))  { dispatch("volume", { delta: +0.1 }); return "Громче"; }
    if (/(mix ?radio|микс|радио|random)/.test(text))    {
      const seed = randomMixSeed();
      chat.lastQuery = seed;
      await cQueue.refill(seed);
      const id = cQueue.take();
      if (id) dispatch("play", { id });
      else dispatch("play", { query: seed, exclude: recent.list(), shuffle: true });
      return "Mix Radio";
    }

    if (/^(?:включи|поставь|запусти|найди|знайди)\s+.+/i.test(text)) {
      const like = text.replace(/^(?:включи|поставь|запусти|найди|знайди)\s+/i, "").trim();
      if (like) {
        chat.lastQuery = like;
        await cQueue.refill(like);
        const id = cQueue.take();
        if (id) dispatch("play", { id });
        else dispatch("play", { query: like, exclude: recent.list(), shuffle: true });
        return "Шукаю та вмикаю…";
      }
    }

    const moods = [
      { re: /(весел|радіс|радост|happy|joy)/, mood: "happy" },
      { re: /(спок|calm|chill|relax)/,        mood: "calm" },
      { re: /(сум|sad|minor)/,                mood: "sad" },
      { re: /(енерг|drive|бадьор|рок|rock)/,  mood: "energetic" }
    ];
    const m = moods.find(m => m.re.test(text));
    if (m) {
      const q = ensureMoodQuery(m.mood);
      chat.lastQuery = q;
      await cQueue.refill(q);
      const id = cQueue.take();
      if (id) dispatch("play", { id });
      else dispatch("play", { query: q, exclude: recent.list(), shuffle: true });
      return wantsPlay ? "Підбираю та вмикаю…" : "Підбираю під настрій";
    }

    const g = text.match(/жанр\s*([a-zа-яёіїє-]+)/i);
    if (g && g[1]) {
      const q = ensureGenreQuery(g[1]);
      chat.lastQuery = q;
      await cQueue.refill(q);
      const id = cQueue.take();
      if (id) dispatch("play", { id });
      else dispatch("play", { query: q, exclude: recent.list(), shuffle: true });
      return wantsPlay ? `Жанр ${g[1]}, запускаю…` : `Жанр: ${g[1]}`;
    }

    if (/из (этого|того) списка|из предложенного|любой из списка/.test(text)) {
      if (chat.lastIds.length) {
        dispatch("play", { id: chat.lastIds[0] });
        return "Запускаю из последнего списка";
      }
      const seed = randomMixSeed();
      chat.lastQuery = seed;
      await cQueue.refill(seed);
      const id = cQueue.take();
      if (id) dispatch("play", { id });
      else dispatch("play", { query: seed, exclude: recent.list(), shuffle: true });
      return "Включаю из своих рекомендаций";
    }

    return "Я тут. Могу переключать вид, управлять треком и подбирать музыку по настроению.";
  }

  // ─── Mic + Wake word ─────────────────────────────────────────────────
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function isWakeOn(){ return !!chkWake?.checked; }
  function wakePhrases(){ return String(inpWake?.value||"").toLowerCase().split(/[,\|]/).map(s=>s.trim()).filter(Boolean); }

  let wakeRec = null, wakeStopReq = false, wakeRestartTimer = null;
  let wakePausedForMic = false, wakeActive = false, wakeLogShown = false;

  async function startWakeLoop(force=false) {
    if (!SR) { addMsg("note","[Wake] Браузер не поддерживает распознавание речи."); return; }
    if (!isWakeOn() && !force) return;
    if (wakeActive && !force) return;

    // мягкий перезапуск без лог-спама
    stopWakeLoop(true);
    try {
      const rec = new SR();
      rec.lang = codeToBCP47(state.langPref);
      rec.continuous = true;
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      wakeRec = rec;

      rec.onstart = () => {
        wakeActive = true;
        if (!wakeLogShown) { addMsg("note", "[Wake] Фоновое прослушивание включено."); wakeLogShown = true; }
      };

      rec.onresult = (ev) => {
        const t = (ev.results?.[ev.results.length-1]?.[0]?.transcript || "").toLowerCase().trim();
        const hot = wakePhrases().find(ph => t.startsWith(ph) || t.includes(" " + ph + " "));
        if (hot) {
          let cmd = t;
          for (const ph of wakePhrases()) cmd = cmd.replace(new RegExp("^\\s*"+ph+"\\s*"), "").trim();
          if (!cmd) { addMsg("note", "[Wake] Слушаю."); return; }
          handleUserText(cmd);
        }
      };

      rec.onerror = () => {};
      rec.onend = () => {
        wakeActive = false;
        if (wakeStopReq) return;
        if (!isWakeOn() || wakePausedForMic) return;
        clearTimeout(wakeRestartTimer);
        wakeRestartTimer = setTimeout(() => startWakeLoop(true), 600);
      };

      rec.start();
    } catch (e) {
      addMsg("note","[Wake] Не удалось запустить прослушивание.");
    }
  }

  function stopWakeLoop(silent=false) {
    wakeStopReq = true;
    clearTimeout(wakeRestartTimer);
    if (wakeRec) { try { wakeRec.onend = null; wakeRec.stop(); } catch{} wakeRec = null; }
    wakeStopReq = false;
    wakeActive = false;
    if (!silent) { addMsg("note","[Wake] Выключено."); wakeLogShown = false; }
  }

  if (chkWake) {
    chkWake.addEventListener("change", () => { if (isWakeOn()) startWakeLoop(true); else stopWakeLoop(false); });
  }
  if (inpWake) {
    inpWake.addEventListener("change", () => { if (SR && isWakeOn()) startWakeLoop(true); });
  }

  // Кнопка микрофона — разовый слушатель (коэкзистенция с wake)
  if (btnMic && SR) {
    btnMic.addEventListener("click", () => {
      try {
        // временно приостанавливаем wake
        if (isWakeOn() && wakeActive) { wakePausedForMic = true; stopWakeLoop(true); }

        const rec = new SR();
        rec.lang = codeToBCP47(state.langPref);
        rec.interimResults = false; rec.maxAlternatives = 1;
        btnMic.classList.add("is-on");

        rec.onresult = (ev) => { const t = ev.results?.[0]?.[0]?.transcript || ""; handleUserText(t); };
        rec.onerror = () => { addMsg("bot","Не вышло распознать голос"); };
        rec.onend = () => {
          btnMic.classList.remove("is-on");
          // аккуратно возобновляем wake (если включён в настройках)
          if (isWakeOn()) { wakePausedForMic = false; startWakeLoop(true); }
        };
        rec.start();
      } catch { addMsg("bot","Розпізнавач недоступний"); }
    });
  }

  // ─── wiring ──────────────────────────────────────────────────────────
  root.querySelector(".assistant__toggle").addEventListener("click", () => { panel.hidden = !panel.hidden; });
  btnClose.addEventListener("click", () => { panel.hidden = true; });
  btnGear.addEventListener("click", () => { const s = root.querySelector(".assistant__settings"); if (s) s.hidden = !s.hidden; });
  btnSend.addEventListener("click", () => { const t = inputEl.value; inputEl.value = ""; handleUserText(t); });
  inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { const t = inputEl.value; inputEl.value = ""; handleUserText(t); } });

  // автозапуск wake-loop, если включён
  if (SR && isWakeOn()) startWakeLoop();
})();
