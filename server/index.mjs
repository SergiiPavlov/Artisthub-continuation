// server/index.mjs (v3)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fetch from 'node-fetch';

const app = express();
const PORT = Number(process.env.PORT || 8787);
const VERSION = 'server-v3-2025-09-08';

// === LLM / YT конфиг ===
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'http://127.0.0.1:1234/v1').replace(/\/+$/,'');
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY || 'lm-studio';
const OPENAI_MODEL    = process.env.OPENAI_MODEL   || 'qwen2.5-7b-instruct';
const YT_API_KEY      = process.env.YT_API_KEY     || ''; // опционально для автоподбора

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

/* ---------------- cookie-сессия и краткая память ---------------- */
const SESS_COOKIE = 'am_sid';
const memory = new Map(); // sid -> [{role, content}]
function getSid(req, res) {
  let sid = req.cookies[SESS_COOKIE];
  if (!sid) {
    sid = Math.random().toString(36).slice(2);
    res.cookie(SESS_COOKIE, sid, { httpOnly: false, sameSite: 'Lax' });
  }
  if (!memory.has(sid)) memory.set(sid, []);
  return sid;
}
function pushHistory(sid, role, content) {
  const arr = memory.get(sid) || [];
  arr.push({ role, content });
  while (arr.length > 14) arr.shift();
  memory.set(sid, arr);
}

/* ---------------- YouTube: поиск только встраиваемых ---------------- */
async function ytSearchFirst(q) {
  if (!YT_API_KEY || !q) return null;
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('key', YT_API_KEY);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', q);
  url.searchParams.set('type', 'video');
  url.searchParams.set('videoEmbeddable', 'true');
  url.searchParams.set('maxResults', '6');
  url.searchParams.set('safeSearch', 'none');
  try {
    const r = await fetch(url.href);
    if (!r.ok) return null;
    const j = await r.json();
    const id = j?.items?.find(x => x?.id?.videoId)?.id?.videoId;
    return id || null;
  } catch { return null; }
}

/* ---------------- СИСТЕМНЫЙ ПРОМПТ + few-shot ---------------- */
const SYSTEM = `
Ты — голосовой музыкальный ассистент на сайте. Отвечай кратко и дружелюбно.
ВЫВОДИ СТРОГО ОДИН JSON-ОБЪЕКТ (без \`\`\`, без текста вокруг):

{
  "reply": "короткий ответ пользователю",
  "explain": "пояснение (опционально)",
  "actions": [
    {"type":"player","action":"play"|"pause"|"next"|"prev"|"stop"},
    {"type":"mixradio"},
    {"type":"recommend","mood":"happy|calm|sad|energetic","genre":"рок","like":"queen bohemian rhapsody","autoplay":true},
    {"type":"volume","delta":0.1},
    {"type":"play","id":"YOUTUBE_ID_11","query":"artist - song"},
    {"type":"minimize"},{"type":"expand"}
  ]
}

Правила:
- «включи <…>» → play.query или recommend.like + autoplay=true.
- «жанр <…>» → recommend.genre (+autoplay=true, если просят включить).
- «пауза/стоп» → player.pause/stop.
- «следующий/предыдущий» → player.next/prev.
- «громче/тише» → volume.delta ±0.1.
- «под настроение» → recommend.mood (+autoplay=true, если это просьба включить).
- «сверни/разверни плеер» → minimize / expand.
- НЕ выдумывай YouTube ID. Если не уверен, ставь только "query", без "id".
`;

const FEWSHOTS = [
  { role: 'user', content: 'включи джаз' },
  { role: 'assistant', content: JSON.stringify({
      reply: 'Включаю джаз.',
      explain: '',
      actions: [{ type:'recommend', genre:'джаз', autoplay:true }]
    })
  },
  { role: 'user', content: 'сделай паузу' },
  { role: 'assistant', content: JSON.stringify({
      reply: 'Пауза.',
      explain: '',
      actions: [{ type:'player', action:'pause' }]
    })
  },
  { role: 'user', content: 'сверни плеер' },
  { role: 'assistant', content: JSON.stringify({
      reply: 'Сворачиваю.',
      explain: '',
      actions: [{ type:'minimize' }]
    })
  }
];

