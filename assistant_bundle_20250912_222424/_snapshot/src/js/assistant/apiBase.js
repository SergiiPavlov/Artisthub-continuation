// src/js/assistant/apiBase.js
// Минимальная и безотказная детекция базового URL для API
// — без Vite define/макросов, чтобы не падало на GH Actions.

function detectApiBase() {
  // 1) Явная переопределяемая глобалка (можно задать прямо в <script> на странице)
  try {
    if (typeof window !== 'undefined' && window.__API_BASE__) {
      return String(window.__API_BASE__).replace(/\/+$/, '');
    }
  } catch {}

  // 2) Переменная окружения Vite (если задана) — ОК и локально, и на CI
  try {
    const v = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE;
    if (v) return String(v).replace(/\/+$/, '');
  } catch {}

  // 3) GitHub Pages → всегда внешний Render API
  try {
    if (typeof location !== 'undefined') {
      const host = String(location.hostname || '').toLowerCase();
      const isGhPages = host.endsWith('.github.io');
      if (isGhPages) {
        return 'https://artisthub-api-tbt4.onrender.com';
      }
    }
  } catch {}

  // 4) Локалхост → удобный дефолт
  try {
    if (typeof location !== 'undefined') {
      const host = String(location.hostname || '').toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1') {
        return 'http://localhost:3000';
      }
    }
  } catch {}

  // 5) По умолчанию — пусто (чисто статический режим)
  return '';
}

/** База API, вычисляется на рантайме */
export const API_BASE = detectApiBase();

/**
 * Склеивает относительный путь с API_BASE.
 * Если база пустая — возвращает исходный путь «как есть».
 */
export function withBase(path) {
  const p = String(path || '');
  if (!API_BASE) return p;
  if (/^https?:\/\//i.test(p)) return p; // уже абсолютный
  const base = API_BASE.replace(/\/+$/, '');
  const tail = p.startsWith('/') ? p : `/${p}`;
  return `${base}${tail}`;
}

