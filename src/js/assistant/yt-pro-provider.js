/* 
 * yt-pro-provider.js
 * Версия: 1.4.0 (2025-09-18)
 * Правки:
 *  - searchManyLong/OneLong: корректный fallthrough и безопасные try/catch
 *  - buildYouTubeSearchURL: тип учитывается в запросе
 */

const LOG = (...a) => { try { (console.debug||console.log).call(console, "[yt-pro-provider]", ...a)} catch {} };

function smartJoin(parts) { return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim(); }
function decorateQueryByType(q, type) {
  if (type === "movie") return smartJoin([q, "фильм", "полностью"]);
  if (type === "audiobook") return smartJoin([q, "аудиокнига", "полная версия"]);
  return q;
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
  }

  buildQuery({ type="movie", title="", mood="", actor="" }) {
    const base = smartJoin([title, actor, mood]);
    return decorateQueryByType(base || (type === "audiobook" ? "аудиокнига" : "фильм"), type);
  }

  buildYouTubeSearchURL(q, type="movie") {
    const full = decorateQueryByType(q, type);
    return "https://www.youtube.com/results?search_query=" + encodeURIComponent(full);
  }

  async serverSearch(q, { type="movie", longOnly=true, limit=10 } = {}) {
    // POST
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
    // GET
    try {
      const params = new URLSearchParams();
      params.set("q", q); params.set("max", String(Math.max(1, Math.min(50, limit))));
      params.set("videoEmbeddable", "true");
      if (longOnly) params.set("duration", "long");
      if (type) params.set("type", type);
      const url = `${this.apiBase.replace(/\/$/, "")}/yt/search?${params}`;
      const res = await fetch(url, { credentials: "omit" });
      if (res.ok) {
        const data = await res.json();
        const arr = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
        if (arr.length) return arr.map(asVideo);
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

  async searchOneLong(q, type="movie") {
    try {
      let arr = await this.serverSearch(q, { type, longOnly: true, limit: 15 });
      if (!arr.length) arr = await this.ytSearch(q, { longOnly: true, limit: 15 });
      if (!arr.length) {
        arr = await this.serverSearch(q, { type, longOnly: false, limit: 15 });
        if (!arr.length) arr = await this.ytSearch(q, { longOnly: false, limit: 15 });
      }
      return arr[0] || null;
    } catch { return null; }
  }

  async searchManyLong(q, limit=12) {
    try {
      let arr = await this.serverSearch(q, { longOnly: true, limit });
      if (!arr.length) arr = await this.ytSearch(q, { longOnly: true, limit });
      if (!arr.length) {
        arr = await this.serverSearch(q, { longOnly: false, limit });
        if (!arr.length) arr = await this.ytSearch(q, { longOnly: false, limit });
      }
      return arr.slice(0, limit);
    } catch { return []; }
  }

  async searchManyAny(q, limit=12) {
    try {
      let arr = await this.serverSearch(q, { longOnly: false, limit });
      if (!arr.length) arr = await this.ytSearch(q, { longOnly: false, limit });
      return arr.slice(0, limit);
    } catch { return []; }
  }
}