/* ---------------- Робастный разбор JSON ---------------- */
function stripFences(s='') {
  return String(s).trim()
    .replace(/^```json/i, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim();
}
function tryParse(jsonLike) {
  try { return JSON.parse(jsonLike); } catch { return null; }
}
function softRepair(s='') {
  let t = s;

  // распаковать строковый литерал JSON
  if (/^"\{/.test(t) && /\}"$/.test(t)) {
    try { t = JSON.parse(t); } catch {}
  }

  // снять ``` и вырезать первый {...}
  t = stripFences(t);
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a !== -1 && b > a) t = t.slice(a, b + 1);

  // частые косяки
  t = t.replace(/"actions\s*=\s*\[\]"/g, '"actions":[]')
       .replace(/actions\s*=\s*\[\]/g, '"actions":[]')
       .replace(/(\{|,)\s*actions\s*:/g, '$1 "actions":')
       .replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');

  const obj = tryParse(t);
  if (obj) return obj;

  // если reply — это ещё одна строка-JSON
  try {
    const maybe = tryParse(t);
    if (maybe && typeof maybe.reply === 'string') {
      const inner = softRepair(maybe.reply);
      if (inner && (inner.reply || inner.actions)) return inner;
    }
  } catch {}

  return null;
}

/* ---------------- Эвристики (если модель не дала действий) ---------------- */
function inferActionsFromUser(text='') {
  const t = text.toLowerCase();
  const actions = [];
  if (/(пауза|стоп|останов|pause)/.test(t)) actions.push({ type:'player', action:'pause' });
  if (/выключ(и|ай)/.test(t)) actions.push({ type:'player', action:'stop' });
  if (/следующ/.test(t)) actions.push({ type:'player', action:'next' });
  if (/предыдущ|предыд/.test(t)) actions.push({ type:'player', action:'prev' });
  if (/(громче|louder|volume up|погромче)/.test(t)) actions.push({ type:'volume', delta: 0.1 });
  if (/(тише|quieter|volume down|поменьше)/.test(t)) actions.push({ type:'volume', delta: -0.1 });
  if (/(mix ?radio|микс|радио|random)/.test(t)) actions.push({ type:'mixradio' });
  if (/сверн(и|уть)/.test(t)) actions.push({ type:'minimize' });
  if (/(разверн|покажи плеер|открой плеер)/.test(t)) actions.push({ type:'expand' });

  const wantsPlay = /(включ|поставь|запусти|play)/.test(t);
  const moodMap = [
    {re:/(весел|радост|happy|joy)/, mood:'happy'},
    {re:/(спок|chill|calm|relax)/,  mood:'calm'},
    {re:/(груст|печал|sad)/,        mood:'sad'},
    {re:/(энерг|rock|драйв)/,       mood:'energetic'},
  ];
  const m = moodMap.find(x=>x.re.test(t));
  if (m) actions.push({ type:'recommend', mood: m.mood, autoplay: wantsPlay });

  const g = t.match(/жанр\s+([a-zа-яёіїє-]+)/i);
  if (g && g[1]) actions.push({ type:'recommend', genre: g[1], autoplay: wantsPlay });

  const like = t.match(/(?:включи|поставь|запусти|найди)\s+(.+)/i);
  if (like && like[1]) actions.push({ type:'recommend', like: like[1].trim(), autoplay: true });

  if (!g && /джаз/.test(t) && wantsPlay) actions.push({ type:'recommend', genre:'джаз', autoplay:true });

  return actions;
}
function replyForActions(actions=[]) {
  if (!actions.length) return '';
  const a = actions[0];
  if (a.type === 'player') {
    if (a.action === 'pause') return 'Пауза.';
    if (a.action === 'stop')  return 'Выключаю плеер.';
    if (a.action === 'next')  return 'Следующий трек.';
    if (a.action === 'prev')  return 'Предыдущий трек.';
    if (a.action === 'play')  return 'Играю.';
  }
  if (a.type === 'mixradio') return 'Включаю микс-радио.';
  if (a.type === 'volume')   return a.delta > 0 ? 'Громче.' : 'Тише.';
  if (a.type === 'minimize') return 'Сворачиваю.';
  if (a.type === 'expand')   return 'Открываю плеер.';
  if (a.type === 'recommend') {
    if (a.genre) return `Включаю ${a.genre}.`;
    if (a.mood)  return `Подбираю под настроение (${a.mood}).`;
    if (a.like)  return `Ищу и включаю: ${a.like}.`;
  }
  if (a.type === 'play') {
    if (a.query) return `Включаю: ${a.query}.`;
    return 'Включаю трек.';
  }
  return 'Готово.';
}

/* ---------------- Вызов модели ---------------- */
async function askLLM(messages) {
  const url = `${OPENAI_BASE_URL}/chat/completions`;
  const payload = { model: OPENAI_MODEL, messages, temperature: 0.2, top_p: 0.9, max_tokens: 360 };
  const ctrl = new AbortController();
  const to = setTimeout(()=>ctrl.abort(), 20000);

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: ctrl.signal
  }).catch(e => { throw new Error('LLM fetch failed: ' + e.message); });
  clearTimeout(to);

  if (!r.ok) {
    const text = await r.text().catch(()=> '');
    throw new Error(`LLM HTTP ${r.status}: ${text.slice(0,300)}`);
  }

  const j = await r.json();
  const content = j?.choices?.[0]?.message?.content ?? '';
  const repaired = softRepair(content);
  if (repaired && typeof repaired === 'object') {
    const reply = String(repaired.reply || '').slice(0,500);
    const explain = String(repaired.explain || '');
    const actions = Array.isArray(repaired.actions) ? repaired.actions : [];
    return { reply, explain, actions };
  }
  const fallbackText = String(content || 'Готово.').replace(/\s+/g,' ').trim();
  return { reply: fallbackText, explain: '', actions: [] };
}

