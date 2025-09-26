/*
 * yt-pro-provider.js
 * Версия: 1.5.1
 * Правки:
 *  - asVideo: считаем durationSec (ISO и clock-like), пробрасываем его.
 *  - searchOneLong/searchManyLong: жёсткая клиентская фильтрация по durationSec.
 *  - serverSearch: overfetch, безопасный /api суффикс.
 */

const LOG = (...a) => { try { (console.debug||console.log).call(console, "[yt-pro-provider]", ...a)} catch {} };
const CARDS_MAX = (typeof window !== 'undefined' && window.__PRO_CARDS_MAX) ? Number(window.__PRO_CARDS_MAX) : 6;


function smartJoin(parts) { return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim(); }

function parseYears(text) {
  try {
    const t = String(text || '').toLowerCase();
    const mRange = t.match(/(19|20)\d{2}\s*[-–—]\s*(19|20)\d{2}/);
    if (mRange) return { from: parseInt(mRange[0].slice(0,4),10), to: parseInt(mRange[0].slice(-4),10) };
    const mYear = t.match(/\b(19|20)\d{2}\b/);
    if (mYear) return { from: parseInt(mYear[0],10), to: parseInt(mYear[0],10) };
  } catch {}
  return null;
}
function detectGenre(text){
  const s = String(text||'').toLowerCase();
  const map = [
    ['комедия','comedy'], ['ужасы','horror'], ['боевик','action'], ['драма','drama'],
    ['фантастика','sci-fi'], ['фэнтези','fantasy'], ['детектив','detective'],
    ['мелодрама','melodrama'], ['триллер','thriller'], ['приключения','adventure'],
    ['военный','war'], ['исторический','historical'], ['биография','biography']
  ];
  for (const [ru,en] of map) if (s.includes(ru)) return { ru, en };
  return null;
}
function detectCountryLang(text){
  const s = String(text||'').toLowerCase();
  if (/(украинск|укр\b|ua\b)/.test(s)) return { lang: 'ukrainian', tag: 'українською' };
  if (/(русск|ru\b|российск|росія|росіянин)/.test(s)) return { lang: 'russian', tag: 'на русском' };
  if (/(советск|sssr|ссср)/.test(s)) return { tag: 'советский' };
  if (/(english|английск|en\b)/.test(s)) return { lang: 'english', tag: 'in english' };
  return null;
}
function enrichQueryParts(q, type="movie"){
  const parts = [q];
  const g = detectGenre(q);
  const y = parseYears(q);
  const c = detectCountryLang(q);

  // prefer full-length hints
  if (type === 'movie') parts.push('full movie', 'фильм полностью', 'без рекламы');
  if (type === 'audiobook') parts.push('аудиокнига', 'полная версия');

  if (g) parts.push(g.en, g.ru);
  if (y) parts.push(String(y.from), (y.to && y.to!==y.from) ? String(y.to) : '');
  if (c?.tag) parts.push(c.tag);
  if (c?.lang === 'russian') parts.push('русская озвучка');
  if (c?.lang === 'ukrainian') parts.push('український дубляж');

  return parts.filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
}
function decorateQueryByType(q, type) {
  const base = enrichQueryParts(q, type);
  if (type === "movie") return base;
  if (type === "audiobook") return base;
  return base;
}

function parseISO8601Duration(iso){
  if (!iso || typeof iso !== 'string') return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h = parseInt(m[1]||0,10), mm = parseInt(m[2]||0,10), s = parseInt(m[3]||0,10);
  return h*3600 + mm*60 + s;
}
function parseClockLike(s){
  if (!s || typeof s !== 'string') return 0;
  if (!/^\d{1,2}:\d{2}(?::\d{2})?$/.test(s.trim())) return 0;
  const p = s.trim().split(':').map(x=>parseInt(x,10)||0);
  if (p.length === 2) return p[0]*60 + p[1];
  if (p.length === 3) return p[0]*3600 + p[1]*60 + p[2];
  return 0;
}

function asVideo(obj) {
  const id = obj?.id?.videoId || obj?.id || obj?.videoId;
  const title = obj?.snippet?.title || obj?.title || "(без названия)";
  const thumbnail = obj?.snippet?.thumbnails?.medium?.url || obj?.thumbnail || "";
  const channel = obj?.snippet?.channelTitle || obj?.channel || "";
  const iso = obj?.contentDetails?.duration || obj?.duration || ""; // может быть ISO или clock-like
  const secs =
    Number(obj?.durationSec || obj?.duration_seconds || obj?.lengthSeconds || obj?.length_seconds || 0) ||
    (typeof iso === 'string' && /PT/.test(iso) ? parseISO8601Duration(iso) : 0) ||
    (typeof iso === 'string' ? parseClockLike(iso) : 0);

  const duration = iso && /PT/.test(iso) ? iso : (secs ? (secs>=3600
    ? `${Math.floor(secs/3600)}:${String(Math.floor((secs%3600)/60)).padStart(2,'0')}:${String(secs%60).padStart(2,'0')}`
    : `${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}`) : "");

  return { id, videoId: id, title, thumbnail, channel, duration, durationSec: secs };
}

