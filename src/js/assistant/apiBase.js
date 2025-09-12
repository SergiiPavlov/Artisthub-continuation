// src/js/assistant/apiBase.js
// Единая точка правды для базового URL API.
// Берём из Vite env (прод), из window.__AI_BASE__ (если задан),
// иначе падаем на origin текущего сайта.

export const API_BASE =
  (typeof import !== 'undefined' &&
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    import.meta.env.VITE_AI_BASE_URL) ??
  (typeof window !== 'undefined' ? window.__AI_BASE__ : '') ||
  (typeof location !== 'undefined' ? location.origin : '');

export default API_BASE;
