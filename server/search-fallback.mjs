// server/search-fallback.mjs — v1.4.1 (2025-09-28)
// Fallback: Piped → HTML, обогащение title/duration, title-aware ранжирование,
// жёсткий анти-short для «кино»-запросов. Публичный контракт не меняется.
// Экспортирует: searchIdsFallback, filterEmbeddable, isMovieQuery.

/* ========================= жёсткие пороги (без ENV) ========================= */
const AUTOPLAY_MIN_SEC = 3600;   // ≥60m считаем длинным (в приоритете для автоплея)
const SHORT_DROP_SEC   = 1200;   // <20m считаем коротышом (кино-режим — прячем)
const HIDE_SHORTS      = true;   // прятать коротыши в «кино»-режиме
const STRICT_UNKNOWN   = true;   // unknown duration на вершине — только при сильном совпадении

/* =============================== константы ================================== */
const DEFAULT_MAX = 25;
const VALID_ID = /^[A-Za-z0-9_-]{11}$/;
const FALLBACK_MULTIPLIER = 3;
const FALLBACK_HARD_CAP = 150;

const CYRILLIC_RE = /[\u0400-\u04FF]/;
const LATIN_RE = /[A-Za-z]/;

const MOVIE_DURATION_MIN     = 45 * 60; // «длинноватый» в общем случае
const MOVIE_STRONG_DURATION  = 75 * 60; // сильный сигнал «фильм»
const MOVIE_MEDIUM_DURATION  = 60 * 60;
const SCORE_EXPANSION_THRESHOLD = 4;    // слабый топ — делаем один расширяющий проход
const SCORE_PENALTY_CAP = 3;            // кап штрафов по «шумовым» словам

// Убираем служебные слова из запроса (ядро названия)
const CORE_STOP_PATTERNS = [
  /\bполный фильм\b/g, /\bполныйфильм\b/g, /\bполный\b/g,
  /\bfull movie\b/g, /\bfullmovie\b/g, /\bmovie\b/g, /\bfilm\b/g,
  /\bфильм\b/g, /\bкино\b/g,
];

// Мягкие шумовые маркеры в тайтлах (накопительный штраф с капом)
const TITLE_NEGATIVE_MARKERS = [
  'trailer','тизер','серия','эпизод','часть','сезон','short','shorts',
  'clip','clips','клип','ost','amv','обзор','моменты','review',
  'episode','teaser','preview','лучшие моменты','best moments','s0','e0'
];

// Мягкие позитивные маркеры «похоже на фильм»
const TITLE_POSITIVE_MARKERS = ['полный фильм','полныйфильм','фильм','кино','full movie','movie','film'];

/* ========================= нормализация и транслит ========================== */
function normalizeTitleText(input = '') {
  let text = String(input || '');
  try { text = text.normalize('NFC'); } catch {}
  text = text.replace(/[“”«»„‟]/g, '"').replace(/[’‘‛]/g, "'");
  text = text.replace(/[\u2010-\u2015\u2212]/g, '-');
  try { text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC'); } catch {}
  // ё → е (для более стабильных совпадений)
  text = text.replace(/\u0451/g, 'е').replace(/\u0401/g, 'Е');
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

const RU2LAT = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'i',
  'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f',
  'х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'
};
function ruToLat(s = '') { let out = ''; for (let i=0;i<s.length;i++) out += (RU2LAT[s[i]] ?? s[i]); return out; }
function makeVariants(norm = '') { const a = norm || ''; const b = ruToLat(a); return b !== a ? [a, b] : [a]; }

function containsAny(text, arr) {
  if (!text) return false;
  const lower = normalizeTitleText(text);
  return arr.some((w) => lower.includes(w));
}

export function isMovieQuery(q = '') {
  const t = normalizeTitleText(q);
  if (!t) return false;
  if (t.includes('полный фильм') || t.includes('full movie')) return true;
  if (/(19|20)\d{2}/.test(q)) return true; // год — частый маркер фильма
  if (t.includes('фильм') || t.includes('кино') || t.includes('movie') || t.includes('film')) return true;
  return false;
}

/* ============================ длительность/форматы =========================== */
function parseDurationSeconds(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'string') {
    const parts = raw.trim().split(':');
    if (!parts.length || parts.some((p) => !/^\d+$/.test(p))) return null;
    let acc = 0; for (const part of parts) acc = acc * 60 + Number(part);
    return Number.isFinite(acc) ? acc : null;
  }
  return null;
}

