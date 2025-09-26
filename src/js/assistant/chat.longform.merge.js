/* chat.longform.merge.js — v2.6.6
   - Вернули HARD-GUARD (роут assistant:play/radio/music.play в PRO)
   - Жёсткая клиентская фильтрация коротышей (movie ≥ 60m, audiobook ≥ 30m)
   - long-only обогащение (searchManyLong строго длинные)
   - респектуем detail.limit (6..20)
   - гидрация заголовков, дедуп карточек
*/

import { YTProProvider } from "./yt-pro-provider.js";
try{ window.__ASSIST_LONGFORM_MERGE_ACTIVE = true; }catch{}
const LOG = (...a) => { try { (console.debug||console.log).call(console, "[chat.longform.merge]", ...a)} catch {} };

const DEFAULT_SELECTORS = {
  feed:  '.assistant__feed, .assistant__log, .assistant__messages',
  form:  '.assistant__form, form[action*="assistant"], form[data-role="assistant-form"]',
  input: '.assistant__input, .assistant__text, input[type="text"], [contenteditable=""], [contenteditable="true"], textarea',
  send:  '.assistant__send, .assistant__button--send, [data-role="assistant-send"], button[type="submit"]'
};
function getSelectors() {
  const cfg = (window.__ASSISTANT_SELECTORS__ || {});
  return { feed: cfg.feed||DEFAULT_SELECTORS.feed, form: cfg.form||DEFAULT_SELECTORS.form, input: cfg.input||DEFAULT_SELECTORS.input, send: cfg.send||DEFAULT_SELECTORS.send };
}
const esc = (s) => String(s||'').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
function qs(sel, root=document){ try { return root.querySelector(sel) } catch { return null } }

function addMsg(kind, html) {
  try { if (typeof window.addMsg === 'function') return window.addMsg(kind, html); } catch {}
  const box = qs(getSelectors().feed); if (!box) return;
  const div = document.createElement('div'); div.className = `as-msg as-msg--${kind}`; div.innerHTML = html;
  box.appendChild(div); box.scrollTop = box.scrollHeight;
}
function speak(text) { try { if (window.chat?.voice?.enabled && typeof window.chat.voice.say === 'function') window.chat.voice.say(text); } catch {} }

const provider = new YTProProvider();

/* ==== Utils ==== */
async function openAndPlay(id){
  try {
    if (window.Player && typeof window.Player.open === 'function') {
      await window.Player.open(id);
      if (typeof window.Player.play === 'function') await window.Player.play();
      return true;
    }
    if (window.Player && typeof window.Player.openQueue === 'function') {
      await window.Player.openQueue([id], { shuffle:false, startIndex:0 });
      if (typeof window.Player.play === 'function') await window.Player.play();
      return true;
    }
  } catch(e){ console.warn('[merge] open/play error', e); }
  const w = window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,"_blank","noopener");
  if (!w) addMsg('bot', `Откройте видео: https://www.youtube.com/watch?v=${id}`);
  return !!w;
}

/* ==== Pending короткие ==== */
function hasPendingShort(){ return !!(window.chat && window.chat.pendingShort); }
function setPendingShort(payload){ if (!window.chat) window.chat = {}; window.chat.pendingShort = payload; }
function clearPendingShort(){ if (window.chat) window.chat.pendingShort = null; }

