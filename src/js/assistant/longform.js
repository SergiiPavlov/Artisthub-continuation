// src/js/assistant/longform.js
import Player from '../artists/features/player.js';
import { API_BASE } from './apiBase.js';

// эвристики для длинных запросов
function buildQuery(q, kind) {
  const base = String(q || '').trim();
  if (!base) return '';

  const NEG = '-short -shorts -lyrics -clip -teaser -trailer -remix -cover -live';
  if (kind === 'movie') {
    // разные языки «фильм целиком»
    return `${base} "full movie" | "фильм целиком" | "película completa" | "film completo" ${NEG}`;
  }
  if (kind === 'audiobook') {
    // разные языки «аудиокнига»
    return `${base} audiobook | аудиокнига | аудіокнига | "libro de audio" | "livro áudio" ${NEG}`;
  }
  return `${base} ${NEG}`;
}

// мягкая прослойка к серверу: попробуем попросить "long" (если backend поддержит)
async function searchIdsLong(q, max = 30, opts = {}) {
  if (!API_BASE) return [];
  try {
    const body = { q, max, exclude: [], shuffle: false, ...opts, duration: 'long' };
    const r = await fetch(`${API_BASE}/api/yt/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      credentials: 'include'
    });
    if (!r.ok) return [];
    const j = await r.json();
    const ids = Array.isArray(j?.ids) ? j.ids.filter(x => /^[A-Za-z0-9_-]{11}$/.test(x)) : [];
    return ids;
  } catch {
    return [];
  }
}

async function playLongform(kind, userPrompt) {
  const q = buildQuery(userPrompt, kind);
  if (!q) return;

  // 1) пробуем серверный поиск ID
  const ids = await searchIdsLong(q, 30);
  if (ids.length > 1) {
    await Player.openQueue(ids, { shuffle: false, startIndex: 0 });
    return;
  }
  if (ids.length === 1) {
    await Player.open(ids[0]);
    return;
  }

  // 2) фоллбэк — обычный поисковый плейлист по обогащённому запросу
  await Player.playSearch(q);
}

// Публичные ручки (через кастомные события — удобно для голосовых триггеров)
function initLongformEvents() {
  document.addEventListener('assistant:play-movie', (e) => {
    const q = e?.detail?.query || '';
    playLongform('movie', q);
  }, true);

  document.addEventListener('assistant:play-audiobook', (e) => {
    const q = e?.detail?.query || '';
    playLongform('audiobook', q);
  }, true);
}

// автоинициализация
try { initLongformEvents(); } catch {}
export default { playLongform };
