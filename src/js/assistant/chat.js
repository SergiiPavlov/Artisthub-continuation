import { API_BASE } from './apiBase.js';
import { warmupBackend } from '../api/warmup.js';


// VERSION: chat.js v2.8.9
// build tag: chat_pro_longform_v3_SAFE_FIXED (no IIFE, no redeclare)
// (manual next/prev guards; prev voice guard)
// — 2025-09-14
(() => {
  if (window.__ASSISTANT_UI_INIT__) return;
  window.__ASSISTANT_UI_INIT__ = true;

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
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      try {
        localStorage.setItem("assistant.lang", v);
      } catch {}
      addMsg("note", `Язык речи закреплён: ${v.toUpperCase()}`);
    }
  }
  function codeToBCP47(v) {
    return v === "uk" ? "uk-UA" : v === "ru" ? "ru-RU" : "en-US";
  }

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
    .assistant__ai-badge{font:600 12px;color:#9ae6b4;background:#203021;border:1px solid #2b4a2d;padding:.25rem .4rem;border-radius:6px}
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

  // ─── warmup backend on start (баннер + экспоненциальные повторы) ─────
  try { warmupBackend(API_BASE, { banner: true, maxTries: 6 }); } catch {}

  // refs
  const panel = root.querySelector(".assistant__panel");
  const btnClose = root.querySelector(".assistant__close");
  const btnGear = root.querySelector(".assistant__gear");
  const logEl = root.querySelector("#assistantLog");
  const inputEl = root.querySelector(".assistant__input");
  const btnSend = root.querySelector(".assistant__send");
  const btnMic = root.querySelector(".assistant__mic");
  const selLang = root.querySelector("#as-lang");
  const selVoice = root.querySelector("#as-voice");
  const selProv = root.querySelector("#as-provider");
  const chkTTS = root.querySelector("#as-tts-server");
  const btnTest = root.querySelector("#as-test-voice");
  const btnClr = root.querySelector("#as-clear-log");
  const btnHideSettings = root.querySelector("#as-hide-settings");
  const chkWake = root.querySelector("#as-wake-on");
  const inpWake = root.querySelector("#as-wake-phrase");

  // ─── memory ───────────────────────────────────────────────────────────
  const chat = {
    history: [],
    lastIds: [],
    lastGenre: null,
    lastMood: null,
    nowPlaying: null,
    lastQuery: "",
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
    has(id) {
      return this.ids.includes(id);
    },
    list() {
      return [...this.ids];
    },
  };

  // клиентская очередь (управляем сами)
  const cQueue = {
    ids: [],
    seed: "",
    busy: false,
    clear() {
      this.ids = [];
      this.seed = "";
    },
    async refill(q) {
      if (!API_BASE || this.busy) return;
      this.busy = true;
      try {
        const r = await fetch(`${API_BASE}/api/yt/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q, max: 30, exclude: recent.list(), shuffle: true }),
        });
        const j = await r.json().catch(() => ({ ids: [] }));
        const got = Array.isArray(j.ids) ? j.ids : [];
        this.seed = q;
        // жёсткий дедуп: выкидываем недавние
        this.ids = got.filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id) && !recent.has(id));
      } catch (e) {
        console.warn("[queue] refill failed", e);
      } finally {
        this.busy = false;
      }
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
      this.ids = this.ids.filter((x) => x !== id);
    },
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
        if (a[i] !== a[i - 2]) return false;
      }
      return true; // A,B,A,B,A,B
    },
  };

  window.addEventListener("AM.player.track", (e) => {
    const id = e?.detail?.id || "";
    const title = String(e?.detail?.title || "");
    let artist = "",
      song = "";
    const m = title.split(" - ");
    if (m.length >= 2) {
      artist = m[0].trim();
      song = m.slice(1).join(" - ").trim();
    }
    chat.nowPlaying = { id, title, artist, song };
    if (id) {
      recent.add(id);
      chat.lastIds = [id];
      cQueue.dropCurrent(id);
      loop.push(id);

      // разрыв «A-B-A-B» зацикливания
      if (loop.isABPattern() && Date.now() - loop.lastBreak > 5000) {
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
    addMsg(
      "note",
      `Режим: ${selProv.value === "pro" ? "Pro (OpenAI)" : selProv.value === "free" ? "Free (локально)" : "Auto"}`
    );
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

  // ─── Voice lists (browser vs server) ─────────────────────────────────
  const tts = { voiceName: localStorage.getItem("assistant.voice") || "" };
  async function populateServerVoices() {
    try {
      if (!API_BASE) throw new Error("no API");
      const r = await fetch(`${API_BASE}/api/tts/voices`);
      const j = await r.json();
      const voices = Array.isArray(j?.voices) ? j.voices : [];
      const def = String(j?.default || "");
      selVoice.innerHTML =
        `<option value="">Авто (${def ? def : "по языку"})</option>` +
        voices
          .map((v) => {
            const name = `${String(v.lang || "").toUpperCase()} — ${v.id}`;
            const val = v.id; // безопасно передаём только id (basename)
            return `<option value="${val}">${name}</option>`;
          })
          .join("");
      const saved = localStorage.getItem("assistant.voice.server") || "";
      if (saved) selVoice.value = saved;
    } catch (e) {
      console.warn("[tts] voices:", e);
      selVoice.innerHTML = `<option value="">Авто (по языку)</option>`;
    }
  }

  function populateBrowserVoices() {
    try {
      const V = window.speechSynthesis?.getVoices?.() || [];
      selVoice.innerHTML =
        `<option value="">Системный / лучший доступный</option>` +
        V.map((v) => `<option value="${v.name}">${v.name} — ${v.lang}</option>`).join("");
      if (tts.voiceName) selVoice.value = tts.voiceName;
    } catch {}
  }

  function refreshVoices() {
    if (chkTTS?.checked) populateServerVoices();
    else populateBrowserVoices();
  }

  if ("speechSynthesis" in window) {
    try {
      window.speechSynthesis.onvoiceschanged = () => {
        if (!chkTTS?.checked) populateBrowserVoices();
      };
    } catch {}
    setTimeout(() => { if (!chkTTS?.checked) populateBrowserVoices(); }, 300);
  } else {
    setTimeout(refreshVoices, 0);
  }

  selVoice?.addEventListener("change", () => {
    const key = chkTTS?.checked ? "assistant.voice.server" : "assistant.voice";
    const val = selVoice.value || "";
    if (chkTTS?.checked) {
      localStorage.setItem("assistant.voice.server", val);
    } else {
      tts.voiceName = val;
      localStorage.setItem("assistant.voice", tts.voiceName);
    }
    speak(sampleByLang(state.langPref));
  });

  chkTTS?.addEventListener("change", () => {
    localStorage.setItem("assistant.tts.server", chkTTS.checked ? "1" : "0");
    refreshVoices();
  });

  // ─── server TTS (buffered, explicit lang) ────────────────────────────
  async function speakServer(text, lang) {
    if (!API_BASE) throw new Error("no API");
    const url = `${API_BASE}/api/tts?lang=${encodeURIComponent(lang || "")}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ text, lang, voice: (selVoice?.value||'') }) ,
    });
    if (!r.ok) {
      let msg = `tts ${r.status}`;
      try {
        const j = await r.json();
        if (j?.error) msg += ` ${j.error}`;
      } catch {}
      throw new Error(msg);
    }
    const buf = await r.arrayBuffer();
    const urlObj = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
    const audio = new Audio(urlObj);
    audio.preload = "auto";
    try {
      await audio.play();
    } catch (e) {
      console.warn("[tts] play() blocked:", e);
    }
    audio.onended = () => URL.revokeObjectURL(urlObj);
    audio.onerror = () => console.error("[tts] audio error:", audio.error);
  }
  async function ttsServerSpeak(text, lang) {
    return speakServer(text, lang);
  }

  // ─── browser TTS (strict voice match) ────────────────────────────────
  function speakBrowser(text, lang) {
    try {
      if (!("speechSynthesis" in window)) return;
      try {
        window.speechSynthesis.cancel();
      } catch {}
      const u = new SpeechSynthesisUtterance(text);
      const want = codeToBCP47(lang);
      const wantPrefix = want.slice(0, 2);
      const voices = (window.speechSynthesis.getVoices?.() || []).filter((v) =>
        String(v.lang || "").toLowerCase().startsWith(wantPrefix)
      );
      let v = voices.find((v) => v.name === tts.voiceName);
      if (!v) v = voices[0];
      if (v) u.voice = v;
      u.lang = want;
      u.rate = 1;
      u.pitch = 1;
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
    return lang === "uk"
      ? "Привіт! Перевірка голосу."
      : lang === "en"
      ? "Hello! This is a voice test."
      : "Привет! Проверка голоса.";
  }

  btnTest?.addEventListener("click", () => speak(sampleByLang(state.langPref)));
  btnClr?.addEventListener("click", () => {
    logEl.innerHTML = "";
    chat.history = [];
  });
  btnHideSettings?.addEventListener("click", () => {
    const s = root.querySelector(".assistant__settings");
    if (s) s.hidden = true;
  });

  // === Sleep timer (helpers) ===========================================
  let sleepTimerId = null,
    sleepAfterTrack = false,
    sleepAfterAction = "stop";

  // защита от авто-next после намеренной паузы
  let manualPauseGuardUntil = 0; // пока > now — не авто-Next на paused
  function markManualPauseGuard(ms = 60 * 60 * 1000) {
    manualPauseGuardUntil = Date.now() + ms;
  }

  function clearSleepTimer() {
    if (sleepTimerId) {
      clearTimeout(sleepTimerId);
      sleepTimerId = null;
    }
  }
  function scheduleActionLater(ms, op) {
    clearSleepTimer();
    // валидация и минимальный разумный порог
    if (!Number.isFinite(ms) || ms <= 0) {
      console.warn("[timer] invalid ms:", ms);
      addMsg("note", "⏱ Не понял время для таймера. Скажи, например, «через 20 секунд» или «через 1:30».");
      return;
    }
    const msSafe = Math.max(500, Math.round(ms));
    addMsg("note", `⏱ Таймер установлен: ${Math.round(msSafe / 1000)} сек → ${op === "pause" ? "пауза" : "стоп"}.`);
    sleepTimerId = setTimeout(() => {
      if (op === "pause") {
        dispatch("player-pause");
        markManualPauseGuard(12 * 60 * 60 * 1000); // 12 ч защиты от авто-next
        addMsg("note", "⏰ Таймер: пауза.");
      } else {
        dispatch("player-stop");
        addMsg("note", "⏰ Таймер: стоп.");
      }
    }, msSafe);
  }
  function parseSleepDuration(s) {
    const r =
      /(\d{1,3})\s*(час(?:ов|а)?|h|hour|hours|минут(?:ы|у)?|мин|m|min|minutes|секунд(?:ы|у)?|сек|s|sec|seconds)/i;
    const m = String(s || "").toLowerCase().match(r);
    if (!m) return null;
    const n = Number(m[1] || 0);
    const unit = (m[2] || "").toLowerCase();
    if (/^час|h|hour/.test(unit)) return n * 3600 * 1000;
    if (/^мин|minutes?/.test(unit) || /^минут/.test(unit) || unit === "m" || unit === "min") return n * 60 * 1000;
    return n * 1000;
  }
  const DASH = /[–—-]/; // en dash / em dash / hyphen

  // авто-продолжение по окончанию трека + «после текущего»
  let lastEndedNextAt = 0;
  window.addEventListener("AM.player.ended", () => {
    if (sleepAfterTrack) {
      sleepAfterTrack = false;
      clearSleepTimer();
      if (sleepAfterAction === "pause") {
        dispatch("player-pause");
        markManualPauseGuard(12 * 60 * 60 * 1000);
      } else {
        dispatch("player-stop");
      }
      addMsg(
        "note",
        sleepAfterAction === "pause" ? "⏰ Пауза после текущего трека." : "⏰ Остановлено после текущего трека."
      );
      return;
    }
    // авто-next, если пользователь не просил «после текущего»
    if (Date.now() - lastEndedNextAt > 1000) {
      lastEndedNextAt = Date.now();
      nextWithGuard();
    }
  });

  // страховка тишины
  let silenceTimer = null;
  window.addEventListener("AM.player.state", (e) => {
    const st = String(e?.detail?.state || "").toLowerCase(); // "paused"/"stopped"/"ended"
    clearTimeout(silenceTimer);
    if (!sleepAfterTrack && (st === "stopped" || st === "ended" || st === "paused")) {
      if (st === "paused" && Date.now() < manualPauseGuardUntil) return;
      silenceTimer = setTimeout(() => {
        if (!sleepAfterTrack && !(st === "paused" && Date.now() < manualPauseGuardUntil)) {
          nextWithGuard();
        }
      }, 3000);
    }
  });

  // ─── ГАРДЫ для ручных стрелок плеера ─────────────────────────────────
  // Если пользователь кликает "вперёд", а ID не сменился — применяем nextWithGuard()
  window.addEventListener("AM.player.next", async () => {
    const before = chat.nowPlaying?.id || "";
    setTimeout(async () => {
      const cur = chat.nowPlaying?.id || "";
      if (!cur || cur === before) {
        await nextWithGuard();
      }
    }, 600);
  });

  // Если пользователь кликает "назад", а плеер вернул тот же ID — ставим реальный предыдущий из недавних
  window.addEventListener("AM.player.prev", () => {
    const before = chat.nowPlaying?.id || "";
    setTimeout(() => {
      const cur = chat.nowPlaying?.id || "";
      if (!cur || cur === before) {
        const arr = recent.list();
        const prevId = arr.length >= 2 ? arr[arr.length - 2] : "";
        if (prevId && prevId !== before) {
          dispatch("play", { id: prevId });
        }
      }
    }, 600);
  });

  // ─── log/history ─────────────────────────────────────────────────────
  function addMsg(role, content) {
    const cls =
      role === "user"
        ? "assistant__msg--user"
        : role === "bot"
        ? "assistant__msg--bot"
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

// === PRO: Suggestions rendering & picking (safe) ===
const __RU_ORD = { 'перв':1, 'втор':2, 'трет':3, 'четв':4, 'пят':5, 'шест':6, 'седьм':7, 'восьм':8, 'девят':9, 'десят':10 };
function __fmtDur(sec){ sec = Math.max(0, Math.round(Number(sec)||0)); const h=(sec/3600)|0; const m=((sec%3600)/60)|0; return h?`${h}:${String(m).padStart(2,'0')}`:`${m} мин`; }
function __addSuggestList(items, opts={type:'movie'}){
  try{
    if (!window.chat) window.chat = {};
    window.chat.proLastSuggest = Array.isArray(items)? items.slice(0): [];
    const wrap = document.createElement('div');
    wrap.className='assistant__cards';
    wrap.style.margin='8px 0 10px'; wrap.style.display='grid'; wrap.style.gap='8px';
    wrap.style.gridTemplateColumns='repeat(auto-fill,minmax(240px,1fr))';
    (items||[]).forEach((x,idx)=>{
      const card = document.createElement('div');
      card.className='assistant__card'; card.style.padding='10px'; card.style.border='1px solid #333'; card.style.borderRadius='10px'; card.style.background='#111';
      const t = document.createElement('div');
      t.style.fontWeight='600'; t.style.marginBottom='6px'; t.textContent = `${idx+1}. ${x.title || 'Без названия'}`;
      const meta = document.createElement('div');
      meta.style.opacity='0.8'; meta.style.fontSize='12px'; meta.style.marginBottom='8px';
      const metaText = [];
      if (x.durationSec) metaText.push(__fmtDur(x.durationSec));
      if (x.author) metaText.push(x.author);
      meta.textContent = metaText.join(' · ');
      const row = document.createElement('div');
      row.style.display='flex'; row.style.gap='8px';
      const btnPlay = document.createElement('button');
      btnPlay.textContent='▶ Играть'; btnPlay.className='assistant__btn';
      btnPlay.style.padding='6px 10px'; btnPlay.style.borderRadius='8px'; btnPlay.style.border='1px solid #444'; btnPlay.style.background='#1d1d1d'; btnPlay.style.cursor='pointer';
      btnPlay.addEventListener('click', ()=>{
        try {
          window.dispatchEvent(new CustomEvent('assistant:play', { detail: { id: x.id } }));
          if (typeof addMsg === 'function') addMsg('note', `Включаю: ${x.title||x.id}`);
          if (typeof speak === 'function') speak('Включаю');
        } catch {}
      });
      
          row.appendChild(btnPlay);
          if (x.embedOk === false && x.url) {
            const a = document.createElement('a');
            a.textContent = 'Открыть на YouTube';
            a.href = x.url; a.target='_blank'; a.rel='noopener';
            a.style.padding='6px 10px'; a.style.borderRadius='8px';
            a.style.border='1px solid #444'; a.style.background='#1d1d1d';
            a.style.textDecoration='none'; a.style.display='inline-block';
            row.appendChild(a);
          }

      card.appendChild(t); card.appendChild(meta); card.appendChild(row);
      wrap.appendChild(card);
    });
    if (typeof logEl !== 'undefined' && logEl && logEl.appendChild) {
      logEl.appendChild(wrap);
      logEl.scrollTop = logEl.scrollHeight;
    }
  }catch(e){ console.warn('[chat] addSuggestList failed', e); }
}

async function __tryPickFromLast(text){
  try{
    const items = (window.chat && window.chat.proLastSuggest) ? window.chat.proLastSuggest : [];
    if (!items.length) return false;
    const mNum = text.match(/\b(?:№|#)?\s*(\d{1,2})\b/);
    let idx = null;
    if (mNum) { idx = (parseInt(mNum[1],10) || 0) - 1; }
    else {
      const low = text.toLowerCase();
      for (const [root, n] of Object.entries(__RU_ORD)) {
        if (low.includes(root)) { idx = n-1; break; }
      }
    }
    if (idx == null || idx < 0 || idx >= items.length) return false;
    const pick = items[idx];
    window.dispatchEvent(new CustomEvent('assistant:play', { detail: { id: pick.id } }));
    if (typeof addMsg === 'function') addMsg('note', `Включаю вариант №${idx+1}`);
    if (typeof speak === 'function') speak(`Включаю вариант номер ${idx+1}`);
    return true;
  }catch{return false;}
}

window.addEventListener('assistant:pro.suggest.result', (e)=>{
  try {
    const d = e?.detail || {}; const items = d.items || [];
    if (!items.length) { if (typeof addMsg==='function') addMsg('bot', 'Не нашёл длинных видео под запрос. Попробуем другой запрос?'); return; }
    if (typeof addMsg==='function') addMsg('bot', 'Нашёл варианты:');
    __addSuggestList(items, { type: d.type || 'movie' });
  } catch {}
});


  function dispatch(name, detail = {}) {
    const ev = new CustomEvent(`assistant:${name}`, { detail, bubbles: true, composed: true });
    window.dispatchEvent(ev);
    document.dispatchEvent(new CustomEvent(`assistant:${name}`, { detail, bubbles: true, composed: true }));
  }

  // ─── mix seeds ───────────────────────────────────────────────────────
  const MIX_SEEDS = [
    "lofi hip hop radio",
    "classic rock hits",
    "best jazz music relaxing",
    "indie rock playlist",
    "hip hop playlist",
    "edm house techno mix",
    "ambient music long playlist",
    "pop hits playlist",
    "latin hits playlist",
    "rnb soul classics playlist",
    "best reggae mix",
  ];
  let lastMixSeed = "";
  function randomMixSeed() {
    if (!MIX_SEEDS.length) return "music radio mix";
    let tries = 0,
      seed = MIX_SEEDS[(Math.random() * MIX_SEEDS.length) | 0];
    while (MIX_SEEDS.length > 1 && seed === lastMixSeed && tries < 6) {
      seed = MIX_SEEDS[(Math.random() * MIX_SEEDS.length) | 0];
      tries++;
    }
    lastMixSeed = seed;
    return seed;
  }
  function ensureMoodQuery(mood) {
    const m = String(mood || "").toLowerCase();
    if (m === "happy") return "upbeat feel good hits";
    if (m === "calm") return "lofi chill beats to relax";
    if (m === "sad") return "sad emotional songs playlist";
    if (m === "energetic") return "high energy workout rock mix";
    return "music radio mix";
  }
  function ensureGenreQuery(genre) {
    const g = String(genre || "").toLowerCase();
    const map = {
      джаз: "best jazz music relaxing",
      рок: "classic rock hits",
      поп: "pop hits playlist",
      электрон: "edm house techno mix",
      lofi: "lofi hip hop radio",
      классик: "classical symphony playlist",
      рэп: "hip hop playlist",
      инди: "indie rock playlist",
      ambient: "ambient music long playlist",
      блюз: "best blues songs playlist",
      шансон: "russian chanson mix",
      folk: "folk acoustic playlist",
      rnb: "rnb soul classics playlist",
      latin: "latin hits playlist",
      reggae: "best reggae mix",
      "k-pop": "kpop hits playlist",
      "j-pop": "jpop hits playlist",
      soundtrack: "movie soundtrack playlist",
    };
    return map[g] || `${g} music playlist`;
  }

  // ─── mood suggestions ────────────────────────────────────────────────
  const MOOD_SUGGEST = {
    ru: {
      calm: {
        genres: ["lofi", "ambient", "джаз", "чилаут", "неоклассика"],
        artists: ["Nujabes", "Bonobo", "Brian Eno", "Massive Attack", "Ludovico Einaudi"],
      },
      happy: {
        genres: ["поп", "инди-поп", "фанк", "диско"],
        artists: ["Dua Lipa", "Pharrell Williams", "Daft Punk", "Maroon 5", "Foster The People"],
      },
      sad: {
        genres: ["инди", "альт-рок", "акустика", "singer-songwriter"],
        artists: ["Radiohead", "Billie Eilish", "Coldplay", "Damien Rice", "Adele"],
      },
      energetic: {
        genres: ["рок", "панк", "EDM", "drum & bass"],
        artists: ["The Prodigy", "Skrillex", "Rage Against The Machine", "Linkin Park", "Pendulum"],
      },
    },
    uk: {
      calm: {
        genres: ["lofi", "ambient", "джаз", "чилаут", "неокласика"],
        artists: ["Nujabes", "Bonobo", "Brian Eno", "Massive Attack", "Ludovico Einaudi"],
      },
      happy: {
        genres: ["поп", "інді-поп", "фанк", "диско"],
        artists: ["Dua Lipa", "Pharrell Williams", "Daft Punk", "Maroon 5", "Foster The People"],
      },
      sad: {
        genres: ["інді", "альт-рок", "акустика", "singer-songwriter"],
        artists: ["Radiohead", "Billie Eilish", "Coldplay", "Damien Rice", "Adele"],
      },
      energetic: {
        genres: ["рок", "панк", "EDM", "drum & bass"],
        artists: ["The Prodigy", "Skrillex", "Rage Against The Machine", "Linkin Park", "Pendulum"],
      },
    },
    en: {
      calm: {
        genres: ["lofi", "ambient", "jazz", "chillout", "neoclassical"],
        artists: ["Nujabes", "Bonobo", "Brian Eno", "Massive Attack", "Ludovico Einaudi"],
      },
      happy: {
        genres: ["pop", "indie pop", "funk", "disco"],
        artists: ["Dua Lipa", "Pharrell Williams", "Daft Punk", "Maroon 5", "Foster The People"],
      },
      sad: {
        genres: ["indie", "alt rock", "acoustic", "singer-songwriter"],
        artists: ["Radiohead", "Billie Eilish", "Coldplay", "Damien Rice", "Adele"],
      },
      energetic: {
        genres: ["rock", "punk", "EDM", "drum & bass"],
        artists: ["The Prodigy", "Skrillex", "Rage Against The Machine", "Linkin Park", "Pendulum"],
      },
    },
  };

  // ─── NEXT with guard ─────────────────────────────────────────────────
  async function nextWithGuard() {
    let id = cQueue.take();
    if (!id && chat.lastQuery) {
      await cQueue.refill(chat.lastQuery);
      id = cQueue.take();
    }
    if (id) {
      dispatch("play", { id });
      return;
    }

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
        if (a.mood) chat.lastMood = a.mood;
        if (a.autoplay && (a.genre || a.mood || a.like)) {
          const q = a.like ? a.like : a.genre ? ensureGenreQuery(a.genre) : ensureMoodQuery(a.mood);
          chat.lastQuery = q;
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
         else if (a.action === "fullscreen") dispatch("fullscreen");
         else if (a.action === "exit-fullscreen") dispatch("exit-fullscreen");
      } else if (a?.type === "play" && (a.id || a.query)) {
        if (a.query) {
          chat.lastQuery = a.query;
          await cQueue.refill(a.query);
          const id = cQueue.take();
          if (id) {
            dispatch("play", { id });
            continue;
          }
        }
        dispatch("play", { id: a.id, query: a.query, exclude: recent.list(), shuffle: true });
        const idd = getYouTubeId(a.id || a.query);
        if (idd) {
          chat.lastIds = [idd];
          recent.add(idd);
          cQueue.dropCurrent(idd);
        }
      }
    }
  }

  function harvestIdsFromReply(txt = "") {
    const ids = new Set();
    const urlRe =
      /\bhttps?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})\b/g;
    let m;
    while ((m = urlRe.exec(txt))) ids.add(m[1]);
    const idRe = /\b([A-Za-z0-9_-]{11})\b/g;
    while ((m = idRe.exec(txt))) ids.add(m[1]);
    return Array.from(ids);
  }

  // ─── numbers-by-words → number ───────────────────────────────────────
  function parseNumberWords(str) {
    const s = String(str || "").toLowerCase().trim();
    if (!s) return null;
    const map = new Map(
      Object.entries({
        // RU
        "ноль": 0,
        "один": 1,
        "одна": 1,
        "одной": 1,
        "одну": 1,
        "два": 2,
        "две": 2,
        "три": 3,
        "четыре": 4,
        "пять": 5,
        "шесть": 6,
        "семь": 7,
        "восемь": 8,
        "девять": 9,
        "десять": 10,
        "одиннадцать": 11,
        "двенадцать": 12,
        "тринадцать": 13,
        "четырнадцать": 14,
        "пятнадцать": 15,
        "шестнадцать": 16,
        "семнадцать": 17,
        "восемнадцать": 18,
        "девятнадцать": 19,
        "двадцать": 20,
        "тридцать": 30,
        "сорок": 40,
        "пятьдесят": 50,
        "шестьдесят": 60,
        "полминуты": 30,
        "полчаса": 1800,
        "полторы": 1.5,
        "полтора": 1.5,
        "несколько": 5,
        "пару": 2,
        "пара": 2,
        // UK (минимальный набор)
        "нуль": 0,
        "дві": 2,
        "чотири": 4,
        "п’ять": 5,
        "вісім": 8,
        "дев’ять": 9,
        "кілька": 5,
        "півхвилини": 30,
        "півгодини": 1800,
        // EN
        "zero": 0,
        "one": 1,
        "two": 2,
        "three": 3,
        "four": 4,
        "five": 5,
        "six": 6,
        "seven": 7,
        "eight": 8,
        "nine": 9,
        "ten": 10,
        "eleven": 11,
        "twelve": 12,
        "thirteen": 13,
        "fourteen": 14,
        "fifteen": 15,
        "sixteen": 16,
        "seventeen": 17,
        "eighteen": 18,
        "nineteen": 19,
        "twenty": 20,
        "thirty": 30,
        "forty": 40,
        "fifty": 50,
        "sixty": 60,
        "half-minute": 30,
        "half an hour": 1800,
        "couple": 2,
        "few": 5,
      })
    );
    if (map.has(s)) return map.get(s);
    const tokens = s.split(/[\s-]+/g).filter(Boolean);
    let total = 0,
      had = false;
    for (const t of tokens) {
      if (map.has(t)) {
        total += map.get(t);
        had = true;
        continue;
      }
      const n = Number(t.replace(",", "."));
      if (!Number.isNaN(n)) {
        total += n;
        had = true;
      }
    }
    return had ? total : null;
  }

  // ─── Delay/After-current parsing (расширенный) ───────────────────────
  function toMs(n, unit) {
    const u = String(unit || "").toLowerCase().replace(/[.,;:!?)+\]\s]+$/g, "");
    if (/^час|h|hour/.test(u)) return n * 3600 * 1000;
    if (/^мин|m|min|minutes?/.test(u) || /^минут/.test(u)) return n * 60 * 1000;
    if (/^сек|s|sec|seconds?/.test(u) || /^секунд/.test(u)) return n * 1000;
    return n * 1000;
  }

  function parseDelaySpec(input = "") {
    const t = String(input || "").toLowerCase().replace(/[–—]/g, "-");

    const wantsPause = /(постав(ь|ить).+пауз|на пауз|пауз(а|у)\b|пауза\b|pause)/.test(t);
    const wantsStop = /(выключ|останов|стоп\b|stop)/.test(t);
    const op = wantsPause ? "pause" : wantsStop ? "stop" : null;

    const afterCurrent =
      /(после\s+(этой|текущей)\s+(песни|композиции|трека)|after\s+(this|current)\s+(song|track))/.test(t);

    // mm:ss
    let m = t.match(/(?:через|за)\s+(\d{1,2}):(\d{2})/);
    if (m) {
      const mm = Number(m[1] || 0),
        ss = Number(m[2] || 0);
      const ms = (mm * 60 + ss) * 1000;
      return { ms, afterCurrent: false, op: op || "pause" };
    }

    // перечисления/диапазоны: "через 10, 15, 20 секунд" / "через 15-20 секунд"
    m = t.match(
      /(?:через|за|на)\s+([0-9 ,.-]{1,20})\s*(сек(?:унд\w*)?|s|sec|seconds|мин(?:ут\w*)?|m|min|minutes|час(?:\w*)?|h|hour|hours)\b/i
    );
    if (m) {
      const seq = String(m[1]).split(/[^\d]+/).filter(Boolean).map(Number);
      const n = seq.length ? seq[seq.length - 1] : NaN;
      if (Number.isFinite(n)) return { ms: toMs(n, m[2]), afterCurrent: false, op: op || "pause" };
    }

    // цифрами: «через 10 секунд»
    m = t.match(/(?:через|за|на)\s+(\d{1,3})\s*([a-zа-яёіїє.]+)/i);
    if (m) {
      const n = Number(m[1]);
      const u = String(m[2] || "");
      if (!Number.isNaN(n)) return { ms: toMs(n, u), afterCurrent: false, op: op || "pause" };
    }

    // словами: «через десять секунд», «через одну минуту»
    m = t.match(/(?:через|за|на)\s+([a-zа-яёіїє \-]+)\s*([a-zа-яёіїє.]+)/i);
    if (m) {
      const num = parseNumberWords(m[1]);
      if (num !== null) return { ms: toMs(num, m[2]), afterCurrent: false, op: op || "pause" };
    }

    // неявная 1: «через минуту/секунду/час»
    m = t.match(/(?:через|за|на)\s*(минут[ауы]?|секунд[ауы]?|час[ауы]?)/i);
    if (m) return { ms: toMs(1, m[1]), afterCurrent: false, op: op || "pause" };

    if (afterCurrent) return { ms: null, afterCurrent: true, op: op || "stop" };
    return null;
  }

  // ─── Local intents (таймер/«после текущего»/хиты N часов) ────────────
  function tryAdvancedLocalIntents(traw) {
    const text = String(traw || "");
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
      addMsg(
        "bot",
        ds.op === "pause" ? "Ок, поставлю на паузу после текущего трека." : "Ок, выключу после текущего трека."
      );
      speak(ds.op === "pause" ? "Поставлю на паузу после текущего трека" : "Выключу после текущего трека");
      try {
        window.__AM_SLEEP_AFTER__ = true;
      } catch {}
      return true;
    }

    // «хиты <артист> на 2 часа»
    const reThisArtist = /(хит(?:ов|ы)|лучшие|best of|hits).*(этого артиста).*(\d{1,2}.*(час|мин))/i;
    const reNamed =
      /(хит(?:ов|ы)|лучшие|best of|hits)\s+([a-zа-яёіїє .'\-]+?)\s+(?:на|в течение|напротяжении)?\s*(\d{1,2}\s*(?:час|часа|часов|мин|минут|minutes?|hours?))/i;
    let artist = "",
      durStr = "";
    let m = text.toLowerCase().match(reThisArtist);
    if (m && chat.nowPlaying?.artist) {
      artist = chat.nowPlaying.artist;
      durStr = m[3] || "";
    } else {
      m = text.toLowerCase().match(reNamed);
      if (m) {
        artist = (m[2] || "").trim();
        durStr = (m[3] || "").trim();
      }
    }
    if (artist && durStr) {
      const ms = parseSleepDuration(durStr);
      if (ms) {
        const q = `${artist} greatest hits playlist`;
        chat.lastQuery = q;
        addMsg("bot", `Ок, хиты ${artist} — поехали. Выключу через ${Math.round(ms / 60000)} мин.`);
        speak(`Включаю хиты ${artist}. Выключу через ${Math.round(ms / 60000)} минут`);
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

  // ─── API (с автоповтором) ────────────────────────────────────────────
  async function fetchWithRetry(url, options = {}, tries = 2) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 20000);
        const r = await fetch(url, { ...options, signal: ctrl.signal });
        clearTimeout(t);
        // 502/503 часто бывают на «пробуждении»
        if (r.status === 502 || r.status === 503) throw new Error(`bad_gateway_${r.status}`);
        return r;
      } catch (e) {
        lastErr = e;
        if (i < tries - 1) await new Promise(res => setTimeout(res, 2000 * (i + 1)));
      }
    }
    throw lastErr;
  }

  async function callAI(message) {
    if (!API_BASE) return null;
    const r = await fetchWithRetry(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        history: chat.history,
        provider: providerToSend(),
        langHint: state.langPref,
      }),
    }, 2);
    if (!r.ok) throw new Error(`API ${r.status}`);
    return r.json();
  }

  async function handleUserText(text) {
    let v = String(text || "").trim();
    if (!v) return;

    // внешний препроцессор (без редактирования chat.js)
    try {
      if (window.Assistant?.preprocessText) {
        const res = window.Assistant.preprocessText(v);
        if (res && typeof res === "object" && res.handled) return;
        if (typeof res === "string") v = res;
      }
    } catch {}


// PRO longform intents (safe wrapper)
try {
  const raw = v;
  const low = raw.toLowerCase();

  // quick "pick #n"
  if (/\b(включи|поставь|запусти)\b/i.test(raw) && (/\b(№|#)?\s*\d{1,2}\b/.test(raw) || /(перв|втор|трет|четв|пят|шест|седьм|восьм|девят|десят)/i.test(raw))) {
    const ok = await __tryPickFromLast(raw);
    if (ok) return;
  }

  const hasMovie = /(\bфильм\b|\bфильмы\b|\bкино\b|\bmovie\b)/i.test(raw);
  const hasAudio = /(аудио\s*книг|audiobook)/i.test(raw);

  // infer mood/genre
  const genreMap = new Map([
    ['комед', 'комедия'],
    ['драм', 'драма'],
    ['боевик', 'боевик'],
    ['ужас', 'ужасы'],
    ['ромком', 'ромком'],
    ['триллер', 'триллер'],
    ['фантаст', 'фантастика'],
    ['приключ', 'приключения']
  ]);
  let inferredMood = '';
  for (const [k,v] of genreMap) { if (low.includes(k)) { inferredMood = v; break; } }
  if (!inferredMood && /весел|весёл|fun|смешн/i.test(low)) inferredMood = 'комедия';

  const needSuggest = /(вариант|подбери|предлож|посоветуй|порекомендуй|suggest|под настроение)/i.test(raw) || (!!inferredMood && !hasAudio);

  if (hasMovie || hasAudio || inferredMood) {
    const qm = raw.match(/["“”«»„‟']([^"“”«»„‟']{2,})["“”«»„‟']/);
    const titleQuoted = qm ? qm[1].trim() : "";

    let actor = "";
    const am = raw.match(/(?:\bс\s+(?:актером|актрисой)?\s*|\bwith\s+)([a-zа-яёіїє][\w'\-]+(?:\s+[a-zа-яёіїє][\w'\-]+){0,2})/i);
    if (am) actor = am[1].trim();

    let mood = "";
    let mm = raw.match(/под\s+настроени[ея]\s+([a-zа-яёіїє\- ]{3,})/i);
    if (!mm) mm = raw.match(/настроени[ея]\s+([a-zа-яёіїє\- ]{3,})/i);
    if (mm) mood = mm[1].trim();
    if (!mood && inferredMood) mood = inferredMood;

    let title = titleQuoted;
    if (!title) {
      const m2 = raw.match(/(?:фильм(?:ы)?|кино|audiobook|аудио\s*книга)\s+([^,;.!?]+)$/i);
      if (m2) {
        let t = m2[1];
        t = t.replace(/\s+с\s+.+$/i, "").replace(/\s+with\s+.+$/i, "");
        title = t.trim();
      }
    }

    const type = hasAudio ? "audiobook" : "movie";
    if (needSuggest) {
      window.dispatchEvent(new CustomEvent('assistant:pro.suggest', { detail: { type, title, mood, actor, limit: 12 } }));
      if (typeof addMsg==='function') addMsg("note", "Подбираю варианты…");
      if (typeof speak==='function') speak("Подбираю варианты");
      return;
    } else {
      window.dispatchEvent(new CustomEvent('assistant:pro.play', { detail: { type, title, mood, actor } }));
      if (typeof addMsg==='function') addMsg("note", "Ищу и включаю " + (type === "audiobook" ? "аудиокнигу…" : "фильм…"));
      if (typeof speak==='function') speak(type === "audiobook" ? "Ищу аудиокнигу" : "Ищу фильм");
      return;
    }
  }
} catch {}

    addMsg("user", v);

    // Локальный "что сейчас играет?"
    if (/(что\s+(сейчас\s+)?играет|что за трек|какой трек|what'?s\s+playing)/i.test(v)) {
      const np = chat.nowPlaying;
      const msg = np?.id
        ? np.title
          ? `Сейчас играет: ${np.title}`
          : (np.artist || np.song)
          ? `Сейчас играет: ${[np.artist, np.song].filter(Boolean).join(" - ")}`
          : "Сейчас что-то играет."
        : "Сейчас ничего не играет.";
      addMsg("bot", msg);
      speak(msg);
      return;
    }

    if (tryAdvancedLocalIntents(v)) return;

    // таймер авто-стоп/паузы в тексте
    const delaySpec = parseDelaySpec(v);
    const hasDelayWords = /(через|после\s+(этой|текущей))/i.test(v);
    const suppressImmediatePauseStop = !!(delaySpec && (delaySpec.ms || delaySpec.afterCurrent)) || hasDelayWords;
    const forcedNext = NEXT_RE.test(v);

    try {
      const data = await callAI(v);
      if (data && isStr(data.reply)) {
        const harvested = harvestIdsFromReply(data.reply);
        if (harvested.length) {
          chat.lastIds = harvested;
          harvested.forEach((id) => recent.add(id));
        }

        addMsg("bot", data.reply);
        speak(data.reply);

        let actions = Array.isArray(data.actions) ? data.actions : [];

        // SANITIZE: если пользователь сказал «пауза», заменяем любые stop-акшены модели на pause
        const askedPause = /\b(пауза|pause)\b/i.test(v);
        const askedStop = /\b(стоп|выключ|останов|stop)\b/i.test(v);
        if (askedPause && !askedStop && actions.length) {
          actions = actions.map((a) =>
            a?.type === "player" && a.action === "stop" ? { ...a, action: "pause" } : a
          );
        }

        if (forcedNext) {
          await nextWithGuard();
        } else if (actions.length) {
          // не делать немедленный pause/stop, если просили задержку
          if (suppressImmediatePauseStop) {
            actions = actions.filter(
              (a) => !(a?.type === "player" && (a.action === "stop" || a.action === "pause"))
            );
          }
          const aPlay = actions.find((a) => a.type === "play" && (a.id || a.query));
          if (aPlay) {
            const id = getYouTubeId(aPlay.id || aPlay.query);
            if (id) {
              chat.lastIds = [id];
              recent.add(id);
              cQueue.dropCurrent(id);
            }
            if (aPlay.query) chat.lastQuery = aPlay.query;
          }
          await runActions(actions);

          if (delaySpec?.ms) {
            const secs = Math.round(delaySpec.ms / 1000);
            addMsg(
              "note",
              delaySpec.op === "pause"
                ? `⏰ Поставлю на паузу через ~${secs} сек.`
                : `⏰ Выключусь через ~${secs} сек.`
            );
            scheduleActionLater(delaySpec.ms, delaySpec.op);
          } else if (delaySpec?.afterCurrent) {
            sleepAfterTrack = true;
            sleepAfterAction = delaySpec.op || "stop";
            clearSleepTimer();
            addMsg(
              "note",
              sleepAfterAction === "pause" ? "⏰ Пауза после текущего трека." : "⏰ Выключусь после текущего трека."
            );
            try {
              window.__AM_SLEEP_AFTER__ = true;
            } catch {}
          }
        } else {
          const localReply = await handleCommandLocal(v, /*suppressInstant*/ suppressImmediatePauseStop);
          addMsg("note", "[" + localReply + "]");
          if (delaySpec?.ms) scheduleActionLater(delaySpec.ms, delaySpec.op);
          else if (delaySpec?.afterCurrent) {
            sleepAfterTrack = true;
            sleepAfterAction = delaySpec.op || "stop";
            clearSleepTimer();
            addMsg(
              "note",
              sleepAfterAction === "pause" ? "⏰ Пауза после текущего трека." : "⏰ Выключусь после текущего трека."
            );
            try {
              window.__AM_SLEEP_AFTER__ = true;
            } catch {}
          }
        }

        if (isStr(data.explain)) addMsg("note", "[" + data.explain + "]");
        return;
      }
    } catch (e) {
      console.warn("AI API error", e);
    }

    const reply = await handleCommandLocal(v, /*suppressInstant*/ suppressImmediatePauseStop);
    addMsg("bot", reply);
    speak(reply);
  }

  // ─── local fallback for simple commands ──────────────────────────────
  async function handleCommandLocal(t, suppressInstantPauseStop = false) {
    const text = (t || "").toLowerCase();
    const wantsPlay = /включ|поставь|play|запусти|вруби|сыграй/.test(text);
    const hasDelayWords = /(через|после\s+(этой|текущей))/i.test(text);

    if (/list|список|лист ?вью/.test(text)) {
      dispatch("view", { mode: "list" });
      return "Включаю список";
    }
    if (/grid|сетка|карточк/.test(text)) {
      dispatch("view", { mode: "grid" });
      return "Включаю сетку";
    }

    if (NEXT_RE.test(text)) {
      await nextWithGuard();
      return "Следующий трек";
    }

    if (/prev|пред/.test(text)) {
      const before = chat.nowPlaying?.id || "";
      dispatch("player-prev");
      // Гард: если плеер вернул тот же ID — пробуем реальный предыдущий из недавних
      setTimeout(() => {
        const cur = chat.nowPlaying?.id || "";
        if (!cur || cur === before) {
          const arr = recent.list();
          const prevId = arr.length >= 2 ? arr[arr.length - 2] : "";
          if (prevId && prevId !== before) {
            dispatch("play", { id: prevId });
          }
        }
      }, 600);
      return "Предыдущий трек";
    }

    // Полноэкранный режим
    if (/(полный экран|на весь экран|fullscreen|full screen)/i.test(text)) {
      dispatch("fullscreen");
      return "Разворачиваю на весь экран";
    }
    if (/(выйди из полного|сверни экран|exit full|exit fullscreen|windowed)/i.test(text)) {
      dispatch("exit-fullscreen");
      return "Свернула из полного экрана";
    }

    // Мгновенные pause/stop — только если НЕ просили задержку
    if (!suppressInstantPauseStop && !hasDelayWords) {
      if (/\b(пауза|pause)\b/.test(text)) {
        dispatch("player-pause");
        markManualPauseGuard(); // 1 час по умолчанию
        return "Пауза";
      }
      if (/\b(стоп|выключи|останови|stop)\b/.test(text)) {
        dispatch("player-stop");
        return "Стоп";
      }
    }

    if (/(отмени|сбрось|cancel).*(таймер|timer)/.test(text)) {
      clearSleepTimer();
      sleepAfterTrack = false;
      manualPauseGuardUntil = 0;
      return "Таймер отменён";
    }

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
      manualPauseGuardUntil = 0;
      return "Играю";
    }

    if (/тише|quieter|volume down|поменьше/.test(text)) {
      dispatch("volume", { delta: -0.1 });
      return "Тише";
    }
    if (/громче|louder|volume up|погромче/.test(text)) {
      dispatch("volume", { delta: +0.1 });
      return "Громче";
    }
    if (/(mix ?radio|микс|радио|random)/.test(text)) {
      const seed = randomMixSeed();
      chat.lastQuery = seed;
      await cQueue.refill(seed);
      const id = cQueue.take();
      if (id) dispatch("play", { id });
      else dispatch("play", { query: seed, exclude: recent.list(), shuffle: true });
      manualPauseGuardUntil = 0;
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
        manualPauseGuardUntil = 0;
        return "Шукаю та вмикаю…";
      }
    }

    const moods = [
      { re: /(весел|радіс|радост|happy|joy)/, mood: "happy" },
      { re: /(спок|calm|chill|relax)/, mood: "calm" },
      { re: /(сум|sad|minor)/, mood: "sad" },
      { re: /(енерг|drive|бадьор|рок|rock|energy|energetic)/, mood: "energetic" },
    ];
    const m = moods.find((m) => m.re.test(text));
    if (m) {
      const q = ensureMoodQuery(m.mood);
      chat.lastQuery = q;

      if (wantsPlay) {
        await cQueue.refill(q);
        const id = cQueue.take();
        if (id) dispatch("play", { id });
        else dispatch("play", { query: q, exclude: recent.list(), shuffle: true });
        return "Підбираю та вмикаю…";
      } else {
        const dict = MOOD_SUGGEST[state.langPref] || MOOD_SUGGEST.ru;
        const sug = dict[m.mood];
        if (sug) {
          addMsg(
            "bot",
            state.langPref === "en"
              ? `For a ${m.mood} mood I can play genres: ${sug.genres.join(", ")}. Sample artists: ${sug.artists.join(
                  ", "
                )}. Say “play [genre/artist]” or “mix radio”.`
              : state.langPref === "uk"
              ? `Під ${m.mood} настрій можу запропонувати жанри: ${sug.genres.join(
                  ", "
                )}. Виконавці: ${sug.artists.join(
                  ", "
                )}. Скажи «включи [жанр/артиста]» або «мікс радіо».`
              : `Под ${m.mood} настроение могу предложить жанры: ${sug.genres.join(
                  ", "
                )}. Исполнители: ${sug.artists.join(
                  ", "
                )}. Скажи «включи [жанр/исполнителя]» или «микс радио».`
          );
          return "Підбираю під настрій";
        }
        return "Підбираю під настрій";
      }
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

  // ─── Mic + Wake word (с дебаунсом результатов SR) ────────────────────
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function isWakeOn() {
    return !!chkWake?.checked;
  }
  function wakePhrases() {
    return String(inpWake?.value || "")
      .toLowerCase()
      .split(/[,\|]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const micAgg = { buf: "", timer: null };
  const wakeAgg = { buf: "", timer: null };
  function debouncedPush(agg, phrase, delay = 800) {
    const s = String(phrase || "").trim();
    if (!s) return;
    agg.buf = agg.buf ? agg.buf + " " + s : s;
    clearTimeout(agg.timer);
    agg.timer = setTimeout(() => {
      const payload = agg.buf.trim();
      agg.buf = "";
      handleUserText(payload);
    }, delay);
  }

  let wakeRec = null,
    wakeStopReq = false,
    wakeRestartTimer = null;
  let wakePausedForMic = false,
    wakeActive = false,
    wakeLogShown = false;

  async function startWakeLoop(force = false) {
    if (!SR) {
      addMsg("note", "[Wake] Браузер не поддерживает распознавание речи.");
      return;
    }
    if (!isWakeOn() && !force) return;
    if (wakeActive && !force) return;

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
        if (!wakeLogShown) {
          addMsg("note", "[Wake] Фоновое прослушивание включено.");
          wakeLogShown = true;
        }
      };

      rec.onresult = (ev) => {
        const t = (ev.results?.[ev.results.length - 1]?.[0]?.transcript || "").toLowerCase().trim();
        const hot = wakePhrases().find((ph) => t.startsWith(ph) || t.includes(" " + ph + " "));
        if (hot) {
          let cmd = t;
          for (const ph of wakePhrases()) cmd = cmd.replace(new RegExp("^\\s*" + ph + "\\s*"), "").trim();
          if (!cmd) {
            addMsg("note", "[Wake] Слушаю.");
            return;
          }
          if (!wakeAgg.buf) clearTimeout(wakeAgg.timer);
          debouncedPush(wakeAgg, cmd, 800);
          return;
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
      addMsg("note", "[Wake] Не удалось запустить прослушивание.");
    }
  }

  function stopWakeLoop(silent = false) {
    wakeStopReq = true;
    clearTimeout(wakeRestartTimer);
    if (wakeRec) {
      try {
        wakeRec.onend = null;
        wakeRec.stop();
      } catch {}
      wakeRec = null;
    }
    wakeStopReq = false;
    wakeActive = false;
    if (!silent) {
      addMsg("note", "[Wake] Выключено.");
      wakeLogShown = false;
    }
  }

  if (chkWake) {
    chkWake.addEventListener("change", () => {
      if (isWakeOn()) startWakeLoop(true);
      else stopWakeLoop(false);
    });
  }
  if (inpWake) {
    inpWake.addEventListener("change", () => {
      if (SR && isWakeOn()) startWakeLoop(true);
    });
  }

  // Кнопка микрофона — разовый слушатель (коэкзистенция с wake)
  if (btnMic && SR) {
    btnMic.addEventListener("click", () => {
      try {
        if (isWakeOn() && wakeActive) {
          wakePausedForMic = true;
          stopWakeLoop(true);
        }

        const rec = new SR();
        rec.lang = codeToBCP47(state.langPref);
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        btnMic.classList.add("is-on");

        rec.onresult = (ev) => {
          // Берём последний финальный результат текущей сессии
          const t = (ev.results?.[ev.results.length - 1]?.[0]?.transcript || "");
          if (!micAgg.buf) clearTimeout(micAgg.timer);
          debouncedPush(micAgg, t, 800);
        };

        rec.onerror = () => {
          addMsg("bot", "Не вышло распознать голос");
        };
        rec.onend = () => {
          btnMic.classList.remove("is-on");
          if (isWakeOn()) {
            wakePausedForMic = false;
            startWakeLoop(true);
          }
        };
        rec.start();
      } catch {
        addMsg("bot", "Розпізнавач недоступний");
      }
    });
  }

  // ─── wiring ──────────────────────────────────────────────────────────
  root.querySelector(".assistant__toggle").addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });
  btnClose.addEventListener("click", () => {
    panel.hidden = true;
  });
  btnGear.addEventListener("click", () => {
    const s = root.querySelector(".assistant__settings");
    if (s) s.hidden = !s.hidden;
  });
  btnSend.addEventListener("click", () => {
    const t = inputEl.value;
    inputEl.value = "";
    handleUserText(t);
  });
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const t = inputEl.value;
      inputEl.value = "";
      handleUserText(t);
    }
  });

  // автозапуск wake-loop, если включён
  if (SR && isWakeOn()) startWakeLoop();

  // ─── лёгкие внешние хуки ─────────────────────────────────────────────
  window.Assistant = window.Assistant || {};
  window.Assistant.enqueueText = (txt) => handleUserText(String(txt || ""));
  window.Assistant.nowPlaying = () => ({ ...(chat.nowPlaying || {}) });
  // window.Assistant.preprocessText = (text) => text;
  // управляем wake-loop снаружи:
  window.Assistant.wake = {
    enable: () => { try { startWakeLoop(true); } catch {} },
    disable: () => { try { stopWakeLoop(true); } catch {} },
    isOn: () => { try { return !!chkWake?.checked; } catch { return false; } }
  };
})();
/* ====== PLAYER (карточка) ====== */
.am-player {
  position: fixed;
  left: 50%;
  right: auto;
  bottom: 128px;
  width: min(720px, 92vw);
  z-index: 9999;
  transform: translate(-50%, 12px);
  opacity: 0;
  pointer-events: none;
  transition:
    transform 160ms ease,
    opacity 160ms ease;
}
.am-player--active {
  transform: translateY(0) translateX(-50%);
  opacity: 1;
  pointer-events: auto;
}

