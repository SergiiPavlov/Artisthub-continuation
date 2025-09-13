// src/js/assistant/apiBase.js
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
