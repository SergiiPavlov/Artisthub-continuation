/* eslint-env browser */
/* global YT */

/**
 * Mini YouTube player (superset, v2.3.5)
 *
 * Основы:
 * - server-search (/api/yt/search) → стабильная локальная очередь ID;
 * - fallback searchMode на YT search playlist (без локальной queue, рулит встроенная лента);
 * - open: мягкий fallback — невалидный ID трактуем как поисковый запрос;
 * - sleep-after-current: если window.__AM_SLEEP_AFTER__ === true → стоп после текущего трека;
 * - анти-зацикливание: smartNext для одиночных видео, stuck-guard при повторе одного и того же ID в searchMode,
 *   ротация поисковых вариантов (official audio / greatest hits / mix / base).
 *
 * Публичное API и события совместимы: openQueue, play, pause, stop, next, prev,
 * setVolume/getVolume, minimize/expand; события AM.player.* (ready/state/error/minimized/expanded/track).
 */

let _instance = null;

/* -------------------- Debug helper -------------------- */
function dbg(...a) {
  try {
    if (typeof window !== 'undefined' && window.__AM_DEBUG__ === true) {
      // eslint-disable-next-line no-console
      console.log('[player]', ...a);
    }
  } catch {}
}

/* -------------------- Events (совместимость) -------------------- */
function emit(name, detail = {}) {
  try { window.dispatchEvent(new CustomEvent(`AM.player.${name}`, { detail })); } catch {}
}

