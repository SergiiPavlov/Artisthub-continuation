/* 
 * chat.longform.merge.js — безопасная встройка PRO логики без правки вашего большого chat.js
 * Версия: 2.1.0 (2025-09-18)
 * Обновления:
 *  - Гарантированное эхо фразы пользователя (в т.ч. «аудиокнига») через отложенное обёртывание processAssistantQuery
 *  - Доп. слушатели универсальных voice-событий ('assistant:voice.result', 'assistant:input.voice')
 *  - Ненавязчивый submit-перехват для текстового ввода
 *  - Поток: сначала длинные видео; если нет — ссылка на YouTube + вопрос про короткие
 */

import { YTProProvider } from "./yt-pro-provider.js";

const LOG = (...a) => { try { (console.debug||console.log).call(console, "[chat.longform.merge]", ...a)} catch {} };

const FEED_SEL  = '.assistant__feed, .assistant__log, .assistant__messages';
const FORM_SEL  = '.assistant__form';
const INPUT_SEL = '.assistant__input, .assistant__text, input[type="text"]';

const esc = (s) => String(s||'').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));

function addMsg(kind, html) {
  try { if (typeof window.addMsg === 'function') return window.addMsg(kind, html); } catch {}
  const box = document.querySelector(FEED_SEL);
  if (!box) return;
  const div = document.createElement('div');
  div.className = `as-msg as-msg--${kind}`;
  div.innerHTML = html;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
function speak(text) { try { if (window.chat?.voice?.enabled && typeof window.chat.voice.say === 'function') window.chat.voice.say(text); } catch {} }

/* ===== Обёртка для processAssistantQuery с отложенной привязкой и авто-повтором ===== */
(function ensureWrapPAQ(){
  let wrapped = false;
  const wrap = () => {
    if (wrapped) return;
    const original = window.processAssistantQuery;
    if (typeof original !== "function") return;
    wrapped = true;
    window.processAssistantQuery = async function wrappedProcessAssistantQuery(raw) {
      try { addMsg("user", esc(String(raw))); } catch {}
      return await original.apply(this, arguments);
    };
    LOG("processAssistantQuery wrapped (echo-first, deferred).");
  };
  // Пытаемся несколько раз (на случай, если chat.js грузится позже)
  let tries = 0;
  const t = setInterval(() => {
    tries++;
    wrap();
    if (wrapped || tries >= 60) clearInterval(t); // ~12 секунд по 200мс
  }, 200);
  // И ещё попытка при фокусе окна (после ленивых загрузок)
  window.addEventListener('focus', wrap, { once: true });
})();

/* ===== Доп. эхо для голосовых пайплайнов, если они не зовут processAssistantQuery ===== */
window.addEventListener('assistant:voice.result', (e) => {
  const text = e?.detail?.text;
  if (text) addMsg('user', esc(String(text)));
});
window.addEventListener('assistant:input.voice', (e) => {
  const text = e?.detail?.text || e?.detail?.transcript;
  if (text) addMsg('user', esc(String(text)));
});

/* ===== Провайдер ===== */
const provider = new YTProProvider();

/* ===== Состояние «pending короткие» ===== */
function hasPendingShort(){ return !!(window.chat && window.chat.pendingShort); }
function setPendingShort(payload){ if (!window.chat) window.chat = {}; window.chat.pendingShort = payload; }
function clearPendingShort(){ if (window.chat) window.chat.pendingShort = null; }

/* ===== Парсинг намерения ===== */
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

/* ===== Карточки ===== */
function fmtDurISO(iso) {
  if (!iso || typeof iso !== 'string') return '';
  try {
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return '';
    const h = parseInt(m[1]||0,10), mm = parseInt(m[2]||0,10);
    if (h) return `${h}ч ${mm}м`;
    return `${mm||0} мин`;
  } catch { return ''; }
}

function renderList({ items }) {
  const feed = document.querySelector(FEED_SEL);
  if (!feed) return;
  const wrap = document.createElement('div');
  wrap.className = 'as-cards';
  if (!items || !items.length) {
    const msg = document.createElement('div');
    msg.className = 'as-cards__empty';
    msg.innerHTML = `Ничего не нашлось.`;
    wrap.appendChild(msg);
    feed.appendChild(wrap); feed.scrollTop = feed.scrollHeight; return;
  }
  items.forEach((it, idx) => {
    const card = document.createElement('div');
    card.className = 'as-card';
    const dur = fmtDurISO(it.duration);
    card.innerHTML = `
      <div class="as-card__idx">#${idx+1}</div>
      <div class="as-card__title">${esc(it.title || 'Без названия')}</div>
      <div class="as-card__meta">
        ${it.channel ? `<span class="as-card__author">${esc(it.channel)}</span>` : ''}
        ${dur ? `<span class="as-card__dur">${dur}</span>` : ''}
      </div>
      <div class="as-card__row">
        <button class="as-btn as-btn--play" data-id="${esc(it.id)}">▶ Играть</button>
        <a class="as-btn as-btn--link" href="https://www.youtube.com/watch?v=${esc(it.id)}" target="_blank" rel="noopener">Открыть на YouTube</a>
      </div>
    `;
    wrap.appendChild(card);
  });
  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.as-btn--play');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    if (!id) return;
    if (typeof window.loadAndPlayYouTubeVideo === "function") {
      window.loadAndPlayYouTubeVideo(id, { id });
    } else {
      const w = window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,"_blank","noopener");
      if (!w) addMsg('bot', `Откройте видео: https://www.youtube.com/watch?v=${id}`);
    }
    addMsg('note', 'Включаю…'); speak('Включаю');
  });
  feed.appendChild(wrap);
  feed.scrollTop = feed.scrollHeight;
}

