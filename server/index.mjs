import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';

const app = express();
const PORT = Number(process.env.PORT || 8787);
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/ping', (_, res) => res.json({ ok: true }));

// Чёткая инструкция модели: отдавай JSON + действие play/query
const SYSTEM = `
Ты — дружелюбный ассистент музыкального сайта ArtistsHub.
Говоришь кратко и по делу. Помимо текста ответа возвращай список "actions".
ДОПУСТИМЫЕ ДЕЙСТВИЯ:

- { "type":"play", "query":"строка" } — пользователь попросил конкретную песню/исполнителя.
  Пример: запрос "включи metallica enter sandman" -> query: "Metallica Enter Sandman".

- { "type":"player", "action":"play|pause|next|prev" }

- { "type":"view", "mode":"list|grid" }

- { "type":"recommend", "mood":"happy|calm|sad|energetic" } // по настроению
- { "type":"recommend", "genre":"rock|pop|metal|..." }        // по жанру
- { "type":"recommend", "like":"строка поиска" }              // произвольный запрос

- { "type":"volume", "delta": 0.1 } // +/- громкость

Возвращай СТРОГО JSON БЕЗ лишнего текста, вида:
{
  "reply": "краткий дружественный ответ",
  "explain": "почему так (не обязательно)",
  "actions": [ ... ]
}

Примеры:
Пользователь: "включи enter sandman"
Ответ:
{"reply":"Включаю Enter Sandman — Metallica","actions":[{"type":"play","query":"Metallica Enter Sandman"}]}

Пользователь: "сделай тише"
Ответ:
{"reply":"Делаю тише","actions":[{"type":"volume","delta":-0.1}]}
`;

app.post('/api/chat', async (req, res) => {
  try {
    const user = String(req.body?.message || '').slice(0, 2000) || 'Привет!';
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.4,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user }
      ]
    });

    const raw = completion.choices?.[0]?.message?.content || '{}';

    let data = null;
    try { data = JSON.parse(raw); } catch {}
    if (!data) { const m = raw.match(/\{[\s\S]*\}$/); if (m) { try { data = JSON.parse(m[0]); } catch {} } }

    if (!data || typeof data !== 'object') data = { reply: 'Я тут! Чем помочь?', actions: [] };
    data.reply = String(data.reply || 'Готов(а) к музыке!');
    if (!Array.isArray(data.actions)) data.actions = [];

    res.json(data);
  } catch (err) {
    console.error('API ERR', err?.response?.data || err);
    res.status(500).json({ reply: 'Сервер занят. Попробуй позже.', actions: [] });
  }
});

app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