/* ==== Парсинг ==== */
function parseIntent(raw) {
  const text = String(raw||'').trim(); if (!text) return null;
  const low = text.toLowerCase();
  const hasMovie = /(\bфильм(?:ы)?\b|\bкино\b|\bсериал(?:ы)?\b|\bmovie\b|\bseries\b)/i.test(low);
  const hasAudio = /(?:\bаудио\s*книг(?:а|и|у)\b|\bкниг(?:а|у)\b|\baudiobook\b|\bаудио\b|\baudio\b)/i.test(low);
  if (!hasMovie && !hasAudio) return null;
  const needSuggest = /(вариант|подбери|предлож|посоветуй|порекомендуй|suggest|под\s+настроени[ея])/i.test(low);
  const qm = text.match(/["“”«»„‟']([^"“”«»„‟']{2,})["“”«»„‟']/); const titleQuoted = qm ? qm[1].trim() : "";
  let actor = ""; const am = text.match(/(?:\bс\s+(?:актером|актрисой)?\s*|\bwith\s+)([a-zа-яёіїє][\w'\-]+(?:\s+[a-zа-яёіїє][\w'\-]+){0,2})/i); if (am) actor = am[1].trim();
  let mood = ""; let mm = text.match(/под\s+настроени[ея]\s+([a-zA-Zа-яА-ЯёЁіІїЇєЄ\- ]{3,})/i) || text.match(/настроени[ея]\s+([a-zа-яёіїє\- ]{3,})/i); if (mm) mood = mm[1].trim();
  let title = titleQuoted;
  if (!title) {
    const m2 = text.match(/(?:фильм(?:ы)?|кино|сериал(?:ы)?|movie|series|audiobook|аудио\s*книг(?:а|и|у)|книг(?:а|у)|\bаудио\b|\baudio\b)\s+([^,;.!?]+)$/i);
    if (m2) { let t = m2[1]; t = t.replace(/\s+с\s+.+$/i, "").replace(/\s+with\s+.+$/i, ""); title = t.trim(); }
  }
  const type = hasAudio ? 'audiobook' : 'movie';
  return { type, title, mood, actor, needSuggest };
}

/* ==== Нормализация карточек + длительность ==== */
function fmtDurISO(iso) {
  if (!iso || typeof iso !== 'string') return '';
  try { const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); if (!m) return ''; const h = parseInt(m[1]||0,10), mm = parseInt(m[2]||0,10); return h ? `${h}ч ${mm}м` : `${mm||0} мин`; } catch { return ''; }
}
function parseISOtoSec(iso){
  if (!iso || typeof iso !== 'string') return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h = parseInt(m[1]||0,10), mm = parseInt(m[2]||0,10), s = parseInt(m[3]||0,10);
  return h*3600 + mm*60 + s;
}
function parseClockToSec(s){
  if (!s || typeof s !== 'string') return 0;
  const t = s.trim();
  if (!/^\d{1,2}:\d{2}(?::\d{2})?$/.test(t)) return 0;
  const p = t.split(':').map(x=>parseInt(x,10)||0);
  if (p.length === 2) return p[0]*60 + p[1];
  if (p.length === 3) return p[0]*3600 + p[1]*60 + p[2];
  return 0;
}

function fmtDurationAny(d){
  const hide = () => '';
  if (d === null || d === undefined) return hide();
  if (typeof d === 'number' && isFinite(d)) {
    const sec = Math.max(0, Math.floor(d));
    if (sec < 60) return hide();
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60);
    return h ? (h + 'ч ' + String(m).padStart(2,'0') + 'м') : (m + ' мин');
  }
  const s = String(d).trim();
  if (!s) return hide();
  if (s.startsWith('PT')) {
    const m = s.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const sec = m ? (parseInt(m[1]||0,10)*3600 + parseInt(m[2]||0,10)*60 + parseInt(m[3]||0,10)) : 0;
    if (sec < 60) return hide();
    const hh = Math.floor(sec/3600), mm = Math.floor((sec%3600)/60);
    return hh ? (hh + 'ч ' + String(mm).padStart(2,'0') + 'м') : (mm + ' мин');
  }
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(s)) {
    const p = s.split(':').map(x=>parseInt(x,10)||0);
    const sec = (p.length===3) ? (p[0]*3600 + p[1]*60 + p[2]) : (p[0]*60 + p[1]);
    if (sec < 60) return hide();
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60);
    return h ? (h + 'ч ' + String(m).padStart(2,'0') + 'м') : (m + ' мин');
  }
  return hide();
}
function minSeconds(type){ return type === 'audiobook' ? 1800 : 3600; } // 30m / 60m

