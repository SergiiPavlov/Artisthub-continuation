// src/js/assistant/help.js
// Help overlay (EN/UK/RU) — sticky header, scrollable body, inline SVG flags (reliable cross-platform).
(() => {
  if (window.__ASSISTANT_HELP_INIT__) return;
  window.__ASSISTANT_HELP_INIT__ = true;

  const css = `
  .assistant-help__overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);z-index:11000;display:none}
  .assistant-help__wrap{position:fixed;right:18px;bottom:84px;width:min(94vw,720px);max-height:calc(100vh - 120px);
    overflow:auto;overscroll-behavior:contain;background:#0f1216;color:#e8f1ff;border:1px solid rgba(255,255,255,.08);
    border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.55);z-index:11001;display:none}
  .assistant-help__hdr{position:sticky;top:0;display:flex;align-items:center;gap:.75rem;padding:.8rem 1rem;
    background:linear-gradient(180deg,#141a1f,#0e1318);border-bottom:1px solid rgba(255,255,255,.08);z-index:1}
  .assistant-help__title{font-weight:700;font-size:1.05rem}
  .assistant-help__close{margin-left:auto;background:transparent;border:1px solid rgba(255,255,255,.18);
    color:#cbd5e1;border-radius:8px;padding:.35rem .6rem;cursor:pointer}
  .assistant-help__body{padding:1rem 1.1rem;line-height:1.55}
  .assistant-help__body h3{margin:1rem 0 .4rem;font-size:1.12rem}
  .assistant-help__body h4{margin:.85rem 0 .35rem;font-size:1.02rem;opacity:.95}
  .assistant-help__body p{margin:.4rem 0}
  .assistant-help__body code{background:#141a22;border:1px solid #263142;border-radius:6px;padding:.08rem .35rem;font-family:ui-monospace, SFMono-Regular, Menlo, monospace}
  .assistant-help__list{margin:.3rem 0 .8rem;padding-left:1.1rem}
  .assistant-help__note{opacity:.85;font-size:.95rem}
  .assistant-help__langbar{display:flex;gap:.35rem;margin-left:auto}
  .assistant-help__langbar .langbtn{display:inline-flex;align-items:center;gap:.4rem;padding:.35rem .6rem;
    border:1px solid rgba(255,255,255,.18);border-radius:8px;background:#10161f;color:#e6eefb;cursor:pointer;font-weight:700}
  .assistant-help__langbar .langbtn[aria-selected="true"]{background:#1a2331;border-color:#37507a}
  .flag{width:18px;height:12px;border-radius:2px;display:inline-block;box-shadow:0 0 0 1px rgba(255,255,255,.25) inset}
  .assistant-help__content{display:none}
  .assistant-help__content[data-active="1"]{display:block}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // SVG flags (EN/UK + UA). RU flag intentionally omitted.
  const SVG_UK = `
    <svg class="flag" viewBox="0 0 18 12" aria-hidden="true">
      <rect width="18" height="12" fill="#012169"/>
      <rect x="7" width="4" height="12" fill="#FFF"/>
      <rect y="4" width="18" height="4" fill="#FFF"/>
      <rect x="7.5" width="3" height="12" fill="#C8102E"/>
      <rect y="4.5" width="18" height="3" fill="#C8102E"/>
    </svg>`;
  const SVG_UA = `
    <svg class="flag" viewBox="0 0 18 12" aria-hidden="true">
      <rect width="18" height="6" y="0" fill="#005BBB"/>
      <rect width="18" height="6" y="6" fill="#FFD500"/>
    </svg>`;

  const overlay = document.createElement('div');
  overlay.className = 'assistant-help__overlay';

  const wrap = document.createElement('div');
  wrap.className = 'assistant-help__wrap';
  wrap.innerHTML = `
    <div class="assistant-help__hdr">
      <div class="assistant-help__title">How to use the chat</div>
      <div class="assistant-help__langbar" role="tablist" aria-label="Language">
        <button class="langbtn" data-set-lang="en" role="tab" aria-selected="true">${SVG_UK}<span>English</span></button>
        <button class="langbtn" data-set-lang="uk" role="tab" aria-selected="false">${SVG_UA}<span>Українська</span></button>
        <button class="langbtn" data-set-lang="ru" role="tab" aria-selected="false"><span>Русский</span></button>
      </div>
      <button class="assistant-help__close" type="button" aria-label="Close">✕</button>
    </div>

    <div class="assistant-help__body">
      <!-- EN -->
      <div class="assistant-help__content" data-lang="en">
        <p class="assistant-help__note">
          The Chat-Friend controls the player, finds music, movies & audiobooks (long-form),
          and can speak responses. Choose <b>Auto / Free / Pro</b> mode, pick a language, and (optionally) enable server TTS.
        </p>

        <h4>Quick start</h4>
        <ul class="assistant-help__list">
          <li>Press the mic or type — the assistant replies with text and (optionally) voice.</li>
          <li>You can activate and use the wake-up word DJ. (It may not work correctly if there is a lot of background noise.)</li>
          <li>In <b>Settings</b> choose language (UK/EN/RU), a voice, and TTS mode.</li>
          <li>Modes: <b>Free</b> = Groq, <b>Pro</b> = OpenAI, <b>Auto</b> = picks automatically.</li>
        </ul>

        <h4>Player controls</h4>
        <ul class="assistant-help__list">
          <li><code>Next</code>, <code>Previous</code>, <code>Pause</code>, <code>Stop</code>, <code>Play</code></li>
          <li><code>Louder</code> / <code>Quieter</code></li>
          <li><code>Minimize the window</code> / <code>Expand the window</code></li>
          <li><code>Mix radio</code> — endless flow by taste</li>
          <li><code>What’s playing?</code> — speaks the current track title</li>
        </ul>

        <h4>Play a track / genre / artist</h4>
        <ul class="assistant-help__list">
          <li><code>Play The Prodigy</code>, <code>Play classic rock</code></li>
          <li>Or just a query: <code>lofi hip hop radio</code></li>
          <li>Links/IDs from YouTube are understood (IDs are extracted from text).</li>
        </ul>

        <h4>By mood</h4>
        <ul class="assistant-help__list">
          <li><code>Calm</code>, <code>Happy</code>, <code>Sad</code>, <code>Energetic</code></li>
          <li>Example: <code>Pick something calm</code></li>
        </ul>

        <h4>Timers & “after current”</h4>
        <ul class="assistant-help__list">
          <li><code>Pause in 30 seconds</code>, <code>Stop in 1:30</code>, <code>Stop in one minute</code></li>
          <li><code>Pause after current track</code> / <code>Stop after current</code></li>
          <li>Cancel: <code>Cancel the timer</code></li>
        </ul>

        <h3 id="movies">Movies & audiobooks (long-form)</h3>
        <p>Ask for long videos — you’ll get cards with <b>Play</b> / <b>Open on YouTube</b>. Examples:</p>
        <ul class="assistant-help__list">
          <li><code>find movies</code>, <code>full movie: “The Irony of Fate”</code></li>
          <li><code>find audiobooks</code>, <code>audiobook: “Stephen King Misery”</code></li>
        </ul>
        <p>If you only see shorts, add words like <code>full movie</code> / <code>long</code>, or provide a specific title.</p>

        <h3 id="chat">Discussing music, films and books</h3>
        <p>The assistant can discuss music, give <b>artist bios</b>, talk about <b>plots</b>, and suggest what to listen to or watch.</p>

        <h4>Voice output</h4>
        <ul class="assistant-help__list">
          <li><b>Server TTS (Piper)</b> — better quality; needs a backend.</li>
          <li><b>Browser TTS</b> — system voices. If autoplay is blocked, press “Voice test”.</li>
        </ul>

        <h4>If nothing speaks</h4>
        <ul class="assistant-help__list">
          <li>Give the page a click first (browsers block sound before user gesture).</li>
          <li>Allow microphone/sound for the site.</li>
          <li>Check the green <code>AI</code> badge and that <code>window.API_BASE</code> points to your server.</li>
        </ul>
      </div>

      <!-- UK -->
      <div class="assistant-help__content" data-lang="uk">
        <p class="assistant-help__note">
          Асистент керує плеєром, знаходить музику, фільми та аудіокниги (довгі відео) і може озвучувати відповіді.
          Оберіть режим <b>Auto / Free / Pro</b>, мову та (за бажанням) серверний TTS.
        </p>

        <h4>Швидкий старт</h4>
        <ul class="assistant-help__list">
          <li>Натисніть мікрофон або надрукуйте — асистент відповість текстом і (за потреби) голосом.</li>
          <li>Можна активувати та використовувати wake-up слово DJ (діджей). (при сильних сторонніх шумах може некоректно спрацьовувати).</li>
          <li>У <b>Налаштуваннях</b> оберіть мову (UK/EN/RU), голос і режим TTS.</li>
          <li>Режими: <b>Free</b> = Groq, <b>Pro</b> = OpenAI, <b>Auto</b> = автоматичний вибір.</li>
        </ul>

        <h4>Керування плеєром</h4>
        <ul class="assistant-help__list">
          <li><code>Наступний</code>, <code>Попередній</code>, <code>Пауза</code>, <code>Стоп</code>, <code>Відтворити</code></li>
          <li><code>Гучніше</code> / <code>Тихіше</code> / <code>Без звуку</code></li>
          <li><code>Згорнути вікно</code> / <code>Розгорнути вікно</code></li>
          <li><code>Mix-radio</code> — нескінченний потік за смаком</li>
          <li><code>Що грає?</code> — озвучує назву треку</li>
        </ul>

        <h4>Трек / жанр / артист</h4>
        <ul class="assistant-help__list">
          <li><code>увімкни Queen</code>, <code>увімкни класичний рок</code></li>
          <li>Або просто запит: <code>lofi hip hop radio</code></li>
          <li>Розуміє посилання/ID YouTube (витягує ID з тексту).</li>
        </ul>

        <h4>За настроєм</h4>
        <ul class="assistant-help__list">
          <li><code>щось спокійне</code>, <code>сумне</code>, <code>радісне</code>, <code>енергійне</code></li>
        </ul>

        <h4>Таймери та «після поточного»</h4>
        <ul class="assistant-help__list">
          <li><code>пауза через 30 секунд</code>, <code>стоп через 1:30</code></li>
          <li><code>пауза після поточного треку</code> / <code>стоп після поточного</code></li>
          <li>Скасувати: <code>скасуй таймер</code></li>
        </ul>

        <h3 id="movies-uk">Фільми та аудіокниги (довгі відео)</h3>
        <p>Попросіть довгі відео — отримаєте картки з <b>Грати</b> / <b>Відкрити на YouTube</b>. Приклади:</p>
        <ul class="assistant-help__list">
        <li><code>ВАЖЛИВО! На слова включи/запропонуй/підбери фільми/аудіокниги/книги реагує по-різному</code>
          <li><code>запропонуй фільми комедії</code>, <code>ввімкни повний фільм: За двома зайцями</code></li>
          <li><code>знайди аудіокниги</code>, <code>запропонуй аудіокнигу: «Стівен Кінг Мізері»</code></li>
        </ul>
        <p>Якщо показує лише короткі ролики — додайте <code>повний фільм</code> / <code>довге</code> або вкажіть конкретну назву.</p>

        <h3 id="chat-uk">Обговорення музики, фільмів і книг</h3>
        <p>ШІ може обговорювати музику, давати <b>біографії артистів</b>, переказувати сюжети та радити, що слухати/дивитись.</p>

        <h4>Голос</h4>
        <ul class="assistant-help__list">
          <li><b>Server TTS (Piper)</b> — краща якість; потрібен бекенд.</li>
          <li><b>Browser TTS</b> — системні голоси. Якщо автозапуск заблокований — натисніть «Voice test».</li>
        </ul>

        <h4>Якщо нічого не озвучується</h4>
        <ul class="assistant-help__list">
          <li>Спершу натисніть десь на сторінці (браузери блокують звук до жесту).</li>
          <li>Дозвольте мікрофон та звук для сайту.</li>
          <li>Перевірте, що зелений бейдж <code>AI</code> активний і <code>window.API_BASE</code> вказує на ваш сервер.</li>
        </ul>
      </div>

      <!-- RU -->
      <div class="assistant-help__content" data-lang="ru">
        <p class="assistant-help__note">
          Ассистент управляет плеером, находит музыку, фильмы и аудиокниги (длинные видео)
          и может озвучивать ответы. Выберите режим <b>Auto / Free / Pro</b>, язык и при желании серверный TTS.
        </p>

        <h4>Быстрый старт</h4>
        <ul class="assistant-help__list">
          <li>Нажмите микрофон или введите текст — ассистент ответит текстом и (по желанию) голосом.</li>
           <li>Можно активировать и использовать wake-up слово DJ (ди джей). ( при сильных посторонних шумах может некорректно срабатывать ).</li>
          <li>В <b>Настройках</b> выберите язык (UK/EN/RU), голос и режим TTS.</li>
          <li>Режимы: <b>Free</b> = Groq, <b>Pro</b> = OpenAI, <b>Auto</b> = авто-выбор.</li>
        </ul>

        <h4>Управление плеером</h4>
        <ul class="assistant-help__list">
          <li><code>Следующий</code>, <code>Предыдущий</code>, <code>Пауза</code>, <code>Стоп</code>, <code>Воспроизвести</code></li>
          <li><code>Громче</code> / <code>Тише</code> / <code>Без звука</code></li>
          <li><code>Свернуть окно</code> / <code>Развернуть окно</code></li>
          <li><code>Mix-radio</code> — бесконечный поток по вкусу</li>
          <li><code>Что играет?</code> — произносит текущий трек</li>
        </ul>

        <h4>Трек / жанр / исполнитель</h4>
        <ul class="assistant-help__list">
          <li><code>включи Queen</code>, <code>включи классический рок</code></li>
          <li>Или общий запрос: <code>lofi hip hop radio</code></li>
          <li>Понимает ссылки/ID YouTube (ID извлекается из текста).</li>
        </ul>

        <h4>По настроению</h4>
        <ul class="assistant-help__list">
          <li><code>спокойное</code>, <code>радостное</code>, <code>грустное</code>, <code>энергичное</code></li>
        </ul>

        <h4>Таймеры и «после текущего»</h4>
        <ul class="assistant-help__list">
          <li><code>пауза через 30 секунд</code>, <code>стоп через 1:30</code>, <code>стоп через минуту</code></li>
          <li><code>пауза после текущего трека</code> / <code>стоп после текущего</code></li>
          <li>Отменить: <code>отмени таймер</code></li>
        </ul>

        <h3 id="movies-ru">Фильмы и аудиокниги (длинные видео)</h3>
        <p>Попросите длинные видео — появятся карточки с <b>Играть</b> / <b>Открыть на YouTube</b>. Примеры:</p>
        <ul class="assistant-help__list">
        <li><code>ВАЖНО!На слова включи/предложи/подбери фильмы/аудиокниги/книги реагирует по разному</code>
          <li><code>предложи фильмы</code>, <code>включи полный фильм: «За двумя зайцами»</code></li>
          <li><code>предложи аудиокниги</code>, <code>включи/предложи аудиокнига: «Стивен Кинг — Мизери»</code></li>
        </ul>
        <p>Если выпадают только шорты — добавьте <code>full movie</code> / <code>длинное</code> или укажите точное название.</p>

        <h3 id="chat-ru">Обсуждение музыки, фильмов и книг</h3>
        <p>ИИ обсуждает музыку, даёт <b>биографии</b>, пересказывает <b>сюжеты</b> и советует, что слушать/смотреть.</p>

        <h4>Голос</h4>
        <ul class="assistant-help__list">
          <li><b>Server TTS (Piper)</b> — лучшее качество; нужен бэкенд.</li>
          <li><b>Browser TTS</b> — системные голоса. Если автозапуск заблокирован — нажмите «Voice test».</li>
        </ul>

        <h4>Если ничего не озвучивается</h4>
        <ul class="assistant-help__list">
          <li>Сначала кликните по странице (браузеры блокируют звук без жеста).</li>
          <li>Разрешите микрофон/звук для сайта.</li>
          <li>Проверьте зелёный бейдж <code>AI</code> и что <code>window.API_BASE</code> указывает на ваш сервер.</li>
        </ul>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(wrap);

  // Language toggle
  (function setupLang() {
    const body = wrap.querySelector('.assistant-help__body');
    const btns = wrap.querySelectorAll('.langbtn');
    const contents = body.querySelectorAll('.assistant-help__content');
    function apply(lang) {
      contents.forEach(el => el.setAttribute('data-active', el.getAttribute('data-lang') === lang ? '1' : '0'));
      btns.forEach(b => b.setAttribute('aria-selected', b.dataset.setLang === lang ? 'true' : 'false'));
      try { localStorage.setItem('assistant.help.lang', lang); } catch {}
    }
    const saved = (() => { try { return localStorage.getItem('assistant.help.lang') || 'en'; } catch { return 'en'; }})();
    btns.forEach(b => b.addEventListener('click', () => apply(b.dataset.setLang)));
    apply(saved);
  })();

  // Open / close
  function open() {
    try { window.closeMenu?.(); } catch {}
    overlay.style.display = 'block';
    wrap.style.display = 'block';
  }
  function close() {
    overlay.style.display = 'none';
    wrap.style.display = 'none';
  }

  overlay.addEventListener('click', close);
  wrap.querySelector('.assistant-help__close')?.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  // Export + delegated trigger
  window.Assistant = window.Assistant || {};
  window.Assistant.showHelp = open;
  document.addEventListener('click', (e) => {
    const el = e.target.closest('.js-assistant-howto');
    if (el) { e.preventDefault(); open(); }
  });
})();
