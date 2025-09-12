/* eslint-env browser */

/**
 * Каталожный провайдер YouTube-ID без API-ключа.
 *
 * Идея: использовать локальную БД артиста/альбомов/треков (то, что уже есть у тебя в проекте),
 * находить в ней youtube-ссылки и извлекать 11-символьные videoId.
 *
 * Безопасность:
 * - Никаких сетевых запросов к YouTube.
 * - Работает даже при исчерпанной квоте Data API.
 *
 * Гибкость:
 * - Пытается динамически импортировать один из модулей каталога:
 *   ./api.js, ../api.js, ./modal.js — и аккуратно ищет знакомые функции/структуры.
 * - Если ничего не нашлось, пытается воспользоваться глобалками window.__ARTISTS_DB__ / window.Artists.
 *
 * Кэш:
 * - localStorage ("amCatCacheV1") с TTL по умолчанию 7 дней.
 */

const YT_ID_RE = /(?:v=|\/(?:embed|shorts|v)\/|youtu\.be\/)([A-Za-z0-9_-]{11})/i;
const RAW_ID_RE = /\b([A-Za-z0-9_-]{11})\b/;

function getYouTubeIdFromString(s) {
  if (!s) return '';
  const str = String(s);
  const m1 = str.match(YT_ID_RE);
  if (m1 && m1[1]) return m1[1];
  const m2 = str.match(RAW_ID_RE);
  if (m2 && m2[1]) return m2[1];
  return '';
}

function normalize(q) {
  return String(q || '').trim().toLowerCase();
}

function readCache() {
  try {
    return JSON.parse(localStorage.getItem('amCatCacheV1') || '{}');
  } catch { return {}; }
}

function writeCache(obj) {
  try { localStorage.setItem('amCatCacheV1', JSON.stringify(obj)); } catch {}
}

function collectIdsFromArtist(artistObj) {
  const out = new Set();
  if (!artistObj || typeof artistObj !== 'object') return out;

  // 1) прямые поля
  for (const k of ['yt', 'youtube', 'url', 'video', 'link']) {
    const id = getYouTubeIdFromString(artistObj[k]);
    if (id) out.add(id);
  }

  // 2) альбомы → треки
  const albums = artistObj.albums || artistObj.discography || [];
  if (Array.isArray(albums)) {
    for (const al of albums) {
      for (const k of ['yt', 'youtube', 'url', 'video', 'link']) {
        const id = getYouTubeIdFromString(al?.[k]);
        if (id) out.add(id);
      }
      const tracks = al?.tracks || al?.songs || [];
      if (Array.isArray(tracks)) {
        for (const tr of tracks) {
          for (const k of ['yt', 'youtube', 'url', 'video', 'link']) {
            const id = getYouTubeIdFromString(tr?.[k]);
            if (id) out.add(id);
          }
        }
      }
    }
  }

  // 3) иногда встречаются «extras»/«links»
  const links = artistObj.links || artistObj.extra || [];
  if (Array.isArray(links)) {
    for (const x of links) {
      const id = getYouTubeIdFromString(x);
      if (id) out.add(id);
    }
  }

  return out;
}

async function tryImport(path) {
  try { return await import(/* @vite-ignore */ path); }
  catch { return null; }
}

async function findArtistCandidates(query) {
  const q = normalize(query);
  const out = [];

  // Пытаемся разные модули (на твой проект часто подходит ./api.js)
  const mod1 = await tryImport('./api.js');
  const mod2 = await tryImport('../api.js');
  const mod3 = await tryImport('./modal.js'); // вдруг там экспортятся данные
  const mods = [mod1, mod2, mod3].filter(Boolean);

  for (const m of mods) {
    // Наиболее частые варианты API:
    const fns = [
      m.searchArtists, m.findArtists, m.lookupArtist, m.findArtistByName,
      m.getArtistBySlug, m.getArtist, m.getArtists, m.getAllArtists
    ].filter(Boolean);

    // 1) функции поиска
    for (const fn of fns) {
      try {
        const res = await fn(q);
        if (Array.isArray(res)) {
          for (const a of res) out.push(a);
        } else if (res && typeof res === 'object') {
          out.push(res);
        }
      } catch { /* no-op */ }
    }

    // 2) экспортированные индексы
    for (const key of Object.keys(m)) {
      const val = m[key];
      if (Array.isArray(val) && val.length && typeof val[0] === 'object') {
        // массив артистов
        for (const a of val) {
          const name = (a.name || a.title || a.artist || '').toLowerCase();
          const slug = (a.slug || '').toLowerCase();
          if (name.includes(q) || slug === q) out.push(a);
        }
      }
    }
  }

  // 3) глобалки как fallback
  const globals = [window.__ARTISTS_DB__, window.Artists, window.APP_CATALOG].filter(Boolean);
  for (const g of globals) {
    if (Array.isArray(g)) {
      for (const a of g) {
        const name = (a?.name || a?.title || a?.artist || '').toLowerCase();
        const slug = (a?.slug || '').toLowerCase();
        if (name.includes(q) || slug === q) out.push(a);
      }
    } else if (g && typeof g === 'object') {
      // объект вида { slug: artist }
      for (const k of Object.keys(g)) {
        const a = g[k];
        const name = (a?.name || a?.title || a?.artist || '').toLowerCase();
        const slug = String(k || '').toLowerCase();
        if (name.includes(q) || slug.includes(q)) out.push(a);
      }
    }
  }

  // легкая нормализация
  const unique = [];
  const seen = new Set();
  for (const a of out) {
    if (!a) continue;
    const key = (a.slug || a.name || a.title || JSON.stringify(a)).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(a);
  }
  return unique;
}

/**
 * Возвращает массив YouTube videoId (строки по 11 символов) из локального каталога
 * по текстовому запросу. Кэширует результат в localStorage.
 */
export async function idsFromCatalog(query, { ttlMs = 7 * 24 * 3600 * 1000 } = {}) {
  const q = normalize(query);
  if (!q) return [];

  // cache
  const cache = readCache();
  const now = Date.now();
  const cval = cache[q];
  if (cval && Array.isArray(cval.ids) && (now - (cval.ts || 0) < ttlMs)) {
    return cval.ids.slice();
  }

  const artists = await findArtistCandidates(q);
  const bag = new Set();
  for (const a of artists) {
    const ids = collectIdsFromArtist(a);
    ids.forEach(id => bag.add(id));
  }

  const res = Array.from(bag);
  cache[q] = { ids: res, ts: now };
  writeCache(cache);
  return res;
}

export default { idsFromCatalog };
