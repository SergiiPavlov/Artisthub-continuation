// server/search-fallback.mjs — v1.3.6 (2025-09-28)
// YouTube fallback (Piped → HTML) + oEmbed «встраиваемость»
// Title-aware ranking: query core, Dice, year, script, duration, 1-pass expansion
// HARD defaults in code (no ENV): hide shorts, long-first, strict unknown policy for movie-like queries.
// Exports: searchIdsFallback, filterEmbeddable
//
// Public API/contract unchanged. Any diagnostics attached as non-enumerable meta on returned ids array.

// ===== Hard limits (no ENV) =====
const AUTOPLAY_MIN_SEC = 3600;   // ≥60m considered "long" for autoplay
const SHORT_DROP_SEC   = 1200;   // <20m considered "short"
const HIDE_SHORTS      = true;   // fully hide shorts in fallback for movie-like queries
const STRICT_UNKNOWN   = true;   // unknown duration allowed on top only if strong name match

// ===== Core constants =====
const DEFAULT_MAX = 25;
const VALID_ID = /^[A-Za-z0-9_-]{11}$/;
const FALLBACK_MULTIPLIER = 3;
const FALLBACK_HARD_CAP = 150;

const CYRILLIC_RE = /[\u0400-\u04FF]/;
const LATIN_RE = /[A-Za-z]/;

const MOVIE_DURATION_MIN = 45 * 60;      // generic "long-ish"
const MOVIE_STRONG_DURATION = 75 * 60;   // confident feature
const MOVIE_MEDIUM_DURATION = 60 * 60;
const SHORT_STRONG_THRESHOLD = 25 * 60;

const SCORE_EXPANSION_THRESHOLD = 4;     // if weak top — single expansion pass
const SCORE_PENALTY_CAP = 3;             // cap for negative markers

// Stop patterns to extract the query core
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

// Soft noise markers in titles (capped penalties)
const TITLE_NEGATIVE_MARKERS = [
  'trailer','тизер','серия','эпизод','часть','сезон','short','shorts','clip','clips','клип',
  'ost','amv','обзор','моменты','review','episode','teaser','preview','лучшие моменты','best moments',
  's0','e0' // crude nudge against s01e01 patterns (soft)
];

// Soft positive markers "this is a movie"
const TITLE_POSITIVE_MARKERS = ['полный фильм','полныйфильм','фильм','кино','full movie','movie','film'];

