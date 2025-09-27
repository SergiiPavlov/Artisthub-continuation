// server/search-fallback.mjs — v1.2.0 (2025-09-27)
// YouTube fallback (Piped → HTML) + oEmbed-фильтр на «встраиваемость».
// Экспортирует: searchIdsFallback, filterEmbeddable

const DEFAULT_MAX = 25;
const VALID_ID = /^[A-Za-z0-9_-]{11}$/;
const FALLBACK_MULTIPLIER = 3;
const FALLBACK_HARD_CAP = 150;

function uniqById(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const id = typeof item === 'string' ? item : item?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (typeof item === 'string') out.push(item);
    else out.push({ id, duration: Number.isFinite(item?.duration) ? item.duration : null });
  }
  return out;
}

function parseDurationSeconds(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parts = trimmed.split(':');
    if (!parts.length || parts.some((p) => !/^\d+$/.test(p))) return null;
    let acc = 0;
    for (const part of parts) acc = acc * 60 + Number(part);
    return Number.isFinite(acc) ? acc : null;
  }
  return null;
}

async function pipedSearch(q, max, signal) {
  const base = (process.env.PIPED_INSTANCE || '').replace(/\/+$/, '') || 'https://piped.video';
  const url = `${base}/api/v1/search?q=${encodeURIComponent(q)}&filter=videos`;
  const r = await fetch(url, { signal }).catch(() => null);
  if (!r || !r.ok) return [];
  const j = await r.json().catch(() => null);
  const items = Array.isArray(j?.items) ? j.items : [];
  const out = [];
  for (const it of items) {
    const vid = (it?.id && VALID_ID.test(it.id)) ? it.id
      : (typeof it?.url === 'string' && (it.url.match(/v=([A-Za-z0-9_-]{11})/)?.[1] || ''));
    if (vid && VALID_ID.test(vid)) {
      out.push({
        id: vid,
        duration: parseDurationSeconds(it?.durationSeconds ?? it?.duration ?? null),
      });
    }
    if (out.length >= max) break;
  }
  return uniqById(out);
}

async function htmlSearch(q, max, signal) {
  const u = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  const r = await fetch(u, { headers: { 'Accept-Language': 'en' }, signal }).catch(() => null);
  if (!r || !r.ok) return [];
  const html = await r.text();
  const out = [];
  // Прямые videoId в JSON
  const reJSON = /"videoId"\s*:\s*"([A-Za-z0-9_-]{11})"/g;
  let m;
  while ((m = reJSON.exec(html)) && out.length < max) {
    const id = m[1];
    if (VALID_ID.test(id)) out.push({ id, duration: null });
  }
  // Доп. путь: из ссылок
  if (out.length < max) {
    const reLink = /\/watch\?v=([A-Za-z0-9_-]{11})/g;
    let m2;
    while ((m2 = reLink.exec(html)) && out.length < max) {
      const id = m2[1];
      if (VALID_ID.test(id)) out.push({ id, duration: null });
    }
  }
  return uniqById(out).slice(0, max);
}

// Быстрая проверка «встраиваемости» через oEmbed
async function isEmbeddable(id, signal) {
  const u = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`;
  const r = await fetch(u, { signal }).catch(() => null);
  return !!(r && r.ok);
}

// ⬇⬇⬇ ТЕПЕРЬ ЭКСПОРТИРУЕМ
export async function filterEmbeddable(ids, { max, timeoutMs = 15000, concurrency = 8 } = {}) {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : ids.length;
  const acceptedIdx = [];
  let cursor = 0;
  async function worker(signal) {
    while (cursor < ids.length && acceptedIdx.length < limit) {
      const idx = cursor++;
      const id = ids[idx];
      const ok = await isEmbeddable(id, signal).catch(() => false);
      if (ok) acceptedIdx.push(idx);
    }
  }
  const ctrl = new AbortController();
  const to = timeoutMs > 0 ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker(ctrl.signal)));
  } finally {
    if (to) clearTimeout(to);
  }
  const ordered = acceptedIdx.sort((a, b) => a - b).map((idx) => ids[idx]);
  return ordered.slice(0, limit);
}

export async function searchIdsFallback(q, { max = DEFAULT_MAX, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const limit = Math.max(1, Math.min(FALLBACK_HARD_CAP, Number(max) || DEFAULT_MAX));
    const candidateLimit = Math.max(limit, Math.min(limit * FALLBACK_MULTIPLIER, FALLBACK_HARD_CAP));

    const piped = await pipedSearch(q, candidateLimit, ctrl.signal);
    let combined = piped;
    if (combined.length < candidateLimit) {
      const html = await htmlSearch(q, candidateLimit, ctrl.signal);
      combined = uniqById([...combined, ...html]).slice(0, candidateLimit);
    }
    if (!combined.length) return [];

    // длинные выше
    combined.sort((a, b) => {
      const da = Number.isFinite(a.duration) ? a.duration : -1;
      const db = Number.isFinite(b.duration) ? b.duration : -1;
      return db - da;
    });

    const ids = combined.map((item) => item.id);
    return await filterEmbeddable(ids, { max: limit, timeoutMs });
  } finally {
    clearTimeout(to);
  }
}
