// server/index.mjs — server-v4.5.5-2025-09-13 (prod-ready)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { registerTTS } from './tts.mjs';
import { searchIdsFallback, filterEmbeddable, isMovieQuery } from './search-fallback.mjs';

// ▼ NEW: longform YouTube search route (separate endpoint /api/yt/search-long)
import registerLongSearch from './patches/yt-longsearch.mjs';
// ▼ NEW: Permissions-Policy header helper (for mic in iframes / Android)
import registerPermissionsPolicy from './patches/permissions_policy.mjs';

const app = express();
const PORT = Number(process.env.PORT || 8787);
const VERSION = 'server-v4.5.5-2025-09-13';
const DEBUG_INTENT = String(process.env.DEBUG_INTENT || '') === '1';
// ⭐ Новая переменная: 1 (по умолчанию) — интенты включены; 0 — выключены
const ASSISTANT_INTENTS = String(process.env.ASSISTANT_INTENTS || '1') !== '0';

// ВАЖНО для Render/прокси, чтобы secure-cookies работали
app.set('trust proxy', 1);

// LLM configs (Pro/OpenAI vs Free/Groq/LM Studio back-compat)
const LLM = {
  pro: {
    base: (process.env.PRO_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    key: process.env.PRO_API_KEY || process.env.OPENAI_API_KEY || '',
    model: process.env.PRO_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    name: 'pro',
  },
  free: {
    base: (process.env.FREE_BASE_URL || process.env.LMSTUDIO_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),
    key: process.env.FREE_API_KEY || process.env.LMSTUDIO_API_KEY || 'lm-studio',
    model: process.env.FREE_MODEL || process.env.LMSTUDIO_MODEL || 'llama-3.1-8b-instant',
    name: 'free',
  },
};

// YouTube
const YT_API_KEY = process.env.YT_API_KEY || '';

// --- middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ▼ NEW: set a conservative Permissions-Policy for microphone (useful if app is embedded)
registerPermissionsPolicy(app, {
  origins: [
    'self',
    'https://localhost:5173',
    // добавь свой прод-домен при деплое, например:
    // 'https://your-domain.example'
  ]
});

// ▼ NEW: register server-side long YouTube search (separate endpoint)
registerLongSearch(app, {
  YT_API_KEY: process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY || YT_API_KEY
});

// ─── Server TTS (Piper) — условно ──────────────────────────────────────
const ENABLE_TTS = process.env.ENABLE_TTS_SERVER !== '0' && !!process.env.PIPER_PATH;
if (ENABLE_TTS) {
  registerTTS(app);
} else {
  // ⭐ Возвращаем пустые, но валидные ответы (чтобы не было 404)
  app.get('/api/tts/health', (_req, res) => res.json({ ok: false, disabled: true }));
  app.get('/api/tts/voices', (_req, res) => res.json({ default: '', voices: [] }));
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    llm: {
      pro: { base: LLM.pro.base, model: LLM.pro.model, key_set: !!LLM.pro.key },
      free: { base: LLM.free.base, model: LLM.free.model, key_set: !!LLM.free.key },
    },
    tts: { enabled: ENABLE_TTS },
  });
});

/* ---------------- Память сессий ---------------- */
const memory = new Map(); // sid -> [{role, content}, ...]
const MAX_SRV_HISTORY = 8;

function getSid(req, res) {
  let sid = req.cookies?.sid;
  if (!sid) {
    sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    res.cookie('sid', sid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 864e5,
    });
  }
  return sid;
}
function pushHistory(sid, role, content) {
  const arr = memory.get(sid) || [];
  arr.push({ role, content: String(content || '') });
  while (arr.length > MAX_SRV_HISTORY) arr.shift();
  memory.set(sid, arr);
}

/* ---------------- System + Few-shots (строгий JSON) ------------------ */
const SYSTEM_CORE = `Ты — ассистент музыкальной витрины ArtistsHub.
Отвечай СТРОГО одним JSON-объектом:
{
  "reply": "короткая фраза пользователю",
  "explain": "опционально",
  "actions": [
    {"type":"player","action":"play"|"pause"|"next"|"prev"|"stop"},
    {"type":"mixradio"},
    {"type":"recommend","mood":"happy|calm|sad|energetic","genre":"рок","like":"queen bohemian rhapsody","autoplay":true},
    {"type":"volume","delta":0.1},
    {"type":"play","id":"YOUTUBE_ID_11","query":"artist - song"},
    {"type":"ui","action":"minimize"|"expand"}
  ]
}
Правила:
- «включи <…>» → play.query или recommend.like + autoplay=true.
- «жанр <…>» → recommend.genre (+autoplay=true, если просят включить).
- «пауза/стоп» → player.pause/stop.
- «следующий/предыдущий» → player.next/prev.
- «громче/тише» → volume.delta ±0.1.
- «под настроение» → recommend.mood (+autoplay=true, если это просьба включить).
- «сверни/разверни плеер» → {"type":"ui","action":"minimize|expand"}.
- НЕ выдумывай YouTube ID. Если не уверен — ставь только "query", без "id".
- Никогда не добавляй текст вне JSON. Ответ — только JSON, без пояснений и без тройных бэктиков.
`;

