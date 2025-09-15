/* PRO: YouTube longform (movies & audiobooks) — v0.4
   Изменения vs v0.3:
   - Приоритет КЛИЕНТСКОГО «пробника» (cue+getDuration) над серверными ID.
   - Серверные результаты используются ТОЛЬКО если содержат durationSec >= minSec.
   - Если найдены только YouTube-only (embedOk:false) — не запускаем плеер; выводим карточки (assistant:pro.suggest.result).
   - Всегда возвращаем {id,title,durationSec,author,embedOk,url} в suggest.
   - Добавлены надёжные слушатели событий: assistant:pro.play / assistant:pro.suggest.
   - Не трогаем window.onYouTubeIframeAPIReady.
*/

import Player from '../artists/features/player.js';
import { API_BASE } from './apiBase.js';

const LONG_MIN_SEC = 3600;         // фильм >= 60 мин
const AUDIOBOOK_MIN_SEC = 1800;    // аудиокнига >= 30 мин
const PROBE_LIMIT = 90;
const SUGGEST_LIMIT_DEFAULT = 12;
const PROBE_TIMEOUT_MS = 9000;
const YT_WAIT_TIMEOUT_MS = 15000;

/* избегаем трейлеров/клипов */
const NEG = "-trailer -трейлер -scene -сцена -clip -клип -teaser -тизер -обзор -review -fragment -фрагмент -коротк -shorts";
const KW = {
  movie: [
    'full movie', 'фильм целиком', 'полный фильм', 'полнометражный фильм', 'full hd', '1080p', '720p', 'полная версия'
  ],
  audiobook: [
    'аудиокнига полностью', 'аудиокнига целиком', 'аудиокнига', 'audio book full', 'полная версия'
  ]
};
const EXTRA_SOVIET = ['советский фильм', 'СССР', 'комедия фильм целиком', 'драма фильм целиком'];

const STOPWORDS = /(trailer|трейлер|scene|сцена|clip|клип|review|обзор|teaser|тизер|коротк|shorts?)/i;

function sanitize(s=''){ return String(s||'').replace(/\s+/g,' ').trim(); }
function looksValidTitle(s='') { const t=(s||'').toLowerCase(); if(!t) return false; if (STOPWORDS.test(t)) return false; return true; }
const ytWatchUrl = (id)=> `https://www.youtube.com/watch?v=${id}`;

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
    if (Array.isArray(j?.items) && j.items.length) return j.items;
    if (Array.isArray(j?.ids) && j.ids.length) return j.ids.map(id => ({ id }));
    return null;
  } catch(e) { console.warn('[longform] server search failed', e); return null; }
}

/* ===================== Компоновщик запросов ===================== */
function composeQueries({ type, title, mood, actor }) {
  const qs = [];
  const base = sanitize(title || '');
  const neg = NEG;

  const tags = (type === 'audiobook') ? KW.audiobook.slice(0) : KW.movie.slice(0);
  if (actor) tags.unshift(`${actor} ${type==='audiobook'?'audiobook':'movie'}`, `${actor} ${type==='audiobook'?'читает':'фильм'}`);
  if (mood)  tags.unshift(`${mood} ${type==='audiobook'?'аудиокнига':'фильм'}`);
  if (title) tags.unshift(`${title}`);
  if (type === 'movie') tags.push(...EXTRA_SOVIET);

  const uniq = new Set();
  for (const tag of tags) {
    const q = sanitize([base, tag, neg].filter(Boolean).join(' '));
    if (!uniq.has(q)) { uniq.add(q); qs.push(q); }
  }
  return qs.filter(Boolean).slice(0, 10);
}

/* ====================== YT API, не ломая onYouTubeIframeAPIReady ====================== */
function ensureYTApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(true);
  const present = !!document.querySelector('script[src*="youtube.com/iframe_api"]');
  if (!present) {
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    document.head.appendChild(s);
  }
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (window.YT && window.YT.Player) { clearInterval(iv); resolve(true); }
      if (Date.now() - t0 > YT_WAIT_TIMEOUT_MS) { clearInterval(iv); reject(new Error('YT API wait timeout')); }
    }, 120);
  });
}

