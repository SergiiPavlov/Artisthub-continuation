// Runtime-only API base (никаких Vite define). Работает и на GitHub Pages, и локально.
function pickRuntimeBase() {
  // 1) Глобальные переменные, которые можем задать из index.html
  try {
    if (typeof window !== 'undefined') {
      const g =
        window.API_BASE ||
        window.__API_BASE__ ||
        window.__ASSISTANT_API_BASE__;
      if (typeof g === 'string' && g.trim()) return g.trim();

      // 2) LocalStorage (на всякий случай, если кто-то сохранит вручную)
      const ls = localStorage.getItem('assistant.apiBase') || '';
      if (ls && ls.trim()) return ls.trim();
    }
  } catch {}

  // 3) import.meta.env (актуально при dev/локальной сборке)
  try {
    const v = (import.meta && import.meta.env && import.meta.env.VITE_API_BASE) || '';
    if (v) return v;
  } catch {}

  return '';
}

export const API_BASE = pickRuntimeBase();

/** Склеивает путь с базой API, если она задана. */
export function withBase(path = '') {
  const base = API_BASE || '';
  const p = String(path || '');
  if (!base) return p;
  const cleanBase = base.replace(/\/+$/, '');
  const cleanPath = p.startsWith('/') ? p : '/' + p.replace(/^\/+/, '');
  return cleanBase + cleanPath;
}

export default API_BASE;
