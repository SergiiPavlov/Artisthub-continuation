// Нормализуем базовый URL API из Vite-окружения.
// В продакшене .env.production положит сюда домен Render.
// Локально можно не задавать — будет localhost:8787.

const raw = (import.meta.env?.VITE_API_URL || '').trim();
const base = raw.replace(/\/+$/, '');

export const API_BASE =
  base ||
  (location.origin.startsWith('http') ? location.origin : 'http://localhost:8787');

export const withBase = (p) => `${API_BASE}${p.startsWith('/') ? p : `/${p}`}`;