/* Свободное позиционирование после drag (управляется JS) */
.am-player--free {
}

/* Карточка */
.am-player__inner {
  background: #111;
  color: #fff;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.5);
  position: relative;
}

/* Верхняя «шапка» для перетаскивания */
.am-player__dragzone {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 44px;
  z-index: 6;
  cursor: grab;
  touch-action: none;
  background: transparent;
}
.am-player__dragzone.dragging {
  cursor: grabbing;
}

.am-player__close,
.am-player__hide {
  position: absolute;
  z-index: 8;
  height: 32px;
  border-radius: 8px;
  border: 0;
  color: #fff;
  cursor: pointer;
}
.am-player__close {
  top: 8px;
  right: 8px;
  width: 32px;
  line-height: 32px;
  text-align: center;
  background: #764191;
}
.am-player__hide {
  top: 8px;
  right: 48px;
  padding: 0 10px;
  background: #3a2a4f;
}
.am-player__hide:hover,
.am-player__hide:focus-visible {
  filter: brightness(1.06);
  outline: none;
}

/* Видео-кадр */
.am-player__frame {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
}
.am-player__host,
.am-player__frame > div,
.am-player__frame iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}

.am-player__ytlink {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 7;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  text-decoration: none;
  font:
    600 12px/1 'IBM Plex Sans',
    system-ui,
    -apple-system,
    Segoe UI,
    Roboto,
    Arial,
    sans-serif;
}
.am-player__ytlink:hover {
  background: rgba(0, 0, 0, 0.6);
}

