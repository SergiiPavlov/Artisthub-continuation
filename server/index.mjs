// server/index.mjs
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// Долговременная память (без нативных модулей)
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

const app = express();
const PORT = Number(process.env.PORT || 8787);

/* ========= Провайдеры LLM =========
   PROVIDER=openai|lmstudio|ollama
   - openai   → https://api.openai.com/v1/chat/completions
   - lmstudio → http://localhost:1234/v1/chat/completions (OpenAI-совместимый)
   - ollama   → http://localhost:11434/api/chat            (их формат)
*/
const PROVIDER = (process.env.PROVIDER || 'openai').toLowerCase();

// OpenAI (Pro)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL   = process.env.OPENAI_MODEL   || 'gpt-4o-mini';

// LM Studio (Free, локально)
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'http://localhost:1234/v1';
const LLM_MODEL    = process.env.LLM_MODEL    || 'qwen2.5-7b-instruct';

// Ollama (Free, локально)
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL    = process.env.OLLAMA_MODEL    || 'llama3:instruct';

// Поиск YouTube (для прямого запуска, опционально)
const YT_API_KEY = process.env.YT_API_KEY || '';

// Опциональный серверный TTS (Piper)
const PIPER_PATH  = process.env.PIPER_PATH  || ''; // путь к бинарнику piper
const PIPER_MODEL = process.env.PIPER_MODEL || ''; // путь к голосу *.onnx / *.onnx.gz

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

/* ========= Долговременная память (lowdb JSON) ========= */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir   = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbFile = path.join(dataDir, 'amdb.json');
const db = new Low(new JSONFile(dbFile), { sessions: {}, profiles: {} });
await db.read();
db.data ||= { sessions: {}, profiles: {} };
await db.write();

// cookie-session
const SESS_COOKIE = 'am_sid';
function getSid(req, res) {
  let sid = req.cookies[SESS_COOKIE];
  if (!sid) {
    sid = Math.random().toString(36).slice(2);
    res.cookie(SESS_COOKIE, sid, { httpOnly: false, sameSite: 'Lax' });
  }
  if (!db.data.sessions[sid]) {
    db.data.sessions[sid] = { history: [], created: Date.now(), last_seen: Date.now() };
  }
  return sid;
}
async function pushHistory(sid, role, content) {
  const s = db.data.sessions[sid] || { history: [] };
  s.history.push({ role, content, ts: Date.now() });
  if (s.history.length > 40) s.history = s.history.slice(-40);
  s.last_seen = Date.now();
  db.data.sessions[sid] = s;
  await db.write();
}
function getHistory(sid) {
  // Короткая память в подсказке (14 последних + наше "system")
  const h = db.data.sessions[sid]?.history || [];
  return h.slice(-14).map(({ role, content }) => ({ role, content }));
}

