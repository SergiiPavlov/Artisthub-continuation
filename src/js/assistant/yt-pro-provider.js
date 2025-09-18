/* 
 * yt-pro-provider.js
 * Версия: 1.3.0 (2025-09-18)
 * Новое:
 *  - Проверка длительности через videos.list (server /yt/videos или YouTube API)
 *  - searchOne/ManyLong возвращают реально ДЛИННЫЕ (>=1200 сек), даже если поиск без фильтра нашёл миксы
 *  - server-first: POST /api/yt/search → GET → YouTube API
 */

const LOG = (...a) => { try { (console.debug||console.log).call(console, "[yt-pro-provider]", ...a)} catch {} };

function smartJoin(parts) { return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim(); }
function decorateQueryByType(q, type) {
  if (type === "movie") return smartJoin([q, "фильм", "полностью"]);
  if (type === "audiobook") return smartJoin([q, "аудиокнига", "полная версия"]);
  return q;
}
function isoToSeconds(iso) {
  try {
    const m = String(iso||'').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    return (parseInt(m[1]||0,10)*3600)+(parseInt(m[2]||0,10)*60)+parseInt(m[3]||0,10);
  } catch { return 0; }
}
function asVideo(obj) {
  const id = obj.id?.videoId || obj.id || obj.videoId;
  const title = obj.snippet?.title || obj.title || "(без названия)";
  const thumbnail = obj.snippet?.thumbnails?.medium?.url || obj.thumbnail || "";
  const channel = obj.snippet?.channelTitle || obj.channel || "";
  const duration = obj.contentDetails?.duration || obj.duration || ""; // ISO8601
  return { id, videoId: id, title, thumbnail, channel, duration };
}

export class YTProProvider {
  constructor(opts = {}) {
    this.apiBase = opts.apiBase || (window.VITE_API_BASE || window.API_BASE || "/api");
    this.youtubeKey = opts.youtubeKey || window.__YT_API_KEY__ || "";
    this.minLongSec = 1200; // 20 мин
  }

  buildQuery({ type="movie", title="", mood="", actor="" }) {
    const base = smartJoin([title, actor, mood]);
    return decorateQueryByType(base || (type === "audiobook" ? "аудиокнига" : "фильм"), type);
  }

  buildYouTubeSearchURL(q, type="movie") {
    const full = decorateQueryByType(q, type);
    return "https://www.youtube.com/results?search_query=" + encodeURIComponent(full);
  }

  /* ===== server-first: POST/GET ===== */
  async serverSearch(q, { type="movie", longOnly=true, limit=10 } = {}) {
    // Try POST
    try {
      const url = `${this.apiBase.replace(/\/$/, "")}/yt/search`;
      const body = { q, max: Math.max(1, Math.min(50, limit)), type, videoEmbeddable: true, duration: longOnly ? "long" : "any" };
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "omit" });
      if (res.ok) {
        const data = await res.json();
        const arr = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
        if (arr.length) return arr.map(asVideo);
      }
    } catch(e) { LOG("server POST fail:", e); }
    // Fallback GET
    try {
      const params = new URLSearchParams();
      params.set("q", q); params.set("max", String(Math.max(1, Math.min(50, limit))));
      params.set("videoEmbeddable", "true");
      if (longOnly) params.set("duration", "long");
      if (type) params.set("type", type);
      const url = `${this.apiBase.replace(/\/$/, "")}/yt/search?${params.toString()}`;
      const res = await fetch(url, { credentials: "omit" });
      if (res.ok) {
        const data = await res.json();
        const arr = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
        if (arr.length) return arr.map(asVideo);
      }
    } catch(e) { LOG("server GET fail:", e); }
    return [];
  }

  /* ===== YouTube API search (fallback) ===== */
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

  /* ===== Duration enrichment via videos.list ===== */
  async enrichDurations(items) {
    const ids = Array.from(new Set(items.map(v => v.id).filter(Boolean)));
    if (!ids.length) return items;
    // Try server endpoint /yt/videos
    try {
      const url = `${this.apiBase.replace(/\/$/, "")}/yt/videos`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
        credentials: "omit"
      });
      if (res.ok) {
        const data = await res.json();
        const map = new Map();
        (Array.isArray(data.items) ? data.items : data || []).forEach(it => {
          const id = it.id || it.videoId;
          const dur = it.contentDetails?.duration;
          if (id && dur) map.set(id, dur);
        });
        items.forEach(v => { if (!v.duration && map.has(v.id)) v.duration = map.get(v.id); });
      }
    } catch(e) { LOG("server /yt/videos fail:", e); }

    // Fallback to YouTube API videos.list
    if (this.youtubeKey && items.some(v => !v.duration)) {
      try {
        const u = new URL("https://www.googleapis.com/youtube/v3/videos");
        u.searchParams.set("part", "contentDetails");
        u.searchParams.set("id", ids.join(","));
        u.searchParams.set("key", this.youtubeKey);
        const res = await fetch(u.toString());
        if (res.ok) {
          const data = await res.json();
          const map = new Map();
          (data.items||[]).forEach(it => { if (it.id && it.contentDetails?.duration) map.set(it.id, it.contentDetails.duration); });
          items.forEach(v => { if (!v.duration && map.has(v.id)) v.duration = map.get(v.id); });
        }
      } catch(e) { LOG("yt videos.list fail:", e); }
    }
    return items;
  }

  filterLong(items) {
    return items.filter(v => isoToSeconds(v.duration) >= this.minLongSec);
  }

  /* ===== Public API ===== */
  async searchOneLong(q, type="movie") {
    let arr = await this.serverSearch(q, { type, longOnly: true, limit: 15 });
    if (!arr.length) arr = await this.ytSearch(q, { longOnly: true, limit: 15 });
    if (!arr.length) {
      // second pass without duration, then filter by duration after enrichment
      arr = await this.serverSearch(q, { type, longOnly: false, limit: 15 });
      if (!arr.length) arr = await this.ytSearch(q, { longOnly: false, limit: 15 });
    }
    if (!arr.length) return null;
    arr = await this.enrichDurations(arr);
    const longs = this.filterLong(arr);
    return longs[0] || null;
  }

  async searchOneAny(q) {
    let arr = await this.serverSearch(q, { longOnly: false, limit: 15 });
    if (!arr.length) arr = await this.ytSearch(q, { longOnly: false, limit: 15 });
    return arr[0] || null;
  }

  async searchManyLong(q, limit=12) {
    let arr = await this.serverSearch(q, { longOnly: true, limit });
    if (!arr.length) arr = await this.ytSearch(q, { longOnly: true, limit });
    if (!arr.length) {
      arr = await this.serverSearch(q, { longOnly: false, limit });
      if (!arr.length) arr = await this.ytSearch(q, { longOnly: false, limit });
    }
    if (!arr.length) return [];
    arr = await self.enrichDurations ? await this.enrichDurations(arr) : arr; // guard
    return this.filterLong(arr).slice(0, limit);
  }

  async searchManyAny(q, limit=12) {
    let arr = await this.serverSearch(q, { longOnly: false, limit });
    if (!arr.length) arr = await this.ytSearch(q, { longOnly: false, limit });
    return arr.slice(0, limit);
  }
}
