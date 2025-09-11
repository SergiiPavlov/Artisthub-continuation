/*
  player-patch.js — patch-v1.4.0-2025-09-09
  Мост assistant:* ↔ публичное API плеера.
  Важно: не ломаем контракт событий и Player API.
*/

export default function mountPlayerPatch(player) {
  try { window.__AM_PLAYER_PATCH_INSTALLED__ = true; } catch {}

  if (!player || typeof player !== "object") {
    console.warn("[player-patch] No player instance provided");
    return;
  }

  const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

  // Разбор ID/URL
  function toVideoId(urlOrId) {
    const s = String(urlOrId || "").trim();
    if (!s) return "";
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    try {
      const u = new URL(s, location.href);
      if (/(^|\.)youtu\.be$/i.test(u.hostname)) {
        const cand = u.pathname.replace(/^\/+/, "");
        return /^[A-Za-z0-9_-]{11}$/.test(cand) ? cand : "";
      }
      const v = u.searchParams.get("v");
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/\/(?:embed|v|shorts)\/([^/?#]+)/i);
      if (m && m[1] && /^[A-Za-z0-9_-]{11}$/.test(m[1])) return m[1];
    } catch {}
    return "";
  }

  const MIX_SEEDS = [
    "random music mix",
    "popular hits playlist",
    "indie rock mix",
    "classic rock hits",
    "lofi chill beats to relax",
    "jazz essentials playlist",
    "hip hop classic mix",
    "ambient focus music long"
  ];

  const call = (name, ...args) => {
    const fn = player?.[name];
    if (typeof fn === "function") {
      try { return fn.apply(player, args); }
      catch (e) { console.warn(`[player-patch] ${name} failed`, e); }
    }
  };

  // Антидубль
  const recently = new Map();
  function dedup(key, ttl = 350) {
    const now = Date.now();
    const last = recently.get(key) || 0;
    if (now - last < ttl) return true;
    recently.set(key, now);
    return false;
  }

  // === PLAY ===
  window.addEventListener("assistant:play", (e) => {
    const rawId  = e?.detail?.id ?? "";
    const query  = e?.detail?.query ?? "";
    const key    = "play|" + JSON.stringify({ rawId, query });
    if (dedup(key)) return;

    const vid = toVideoId(rawId);
    if (vid) {
      call("open", vid);
    } else if (query && player.playSearch) {
      call("playSearch", String(query));
    } else if (rawId) {
      call("playSearch", String(rawId));
    }
  });

  // === MIXRADIO ===
  window.addEventListener("assistant:mixradio", () => {
    if (document.querySelector("#random-radio")) return;
    const seed = MIX_SEEDS[(Math.random() * MIX_SEEDS.length) | 0];
    if (player.playSearch) call("playSearch", seed);
  });

  // === TRANSPORT ===
  window.addEventListener("assistant:player-play",  () => call("play"));
  window.addEventListener("assistant:player-pause", () => call("pause"));
  window.addEventListener("assistant:player-stop",  () => call("stop"));
  window.addEventListener("assistant:player-next",  () => call("next"));
  window.addEventListener("assistant:player-prev",  () => call("prev"));

  // === UI ===
  window.addEventListener("assistant:minimize", () => call("minimize"));
  window.addEventListener("assistant:expand",   () => call("expand"));

  // === ГРОМКОСТЬ ===
  window.addEventListener("assistant:volume", (e) => {
    const d = Number(e?.detail?.delta || 0);
    if (!Number.isFinite(d)) return;
    if (typeof player.getVolume === "function" && typeof player.setVolume === "function") {
      const cur = Number(player.getVolume() || 0);
      call("setVolume", clamp01(cur + d));
    }
  });

  // === RECOMMEND (autoplay) ===
  window.addEventListener("assistant:recommend", (e) => {
    const a = e?.detail || {};
    if (!a || a.autoplay !== true) return;

    const looksLikeTrack = (s) => {
      const t = String(s || "").toLowerCase();
      return /["«»“”„‟]/.test(s) || t.includes(' - ') || /(official|audio|video|lyrics|remaster)/.test(t);
    };

    let q = "";
    if (a.like) {
      const like = String(a.like).trim();
      if (!like) return;
      // если похоже на конкретный трек → одиночный трек
      // иначе — хиты артиста (плейлист)
      q = looksLikeTrack(like)
        ? `${like} official audio`
        : `${like} greatest hits playlist`;
    } else if (a.genre) {
      const map = new Map([
        ["джаз", "best jazz music relaxing"],
        ["рок", "classic rock hits"],
        ["поп", "pop hits playlist"],
        ["электрон", "edm house techno mix"],
        ["lofi", "lofi hip hop radio"],
        ["классик", "classical symphony playlist"],
        ["рэп", "hip hop playlist"],
        ["инди", "indie rock playlist"],
        ["ambient", "ambient music long playlist"],
        ["блюз", "best blues songs playlist"],
        ["шансон", "russian chanson mix"],
        ["folk", "folk acoustic playlist"],
        ["rnb", "rnb soul classics playlist"],
        ["latin", "latin hits playlist"],
        ["reggae", "best reggae mix"],
        ["k-pop", "kpop hits playlist"],
        ["j-pop", "jpop hits playlist"],
        ["soundtrack", "movie soundtrack playlist"]
      ]);
      q = map.get(String(a.genre).toLowerCase()) || `${a.genre} music playlist`;
    } else if (a.mood) {
      const moods = new Map([
        ["happy", "upbeat feel good hits"],
        ["calm", "chillout ambient relaxing playlist"],
        ["sad", "sad indie playlist"],
        ["energetic", "energetic edm gym playlist"]
      ]);
      q = moods.get(String(a.mood).toLowerCase()) || "music playlist";
    }

    if (q && player.playSearch) call("playSearch", q);
  });

  // Совместимость doc→win, если нет внешнего bridge
  if (!(typeof window !== 'undefined' && window.__AH_BRIDGE_PRESENT === true)) {
    document.addEventListener("assistant:play",       (e) => window.dispatchEvent(new CustomEvent("assistant:play",       { detail: e.detail })));
    document.addEventListener("assistant:mixradio",   (e) => window.dispatchEvent(new CustomEvent("assistant:mixradio",   { detail: e.detail })));
    document.addEventListener("assistant:player-play",(e) => window.dispatchEvent(new CustomEvent("assistant:player-play",{ detail: e.detail })));
    document.addEventListener("assistant:player-pause",(e)=> window.dispatchEvent(new CustomEvent("assistant:player-pause",{ detail: e.detail })));
    document.addEventListener("assistant:player-stop",(e) => window.dispatchEvent(new CustomEvent("assistant:player-stop",{ detail: e.detail })));
    document.addEventListener("assistant:player-next",(e) => window.dispatchEvent(new CustomEvent("assistant:player-next",{ detail: e.detail })));
    document.addEventListener("assistant:player-prev",(e) => window.dispatchEvent(new CustomEvent("assistant:player-prev",{ detail: e.detail })));
    document.addEventListener("assistant:minimize",   (e) => window.dispatchEvent(new CustomEvent("assistant:minimize",   { detail: e.detail })));
    document.addEventListener("assistant:expand",     (e) => window.dispatchEvent(new CustomEvent("assistant:expand",     { detail: e.detail })));
    document.addEventListener("assistant:volume",     (e) => window.dispatchEvent(new CustomEvent("assistant:volume",     { detail: e.detail })));
    document.addEventListener("assistant:recommend",  (e) => window.dispatchEvent(new CustomEvent("assistant:recommend",  { detail: e.detail })));
  }
}

