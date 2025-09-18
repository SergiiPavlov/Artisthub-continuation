// Assistant hooks — v2.0 (2025‑09‑18)
// Исправляет 2 проблемы:
// 1) Фраза «аудио…/аудиокнига…» не появлялась в ленте → теперь мы эхо-логируем сами.
// 2) Только ролики ≤20 мин → включаем PRO‑поток (longform) и добавляем UX:
//    если длинных нет — даём ссылку на YouTube и спрашиваем «Показать короткие ролики?».

(() => {
  const W = (window.Assistant = window.Assistant || {});
  const FEED_SEL = '.assistant__log, .assistant__feed, .assistant__messages';

  const $ = (sel, root=document) => { try { return root.querySelector(sel); } catch { return null; } };
  const esc = (s) => String(s||'').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  function addMsg(kind, html) {
    const box = $(FEED_SEL);
    if (!box) return;
    const div = document.createElement('div');
    const cls = kind === 'user' ? 'assistant__msg--user' : (kind === 'note' ? 'assistant__msg--note' : 'assistant__msg--bot');
    div.className = `assistant__msg ${cls}`;
    div.innerHTML = html; // нам нужен HTML для ссылки YouTube
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    // по возможности — поддержим историю чата
    try {
      if (window.chat && Array.isArray(window.chat.history) && kind !== 'note') {
        window.chat.history.push({ role: (kind==='user' ? 'user' : 'assistant'), content: String(html).replace(/<[^>]+>/g,'') });
        window.chat.history = window.chat.history.slice(-10);
      }
    } catch {}
  }
  function speak(text) {
    try { if (window.chat?.voice?.enabled && typeof window.chat.voice.say === 'function') window.chat.voice.say(text); } catch {}
  }

  // pending «короткие ролики»
  W.__pendingShort = null;

  // Нормализация тире/временных выражений как и в старом файле
  function normalizeDashes(s) { return String(s || "").replace(/[–—]/g, "-"); }
  function normalizeTimingPhrases(s0) {
    let s = normalizeDashes(String(s0 || "")).toLowerCase();
    s = s.replace(/через\s+пол ?минут[ыи]/g, "через 30 секунд");
    s = s.replace(/через\s+пол ?часа/g, "через 30 минут");
    s = s.replace(/\bчерез\s+пару\s+секунд\b/g, "через 2 секунды");
    s = s.replace(/\bчерез\s+пару\s+минут\b/g, "через 2 минуты");
    s = s.replace(/\bчерез\s+(\d+)\s*сек\b/g, "через $1 секунд");
    s = s.replace(/\bчерез\s+(\d+)\s*мин\b/g, "через $1 минут");
    s = s.replace(/секундочк[ауи]/g, "секунду").replace(/минутк[ауи]/g, "минуту");
    return s0 && s !== s0 ? s : s0;
  }

  // Мини‑парсер намерения для фильмов/аудиокниг
  function parseIntent(raw) {
    const text = String(raw||'').trim();
    if (!text) return null;
    const low = text.toLowerCase();

    const hasMovie = /(\bфильм(?:ы)?\b|\bкино\b|\bсериал(?:ы)?\b|\bmovie\b|\bseries\b)/i.test(low);
    const hasAudio = /\bаудио\b/i.test(low) || /аудио\s*книг|аудиокнига|audiobook/i.test(low);
    if (!hasMovie && !hasAudio) return null;

    const needSuggest = /(вариант|подбери|предлож|посоветуй|порекомендуй|suggest|под\s+настроени[ея]|под настроение)/i.test(low);
    const qm = text.match(/["“”«»„‟']([^"“”«»„‟']{2,})["“”«»„‟']/);
    const titleQuoted = qm ? qm[1].trim() : "";

    let actor = "";
    const am = text.match(/(?:\bс\s+(?:актером|актрисой)?\s*|\bwith\s+)([a-zа-яёіїє][\w'\-]+(?:\s+[a-zа-яёіїє][\w'\-]+){0,2})/i);
    if (am) actor = am[1].trim();

    let mood = "";
    let mm = text.match(/под\s+настроени[ея]\s+([a-zа-яёіїє\- ]{3,})/i) || text.match(/настроени[ея]\s+([a-zа-яёіїє\- ]{3,})/i);
    if (mm) mood = mm[1].trim();

    let title = titleQuoted;
    if (!title) {
      const m2 = text.match(/(?:фильм(?:ы)?|кино|сериал(?:ы)?|movie|series|audiobook|аудио\s*книг(?:а|и|у)|аудиокнига|книга)\s+([^,;.!?]+)$/i);
      if (m2) {
        let t = m2[1];
        t = t.replace(/\s+с\s+.+$/i, "").replace(/\s+with\s+.+$/i, "");
        title = t.trim();
      }
    }
    const type = hasAudio ? 'audiobook' : 'movie';
    return { type, title, mood, actor, needSuggest };
  }

  // Прехук: логируем «аудио…», маршрутизируем longform и обрабатываем «да/нет»
  W.preprocessText = function (text) {
    // 1) «да/нет» на короткие ролики
    const low = String(text||'').trim().toLowerCase();
    if (W.__pendingShort) {
      if (/^(?:да|ага|угу|yes|sure|ok|okay|конечно|давай|хорошо)\b/.test(low)) {
        const ps = W.__pendingShort; W.__pendingShort = null;
        window.dispatchEvent(new CustomEvent('assistant:pro.suggest', { detail: { type: ps.type||'movie', title: ps.title||'', limit: 12, minSecOverride: 0 } }));
        addMsg('note','Ищу короткие ролики…'); speak('Ищу короткие ролики');
        return { handled: true };
      }
      if (/^(?:нет|неа|no|не\s+надо|не\s+нужно)\b/.test(low)) {
        W.__pendingShort = null;
        addMsg('bot','Хорошо, не показываю короткие ролики.'); speak('Хорошо');
        return { handled: true };
      }
      // любой другой ответ — сбрасываем ожидание и продолжаем как обычный текст
      W.__pendingShort = null;
    }

    // 2) нормализация времени/дефисов
    const t1 = normalizeTimingPhrases(text);

    // 3) детект longform намерения и немедленный роутинг (с эхо)
    try {
      const intent = parseIntent(t1);
      if (intent) {
        addMsg('user', esc(String(text)));
        if (intent.needSuggest || !intent.title) {
          window.dispatchEvent(new CustomEvent('assistant:pro.suggest', { detail: { type:intent.type, title:intent.title, mood:intent.mood, actor:intent.actor, limit: 12 } }));
          addMsg('note','Подбираю варианты…'); speak('Подбираю варианты');
        } else {
          window.dispatchEvent(new CustomEvent('assistant:pro.play', { detail: { type:intent.type, title:intent.title, mood:intent.mood, actor:intent.actor } }));
          addMsg('note', intent.type==='audiobook' ? 'Ищу и включаю аудиокнигу…' : 'Ищу и включаю фильм…');
          speak(intent.type==='audiobook' ? 'Ищу аудиокнигу' : 'Ищу фильм');
        }
        return { handled: true };
      }
    } catch {}

    // 4) иначе — вернём нормализованный текст (пусть chat.js обработает)
    return t1;
  };

  // 4) слушатель результатов подбора: если длинных нет — YouTube + вопрос про короткие
  window.addEventListener('assistant:pro.suggest.result', (e) => {
    try {
      const d = e?.detail || {}; const items = d.items || [];
      if (Array.isArray(items) && items.length) return; // есть карточки — дальше не вмешиваемся
      const type = d.type || 'movie';
      const q = String(d.q || '').trim();
      const yurl = q ? ("https://www.youtube.com/results?search_query=" + encodeURIComponent(q)) : "https://www.youtube.com";
      addMsg('bot', type==='audiobook' ? 'Полноценная аудиокнига не найдена.' : 'Полноценный фильм не найден.');
      addMsg('bot', `Можно посмотреть на YouTube: <a href="${yurl}" target="_blank" rel="noopener">открыть YouTube</a>.`);
      W.__pendingShort = { type, title: q };
      addMsg('bot','Показать короткие ролики? (да/нет)');
      speak('Показать короткие ролики?');
    } catch {}
  });

})();
