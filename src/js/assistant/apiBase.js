// src/js/assistant/apiBase.js
<<<<<<< HEAD
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
=======
function readMeta(name) {
  try { return document.querySelector(`meta[name="${name}"]`)?.content?.trim() || ""; } catch { return ""; }
}
function readQuery(name) {
  try { return new URL(location.href).searchParams.get(name) || ""; } catch { return ""; }
}

export const API_BASE = (() => {
  let v = "";

  // 1) Глобал из <script> window.ASSISTANT_API_BASE="..."
  if (typeof window !== "undefined" && window.ASSISTANT_API_BASE) v = String(window.ASSISTANT_API_BASE);

  // 2) <meta name="assistant-api-base" content="...">
  if (!v) v = readMeta("assistant-api-base");

  // 3) ENV от сборщика (Vite и т.п.)
  try {
    // eslint-disable-next-line no-undef
    if (!v && typeof import !== "undefined" && import.meta?.env?.VITE_API_BASE) {
      // eslint-disable-next-line no-undef
      v = String(import.meta.env.VITE_API_BASE || "");
    }
  } catch {}

  // 4) ?api=... в URL (для отладки)
  if (!v) v = readQuery("api");

  return v.replace(/\/+$/, "");
})();

export function withBase(path) {
  const p = String(path || "");
  if (!API_BASE) return p;                 // dev без сервера — оставляем относительный
  if (p.startsWith("http")) return p;      // внешняя ссылка
  if (p.startsWith("/")) return API_BASE + p;
  return API_BASE + "/" + p;
}
>>>>>>> origin/main
