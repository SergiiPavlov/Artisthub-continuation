/* 
 * yt-pro-provider.js
 * Версия: 1.2.0 (2025-09-18)
 * Обновления:
 *  - server-first: теперь поддерживает POST /api/yt/search (JSON), затем fallback GET
 *  - добавлен videoEmbeddable=true и в прямой YouTube API
 *  - методы searchManyAny() для коротких
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
  const duration = obj.contentDetails?.duration || obj.duration || "";
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

  /* ===== server-first: POST ===== */
  async serverSearchPOST(q, { type="movie", longOnly=true, limit=10 } = {}) {
    try {
      const url = `${this.apiBase.replace(/\/$/, "")}/yt/search`;
      const body = {
        q,
        max: Math.max(1, Math.min(50, limit)),
        type,
        videoEmbeddable: true,
        duration: longOnly ? "long" : "any"
      };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "omit"
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (Array.isArray(data.items)) return data.items.map(asVideo);
      if (Array.isArray(data)) return data.map(asVideo);
      return [];
    } catch(e) {
      LOG("serverSearchPOST fail:", e);
      return [];
    }
  }

  /* ===== server-first: GET fallback ===== */
  async serverSearchGET(q, { type="movie", longOnly=true, limit=10 } = {}) {
    try {
      const params = new URLSearchParams();
      params.set("q", q);
      params.set("max", String(Math.max(1, Math.min(50, limit))));
      params.set("videoEmbeddable", "true");
      if (longOnly) params.set("duration", "long");
      if (type) params.set("type", type);
      const url = `${this.apiBase.replace(/\/$/, "")}/yt/search?${params.toString()}`;
      const res = await fetch(url, { credentials: "omit" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (Array.isArray(data.items)) return data.items.map(asVideo);
      if (Array.isArray(data)) return data.map(asVideo);
      return [];
    } catch (e) {
      LOG("serverSearchGET fail:", e);
      return [];
    }
  }

  async serverSearch(q, opts) {
    let arr = await this.serverSearchPOST(q, opts);
    if (!arr.length) arr = await this.serverSearchGET(q, opts);
    return arr;
  }

  /* ===== Direct YouTube API fallback ===== */
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

  /* ===== Public API ===== */
  async searchOneLong(q, type="movie") {
    let arr = await this.serverSearch(q, { type, longOnly: true, limit: 10 });
    if (!arr.length) arr = await this.ytSearch(q, { longOnly: true, limit: 10 });
    return arr[0] || null;
  }
  async searchOneAny(q) {
    let arr = await this.serverSearch(q, { longOnly: false, limit: 10 });
    if (!arr.length) arr = await this.ytSearch(q, { longOnly: false, limit: 10 });
    return arr[0] || null;
  }
  async searchManyLong(q, limit=12) {
    let arr = await this.serverSearch(q, { longOnly: true, limit });
    if (!arr.length) arr = await this.ytSearch(q, { longOnly: true, limit });
    return arr.slice(0, limit);
  }
  async searchManyAny(q, limit=12) {
    let arr = await this.serverSearch(q, { longOnly: false, limit });
    if (!arr.length) arr = await this.ytSearch(q, { longOnly: false, limit });
    return arr.slice(0, limit);
  }
}