// ===== Normalization & translit =====
function normalizeTitleText(input = '') {
  let text = String(input || '');
  try { text = text.normalize('NFC'); } catch {}
  text = text.replace(/[“”«»„‟]/g, '"').replace(/[’‘‛]/g, "'");
  text = text.replace(/[\u2010-\u2015\u2212]/g, '-');
  try { text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC'); } catch {}
  text = text.replace(/\u0451/g, 'е').replace(/\u0401/g, 'Е'); // ё→е
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Simple RU→LAT translit for matching
const RU2LAT = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'i',
  'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f',
  'х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'
};
function ruToLat(s = '') {
  let out = '';
  for (let i = 0; i < s.length; i++) out += (RU2LAT[s[i]] ?? s[i]);
  return out;
}
function makeVariants(norm = '') {
  const a = norm || '';
  const b = ruToLat(a);
  return b !== a ? [a, b] : [a];
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
  if (/(19|20)\d{2}/.test(q)) return true; // year often signals movie
  if (t.includes('фильм') || t.includes('кино') || t.includes('movie') || t.includes('film')) return true;
  return false;
}

// ===== Duration parsing =====
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

// Russian/clock formats for HTML
function parseClockToSec(raw = '') {
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  // hh:mm(:ss) or mm:ss
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
    const parts = s.split(':').map((n) => parseInt(n, 10));
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
  }
  // Russian units
  let h = 0, m = 0, sec = 0;
  const H = s.match(/(\d+)\s*ч/);      if (H) h = parseInt(H[1], 10);
  const M = s.match(/(\d+)\s*м(?!с)/);  if (M) m = parseInt(M[1], 10);
  const S = s.match(/(\d+)\s*с/);       if (S) sec = parseInt(S[1], 10);
  if (h || m || sec) return h * 3600 + m * 60 + sec;
  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

// ===== Utils =====
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

// ===== Embeddability =====
async function isEmbeddable(id, signal) {
  const u = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`;
  const r = await fetch(u, { signal }).catch(() => null);
  return !!(r && r.ok);
}

// ===== Sources =====
async function pipedSearch(q, max, signal) {
  const base = (process.env.PIPED_INSTANCE || '').replace(/\/+$/, '') || 'https://piped.video';
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
      out.push({
        id: vid,
        duration: Number.isFinite(durationSec) ? durationSec : null,
        title: typeof it?.title === 'string' ? it.title : null,
      });
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
  // videoId in JSON — pull title and lengthText nearby
  const reJSON = /"videoId"\s*:\s*"([A-Za-z0-9_-]{11})"/g;
  let m;
  while ((m = reJSON.exec(html)) && out.length < max) {
    const id = m[1];
    if (!VALID_ID.test(id)) continue;
    let title = null;
    let dur = null;
    const around = html.slice(Math.max(0, m.index - 1000), Math.min(html.length, m.index + 1000));
    const t1 = around.match(/"title"\s*:\s*\{\s*"runs"\s*:\s*\[\s*\{\s*"text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
    const l1 = around.match(/"lengthText"\s*:\s*\{\s*"simpleText"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
    const l2 = around.match(/"lengthText"\s*:\s*\{\s*"runs"\s*:\s*\[\s*\{\s*"text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
    if (t1 && t1[1]) title = decodeMaybeJson(t1[1]);
    const durRaw = l1?.[1] ?? l2?.[1] ?? null;
    if (durRaw) dur = parseClockToSec(decodeMaybeJson(durRaw));
    out.push({ id, duration: Number.isFinite(dur) ? dur : null, title });
  }
  // fallback: link scan (no title)
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

// ===== Embeddable filter (order-preserving) =====
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
  // ultra-safe: if nothing survived, keep original order to preserve cards
  if (!ordered.length) return ids.slice(0, limit);
  return ordered.slice(0, limit);
}

// ===== Ranking helpers =====
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

// ===== Main fallback search with stricter anti-short gating =====
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
    const qVariants = makeVariants(queryCore || normQ);

    const enriched = combined.map((item, idx) => {
      const duration = Number.isFinite(item?.duration) ? item.duration : null;
      const title = typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : null;
      const normTitle = title ? normalizeTitleText(title) : null;
      return { id: item.id, duration, title, normTitle, idx };
    });

    const longExists = enriched.some((e) => Number.isFinite(e.duration) && e.duration >= MOVIE_MEDIUM_DURATION);

    function scoreEntry(e) {
      const nt = e.normTitle || '';
      const ntVariants = makeVariants(nt);
      let score = 0;
      let fuzzyScore = 0;
      let yearMatched = false;
      let shortPenaltyHits = 0;
      let matchedCore = 0;

      if (nt) {
        if (queryCore) {
          for (const v of ntVariants) { if (v.includes(queryCore)) { score += 3; break; } }
        }
        for (const tok of coreTokens) {
          let ok = false;
          for (const v of ntVariants) { if (v.includes(tok)) { ok = true; break; } }
          if (ok) matchedCore++;
        }
        score += matchedCore * 0.75;
        if (!coreTokens.length) {
          for (const tok of fallbackTokens) {
            let ok = false;
            for (const v of ntVariants) { if (v.includes(tok)) { ok = true; break; } }
            if (ok) score += 0.5;
          }
        }
        let best = 0;
        for (const v of ntVariants) for (const b of qVariants) {
          const d = diceCoefficient(v, b);
          if (d > best) best = d;
        }
        fuzzyScore = best;
        if (fuzzyScore >= 0.8) score += 2;
        else if (fuzzyScore >= 0.6) score += 1;

        if (containsAny(nt, TITLE_POSITIVE_MARKERS)) score += 0.8;

        const titleYears = extractYears(nt);
        if (queryYears.size) {
          let match = false;
          for (const y of queryYears) if (titleYears.has(y)) { match = true; break; }
          if (match) { score += 1.2; yearMatched = true; } // slightly stronger
          else if (titleYears.size) score -= 0.6;
        }

        let penaltyHits = 0;
        for (const marker of TITLE_NEGATIVE_MARKERS) {
          if (nt.includes(marker)) {
            penaltyHits++;
            if (penaltyHits <= SCORE_PENALTY_CAP) score -= 0.35;
          }
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
          else if (e.duration > 0 && e.duration < 15 * 60) {
            score -= 1.8;
            shortPenaltyHits++;
          } else if (e.duration > 0 && e.duration < SHORT_DROP_SEC) {
            score -= 1.2;
            shortPenaltyHits++;
          }
        } else if (longExists) {
          score -= 0.4; // soft minus for unknown when long videos exist
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

    let scored = enriched.map(scoreEntry);
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const db = Number.isFinite(b.duration) ? b.duration : -1;
      const da = Number.isFinite(a.duration) ? a.duration : -1;
      if (db !== da) return db - da;
      return a.idx - b.idx;
    });

    let topScore = scored[0]?.score ?? 0;

    // Single expansion if top is weak
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

      // Re-score
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

    // ===== Autoplay gating (before embeddable) =====
    const isStrongName = (e) => {
      if (!e || !e.normTitle) return false;
      const ntVariants = makeVariants(e.normTitle);
      const anyCoreToken = coreTokens.some(tok => ntVariants.some(v => v.includes(tok)));
      const strongDice = e.fuzzyScore >= 0.7;
      const coverageOK = e.coverage >= 0.5;
      return coverageOK || strongDice || e.yearMatched || anyCoreToken;
    };

    let ordered = scored;
    if (movieLike) {
      const prefer = [];
      const mid    = [];
      const short  = [];
      for (const e of scored) {
        const d = Number.isFinite(e.duration) ? e.duration : null;
        if (d == null) {
          if (!STRICT_UNKNOWN || isStrongName(e)) mid.push(e); // unknown only mid unless strong
          else short.push(e); // weak unknown treated as short-ish
        } else if (d >= AUTOPLAY_MIN_SEC) {
          prefer.push(e);
        } else if (d >= SHORT_DROP_SEC) {
          mid.push(e);
        } else {
          short.push(e);
        }
      }
      const preferCore = prefer.filter(isStrongName);
      ordered = [
        ...(preferCore.length ? preferCore : prefer),
        ...mid,
        ...(HIDE_SHORTS ? [] : short),
      ];
    }

    const ids = ordered.map((e) => e.id);
    const filtered = await filterEmbeddable(ids, { max: limit, timeoutMs });

    // ===== Post-embeddable pruning (safety) =====
    const byId = new Map(ordered.map(e => [e.id, e]));
    const final = [];
    for (const id of filtered) {
      const e = byId.get(id);
      if (!e) { final.push(id); continue; } // unknown meta — keep
      const d = Number.isFinite(e.duration) ? e.duration : null;
      if (d != null && d < SHORT_DROP_SEC) {
        if (!HIDE_SHORTS && isStrongName(e)) final.push(id); // only if we were not hiding shorts
        continue;
      }
      if (d == null && STRICT_UNKNOWN && movieLike && !isStrongName(e)) continue;
      final.push(id);
      if (final.length >= limit) break;
    }
    // fallback if pruning got too strict
    let result = final;
    if (!result.length) {
      const fallbackIds = ordered
        .filter(e => (Number.isFinite(e.duration) && e.duration >= AUTOPLAY_MIN_SEC) || (e.duration == null && (!STRICT_UNKNOWN || isStrongName(e))))
        .map(e => e.id);
      result = fallbackIds.slice(0, limit);
      if (!result.length) result = filtered.slice(0, limit);
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
    };
    Object.defineProperty(result, 'meta', { value: meta, enumerable: false });
    return result;
  } finally {
    clearTimeout(to);
  }
}