const FEWSHOTS = {
  ru: [
    { role: 'user', content: 'включи джаз' },
    { role: 'assistant', content: JSON.stringify({ reply: 'Включаю джаз.', actions: [{ type: 'recommend', genre: 'джаз', autoplay: true }] }) },
    { role: 'user', content: 'сделай паузу' },
    { role: 'assistant', content: JSON.stringify({ reply: 'Пауза.', actions: [{ type: 'player', action: 'pause' }] }) },
    { role: 'user', content: 'громче' },
    { role: 'assistant', content: JSON.stringify({ reply: 'Громче.', actions: [{ type: 'volume', delta: 0.1 }] }) },
  ],
  en: [
    { role: 'user', content: 'play some jazz' },
    { role: 'assistant', content: JSON.stringify({ reply: 'Playing jazz.', actions: [{ type: 'recommend', genre: 'jazz', autoplay: true }] }) },
    { role: 'user', content: 'pause it' },
    { role: 'assistant', content: JSON.stringify({ reply: 'Paused.', actions: [{ type: 'player', action: 'pause' }] }) },
    { role: 'user', content: 'louder' },
    { role: 'assistant', content: JSON.stringify({ reply: 'Louder.', actions: [{ type: 'volume', delta: 0.1 }] }) },
  ],
  uk: [
    { role: 'user', content: 'увімкни джаз' },
    { role: 'assistant', content: JSON.stringify({ reply: 'Вмикаю джаз.', actions: [{ type: 'recommend', genre: 'джаз', autoplay: true }] }) },
    { role: 'user', content: 'пауза' },
    { role: 'assistant', content: JSON.stringify({ reply: 'Пауза.', actions: [{ type: 'player', action: 'pause' }] }) },
    { role: 'user', content: 'гучніше' },
    { role: 'assistant', content: JSON.stringify({ reply: 'Гучніше.', actions: [{ type: 'volume', delta: 0.1 }] }) },
  ],
};

/* ---------------- Утилиты ---------------- */
function capitalize(s = '') {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
function normalizeAggressive(s = '') {
  let t = String(s || '');
  try { t = t.normalize('NFC'); } catch {}
  t = t.replace(/[‐-―−]/g, '-').replace(/[“”«»„‟]/g, '"').replace(/[’‘‛]/g, "'");
  t = t.replace(/\u0438\u0306/g, '\u0439').replace(/\u0418\u0306/g, '\u0419');
  t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
  t = t.replace(/\u0451/g, '\u0435').replace(/\u0401/g, '\u0415');
  return t.toLowerCase();
}

/* ---------------- Вызов LLM ---------------- */
function pickLLM(provider) {
  const want = String(provider || '').toLowerCase();
  if (want === 'openai' || want === 'pro') { return LLM.pro.key ? LLM.pro : LLM.free; }
  if (want === 'lmstudio' || want === 'groq' || want === 'free') { return LLM.free; }
  // auto
  return LLM.pro.key ? LLM.pro : LLM.free;
}

async function askLLM(messages, cfg) {
  const base = cfg.base;
  const url = `${base}/chat/completions`;
  const payload = { model: cfg.model, messages, temperature: 0.2 };

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.key || 'no-key'}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(to);

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return { reply: '', explain: '', actions: [], _error: `LLM HTTP ${r.status}: ${text.slice(0, 200)}` };
    }

    const j = await r.json().catch(() => ({}));
    const content = j?.choices?.[0]?.message?.content ?? '';
    const clipped = String(content).slice(0, 25000);
    const maybeJson = extractJSONObject(clipped) || clipped;
    const repaired = softRepair(maybeJson);
    if (repaired && typeof repaired === 'object') {
      const reply = String(repaired.reply || '').slice(0, 500);
      const explain = String(repaired.explain || '');
      const actions = Array.isArray(repaired.actions) ? repaired.actions : [];
      return { reply, explain, actions };
    }
    return { reply: '', explain: '', actions: [], _error: 'no-json' };
  } catch (e) {
    clearTimeout(to);
    const msg = e && e.name === 'AbortError' ? 'timeout' : String(e.message || e);
    return { reply: '', explain: '', actions: [], _error: msg };
  }
}

