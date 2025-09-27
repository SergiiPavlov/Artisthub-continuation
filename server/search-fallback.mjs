// server/search-fallback.mjs — v1.2.0 (2025-09-27)
// YouTube fallback (Piped → HTML) + oEmbed-фильтр на «встраиваемость».
// Экспортирует: searchIdsFallback, searchVideosFallback, filterEmbeddable

const DEFAULT_MAX = 25;
const VALID_ID = /^[A-Za-z0-9_-]{11}$/;

function uniq(arr) {
  const out = [];
  const seen = new Set();
  for (const x of arr) if (!seen.has(x)) { seen.add(x); out.push(x); }
  return out;
}

async function pipedSearch(q, max, signal) {
  const base = (process.env.PIPED_INSTANCE || '').replace(/\/+$/, '') || 'https://piped.video';
  const url = `${base}/api/v1/search?q=${encodeURIComponent(q)}&filter=videos`;
  const r = await fetch(url, { signal }).catch(() => null);
  if (!r || !r.ok) return [];
  const j = await r.json().catch(() => null);
  const items = Array.isArray(j?.items) ? j.items : [];
  const ids = [];
  for (const it of items) {
    const vid = (it?.id && VALID_ID.test(it.id)) ? it.id
      : (typeof it?.url === 'string' && (it.url.match(/v=([A-Za-z0-9_-]{11})/)?.[1] || ''))
      : (it?.videoId && VALID_ID.test(it.videoId) ? it.videoId : '');
    if (vid && VALID_ID.test(vid)) ids.push(vid);
    if (ids.length >= max) break;
  }
  return uniq(ids);
}

async function htmlSearch(q, max, signal) {
  const u = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  const r = await fetch(u, { headers: { 'Accept-Language': 'en' }, signal }).catch(() => null);
  if (!r || !r.ok) return [];
  const html = await r.text();
  const ids = [];
  const reJSON = /"videoId"\s*:\s*"([A-Za-z0-9_-]{11})"/g;
  let m;
  while ((m = reJSON.exec(html)) && ids.length < max) {
    const id = m[1];
    if (VALID_ID.test(id)) ids.push(id);
  }
  if (ids.length < max) {
    const reLink = /\/watch\?v=([A-Za-z0-9_-]{11})/g;
    let m2;
    while ((m2 = reLink.exec(html)) && ids.length < max) {
      const id = m2[1];
      if (VALID_ID.test(id)) ids.push(id);
    }
  }
  return uniq(ids).slice(0, max);
}

async function isEmbeddable(id, signal) {
  const u = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`;
  const r = await fetch(u, { signal }).catch(() => null);
  return !!(r && r.ok);
}

function secondsToClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  if (!s) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}

function parseJSONish(str) {
  try { return JSON.parse(str); } catch (e) {
    try {
      const fixed = str.replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => `\\u00${hex}`);
      return JSON.parse(fixed);
    } catch {
      return null;
    }
  }
}

function extractPlayerResponse(html) {
  if (typeof html !== 'string' || !html) return null;
  const re = /ytInitialPlayerResponse\s*=\s*(\{.*?\})\s*;\s*(?:var\s+ytInitialData|<\/script>)/s;
  const m = html.match(re) || html.match(/ytInitialPlayerResponse\s*=\s*(\{.*?\})\s*;/s);
  if (!m) return null;
  return parseJSONish(m[1]);
}

async function fetchVideoMeta(id, signal) {
  if (!id || !VALID_ID.test(id)) return { id };
  const url = `https://www.youtube.com/watch?v=${id}&hl=en`;
  const r = await fetch(url, {
    signal,
    headers: {
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (compatible; ArtistsHubBot/1.0)'
    }
  }).catch(() => null);
  if (!r || !r.ok) return { id };
  const html = await r.text().catch(() => '');
  const data = extractPlayerResponse(html) || {};
  const vd = data?.videoDetails || {};
  const durationSec = Number(vd.lengthSeconds || 0) || 0;
  return {
    id,
    title: String(vd.title || ''),
    channel: String(vd.author || ''),
    durationSec,
    duration: secondsToClock(durationSec),
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
  };
}

async function fetchVideoMetaBatch(ids, { timeoutMs = 6000, concurrency = 3 } = {}) {
  const results = new Map();
  const list = Array.isArray(ids) ? ids.filter((id) => VALID_ID.test(id)) : [];
  if (!list.length) return results;
  let idx = 0;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  const workers = Array.from({ length: Math.max(1, concurrency) }, () => (async () => {
    while (idx < list.length && !ctrl.signal.aborted) {
      const current = idx++;
      const id = list[current];
      if (!id) continue;
      try {
        const meta = await fetchVideoMeta(id, ctrl.signal);
        if (meta && meta.id) results.set(meta.id, meta);
      } catch {}
    }
  })());
  try {
    await Promise.all(workers);
  } catch {}
  clearTimeout(to);
  return results;
}

export async function filterEmbeddable(ids, { max, timeoutMs = 6000, concurrency = 3 } = {}) {
  const out = [];
  let i = 0;
  async function worker(signal) {
    while (i < ids.length && out.length < max) {
      const idx = i++;
      const id = ids[idx];
      const ok = await isEmbeddable(id, signal).catch(() => false);
      if (ok) out.push(id);
    }
  }
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker(ctrl.signal)));
  } finally {
    clearTimeout(to);
  }
  return out.slice(0, max);
}

async function searchIdsFallbackCore(q, { max = DEFAULT_MAX, timeoutMs = 6000 } = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const a = await pipedSearch(q, max, ctrl.signal);
    const base = a.length ? a : await htmlSearch(q, max, ctrl.signal);
    if (!base.length) return [];
    return await filterEmbeddable(base, { max, timeoutMs });
  } finally {
    clearTimeout(to);
  }
}

export async function searchIdsFallback(q, opts = {}) {
  return await searchIdsFallbackCore(q, opts);
}

export async function searchVideosFallback(q, { max = DEFAULT_MAX, timeoutMs = 6000 } = {}) {
  const ids = await searchIdsFallbackCore(q, { max, timeoutMs });
  if (!ids.length) return [];
  const metaMap = await fetchVideoMetaBatch(ids, { timeoutMs });
  return ids.map((id) => {
    const meta = metaMap.get(id) || {};
    const durationSec = Number(meta.durationSec || meta.lengthSeconds || 0) || 0;
    const duration = meta.duration || secondsToClock(durationSec);
    return {
      id,
      title: String(meta.title || ''),
      channel: String(meta.channel || ''),
      durationSec,
      duration,
      thumbnail: meta.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
    };
  });
}