// "1:23:45" | "1:23" | "02:05" или "1 ч 30 м 5 с" → секунды
function parseClockToSec(raw = '') {
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
    const parts = s.split(':').map((n) => parseInt(n, 10));
    if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
    if (parts.length === 2) return parts[0]*60 + parts[1];
  }
  let h = 0, m = 0, sec = 0;
  const H = s.match(/(\d+)\s*ч/);     if (H) h = parseInt(H[1], 10);
  const M = s.match(/(\d+)\s*м(?!с)/); if (M) m = parseInt(M[1], 10);
  const S = s.match(/(\d+)\s*с/);      if (S) sec = parseInt(S[1], 10);
  if (h || m || sec) return h*3600 + m*60 + sec;
  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

/* ================================= utils ==================================== */
function uniqById(items) {
  const out = []; const seen = new Set();
  for (const item of items) {
    const id = typeof item === 'string' ? item : item?.id;
    if (!id || !VALID_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    if (typeof item === 'string') out.push({ id, duration: null, title: null });
    else out.push({ id, duration: Number.isFinite(item?.duration) ? item.duration : null, title: typeof item?.title === 'string' ? item.title : null });
  }
  return out;
}

/* ============================ embeddability check ============================ */
async function isEmbeddable(id, signal) {
  const u = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`;
  const r = await fetch(u, { signal }).catch(() => null);
  return !!(r && r.ok);
}

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
  const ordered = acceptedIdx.sort((a,b)=>a-b).map((i)=>ids[i]);
  // ultra-safe: если ничего не прошло — вернём оригинальный порядок (для карточек)
  return ordered.length ? ordered.slice(0, limit) : ids.slice(0, limit);
}

/* ================================= источники ================================= */
function getPipedBase() {
  const base = (process.env.PIPED_INSTANCE || '').replace(/\/+$/, '');
  return base || 'https://piped.video';
}

async function pipedSearch(q, max, signal) {
  const base = getPipedBase();
  const regionHint = (process.env.PIPED_REGION_HINT || 'RU').trim();
  const regionParam = CYRILLIC_RE.test(q) && regionHint ? `&region=${encodeURIComponent(regionHint)}` : '';
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
      let durationSec = parseDurationSeconds(it?.durationSeconds ?? it?.duration ?? null);
      if (durationSec == null) durationSec = parseClockToSec(it?.durationText || it?.lengthText || '');
      out.push({ id: vid, duration: Number.isFinite(durationSec) ? durationSec : null, title: typeof it?.title === 'string' ? it.title : null });
    }
    if (out.length >= max) break;
  }
  return uniqById(out);
}

function decodeMaybeJson(str) {
  if (typeof str !== 'string') return null;
  try { return JSON.parse('"' + str.replace(/"/g, '\\"') + '"'); }
  catch { return str; }
}

async function htmlSearch(q, max, signal) {
  const u = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  const r = await fetch(u, { headers: { 'Accept-Language': 'ru,en;q=0.8,uk;q=0.7' }, signal }).catch(() => null);
  if (!r || !r.ok) return [];
  const html = await r.text();
  const out = [];
  // videoId в JSON — подтянем рядом title и lengthText
  const reJSON = /"videoId"\s*:\s*"([A-Za-z0-9_-]{11})"/g;
  let m;
  while ((m = reJSON.exec(html)) && out.length < max) {
    const id = m[1];
    if (!VALID_ID.test(id)) continue;
    let title = null, dur = null;
    const around = html.slice(Math.max(0, m.index - 1000), Math.min(html.length, m.index + 1000));
    const t1 = around.match(/"title"\s*:\s*\{\s*"runs"\s*:\s*\[\s*\{\s*"text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
    const t2 = around.match(/"title"\s*:\s*\{\s*"simpleText"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
    const l1 = around.match(/"lengthText"\s*:\s*\{\s*"simpleText"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
    const l2 = around.match(/"lengthText"\s*:\s*\{\s*"runs"\s*:\s*\[\s*\{\s*"text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
    if (t1 && t1[1]) title = decodeMaybeJson(t1[1]); else if (t2 && t2[1]) title = decodeMaybeJson(t2[1]);
    const durRaw = l1?.[1] ?? l2?.[1] ?? null;
    if (durRaw) dur = parseClockToSec(decodeMaybeJson(durRaw));
    out.push({ id, duration: Number.isFinite(dur) ? dur : null, title });
  }
  // fallback: ссылки без title
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

/* ==================== дозаполнение неизвестных длительностей ================= */
async function enrichUnknownDurations(items, signal) {
  if (!Array.isArray(items) || !items.length) return items;
  const list = items.map((it) => ({
    id: it?.id,
    duration: Number.isFinite(it?.duration) ? it.duration : null,
    title: typeof it?.title === 'string' ? it.title : null,
  }));
  const unknownIdx = [];
  for (let i = 0; i < list.length && unknownIdx.length < 24; i++) {
    const d = Number.isFinite(list[i].duration) ? list[i].duration : null;
    if (!(d && d > 0)) unknownIdx.push(i);
  }
  if (!unknownIdx.length) return list;

  const base = getPipedBase();
  const fetchOne = async (idx) => {
    const id = list[idx]?.id;
    if (!id || !VALID_ID.test(id)) return;
    const resp = await fetch(`${base}/api/v1/videos/${id}`, { signal }).catch(() => null);
    if (!resp || !resp.ok) return;
    const data = await resp.json().catch(() => null);
    if (!data) return;
    let dur = parseDurationSeconds(data?.durationSeconds ?? data?.lengthSeconds ?? data?.length ?? null);
    if (dur == null) dur = parseClockToSec(data?.duration ?? '');
    if (Number.isFinite(dur) && dur > 0) list[idx].duration = dur;
    if (!list[idx].title && typeof data?.title === 'string' && data.title.trim()) list[idx].title = data.title.trim();
  };

  const CONCURRENCY = 4;
  for (let i = 0; i < unknownIdx.length; i += CONCURRENCY) {
    const slice = unknownIdx.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(fetchOne));
  }
  return list;
}

/* ========================= хелперы ранжирования ============================= */
function extractQueryCore(normQ) {
  if (!normQ) return '';
  let core = normQ;
  for (const re of CORE_STOP_PATTERNS) core = core.replace(re, ' ');
  core = core.replace(/\s+/g, ' ').trim();
  return core;
}
function tokenize(text) { return !text ? [] : text.split(' ').map(t=>t.trim()).filter(t=>t.length>1); }
function buildTrigrams(str) { if (!str) return []; const s=str.replace(/\s+/g,' '); if (s.length<3) return []; const g=[]; for(let i=0;i<=s.length-3;i++) g.push(s.slice(i,i+3)); return g; }
function diceCoefficient(a,b){ if(!a||!b) return 0; if(a===b) return 1; const A=buildTrigrams(a),B=buildTrigrams(b); if(!A.length||!B.length) return 0; const cnt=new Map(); for(const g of A) cnt.set(g,(cnt.get(g)||0)+1); let m=0; for(const g of B){ const c=cnt.get(g); if(c){ m++; if(c===1) cnt.delete(g); else cnt.set(g,c-1);} } return (2*m)/(A.length+B.length); }
function extractYears(text){ if(!text) return new Set(); const years=new Set(); const m=text.match(/\b(19|20)\d{2}\b/g); if(m) for(const y of m) years.add(Number(y)); return years; }
function hasScriptMismatch(qNorm, tNorm){ if(!qNorm||!tNorm) return false; const qC=CYRILLIC_RE.test(qNorm), qL=LATIN_RE.test(qNorm); const tC=CYRILLIC_RE.test(tNorm), tL=LATIN_RE.test(tNorm); if(qC && !tC && tL) return true; if(qL && !tL && tC) return true; return false; }

/* ============================== основной фоллбэк ============================= */
export async function searchIdsFallback(q, { max = DEFAULT_MAX, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const limit = Math.max(1, Math.min(FALLBACK_HARD_CAP, Number(max) || DEFAULT_MAX));
    const candidateLimit = Math.max(limit, Math.min(limit * FALLBACK_MULTIPLIER, FALLBACK_HARD_CAP));

    // 1) Piped
    const piped = await pipedSearch(q, candidateLimit, ctrl.signal);
    let combined = piped;

    // 2) если мало — добавим HTML
    if (combined.length < candidateLimit) {
      const html = await htmlSearch(q, candidateLimit, ctrl.signal);
      combined = uniqById([...combined, ...html]).slice(0, candidateLimit);
    }
    if (!combined.length) return [];

    // 3) дозаполним unknown-длительности
    combined = await enrichUnknownDurations(combined, ctrl.signal);

    // 4) подготовка к ранжированию
    const movieLike = isMovieQuery(q);
    const normQ = normalizeTitleText(q);
    const queryCore = extractQueryCore(normQ);
    const coreTokens = tokenize(queryCore);
    const fallbackTokens = tokenize(normQ);
    const queryYears = extractYears(normQ);
    const qVariants = makeVariants(queryCore || normQ);

    let enriched = combined.map((item, idx) => {
      const duration = Number.isFinite(item?.duration) ? item.duration : null;
      const title = typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : null;
      const normTitle = title ? normalizeTitleText(title) : null;
      return { id: item.id, duration, title, normTitle, idx };
    });

    const longExists = enriched.some((e) => Number.isFinite(e.duration) && e.duration >= MOVIE_MEDIUM_DURATION);

    function scoreEntry(e) {
      const nt = e.normTitle || '';
      const ntVariants = makeVariants(nt);
      let score = 0, fuzzyScore = 0, yearMatched = false, shortPenaltyHits = 0, matchedCore = 0;

      if (nt) {
        if (queryCore) { for (const v of ntVariants) { if (v.includes(queryCore)) { score += 3; break; } } }
        for (const tok of coreTokens) { let ok=false; for (const v of ntVariants){ if (v.includes(tok)){ ok=true; break; } } if (ok) matchedCore++; }
        score += matchedCore * 0.75;
        if (!coreTokens.length) {
          for (const tok of fallbackTokens) { let ok=false; for (const v of ntVariants){ if (v.includes(tok)){ ok=true; break; } } if (ok) score += 0.5; }
        }
        // Dice по всем вариантам
        let best = 0; for (const v of ntVariants) for (const b of qVariants) { const d = diceCoefficient(v,b); if (d > best) best = d; }
        fuzzyScore = best; if (fuzzyScore >= 0.8) score += 2; else if (fuzzyScore >= 0.6) score += 1;

        if (containsAny(nt, TITLE_POSITIVE_MARKERS)) score += 0.8;

        const titleYears = extractYears(nt);
        if (queryYears.size) {
          let match = false; for (const y of queryYears) if (titleYears.has(y)) { match = true; break; }
          if (match) { score += 1.2; yearMatched = true; } else if (titleYears.size) score -= 0.6;
        }

        let penaltyHits = 0;
        for (const marker of TITLE_NEGATIVE_MARKERS) {
          if (nt.includes(marker)) { penaltyHits++; if (penaltyHits <= SCORE_PENALTY_CAP) score -= 0.35; }
        }

        if (coreTokens.length >= 2) {
          const coverage = matchedCore / coreTokens.length;
          if (coverage < 0.5) score -= 0.6;
        }

        const anyCoreHit = (coreTokens.length ? matchedCore > 0 : true) || (fuzzyScore >= 0.6) || (queryCore && ntVariants.some(v => v.includes(queryCore)));
        if (!anyCoreHit && hasScriptMismatch(normQ, nt)) score -= 0.4;
      }

      if (movieLike) {
        if (Number.isFinite(e.duration)) {
          if (e.duration >= MOVIE_STRONG_DURATION) score += 1.5;
          else if (e.duration >= MOVIE_MEDIUM_DURATION) score += 0.6;
          else if (e.duration > 0 && e.duration < 15 * 60) { score -= 1.8; shortPenaltyHits++; }
          else if (e.duration > 0 && e.duration < SHORT_DROP_SEC) { score -= 1.2; shortPenaltyHits++; }
        } else if (longExists) {
          score -= 0.4; // если есть длинные — unknown чуть вниз
        }
      } else if (Number.isFinite(e.duration) && e.duration >= MOVIE_DURATION_MIN) {
        score += 0.3;
      }

      if (!movieLike && !nt && Number.isFinite(e.duration) && e.duration > 0) {
        score += Math.min(e.duration / MOVIE_DURATION_MIN, 1) * 0.2;
      }

      const coverage = coreTokens.length ? (matchedCore / coreTokens.length) : 1;
      return { ...e, score, fuzzyScore, yearMatched, shortPenaltyHits, matchedCore, coverage };
    }

    let scored = enriched.map(scoreEntry).sort((a,b)=>{
      if (b.score !== a.score) return b.score - a.score;
      const db = Number.isFinite(b.duration) ? b.duration : -1;
      const da = Number.isFinite(a.duration) ? a.duration : -1;
      if (db !== da) return db - da;
      return a.idx - b.idx;
    });

    let topScore = scored[0]?.score ?? 0;

    // 5) один расширяющий проход, если топ слабый
    if (topScore < SCORE_EXPANSION_THRESHOLD && queryCore) {
      const baseSeen = new Set(combined.map((it) => it.id));
      const variants = Array.from(new Set([
        queryCore,
        `${queryCore} фильм`,
        `${queryCore} полный фильм`,
        `${queryCore} full movie`,
      ].map((s)=>s.trim()).filter((s)=>s && normalizeTitleText(s) !== normQ)));

      for (const variant of variants) {
        if (combined.length >= candidateLimit) break;
        const pipedExtra = await pipedSearch(variant, candidateLimit, ctrl.signal);
        for (const item of pipedExtra) { if (combined.length >= candidateLimit) break; if (!baseSeen.has(item.id)) { combined.push(item); baseSeen.add(item.id); } }
        if (combined.length >= candidateLimit) break;
        const htmlExtra = await htmlSearch(variant, candidateLimit, ctrl.signal);
        for (const item of htmlExtra) { if (combined.length >= candidateLimit) break; if (!baseSeen.has(item.id)) { combined.push(item); baseSeen.add(item.id); } }
      }

      combined = uniqById(combined).slice(0, candidateLimit);
      combined = await enrichUnknownDurations(combined, ctrl.signal);
      enriched = combined.map((item, idx) => {
        const duration = Number.isFinite(item?.duration) ? item.duration : null;
        const title = typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : null;
        const normTitle = title ? normalizeTitleText(title) : null;
        return { id: item.id, duration, title, normTitle, idx };
      });

      scored = enriched.map(scoreEntry).sort((a,b)=>{
        if (b.score !== a.score) return b.score - a.score;
        const db = Number.isFinite(b.duration) ? b.duration : -1;
        const da = Number.isFinite(a.duration) ? a.duration : -1;
        if (db !== da) return db - da;
        return a.idx - b.idx;
      });
      if (scored.length > candidateLimit) scored = scored.slice(0, candidateLimit);
      topScore = scored[0]?.score ?? 0;
    }

    // 6) пред-embeddable «кино»-гейт: выбросить известных коротышей
    if (movieLike) {
      scored = scored.filter((e) => {
        const d = Number.isFinite(e.duration) ? e.duration : null;
        return !(d != null && d > 0 && d < SHORT_DROP_SEC);
      });
    }

    // 7) порядок для автоплея: long → unknown(сильные) → остальное
    const isStrongName = (e) => {
      if (!e || !e.normTitle) return false;
      const ntVariants = makeVariants(e.normTitle);
      const anyCoreToken = coreTokens.some(tok => ntVariants.some(v => v.includes(tok)));
      const strongDice = e.fuzzyScore >= 0.7;
      const coverageOK = e.coverage >= 0.5;
      return coverageOK || strongDice || e.yearMatched || anyCoreToken;
    };

    const long = [], unknown = [], rest = [];
    for (const e of scored) {
      const d = Number.isFinite(e.duration) ? e.duration : null;
      if (d != null && d >= AUTOPLAY_MIN_SEC) long.push(e);
      else if (d == null) {
        if (!STRICT_UNKNOWN || isStrongName(e)) unknown.push(e);
        else rest.push(e);
      } else {
        rest.push(e);
      }
    }
    const byDurDesc = (a,b) => {
      const db = Number.isFinite(b.duration) ? b.duration : -1;
      const da = Number.isFinite(a.duration) ? a.duration : -1;
      if (db !== da) return db - da;
      return a.idx - b.idx;
    };
    long.sort(byDurDesc); rest.sort(byDurDesc);
    const ordered = [...long, ...unknown, ...rest];

    const ids = ordered.map(e => e.id);
    const filtered = await filterEmbeddable(ids, { max: limit, timeoutMs });

    // 8) post-embeddable pruning: ещё раз бережно уберём коротыши
    const byId = new Map(ordered.map(e => [e.id, e]));
    const final = [];
    for (const id of filtered) {
      const e = byId.get(id);
      if (!e) { final.push(id); continue; } // нет меты — не рискуем, оставляем
      const d = Number.isFinite(e.duration) ? e.duration : null;
      if (d != null && d < SHORT_DROP_SEC) {
        if (!HIDE_SHORTS && isStrongName(e)) final.push(id);
        continue;
      }
      if (d == null && STRICT_UNKNOWN && movieLike && !isStrongName(e)) continue;
      final.push(id);
      if (final.length >= limit) break;
    }

    let result = final;
    if (!result.length) {
      // страховка, если всё вычистили слишком строго
      const fallbackIds = ordered
        .filter(e => (Number.isFinite(e.duration) && e.duration >= AUTOPLAY_MIN_SEC) || (e.duration == null && (!STRICT_UNKNOWN || isStrongName(e))))
        .map(e => e.id);
      result = fallbackIds.slice(0, limit);
      if (!result.length) result = filtered.slice(0, limit);
    }

    // 9) meta-подсказки (невидимые в JSON)
    const durationById = {}, titleById = {};
    for (const it of enriched) {
      if (!it?.id || !VALID_ID.test(it.id)) continue;
      if (!Object.prototype.hasOwnProperty.call(durationById, it.id))
        durationById[it.id] = Number.isFinite(it.duration) ? it.duration : null;
      if (typeof it.title === 'string' && it.title && !titleById[it.id])
        titleById[it.id] = it.title;
    }

    const topId = result[0];
    const topEntry = topId ? (byId.get(topId) || scored.find(x => x.id === topId) || null) : null;
    const meta = {
      candidatesTotal: scored.length,
      titleMatched: !!(topEntry && topEntry.score > 0),
      rankTopScore: scored[0]?.score ?? 0,
      fuzzy: topEntry?.fuzzyScore ?? 0,
      yearMatch: !!topEntry?.yearMatched,
      shortSuppressed: ids.length - result.length,
      durationById,
      titleById,
    };
    Object.defineProperty(result, 'meta', { value: meta, enumerable: false });
    return result;
  } finally {
    clearTimeout(to);
  }
}
