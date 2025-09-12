// src/js/assistant/apiBase.js
const raw = (import.meta.env?.VITE_API_URL || '').trim();
const base = raw.replace(/\/+$/, '');

export const API_BASE =
  base || (location.hostname === 'localhost' ? 'http://localhost:8787' : '');

export default API_BASE;