let _probe = null;
let _probeReady = false;
function ensureProbe() {
  return ensureYTApi().then(() => {
    if (_probe && _probe.getIframe) return;
    const host = document.createElement('div');
    host.id = 'am-probe-yt';
    host.style.cssText = 'position:absolute;width:1px;height:1px;left:-9999px;top:-9999px;opacity:0;pointer-events:none;';
    document.body.appendChild(host);
    _probeReady = false;
    _probe = new YT.Player('am-probe-yt', {
      host: 'https://www.youtube.com',
      width: '1', height: '1',
      playerVars: { controls: 0, autoplay: 0, rel: 0, modestbranding: 1, enablejsapi: 1 },
      events: { onReady: () => { _probeReady = true; } }
    });
  });
}
function waitProbeReady() {
  return new Promise((res) => {
    const iv = setInterval(()=>{
      if (_probeReady && _probe && _probe.getIframe) { clearInterval(iv); res(); }
    }, 50);
  });
}

function getPlaylistFromSearch(q) {
  return new Promise(async (resolve) => {
    try {
      await ensureProbe(); await waitProbeReady();
      _probe.loadPlaylist({ listType: 'search', list: q, index: 0 });
      setTimeout(() => {
        try {
          const ids = Array.isArray(_probe.getPlaylist?.()) ? _probe.getPlaylist() : [];
          resolve(ids);
        } catch { resolve([]); }
      }, 1000);
    } catch { resolve([]); }
  });
}

function cueAndReadMeta(id) {
  return new Promise(async (resolve) => {
    let done = false;
    const to = setTimeout(() => { if (!done) { done = true; resolve({ id, embedOk:false, durationSec:0, title:'', author:'', url: ytWatchUrl(id) }); } }, PROBE_TIMEOUT_MS);
    try {
      await ensureProbe(); await waitProbeReady();
      const onError = (e) => {
        const code = e?.data;
        const embedOk = !(code === 101 || code === 150);
        const meta = { id, embedOk, durationSec:0, title:'', author:'', url: ytWatchUrl(id) };
        if (!done) { done = true; clearTimeout(to); resolve(meta); }
        try { _probe.removeEventListener('onError', onError); } catch {}
      };
      const onState = (e) => {
        if (e?.data === window.YT?.PlayerState?.CUED) {
          try {
            const dur = _probe.getDuration?.() || 0;
            const vd = _probe.getVideoData?.() || {};
            const meta = { id, embedOk:true, durationSec: Math.round(dur||0), title: vd.title || '', author: vd.author || '', url: ytWatchUrl(id) };
            if (!done) { done = true; clearTimeout(to); resolve(meta); }
          } catch {
            if (!done) { done = true; clearTimeout(to); resolve({ id, embedOk:false, durationSec:0, title:'', author:'', url: ytWatchUrl(id) }); }
          } finally {
            try { _probe.removeEventListener('onStateChange', onState); } catch {}
          }
        }
      };
      _probe.addEventListener('onError', onError);
      _probe.addEventListener('onStateChange', onState);
      _probe.cueVideoById({ videoId: id });
    } catch {
      if (!done) { done = true; clearTimeout(to); resolve({ id, embedOk:false, durationSec:0, title:'', author:'', url: ytWatchUrl(id) }); }
    }
  });
}

/* соберём кандидатов из нескольких запросов пока не наберём limit */
async function suggestLongformClient({ type='movie', title='', mood='', actor='', limit=SUGGEST_LIMIT_DEFAULT, minSecOverride }={}) {
  const minSec = minSecOverride ?? (type === 'audiobook' ? AUDIOBOOK_MIN_SEC : LONG_MIN_SEC);
  const queries = composeQueries({ type, title, mood, actor });
  const out = [];
  const seen = new Set();
  for (const q of queries) {
    const ids = await getPlaylistFromSearch(q);
    for (const id of (ids||[])) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const meta = await cueAndReadMeta(id);
      if (!meta) continue;
      if (meta.durationSec >= minSec && looksValidTitle(meta.title)) {
        out.push(meta);
        if (out.length >= limit) break;
      }
    }
    if (out.length >= limit) break;
  }
  return out;
}

