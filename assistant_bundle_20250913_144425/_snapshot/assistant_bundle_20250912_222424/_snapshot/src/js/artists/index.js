// --------------------------------------------------
// Artists: точка входа
// - initArtists(): инициализация сетки/фильтров/модалок
// - createMiniPlayer(): создаёт мини-плеер
// - mountPlayerPatch(player): навешивает события управления с ассистента
// - installMixRadioMenu(btnSelector, player): поповер меню под Mix Radio
// --------------------------------------------------

import { initArtists } from "./features/init.js";
import { createMiniPlayer } from "./features/player.js";
import mountPlayerPatch from "./features/player-patch.js";
import { installMixRadioMenu } from "./features/mixradio-menu.js";

/* =========================
   Утилиты
   ========================= */

/** Достаёт YouTube ID из ID или URL (youtu.be, /embed, /shorts, ?v=) */
function getYouTubeId(urlOrId) {
  if (!urlOrId) return "";
  if (/^[\w-]{11}$/.test(urlOrId)) return urlOrId; // уже ID

  try {
    const u = new URL(urlOrId, location.href);
    if (/youtu\.be$/i.test(u.hostname)) return u.pathname.slice(1);
    const v = u.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const m = u.pathname.match(/\/(?:embed|v|shorts)\/([^/?#]+)/i);
    if (m && m[1] && /^[\w-]{11}$/.test(m[1])) return m[1];
  } catch { /* ignore */ }
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
   Seed-пул видео (можно дополнять)
   ========================= */

const SEED_IDS = uniq([
  // базовый набор
  "Zi_XLOBDo_Y","3JZ_D3ELwOQ","fRh_vgS2dFE","OPf0YbXqDm0","60ItHLz5WEA",
  "2Vv-BfVoq4g","kXYiU_JCYtU","UceaB4D0jpo","RubBzkZzpUA","kJQP7kiw5Fk",
  "CevxZvSJLk8","pRpeEdMmmQ0","IcrbM1l_BoI","YVkUvmDQ3HY","hT_nvWreIhg",
  "09R8_2nJtjg","uelHwf8o7_U","JGwWNGJdvx8","YQHsXMglC9A","NmugSMBh_iI",
  "LrUvu1mlWco","hLQl3WQQoQ0","RgKAFK5djSk","SlPhMPnQ58k","oRdxUFDoQe0",
  "Pkh8UtuejGw","tt2k8PGm-TI","lY2yjAdbvdQ","pXRviuL6vMY","nfs8NYg7yQM",
  "nCkpzqqog4k","M7lc1UVf-VE",
  // расширение
  "fLexgOxsZu0","2vjPBrBU-TM","9bZkp7q19f0","e-ORhEE9VVg","gCYcHz2k5x0",
  "ktvTqknDobU","ub82Xb1C8os","fKopy74weus","Qv5fqunQ_4I","vNoKguSdy4Y",
  "0KSOMA3QBU0","lp-EO5I60KA","DK_0jXPuIr0","tVj0ZTS4WF4","6fVE8kSM43I",
  "6Ejga4kJUts","gGdGFtwCNBE","rYEDA3JcQqw","AtKZKl7Bgu0","eVTXPUF4Oz4",
  "kffacxfA7G4"
]);

/* =========================
   localStorage: кэш пула
   ========================= */

const LS_KEY_POOL = "am.radio.pool";
const LS_KEY_LAST = "am.radio.last";

function readPoolLS() {
  try {
    const raw = localStorage.getItem(LS_KEY_POOL);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? uniq(arr) : [];
  } catch { return []; }
}
function savePoolLS(arr) {
  try {
    localStorage.setItem(LS_KEY_POOL, JSON.stringify(uniq(arr).slice(0, 800)));
  } catch { /* ignore */ }
}
function addToPoolLS(ids) {
  if (!ids?.length) return;
  const cur = new Set(readPoolLS());
  ids.forEach((id) => cur.add(id));
  savePoolLS([...cur]);
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
      el.getAttribute("data-ytid") ||
      "";
    const id = getYouTubeId(raw);
    if (id) out.add(id);
  });

  return [...out];
}

function installCollector() {
  // стартовая выборка
  addToPoolLS(collectFromDOM());

  // наблюдаем за добавлениями (модалки, подгрузки и т.п.)
  const mo = new MutationObserver((mutations) => {
    let added = [];
    for (const m of mutations) {
      if (!m.addedNodes) continue;
      m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return; // ELEMENT_NODE
        added = added.concat(collectFromDOM(n));
      });
    }
    if (added.length) addToPoolLS(added);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
}

/* =========================
   Построение итогового пула
   ========================= */

function buildPool() {
  const mem = readPoolLS();
  const dom = collectFromDOM();
  return uniq([...SEED_IDS, ...mem, ...dom]);
}

/* =========================
   Mix Radio
   ========================= */

function startMixRadio(player) {
  const pool = buildPool();
  if (!pool.length || !player) return;

  // большая перемешанная очередь
  let order = shuffle(pool);

  // анти-повтор стартового
  const last = localStorage.getItem(LS_KEY_LAST);
  if (last && order.length > 1 && order[0] === last) {
    order.push(order.shift());
  }
  localStorage.setItem(LS_KEY_LAST, order[0]);

  // отдаём очередь плееру (API нашего мини-плеера)
  if (typeof player.openQueue === "function") {
    player.openQueue(order, { shuffle: false, loop: true, startIndex: 0 });
  } else {
    // фолбэк: просто сыграть первый ID, если есть метод playYouTube/id
    if (typeof player.playYouTube === "function") player.playYouTube(order[0]);
    else if (typeof player.play === "function") player.play(order[0]);
  }
}

/* =========================
   Привязка ассистента к каталогу
   ========================= */

function bindAssistantToCatalog(player) {
  // Рекомендации (жанр/настроение/поиск по слову)
  document.addEventListener("assistant:recommend", (e) => {
    const { mood, genre, decade, like } = e.detail || {};

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

    // mood/decade — под твой реальный маппинг тегов/чекбоксов
    // После выставления фильтров можно дёрнуть свою refresh():
    // try { refresh(); } catch {}
  });

  // Фолбэки на случай, если player-patch не подхватился:
  const safe = (fn) => { try { fn && fn(); } catch {} };

  document.addEventListener("assistant:player-play", () => {
    safe(() => {
      if (player?.isActive?.()) player.play?.();
      else if (player?.hasQueue?.()) player.play?.();
      else startMixRadio(player);
    });
  });
  document.addEventListener("assistant:player-pause", () => safe(() => player?.pause?.()));
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
}

/* =========================
   Bootstrap
   ========================= */

document.addEventListener("DOMContentLoaded", () => {
  // Инициализация секции/грида/модалок (как было)
  try { initArtists(); } catch { /* ignore */ }

  // Создаём мини-плеер
  const player = (typeof createMiniPlayer === "function") ? createMiniPlayer() : null;

  // Патч — строго после создания плеера
  try { if (player) mountPlayerPatch(player); } catch { /* ignore */ }

  // Сбор ID на лету (модалки, динамика)
  installCollector();

  // Кнопка «Mix Radio / Next»
  const btn = document.querySelector("#random-radio");
  if (btn) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (!player) return;

      // Если свернут (пузырь) — просто next, не раскрывая плеер
      if (player.isMinimized?.()) { player.next?.(); return; }

      // Если ещё не активен — стартуем радио или next по готовой очереди
      if (!player.isActive?.()) {
        if (player.hasQueue?.()) player.next?.();
        else startMixRadio(player);
        return;
      }

      // Если активен — просто next
      player.next?.();
    });
  }

  // Радио-меню (доп. кнопка под MixRadio)
  const ensureMenu = () => installMixRadioMenu("#mixradio-menu-btn", player);
  ensureMenu();
  window.addEventListener("load", ensureMenu);
  document.getElementById("filters-toggle")?.addEventListener("click", () => {
    setTimeout(ensureMenu, 0);
  });

  // Привязка ассистента
  bindAssistantToCatalog(player);
});