export class YTProProvider {
  constructor(opts = {}) {
    const raw = opts.apiBase || (window.VITE_API_BASE || window.API_BASE || "");
    const base = (raw || "").replace(/\/+$/,'');
    this.apiBase = base ? ( /\/api$/.test(base) ? base : (base + "/api") ) : "/api";
    this.youtubeKey = opts.youtubeKey || window.__YT_API_KEY__ || "";
  }

  buildQuery({ type="movie", title="", mood="", actor="" }) {
    const base = smartJoin([title, actor, mood]);
    return decorateQueryByType(base || (type === "audiobook" ? "аудиокнига" : "фильм"), type);
  }

  buildYouTubeSearchURL(q, type="movie") {
    const full = decorateQueryByType(q, type);
    return "https://www.youtube.com/results?search_query=" + encodeURIComponent(full);
  }

  async serverSearch(q, { type="movie", longOnly=true, limit=CARDS_MAX } = {}) {
    const fetchMax = Math.max(24, Math.min(50, (Number(limit) || 10) * 3));
    const minSec = longOnly ? (type === "audiobook" ? 1800 : 3600) : 0;

    // POST
    try {
      const url = `${this.apiBase.replace(/\/$/, "")}/yt/search`;
      const exclude = Array.isArray(opts?.exclude) ? opts.exclude
  : (typeof window !== 'undefined' && window.__ASSIST_SEEN_IDS && typeof window.__ASSIST_SEEN_IDS.forEach === 'function'
     ? Array.from(window.__ASSIST_SEEN_IDS) : []);
      const body = { 
        q,
        max: fetchMax,
        type,
        videoEmbeddable: true,
        ...(longOnly ? { duration: "long", filters: { durationSecMin: minSec } } : {})
      , exclude };
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "omit" });
      if (res.ok) {
        const data = await res.json();
        const arr = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
        if (arr.length) { const exSet = new Set(Array.isArray(exclude)?exclude:[]); return arr.map(asVideo).filter(v => v && v.id && !exSet.has(v.id)); }
      }
    } catch(e) { LOG("server POST fail:", e); }

    // GET fallback
    try {
      const params = new URLSearchParams();
      params.set("q", q);
      params.set("max", String(fetchMax));
      params.set("videoEmbeddable", "true");
      if (type) params.set("type", type);
      if (longOnly) {
        params.set("duration", "long");
        params.set("durationSecMin", String(minSec));
      const ex = (typeof window!=='undefined' && window.__ASSIST_SEEN_IDS && typeof window.__ASSIST_SEEN_IDS.forEach==='function') ? Array.from(window.__ASSIST_SEEN_IDS) : [];
      ex.forEach(id=>params.append('exclude', id));
      }
      const url = `${this.apiBase.replace(/\/$/, "")}/yt/search?${params}`;
      const res = await fetch(url, { credentials: "omit" });
      if (res.ok) {
        const data = await res.json();
        const arr = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
        if (arr.length) { const exSet = new Set((typeof window!=='undefined' && window.__ASSIST_SEEN_IDS && typeof window.__ASSIST_SEEN_IDS.forEach==='function') ? Array.from(window.__ASSIST_SEEN_IDS) : []); return arr.map(asVideo).filter(v => v && v.id && !exSet.has(v.id)); }
      }
    } catch(e) { LOG("server GET fail:", e); }

    return [];
  }

  async ytSearch(q, { longOnly=true, limit=10 } = {}) {
    if (!this.youtubeKey) return [];
    try {
      const u = new URL("https://www.googleapis.com/youtube/v3/search");
      u.searchParams.set("part", "snippet");
      u.searchParams.set("type", "video");
      u.searchParams.set("maxResults", String(Math.max(1, Math.min(50, limit))));
      u.searchParams.set("q", q);
      if (longOnly) u.searchParams.set("videoDuration", "long");
      u.searchParams.set("videoEmbeddable", "true");
      u.searchParams.set("key", this.youtubeKey);
      const res = await fetch(u.toString());
      const data = await res.json();
      if (!data || !Array.isArray(data.items)) return [];
      return data.items.map(asVideo);
    } catch (e) {
      LOG("ytSearch fail:", e);
      return [];
    }
  }

  // --- strict long-only helpers
  _isLong(item, type){
    const min = type === "audiobook" ? 1800 : 3600;
    return (Number(item?.durationSec)||0) >= min;
  }

  async searchOneLong(q, type="movie") {
    try {
      let arr = await this.serverSearch(q, { type, longOnly: true, limit: 15 });
      if (!arr.length) arr = await this.ytSearch(q, { longOnly: true, limit: 15 });
      // ВАЖНО: клиентский фильтр длинных
      arr = arr.filter(v => this._isLong(v, type));
      return arr[0] || null;
    } catch {
      return null;
    }
  }

  async searchManyLong(q, limit=CARDS_MAX, type="movie") {
    try {
      let arr = await this.serverSearch(q, { type, longOnly: true, limit: limit*3 });
      if (!arr.length) arr = await this.ytSearch(q, { longOnly: true, limit: limit*3 });
      if (!arr.length) arr = await this.searchManyAny(q, limit, type);
      return arr.slice(0, Math.max(1, Math.min(50, limit)));
    } catch { return []; }
  }
}

