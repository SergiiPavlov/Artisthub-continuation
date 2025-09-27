// server/search-fallback.mjs — v1.3.1 (2025-09-27)
// YouTube fallback (Piped → HTML) + oEmbed «встраиваемость»
// Мягкий, но умный title-aware ранжировщик (ядро запроса, Dice, год, письменность, длительность)
// Экспортирует: searchIdsFallback, filterEmbeddable
//
// NOTE: Публичный контракт ответа НЕ меняется. Доп. диагностика — только невидимой метой массива ids.

const DEFAULT_MAX = 25;
const VALID_ID = /^[A-Za-z0-9_-]{11}$/;
const FALLBACK_MULTIPLIER = 3;
const FALLBACK_HARD_CAP = 150;

const CYRILLIC_RE = /[\u0400-\u04FF]/;
const LATIN_RE = /[A-Za-z]/;

const MOVIE_DURATION_MIN = 45 * 60;      // 45m — «длиннее плейлиста»
const MOVIE_STRONG_DURATION = 75 * 60;   // 75m — уверенный полный метр
const MOVIE_MEDIUM_DURATION = 60 * 60;   // 60..74m — ок
const SHORT_STRONG_THRESHOLD = 20 * 60;  // <20m — почти точно «коротыш»

const SCORE_EXPANSION_THRESHOLD = 4;     // при слабом топе — одна попытка расширения
const SCORE_PENALTY_CAP = 3;             // ограничение количества штрафов за маркеры шума

// Стоп-слова, которые убираем из запроса, чтобы выделить «ядро»
const CORE_STOP_PATTERNS = [
  /\bполный фильм\b/g,
  /\bполныйфильм\b/g,
  /\bполный\b/g,
  /\bfull movie\b/g,
  /\bfullmovie\b/g,
  /\bmovie\b/g,
  /\bfilm\b/g,
  /\bфильм\b/g,
  /\bкино\b/g,
];

// Мягкие маркеры «шума» в тайтлах — это не бан, а маленькие минусы (с капом)
const TITLE_NEGATIVE_MARKERS = [
  'trailer', 'тизер', 'серия', 'сезон', 'short', 'shorts', 'клип', 'clips', 'clip',
  'ost', 'amv', 'обзор', 'моменты', 'review', 'episode', 'teaser', 'preview',
  'лучшие моменты', 'best moments'
];

// Мягкие положительные маркеры «это фильм»
const TITLE_POSITIVE_MARKERS = ['полный фильм', 'полныйфильм', 'фильм', 'кино', 'full movie', 'movie', 'film'];

function normalizeTitleText(input = '') {
  let text = String(input || '');
  try { text = text.normalize('NFC'); } catch {}
  text = text.replace(/[“”«»„‟]/g, '"').replace(/[’‘‛]/g, "'");
  text = text.replace(/[\u2010-\u2015\u2212]/g, '-');
  try { text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC'); } catch {}
  text = text.replace(/\u0451/g, 'е').replace(/\u0401/g, 'Е'); // ё→е
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
  if (/(19|20)\d{2}/.test(q)) return true; // год → часто про кино
  if (t.includes('фильм') || t.includes('кино') || t.includes('movie') || t.includes('film')) return true;
  return false;
}

function parseDurationSeconds(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'string') {
    const parts = raw.trim().split(':');
    if (!parts.length || parts.some((p) => !/^\d+$/.test(p))) return null;
    let acc = 0;
    for (const part of parts) acc = acc * 60 + Number(part);
    return Number.isFinite(acc) ? acc : null;
  }
  return null;
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
      out.push({
        id,
        duration: Number.isFinite(item?.duration) ? item.duration : null,
        title: typeof item?.title === 'string' ? item.title : null,
      });
    }
  }
  return out;
}

