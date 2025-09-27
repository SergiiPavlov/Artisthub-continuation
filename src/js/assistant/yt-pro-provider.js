/*
 * yt-pro-provider.js
 * Версия: 1.6.0
 * Правки:
 *  - asVideo: считаем durationSec (ISO и clock-like), пробрасываем его.
 *  - searchOneLong/searchManyLong: жёсткая клиентская фильтрация по durationSec.
 *  - serverSearch: overfetch, безопасный /api суффикс, учёт fallback-метаданных.
 *  - searchManyAny: безопасный fallback (любой хронометраж, с деталями).
 */

const LOG = (...a) => { try { (console.debug||console.log).call(console, "[yt-pro-provider]", ...a)} catch {} };
const CARDS_MAX = (typeof window !== 'undefined' && window.__PRO_CARDS_MAX) ? Number(window.__PRO_CARDS_MAX) : 6;

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const isDebug = () => { try { return !!window.__ASSIST_LONGFORM_DEBUG__; } catch { return false; } };
const debugLog = (...args) => { if (isDebug()) LOG(...args); };

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
  if (!id) return null;
  const title = obj?.snippet?.title || obj?.title || "(без названия)";
  const thumbnail = obj?.snippet?.thumbnails?.medium?.url || obj?.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  const channel = obj?.snippet?.channelTitle || obj?.channel || "";
  const iso = obj?.contentDetails?.duration || obj?.duration || "";
  const secs =
    Number(obj?.durationSec || obj?.duration_seconds || obj?.lengthSeconds || obj?.length_seconds || 0) ||
    (typeof iso === 'string' && /PT/.test(iso) ? parseISO8601Duration(iso) : 0) ||
    (typeof iso === 'string' ? parseClockLike(iso) : 0);

  const duration = iso && /PT/.test(iso) ? iso : (secs ? (secs>=3600
    ? `${Math.floor(secs/3600)}:${String(Math.floor((secs%3600)/60)).padStart(2,'0')}:${String(secs%60).padStart(2,'0')}`
    : `${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}`) : "");

  return { id, videoId: id, title, thumbnail, channel, duration, durationSec: secs };
}

function collectExclude(rawExclude) {
  const arr = Array.isArray(rawExclude) ? rawExclude : [];
  return arr.filter((id) => typeof id === 'string' && ID_RE.test(id));
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

  async serverSearch(q, opts = {}) {
    const { type = "movie", longOnly = true, limit = CARDS_MAX, exclude = [] } = opts;
    const fetchMax = Math.max(24, Math.min(50, (Number(limit) || 10) * 3));
    const minSec = longOnly ? (type === "audiobook" ? 1800 : 3600) : 0;
    const seenGlobal = (typeof window !== 'undefined' && window.__ASSIST_SEEN_IDS && typeof window.__ASSIST_SEEN_IDS.forEach === 'function')
      ? Array.from(window.__ASSIST_SEEN_IDS).filter((id) => ID_RE.test(id)) : [];
    const excludeList = Array.from(new Set([ ...collectExclude(exclude), ...seenGlobal ]));
    const makeBody = () => ({
      q,
      max: fetchMax,
      type,
      videoEmbeddable: true,
      exclude: excludeList,
      ...(longOnly ? { duration: "long", filters: { durationSecMin: minSec } } : {})
    });

    const toVideoArray = (data) => {
      const exSet = new Set(excludeList);
      const items = Array.isArray(data?.items) ? data.items : [];
      const ids = Array.isArray(data?.ids) ? data.ids.filter((id) => ID_RE.test(id)) : [];
      const mapped = [];
      for (const item of items) {
        const norm = asVideo(item);
        if (norm && norm.id && !exSet.has(norm.id)) {
          mapped.push(norm);
          exSet.add(norm.id);
        }
      }
      for (const id of ids) {
        if (exSet.has(id)) continue;
        const norm = asVideo({ id });
        if (norm && norm.id) {
          mapped.push(norm);
          exSet.add(norm.id);
        }
      }
      return mapped;
    };

    // POST first
    try {
      const url = `${this.apiBase.replace(/\/$/, "")}/yt/search`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeBody()),
        credentials: "omit"
      });
      if (res.ok) {
        const data = await res.json();
        const arr = toVideoArray(data);
        if (arr.length) {
          debugLog('serverSearch:POST-hit', { q, longOnly, count: arr.length, fallback: !!(data?.items && data.items.length) });
          return arr;
        }
      } else {
        debugLog('serverSearch:POST-fail', { q, status: res.status });
      }
    } catch (e) {
      debugLog('serverSearch:POST-error', { q, err: String(e?.message || e) });
    }

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
      }
      excludeList.forEach((id) => params.append('exclude', id));
      const url = `${this.apiBase.replace(/\/$/, "")}/yt/search?${params}`;
      const res = await fetch(url, { credentials: "omit" });
      if (res.ok) {
        const data = await res.json();
        const arr = toVideoArray(data);
        if (arr.length) {
          debugLog('serverSearch:GET-hit', { q, longOnly, count: arr.length, fallback: !!(data?.items && data.items.length) });
          return arr;
        }
      } else {
        debugLog('serverSearch:GET-fail', { q, status: res.status });
      }
    } catch (e) {
      debugLog('serverSearch:GET-error', { q, err: String(e?.message || e) });
    }

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
      return data.items.map(asVideo).filter(Boolean);
    } catch (e) {
      LOG("ytSearch fail:", e);
      return [];
    }
  }

  _isLong(item, type){
    const min = type === "audiobook" ? 1800 : 3600;
    return (Number(item?.durationSec)||0) >= min;
  }

  async searchOneLong(q, type="movie") {
    try {
      let arr = await this.serverSearch(q, { type, longOnly: true, limit: 15 });
      if (!arr.length) arr = await this.ytSearch(q, { longOnly: true, limit: 15 });
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

  async searchManyAny(q, limit=CARDS_MAX, type="movie") {
    try {
      let arr = await this.serverSearch(q, { type, longOnly: false, limit: limit*3 });
      if (!arr.length) arr = await this.ytSearch(q, { longOnly: false, limit: limit*3 });
      return arr.slice(0, Math.max(1, Math.min(50, limit)));
    } catch {
      return [];
    }
  }
}

