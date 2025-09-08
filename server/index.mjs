// server/index.mjs — v4.1 (2025‑09‑08) — schema‑aligned
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fetch from 'node-fetch';

const app = express();
const PORT = Number(process.env.PORT || 8787);
const VERSION = 'server-v4.1-2025-09-08';

// === LLM / YT конфиг ===
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'http://127.0.0.1:1234/v1').replace(/\/+$/,'');
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY || 'lm-studio';
const OPENAI_MODEL    = process.env.OPENAI_MODEL   || 'qwen2.5-7b-instruct';
const YT_API_KEY      = process.env.YT_API_KEY     || ''; // опционально для автоподбора YouTube ID

// --- middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version: VERSION, model: OPENAI_MODEL, base: OPENAI_BASE_URL });
});

/* ---------------- Память сессий (короткая) ---------------- */
const memory = new Map(); // sid -> [{role, content}, ...]
const MAX_SRV_HISTORY = 8;

function getSid(req, res) {
  let sid = req.cookies?.sid;
  if (!sid) {
    sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    res.cookie('sid', sid, { httpOnly: false, sameSite: 'lax', maxAge: 7*864e5 });
  }
  return sid;
}

function pushHistory(sid, role, content) {
  const arr = memory.get(sid) || [];
  arr.push({ role, content: String(content || '') });
  while (arr.length > MAX_SRV_HISTORY) arr.shift();
  memory.set(sid, arr);
}

