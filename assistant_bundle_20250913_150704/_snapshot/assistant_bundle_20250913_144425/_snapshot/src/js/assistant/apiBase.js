// src/js/assistant/apiBase.js
const raw = (import.meta.env?.VITE_API_URL || '').trim();
const base = raw.replace(/\/+$/, '');

export const API_BASE =
  base || (location.hostname === 'localhost' ? 'http://localhost:8787' : '');

export function withBase(path) {
  const p = String(path || '');
  if (!API_BASE) return p;
  return API_BASE.replace(/\/+$/, '') + p;
}

export default API_BASE;