.am-player__bar {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  z-index: 5;
  display: grid;
  grid-template-columns: auto minmax(140px, 1fr) auto;
  gap: 10px;
  align-items: center;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  padding: 8px 10px;
  border-radius: 10px;
  box-sizing: border-box;
  cursor: default;
}

.am-player__left,
.am-player__right {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

/* Кнопки */
.am-player__skip,
.am-player__play,
.am-player__mute {
  cursor: pointer;
  border: none;
  background: #764191;
  color: #fff;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  line-height: 32px;
  text-align: center;
}

/* Время */
.am-player__time {
  color: #fff;
  font:
    500 13px/1.2 system-ui,
    -apple-system,
    Segoe UI,
    Roboto,
    Arial,
    sans-serif;
}

/* Центр: прогресс */
.am-player__progresswrap {
  min-width: 0;
  width: 100%;
}
.am-player__progress {
  width: 100%;
  max-width: 440px;
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  background: rgba(255, 255, 255, 0.35);
  border-radius: 999px;
  outline: none;
  margin: 0;
  vertical-align: middle;
  overflow: hidden;
}
.am-player__progress::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  border: 0;
  cursor: pointer;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.2);
}
.am-player__progress::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  border: 0;
  cursor: pointer;
}
.am-player__progress::-moz-range-track {
  height: 6px;
  background: rgba(255, 255, 255, 0.35);
  border: none;
  border-radius: 999px;
}

