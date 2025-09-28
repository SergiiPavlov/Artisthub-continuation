// src/js/assistant/patches/alias-book.js
// Микро-патч: «книга/книжка» работает как «аудиокнига».
// Ничего в проекте не меняем — перехватываем fetch для POST /api/chat
// и добавляем слово «аудиокнига», если пользователь сказал «книга/книжка»,
// при этом НЕ трогаем запросы про фильмы.

(() => {
  const ORIG_FETCH = window.fetch;
  const BOOK_RE  = /\b(?:книг\w*|книжк\w*)\b/i;                  // книга, книги, книжка, книжки, книжкам…
  const ABOOK_RE = /\b(?:аудио\s*книг\w*|аудиокниг\w*)\b/i;      // аудиокнига, аудиокниги…
  const FILM_RE  = /\b(фильм|movie|full\s*movie|кино|сериал|series)\b/i; // явные фильмы/сериалы

  function norm(s) {
    try { return String(s || '').normalize('NFC'); } catch { return String(s || ''); }
  }

  function patchText(text) {
    const t = norm(text);
    if (!t) return text;
    if (ABOOK_RE.test(t)) return text;    // уже аудиокнига — ничего не делаем
    if (FILM_RE.test(t)) return text;     // явный фильм — не трогаем
    if (BOOK_RE.test(t)) return `${t} аудиокнига`; // добавляем маркер аудиокниги
    return text;
  }

  window.fetch = async (input, init = {}) => {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = (init && init.method ? String(init.method) : 'GET').toUpperCase();

      if (url.endsWith('/api/chat') && method === 'POST' && init && typeof init.body === 'string') {
        try {
          const payload = JSON.parse(init.body);
          if (!payload.__abookPatched) {
            if (payload.message) payload.message = patchText(payload.message);
            if (Array.isArray(payload.history)) {
              payload.history = payload.history.map(m =>
                (m && m.role === 'user' && typeof m.content === 'string')
                  ? { ...m, content: patchText(m.content) }
                  : m
              );
            }
            payload.__abookPatched = true;
            init.body = JSON.stringify(payload);
          }
        } catch (e) {
          console.warn('[alias-book] JSON parse failed:', e);
        }
      }
    } catch (e) {
      console.warn('[alias-book] wrapper failed:', e);
    }
    return ORIG_FETCH(input, init);
  };
})();