// ⭐ Простой вызов LLM без ожидания JSON — для «обычного чата»
async function askLLMPlain(messages, cfg) {
  const base = cfg.base;
  const url = `${base}/chat/completions`;
  const payload = { model: cfg.model, messages, temperature: 0.2 };

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.key || 'no-key'}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(to);

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return { reply: `LLM error ${r.status}`, explain: text.slice(0, 200), actions: [], _error: `HTTP ${r.status}` };
    }

    const j = await r.json().catch(() => ({}));
    const content = j?.choices?.[0]?.message?.content ?? '';
    return { reply: String(content).slice(0, 2000), explain: '', actions: [] };
  } catch (e) {
    clearTimeout(to);
    const msg = e && e.name === 'AbortError' ? 'timeout' : String(e.message || e);
    return { reply: '', explain: '', actions: [], _error: msg };
  }
}

/* ---------------- Soft-repair JSON ---------------- */
function extractJSONObject(s = '') {
  if (!s) return null;
  let inStr = false, esc = false, depth = 0, start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start !== -1) return s.slice(start, i + 1); }
  }
  return null;
}
function softRepair(text = '') {
  if (!text || typeof text !== 'string') return null;
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '');
  try { return JSON.parse(t); } catch {}
  t = t
    .replace(/([{,]\s*)'([^']+?)'(\s*:)/g, '$1"$2"$3')
    .replace(/:\s*'([^']*?)'/g, ': "$1"')
    .replace(/(\{|,)\s*actions\s*:/g, '$1 "actions":')
    .replace(/,\s*}/g, '}')
    .replace(/,\s*]/g, ']');
  try { return JSON.parse(t); } catch {}
  return null;
}

/* ---------------- Эвристики намерений ---------------- */
function inferActionsFromUser(text = '') {
  const t = normalizeAggressive(text).trim();
  const actions = [];
  if (DEBUG_INTENT) console.log('[intent:text]', t);

  // Транспорт
  if (/(пауза|стоп|останов|pause)/.test(t)) actions.push({ type: 'player', action: 'pause' });
  if (/выключ(и|ай)/.test(t)) actions.push({ type: 'player', action: 'stop' });
  if (/(следующ|друг(ую|ой)|ин(ую|ой)|нов(ую|ый)|another|next|skip|скип)/.test(t)) actions.push({ type: 'player', action: 'next' });
  if (/предыдущ|предыд|prev/.test(t)) actions.push({ type: 'player', action: 'prev' });

  // Громкость
  if (/(громче|louder|volume up|погромче|\bувелич(ь|и) громк)/.test(t)) actions.push({ type: 'volume', delta: +0.1 });
  if (/(тише|quieter|volume down|поменьше|\bуменьш(ь|и) громк)/.test(t)) actions.push({ type: 'volume', delta: -0.1 });

  // Радио и UI
  if (/(mix ?radio|микс ?радио|радио|random)/.test(t)) actions.push({ type: 'mixradio' });
  if (/сверн(и|уть)|minimi[sz]e/.test(t)) actions.push({ type: 'ui', action: 'minimize' });
  if (/(разверн|покажи плеер|открой плеер|expan[ds])/.test(t)) actions.push({ type: 'ui', action: 'expand' });

  const wantsPlay = /(включ|вруби|постав|поставь|запусти|play|сыграй)/.test(t);

  // Настроение
  const isCalm = /(спок|спокои|calm|lofi|lo-fi|chill|relax|ambient)/.test(t);
  if (isCalm) actions.push({ type: 'recommend', mood: 'calm', autoplay: wantsPlay });

  // Жанры
  const gsyn = [
    ['рок', 'рок|rock|альтернативн|альт|гранж|панк|metal|метал|hard rock|classic rock'],
    ['поп', 'поп|pop|dance pop|euro pop|эстрад'],
    ['рэп', 'рэп|rap|hip[- ]?hop|хип[ -]?хоп|drill'],
    ['электрон', 'электрон|electro|edm|house|techno|trance|dnb|drum and bass|dubstep|breakbeat'],
    ['джаз', 'джаз|jazz|swing|bebop'],
    ['блюз', 'блюз|blues'],
    ['классик', 'классик|classical|барокко|симфоническ|оркестр'],
    ['инди', 'инди|indie'],
    ['lofi', 'lofi|ло[- ]?фай'],
    ['ambient', 'ambient|эмбиент'],
    ['шансон', 'шансон'],
    ['folk', 'folk|фолк|кантри|country'],
    ['rnb', 'rnb|r&b|соул|soul'],
    ['latin', 'latin|латино|сальса|бачата|реггетон'],
    ['reggae', 'reggae|регги|ска|ska'],
    ['k-pop', 'k-pop|кей[ -]?поп'],
    ['j-pop', 'j-pop|джей[ -]?поп'],
    ['soundtrack', 'саундтрек|ost|original soundtrack'],
  ];
  for (const [canon, reStr] of gsyn) {
    const re = new RegExp(`\\b(?:${reStr})\\b`, 'i');
    if (re.test(t)) {
      actions.push({ type: 'recommend', genre: canon, autoplay: wantsPlay });
      break;
    }
  }

  // Десятилетия
  const d = t.match(/\b(50|60|70|80|90|2000|2010)(?:-?е|s|х)?\b/);
  if (d) {
    const s = d[1];
    const decade = /^\d{2}$/.test(s) ? `${s}s` : `${s}s`;
    actions.push({ type: 'recommend', decade, autoplay: wantsPlay });
  }

  // Похожее/включи ...
  const like1 = t.match(/(?:похож(ее|е)\s+на|как у|из\s+)(.+)$/i);
  const like2 = t.match(/(?:включи|вруби|поставь|постав|запусти|найди)\s+(.+)/i);
  const like = (like1 && like1[2]) || (like2 && like2[1]);
  if (like) actions.push({ type: 'recommend', like: like.trim(), autoplay: true });

  // Dedup
  const uniq = [];
  const seen = new Set();
  for (const a of actions) {
    const k = JSON.stringify(a);
    if (!seen.has(k)) {
      seen.add(k);
      uniq.push(a);
    }
  }
  return uniq;
}