/* Правый блок: громкость фиксированной ширины */
.am-player__right .am-player__slider {
  flex: 0 0 120px;
  width: 120px;
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  background: rgba(255, 255, 255, 0.35);
  border-radius: 999px;
  outline: none;
  margin: 0;
  vertical-align: middle;
}
.am-player__right .am-player__slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  border: 0;
  cursor: pointer;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.2);
}
.am-player__right .am-player__slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  border: 0;
  cursor: pointer;
}
.am-player__right .am-player__slider::-moz-range-track {
  height: 6px;
  background: rgba(255, 255, 255, 0.35);
  border: none;
  border-radius: 999px;
}

/* Мобилка: ниже и уже громкость */
@media (max-width: 480px) {
  .am-player {
    bottom: 110px;
  }
  .am-player__right .am-player__slider {
    flex-basis: 96px;
    width: 96px;
  }
}

/* ====== Свёрнутый режим ====== */
.am-player--min .am-player__inner {
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 8px) scale(0.985);
  transition:
    transform 160ms ease,
    opacity 160ms ease;
}

/* ====== Пузырь ====== */
.am-player__bubble {
  position: fixed;
  z-index: 10000;
  left: auto;
  top: auto;
  right: auto;
  bottom: auto;

  width: 64px;
  height: 64px;
  border-radius: 999px;
  border: none;
  cursor: pointer;
  display: grid;
  place-items: center;

  color: var(--color-white, #fff);
  background: var(--color-affair, #764191);
  box-shadow:
    0 12px 28px rgba(0, 0, 0, 0.35),
    inset 0 0 0 1px rgba(255, 255, 255, 0.1);

  --amp: 1.06;
  --bpmDur: 520ms;
  animation: am-bubble-breathe var(--bpmDur) ease-in-out infinite;
}
.am-player__bubble .note {
  font:
    700 18px/1 'IBM Plex Sans',
    system-ui;
  transform: translateY(-1px);
}
.am-player__bubble::before,
.am-player__bubble::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 999px;
  box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.14);
  pointer-events: none;
  transform: scale(1);
  opacity: 0.9;
  animation: am-bubble-ring var(--bpmDur) linear infinite;
}
.am-player__bubble::after {
  animation-delay: calc(var(--bpmDur) / 2);
  opacity: 0.7;
}
.am-player__bubble.is-paused {
  animation-play-state: paused;
}
.am-player__bubble.is-paused::before,
.am-player__bubble.is-paused::after {
  animation-play-state: paused;
  opacity: 0.35;
}
@keyframes am-bubble-breathe {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(var(--amp));
  }
}
@keyframes am-bubble-ring {
  0% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.16);
  }
  60% {
    transform: scale(1.25);
    box-shadow: 0 0 0 10px rgba(255, 255, 255, 0.08);
  }
  100% {
    transform: scale(1.42);
    box-shadow: 0 0 0 18px rgba(255, 255, 255, 0);
  }
}
@media (max-width: 420px) {
  .am-player__bubble {
    width: 56px;
    height: 56px;
  }
}

