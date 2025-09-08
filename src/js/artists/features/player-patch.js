// Bridges assistant:* события ↔ публичное API плеера
// НИЧЕГО не импортим из player.js — работаем с переданным инстансом

export default function mountPlayerPatch(player) {
  if (!player || typeof player !== "object") {
    console.warn("[player-patch] No player instance provided");
    return;
  }

  const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

  // Набор сидов на случай mixradio
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

  // Утилита: безопасно вызывать метод плеера, если он есть
  const call = (name, ...args) => {
    const fn = player?.[name];
    if (typeof fn === "function") { try { return fn.apply(player, args); } catch (e) { console.warn(`[player-patch] ${name} failed`, e); } }
  };

  // === PLAY запрос (конкретный id или поисковый запрос) ===
  window.addEventListener("assistant:play", (e) => {
    const { id, query } = e.detail || {};
    if (id)       call("open", String(id));           // YouTube id/URL
    else if (query && player.playSearch) call("playSearch", String(query));
  });

  // === MIXRADIO ===
  window.addEventListener("assistant:mixradio", (e) => {
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

  // === ГРОМКОСТЬ (delta в долях [-1..1]) ===
  window.addEventListener("assistant:volume", (e) => {
    const d = Number(e.detail?.delta || 0);
    if (!Number.isFinite(d)) return;
    if (typeof player.getVolume === "function" && typeof player.setVolume === "function") {
      const cur = Number(player.getVolume() || 0);
      call("setVolume", clamp01(cur + d));
    }
  });

  // === RECOMMEND (жанр/настроение/похожесть) ===
  // Если приходит autoplay: true — пробуем сформировать поисковый запрос и сразу включить
  window.addEventListener("assistant:recommend", (e) => {
    const a = e.detail || {};
    if (!a || a.autoplay !== true) return; // без autoplay просто пробрасывается UI-части, плеер не трогаем

    let q = "";
    if (a.like) {
      q = `${a.like} official audio`;
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
        ["calm", "lofi chill beats to relax"],
        ["sad", "sad emotional songs playlist"],
        ["energetic", "high energy workout rock mix"]
      ]);
      q = moods.get(String(a.mood).toLowerCase()) || "music playlist";
    }

    if (q && player.playSearch) call("playSearch", q);
  });

  // На всякий — совместимость с документом (если кто-то шлёт не на window)
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

