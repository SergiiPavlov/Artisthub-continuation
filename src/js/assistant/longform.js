
// src/js/assistant/longform.js
/* PRO: YouTube longform (movies & audiobooks) — v0.2
   Новое:
   - Client-only фильтрация по длительности через "скрытый" YT-плеер (без сервера/ключа).
   - Умный подбор: берём search-плейлист, вытаскиваем IDs, пробуем длительность (CUE → getDuration),
     отфильтровываем короткие клипы.
   - Событие assistant:pro.suggest.result с массивом {id,title,durationSec,author} для UI.
*/

import Player from '../artists/features/player.js';
import { API_BASE } from './apiBase.js';

/* ========================== Настройки ========================== */
const LONG_MIN_SEC = 3600;         // 60+ мин: фильм
const AUDIOBOOK_MIN_SEC = 1800;    // 30+ мин: аудиокнига
const PROBE_LIMIT = 40;            // сколько верхних ID из search-плейлиста пробуем максимум
const SUGGEST_LIMIT_DEFAULT = 12;
const PROBE_TIMEOUT_MS = 8000;     // максим. время ожидания на 1 cue

/* Ключевые слова для запросов (стараемся избегать трейлеров и отборок сцен) */
const NEG = "-trailer -трейлер -scene -сцена -clip -клип -teaser -тизер -обзор -review -fragment -фрагмент";
const KW = {
  movie: [
    'full movie', 'фильм целиком', 'полный фильм', 'полнометражный фильм', 'full hd',
    'русский дубляж', 'без рекламы'
  ],
  audiobook: [
    'аудиокнига полностью', 'аудиокнига', 'audio book full'
  ]
};

const STOPWORDS = /(trailer|трейлер|scene|сцена|clip|клип|review|обзор|teaser|тизер|коротк|shorts?)/i;

function sanitize(s=''){ return String(s||'').replace(/\s+/g,' ').trim(); }

function looksValidTitle(s='') {
  const t = (s||'').toLowerCase();
  if (!t) return false;
  if (STOPWORDS.test(t)) return false;
  return true;
}