/* --- iPhone/узкие: прогресс на вторую строку, кнопки отдельно --- */
@media (max-width: 480px) {
  .am-player__bar {
    grid-template-columns: 1fr auto;
    grid-template-areas:
      'left right'
      'prog prog';
    row-gap: 8px;
  }
  .am-player__left {
    grid-area: left;
  }
  .am-player__right {
    grid-area: right;
    justify-self: end;
  }
  .am-player__progresswrap {
    grid-area: prog;
  }

  /* гарантируем, что слайдер не вылезает за бар */
  .am-player__progresswrap {
    overflow: hidden;
  }
}

/* было: z-index: 10000; */
.am-player__bubble {
  z-index: 2147483647; /* абсолютный верх */
}

/* ===== Патч кликов/слоёв при сворачивании ===== */

/* База (как у тебя): док не ловит клики, пока не активирован */
.am-player {
  pointer-events: none;
}

/* Когда активен — ловит клики */
.am-player--active {
  pointer-events: auto;
}

/* КОГДА СВЁРНУТ (пузырь) — снова не ловим клики,
   иначе невидимый док блокирует интерфейс под собой на мобилке */
.am-player--active.am-player--min {
  pointer-events: none;
}

/* Визуально прячем внутренность дока при сворачивании */
.am-player--min .am-player__inner {
  opacity: 0;
  transform: translate(-50%, 8px) scale(0.985);
  pointer-events: none; /* подстраховка */
}

