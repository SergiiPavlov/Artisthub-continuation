import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/**
 * Мы просим модель:
 * - вести разговор естественно
 * - когда уместно — возвращать actions (play/pause/next/prev/volume/recommend/mixradio/view)
 * - при рекомендациях стараться давать хотя бы ОДИН YouTube ID/URL для моментального запуска
 */
const SYSTEM_PROMPT = `
Ты дружелюбный музыкальный ассистент внутри веб-приложения. 
Всегда отвечай компактно и по делу. Если пользователь просит включить, поставить, запустить — 
в ответе верни actions, которые фронт может выполнить.

Формат твоего JSON-ответа:
{
  "reply": "краткий текст для пользователя",
  "actions": [
    // ноль или больше действий
    // управление плеером:
    { "type": "player", "action": "play" | "pause" | "next" | "prev" },
    { "type": "volume", "delta": -0.1 }, // тише/громче
    // просмотр:
    { "type": "view", "mode": "list" | "grid" },
    // микс-радио:
    { "type": "mixradio" },
    // рекомендация (жанр/настроение/поиск по слову):
    { "type": "recommend", "genre": "jazz", "autoplay": true },
    { "type": "recommend", "mood": "calm", "autoplay": true },
    { "type": "recommend", "like": "Metallica", "autoplay": true },
    // либо прямой запуск:
    { "type": "play", "id": "Zi_XLOBDo_Y" } // YouTube ID ИЛИ URL (id предпочтительнее)
  ],
  "explain": "почему такой выбор (коротко, по желанию)"
}

ВАЖНО:
- Если пользователь говорит "включи что-нибудь из этого списка / из предложенного", и ранее ты предлагал варианты, 
  сам выбери и верни либо { "type": "play", "id": "<YT_ID>" }, либо { "type": "recommend", "...", "autoplay": true }.
- Если ты рекомендуешь треки/артистов, по возможности добавь хотя бы ОДИН YT ID/URL в actions, чтобы фронт мог сразу включить.
- Не пиши код и не давй длинных лекций, ответ должен быть лаконичным.
`;

app.post('/api/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body || {};
    const msgs = [
      { role: 'system', content: SYSTEM_PROMPT },
      // подмешиваем последние 6 сообщений истории
      ...history.slice(-6).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message || '' }
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: msgs,
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const raw = completion.choices?.[0]?.message?.content || '{}';
    let data;
    try { data = JSON.parse(raw); } catch { data = { reply: raw }; }

    // sanity-fallbacks
    if (!data || typeof data !== 'object') data = { reply: 'Готово.' };
    if (!('reply' in data)) data.reply = 'Готово.';
    if (!Array.isArray(data.actions)) data.actions = [];

    res.json(data);
  } catch (err) {
    console.error('chat error', err);
    res.status(500).json({ reply: 'Упс, что-то пошло не так. Попробуй ещё раз.', actions: [] });
  }
});

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`AI server on http://localhost:${PORT}`);
});
