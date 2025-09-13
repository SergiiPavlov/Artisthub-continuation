// src/js/assistant/apiBase.js
export function withBase(path) {
  const p = String(path || '');
  if (/^https?:\/\//i.test(p)) return p;

  let base = '';
  try {
    base =
      (typeof document !== 'undefined'
        ? document.querySelector('meta[name="assistant-api-base"]')?.content
        : '') ||
      (typeof window !== 'undefined' ? window.ASSISTANT_API_BASE : '') ||
      '';
  } catch {}

  if (!base) return p;
  return base.replace(/\/+$/, '') + (p.startsWith('/') ? p : `/${p}`);
}