/* Пузырь: управляем видимостью классом (чтобы не мешал кликам, когда скрыт) */
.am-player__bubble {
  display: none;
}
.am-player__bubble.is-visible {
  display: grid;
}

/* На всякий случай: пузырь ВСЕГДА кликабелен поверх всего */
.am-player__bubble {
  z-index: 2147483647;
  pointer-events: auto;
}

/* разрешаем кастомные жесты без нативного скролла */
.am-player__bubble,
.am-player__dragzone {
  touch-action: none;
}

/* когда плеер свёрнут — клики проходят сквозь док, но не сквозь пузырь */
.am-player--min.am-player--patch-applied {
  pointer-events: none;
}
.am-player--min.am-player--patch-applied .am-player__bubble {
  pointer-events: auto;
}

/* мягкий «почти fullscreen», если API недоступен (iOS Safari для страниц) */
.app--fullscreen .am-player,
.app--fullscreen #root,
.app--fullscreen body {
  overflow: hidden;
}
.app--fullscreen .am-player {
  position: fixed;
  inset: 0;
  z-index: 9998;
}

.am-player__fs {
  position: absolute;
  top: 8px;
  right: 44px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.25);
  color: #e8f1ff;
  border-radius: 8px;
  padding: 0.2rem 0.45rem;
  cursor: pointer;
}
.am-player__fs:hover {
  border-color: rgba(255, 255, 255, 0.45);
}