/* ---------------- Система + few‑shots (строгий JSON) ---------------- */
const SYSTEM = `Ты — ассистент музыкальной витрины ArtistsHub.
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
- Никогда не добавляй текст вне JSON. Ответ — только JSON, без пояснений и без ```.
- Если не уверен, верни actions:[] и короткий reply.
`;

const FEWSHOTS = [
  { role: 'user', content: 'включи джаз' },
  { role: 'assistant', content: JSON.stringify({ reply:'Включаю джаз.', actions:[{type:'recommend', genre:'джаз', autoplay:true}] }) },
  { role: 'user', content: 'сделай паузу' },
  { role: 'assistant', content: JSON.stringify({ reply:'Пауза.', actions:[{type:'player', action:'pause'}] }) },
  { role: 'user', content: 'громче' },
  { role: 'assistant', content: JSON.stringify({ reply:'Громче.', actions:[{type:'volume', delta:0.1}] }) },

  { role: 'user', content: 'включи queen' },
  { role: 'assistant', content: JSON.stringify({ reply:'Включаю Queen.', actions:[{type:'recommend', like:'queen', autoplay:true}] }) },
  { role: 'user', content: 'что-нибудь спокойное' },
  { role: 'assistant', content: JSON.stringify({ reply:'Ставлю спокойное.', actions:[{type:'recommend', mood:'calm', autoplay:true}] }) },
  { role: 'user', content: 'жанр рок 80-х' },
  { role: 'assistant', content: JSON.stringify({ reply:'Рок 80-х.', actions:[{type:'recommend', genre:'рок', decade:'80s', autoplay:true}] }) },
  { role: 'user', content: 'похожее на bohemian rhapsody' },
  { role: 'assistant', content: JSON.stringify({ reply:'Похоже на Bohemian Rhapsody.', actions:[{type:'recommend', like:'bohemian rhapsody', autoplay:true}] }) },
  { role: 'user', content: 'сверни плеер' },
  { role: 'assistant', content: JSON.stringify({ reply:'Сворачиваю.', actions:[{type:'ui', action:'minimize'}] }) },
  { role: 'user', content: 'разверни' },
  { role: 'assistant', content: JSON.stringify({ reply:'Открываю плеер.', actions:[{type:'ui', action:'expand'}] }) },
];

/* ---------------- Вызов LLM ---------------- */
async function askLLM(messages) {
  const url = `${OPENAI_BASE_URL}/chat/completions`;
  const payload = { model: OPENAI_MODEL, messages, temperature: 0.2 };

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);

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
  return { reply: 'Готово.', explain: '', actions: [] };
}

/* ---------------- Soft‑repair JSON ---------------- */
function softRepair(text='') {
  if (!text || typeof text !== 'string') return null;
  let t = text.trim();
  // снять тройные бэктики
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/,'');

  // вырезать первый JSON‑объект
  const start = t.indexOf('{'); const end = t.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) t = t.slice(start, end+1);

  const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  let obj = tryParse(t);
  if (obj) return obj;

  // грубые замены кавычек
  t = t.replace(/([{,]\s*)'([^']+?)'(\s*:)/g, '$1"$2"$3')
       .replace(/:\s*'([^']*?)'/g, ': "$1"')
       .replace(/(\{|,)\s*actions\s*:/g, '$1 "actions":')
       .replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');

  obj = tryParse(t);
  return obj;
}

/* ---------------- Эвристики намерений ---------------- */
function inferActionsFromUser(text='') {
  const t = (text || '').toLowerCase().trim();
  const actions = [];

  // Транспорт
  if (/(пауза|стоп|останов|pause)/.test(t)) actions.push({ type:'player', action:'pause' });
  if (/выключ(и|ай)/.test(t)) actions.push({ type:'player', action:'stop' });
  if (/следующ|next/.test(t)) actions.push({ type:'player', action:'next' });
  if (/предыдущ|предыд|prev/.test(t)) actions.push({ type:'player', action:'prev' });

  // Громкость
  if (/(громче|louder|volume up|погромче|\bувелич(ь|и) громк)/.test(t)) actions.push({ type:'volume', delta: +0.1 });
  if (/(тише|quieter|volume down|поменьше|\bуменьш(ь|и) громк)/.test(t)) actions.push({ type:'volume', delta: -0.1 });

  // Радио и UI
  if (/(mix ?radio|микс ?радио|радио|random)/.test(t)) actions.push({ type:'mixradio' });
  if (/сверн(и|уть)|minimi[sz]e/.test(t)) actions.push({ type:'ui', action:'minimize' });
  if (/(разверн|покажи плеер|открой плеер|expan[ds])/.test(t)) actions.push({ type:'ui', action:'expand' });

  const wantsPlay = /(включ|поставь|запусти|play|сыграй)/.test(t);

  // Настроение
  const moodMap = [
    {re:/(весел|радост|happy|joy|бодр|энергич)/, mood:'happy'},
    {re:/(спокойн|чайл|lo-?fi|чил|calm|ambient|медитатив)/, mood:'calm'},
    {re:/(груст|печал|sad)/, mood:'sad'},
    {re:/(энергетик|движ|трен|спорт|drill|aggressive|ярк)/, mood:'energetic'},
  ];
  const m = moodMap.find(x=>x.re.test(t));
  if (m) actions.push({ type:'recommend', mood: m.mood, autoplay: wantsPlay });

  // Жанры (синонимы)
  const gsyn = [
    ['рок','рок|rock|альтернативн|альт|гранж|панк|metal|метал|hard rock|classic rock'],
    ['поп','поп|pop|dance pop|euro pop|эстрад'],
    ['рэп','рэп|rap|hip[- ]?hop|хип[ -]?хоп|drill'],
    ['электрон','электрон|electro|edm|house|techno|trance|dnb|drum and bass|dubstep|breakbeat'],
    ['джаз','джаз|jazz|swing|bebop'],
    ['блюз','блюз|blues'],
    ['классик','классик|classical|барокко|симфоническ|оркестр'],
    ['инди','инди|indie'],
    ['lofi','lofi|ло[- ]?фай'],
    ['ambient','ambient|эмбиент'],
    ['шансон','шансон'],
    ['folk','folk|фолк|кантри|country'],
    ['rnb','rnb|r&b|соул|soul'],
    ['latin','latin|латино|сальса|бачата|реггетон'],
    ['reggae','reggae|регги|ска|ska'],
    ['k-pop','k[- ]?pop|кей[ -]?поп'],
    ['j-pop','j[- ]?pop|джей[ -]?поп'],
    ['soundtrack','саундтрек|ost|original soundtrack'],
  ];
  for (const [canon, reStr] of gsyn) {
    const re = new RegExp(`\\b(?:${reStr})\\b`, 'i');
    if (re.test(t)) { actions.push({ type:'recommend', genre: canon, autoplay: wantsPlay }); break; }
  }

  // Десятилетия
  const d = t.match(/\b(50|60|70|80|90|2000|2010|80-е|90-е|70-е)\b/);
  if (d) {
    let decade = '';
    const s = d[1];
    if (/^\d{2}$/.test(s)) decade = `${s}s`;
    else if (s.startsWith('201')) decade = '2010s';
    actions.push({ type:'recommend', decade: decade || '80s', autoplay: wantsPlay });
  }

  // Похожее на / включи ...
  const like1 = t.match(/(?:похож(ее|е)\s+на|как у|из\s+)(.+)$/i);
  const like2 = t.match(/(?:включи|поставь|запусти|найди)\s+(.+)/i);
  const like = (like1 && like1[2]) || (like2 && like2[1]);
  if (like) actions.push({ type:'recommend', like: like.trim(), autoplay: true });

  // Dedup
  const uniq = []; const seen = new Set();
  for (const a of actions) { const k = JSON.stringify(a); if (!seen.has(k)) { seen.add(k); uniq.push(a); } }
  return uniq;
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
  if (a.type === 'ui')       return a.action === 'minimize' ? 'Сворачиваю.' : 'Открываю плеер.';
  if (a.type === 'recommend') {
    if (a.genre) return `Включаю ${a.genre}.`;
    if (a.mood)  return `Под настроение: ${a.mood}.`;
    if (a.like)  return `Похоже на: ${a.like}.`;
  }
  if (a.type === 'play') return 'Играю.';
  return 'Готово.';
}

/* ---------------- YouTube helper ---------------- */
async function ytSearchFirst(q='') {
  if (!YT_API_KEY || !q) return '';
  const u = new URL('https://www.googleapis.com/youtube/v3/search');
  u.searchParams.set('part', 'snippet');
  u.searchParams.set('type', 'video');
  u.searchParams.set('maxResults', '1');
  u.searchParams.set('q', q);
  u.searchParams.set('key', YT_API_KEY);

  const r = await fetch(String(u)).catch(()=> null);
  if (!r || !r.ok) return '';
  const j = await r.json().catch(()=> ({}));
  const id = j?.items?.[0]?.id?.videoId;
  return (id && /^[\w-]{11}$/.test(id)) ? id : '';
}

/* ---------------- /api/chat ---------------- */
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
      ...srvHist,
      ...clientHist.slice(-8),
      { role: 'user', content: userText }
    ];

    // 1) ответ модели
    let data = await askLLM(messages);

    // 2) если пусто — эвристика
    if (!Array.isArray(data.actions) || data.actions.length === 0) {
      const inferred = inferActionsFromUser(userText);
      if (inferred.length) {
        const reply = replyForActions(inferred);
        data = { reply: reply || (data.reply || 'Готово.'), explain: data.explain || '', actions: inferred };
      }
    }

    // 3) enrichment:
    //    - recommend.like/mood/genre + autoplay → play.query
    //    - play.query → YouTube id (если есть YT_API_KEY)
    let actions = Array.isArray(data.actions) ? data.actions : [];
    const out = [];

    const ensureMoodQuery = (mood) => {
      const mm = (mood||'').toLowerCase();
      const map = new Map([
        ['happy','upbeat feel good hits'],
        ['calm','lofi chill beats to relax'],
        ['sad','sad emotional songs playlist'],
        ['energetic','high energy workout rock mix'],
      ]);
      return map.get(mm) || 'music playlist';
    };
    const ensureLikeQuery = (like) => {
      const s = (like||'').trim();
      if (!s) return '';
      return `${s} official audio`;
    };
    const ensureGenreQuery = (genre) => {
      const g = (genre || '').toLowerCase();
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
      if (a?.type === 'recommend' && a.like && a.autoplay) {
        out.push({ type:'play', id:a.id||'', query: ensureLikeQuery(a.like) || a.like });
        continue;
      }
      if (a?.type === 'recommend' && a.mood && a.autoplay) {
        out.push({ type:'play', id:'', query: ensureMoodQuery(a.mood) });
        continue;
      }
      if (a?.type === 'recommend' && a.genre && a.autoplay) {
        out.push({ type:'play', id:'', query: ensureGenreQuery(a.genre) });
        continue;
      }
      out.push(a);
    }

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

    console.log(`[chat] ${Date.now()-t0}ms  "${userText.slice(0,50)}"  -> "${(data.reply||'').slice(0,60)}"  a=${actions.length}`);
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