/* ====================== Серверный поиск (опц.) ====================== */
async function searchServer(q, minSec) {
  if (!API_BASE) return null;
  try {
    const body = { q, max: PROBE_LIMIT, filters: { durationSecMin: minSec|0 } };
    const r = await fetch(`${API_BASE}/api/yt/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) return null;
    const j = await r.json();
    // ожидаем либо items со сроками, либо ids
    if (Array.isArray(j?.items) && j.items.length) return j.items;
    if (Array.isArray(j?.ids) && j.ids.length) return j.ids.map(id => ({ id }));
    return null;
  } catch(e) {
    console.warn('[longform] server search failed', e);
    return null;
  }
}

/* ===================== Компоновщик запросов ===================== */
function composeQueries({ type, title, mood, actor }) {
  const qs = [];
  const base = sanitize(title || actor || mood || '');
  const neg = NEG;

  if (type === 'movie') {
    const tags = KW.movie.slice(0);
    if (actor) tags.unshift(`${actor} movie`, `${actor} фильм`);
    if (mood)  tags.unshift(`${mood} movie`, `${mood} фильм`);
    if (title) tags.unshift(`${title}`);
    const uniq = new Set();
    for (const tag of tags) {
      const q = sanitize([base, tag, neg].filter(Boolean).join(' '));
      if (!uniq.has(q)) { uniq.add(q); qs.push(q); }
    }
  } else if (type === 'audiobook') {
    const tags = KW.audiobook.slice(0);
    if (actor) tags.unshift(`${actor} audiobook`, `${actor} читает`);
    if (mood)  tags.unshift(`${mood} аудиокнига`);
    if (title) tags.unshift(`${title}`);
    const uniq = new Set();
    for (const tag of tags) {
      const q = sanitize([base, tag, neg].filter(Boolean).join(' '));
      if (!uniq.has(q)) { uniq.add(q); qs.push(q); }
    }
  } else {
    if (title) qs.push(sanitize([title, neg].join(' ')));
  }
  return qs.slice(0, 6);
}

/* ====================== Hidden YT Probe ====================== */
let _probe = null;
let _probeReady = false;
let _probeOnReadyResolvers = [];

function loadYTAPI() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (loadYTAPI._p) return loadYTAPI._p;
  loadYTAPI._p = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => rej(new Error('YT API load failed'));
    document.head.appendChild(s);
    const t = setTimeout(() => rej(new Error('YT API timeout')), 15000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(t); res(); };
  });
  return loadYTAPI._p;
}

function ensureProbe() {
  return loadYTAPI().then(() => {
    if (_probe && _probe.getIframe) return Promise.resolve();
    return new Promise((resolve) => {
      const host = document.createElement('div');
      host.id = 'am-probe-yt';
      host.style.cssText = 'position:absolute;width:1px;height:1px;left:-9999px;top:-9999px;opacity:0;pointer-events:none;';
      document.body.appendChild(host);
      _probeReady = false;
      _probeOnReadyResolvers = [];
      _probe = new YT.Player('am-probe-yt', {
        host: 'https://www.youtube.com',
        width: '1', height: '1',
        playerVars: { controls: 0, autoplay: 0, rel: 0, modestbranding: 1, enablejsapi: 1 },
        events: {
          onReady: () => {
            _probeReady = true;
            const arr = _probeOnReadyResolvers.slice(); _probeOnReadyResolvers.length = 0;
            arr.forEach(fn => { try { fn(); } catch {} });
            resolve();
          }
        }
      });
    });
  });
}

function waitProbeReady() {
  if (_probeReady) return Promise.resolve();
  return new Promise(res => _probeOnReadyResolvers.push(res));
}

function getPlaylistFromSearch(q) {
  // грузим "поисковый" плейлист и достаём IDs
  return new Promise(async (resolve) => {
    try {
      await ensureProbe(); await waitProbeReady();
      _probe.loadPlaylist({ listType: 'search', list: q, index: 0 });
      // дадим плейлисту сформироваться
      setTimeout(() => {
        try {
          const ids = Array.isArray(_probe.getPlaylist?.()) ? _probe.getPlaylist() : [];
          resolve(ids);
        } catch { resolve([]); }
      }, 1000);
    } catch {
      resolve([]);
    }
  });
}

function cueAndReadMeta(id) {
  return new Promise(async (resolve) => {
    let done = false;
    const to = setTimeout(() => { if (!done) { done = true; resolve(null); } }, PROBE_TIMEOUT_MS);
    try {
      await ensureProbe(); await waitProbeReady();
      const onState = (e) => {
        // ждём CUED
        if (e?.data === window.YT?.PlayerState?.CUED) {
          try {
            const dur = _probe.getDuration?.() || 0;
            const vd = _probe.getVideoData?.() || {};
            const meta = { id, durationSec: Math.round(dur||0), title: vd.title || '', author: vd.author || '' };
            if (!done) { done = true; clearTimeout(to); resolve(meta); }
          } catch {
            if (!done) { done = true; clearTimeout(to); resolve(null); }
          } finally {
            try { _probe.removeEventListener('onStateChange', onState); } catch {}
          }
        }
      };
      _probe.addEventListener('onStateChange', onState);
      _probe.cueVideoById({ videoId: id });
    } catch {
      if (!done) { done = true; clearTimeout(to); resolve(null); }
    }
  });
}

async function suggestLongformClient({ type='movie', title='', mood='', actor='', limit=SUGGEST_LIMIT_DEFAULT }) {
  const minSec = type === 'audiobook' ? AUDIOBOOK_MIN_SEC : LONG_MIN_SEC;
  const queries = composeQueries({ type, title, mood, actor });
  // Берём первую наиболее релевантную формулировку
  const q = queries[0] || title || actor || mood || (type === 'movie' ? 'full movie' : 'аудиокнига полностью');
  const ids = await getPlaylistFromSearch(q);
  if (!ids || !ids.length) return [];
  const slice = ids.slice(0, PROBE_LIMIT);
  const out = [];
  for (const id of slice) {
    const meta = await cueAndReadMeta(id);
    if (!meta) continue;
    if (meta.durationSec >= minSec && looksValidTitle(meta.title)) {
      out.push(meta);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/* ======================= Публичные функции ======================= */
async function playLongform({ type='movie', title='', mood='', actor='' }) {
  const minSec = type === 'audiobook' ? AUDIOBOOK_MIN_SEC : LONG_MIN_SEC;
  const queries = composeQueries({ type, title, mood, actor });
  for (const q of queries) {
    // 1) сервер с фильтром по длительности
    const items = await searchServer(q, minSec);
    if (Array.isArray(items) && items.length) {
      // нормализуем
      const norm = items.map(x => (typeof x === 'string' ? { id:x } : x))
        .filter(x => x.id)
        .map(x => ({ ...x, durationSec: x.durationSec||0, title: x.title||'', author: x.channelTitle||x.author||'' }));
      const long = norm.filter(x => x.durationSec >= minSec && looksValidTitle(x.title));
      const ids = (long.length ? long : norm).map(x => x.id);
      if (ids.length) { Player.openQueue(ids, { shuffle:false, startIndex:0 }); return true; }
    }
    // 2) client-only: возьмём длинные из search-плейлиста
    const sugg = await suggestLongformClient({ type, title, mood, actor, limit: 8 });
    if (sugg.length) { Player.openQueue(sugg.map(x => x.id), { shuffle:false, startIndex:0 }); return true; }
    // 3) fallback — просто запустить поиск (на всякий)
    await Player.playSearch(q);
    return true;
  }
  if (title) { await Player.playSearch(title); return true; }
  return false;
}

async function suggestLongform({ type='movie', title='', mood='', actor='', limit=SUGGEST_LIMIT_DEFAULT }) {
  const minSec = type === 'audiobook' ? AUDIOBOOK_MIN_SEC : LONG_MIN_SEC;
  // 1) сервер
  const queries = composeQueries({ type, title, mood, actor });
  const q = queries[0] || title || actor || mood || (type === 'movie' ? 'full movie' : 'аудиокнига полностью');
  const items = await searchServer(q, minSec);
  if (items) {
    const norm = items.map(x => (typeof x === 'string' ? { id:x } : x))
      .filter(x => x.id)
      .map(x => ({ ...x, durationSec: x.durationSec||0, title: x.title||'', author: x.channelTitle||x.author||'' }))
      .filter(x => x.durationSec >= minSec && looksValidTitle(x.title));
    const cut = norm.slice(0, limit);
    dispatchSuggestions({ type, q, items: cut });
    return cut;
  }
  // 2) client-only
  const sugg = await suggestLongformClient({ type, title, mood, actor, limit });
  dispatchSuggestions({ type, q, items: sugg });
  return sugg;
}

function dispatchSuggestions(payload) {
  try {
    window.dispatchEvent(new CustomEvent('assistant:pro.suggest.result', { detail: payload }));
  } catch {}
}

/* ======================= Event wiring ======================= */
window.addEventListener('assistant:pro.play', (e) => {
  const d = e?.detail || {};
  playLongform(d);
});

window.addEventListener('assistant:pro.suggest', async (e) => {
  const d = e?.detail || {};
  await suggestLongform(d);
});

console.log('[longform] PRO longform v0.2 ready');
