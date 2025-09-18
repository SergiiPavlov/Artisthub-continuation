/* PRO: YouTube longform (movies & audiobooks) — v0.5.1
   Исправление P1 (Codex): учитывать minSecOverride в suggestLongform (и playLongform).
   - Если assistant:pro.suggest приходит с { minSecOverride: 0 } (путь «Показать короткие»),
     то подбор идёт без фильтра по длительности.
*/

import Player from '../artists/features/player.js';
import { API_BASE } from './apiBase.js';

const LONG_MIN_SEC = 3600;         // фильм >= 60 мин
const AUDIOBOOK_MIN_SEC = 1800;    // аудиокнига >= 30 мин
const PROBE_LIMIT = 90;
const SUGGEST_LIMIT_DEFAULT = 12;
const YT_WAIT_TIMEOUT_MS = 8000;

const NEG = '-мульт -cartoon -animation -trailer -трейлер -короткометраж -shorts -short -тизер -обзор -review -сцена -scene -recap';
const KW = {
  movie: ['фильм полностью', 'full movie', 'фильм целиком', 'кино полностью', 'советский фильм полностью'],
  audiobook: ['аудиокнига полностью', 'полная версия аудиокниги', 'аудиокнига целиком', 'audiobook full']
};
const EXTRA_SOVIET = ['hd', '4k', 'ретро', 'советское кино полностью', 'фильм без сокращений'];

