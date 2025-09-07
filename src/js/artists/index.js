// --------------------------------------------------
// Artists: точка входа
// --------------------------------------------------

import { initArtists } from "./features/init.js";
import { createMiniPlayer } from "./features/player.js";
import mountPlayerPatch from "./features/player-patch.js";
import { installMixRadioMenu } from "./features/mixradio-menu.js";

/* =========================
   Утилиты
   ========================= */

// Замена «похожих» кириллических символов на латиницу (частая причина битых ID)
function normalizeIdLikeString(s = "") {
  const map = {
    "А":"A","В":"B","Е":"E","К":"K","М":"M","Н":"H","О":"O","Р":"P","С":"S","Т":"T","Х":"X","а":"a","е":"e","о":"o","р":"p","с":"s","х":"x",
  };
  return String(s).replace(/[АВЕКМНОРСТХаеорсх]/g, ch => map[ch] || ch);
}

/** Достаёт YouTube ID из ID или URL (youtu.be, /embed, /shorts, ?v=) */
function getYouTubeId(urlOrId) {
  if (!urlOrId) return "";
  const raw = normalizeIdLikeString(urlOrId).trim();

  // уже ID?
  if (/^[\w-]{11}$/.test(raw)) return raw;

  // пытаемся как URL
  try {
    const u = new URL(raw, location.href);
    if (/youtu\.be$/i.test(u.hostname)) {
      const id = (u.pathname || "").slice(1);
      return /^[\w-]{11}$/.test(id) ? id : "";
    }
    const v = u.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const m = u.pathname.match(/\/(?:embed|v|shorts)\/([^/?#]+)/i);
    if (m && m[1] && /^[\w-]{11}$/.test(m[1])) return m[1];
  } catch {/* ignore */}
  return "";
}

const uniq = (arr) => Array.from(new Set((arr || []).filter(Boolean)));
function shuffle(a) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* =========================
   Seed-пул (поправлен ID Adele)
   ========================= */

const SEED_IDS = uniq([
  "Zi_XLOBDo_Y","3JZ_D3ELwOQ","fRh_vgS2dFE","OPf0YbXqDm0","60ItHLz5WEA",
  "2Vv-BfVoq4g","kXYiU_JCYtU","UceaB4D0jpo","RubBzkZzpUA","kJQP7kiw5Fk",
  "CevxZvSJLk8","pRpeEdMmmQ0","IcrbM1l_BoI","YVkUvmDQ3HY","hT_nvWreIhg",
  "09R8_2nJtjg","uelHwf8o7_U","JGwWNGJdvx8","YQHsXMglC9A","NmugSMBh_iI",
  "LrUvu1mlWco","hLQl3WQQoQ0","RgKAFK5djSk","SlPhMPnQ58k","oRdxUFDoQe0",
  "Pkh8UtuejGw","tt2k8PGm-TI","lY2yjAdbvdQ","pXRviuL6vMY","nfs8NYg7yQM",
  "nCkpzqqog4k","M7lc1UVf-VE",
  "fLexgOxsZu0","2vjPBrBU-TM","9bZkp7q19f0","e-ORhEE9VVg","gCYcHz2k5x0",
  "ktvTqknDobU","ub82Xb1C8os","fKopy74weus","Qv5fqunQ_4I","vNoKguSdy4Y",
  "0KSOMA3QBU0","lp-EO5I60KA","DK_0jXPuIr0","tVj0ZTS4WF4","6fVE8kSM43I",
  "6Ejga4kJUts","gGdGFtwCNBE","rYEDA3JcQqw","AtKZKl7Bgu0","eVTXPUF4Oz4",
  "kffacxfA7G4"
]);

/* =========================
   localStorage: пул и чёрный список
   ========================= */

const LS_KEY_POOL = "am.radio.pool";
const LS_KEY_LAST = "am.radio.last";
const LS_KEY_BAD  = "am.radio.bad";    // сюда кладём ID, которые не играют (embed off)

function readJSON(key, fallback = []) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function writeJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function readPoolLS() { return uniq(readJSON(LS_KEY_POOL, [])); }
function savePoolLS(arr) { writeJSON(LS_KEY_POOL, uniq(arr).slice(0, 800)); }
function addToPoolLS(ids) {
  if (!ids?.length) return;
  const cur = new Set(readPoolLS());
  ids.forEach((id) => { const x = getYouTubeId(id); if (x) cur.add(x); });
  savePoolLS([...cur]);
}

function readBadLS() { return new Set(readJSON(LS_KEY_BAD, [])); }
function addBadLS(ids) {
  if (!ids?.length) return;
  const cur = new Set(readBadLS());
  ids.forEach((id) => { const x = getYouTubeId(id); if (x) cur.add(x); });
  writeJSON(LS_KEY_BAD, [...cur]);
}

/* =========================
   Сбор ID из DOM
   ========================= */

function collectFromDOM(root = document) {
  const out = new Set();

  // Ссылки на YouTube
  root.querySelectorAll('a[href*="youtu"], a.yt').forEach((a) => {
    const href = a.getAttribute("href") || "";
    const id = getYouTubeId(href);
    if (id) out.add(id);
  });

  // Возможные data-атрибуты
  root.querySelectorAll("[data-yt],[data-youtube],[data-ytid]").forEach((el) => {
    const raw =
      el.getAttribute("data-yt") ||
      el.getAttribute("data-youtube") ||
      el.getAttribute("data-ytid") || "";
    const id = getYouTubeId(raw);
    if (id) out.add(id);
  });

  return [...out];
}

function installCollector() {
  addToPoolLS(collectFromDOM());
  const mo = new MutationObserver((mutations) => {
    let added = [];
    for (const m of mutations) {
      if (!m.addedNodes) continue;
      m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        added = added.concat(collectFromDOM(n));
      });
    }
    if (added.length) addToPoolLS(added);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
}

/* =========================
   Построение итогового пула (без «плохих»)
   ========================= */

function buildPool() {
  const bad = readBadLS();
  const mem = readPoolLS().filter(id => !bad.has(id));
  const dom = collectFromDOM().filter(id => !bad.has(id));
  const seed = SEED_IDS.filter(id => !bad.has(id));
  return uniq([...seed, ...mem, ...dom].map(getYouTubeId).filter(Boolean));
}

/* =========================
   Mix Radio
   ========================= */

function startMixRadio(player) {
  const pool = buildPool();
  if (!pool.length || !player) return;

  let order = shuffle(pool);

  // анти-повтор стартового
  const last = localStorage.getItem(LS_KEY_LAST);
  if (last && order.length > 1 && order[0] === last) {
    order.push(order.shift());
  }
  localStorage.setItem(LS_KEY_LAST, order[0]);

  if (typeof player.openQueue === "function") {
    player.openQueue(order, { shuffle: false, loop: true, startIndex: 0 });
  } else {
    if (typeof player.playYouTube === "function") player.playYouTube(order[0]);
    else if (typeof player.play === "function") player.play(order[0]);
  }
}

/* =========================
   Автозапуск из текущего экрана
   ========================= */

function collectPlayableIdsFromScreen() {
  const ids = new Set();

  // всё, что видно в сетке и модалке
  document.querySelectorAll(
    '#artists-grid a.yt, #artist-modal a.yt, [data-yt], [data-youtube], [data-ytid]'
  ).forEach(el => {
    const raw = el.getAttribute?.("href") ||
                el.getAttribute?.("data-yt") ||
                el.getAttribute?.("data-youtube") ||
                el.getAttribute?.("data-ytid") || "";
    const id = getYouTubeId(raw);
    if (id) ids.add(id);
  });

  // фоллбэк — всё, что на странице
  if (!ids.size) {
    collectFromDOM(document).forEach(id => ids.add(id));
  }

  // выкидываем «плохие»
  const bad = readBadLS();
  return [...ids].filter(id => !bad.has(id));
}

/* =========================
   Привязка ассистента к каталогу
   ========================= */

function bindAssistantToCatalog(player) {
  // Рекомендации (жанр/настроение/поиск по слову)
  document.addEventListener("assistant:recommend", (e) => {
    const { mood, genre, decade, like, autoplay } = e.detail || {};

    // ЖАНР — кликаем существующий пункт дропа
    if (genre) {
      const item = document.querySelector(
        '#dd-genre-list li[data-val="' + genre + '"]'
      );
      if (item) item.click();
    }

    // ПОИСК — вписываем в поле и триггерим input
    if (like) {
      const q = document.getElementById("flt-q");
      if (q) {
        q.value = like;
        q.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }

    // mood/decade — на твой маппинг тегов/чекбоксов (при наличии)
    // try { refresh(); } catch {}

    // Автозапуск: дашь UI перерисоваться и соберём id
    if (autoplay) {
      setTimeout(() => {
        const ids = collectPlayableIdsFromScreen();
        if (ids.length && typeof player?.openQueue === "function") {
          player.openQueue(ids, { startIndex: 0, shuffle: false, loop: true });
        } else {
          // если совсем ничего не нашли — микс-радио
          startMixRadio(player);
        }
      }, 120);
    }
  });

  // Управление плеером (подстраховочные фоллбэки)
  const safe = (fn) => { try { fn && fn(); } catch {} };

  document.addEventListener("assistant:player-play", () => {
    safe(() => {
      if (player?.isActive?.()) player.play?.();
      else if (player?.hasQueue?.()) player.play?.();
      else startMixRadio(player);
    });
  });
  document.addEventListener("assistant:player-pause", () => safe(() => {
    (player?.pause && player.pause()) || (player?.stop && player.stop());
  }));
  document.addEventListener("assistant:player-next",  () => safe(() => {
    if (player?.hasQueue?.()) player.next?.(); else startMixRadio(player);
  }));
  document.addEventListener("assistant:player-prev",  () => safe(() => player?.prev?.()));
  document.addEventListener("assistant:volume", (e) => safe(() => {
    const d = e.detail?.delta ?? 0;
    if (typeof player?.setVolume === "function") {
      const v = Math.max(0, Math.min(1, (player.getVolume?.() ?? 0.7) + d));
      player.setVolume(v);
    }
  }));

  // MixRadio явным событием
  document.addEventListener("assistant:mixradio", () => startMixRadio(player));

  // Прямой запуск по id/URL (если ассистент пришлёт конкретику)
  document.addEventListener("assistant:play", (e) => {
    const { id, query } = e.detail || {};
    const target = getYouTubeId(id || query);
    if (target && typeof player?.openQueue === "function") {
      player.openQueue([target], { shuffle: false, loop: true, startIndex: 0 });
    }
  });
}

/* =========================
   Bootstrap
   ========================= */

document.addEventListener("DOMContentLoaded", () => {
  try { initArtists(); } catch {}

  const player = (typeof createMiniPlayer === "function") ? createMiniPlayer() : null;

  // Сделаем доступным глобально (модалка/мост могут подписаться)
  if (player) {
    window.AM = window.AM || {};
    window.AM.player = player;
    document.dispatchEvent(new CustomEvent("am:player-ready", { detail: { player } }));
  }

  try { if (player) mountPlayerPatch(player); } catch {}

  installCollector();

  const btn = document.querySelector("#random-radio");
  if (btn) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (!player) return;

      if (player.isMinimized?.()) { player.next?.(); return; }

      if (!player.isActive?.()) {
        if (player.hasQueue?.()) player.next?.();
        else startMixRadio(player);
        return;
      }
      player.next?.();
    });
  }

  const ensureMenu = () => installMixRadioMenu("#mixradio-menu-btn", player);
  ensureMenu();
  window.addEventListener("load", ensureMenu);
  document.getElementById("filters-toggle")?.addEventListener("click", () => {
    setTimeout(ensureMenu, 0);
  });

  bindAssistantToCatalog(player);
});