/* ===== Submit-поток ===== */
(function bindForm(){
  const form = document.querySelector(FORM_SEL);
  const input = document.querySelector(INPUT_SEL);
  if (!form || !input) { LOG("form/input not found"); return; }

  form.addEventListener('submit', async (ev) => {
    try {
      let v = String(input.value||'').trim();
      if (!v) return;

      // Ответ на «Показать короткие ролики?»
      if (hasPendingShort()) {
        const ans = v.toLowerCase();
        addMsg('user', esc(v));
        ev.stopPropagation(); ev.preventDefault();
        if (/^(?:да|ага|угу|yes|sure|ok|okay|конечно|давай|хорошо)\b/.test(ans)) {
          const ps = window.chat.pendingShort;
          clearPendingShort();
          addMsg('note', 'Ищу короткие ролики…'); speak('Ищу короткие ролики');
          const q = provider.buildQuery({ type: ps.type||'movie', title: ps.title||'', mood:'', actor:'' });
          const shorts = await provider.searchManyAny(q, 12);
          if (!shorts.length) {
            const yurl = provider.buildYouTubeSearchURL(q, ps.type||'movie');
            addMsg('bot', `Коротких тоже не нашёл. Попробуйте на YouTube: <a href="${yurl}" target="_blank" rel="noopener">открыть YouTube</a>.`);
          } else {
            renderList({ items: shorts });
          }
        } else if (/^(?:нет|неа|no|не\s+надо|не\s+нужно)\b/.test(ans)) {
          clearPendingShort();
          addMsg('bot', 'Хорошо, не показываю короткие ролики.'); speak('Хорошо');
        } else {
          clearPendingShort(); // трактуем как новый запрос
        }
        return;
      }

      const intent = parseIntent(v);
      if (!intent) return; // пусть базовый чат обработает
      addMsg('user', esc(v));
      ev.stopPropagation(); ev.preventDefault();

      const q = provider.buildQuery({ type:intent.type, title:intent.title, mood:intent.mood, actor:intent.actor });

      if (intent.needSuggest || !intent.title) {
        addMsg('note','Подбираю варианты…'); speak('Подбираю варианты');
        const many = await provider.searchManyLong(q, 12);
        if (!many.length) {
          const yurl = provider.buildYouTubeSearchURL(q, intent.type);
          addMsg('bot', `Длинных видео не найдено. Можно поискать на YouTube: <a href="${yurl}" target="_blank" rel="noopener">открыть YouTube</a>.`);
          setPendingShort({ type:intent.type, title:intent.title||q });
          addMsg('bot', 'Показать короткие ролики? (да/нет)');
          speak('Показать короткие ролики?');
        } else {
          renderList({ items: many });
        }
        return;
      }

      addMsg('note', intent.type==='audiobook' ? 'Ищу и включаю аудиокнигу…' : 'Ищу и включаю фильм…');
      speak(intent.type==='audiobook' ? 'Ищу аудиокнигу' : 'Ищу фильм');
      const bestLong = await provider.searchOneLong(q, intent.type);
      if (bestLong) {
        const id = bestLong.id;
        if (typeof window.loadAndPlayYouTubeVideo === "function") {
          window.loadAndPlayYouTubeVideo(id, bestLong);
        } else {
          const w = window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,"_blank","noopener");
          if (!w) addMsg('bot', `Откройте видео: https://www.youtube.com/watch?v=${id}`);
        }
        return;
      }
      const yurl = provider.buildYouTubeSearchURL(q, intent.type);
      addMsg('bot', `Полную версию найти не удалось. Попробуйте на YouTube: <a href="${yurl}" target="_blank" rel="noopener">открыть YouTube</a>.`);
      setPendingShort({ type:intent.type, title:intent.title||q });
      addMsg('bot', 'Показать короткие ролики? (да/нет)');
      speak('Показать короткие ролики?');
    } catch(err) {
      console.warn('[chat.longform.merge] submit err', err);
    }
  }, true);
})();

console.log('[chat.longform.merge] ready');