function pickId(it){
  return it.id || it.videoId || it.vid || it.ytId || (it.snippet && it.snippet.resourceId && it.snippet.resourceId.videoId) || '';
}
function pickTitle(it){
  const cands = [ it.title, it.name, it.videoTitle, it.text, it.originalTitle, it.label, it.snippet && it.snippet.title, it.og && it.og.title ];
  let t = ''; for (let i=0;i<cands.length;i++){ if (cands[i] && String(cands[i]).trim()){ t = String(cands[i]).trim(); break; } }
  if (/^undefined$/i.test(t)) t = '';
  return t;
}
function pickChannel(it){
  const cands = [it.channel, it.channelTitle, it.author, it.owner, it.uploader, it.snippet && it.snippet.channelTitle];
  for (let i=0;i<cands.length;i++){ if (cands[i] && String(cands[i]).trim()) return String(cands[i]).trim(); }
  return '';
}
function pickDuration(it){
  return it.duration || (it.contentDetails && it.contentDetails.duration) || '';
}
function normItem(it){
  if (!it) return null;
  const id = pickId(it); if (!id) return null;
  const title = pickTitle(it);
  const channel = pickChannel(it);
  const duration = pickDuration(it);
  return { id, title, channel, duration };
}
function dedupeById(arr){
  const seen = new Set(); const out = [];
  for (let i=0;i<(arr||[]).length;i++){
    const it = arr[i]; const id = it && it.id;
    if (!id || seen.has(id)) continue; seen.add(id); out.push(it);
  }
  return out;
}
function sigFromItems(items){ try { return (items||[]).map(x=>x.id||'').filter(Boolean).join(','); } catch{ return ''; } }
function sigFromWrap(el){
  try { const ex = el.querySelectorAll('.as-btn--play[data-id]'); return Array.from(ex).map(n=>n.getAttribute('data-id')||'').filter(Boolean).join(','); } catch { return ''; }
}
function countTitled(el){
  try { const ts = el.querySelectorAll('.as-card__title'); return Array.from(ts).filter(n => { const t = (n.textContent||'').trim(); return !!t && t !== 'Без названия'; }).length; } catch { return 0; }
}
async function fetchTitleByOEmbed(id){
  try{ const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`; const r = await fetch(url, { mode: 'cors' }); if (!r.ok) return ""; const j = await r.json(); return j && j.title ? String(j.title).trim() : ""; }catch{return "";}
}
async function ensureTitles(items, timeoutMs){
  const need = (items||[]).filter(it => it && it.id && !(it.title && String(it.title).trim()));
  if (!need.length) return items;
  const timer = new Promise(res => setTimeout(()=>res('timeout'), timeoutMs||900));
  const worker = (async () => { for (let i=0;i<need.length;i++){ const it = need[i]; try { const t = await fetchTitleByOEmbed(it.id); if (t) it.title = t; } catch {} } return 'ok'; })();
  try { await Promise.race([timer, worker]); } catch {}
  return items;
}
function hardDedupeCards(){
  const feed = qs(getSelectors().feed); if (!feed) return;
  const blocks = Array.from(feed.querySelectorAll('.as-cards'));
  if (blocks.length < 2) return;
  const groups = new Map();
  for (let i=0;i<blocks.length;i++){
    const el = blocks[i];
    const sigAttr = el.dataset && el.dataset.sig || "";
    const sig = sigAttr || sigFromWrap(el) || ("__idx_"+i);
    const arr = groups.get(sig) || [];
    arr.push(el); groups.set(sig, arr);
  }
  groups.forEach(arr => {
    if (arr.length <= 1) return;
    arr.sort((a,b) => { const da = countTitled(a), db = countTitled(b); return da - db; });
    for (let i=0;i<arr.length-1;i++){ try { arr[i].remove(); } catch{} }
  });
}

/* ==== Рендер карточек ==== */
async function renderList({ items, type='movie', q='', kind='suggest', limit=12 }) {
  const feed = qs(getSelectors().feed); if (!feed) return;
  limit = Math.max(6, Math.min(20, Number(limit)||12));

  // нормализация
  try { items = (items||[]).map(normItem).filter(Boolean); } catch {}
  items = dedupeById(items);

  // ЖЁСТКИЙ фильтр коротышей по длительности (если длительность узнаваема)
  const needSec = minSeconds(type);
  const longs = items.filter(it => {
    const iso = String(it.duration||'');
    let sec = 0;
    if (/^PT/.test(iso)) sec = parseISOtoSec(iso);
    else if (/\d+:\d{2}/.test(iso)) sec = parseClockToSec(iso);
    // если длительность неизвестна — временно пропускаем, ниже будет обогащение long-only
    return sec === 0 ? true : (sec >= needSec);
  });

  // если что-то знаем — показываем только длинные/неизвестные
  items = longs.length ? longs : items;

  // обрезаем до лимита временно (после обогащения ещё раз обрежем)
  items = items.slice(0, limit);

  // если сервер дал мало или у всех неизвестна длительность — дотягиваем СТРОГО long-only через provider
  if (items.length < Math.min(6, limit)) {
    try {
      const qBuilt = provider.buildQuery({ type, title: q || '', mood:'', actor:'' });
      const more = await provider.searchManyLong(qBuilt, limit, type); // OK, лишние аргументы игнорируются если не поддерживается
      const moreFixed = (more||[]).map(normItem).filter(Boolean);
      items = dedupeById(items.concat(moreFixed)).slice(0, limit);
    } catch (e) { LOG('enrich fail', e); }
  }

  // Fallback to ANY-length if still too few
  try {
    if (!items.length || items.length < Math.min(4, limit)) {
      const anyQ = provider.buildQuery({ type, title: q || '', mood:'', actor:'' });
      const any = await provider.searchManyAny(anyQ, limit, type);
      const anyFixed = (any||[]).map(normItem).filter(Boolean);
      items = dedupeById(items.concat(anyFixed)).slice(0, limit);
    }
  } catch (e) { LOG('any-fallback fail', e); }

  // гидрация заголовков
  try {
    const titled = items.filter(it => it.title && String(it.title).trim()).length;
    if (items.length && titled < Math.ceil(items.length/2)) {
      items = await ensureTitles(items, 900);
    }
  } catch {}

  const sig = sigFromItems(items);
  const wrap = document.createElement('div');
  wrap.className = 'as-cards';
  try { wrap.dataset.kind = kind; wrap.dataset.sig = sig; } catch(_){}

  if (!items.length) {
    const msg = document.createElement('div'); msg.className = 'as-cards__empty';
    const yurl = provider.buildYouTubeSearchURL(q, type);
    msg.innerHTML = type === 'audiobook'
      ? `Полноценная аудиокнига не найдена. ${q ? `Попробуйте на YouTube: <a href="${yurl}" target="_blank" rel="noopener">открыть YouTube</a>.` : ''}`
      : `Полноценный фильм не найден. ${q ? `Попробуйте на YouTube: <a href="${yurl}" target="_blank" rel="noopener">открыть YouTube</a>.` : ''}`;
    wrap.appendChild(msg);
    feed.appendChild(wrap);
    feed.scrollTop = feed.scrollHeight;
    hardDedupeCards();
    return;
  }

  for (let idx=0; idx<items.length; idx++){
    const it = items[idx];
    const card = document.createElement('div'); card.className = 'as-card';
    try { card.setAttribute('data-id', String(it.id)); } catch{}
    const dur = fmtDurationAny(it.duration);
    let titleText = String(it.title||'').replace(/\bundefined\b/gi,'').replace(/\s+/g,' ').trim(); if (!titleText) titleText = 'Без названия';
    const ch = String(it.channel||'').trim();

    card.innerHTML = `
      <div class="as-card__idx">#${idx+1}</div>
      <div class="as-card__imgwrap"><img class="as-card__img" src="https://i.ytimg.com/vi/${esc(it.id)}/hqdefault.jpg" alt="${esc(titleText)}" loading="lazy"/>${dur ? `<span class="as-card__badge">${esc(dur)}</span>` : ""}</div>
      <div class="as-card__title">${esc(titleText)}</div>
      <div class="as-card__meta">
        ${ch ? `<span class="as-card__author">${esc(ch)}</span>` : ''}
        ${dur ? `<span class="as-card__dur">${dur}</span>` : ''}
      </div>
      <div class="as-card__row">
        <button class="as-btn as-btn--play" data-id="${esc(it.id)}">▶ Играть</button>
        <a class="as-btn as-btn--link" href="https://www.youtube.com/watch?v=${esc(it.id)}" target="_blank" rel="noopener">Открыть на YouTube</a>
      </div>`;
    wrap.appendChild(card);
  }

  wrap.addEventListener('click', async (e) => {
    const btn = e.target.closest('.as-btn--play'); if (!btn) return;
    const id = btn.getAttribute('data-id'); if (!id) return;
    await openAndPlay(id);
    addMsg('note', 'Включаю…'); speak('Включаю');
  });

  feed.appendChild(wrap); feed.scrollTop = feed.scrollHeight;

  // поздняя гидрация «Без названия»
  (async () => {
    try {
      const need = items.filter(it => it && it.id && !(it.title && String(it.title).trim()));
      if (!need.length) { hardDedupeCards(); return; }
      for (const it of need) {
        const t = await fetchTitleByOEmbed(it.id);
        if (!t) continue;
        const safeId = (window.CSS && CSS.escape) ? CSS.escape(it.id) : it.id.replace(/"/g,'\\"');
        const node = wrap.querySelector(`.as-card[data-id="${safeId}"] .as-card__title`);
        if (node && (node.textContent||'').trim() === 'Без названия') node.textContent = t;
      }
      hardDedupeCards();
    } catch {}
  })();

  hardDedupeCards();
}

/* ==== слушаем результат longform ==== */
window.addEventListener('assistant:pro.suggest.result', async (e) => {
  try {
    const d = e?.detail || {};
    const detail = {
      type: d.type || 'movie',
      title: d.title || '',
      mood: d.mood || '',
      actor: d.actor || '',
      limit: Math.max(6, Math.min(20, Number(d.limit)||12))
    };
    try { if (WD && WD.suggestTimer) { clearTimeout(WD.suggestTimer); WD.suggestTimer = null; } } catch {}
    const qBuilt = d.q || provider.buildQuery({ type: detail.type, title: detail.title, mood: detail.mood, actor: detail.actor });
    WD.seenIds = WD.seenIds || new Set();
    let items = Array.isArray(d.items) ? d.items : [];
    items = (items||[]).filter(it => it && it.id && !WD.seenIds.has(it.id));
    if (!items.length) {
      try {
        const qb = d.q || provider.buildQuery({ type: detail.type, title: detail.title, mood: detail.mood, actor: detail.actor });
        const more = await provider.searchManyLong(qb, detail.limit + 8, detail.type);
        items = (more||[]).map(normItem).filter(Boolean).filter(it => it && it.id && !WD.seenIds.has(it.id));
      } catch {}
    }
    await renderList({ items, type: detail.type, q: qBuilt, kind: 'suggest', limit: detail.limit });
    try { (items||[]).forEach(it => { if (it && it.id) { WD.seenIds.add(it.id); try{ window.__ASSIST_SEEN_IDS = window.__ASSIST_SEEN_IDS || new Set(); window.__ASSIST_SEEN_IDS.add(it.id); }catch{} } }); } catch {}
  } catch(err) { console.warn('[chat.longform.merge] render err', err); }
});

/* ==== Watchdog ==== */
const WD = { suggestTimer: null, playTimer: null };
function planSuggestWatchdog(detail) {
  if (WD.suggestTimer) clearTimeout(WD.suggestTimer);
  const type  = (detail && detail.type)  || 'movie';
  const title = (detail && detail.title) || '';
  const mood  = (detail && detail.mood)  || '';
  const actor = (detail && detail.actor) || '';
  const limit = Math.max(6, Math.min(20, Number(detail && detail.limit) || 12));
  const q = provider.buildQuery({ type, title, mood, actor });
  WD.suggestTimer = setTimeout(async () => {
    LOG("watchdog: no suggest.result in time — doing provider search", { type, title });
    const many = await provider.searchManyLong(q, limit, type); // строго длинные
    if (many && many.length) { await renderList({ items: many, type, q, kind:'wd-suggest', limit }); }
    else {
      const yurl = provider.buildYouTubeSearchURL(q, type);
      await renderList({ items: [], type, q, kind:'wd-suggest', limit });
      addMsg('bot', `Длинных видео не найдено. Откройте поиск на YouTube: <a href="${yurl}" target="_blank" rel="noopener">сюда</a>.`);
    }
  }, 6000);
}
function planPlayWatchdog(detail) {
  if (WD.playTimer) clearTimeout(WD.playTimer);
  const type  = (detail && detail.type)  || 'movie';
  const title = (detail && detail.title) || '';
  const mood  = (detail && detail.mood)  || '';
  const actor = (detail && detail.actor) || '';
  const q = provider.buildQuery({ type, title, mood, actor });
  WD.playTimer = setTimeout(async () => {
    LOG("watchdog: play not started — searching best long and playing", { type, title });
    const best = await provider.searchOneLong(q, type);
    if (best && best.id) { await openAndPlay(best.id); addMsg('note', 'Включаю…'); speak('Включаю'); }
    else {
      const yurl = provider.buildYouTubeSearchURL(q, type);
      addMsg('bot', `Полную версию найти не удалось. <a href="${yurl}" target="_blank" rel="noopener">Открыть YouTube</a>?`);
      setPendingShort({ type, title: title||q });
      addMsg('bot', 'Показать короткие ролики? (да/нет)');
    }
  }, 5000);
}

/* ==== Перехват processAssistantQuery (голос) ==== */
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
        if (text === _lastHandled.text && (now - _lastHandled.ts) < 2000) { LOG("PAQ intercept: duplicate, skipping", text); return { handledByPro: true }; }
        _lastHandled = { text, ts: now };
        const detail = { type:intent.type, title:intent.title, mood:intent.mood, actor:intent.actor, limit: 12 };
        LOG("PAQ intercept: dispatching", detail);
        if (intent.needSuggest || !intent.title) {
          window.dispatchEvent(new CustomEvent('assistant:pro.suggest', { detail })); addMsg('note','Подбираю варианты…'); speak('Подбираю варианты'); planSuggestWatchdog(detail);
        } else {
          window.dispatchEvent(new CustomEvent('assistant:pro.play', { detail })); addMsg('note', intent.type==='audiobook' ? 'Ищу и включаю аудиокнигу…' : 'Ищу и включаю фильм…'); speak(intent.type==='audiobook' ? 'Ищу аудиокнигу' : 'Ищу фильм'); planPlayWatchdog(detail);
        }
        return { handledByPro: true };
      }
      return await original.apply(this, arguments);
    };
    LOG("processAssistantQuery intercepted (voice path).");
  };
  let tries = 0;
  const iv = setInterval(() => { tries++; wrap(); if (wrapped || tries>=60) clearInterval(iv); }, 200);
  window.addEventListener('focus', wrap, { once: true });
})();

/* ==== HARD-GUARD: принудительный роут фильмов/аудиокниг в PRO ==== */
;(function hardGuardProRoute(){
  function looksMovieOrAudio(q){
    const s = String(q||'').toLowerCase();
    const isMovie = /(\bфильм(?:ы)?\b|\bкино\b|\bсериал(?:ы)?\b|\bmovie\b|\bseries\b)/i.test(s);
    const isAudio = /(\bаудио\s*книг(?:а|и|у)\b|\bкниг(?:а|у)\b|\baudiobook\b|\bаудио\b|\baudio\b)/i.test(s);
    return { isMovie, isAudio, ok: isMovie || isAudio };
  }
  function rerouteToPro(ev){
    try{
      const d = (ev && ev.detail) || {};
      const q = d.title || d.query || d.text || d.transcript || d.prompt || '';
      const { ok, isAudio } = looksMovieOrAudio(q);
      if (!ok) return;

      ev.stopImmediatePropagation && ev.stopImmediatePropagation();
      ev.stopPropagation && ev.stopPropagation();
      ev.preventDefault && ev.preventDefault();

      const limit = Math.max(6, Math.min(20, Number(d.limit)||12));
      window.dispatchEvent(new CustomEvent('assistant:pro.play', {
        detail: { type: isAudio ? 'audiobook' : 'movie', title: q.trim(), limit }
      }));
    }catch{}
  }
  try {
    window.addEventListener('assistant:play',       rerouteToPro, true);
    window.addEventListener('assistant:radio',      rerouteToPro, true);
    window.addEventListener('assistant:music.play', rerouteToPro, true);
  } catch {}
})();

/* ==== Привязка к UI ==== */
let bound = false;
async function handleSubmitText(v) {
  const intent = parseIntent(v); if (!intent) return false;
  addMsg('user', esc(v));
  const detail = { type:intent.type, title:intent.title, mood:intent.mood, actor:intent.actor, limit: 12 };
  if (intent.needSuggest || !intent.title) { window.dispatchEvent(new CustomEvent('assistant:pro.suggest', { detail })); addMsg('note','Подбираю варианты…'); speak('Подбираю варианты'); planSuggestWatchdog(detail); }
  else { window.dispatchEvent(new CustomEvent('assistant:pro.play', { detail })); addMsg('note', intent.type==='audiobook' ? 'Ищу и включаю аудиокнигу…' : 'Ищу и включаю фильм…'); speak(intent.type==='audiobook' ? 'Ищу аудиокнигу' : 'Ищу фильм'); planPlayWatchdog(detail); }
  return true;
}
function tryBindOnce() {
  if (bound) return;
  const sels = getSelectors();
  const form  = qs(sels.form) || null;
  const input = qs(sels.input) || null;
  const send  = qs(sels.send) || null;
  if (!form && !input && !send) return;

  if (form) form.addEventListener('submit', async (ev) => { try { const valNode = qs(sels.input, ev.target) || qs(sels.input, document); const value = (valNode && ('value' in valNode ? valNode.value : valNode.textContent)) || ''; const handled = await handleSubmitText(value); if (handled) { ev.stopPropagation(); ev.preventDefault(); } } catch(e){ console.warn('[chat.longform.merge] submit err', e); } }, true);
  if (input && !form) input.addEventListener('keydown', async (ev) => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey) { const val = ('value' in input ? input.value : input.textContent) || ''; const handled = await handleSubmitText(val); if (handled) { ev.stopPropagation(); ev.preventDefault(); } } }, true);
  if (send) send.addEventListener('click', async (ev) => { try { const valNode = qs(sels.input) || document.activeElement; const value = (valNode && ('value' in valNode ? valNode.value : valNode.textContent)) || ''; const handled = await handleSubmitText(value); if (handled) { ev.stopPropagation(); ev.preventDefault(); } } catch(e){ console.warn('[chat.longform.merge] send err', e); } }, true);

  bound = true; LOG("bound to UI:", { form: !!form, input: !!input, send: !!send });
}
function bootstrapBinding(){ tryBindOnce(); if (bound) return; const obs = new MutationObserver(() => { if (!bound) tryBindOnce(); if (bound) obs.disconnect(); }); obs.observe(document.documentElement || document.body, { childList: true, subtree: true }); window.addEventListener('DOMContentLoaded', tryBindOnce, { once: true }); window.addEventListener('load', tryBindOnce, { once: true }); }
bootstrapBinding(); LOG("ready");


// ---- auto-stop watchdog when player starts ----
;(function(){
  try {
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('AM.player.state', function(e){
        try {
          var st = e && e.detail && e.detail.state;
          if (st === 1) { // PLAYING
            if (typeof WD !== 'undefined' && WD.playTimer) {
              try { clearTimeout(WD.playTimer); } catch (err) {}
              WD.playTimer = null;
            }
          }
        } catch (err) {}
      });
    }
  } catch (err) {}
})();

/* ==== Фильтр текстовой простыни и «музыка-only» ==== */
;(function filterEnumerations(){
  try{
    const orig = window.addMsg;
    window.addMsg = function(kind, html){
      try {
        const text = String(html||'');
        if (kind === 'bot' && /Наш[ёе]л варианты:/i.test(text) && /▶\s*Играть/i.test(text)) return;
        if (/только музыкальн(?:ые|ых)\s+(?:трек|запрос)/i.test(text)) return;
      } catch {}
      return orig ? orig.apply(this, arguments) : undefined;
    };
  } catch {}
})();