/* ======================= Публичные функции ======================= */
async function playLongform({ type='movie', title='', mood='', actor='' }) {
  const minSec = (type === 'audiobook') ? AUDIOBOOK_MIN_SEC : LONG_MIN_SEC;
  const queries = composeQueries({ type, title, mood, actor });

  for (const q of queries) {
    // 1) КЛИЕНТСКИЕ длинные кандидаты — ПРИОРИТЕТ
    const sugg = await suggestLongformClient({ type, title, mood, actor, limit: 8, minSecOverride: minSec });
    if (sugg.length) {
      const playable = sugg.filter(x => x.embedOk);
      const ids = (playable.length ? playable : []).map(x => x.id);
      if (ids.length) { Player.openQueue(ids, { shuffle:false, startIndex:0 }); return true; }
      // только YouTube-only → карту пользователю
      dispatchSuggestions({ type, q, items: sugg });
      return false;
    }

    // 2) СЕРВЕР: используем только если есть durationSec >= minSec
    const items = await searchServer(q, minSec);
    if (Array.isArray(items) && items.length) {
      const norm = items.map(x => (typeof x === 'string' ? { id:x } : x))
        .filter(x => x.id)
        .map(x => ({ ...x, durationSec: x.durationSec||0, title: x.title||'', author: x.channelTitle||x.author||'', embedOk:true, url: ytWatchUrl(x.id) }));
      const long = norm.filter(x => x.durationSec >= minSec && looksValidTitle(x.title));
      if (long.length) {
        Player.openQueue(long.map(x=>x.id), { shuffle:false, startIndex:0 });
        return true;
      }
      // если сервер что-то дал, но без длительностей — всё равно не используем
    }

    // 3) мягкий Fallback — последний шанс
    await Player.playSearch(q);
    return true;
  }

  if (title) { await Player.playSearch(title); return true; }
  return false;
}

async function suggestLongform({ type='movie', title='', mood='', actor='', limit=SUGGEST_LIMIT_DEFAULT }) {
  const minSec = (type === 'audiobook') ? AUDIOBOOK_MIN_SEC : LONG_MIN_SEC;
  const queries = composeQueries({ type, title, mood, actor });
  const q = queries[0] || title || actor || mood || (type === 'movie' ? 'full movie' : 'аудиокнига полностью');

  // приоритет — клиентские длинные
  const sugg = await suggestLongformClient({ type, title, mood, actor, limit, minSecOverride: minSec });
  if (sugg.length) {
    dispatchSuggestions({ type, q, items: sugg });
    return sugg;
  }

  // сервер только если есть durationSec >= minSec
  const items = await searchServer(q, minSec);
  if (Array.isArray(items) && items.length) {
    const norm = items.map(x => (typeof x === 'string' ? { id:x } : x))
      .filter(x => x.id)
      .map(x => ({ ...x, durationSec: x.durationSec||0, title: x.title||'', author: x.channelTitle||x.author||'', embedOk:true, url: ytWatchUrl(x.id) }))
      .filter(x => x.durationSec >= minSec && looksValidTitle(x.title))
      .slice(0, limit);
    dispatchSuggestions({ type, q, items: norm });
    return norm;
  }

  dispatchSuggestions({ type, q, items: [] });
  return [];
}

function dispatchSuggestions(payload) {
  try {
    window.dispatchEvent(new CustomEvent('assistant:pro.suggest.result', { detail: payload }));
  } catch {}
}

/* ===== Слушатели событий (обязательно) ===== */
window.addEventListener('assistant:pro.play', (e) => {
  const d = e?.detail || {};
  playLongform(d).catch(err => console.warn('[longform] play error', err));
});
window.addEventListener('assistant:pro.suggest', (e) => {
  const d = e?.detail || {};
  suggestLongform(d).catch(err => console.warn('[longform] suggest error', err));
});

console.log('[longform] PRO longform v0.4 ready');
