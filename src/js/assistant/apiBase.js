// src/js/assistant/apiBase.js
// Единая точка правды для базового URL API
export const API_BASE =
  (import.meta.env.VITE_AI_BASE_URL?.replace(/\/+$/, '')) ||
  (location.hostname === 'localhost'
    ? 'http://localhost:8787'
    : ''); 