/* --------- Last-chance fallback if still empty --------- */
function lastChanceActions(text = '') {
  const t = normalizeAggressive(text);
  if (/(спок|спокои|calm|lofi|lo-fi|chill|relax|ambient)/.test(t)) {
    return [{ type: 'play', id: '', query: 'lofi chill beats to relax' }];
  }
  if (/(включ|вруби|постав|поставь|play|сыграй|запусти)/.test(t)) {
    return [{ type: 'mixradio' }];
  }
  return [];
}
function replyForActions(actions = []) {
  if (!actions.length) return '';
  const a = actions[0];
  if (a.type === 'player') {
    if (a.action === 'pause') return 'Пауза.';
    if (a.action === 'stop') return 'Выключаю плеер.';
    if (a.action === 'next') return 'Следующий трек.';
    if (a.action === 'prev') return 'Предыдущий трек.';
    if (a.action === 'play') return 'Играю.';
  }
  if (a.type === 'mixradio') return 'Включаю микс-радио.';
  if (a.type === 'volume') return a.delta > 0 ? 'Громче.' : 'Тише.';
  if (a.type === 'ui') return a.action === 'minimize' ? 'Сворачиваю.' : 'Открываю плеер.';
  if (a.type === 'recommend') {
    if (a.genre) return `Включаю ${capitalize(a.genre)}.`;
    if (a.mood) return `Под настроение: ${capitalize(a.mood)}.`;
    if (a.like) return `Похоже на: ${a.like}.`;
  }
  if (a.type === 'play') return 'Играю.';
  return 'Готово.';
}

/* ---------------- YouTube helpers ---------------- */
async function ytSearchMany(q = '', max = 25) {
  if (!YT_API_KEY || !q) return [];

  const VALID_ID = /^[A-Za-z0-9_-]{11}$/;
  const limit = Math.max(1, Math.min(50, Number(max || 25)));
  const qStr = String(q);

  // Unicode-aware "movie-like" detection (works for RU/UA/EN)
  // NOTE: \b doesn't work for Cyrillic in JS; use \p{L}\p{N} and lookarounds instead
  const MOVIE_LIKE_RE = /(?<![\p{L}\p{N}_])(фильм|фильмы|кино|полный\s*фильм|full\s*movie|movie|сериал(?:ы)?|мультфильм(?:ы)?|аудио\s*книг\w*|аудиокниг\w*|audiobook)(?![\p{L}\p{N}_])/iu;
  const movieLike = MOVIE_LIKE_RE.test(qStr);

  // language/region hint for relevance
  const hasCyr = /[А-Яа-яЁёІіЇїҐґ]/.test(qStr);
  const relevanceLanguage = hasCyr ? 'ru' : 'en';
  const regionCode = hasCyr ? 'RU' : 'US';

  // Title filters
  const NEG_RE = /\b(trailer|teaser|shorts?|коротк|тизер|трейлер|обзор|моменты|сцены|выпуск|серия|серии|best\s*moments|moment|клип|clip|remix|parody|gameplay|walkthrough|обрывок|нарезк|шорт|прикол|юмор)\b/iu;
  const POS_MOV_RE = /\b(полный\s*фильм|full\s*movie|фильм|кино|audiobook|аудио\s*книг\w*)\b/iu;

  // One API step
  async function doSearch(params) {
    const u = new URL('https://www.googleapis.com/youtube/v3/search');
    u.searchParams.set('part', 'id,snippet'); // need titles to filter noise
    u.searchParams.set('type', 'video');
    u.searchParams.set('maxResults', String(limit));
    u.searchParams.set('order', params.order || 'relevance');
    u.searchParams.set('videoEmbeddable', 'true');
    u.searchParams.set('videoSyndicated', 'true'); // better for embeddable
    u.searchParams.set('relevanceLanguage', relevanceLanguage);
    u.searchParams.set('regionCode', regionCode);
    const extra = params.append || '';
    u.searchParams.set('q', (qStr + ' ' + extra).trim());
    u.searchParams.set('key', YT_API_KEY);
    if (params.videoDuration) u.searchParams.set('videoDuration', params.videoDuration); // long/medium/short

    const r = await fetch(String(u)).catch(() => null);
    if (!r || !r.ok) return [];
    const j = await r.json().catch(() => ({}));
    const items = Array.isArray(j?.items) ? j.items : [];
    const out = [];
    for (const it of items) {
      const id = it?.id?.videoId;
      if (!id || !VALID_ID.test(id)) continue;
      const title = String(it?.snippet?.title || '');
      if (NEG_RE.test(title)) continue;
      if (movieLike && !POS_MOV_RE.test(title)) continue;
      out.push(id);
    }
    return out;
  }

  const plan = movieLike
    ? [
        { videoDuration: 'long', order: 'relevance', append: 'full movie полный фильм' },
        { videoDuration: 'long', order: 'viewCount' },
        { /* any */ }
      ]
    : [
        { /* any */ },
        { videoDuration: 'long', order: 'relevance' }
      ];

  const seen = new Set();
  for (const step of plan) {
    const ids = await doSearch(step);
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        if (seen.size >= limit) break;
      }
    }
    if (seen.size >= limit) break;
  }

  return Array.from(seen);
}