function sanitize(s=''){ return String(s||'').replace(/\s+/g,' ').trim(); }
function ytWatchUrl(id){ return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`; }

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
      width: 200, height: 100, videoId: null,
      events: {
        onReady: () => { _probeReady = true; },
        onStateChange: () => {}
      },
      playerVars: { modestbranding:1, controls:0, disablekb:1 }
    });
  });
}
function waitProbeReady(){ return new Promise((r)=>{ const iv=setInterval(()=>{ if(_probeReady){ clearInterval(iv); r(true);} },50)}) }

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
    const to = setTimeout(() => { if (!done){ done=true; resolve({ id, durationSec:0, title:'', author:'', url: ytWatchUrl(id) }); } }, 5000);
    try {
      await ensureProbe(); await waitProbeReady();
      const onState = () => {
        try {
          const sec = Math.round(_probe.getDuration?.() || 0);
          if (sec > 0 && !done) {
            done = true; clearTimeout(to);
            const data = _probe.getVideoData?.() || {};
            resolve({ id, durationSec: sec, title: data.title||'', author: data.author||data.videoOwnerChannelTitle||'', url: ytWatchUrl(id) });
          }
        } catch {}
      };
      _probe.addEventListener('onStateChange', onState);
      _probe.cueVideoById({ videoId: id });
    } catch {
      if (!done) { done = true; clearTimeout(to); resolve({ id, durationSec:0, title:'', author:'', url: ytWatchUrl(id) }); }
    }
  });
}

/* ======================= СЕРВЕР ======================= */
async function searchServer(q, minSec) {
  if (!API_BASE && minSec > 0) return null; // серверный фильтр по длительности нужен только когда minSec > 0
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

/* ===================== Клиент: подбор (любой/длинный) ===================== */
function looksValidTitle(s='') {
  const t = (s||'').toLowerCase();
  const STOPWORDS = /(сцена|moment|clip|лучшие|топ|обзор|teaser|trailer|трейлер|тизер|коротк|short|recap|шортс|шорт)/i;
  if (!t) return false;
  if (STOPWORDS.test(t)) return false;
  return true;
}

async function suggestLongformClient({ type='movie', title='', mood='', actor='', limit=SUGGEST_LIMIT_DEFAULT, minSecOverride }={}) {
  const minSec = (typeof minSecOverride === 'number') ? minSecOverride : (type === 'audiobook' ? AUDIOBOOK_MIN_SEC : LONG_MIN_SEC);
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
      if ((minSec === 0 || meta.durationSec >= minSec) && looksValidTitle(meta.title)) {
        out.push(meta);
        if (out.length >= limit) break;
      }
    }
    if (out.length >= limit) break;
  }
  return out;
}

/* ======================= Публичные функции ======================= */
async function playLongform({ type='movie', title='', mood='', actor='', minSecOverride }={}) {
  const minSec = (typeof minSecOverride === 'number') ? minSecOverride : (type === 'audiobook' ? AUDIOBOOK_MIN_SEC : LONG_MIN_SEC);
  const queries = composeQueries({ type, title, mood, actor });

  for (const q of queries) {
    // 1) Клиентский подбор
    const sugg = await suggestLongformClient({ type, title, mood, actor, limit: 1, minSecOverride: minSec });
    if (Array.isArray(sugg) && sugg.length) {
      const best = sugg[0];
      if (best && best.id) { await Player.play(best.id); return true; }
    }

    // 2) Сервер с фильтром, только если нужен порог
    const items = (minSec > 0) ? await searchServer(q, minSec) : null;
    if (Array.isArray(items) && items.length) {
      const got = items.find(x => (x.durationSec||0) >= minSec) || items[0];
      if (got && got.id) { await Player.play(got.id); return true; }
    }
  }

  // 3) Нет подходящих — отдать пустой результат, UI спросит про короткие
  dispatchSuggestions({ type, q: queries[0]||title||'', items: [] });
  return false;
}

async function suggestLongform({ type='movie', title='', mood='', actor='', limit=SUGGEST_LIMIT_DEFAULT, minSecOverride }={}) {
  // P1 fix: учитываем minSecOverride (0 => короткие допустимы)
  const minSec = (typeof minSecOverride === 'number') ? minSecOverride : (type === 'audiobook' ? AUDIOBOOK_MIN_SEC : LONG_MIN_SEC);
  const queries = composeQueries({ type, title, mood, actor });
  const q = queries[0] || title || actor || mood || (type === 'movie' ? 'full movie' : 'аудиокнига полностью');

  // приоритет — клиентский список
  const sugg = await suggestLongformClient({ type, title, mood, actor, limit, minSecOverride: minSec });
  if (sugg.length) {
    const norm = sugg.map(m => ({
      id: m.id, title: m.title, channel: m.author, duration: m.durationSec ? `PT${Math.floor(m.durationSec/3600)}H` : ''
    }));
    dispatchSuggestions({ type, q, items: norm });
    return sugg;
  }

  // сервер только если требуется порог длительности
  if (minSec > 0) {
    const items = await searchServer(q, minSec);
    if (Array.isArray(items) && items.length) {
      const norm = items.map(x => (typeof x === 'string' ? { id:x } : x))
        .filter(x => x.id)
        .map(x => ({ ...x, durationSec: x.durationSec||0, title: x.title||x.snippet?.title||'', channel: x.channelTitle||x.author||'', embedOk:true, url: ytWatchUrl(x.id) }))
        .filter(x => x.durationSec >= minSec);
      if (norm.length) {
        dispatchSuggestions({ type, q, items: norm });
        return norm;
      }
    }
  }

  // пусто — отдаем пустой результат (UI покажет ссылку/спросит про короткие)
  dispatchSuggestions({ type, q, items: [] });
  return [];
}

function dispatchSuggestions(payload) {
  try {
    window.dispatchEvent(new CustomEvent('assistant:pro.suggest.result', { detail: payload }));
  } catch {}
}

/* ===== Слушатели событий ===== */
window.addEventListener('assistant:pro.play', (e) => {
  const d = e?.detail || {};
  playLongform(d).catch(err => console.warn('[longform] play error', err));
});
window.addEventListener('assistant:pro.suggest', (e) => {
  const d = e?.detail || {};
  suggestLongform(d).catch(err => console.warn('[longform] suggest error', err));
});

console.log('[longform] PRO longform v0.5.1 ready');