/* ---------------- Диагностика ---------------- */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: VERSION, model: OPENAI_MODEL, base: OPENAI_BASE_URL });
});

/* ---------------- Основной чат ---------------- */
app.post('/api/chat', async (req, res) => {
  const t0 = Date.now();
  try {
    const sid = getSid(req, res);
    const userText = String(req.body?.message || '').trim();
    const clientHist = Array.isArray(req.body?.history) ? req.body.history : [];
    if (!userText) return res.json({ reply: 'Скажи, что включить.', actions: [] });

    const srvHist = memory.get(sid) || [];
    const messages = [
      { role: 'system', content: SYSTEM },
      ...FEWSHOTS,
      ...srvHist,                             // короткая серверная память
      ...clientHist.slice(-8),                // и клиентская (UI)
      { role: 'user', content: userText }
    ];

    // 1) ответ модели
    let data = await askLLM(messages);

    // 2) если пусто — эвристика по тексту
    if (!Array.isArray(data.actions) || data.actions.length === 0) {
      const inferred = inferActionsFromUser(userText);
      if (inferred.length) {
        const reply = replyForActions(inferred);
        data = { reply: reply || (data.reply || 'Готово.'), explain: data.explain || '', actions: inferred };
      }
    }

    // 3) enrichment:
    //    - play.query → YouTube id
    //    - recommend.genre + autoplay → play.query (по словарю жанров)
    let actions = Array.isArray(data.actions) ? data.actions : [];
    const out = [];
    const ensureGenreQuery = (genre) => {
      const g = (genre || '').toLowerCase();
      const map = new Map([
        ['джаз', 'best jazz music relaxing'],
        ['рок', 'classic rock hits'],
        ['поп', 'pop hits playlist'],
        ['электрон', 'electronic music mix'],
        ['lofi', 'lofi hip hop radio'],
        ['классик', 'classical music playlist'],
      ]);
      // если не нашли — общий запрос
      return map.get(g) || `${g} music`;
    };

    // сначала добавим play из recommend.genre при autoplay
    const hasPlayAlready = actions.some(a => a?.type === 'play');
    const rec = actions.find(a => a?.type === 'recommend' && a.autoplay);
    if (!hasPlayAlready && rec && rec.genre) {
      out.push({ type: 'play', id: null, query: ensureGenreQuery(rec.genre) });
    }

    // скопируем остальные
    for (const a of actions) out.push(a);

    // и наконец прогоним по YouTube
    const enriched = [];
    for (const a of out) {
      if (a?.type === 'play' && !a.id && a.query && YT_API_KEY) {
        const id = await ytSearchFirst(a.query);
        enriched.push(id ? { ...a, id } : a);
      } else {
        enriched.push(a);
      }
    }
    actions = enriched;

    pushHistory(sid, 'user', userText);
    pushHistory(sid, 'assistant', JSON.stringify({ reply: data.reply, actions }));

    console.log(`[chat] ${Date.now()-t0}ms  "${userText.slice(0,60)}"  -> "${(data.reply||'').slice(0,60)}"  a=${actions.length}`);
    res.json({ reply: data.reply || 'Готово.', explain: data.explain || '', actions });
  } catch (e) {
    console.error('[chat] ERROR', e);
    res.status(500).json({ reply: 'Локальный ИИ не ответил. Я переключусь на простое управление.', actions: [] });
  }
});

app.listen(PORT, () => {
  console.log(`AI server on http://localhost:${PORT}`);
  console.log(`Using model="${OPENAI_MODEL}" via ${OPENAI_BASE_URL}  (${VERSION})`);
});