/* чтобы абсолютные кнопки позиционировались изнутри */
.am-player__inner {
  position: relative;
}

/* кнопка Fullscreen (под Close) */
.am-player__fs {
  position: absolute;
  top: 48px; /* ниже верхнего ряда с Hide/× */
  right: 8px; /* выровнена с Close */
  z-index: 5; /* поверх iframe */
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.25);
  color: #e8f1ff;
  border-radius: 8px;
  padding: 0.2rem 0.45rem;
  cursor: pointer;
}
.am-player__fs:hover {
  border-color: rgba(255, 255, 255, 0.45);
}

/* === FULLSCREEN FIT for ultrawide / short-height displays (contain 16:9) === */
:root.assistant-fs-doc .assistant-fs,
.am-player:fullscreen,
.app--fullscreen .am-player {
  /* контейнер уже на весь экран */
}

:root.assistant-fs-doc .assistant-fs .am-player__inner,
.am-player:fullscreen .am-player__inner,
.app--fullscreen .am-player__inner {
  position: relative;
  display: grid;
  place-items: center;
  inline-size: 100vw; /* ширина */
  block-size: 100vh; /* высота */
  border-radius: 0;
  box-shadow: none;
  background: #000;
}

:root.assistant-fs-doc .assistant-fs .am-player__frame,
.am-player:fullscreen .am-player__frame,
.app--fullscreen .am-player__frame {
  /* contain: сохраняем всё видео в кадре без обрезки */
  inline-size: min(100vw, 177.7778vh); /* 16/9 * vh */
  block-size: min(56.25vw, 100vh); /* 9/16 * vw */
  margin: 0 auto;
}

:root.assistant-fs-doc .assistant-fs .am-player__bar,
.am-player:fullscreen .am-player__bar,
.app--fullscreen .am-player__bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding-bottom: env(safe-area-inset-bottom, 0);
  background: linear-gradient(to top, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0));
  z-index: 6;
}

