// src/js/assistant/apiBase.js
// Рантайм-определение API_BASE без макросов/define — одинаково работает локально и на CI.

function detectApiBase() {
  try { if (typeof window !== 'undefined' && window.__API_BASE__) return String(window.__API_BASE__).replace(/\/+$/, ''); } catch {}

  try {
    const v = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE;
    if (v) return String(v).replace(/\/+$/, '');
  } catch {}

  try {
    if (typeof location !== 'undefined') {
      const host = String(location.hostname || '').toLowerCase();
      if (host.endsWith('.github.io')) return 'https://artisthub-api-tbt4.onrender.com';
    }
  } catch {}

  try {
    if (typeof location !== 'undefined') {
      const host = String(location.hostname || '').toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3000';
    }
  } catch {}

  return '';
}

export const API_BASE = detectApiBase();

export function withBase(path) {
  const p = String(path || '');
  if (!API_BASE) return p;
  if (/^https?:\/\//i.test(p)) return p;
  const base = API_BASE.replace(/\/+$/, '');
  const tail = p.startsWith('/') ? p : `/${p}`;
  return `${base}${tail}`;
}