/* ---------------- Cache helpers ------------------ */
const __searchCache = new Map(); // key → { ids, exp }
const SEARCH_TTL_MS = 24 * 60 * 60 * 1000; // 24h
function cacheKey(q, max) { return `${q}\u0001${max}`; }
function cacheGet(k) {
  const rec = __searchCache.get(k);
  if (!rec) return null;
  if (Date.now() > rec.exp) { __searchCache.delete(k); return null; }
  return rec.ids || null;
}
function cacheSet(k, ids) { __searchCache.set(k, { ids, exp: Date.now() + SEARCH_TTL_MS }); }

app.get('/api/yt/cache/clear', (_req, res) => {
  const before = __searchCache.size;
  __searchCache.clear();
  res.json({ ok: true, before, after: __searchCache.size });
});
app.get('/api/yt/cache/stats', (_req, res) => {
  res.json({ ok: true, size: __searchCache.size, ttl_ms: SEARCH_TTL_MS });
});


/* ---------------- /api/yt/search ------------------ */
const FILTER_INPUT_MULTIPLIER = 3;
const FILTER_INPUT_CAP = 150;

// 🔧 Жёсткие пороги «кино»-режима в коде (без ENV)
const MOVIE_SHORT_DROP_SEC = 20 * 60;   // < 20m считаем коротышом — убираем
const MOVIE_LONG_THRESHOLD_SEC = 60 * 60; // ≥ 60m считаем «длинным»

