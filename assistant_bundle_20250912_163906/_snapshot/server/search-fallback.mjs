// server/search-fallback.mjs — v1.1.1 (2025-09-10)
// YouTube fallback (Piped → HTML) + oEmbed-фильтр на «встраиваемость».
// Экспортирует: searchIdsFallback, filterEmbeddable

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
      : (typeof it?.url === 'string' && (it.url.match(/v=([A-Za-z0-9_-]{11})/)?.[1] || ''));
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
  // Прямые videoId в JSON
  const reJSON = /"videoId"\s*:\s*"([A-Za-z0-9_-]{11})"/g;
  let m;
  while ((m = reJSON.exec(html)) && ids.length < max) {
    const id = m[1];
    if (VALID_ID.test(id)) ids.push(id);
  }
  // Доп. путь: из ссылок
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

// Быстрая проверка «встраиваемости» через oEmbed
async function isEmbeddable(id, signal) {
  const u = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`;
  const r = await fetch(u, { signal }).catch(() => null);
  return !!(r && r.ok);
}

// ⬇⬇⬇ ТЕПЕРЬ ЭКСПОРТИРУЕМ
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

export async function searchIdsFallback(q, { max = DEFAULT_MAX, timeoutMs = 6000 } = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const a = await pipedSearch(q, max, ctrl.signal);
    const base = a.length ? a : await htmlSearch(q, max, ctrl.signal);
    if (!base.length) return [];
    // Гарантируем, что вернём только «встраиваемые» ID
    return await filterEmbeddable(base, { max, timeoutMs });
  } finally {
    clearTimeout(to);
  }
}
