// server/index.mjs
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fetch from 'node-fetch';

const app = express();
const PORT = Number(process.env.PORT || 8787);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL   = process.env.OPENAI_MODEL   || 'gpt-4o-mini';
const YT_API_KEY     = process.env.YT_API_KEY     || ''; // опционально

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

/* ---------- простая сессия на cookie ---------- */
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

/* ---------- YouTube поиск (только встраиваемые) ---------- */
async function ytSearchFirst(q) {
  if (!YT_API_KEY || !q) return null;
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('key', YT_API_KEY);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', q);
  url.searchParams.set('type', 'video');
  url.searchParams.set('videoEmbeddable', 'true');
  url.searchParams.set('maxResults', '5');
  url.searchParams.set('safeSearch', 'none');
  try {
    const r = await fetch(url.href);
    if (!r.ok) return null;
    const j = await r.json();
    const id = j?.items?.[0]?.id?.videoId;
    return id || null;
  } catch { return null; }
}

/* ---------- подсказки для модели ---------- */
const SYSTEM = `
Ты — голосовой музыкальный ассистент на сайте. Отвечай кратко и дружелюбно.
Возвращай ТОЛЬКО JSON (без текста вокруг) формата:
{
  "reply": "короткий ответ для пользователя",
  "explain": "короткое пояснение (опционально)",
  "actions": [
    // управление плеером:
    {"type":"player","action":"play"|"pause"|"next"|"prev"|"stop"},
    // запустить микс-радио:
    {"type":"mixradio"},
    // подобрать: mood/genre/like (autoplay=true если просили включить)
    {"type":"recommend","mood":"happy|calm|sad|energetic","genre":"рок","like":"queen bohemian rhapsody","autoplay":true},
    // прямой запуск, если знаешь точный запрос/ID:
    {"type":"play","id":"YOUTUBE_ID_11"| null, "query":"artist - song"}
  ]
}

Правила:
- Если просят «включи <что-то>», добавь либо {"type":"play","query":"..."}, либо {"type":"recommend","like":"...","autoplay":true}.
- Если просят «пауза/стоп» — верни {"type":"player","action":"pause"} или "stop".
- Если просят «следующий/предыдущий» — соответствующий action.
- Если просят «сделай громче/тише» — верни {"type":"volume","delta":0.1} или -0.1.
- Если спрашивают «под настроение» — верни recommend с подходящим mood и autoplay=true, если звучит как просьба включить.
- Не выдумывай несуществующие ID. Если не уверен в ID — используй поле "query".
`;

/* ---------- вызов OpenAI (chat.completions) ---------- */
async function askOpenAI(messages) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.4,
      response_format: { type: "json_object" }
    })
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}`);
  const j = await r.json();
  const text = j?.choices?.[0]?.message?.content || '{}';
  return JSON.parse(text);
}

/* ---------- API ---------- */
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/chat', async (req, res) => {
  try {
    const sid = getSid(req, res);
    const user = String(req.body?.message || '').trim();
    if (!user) return res.json({ reply: 'Скажи мне, что включить.', actions: [] });

    // история
    const hist = memory.get(sid) || [];
    const messages = [
      { role: 'system', content: SYSTEM },
      ...hist,
      { role: 'user', content: user }
    ];

    const data = await askOpenAI(messages);

    // пост-обработка экшенов
    let actions = Array.isArray(data.actions) ? data.actions : [];
    // Если пришел play.query и доступен YT_API_KEY — подставим id
    const enriched = [];
    for (const a of actions) {
      if (a?.type === 'play' && !a.id && a.query) {
        const id = await ytSearchFirst(a.query);
        if (id) enriched.push({ ...a, id });
        else enriched.push(a);
      } else if (a?.type === 'recommend' && a.autoplay && a.like && !actions.some(x => x.type === 'play')) {
        // В режиме автозапуска попробуем сразу найти и запустить
        const id = await ytSearchFirst(a.like);
        if (id) enriched.push({ type: 'play', id, query: a.like });
        enriched.push(a);
      } else {
        enriched.push(a);
      }
    }
    actions = enriched;

    // сохраним память
    pushHistory(sid, 'user', user);
    pushHistory(sid, 'assistant', JSON.stringify({ reply: data.reply, actions }));

    res.json({ reply: data.reply || 'Готово.', explain: data.explain || '', actions });
  } catch (e) {
    console.error(e);
    res.status(500).json({ reply: 'Что-то пошло не так.', actions: [] });
  }
});

app.listen(PORT, () => {
  console.log(`AI server on http://localhost:${PORT}`);
});