/* ========= Поддержка YouTube поиска ========= */
async function ytSearchFirst(q) {
  if (!YT_API_KEY || !q) return null;
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('key', YT_API_KEY);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', q);
  url.searchParams.set('type', 'video');
  url.searchParams.set('videoEmbeddable', 'true'); // важное
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

/* ========= SYSTEM-промпт (протокол действий) ========= */
const SYSTEM = `
Ты — голосовой музыкальный ассистент на сайте. Отвечай кратко и дружелюбно.
Возвращай ТОЛЬКО JSON (без текста вокруг), строго такого формата:
{
  "reply": "короткий ответ для пользователя",
  "explain": "короткое пояснение (опционально)",
  "actions": [
    {"type":"player","action":"play"|"pause"|"next"|"prev"|"stop"},
    {"type":"mixradio"},
    {"type":"volume","delta":0.1},
    {"type":"recommend","mood":"happy|calm|sad|energetic","genre":"рок","like":"queen bohemian rhapsody","autoplay":true},
    {"type":"play","id":"YOUTUBE_ID_11" | null, "query":"artist - song"}
  ]
}

Правила:
- Если просят «включи <что-то>», добавь либо {"type":"play","query":"..."}, либо {"type":"recommend","like":"...","autoplay":true}.
- Пауза/стоп → {"type":"player","action":"pause"} или "stop".
- Следующий/предыдущий → соответствующий action.
- Громкость → {"type":"volume","delta":0.1} или -0.1.
- «Под настроение» → recommend с подходящим mood; если звучит как «включить», ставь autoplay:true.
- Не выдумывай ID. Если не уверен, ставь "query".
`;

/* ========= Провайдеры ========= */
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
      response_format: { type: 'json_object' }
    })
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status} ${await r.text()}`);
  const j = await r.json();
  const text = j?.choices?.[0]?.message?.content || '{}';
  return JSON.parse(text);
}

async function askLMStudio(messages) {
  // LM Studio поднимает OpenAI-совместимый сервер на 1234
  const r = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      temperature: 0.4,
      response_format: { type: 'json_object' }
    })
  });
  if (!r.ok) throw new Error(`LMStudio ${r.status} ${await r.text()}`);
  const j = await r.json();
  const text = j?.choices?.[0]?.message?.content || '{}';
  return JSON.parse(text);
}

async function askOllama(messages) {
  // У Ollama свой формат /api/chat
  const r = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      options: { temperature: 0.4 },
      stream: false
    })
  });
  if (!r.ok) throw new Error(`Ollama ${r.status} ${await r.text()}`);
  const j = await r.json();
  const text = j?.message?.content || j?.choices?.[0]?.message?.content || '{}';
  try { return JSON.parse(text); }
  catch { return { reply: String(text || '').trim().slice(0, 280), actions: [] }; }
}

async function askLLM(messages, provider) {
  switch ((provider || PROVIDER)) {
    case 'lmstudio': return askLMStudio(messages);
    case 'ollama':   return askOllama(messages);
    case 'openai':
    default:         return askOpenAI(messages);
  }
}

/* ========= API ========= */
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    provider: PROVIDER,
    openai: !!OPENAI_API_KEY,
    model: (PROVIDER === 'openai' ? OPENAI_MODEL :
           PROVIDER === 'lmstudio' ? LLM_MODEL :
           OLLAMA_MODEL)
  });
});

app.post('/api/chat', async (req, res) => {
  try {
    const sid = getSid(req, res);
    const user = String(req.body?.message || '').trim();
    const providerOverride = (req.body?.provider || '').toLowerCase(); // 'openai' | 'lmstudio' | 'ollama' | ''

    if (!user) return res.json({ reply: 'Скажи мне, что включить.', actions: [] });

    const histShort = getHistory(sid); // короткая память
    const messages = [
      { role: 'system', content: SYSTEM },
      ...histShort,
      { role: 'user', content: user }
    ];

    // Запрос к выбранному провайдеру ИИ
    const data = await askLLM(messages, providerOverride);

    // Пост-обогащение действий: попытка сразу добыть YouTube ID
    let actions = Array.isArray(data.actions) ? data.actions : [];
    const enriched = [];
    for (const a of actions) {
      if (a?.type === 'play' && !a.id && a.query) {
        const id = await ytSearchFirst(a.query);
        enriched.push(id ? { ...a, id } : a);
      } else if (a?.type === 'recommend' && a.autoplay && a.like && !actions.some(x => x.type === 'play')) {
        const id = await ytSearchFirst(a.like);
        if (id) enriched.push({ type: 'play', id, query: a.like });
        enriched.push(a);
      } else {
        enriched.push(a);
      }
    }
    actions = enriched;

    // Сохраняем длинную память (полностью, но к системному не добавляем)
    await pushHistory(sid, 'user', user);
    await pushHistory(sid, 'assistant', JSON.stringify({ reply: data.reply, actions }));

    res.json({ reply: data.reply || 'Готово.', explain: data.explain || '', actions });
  } catch (e) {
    console.error(e);
    res.status(500).json({ reply: 'Что-то пошло не так.', actions: [] });
  }
});

/* ========= Опциональный серверный TTS (Piper) =========
   В .env укажи:
   PIPER_PATH="D:/tools/piper/piper.exe"
   PIPER_MODEL="D:/tools/piper/voices/ru_RU-irinav-high.onnx"
*/
app.post('/api/tts', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'No text' });

    if (!PIPER_PATH || !PIPER_MODEL) {
      return res.status(501).json({ error: 'TTS not configured (PIPER_PATH / PIPER_MODEL)' });
    }

    res.setHeader('Content-Type', 'audio/wav');
    const child = spawn(PIPER_PATH, ['-m', PIPER_MODEL, '-f', '-'], { stdio: ['pipe', 'pipe', 'inherit'] });
    child.stdin.write(text);
    child.stdin.end();
    child.stdout.pipe(res);
  } catch (e) {
    console.error('TTS error', e);
    res.status(500).json({ error: 'TTS failed' });
  }
});

app.listen(PORT, () => {
  console.log(`AI server on http://localhost:${PORT}`);
});