/* -------------------- YT API -------------------- */
function loadYTAPI() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (loadYTAPI._p) return loadYTAPI._p;
  loadYTAPI._p = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => rej(new Error("YT API load failed"));
    document.head.appendChild(s);
    const t = setTimeout(() => rej(new Error("YT API timeout")), 15000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(t); res(); };
  });
  return loadYTAPI._p;
}

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
function getYouTubeId(urlOrId) {
  if (!urlOrId) return "";
  const s = String(urlOrId).trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s, location.href);
    if (/(^|\.)youtu\.be$/i.test(u.hostname)) {
      const cand = u.pathname.replace(/^\/+/, "");
      return /^[A-Za-z0-9_-]{11}$/.test(cand) ? cand : "";
    }
    const v = u.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    const m = u.pathname.match(/\/(?:embed|shorts|v)\/([^/?#]+)/i);
    if (m && m[1] && /^[A-Za-z0-9_-]{11}$/.test(m[1])) return m[1];
  } catch { /* ignore */ }
  return "";
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const shuffleArr = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
function fmtTimeSec(sec) {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

/* -------------------- Server search support -------------------- */
const API_BASE =
  (import.meta?.env?.VITE_API_URL && import.meta.env.VITE_API_URL.replace(/\/+$/, "")) ||
  (location.hostname === "localhost" ? "http://localhost:8787" : "");

async function fetchYTSearchIds(q, max = 25) {
  if (!API_BASE) return [];
  try {
    const r = await fetch(`${API_BASE}/api/yt/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, max })
    });
    if (!r.ok) return [];
    const j = await r.json();
    const ids = Array.isArray(j?.ids) ? j.ids.filter(x => /^[A-Za-z0-9_-]{11}$/.test(x)) : [];
    dbg('server-search ids:', ids.length);
    return ids;
  } catch (e) {
    dbg('server-search error', e);
    return [];
  }
}

/* -------------------- Экспортируемая фабрика -------------------- */
export function createMiniPlayer() {
  if (_instance) return _instance;

  /* ---------- DOM ---------- */
  const dock = document.createElement("div");
  dock.className = "am-player";
  dock.innerHTML = `
    <div class="am-player__inner">
      <div class="am-player__dragzone" aria-hidden="true" title="Drag the player"></div>
      <button class="am-player__hide" type="button" aria-label="Hide">Hide</button>
      <button class="am-player__close" type="button" aria-label="Close">×</button>

      <div class="am-player__frame">
        <div class="am-player__host" id="am-player-host"></div>
        <a class="am-player__ytlink" href="#" target="_blank" rel="noopener noreferrer" aria-label="Open on YouTube">YouTube ↗</a>
      </div>

      <div class="am-player__bar">
        <div class="am-player__left">
          <button class="am-player__skip am-player__prev" type="button" aria-label="Previous">⏮</button>
          <button class="am-player__play" type="button" aria-label="Play/Pause">▶</button>
          <button class="am-player__skip am-player__next" type="button" aria-label="Next">⏭</button>
          <span class="am-player__time"><span class="am-player__cur">0:00</span> / <span class="am-player__dur">0:00</span></span>
        </div>

        <div class="am-player__progresswrap">
          <input class="am-player__progress" type="range" min="0" max="1000" value="0" step="1" aria-label="Seek">
        </div>

        <div class="am-player__right">
          <button class="am-player__mute" type="button" aria-label="Mute/Unmute">🔈</button>
          <input class="am-player__slider" type="range" min="0" max="100" value="60" step="1" aria-label="Volume">
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(dock);

  let bubble = null;

  // refs
  const host     = dock.querySelector("#am-player-host");
  const btnClose = dock.querySelector(".am-player__close");
  const btnHide  = dock.querySelector(".am-player__hide");
  const btnPlay  = dock.querySelector(".am-player__play");
  const btnPrev  = dock.querySelector(".am-player__prev");
  const btnNext  = dock.querySelector(".am-player__next");
  const btnMute  = dock.querySelector(".am-player__mute");
  const vol      = dock.querySelector(".am-player__slider");
  const prog     = dock.querySelector(".am-player__progress");
  const tCur     = dock.querySelector(".am-player__cur");
  const tDur     = dock.querySelector(".am-player__dur");
  const dragzone = dock.querySelector(".am-player__dragzone");
  const aYTlink  = dock.querySelector(".am-player__ytlink");

  /* ---------- state ---------- */
  let yt = null;
  let ready = false;
  let duration = 0;
  let timer = null;
  let muted = false;
  let volVal = 60;
  let userSeeking = false;

  let queue = [];
  let qi = -1;
  let loop = false;

  // searchMode — активен при фоллбэке на YT search playlist
  let searchMode = false;

  // анти-зацикливание
  let lastVidId = null;
  let sameIdPlays = 0;
  let lastQuery = '';
  let variantIndex = 0;
  let stuckTimer = null;
  let lastProgressT = 0;
  let lastProgressV = 0;

  const DOCK_KEY = "amPlayerPos";
  let dockDrag = null;

  const BUBBLE_KEY = "amBubblePos2";
  let bubbleDragging = false;
  let bubbleStart = null;
  let _bubblePos = null;

  // игнор клика сразу после drag
  let recentBubbleDrag = false;

  let watchdogId = null;
  let searchWatchdogId = null;

  if (isIOS) {
    vol.disabled = true;
    vol.title = "On iOS the volume is hardware-only";
  }

  /* ---------- UI helpers ---------- */
  function showBubble(useSaved = true) {
    if (!bubble) {
      bubble = document.createElement("button");
      bubble.className = "am-player__bubble is-paused";
      bubble.type = "button";
      bubble.setAttribute("aria-label", "Open player");
      bubble.style.display = "none";
      bubble.innerHTML = `<span class="note">♪</span>`;
      document.body.appendChild(bubble);

      // открывать только по «чистому» клику после драга
      bubble.addEventListener("click", (e) => {
        if (recentBubbleDrag) {
          recentBubbleDrag = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        uiMin(false);
      });

      bubble.addEventListener("pointerdown", (e) => {
        bubbleDragging = false;
        recentBubbleDrag = false;
        try { bubble.setPointerCapture(e.pointerId); } catch {}
        const r = bubble.getBoundingClientRect();
        bubbleStart = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
      });
      bubble.addEventListener("pointermove", (e) => {
        if (!bubbleStart) return;
        const dx = e.clientX - bubbleStart.x;
        const dy = e.clientY - bubbleStart.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) bubbleDragging = true;
        bubble.style.left = `${(bubbleStart.left + dx) | 0}px`;
        bubble.style.top  = `${(bubbleStart.top  + dy) | 0}px`;
      });
      bubble.addEventListener("pointerup", (e) => {
        try { bubble.releasePointerCapture(e.pointerId); } catch {}
        recentBubbleDrag = !!bubbleDragging;
        bubbleStart = null;
        bubbleDragging = false;
        clampBubbleToViewport(); persistBubblePos();
      });
      bubble.addEventListener("pointercancel", () => {
        recentBubbleDrag = !!bubbleDragging;
        bubbleStart = null;
        bubbleDragging = false;
      });
      window.addEventListener("resize", () => { clampBubbleToViewport(); persistBubblePos(); });
      window.visualViewport?.addEventListener("resize", () => { clampBubbleToViewport(); persistBubblePos(); });
      window.addEventListener("orientationchange", () => { clampBubbleToViewport(); persistBubblePos(); });
    }
    bubble.style.display = "grid";
    restoreBubblePos(useSaved);
  }
  function hideBubble() { if (bubble) bubble.style.display = "none"; }
  function setBubblePulse(isPlaying) {
    if (!bubble) return;
    bubble.classList.toggle("is-paused", !isPlaying);
  }
  function setBubbleAmp(v) {
    if (!bubble) return;
    const amp = 1.02 + (Math.max(0, Math.min(100, v)) / 100) * 0.08;
    bubble.style.setProperty("--amp", amp.toFixed(3));
  }
  function clampBubbleToViewport(margin = 8) {
    if (!bubble || bubble.style.display === "none") return;
    const w = window.innerWidth, h = window.innerHeight;
    const r = bubble.getBoundingClientRect();
    let left = clamp(r.left, margin, Math.max(margin, w - r.width - margin));
    let top  = clamp(r.top,  margin, Math.max(margin, h - r.height - margin));
    bubble.style.left = `${left}px`;
    bubble.style.top  = `${top}px`;
  }
  function persistBubblePos() {
    if (!bubble || bubble.style.display === "none") return;
    const r = bubble.getBoundingClientRect();
    const w = Math.max(1, window.innerWidth  - r.width);
    const h = Math.max(1, window.innerHeight - r.height);
    _bubblePos = { rx: clamp(r.left / w, 0, 1), ry: clamp(r.top / h, 0, 1) };
    try { localStorage.setItem(BUBBLE_KEY, JSON.stringify(_bubblePos)); } catch {}
  }
  function restoreBubblePos(useSaved = true) {
    if (!bubble) return;
    const r0 = bubble.getBoundingClientRect();
    let left, top;
    if (useSaved) {
      try {
        const pos = JSON.parse(localStorage.getItem(BUBBLE_KEY) || "null");
        if (pos && Number.isFinite(pos.rx) && Number.isFinite(pos.ry)) {
          const w = Math.max(1, window.innerWidth  - r0.width);
          const h = Math.max(1, window.innerHeight - r0.height);
          left = clamp(Math.round(pos.rx * w), 8, w);
          top  = clamp(Math.round(pos.ry * h), 8, h);
        }
      } catch {}
    }
    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      const w = window.innerWidth, h = window.innerHeight;
      const size = r0.width || 64;
      left = Math.max(8, Math.round((w - size) / 2));
      top  = Math.max(8, Math.round(h - size - 24));
    }
    bubble.style.left = `${left}px`;
    bubble.style.top  = `${top}px`;
    clampBubbleToViewport();
  }

  function uiPlayIcon(isPlaying) { btnPlay.textContent = isPlaying ? "⏸" : "▶"; }
  function uiMuteIcon(isMuted)   { btnMute.textContent = isMuted ? "🔇" : "🔈"; }

  function uiShow(on) {
    dock.classList.toggle("am-player--active", !!on);
    const isMin = dock.classList.contains("am-player--min");
    if (on) {
      if (!isMin) hideBubble();
    } else {
      hideBubble();
    }
    emit("state", { active: !!on });
  }
  function uiMin(on) {
    dock.classList.toggle("am-player--min", !!on);
    if (on) showBubble(true);
    else hideBubble();
    emit(on ? "minimized" : "expanded", {});
  }

  function uiSetTime(cur, dur) {
    tCur.textContent = fmtTimeSec(cur);
    tDur.textContent = fmtTimeSec(dur);
    if (!userSeeking) {
      const v = dur > 0 ? Math.round((cur / dur) * 1000) : 0;
      prog.value = String(v);
    }
  }
  function clearTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function startTimer() {
    clearTimer();
    timer = setInterval(() => {
      if (!ready || !yt || typeof yt.getCurrentTime !== "function") return;
      const cur = yt.getCurrentTime() || 0;
      const dur = duration || yt.getDuration() || 0;
      duration = dur;
      uiSetTime(cur, dur);
      // для прогресс-сторожка
      lastProgressT = Date.now();
      lastProgressV = cur;
    }, 250);
  }
  function clearWatchdog() { if (watchdogId) { clearTimeout(watchdogId); watchdogId = null; } }
  function clearSearchWatch() { if (searchWatchdogId) { clearTimeout(searchWatchdogId); searchWatchdogId = null; } }
  function clearStuckGuard() { if (stuckTimer) { clearTimeout(stuckTimer); stuckTimer = null; } }

  /* ---------- helpers around YT playlist ---------- */
  function hydrateFromYTPlaylist() {
    // В searchMode не трогаем локальную очередь — рулит лента YT
    if (searchMode) return;
    if (!yt || typeof yt.getPlaylist !== "function") return;
    try {
      const pl = yt.getPlaylist() || [];
      if (Array.isArray(pl) && pl.length) {
        queue = pl.slice();
        qi = typeof yt.getPlaylistIndex === "function" ? (yt.getPlaylistIndex() | 0) : 0;
      }
    } catch {}
  }

  /* ---------- Stuck helpers ---------- */
  const VARIANTS = (base) => [
    `${base} official audio`,
    `${base} greatest hits playlist`,
    `${base} mix`,
    `${base}`
  ];

  function armStuckGuard() {
    clearStuckGuard();
    stuckTimer = setTimeout(() => {
      try {
        const s = yt?.getPlayerState?.();
        const cur = yt?.getCurrentTime?.() || 0;
        const idle = Date.now() - (lastProgressT || 0);
        // Если 6+ секунд "PLAYING", но прогресс почти не двинулся — толкнём next()
        if (s === YT.PlayerState.PLAYING && idle > 6000 && Math.abs(cur - (lastProgressV || 0)) < 1) {
          dbg('stuck-guard: forcing next');
          if (searchMode) yt?.nextVideo?.(); else smartNextFromCurrent();
        }
      } catch {}
    }, 7000);
  }

  function markIdAndMaybeRotate(id) {
    if (!id) return;
    if (id === lastVidId) sameIdPlays++;
    else { lastVidId = id; sameIdPlays = 1; }
    dbg('PLAYING id:', id, 'same plays:', sameIdPlays, 'searchMode:', searchMode);

    // В searchMode, если трижды подряд один и тот же ID — попробуем next, затем сменим вариант запроса
    if (searchMode && sameIdPlays >= 3) {
      sameIdPlays = 0; // не бесконечно
      dbg('dup id → next/rotate');
      yt?.nextVideo?.();
      setTimeout(() => {
        try {
          const curId = yt?.getVideoData?.()?.video_id || '';
          if (curId === id && lastQuery) {
            variantIndex = (variantIndex + 1) % VARIANTS(lastQuery).length;
            const alt = VARIANTS(lastQuery)[variantIndex];
            dbg('rotate variant →', alt);
            playSearch(alt);
          }
        } catch {}
      }, 1200);
    }
  }

  /* ---------- YT ---------- */
  function skipWithDelay(ms = 2000) { setTimeout(autoNext, ms); }

  async function ensureYT(initialVideoId) {
    await loadYTAPI();
    if (yt) { try { yt.destroy(); } catch {} yt = null; }
    host.innerHTML = `<div id="am-player-yt"></div>`;
    yt = new YT.Player("am-player-yt", {
      host: "https://www.youtube-nocookie.com",
      videoId: initialVideoId || undefined,
      playerVars: { autoplay: initialVideoId ? 1 : 0, rel: 0, modestbranding: 1, controls: 1, enablejsapi: 1, origin: location.origin },
      events: {
        onReady: () => {
          ready = true;
          duration = yt.getDuration() || 0;
          uiSetTime(0, duration);
          if (!isIOS && typeof yt.setVolume === "function") yt.setVolume(volVal);
          if (muted && yt.mute) yt.mute();
          uiPlayIcon(!!initialVideoId);
          setBubblePulse(!!initialVideoId);
          setBubbleAmp(volVal);
          startTimer();
          emit("ready", {});
          armStuckGuard();

          clearWatchdog();
          if (initialVideoId) {
            watchdogId = setTimeout(() => {
              try {
                if (yt && yt.getPlayerState && yt.getPlayerState() !== YT.PlayerState.PLAYING) {
                  setBubblePulse(false);
                  skipWithDelay(0);
                }
              } catch {}
            }, 6000);
          }
        },
        onStateChange: (e) => {
          emit("state", { state: e.data });

          if (e.data === YT.PlayerState.PLAYING) {
            clearWatchdog();
            clearSearchWatch();
            armStuckGuard();
            uiPlayIcon(true);
            setBubblePulse(true);
            startTimer();
            try {
              const url = yt.getVideoUrl?.();
              if (url) aYTlink.href = url;
              const vd = yt.getVideoData?.();
              if (vd && vd.video_id) {
                emit("track", { id: vd.video_id, title: vd.title || "" });
                markIdAndMaybeRotate(vd.video_id);
              }
              hydrateFromYTPlaylist();
            } catch {}
          } else if (e.data === YT.PlayerState.PAUSED) {
            uiPlayIcon(false);
            setBubblePulse(false);
            clearTimer();
            emit("pause", {});
          } else if (e.data === YT.PlayerState.ENDED) {
            uiPlayIcon(false);
            setBubblePulse(false);
            clearTimer();
            clearWatchdog();
            clearStuckGuard();
            emit("ended", {});
            // ⏰ Sleep-after-current: если стоит флаг — останавливаемся вместо next
            if (window.__AM_SLEEP_AFTER__) {
              try { window.__AM_SLEEP_AFTER__ = false; } catch {}
              stop();
              return;
            }
            autoNext();
          }
        },
        onError: (e) => {
          emit("error", { code: e?.data || 'unknown' });
          dbg('YT error', e?.data);
          uiPlayIcon(false);
          setBubblePulse(false);
          clearTimer();
          clearWatchdog();
          clearSearchWatch();
          clearStuckGuard();
          skipWithDelay(1200);
        }
      }
    });
  }

  /* ---------- Очередь ---------- */
  async function playByIndex(idx, opts = {}) {
    if (!queue.length) return;
    // Любой явный переход по индексам — локальная очередь → выключаем searchMode
    searchMode = false;

    qi = clamp(idx, 0, queue.length - 1);
    const id = queue[qi];
    if (!id || !/^[\w-]{11}$/.test(id)) {
      return skipWithDelay(0);
    }
    aYTlink.href = `https://www.youtube.com/watch?v=${id}`;

    const reveal = opts.reveal ?? true;
    if (reveal) {
      uiMin(false);
      uiShow(true);
      restoreDockPos();
    } else {
      if (!dock.classList.contains("am-player--active")) uiShow(true);
    }

    ready = false; duration = 0; clearTimer(); clearWatchdog(); clearStuckGuard();
    try { await ensureYT(id); } catch { skipWithDelay(1200); }
  }

  function autoNext() {
    if (queue.length && !searchMode) {
      if (qi < queue.length - 1) playByIndex(qi + 1, { reveal: false });
      else if (loop) playByIndex(0, { reveal: false });
      else if (yt && yt.nextVideo) yt.nextVideo();
    } else if (yt && yt.nextVideo) {
      // В searchMode всегда доверяем встроенному плейлисту Youtube
      yt.nextVideo();
      armStuckGuard();
    }
  }

  /* ---------- Перетаскивание ДОКА ---------- */
  function getVP() {
    const w = window.visualViewport?.width || document.documentElement.clientWidth || window.innerWidth;
    const h = window.visualViewport?.height || document.documentElement.clientHeight || window.innerHeight;
    return { w, h };
  }
  function clampDock() {
    if (!dock.classList.contains("am-player--free")) return;
    const rect = dock.getBoundingClientRect();
    const { w, h } = getVP();
    let left = clamp(rect.left, 8, Math.max(8, w - rect.width - 8));
    let top  = clamp(rect.top,  8, Math.max(8, h - rect.height - 8));
    dock.style.left = `${left}px`;
    dock.style.top  = `${top}px`;
    try { localStorage.setItem(DOCK_KEY, JSON.stringify({ left, top })); } catch {}
  }
  function restoreDockPos() {
    let pos = null;
    try { pos = JSON.parse(localStorage.getItem(DOCK_KEY) || "null"); } catch {}
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
      dock.classList.add("am-player--free");
      dock.style.transform = "none";
      dock.style.left = `${pos.left}px`;
      dock.style.top  = `${pos.top}px`;
      dock.style.right = "auto";
      dock.style.bottom = "auto";
      clampDock();
    } else {
      dock.classList.remove("am-player--free");
      dock.style.left = dock.style.top = dock.style.right = dock.style.bottom = "";
      dock.style.transform = "";
    }
  }
  function beginDockDrag(e) {
    if (!dock.classList.contains("am-player--free")) {
      const r = dock.getBoundingClientRect();
      dock.classList.add("am-player--free");
      dock.style.transform = "none";
      dock.style.left = `${r.left}px`;
      dock.style.top  = `${r.top}px`;
      dock.style.right = "auto";
      dock.style.bottom = "auto";
    }
    dockDrag = {
      startX: e.clientX,
      startY: e.clientY,
      baseLeft: parseFloat(dock.style.left || "0"),
      baseTop:  parseFloat(dock.style.top || "0"),
    };
    dragzone.classList.add("dragging");
    try { dragzone.setPointerCapture?.(e.pointerId); } catch {}
  }
  function moveDockDrag(e) {
    if (!dockDrag) return;
    let left = dockDrag.baseLeft + (e.clientX - dockDrag.startX);
    let top  = dockDrag.baseTop  + (e.clientY - dockDrag.startY);
    const r = dock.getBoundingClientRect();
    const { w, h } = getVP();
    left = clamp(left, 8, Math.max(8, w - r.width - 8));
    top  = clamp(top,  8, Math.max(8, h - r.height - 8));
    dock.style.left = `${left}px`;
    dock.style.top  = `${top}px`;
  }
  function endDockDrag(e) {
    if (!dockDrag) return;
    try { dragzone.releasePointerCapture?.(e.pointerId); } catch {}
    dragzone.classList.remove("dragging");
    dockDrag = null;
    clampDock();
  }
  dragzone.addEventListener("pointerdown", beginDockDrag);
  window.addEventListener("pointermove", moveDockDrag);
  window.addEventListener("pointerup", endDockDrag);
  window.addEventListener("resize", clampDock);
  window.visualViewport?.addEventListener("resize", clampDock);
  window.addEventListener("orientationchange", clampDock);

  /* ---------- Кнопки UI ---------- */
  btnClose.addEventListener("click", () => {
    try { yt?.stopVideo?.(); yt?.destroy?.(); } catch {}
    yt = null; ready = false; duration = 0; clearTimer(); clearWatchdog(); clearSearchWatch(); clearStuckGuard();
    uiShow(false); uiMin(false);
    queue = []; qi = -1;
    searchMode = false;
    lastVidId = null; sameIdPlays = 0; lastQuery = ''; variantIndex = 0;
    setBubblePulse(false);
  });
  btnHide.addEventListener("click", () => { uiMin(true); });

  aYTlink.addEventListener("click", () => {
    try { yt?.stopVideo?.(); yt?.destroy?.(); } catch {}
    yt = null; ready = false; duration = 0; clearTimer(); clearWatchdog(); clearSearchWatch(); clearStuckGuard();
    uiShow(false); uiMin(false);
    queue = []; qi = -1;
    searchMode = false;
    lastVidId = null; sameIdPlays = 0; lastQuery = ''; variantIndex = 0;
    setBubblePulse(false);
  });

  btnPlay.addEventListener("click", () => {
    if (!ready || !yt) return;
    const s = yt.getPlayerState ? yt.getPlayerState() : -1;
    if (s === YT.PlayerState.PLAYING) { yt.pauseVideo?.(); uiPlayIcon(false); setBubblePulse(false); }
    else { yt.playVideo?.(); uiPlayIcon(true); setBubblePulse(true); armStuckGuard(); }
  });
  btnPrev.addEventListener("click", () => {
    if (queue.length && !searchMode) { playByIndex(qi > 0 ? qi - 1 : (loop ? queue.length - 1 : 0), { reveal: true }); }
    else { yt?.previousVideo?.(); armStuckGuard(); }
  });
  btnNext.addEventListener("click", () => {
    next();
  });

  btnMute.addEventListener("click", () => {
    if (!yt) return;
    muted = !muted;
    if (muted) yt.mute?.(); else yt.unMute?.();
    uiMuteIcon(muted);
  });
  vol.addEventListener("input", () => {
    const v = Number(vol.value) || 0;
    volVal = v;
    if (!isIOS) yt?.setVolume?.(v);
    if (v === 0 && !muted) { muted = true; yt?.mute?.(); uiMuteIcon(true); }
    else if (v > 0 && muted) { muted = false; yt?.unMute?.(); uiMuteIcon(false); }
    setBubbleAmp(v);
  });
  prog.addEventListener("input", () => {
    userSeeking = true;
    const v = Number(prog.value) || 0;
    const sec = duration > 0 ? (v / 1000) * duration : 0;
    tCur.textContent = fmtTimeSec(sec);
  });
  prog.addEventListener("change", () => {
    userSeeking = false;
    if (!yt || !duration) return;
    const v = Number(prog.value) || 0;
    const sec = (v / 1000) * duration;
    yt.seekTo?.(sec, true);
  });

  /* ---------- Публичное API ---------- */
  async function open(urlOrId) {
    const id = getYouTubeId(urlOrId);
    if (!id) {
      // Мягкий fallback: если пришёл невалидный ID/URL — трактуем как поиск
      const q = String(urlOrId || "").trim();
      if (q) return playSearch(q);
      return;
    }
    searchMode = false;
    lastQuery = ''; variantIndex = 0;
    queue = [id]; qi = 0;
    uiMin(false); uiShow(true); restoreDockPos();
    await playByIndex(0, { reveal: true });
  }

  async function openQueue(list, opts = {}) {
    const ids = (list || []).map(getYouTubeId).filter(Boolean);
    if (!ids.length) return;
    searchMode = false;
    lastQuery = ''; variantIndex = 0;
    loop = !!opts.loop;
    const arr = opts.shuffle ? shuffleArr(ids) : ids.slice();
    queue = arr;
    const start = clamp(Number(opts.startIndex ?? 0) || 0, 0, queue.length - 1);
    uiMin(false); uiShow(true); restoreDockPos();
    await playByIndex(start, { reveal: true });
  }

  async function smartNextFromCurrent() {
    try {
      const vd = yt?.getVideoData?.();
      const title = (vd?.title || "").trim();
      const author = (vd?.author || "").trim();
      const artist = title.includes('-') ? title.split('-')[0].trim() : author;
      if (artist) {
        dbg('smartNextFromCurrent(): re-search by', artist);
        await playSearch(artist);
      } else if (author) {
        await playSearch(author);
      }
    } catch (e) {
      dbg('smartNextFromCurrent() failed', e);
    }
  }

  function next() {
    if (queue.length && !searchMode) {
      const reveal = !dock.classList.contains("am-player--min");
      playByIndex(qi < queue.length - 1 ? qi + 1 : (loop ? 0 : qi), { reveal });
    } else {
      if (searchMode) {
        yt?.nextVideo?.();
        armStuckGuard();
      } else {
        // одиночное видео без плейлиста → «умный next»
        smartNextFromCurrent();
      }
    }
  }
  function prev() {
    if (queue.length && !searchMode) {
      const reveal = !dock.classList.contains("am-player--min");
      playByIndex(qi > 0 ? qi - 1 : (loop ? queue.length - 1 : 0), { reveal });
    } else {
      yt?.previousVideo?.();
      armStuckGuard();
    }
  }

  function play() {
    if (yt && ready) { yt.playVideo?.(); uiPlayIcon(true); setBubblePulse(true); armStuckGuard(); return; }
    if (queue.length && !searchMode) { playByIndex(qi < 0 ? 0 : qi, { reveal: false }); return; }
  }
  function pause() {
    try { yt?.pauseVideo?.(); } catch {}
    uiPlayIcon(false); setBubblePulse(false);
  }
  function stop() {
    try { yt?.stopVideo?.(); } catch {}
    uiPlayIcon(false); setBubblePulse(false);
  }
  function setVolume01(x) {
    const v = clamp(Math.round((Number(x)||0)*100), 0, 100);
    volVal = v; vol.value = String(v);
    if (!isIOS) yt?.setVolume?.(v);
    if (v === 0 && !muted) { muted = true; yt?.mute?.(); uiMuteIcon(true); }
    else if (v > 0 && muted) { muted = false; yt?.unMute?.(); uiMuteIcon(false); }
    setBubbleAmp(v);
  }
  function getVolume01() { return (volVal||0)/100; }
  function minimize()     { if (dock.classList.contains("am-player--active")) uiMin(true); }
  function expand()       { uiMin(false); uiShow(true); restoreDockPos(); }

  function isActive()     { return dock.classList.contains("am-player--active"); }
  function isMinimized()  { return isActive() && dock.classList.contains("am-player--min"); }
  function hasQueue()     { return Array.isArray(queue) && queue.length > 0; }
  function close()        { btnClose.click(); }

  async function playSearch(query) {
    const q = String(query || "").trim();
    if (!q) return;
    uiMin(false); uiShow(true); restoreDockPos();

    // сброс анти-зацикливателя под новый запрос
    lastQuery = q; variantIndex = 0; sameIdPlays = 0; lastVidId = null;

    // 1) Пробуем серверный поиск (стабильная очередь ID)
    const ids = await fetchYTSearchIds(q, 25);
    if (ids.length > 1) {
      await openQueue(ids, { shuffle: false, startIndex: 0 });
      return;
    } else if (ids.length === 1) {
      await open(ids[0]);
      return;
    }

    // 2) Фоллбэк — YT search playlist + searchMode
    searchMode = true;
    queue = []; qi = -1; // локальную очередь не используем
    await ensureYT(null);
    try {
      yt.loadPlaylist({ listType: "search", list: q, index: 0 });
      yt.playVideo?.();
      clearSearchWatch();
      searchWatchdogId = setTimeout(() => {
        // НЕ гидратируем queue в searchMode — оставляем YouTube рулить лентой
        try {
          const st = yt.getPlayerState?.();
          if (st !== YT.PlayerState.PLAYING) yt.playVideo?.();
        } catch {}
      }, 1000);
      aYTlink.href = "#";
      uiPlayIcon(true);
      setBubblePulse(true);
      startTimer();
      armStuckGuard();
    } catch (e) {
      dbg("[player.playSearch] loadPlaylist failed, try cuePlaylist()", e);
      try { yt.cuePlaylist?.({ listType: "search", list: q, index: 0 }); yt.playVideo?.(); armStuckGuard(); } catch {}
    }
  }

  _instance = {
    open, openQueue, next, prev,
    play, pause, stop, setVolume: setVolume01, getVolume: getVolume01, expand,
    minimize, isActive, isMinimized, hasQueue, close,
    playSearch
  };
  return _instance;
}

/* ---------- ДЕФОЛТНЫЙ ЭКСПОРТ: фасад Player ---------- */
function get() { return _instance || createMiniPlayer(); }

const Player = {
  open:       (x) => get().open(x),
  openQueue:  (l,o) => get().openQueue(l,o),
  next:       () => get().next(),
  prev:       () => get().prev(),
  play:       () => get().play(),
  pause:      () => get().pause(),
  stop:       () => get().stop(),
  setVolume:  (x) => get().setVolume(x),
  getVolume:  () => get().getVolume(),
  minimize:   () => get().minimize(),
  expand:     () => get().expand(),
  isActive:   () => get().isActive(),
  isMinimized:() => get().isMinimized(),
  hasQueue:   () => get().hasQueue(),
  close:      () => get().close(),
  playSearch: (q) => get().playSearch(q),
};

export default Player;

// Глобалка для консоли и внешних скриптов
if (typeof window !== 'undefined') { window.Player = Player; }