app.post('/api/yt/search', async (req, res) => {
  const t0 = Date.now();
  let fallbackUsed = false;           // объявляем выше, чтобы catch мог их видеть
  let fallbackDelivered = false;
  try {
    const q = String(req.body?.q || '').trim();
    const max = Math.max(1, Math.min(50, Number(req.body?.max || 25)));
    const exclude = Array.isArray(req.body?.exclude)
      ? req.body.exclude.filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id))
      : [];
    const shuffle = !!req.body?.shuffle;
    const forceFallback = req.body?.forceFallback === true || req.body?.forceFallback === '1';
    if (!q) return res.status(400).json({ ids: [], error: 'no_query' });

    const movieMode = isMovieQuery(q);

    const key = cacheKey(q, max);
    const cachedRaw = forceFallback ? null : cacheGet(key);
    const cachedMeta = cachedRaw?.meta || null;
    let ids = cachedRaw ? [...cachedRaw] : null;
    const cached = !!ids;
    let fallbackMeta = cachedMeta;

    if (!ids) {
      const candidateSet = new Set();
      const filterLimit = Math.max(max, Math.min(max * FILTER_INPUT_MULTIPLIER, FILTER_INPUT_CAP));
      const fallbackThreshold = Math.max(3, Math.floor(max / 4));

      // 1) основная выдача YouTube (long-first логика уже внутри ytSearchMany)
      if (!forceFallback && typeof YT_API_KEY === 'string' && YT_API_KEY) {
        try {
          const primary = await ytSearchMany(q, Math.min(filterLimit, 50));
          for (const id of primary) candidateSet.add(id);
        } catch (e) {
          console.warn('[yt.search] primary failed', e?.message || e);
        }
      }

      // 2) если мало — добираем надёжным фолбэком
      if (forceFallback || candidateSet.size < fallbackThreshold) {
        fallbackUsed = true;
        try {
          const extra = await searchIdsFallback(q, { max: filterLimit, timeoutMs: 15000 });
          if (extra.length) fallbackDelivered = true;
          fallbackMeta = extra?.meta || fallbackMeta;
          for (const id of extra) candidateSet.add(id);
        } catch (e) {
          console.warn('[yt.search] fallback failed', e?.message || e);
        }
      }

      // 3) и фильтруем «встраиваемость», чтобы плеер не падал
      const candidates = Array.from(candidateSet).slice(0, filterLimit);
      try {
        ids = await filterEmbeddable(candidates, { max, timeoutMs: 15000 });
      } catch (e) {
        console.warn('[yt.search] embeddable filter failed', e?.message || e);
        ids = candidates.slice(0, max);
      }

      // ⭐ Movie-гейт после embeddable: выброс коротышей и long-first (если это «фильм»)
      if (movieMode && Array.isArray(ids) && ids.length) {
        const hints = (fallbackMeta && typeof fallbackMeta.durationById === 'object')
          ? fallbackMeta.durationById
          : null;
        if (hints) {
          const long = [];
          const unknown = [];
          const rest = [];
          for (const id of ids) {
            const raw = hints[id];
            let duration = null;
            if (typeof raw === 'number') {
              duration = Number.isFinite(raw) ? raw : null;
            } else if (typeof raw === 'string' && raw.trim()) {
              const n = Number(raw.trim());
              duration = Number.isFinite(n) ? n : null;
            }
            // убираем явные коротыши
            if (duration != null && duration > 0 && duration < MOVIE_SHORT_DROP_SEC) continue;

            if (duration != null && duration >= MOVIE_LONG_THRESHOLD_SEC) long.push(id);
            else if (duration == null) unknown.push(id);
            else rest.push(id);
          }
          const merged = [...long, ...unknown, ...rest];
          if (merged.length) ids = merged.slice(0, max);
        }
      }

      // прокидываем meta внутрь массива ids (для кеша и последующих ответов)
      if (fallbackMeta) {
        try { Object.defineProperty(ids, 'meta', { value: fallbackMeta, enumerable: false }); } catch {}
      }

      if (ids.length >= 4 && !forceFallback) cacheSet(key, ids);
      if (!ids.length && candidateSet.size) {
        // если фильтр всё равно не смог — вернём необработанные карточки (fallback/primary)
        ids = Array.from(candidateSet).slice(0, max);
      }
    }

    let out = Array.isArray(ids) ? ids.filter((id) => !exclude.includes(id)) : [];
    if (shuffle && out.length > 1) {
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
    }
    out = out.slice(0, max);

    const strategy = (fallbackUsed || forceFallback) ? 'fallback' : 'primary';
    const candidatesTotal = fallbackMeta?.candidatesTotal ?? (strategy === 'primary' ? out.length : 0);
    const titleMatched = !!(fallbackMeta && fallbackMeta.titleMatched);

    return res.json({
      ids: out,
      q,
      took: Date.now() - t0,
      cached: !!cached,
      excluded: exclude.length,
      fallback: fallbackUsed || forceFallback,
      fallbackDelivered,
      strategy,
      candidatesTotal,
      titleMatched,
    });
  } catch (e) {
    console.error('[yt.search] error', e);
    return res.status(500).json({
      ids: [],
      error: 'server_error',
      took: Date.now() - t0,
      strategy: (fallbackUsed || (req?.body?.forceFallback === true || req?.body?.forceFallback === '1')) ? 'fallback' : 'primary',
      candidatesTotal: 0,
      titleMatched: false
    });
  }
});
/* ---------------- Микс-сиды (рандом) ---------------- */
const MIX_SEEDS = [
  'lofi hip hop radio',
  'classic rock hits',
  'best jazz music relaxing',
  'indie rock playlist',
  'hip hop playlist',
  'edm house techno mix',
  'ambient music long playlist',
  'pop hits playlist',
  'latin hits playlist',
  'rnb soul classics playlist',
  'best reggae mix',
];
function randomMixSeed() {
  return MIX_SEEDS[(Math.random() * MIX_SEEDS.length) | 0];
}

