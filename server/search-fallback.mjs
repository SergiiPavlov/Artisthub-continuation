// server/search-fallback.mjs — v1.2.0 (2025-09-27)
// YouTube fallback (Piped → HTML) + oEmbed-фильтр на «встраиваемость».
// Экспортирует: searchIdsFallback, filterEmbeddable

const DEFAULT_MAX = 25;
const VALID_ID = /^[A-Za-z0-9_-]{11}$/;
const FALLBACK_MULTIPLIER = 3;
const FALLBACK_HARD_CAP = 150;
const CYRILLIC_RE = /[\u0400-\u04FF]/;
const MOVIE_DURATION_MIN = 45 * 60; // 45 minutes
const TITLE_NEG = [
  'trailer','тизер','коротк','обзор','разбор','сцены','сцена','short','shorts','clip','clips',
  'teaser','preview','remix','music video','ost','саундтрек','soundtrack','amv',
  'behind the scenes','deleted scene','episode','серия','серии','season','сезон',
  'best moments','лучшие моменты'
];
const TITLE_POS = ['полный фильм','полныйфильм','фильм','кино','full movie','movie','film'];

function normalizeTitleText(input = '') {
  let text = String(input || '');
  try { text = text.normalize('NFC'); } catch {}
  text = text.replace(/[“”«»„‟]/g, '"').replace(/[’‘‛]/g, "'");
  text = text.replace(/[\u2010-\u2015\u2212]/g, '-');
  try { text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC'); } catch {}
  text = text.replace(/\u0451/g, 'е').replace(/\u0401/g, 'Е');
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}
function containsAny(text, arr) {
  if (!text) return false;
  const lower = normalizeTitleText(text);
  return arr.some((w) => lower.includes(w));
}
function isMovieQuery(q = '') {
  const t = normalizeTitleText(q);
  if (!t) return false;
  if (t.includes('полный фильм') || t.includes('full movie')) return true;
  if (/(19|20)\d{2}/.test(q)) return true;
  if (t.includes('фильм') || t.includes('кино') || t.includes('movie') || t.includes('film')) return true;
  return false;
}


function uniqById(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const id = typeof item === 'string' ? item : item?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (typeof item === 'string') {
      out.push({ id, duration: null, title: null });
    } else {
      out.push({ id, duration: Number.isFinite(item?.duration) ? item.duration : null, title: typeof item?.title === 'string' ? item.title : null });
    }
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
  const regionParam = CYRILLIC_RE.test(q) ? '&region=RU' : '';
  const url = `${base}/api/v1/search?q=${encodeURIComponent(q)}&filter=videos${regionParam}`;
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
        title: typeof it?.title === 'string' ? it.title : null,
      });
    }
    if (out.length >= max) break;
  }
  return uniqById(out);
}

async function htmlSearch(q, max, signal) {
  const u = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  const r = await fetch(u, { headers: { 'Accept-Language': 'ru,en;q=0.8,uk;q=0.7' }, signal }).catch(() => null);
  if (!r || !r.ok) return [];
  const html = await r.text();
  const out = [];
  // Прямые videoId в JSON
  const reJSON = /"videoId"\s*:\s*"([A-Za-z0-9_-]{11})"/g;
  let m;
  while ((m = reJSON.exec(html)) && out.length < max) {
    const id = m[1];
    if (VALID_ID.test(id)) {
      let title = null;
      const around = html.slice(Math.max(0, m.index - 400), Math.min(html.length, m.index + 400));
      const t1 = around.match(/"title"\s*:\s*\{\s*"runs"\s*:\s*\[\s*\{\s*"text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
      if (t1 && t1[1]) {
        try { title = JSON.parse("\"" + t1[1].replace(/"/g,'\\\"') + "\""); } catch { title = t1[1]; }
      }
      out.push({ id, duration: null, title });
    }
  }
  // Доп. путь: из ссылок
  if (out.length < max) {
    const reLink = /\/watch\?v=([A-Za-z0-9_-]{11})/g;
    let m2;
    while ((m2 = reLink.exec(html)) && out.length < max) {
      const id = m2[1];
      if (VALID_ID.test(id)) {
      let title = null;
      const around = html.slice(Math.max(0, m2.index - 400), Math.min(html.length, m2.index + 400));
      const t1 = around.match(/"title"\s*:\s*\{\s*"runs"\s*:\s*\[\s*\{\s*"text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
      if (t1 && t1[1]) {
        try { title = JSON.parse("\"" + t1[1].replace(/"/g,'\\\"') + "\""); } catch { title = t1[1]; }
      }
      out.push({ id, duration: null, title });
    }
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

    const movieLike = isMovieQuery(q);

    let enriched = combined.map((item, idx) => {
      const duration = Number.isFinite(item?.duration) ? item.duration : null;
      const title = typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : null;
      const normTitle = title ? normalizeTitleText(title) : null;
      return { id: item.id, duration, title, normTitle, idx };
    });

    const neg = enriched.filter((x) => !x.normTitle || !containsAny(x.normTitle, TITLE_NEG));
    if (neg.length) enriched = neg;

    if (movieLike) {
      const byLen = enriched.filter((x) => x.duration == null || x.duration >= MOVIE_DURATION_MIN);
      if (byLen.length) enriched = byLen;
    }

    function score(x) {
      if (!x) return 0;
      let s = 0;
      if (x.normTitle) {
        const tokens = normalizeTitleText(q).split(' ').filter(Boolean);
        for (const t of tokens) if (t.length > 1 && x.normTitle.includes(t)) s++;
        if (containsAny(x.normTitle, TITLE_POS)) s += 1;
      }
      if (movieLike) {
        const d = Number.isFinite(x.duration) ? x.duration : -1;
        if (d >= 4200) s += 1;
      }
      return s;
    }

    enriched.sort((a, b) => {
      const sb = score(b), sa = score(a);
      if (sb !== sa) return sb - sa;
      const db = Number.isFinite(b.duration) ? b.duration : -1;
      const da = Number.isFinite(a.duration) ? a.duration : -1;
      if (db !== da) return db - da;
      return a.idx - b.idx;
    });

    const ids = enriched.map((x) => x.id);
    const filtered = await filterEmbeddable(ids, { max: limit, timeoutMs });
    const topId = filtered[0];
    const titleMatched = !!topId && !!enriched.find(e => e.id === topId && score(e) > 0);
    const meta = { candidatesTotal: enriched.length, titleMatched };
    Object.defineProperty(filtered, 'meta', { value: meta, enumerable: false });
    return filtered;
  } finally {
    clearTimeout(to);
  }
