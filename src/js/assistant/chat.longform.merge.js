/* 
 * chat.longform.merge.js — безопасная встройка PRO логики без правки вашего большого chat.js
 * Версия: 2.6.0 (2025-09-18)
 * Новое по сравнению с 2.5:
 *  - Полный перехват processAssistantQuery (голос/ASR путь). Если распознали «фильм/сериал/аудиокнига» —
 *    сами шлём assistant:pro.play/suggest + watchdog и НЕ зовём оригинал, чтобы не было «Похоже на: …».
 *  - Дедупликация по последней фразе, чтобы не обрабатывать дважды.
 */

import { YTProProvider } from "./yt-pro-provider.js";

const LOG = (...a) => { try { (console.debug||console.log).call(console, "[chat.longform.merge]", ...a)} catch {} };

const DEFAULT_SELECTORS = {
  feed:  '.assistant__feed, .assistant__log, .assistant__messages',
  form:  '.assistant__form, form[action*="assistant"], form[data-role="assistant-form"]',
  input: '.assistant__input, .assistant__text, input[type="text"], [contenteditable=""], [contenteditable="true"], textarea',
  send:  '.assistant__send, .assistant__button--send, [data-role="assistant-send"], button[type="submit"]'
};

function getSelectors() {
  const cfg = (window.__ASSISTANT_SELECTORS__ || {});
  return {
    feed:  cfg.feed  || DEFAULT_SELECTORS.feed,
    form:  cfg.form  || DEFAULT_SELECTORS.form,
    input: cfg.input || DEFAULT_SELECTORS.input,
    send:  cfg.send  || DEFAULT_SELECTORS.send
  };
}

const esc = (s) => String(s||'').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));

function qs(sel, root=document){ try { return root.querySelector(sel) } catch { return null } }

function addMsg(kind, html) {
  try { if (typeof window.addMsg === 'function') return window.addMsg(kind, html); } catch {}
  const feedSel = getSelectors().feed;
  const box = qs(feedSel);
  if (!box) return;
  const div = document.createElement('div');
  div.className = `as-msg as-msg--${kind}`;
  div.innerHTML = html;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
function speak(text) { try { if (window.chat?.voice?.enabled && typeof window.chat.voice.say === 'function') window.chat.voice.say(text); } catch {} }

/* ===== Провайдер ===== */
const provider = new YTProProvider();

/* ===== Pending короткие ===== */
function hasPendingShort(){ return !!(window.chat && window.chat.pendingShort); }
function setPendingShort(payload){ if (!window.chat) window.chat = {}; window.chat.pendingShort = payload; }
function clearPendingShort(){ if (window.chat) window.chat.pendingShort = null; }

/* ===== Парсинг намерения ===== */
function parseIntent(raw) {
  const text = String(raw||'').trim();
  if (!text) return null;
  const low = text.toLowerCase();
  const hasMovie = /(\bфильм(?:ы)?\b|\bкино\b|\bсериал(?:ы)?\b|\bmovie\b|\bseries\b)/i.test(low);
  const hasAudio = /(?:\bаудио\s*книг(?:а|и|у)\b|\bкниг(?:а|у)\b|\baudiobook\b|\bаудио\b|\baudio\b)/i.test(low);
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
    const m2 = text.match(/(?:фильм(?:ы)?|кино|сериал(?:ы)?|movie|series|audiobook|аудио\s*книг(?:а|и|у)|книг(?:а|у)|\bаудио\b|\baudio\b)\s+([^,;.!?]+)$/i);
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

function renderList({ items, type='movie', q='' }) {
  const feed = qs(getSelectors().feed);
  if (!feed) return;
  const wrap = document.createElement('div');
  wrap.className = 'as-cards';
  if (!items || !items.length) {
    const msg = document.createElement('div');
    msg.className = 'as-cards__empty';
    if (type === 'audiobook') {
      msg.innerHTML = `Полноценная аудиокнига не найдена. ${q ? `Попробуйте на YouTube: <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(q)}" target="_blank" rel="noopener">открыть YouTube</a>.` : ''}`;
    } else {
      msg.innerHTML = `Полноценный фильм не найден. ${q ? `Попробуйте на YouTube: <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(q)}" target="_blank" rel="noopener">открыть YouTube</a>.` : ''} Могу показать короткие ролики. Показать?`;
      setPendingShort({ type: 'movie', title: q||'', mood:'', actor:'' });
    }
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
    if (window.Player && typeof window.Player.play === "function") {
      window.Player.play(id);
    } else {
      const w = window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,"_blank","noopener");
      if (!w) addMsg('bot', `Откройте видео: https://www.youtube.com/watch?v=${id}`);
    }
    addMsg('note', 'Включаю…'); speak('Включаю');
  });
  feed.appendChild(wrap);
  feed.scrollTop = feed.scrollHeight;
}

