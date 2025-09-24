/* src/js/artists/features/player-patch.js
   Bridge Assistant <-> Player & Mini UI helpers
   v2.4.x + PRO-route guard for movies/audiobooks
   — no static import; resolve via window.Player to avoid Vite path issues
*/

/** tiny log */
const LOG = (...a) => { try { (console.debug||console.log).call(console, "[player-patch]", ...a) } catch {} };

/** ensure single mount */
let mounted = false;

/** simple de-dupe for noisy events */
const seen = new Set();
const dedup = (key, ttl = 800) => {
  const now = Date.now();
  for (const k of seen) {
    const ts = parseInt(k.split("|").pop(), 10);
    if (now - ts > ttl) seen.delete(k);
  }
  const stamp = now.toString();
  const full = `${key}|${stamp}`;
  if ([...seen].some(k => k.startsWith(`${key}|`))) return true;
  seen.add(full);
  setTimeout(() => seen.delete(full), ttl + 50);
  return false;
};

/** resolve Player safely (no import) */
function getPlayer() {
  try {
    if (typeof window !== "undefined" && window.Player) return window.Player;
  } catch {}
  // noop proxy (prevents crashes if Player ещё не загружен)
  const noop = () => {};
  return {
    open: noop, openQueue: noop, next: noop, prev: noop,
    play: noop, pause: noop, stop: noop,
    setVolume: noop, getVolume: () => 0.6,
    minimize: noop, expand: noop, isActive: () => false,
    isMinimized: () => false, hasQueue: () => false, close: noop,
    playSearch: noop, seekTo: noop,
  };
}

/* utils */
function on(evt, fn){ try { window.addEventListener(evt, (e)=>{ try { fn(e) } catch (err) {} }); } catch {} }
function toVideoId(v){
  const s = String(v||"").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s, location.href);
    if (/(^|\.)youtu\.be$/i.test(u.hostname)) {
      const cand = u.pathname.replace(/^\/+/, "");
      return /^[A-Za-z0-9_-]{11}$/.test(cand) ? cand : "";
    }
    const qv = u.searchParams.get("v");
    if (qv && /^[A-Za-z0-9_-]{11}$/.test(qv)) return qv;
    const m = u.pathname.match(/\/(?:embed|shorts|v)\/([^/?#]+)/i);
    if (m && m[1] && /^[A-Za-z0-9_-]{11}$/.test(m[1])) return m[1];
  } catch {}
  return "";
}

export default function mountPlayerPatch(player) {
  if (mounted) return;
  mounted = true;

  // resolve Player lazily
  player = player || getPlayer();

  const call = (fn, ...args) => {
    try { if (player && typeof player[fn] === "function") return player[fn](...args); }
    catch (e) { console.warn("[player-patch] call error", fn, e); }
  };

  // ---- assistant:play  ------------------------------------------------------
  // Раньше сразу уводил в YT search → «коротыши». Теперь — умный маршрут.
  window.addEventListener("assistant:play", (e) => {
    try {
      const d = e && e.detail || {};
      const rawId = d.id || d.videoId || d.url || d.source || "";
      const query = (typeof d.query === "string" ? d.query : (typeof d.title === "string" ? d.title : "")).trim();
      const mtype = (d.mediaType || d.type || "").trim().toLowerCase();

      const key    = "play|" + JSON.stringify({ rawId, query, mtype });
      if (dedup(key)) return;

      // 1) Явный тип: сразу в PRO и выходим
      if (mtype === "movie" || mtype === "audiobook") {
        try {
          window.dispatchEvent(new CustomEvent("assistant:pro.play", {
            detail: { type: mtype, title: query || rawId }
          }));
        } catch {}
        return;
      }

      // 2) ФАЗЗИ-ГАРД: нет id, но похоже на фильм/сериал/аудиокнигу → в PRO
      if (!rawId && query) {
        try {
          const low = query.toLowerCase();
          const isMovie = /(\bфильм(?:ы)?\b|\bкино\b|\bсериал(?:ы)?\b|\bmovie\b|\bseries\b)/i.test(low);
          const isAudio = /(\bаудио\s*книг(?:а|и|у)\b|\bкниг(?:а|и|у)\b|\baudiobook\b|\bаудио\b|\baudio\b)/i.test(low);
          if (isMovie || isAudio) {
            window.dispatchEvent(new CustomEvent("assistant:pro.play", {
              detail: { type: isAudio ? "audiobook" : "movie", title: query }
            }));
            return;
          }
        } catch {}
      }

      // 3) Музыка/прочее — старый безопасный путь
      const vid = toVideoId(rawId);
      if (vid) {
        call("open", vid);
      } else if (query && player.playSearch) {
        call("playSearch", query);
      } else if (rawId) {
        call("playSearch", String(rawId));
      }
    } catch (err) {
      console.warn("[assistant:play] handler error:", err);
    }
  });

  // ---- assistant:pro.play  --------------------------------------------------
  // PRO-ветка от longform/поиска: её обрабатывает longform-слой;
  // здесь — только "бридж-лог", чтобы понимать, что маршрут сработал.
  window.addEventListener("assistant:pro.play", async (e) => {
    const d = e && e.detail || {};
    try {
      if (!d || !d.title) return;
      LOG("assistant:pro.play bridged", d);
      // дальше всё делает pro-longform-server-search.js → карточки → Player.open/openQueue
    } catch (err) {
      console.warn("[assistant:pro.play] bridge error:", err);
    }
  });

  // ---- assistant:openQueue --------------------------------------------------
  window.addEventListener("assistant:openQueue", (e) => {
    try {
      const d = e && e.detail || {};
      const ids = Array.isArray(d?.ids) ? d.ids : [];
      if (ids.length) call("openQueue", ids, { shuffle:false, startIndex:0 });
    } catch (err) { console.warn("[assistant:openQueue] error", err); }
  });

  // ---- trivial controls -----------------------------------------------------
  on("assistant:pause", () => call("pause"));
  on("assistant:play.resume", () => call("play"));
  on("assistant:stop", () => call("stop"));
  on("assistant:next", () => call("next"));
  on("assistant:prev", () => call("prev"));
  on("assistant:minimize", () => call("minimize"));
  on("assistant:expand",   () => call("expand"));
  on("assistant:setVolume01", (e) => { const x = (e?.detail?.value ?? 0); call("setVolume", x); });

  LOG("mounted");
}
