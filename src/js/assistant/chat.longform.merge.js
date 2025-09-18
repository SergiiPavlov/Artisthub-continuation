/* chat.longform.merge.js — безопасная встройка PRO логики без правки вашего большого chat.js
   Что делает:
   - слышит сабмит формы ассистента и ищет ключевые слова: фильм/кино/сериал/series/movie и аудиокнига/книга/audiobook
   - всегда добавляет пользовательскую фразу в ленту (если у вас есть addMsg)
   - запускает assistant:pro.play / assistant:pro.suggest
   - слушает assistant:pro.suggest.result и рисует карточки
   - если длинных видео нет — задаёт вопрос «Показать короткие ролики?» и ждёт «да/нет»
*/

(function(){
  const FEED_SEL = '.assistant__feed, .assistant__log, .assistant__messages';
  const FORM_SEL = '.assistant__form';
  const INPUT_SEL = '.assistant__input, .assistant__text, input[type="text"]';
  const esc = (s) => String(s||'').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));

  function addMsg(kind, text) {
    // используем ваш addMsg, если есть
    try { if (typeof window.addMsg === 'function') return window.addMsg(kind, text); } catch {}
    // иначе — мини-рендер во фид (ненавязчиво)
    const box = document.querySelector(FEED_SEL);
    if (!box) return;
    const div = document.createElement('div');
    div.className = `as-msg as-msg--${kind}`;
    div.textContent = text;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }
  function speak(text) {
    try { if (window.chat?.voice?.enabled && typeof window.chat.voice.say === 'function') window.chat.voice.say(text); } catch {}
  }

  /* ----- парсинг намерения ----- */
  function parseIntent(raw) {
    const text = String(raw||'').trim();
    if (!text) return null;
    const low = text.toLowerCase();

    const hasMovie = /(\bфильм(?:ы)?\b|\bкино\b|\bсериал(?:ы)?\b|\bmovie\b|\bseries\b)/i.test(low);
    const hasAudio = /(?:\bаудио\s*книг(?:а|и|у)\b|\bкниг(?:а|у)\b|\baudiobook\b)/i.test(low);
    if (!hasMovie && !hasAudio) return null;

    const needSuggest = /(вариант|подбери|предлож|посоветуй|порекомендуй|suggest|под\s+настроени[ея])/i.test(low);
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
      const m2 = text.match(/(?:фильм(?:ы)?|кино|сериал(?:ы)?|movie|series|audiobook|аудио\s*книг(?:а|и|у)|книг(?:а|у))\s+([^,;.!?]+)$/i);
      if (m2) {
        let t = m2[1];
        t = t.replace(/\s+с\s+.+$/i, "").replace(/\s+with\s+.+$/i, "");
        title = t.trim();
      }
    }
    const type = hasAudio ? 'audiobook' : 'movie';
    return { type, title, mood, actor, needSuggest };
  }

  /* ----- pending короткие ролики ----- */
  function hasPendingShort(){ return !!(window.chat && window.chat.pendingShort); }
  function setPendingShort(payload){ if (!window.chat) window.chat = {}; window.chat.pendingShort = payload; }
  function clearPendingShort(){ if (window.chat) window.chat.pendingShort = null; }

  /* ----- карточки ----- */
  function fmtDur(sec) {
    if (!sec) return '';
    const m = Math.round(sec/60);
    const h = Math.floor(m/60);
    const mm = m%60;
    return h ? `${h}ч ${mm}м` : `${m} мин`;
  }

  function renderSuggestions({ type, q, items }) {
    const feed = document.querySelector(FEED_SEL);
    if (!feed) return;

    const wrap = document.createElement('div');
    wrap.className = 'as-cards';
    wrap.setAttribute('data-type', type||'movie');

    if (!items || !items.length) {
      if (type === 'audiobook') {
        const msg = document.createElement('div');
        msg.className = 'as-cards__empty';
        msg.innerHTML = `Полноценная аудиокнига не найдена.`;
        wrap.appendChild(msg);
      } else {
        const msg = document.createElement('div');
        msg.className = 'as-cards__empty';
        msg.innerHTML = `Полноценный фильм не найден. Могу показать короткие ролики по этому фильму. Показать?`;
        wrap.appendChild(msg);
        setPendingShort({ type: 'movie', title: q||'', mood:'', actor:'' });
      }
      feed.appendChild(wrap); feed.scrollTop = feed.scrollHeight; return;
    }

    items.forEach((it, idx) => {
      const card = document.createElement('div');
      card.className = 'as-card';
      card.innerHTML = `
        <div class="as-card__idx">#${idx+1}</div>
        <div class="as-card__title">${esc(it.title || 'Без названия')}</div>
        <div class="as-card__meta">
          ${it.author ? `<span class="as-card__author">${esc(it.author)}</span>` : ''}
          ${it.durationSec ? `<span class="as-card__dur">${fmtDur(it.durationSec)}</span>` : ''}
        </div>
        <div class="as-card__row">
          <button class="as-btn as-btn--play" data-id="${esc(it.id)}">▶ Играть</button>
          <a class="as-btn as-btn--link" href="${esc(it.url || ('https://youtu.be/'+it.id))}" target="_blank" rel="noopener">Открыть на YouTube</a>
        </div>
      `;
      wrap.appendChild(card);
    });

    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('.as-btn--play');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      if (!id) return;
      // прямой запуск по id
      window.dispatchEvent(new CustomEvent('assistant:pro.playById', { detail: { id } }));
      addMsg('note', 'Включаю…');
      speak('Включаю');
    });

    feed.appendChild(wrap);
    feed.scrollTop = feed.scrollHeight;
  }

  /* ----- слушаем результаты longform ----- */
  window.addEventListener('assistant:pro.suggest.result', (e) => {
    try {
      const d = e?.detail || {};
      renderSuggestions(d);
    } catch(err) { console.warn('[chat.longform.merge] render err', err); }
  });

  /* ----- подхватываем submit формы ассистента ----- */
  const form = document.querySelector(FORM_SEL);
  const input = document.querySelector(INPUT_SEL);
  if (form && input) {
    form.addEventListener('submit', (ev) => {
      try {
        let v = String(input.value||'').trim();
        if (!v) return; // пусть ваш обработчик покажет валидацию
        // перехват ответа на «короткие ролики»
        if (hasPendingShort()) {
          const ans = v.toLowerCase();
          if (/^(?:да|ага|угу|yes|sure|ok|okay|конечно|давай|хорошо)\b/.test(ans)) {
            const ps = window.chat.pendingShort;
            clearPendingShort();
            addMsg('user', v);
            window.dispatchEvent(new CustomEvent('assistant:pro.suggest', {
              detail: { type: ps.type||'movie', title: ps.title||'', mood: ps.mood||'', actor: ps.actor||'', limit: 12, minSecOverride: 0 }
            }));
            addMsg('note', 'Ищу короткие ролики…'); speak('Ищу короткие ролики');
            ev.stopPropagation(); ev.preventDefault();
            return;
          }
          if (/^(?:нет|неа|no|не\s+надо|не\s+нужно)\b/.test(ans)) {
            clearPendingShort();
            addMsg('user', v);
            addMsg('bot', 'Хорошо, не показываю короткие ролики.'); speak('Хорошо');
            ev.stopPropagation(); ev.preventDefault();
            return;
          }
          // любой другой ответ — считаем новым запросом (сброс)
          clearPendingShort();
        }

        const intent = parseIntent(v);
        if (!intent) return; // не наше — пусть базовый чат обработает
        // наше — сами логируем и уводим обработку
        addMsg('user', v);

        if (intent.needSuggest || !intent.title) {
          window.dispatchEvent(new CustomEvent('assistant:pro.suggest', { detail: { type:intent.type, title:intent.title, mood:intent.mood, actor:intent.actor, limit: 12 } }));
          addMsg('note','Подбираю варианты…'); speak('Подбираю варианты');
        } else {
          window.dispatchEvent(new CustomEvent('assistant:pro.play', { detail: { type:intent.type, title:intent.title, mood:intent.mood, actor:intent.actor } }));
          addMsg('note', intent.type==='audiobook' ? 'Ищу и включаю аудиокнигу…' : 'Ищу и включаю фильм…');
          speak(intent.type==='audiobook' ? 'Ищу аудиокнигу' : 'Ищу фильм');
        }
        ev.stopPropagation(); ev.preventDefault();
      } catch (err) {
        console.warn('[chat.longform.merge] submit err', err);
      }
    }, true); // capture = true, чтобы опередить базовый обработчик
  }

  console.log('[chat.longform.merge] ready');
})();