/* ---------------- /api/chat ---------------- */
app.post('/api/chat', async (req, res) => {
  const t0 = Date.now();
  try {
    const sid = getSid(req, res);
    const provider = req.body?.provider; // 'pro'|'free'|'openai'|'groq'
    const cfg = pickLLM(provider);

    // 1) «чатовый» формат (messages: [{role, content}, ...]) — обходим интенты
    const bodyMessages = Array.isArray(req.body?.messages) ? req.body.messages : null;
    if (bodyMessages && bodyMessages.length) {
      const result = await askLLMPlain(bodyMessages, cfg);
      pushHistory(sid, 'user', String(bodyMessages[bodyMessages.length - 1]?.content || ''));
      pushHistory(sid, 'assistant', result.reply || '');
      console.log(`[chat:plain-messages] ${Date.now() - t0}ms provider=${cfg.name} err=${result._error || ''}`);
      return res.json({ reply: result.reply || 'Готово.', explain: result.explain || '', actions: [], provider: cfg.name });
    }

    // 2) наш «короткий» формат (message + history)
    const userText = String(req.body?.message || '').trim();
    const clientHist = Array.isArray(req.body?.history) ? req.body.history : [];

    if (!userText) {
      return res.json({ reply: 'Скажи, что включить.', actions: [], provider: cfg.name });
    }

    // Жёсткая фиксация языка от клиента (RU/UK/EN)
    const langHint = String(req.body?.langHint || '').toLowerCase();
    const SYS_LANG =
      langHint === 'ru'
        ? 'Отвечай только по-русски. Не меняй язык при любых обстоятельствах.'
        : langHint === 'uk'
        ? 'Відповідай тільки українською. Не змінюй мову за жодних обставин.'
        : 'Answer only in English. Do not switch languages under any circumstances.';

    const srvHist = memory.get(sid) || [];
    const combined = [...srvHist, ...clientHist.slice(-MAX_SRV_HISTORY)];
    const dedup = [];
    const seen = new Set();
    for (const m of combined) {
      const rec = { role: String(m.role || ''), content: String(m.content || '') };
      const k = JSON.stringify(rec);
      if (!seen.has(k)) { seen.add(k); dedup.push(rec); }
    }

    // Если интенты выключены — сразу plain chat
    if (!ASSISTANT_INTENTS) {
      const messages = [
        { role: 'system', content: 'Ты обычный помощник чата ArtistsHub. Отвечай кратко и по сути.' },
        ...dedup.slice(-MAX_SRV_HISTORY),
        { role: 'user', content: userText },
      ];
      const result = await askLLMPlain(messages, cfg);
      pushHistory(sid, 'user', userText);
      pushHistory(sid, 'assistant', result.reply || '');
      console.log(`[chat:plain-disabled] ${Date.now() - t0}ms provider=${cfg.name} err=${result._error || ''}`);
      return res.json({ reply: result.reply || 'Готово.', explain: result.explain || '', actions: [], provider: cfg.name });
    }

    // Иначе — прежний режим с JSON-инструкциями + эвристики
    const shots = FEWSHOTS[langHint] || FEWSHOTS.en;
    const messages = [
      { role: 'system', content: SYSTEM_CORE },
      { role: 'system', content: 'Не используй китайский/японский/корейский. Отвечай только на RU/UK/EN.' },
      { role: 'system', content: SYS_LANG },
      ...shots,
      ...dedup.slice(-MAX_SRV_HISTORY),
      { role: 'user', content: userText },
    ];

    // 1) ответ модели (ожидаем JSON)
    let data = await askLLM(messages, cfg);

    // 2) эвристика, если пусто
    if (!Array.isArray(data.actions) || data.actions.length === 0) {
      const inferred = inferActionsFromUser(userText);
      if (inferred.length) {
        const reply = replyForActions(inferred);
        data = { reply: reply || data.reply || 'Готово.', explain: data.explain || '', actions: inferred };
        if (DEBUG_INTENT) console.log('[chat:fallback:inferred]', inferred);
      }
    }

    // 3) last-chance
    if (!Array.isArray(data.actions) || data.actions.length === 0) {
      const last = lastChanceActions(userText);
      if (last.length) {
        data = { reply: last.length ? replyForActions(last) : (data.reply || 'Готово.'), explain: data.explain || '', actions: last };
        if (DEBUG_INTENT) console.log('[chat:fallback:lastchance]', last);
      }
    }

    // --- PRO gate: фильмы/аудиокниги доступны только в Pro ---
    try {
      const isFree = (cfg?.name === 'free');

      // плюс фильмы/сериалы/мультфильмы и англ. варианты.
      const PRO_ONLY_RE = /\b(аудио\s*книг\w*|аудиокниг\w*|книг\w*|книжк\w*|audiobook|audio\s*book|фильм\w*|кино|movie|film|сериал\w*|мультфильм\w*|cartoon)\b/iu;

      const textN = normalizeAggressive(userText);
      const acts = Array.isArray(data.actions) ? data.actions : [];
      const mentionsInActs = acts.some(a => {
        const payload = normalizeAggressive(
          [a?.query, a?.like, a?.genre, a?.mood].filter(Boolean).join(' ')
        );
        return (a?.type === 'play' || a?.type === 'recommend') && PRO_ONLY_RE.test(payload);
      });

      if (isFree && (PRO_ONLY_RE.test(textN) || mentionsInActs)) {
        const msg =
          langHint === 'ru'
            ? 'Сейчас бесплатный музыкальный режим: фильмы и аудиокниги недоступны. Переключись на Pro — там можно смотреть и слушать.'
            : langHint === 'uk'
            ? 'Зараз безкоштовний музичний режим: фільми та аудіокниги недоступні. Перемкнись на Pro — там це можна.'
            : 'You are in the free music mode. Movies and audiobooks are available in Pro. Switch to Pro to play them.';
        return res.json({ reply: msg, actions: [], explain: '', provider: cfg.name });
      }
    } catch (e) {
      if (DEBUG_INTENT) console.warn('[pro-gate] failed', e);
    }
    // --- /PRO gate ---

    // ⭐ 4) НОВОЕ: если действий так и нет — «чистый чат» как финальный запасной путь
    if (!Array.isArray(data.actions) || data.actions.length === 0) {
      const plain = await askLLMPlain(
        [
          { role: 'system', content: 'Ты обычный помощник ArtistsHub. Отвечай кратко и дружелюбно.' },
          ...dedup.slice(-MAX_SRV_HISTORY),
          { role: 'user', content: userText },
        ],
        cfg
      );
      data = { reply: plain.reply || 'Готово.', explain: plain.explain || '', actions: [] };
    }

    // 5) enrichment recommend→play (как в v4.4.1)
    const actions = Array.isArray(data.actions) ? data.actions : [];
    const out = [];

    const ensureMoodQuery = (mood) => {
      const mm = normalizeAggressive(mood);
      const map = new Map([
        ['happy', 'upbeat feel good hits'],
        ['calm', 'lofi chill beats to relax'],
        ['sad', 'sad emotional songs playlist'],
        ['energetic', 'high energy workout rock mix'],
      ]);
      return map.get(mm) || 'music playlist';
    };
    const ensureLikeQuery = (like) => {
      const s = (like || '').trim();
      if (!s) return '';
      const words = s.split(/\s+/).filter(Boolean);
      if (words.length <= 2 && !/[-"«»“”„‟]/.test(s)) return `${s} greatest hits playlist`;
      return s;
    };
    const ensureGenreQuery = (genre) => {
      const g = normalizeAggressive(genre);
      const map = new Map([
        ['джаз', 'best jazz music relaxing'],
        ['рок', 'classic rock hits'],
        ['поп', 'pop hits playlist'],
        ['электрон', 'edm house techno mix'],
        ['lofi', 'lofi hip hop radio'],
        ['классик', 'classical symphony playlist'],
        ['рэп', 'hip hop playlist'],
        ['инди', 'indie rock playlist'],
        ['ambient', 'ambient music long playlist'],
        ['блюз', 'best blues songs playlist'],
        ['шансон', 'russian chanson mix'],
        ['folk', 'folk acoustic playlist'],
        ['rnb', 'rnb soul classics playlist'],
        ['latin', 'latin hits playlist'],
        ['reggae', 'best reggae mix'],
        ['k-pop', 'kpop hits playlist'],
        ['j-pop', 'jpop hits playlist'],
        ['soundtrack', 'movie soundtrack playlist'],
      ]);
      return map.get(g) || (g ? `${g} music playlist` : 'music playlist');
    };

    for (const a of actions) {
      if (a?.type === 'mixradio') { out.push({ type: 'play', id: '', query: randomMixSeed() }); continue; }
      if (a?.type === 'recommend' && a.like && a.autoplay) { out.push({ type: 'play', id: '', query: ensureLikeQuery(a.like) }); continue; }
      if (a?.type === 'recommend' && a.mood && a.autoplay) { out.push({ type: 'play', id: '', query: ensureMoodQuery(a.mood) }); continue; }
      if (a?.type === 'recommend' && a.genre && a.autoplay) { out.push({ type: 'play', id: '', query: ensureGenreQuery(a.genre) }); continue; }
      out.push(a);
    }

    // 6) запись истории и ответ
    pushHistory(sid, 'user', userText);
    pushHistory(sid, 'assistant', JSON.stringify({ reply: data.reply || replyForActions(out), actions: out }));

    console.log(`[chat] ${Date.now() - t0}ms  a=${out.length}  provider=${cfg.name}  err=${data._error || ''}`);
    res.json({ reply: data.reply || replyForActions(out) || 'Готово.', explain: data.explain || '', actions: out, provider: cfg.name });
  } catch (e) {
    console.error('[chat] ERROR', e);
    res.status(500).json({
      reply: 'Локальный ИИ не ответил. Я переключусь на простое управление.',
      actions: [],
      provider: 'error',
    });
  }
});

app.listen(PORT, () => {
  console.log(`AI server on http://localhost:${PORT}`);
  console.log(
    `Using PRO(base=${LLM.pro.base}, model=${LLM.pro.model}, key=${LLM.pro.key ? 'set' : 'no'}) | FREE(base=${LLM.free.base}, model=${LLM.free.model})  (${VERSION})`
  );
});