/* ===== Слушаем результаты longform и рендерим карточки ===== */
window.addEventListener('assistant:pro.suggest.result', (e) => {
  try {
    const d = e?.detail || {};
    LOG("result from longform:", d);
    renderList(d);
  } catch(err) { console.warn('[chat.longform.merge] render err', err); }
});

/* ===== Watchdog-фолбэк ===== */
const WD = { suggestTimer: null, playTimer: null };
function planSuggestWatchdog(detail) {
  if (WD.suggestTimer) clearTimeout(WD.suggestTimer);
  const { type='movie', title='', mood='', actor='', limit=12 } = (detail||{});
  const q = provider.buildQuery({ type, title, mood, actor });
  WD.suggestTimer = setTimeout(async () => {
    LOG("watchdog: no suggest.result in time — doing provider search", { type, title });
    const many = await provider.searchManyLong(q, limit);
    if (many && many.length) {
      renderList({ items: many, type, q });
    } else {
      const yurl = provider.buildYouTubeSearchURL(q, type);
      renderList({ items: [], type, q });
      addMsg('bot', `Длинных видео не найдено. Откройте поиск на YouTube: <a href="${yurl}" target="_blank" rel="noopener">сюда</a>.`);
    }
  }, 6000);
}
function planPlayWatchdog(detail) {
  if (WD.playTimer) clearTimeout(WD.playTimer);
  const { type='movie', title='', mood='', actor='' } = (detail||{});
  const q = provider.buildQuery({ type, title, mood, actor });
  WD.playTimer = setTimeout(async () => {
    LOG("watchdog: play not started — searching best long and playing", { type, title });
    const best = await provider.searchOneLong(q, type);
    if (best && best.id) {
      if (window.Player && typeof window.Player.play === 'function') window.Player.play(best.id);
      else window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(best.id)}`,"_blank","noopener");
      addMsg('note', 'Включаю…'); speak('Включаю');
    } else {
      const yurl = provider.buildYouTubeSearchURL(q, type);
      addMsg('bot', `Полную версию найти не удалось. <a href="${yurl}" target="_blank" rel="noopener">Открыть YouTube</a>?`);
      setPendingShort({ type, title: title||q });
      addMsg('bot', 'Показать короткие ролики? (да/нет)');
    }
  }, 5000);
}

/* ===== Перехват processAssistantQuery (голосовой путь) ===== */
let _lastHandled = { text: "", ts: 0 };
(function interceptPAQ(){
  let wrapped = false;
  const wrap = () => {
    if (wrapped) return;
    const original = window.processAssistantQuery;
    if (typeof original !== "function") return;
    wrapped = true;
    window.processAssistantQuery = async function wrappedProcessAssistantQuery(raw) {
      const text = String(raw||"");
      try { addMsg("user", esc(text)); } catch {}
      const intent = parseIntent(text);
      if (intent) {
        const now = Date.now();
        if (text === _lastHandled.text && (now - _lastHandled.ts) < 2000) {
          LOG("PAQ intercept: duplicate, skipping", text);
          return { handledByPro: true };
        }
        _lastHandled = { text, ts: now };

        const detail = { type:intent.type, title:intent.title, mood:intent.mood, actor:intent.actor, limit: 12 };
        LOG("PAQ intercept: dispatching", detail);

        if (intent.needSuggest || !intent.title) {
          window.dispatchEvent(new CustomEvent('assistant:pro.suggest', { detail }));
          addMsg('note','Подбираю варианты…'); speak('Подбираю варианты');
          planSuggestWatchdog(detail);
        } else {
          window.dispatchEvent(new CustomEvent('assistant:pro.play', { detail }));
          addMsg('note', intent.type==='audiobook' ? 'Ищу и включаю аудиокнигу…' : 'Ищу и включаю фильм…');
          speak(intent.type==='audiobook' ? 'Ищу аудиокнигу' : 'Ищу фильм');
          planPlayWatchdog(detail);
        }
        return { handledByPro: true };
      }
      // не наш кейс — отдаём оригиналу
      return await original.apply(this, arguments);
    };
    LOG("processAssistantQuery intercepted (voice path).");
  };
  // Пытаемся несколько раз — вдруг processAssistantQuery появится позже
  let tries = 0;
  const iv = setInterval(() => { tries++; wrap(); if (wrapped || tries>=60) clearInterval(iv); }, 200);
  window.addEventListener('focus', wrap, { once: true });
})();

/* ===== Привязка к UI (форма/инпут/кнопка) ===== */
let bound = false;
function tryBindOnce() {
  if (bound) return;
  const sels = getSelectors();
  const form  = qs(sels.form) || null;
  const input = qs(sels.input) || null;
  const send  = qs(sels.send) || null;

  if (!form && !input && !send) return;

  // Submit формы
  if (form) {
    form.addEventListener('submit', async (ev) => {
      try {
        const tgt = ev.target;
        const valNode = qs(sels.input, tgt) || qs(sels.input, document);
        const value = (valNode && ('value' in valNode ? valNode.value : valNode.textContent)) || '';
        const handled = await (async (v)=>{
          // используем ту же логику, что и в перехвате PAQ
          const intent = parseIntent(v);
          if (!intent) return false;
          addMsg('user', esc(v));
          const detail = { type:intent.type, title:intent.title, mood:intent.mood, actor:intent.actor, limit: 12 };
          if (intent.needSuggest || !intent.title) {
            window.dispatchEvent(new CustomEvent('assistant:pro.suggest', { detail }));
            addMsg('note','Подбираю варианты…'); speak('Подбираю варианты'); planSuggestWatchdog(detail);
          } else {
            window.dispatchEvent(new CustomEvent('assistant:pro.play', { detail }));
            addMsg('note', intent.type==='audiobook' ? 'Ищу и включаю аудиокнигу…' : 'Ищу и включаю фильм…');
            speak(intent.type==='audiobook' ? 'Ищу аудиокнигу' : 'Ищу фильм'); planPlayWatchdog(detail);
          }
          return true;
        })(value);
        if (handled) { ev.stopPropagation(); ev.preventDefault(); }
      } catch (e) { console.warn('[chat.longform.merge] submit err', e); }
    }, true);
  }

  // Enter по input (если нет формы)
  if (input && !form) {
    input.addEventListener('keydown', async (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey) {
        const val = ('value' in input ? input.value : input.textContent) || '';
        const handled = !!parseIntent(val);
        if (handled) { ev.stopPropagation(); ev.preventDefault(); }
      }
    }, true);
  }

  // Клик по send-кнопке
  if (send) {
    send.addEventListener('click', async (ev) => {
      try {
        const valNode = qs(sels.input) || document.activeElement;
        const value = (valNode && ('value' in valNode ? valNode.value : valNode.textContent)) || '';
        const intent = parseIntent(value);
        if (intent) {
          addMsg('user', esc(value));
          const detail = { type:intent.type, title:intent.title, mood:intent.mood, actor:intent.actor, limit: 12 };
          if (intent.needSuggest || !intent.title) {
            window.dispatchEvent(new CustomEvent('assistant:pro.suggest', { detail }));
            addMsg('note','Подбираю варианты…'); speak('Подбираю варианты'); planSuggestWatchdog(detail);
          } else {
            window.dispatchEvent(new CustomEvent('assistant:pro.play', { detail }));
            addMsg('note', intent.type==='audiobook' ? 'Ищу и включаю аудиокнигу…' : 'Ищу и включаю фильм…');
            speak(intent.type==='audiobook' ? 'Ищу аудиокнигу' : 'Ищу фильм'); planPlayWatchdog(detail);
          }
          ev.stopPropagation(); ev.preventDefault();
        }
      } catch (e) { console.warn('[chat.longform.merge] send err', e); }
    }, true);
  }

  bound = true;
  LOG("bound to UI:", { form: !!form, input: !!input, send: !!send });
}

function bootstrapBinding() {
  tryBindOnce();
  if (bound) return;
  const obs = new MutationObserver(() => { if (!bound) tryBindOnce(); if (bound) obs.disconnect(); });
  obs.observe(document.documentElement || document.body, { childList: true, subtree: true });
  window.addEventListener('DOMContentLoaded', tryBindOnce, { once: true });
  window.addEventListener('load', tryBindOnce, { once: true });
}

/* ===== Старт ===== */
bootstrapBinding();
LOG("ready");