// Быстрая проверка «встраиваемости» через oEmbed
async function isEmbeddable(id, signal) {
  const u = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`;
  const r = await fetch(u, { signal }).catch(() => null);
  return !!(r && r.ok);
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
  // videoId в JSON (рядом тянем title)
  const reJSON = /"videoId"\s*:\s*"([A-Za-z0-9_-]{11})"/g;
  let m;
  while ((m = reJSON.exec(html)) && out.length < max) {
    const id = m[1];
    if (VALID_ID.test(id)) {
      let title = null;
      const around = html.slice(Math.max(0, m.index - 400), Math.min(html.length, m.index + 400));
      const t1 = around.match(/"title"\s*:\s*\{\s*"runs"\s*:\s*\[\s*\{\s*"text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
      if (t1 && t1[1]) {
        try { title = JSON.parse('"' + t1[1].replace(/"/g, '\\"') + '"'); } catch { title = t1[1]; }
      }
      out.push({ id, duration: null, title });
    }
  }
  // запасной путь: ссылки (без тайтла, чтобы не ловить баги контекста)
  if (out.length < max) {
    const reLink = /\/watch\?v=([A-Za-z0-9_-]{11})/g;
    let m2;
    while ((m2 = reLink.exec(html)) && out.length < max) {
      const id = m2[1];
      if (VALID_ID.test(id)) out.push({ id, duration: null, title: null });
    }
  }
  return uniqById(out).slice(0, max);
}

// Параллельный фильтр «встраиваемости» с сохранением порядка
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

// --------- Ранжирование: ядро запроса, Dice, год, письменность, длительность ---------
function extractQueryCore(normQ) {
  if (!normQ) return '';
  let core = normQ;
  for (const re of CORE_STOP_PATTERNS) core = core.replace(re, ' ');
  core = core.replace(/\s+/g, ' ').trim();
  return core;
}
function tokenize(text) {
  if (!text) return [];
  return text.split(' ').map((t) => t.trim()).filter((t) => t.length > 1);
}
function buildTrigrams(str) {
  if (!str) return [];
  const clean = str.replace(/\s+/g, ' ');
  if (clean.length < 3) return [];
  const grams = [];
  for (let i = 0; i <= clean.length - 3; i++) grams.push(clean.slice(i, i + 3));
  return grams;
}
function diceCoefficient(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = buildTrigrams(a);
  const B = buildTrigrams(b);
  if (!A.length || !B.length) return 0;
  const counts = new Map();
  for (const g of A) counts.set(g, (counts.get(g) || 0) + 1);
  let matches = 0;
  for (const g of B) {
    const c = counts.get(g);
    if (c) {
      matches++;
      if (c === 1) counts.delete(g); else counts.set(g, c - 1);
    }
  }
  return (2 * matches) / (A.length + B.length);
}
function extractYears(text) {
  if (!text) return new Set();
  const years = new Set();
  const m = text.match(/\b(19|20)\d{2}\b/g);
  if (m) for (const y of m) years.add(Number(y));
  return years;
}
function hasScriptMismatch(queryNorm, titleNorm) {
  if (!queryNorm || !titleNorm) return false;
  const qC = CYRILLIC_RE.test(queryNorm), qL = LATIN_RE.test(queryNorm);
  const tC = CYRILLIC_RE.test(titleNorm), tL = LATIN_RE.test(titleNorm);
  if (qC && !tC && tL) return true;
  if (qL && !tL && tC) return true;
  return false;
}

// ----------------- Основной фоллбэк-поиск с улучшенным ранжированием -----------------
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
    const normQ = normalizeTitleText(q);
    const queryCore = extractQueryCore(normQ);
    const coreTokens = tokenize(queryCore);
    const fallbackTokens = tokenize(normQ);
    const queryYears = extractYears(normQ);

    let enriched = combined.map((item, idx) => {
      const duration = Number.isFinite(item?.duration) ? item.duration : null;
      const title = typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : null;
      const normTitle = title ? normalizeTitleText(title) : null;
      return { id: item.id, duration, title, normTitle, idx };
    });

    // Мягкий ранжировщик (без жёстких фильтров)
    function scoreEntry(e) {
      const nt = e.normTitle || '';
      let score = 0;
      let fuzzyScore = 0;
      let yearMatched = false;
      let shortPenaltyHits = 0;

      if (nt) {
        if (queryCore && nt.includes(queryCore)) score += 3;
        for (const t of coreTokens) if (nt.includes(t)) score += 0.75;
        if (!coreTokens.length) for (const t of fallbackTokens) if (nt.includes(t)) score += 0.5;

        const fuzzyBase = queryCore || normQ;
        fuzzyScore = diceCoefficient(nt, fuzzyBase);
        if (fuzzyScore >= 0.8) score += 2;
        else if (fuzzyScore >= 0.6) score += 1;

        if (containsAny(nt, TITLE_POSITIVE_MARKERS)) score += 0.5;

        const titleYears = extractYears(nt);
        if (queryYears.size) {
          let match = false;
          for (const y of queryYears) if (titleYears.has(y)) { match = true; break; }
          if (match) { score += 1; yearMatched = true; }
          else if (titleYears.size) score -= 0.6;
        }

        let penaltyHits = 0;
        for (const marker of TITLE_NEGATIVE_MARKERS) {
          if (nt.includes(marker)) {
            penaltyHits++;
            if (penaltyHits <= SCORE_PENALTY_CAP) score -= 0.35;
          }
        }

        if (hasScriptMismatch(normQ, nt)) score -= 0.4;
      }

      if (movieLike) {
        if (Number.isFinite(e.duration)) {
          if (e.duration >= MOVIE_STRONG_DURATION) score += 1.5;
          else if (e.duration >= MOVIE_MEDIUM_DURATION) score += 0.6;
          else if (e.duration > 0 && e.duration < SHORT_STRONG_THRESHOLD) {
            score -= 1.2;
            shortPenaltyHits++;
          }
        }
      } else if (Number.isFinite(e.duration) && e.duration >= MOVIE_DURATION_MIN) {
        score += 0.3;
      }

      if (!movieLike && !nt && Number.isFinite(e.duration) && e.duration > 0) {
        score += Math.min(e.duration / MOVIE_DURATION_MIN, 1) * 0.2;
      }

      return { ...e, score, fuzzyScore, yearMatched, shortPenaltyHits };
    }

    let scored = enriched.map(scoreEntry);
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const db = Number.isFinite(b.duration) ? b.duration : -1;
      const da = Number.isFinite(a.duration) ? a.duration : -1;
      if (db !== da) return db - da;
      return a.idx - b.idx;
    });

    let topScore = scored[0]?.score ?? 0;

    // Один мягкий догон, если топ слабый
    if (topScore < SCORE_EXPANSION_THRESHOLD && queryCore) {
      const baseSeen = new Set(combined.map((it) => it.id));
      const variants = Array.from(new Set([
        queryCore,
        `${queryCore} фильм`,
        `${queryCore} полный фильм`,
        `${queryCore} full movie`,
      ].map((s) => s.trim()).filter((s) => s && normalizeTitleText(s) !== normQ)));

      for (const variant of variants) {
        if (combined.length >= candidateLimit) break;
        const pipedExtra = await pipedSearch(variant, candidateLimit, ctrl.signal);
        for (const item of pipedExtra) {
          if (combined.length >= candidateLimit) break;
          if (!baseSeen.has(item.id)) { combined.push(item); baseSeen.add(item.id); }
        }
        if (combined.length >= candidateLimit) break;
        const htmlExtra = await htmlSearch(variant, candidateLimit, ctrl.signal);
        for (const item of htmlExtra) {
          if (combined.length >= candidateLimit) break;
          if (!baseSeen.has(item.id)) { combined.push(item); baseSeen.add(item.id); }
        }
      }

      // Пересчёт
      const newEnriched = uniqById(combined).slice(0, candidateLimit).map((item, idx) => {
        const duration = Number.isFinite(item?.duration) ? item.duration : null;
        const title = typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : null;
        const normTitle = title ? normalizeTitleText(title) : null;
        return { id: item.id, duration, title, normTitle, idx };
      });
      scored = newEnriched.map(scoreEntry).sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const db = Number.isFinite(b.duration) ? b.duration : -1;
        const da = Number.isFinite(a.duration) ? a.duration : -1;
        if (db !== da) return db - da;
        return a.idx - b.idx;
      });
      if (scored.length > candidateLimit) scored = scored.slice(0, candidateLimit);
      topScore = scored[0]?.score ?? 0;
    }

    const ids = scored.map((x) => x.id);
    const filtered = await filterEmbeddable(ids, { max: limit, timeoutMs });

    const topId = filtered[0];
    const topEntry = topId ? scored.find((x) => x.id === topId) : null;

    const meta = {
      candidatesTotal: scored.length,
      titleMatched: !!(topEntry && topEntry.score > 0),
      rankTopScore: scored[0]?.score ?? 0,
      fuzzy: topEntry?.fuzzyScore ?? 0,
      yearMatch: !!topEntry?.yearMatched,
      shortPenaltyHits: topEntry?.shortPenaltyHits ?? 0,
    };
    Object.defineProperty(filtered, 'meta', { value: meta, enumerable: false });
    return filtered;
  } finally {
    clearTimeout(to);
  }
}
