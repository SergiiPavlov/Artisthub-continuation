/**
 * PRO Longform client (server-driven) — strict long-only autoplay
 * Слушает assistant:pro.suggest / assistant:pro.play и ходит на бекенд /api/yt/search.
 * Автозапуск — только если найден "длинный" ролик (movie ≥ 60m, audiobook ≥ 30m).
 * Если длинных нет — карточки без автозапуска + ссылка на YouTube.
 *
 * Подключать ПОСЛЕ базовых ассистент-скриптов.
 */
(function proLongformServerSearch(){
  var w = window;

  // API base
  var API_BASE = (w.API_BASE || (w.env && w.env.API_BASE) || '').replace(/\/+$/,'') || '';
  if (!API_BASE) { try { console.warn('[longform] No API_BASE detected'); } catch(_){} }

  // -------- helpers --------
  function buildQuery(title, type){
    title = String(title || '').trim();
    var suffix = type === 'audiobook' ? 'аудиокнига' : 'фильм';
    if (!title) return suffix; // поддержка mood-запросов вида "подбери под настроение"
    if (new RegExp('\\b'+suffix+'\\b','i').test(title)) return title;
    return (title + ' ' + suffix).trim();
  }
  function minSeconds(type){ return type === 'audiobook' ? 1800 : 3600; } // 30m/60m

  function ytSearchUrl(q){ return 'https://www.youtube.com/results?search_query='+encodeURIComponent(q); }

  function postJSON(url, body){
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      credentials: 'include'
    }).then(function(r){ return r.ok ? r.json() : null; })
      .catch(function(){ return null; });
  }

  function parseISO8601Duration(iso){
    // PT#H#M#S -> seconds
    if (!iso || typeof iso !== 'string') return 0;
    var m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    var h = parseInt(m[1]||0,10), mm = parseInt(m[2]||0,10), s = parseInt(m[3]||0,10);
    return h*3600 + mm*60 + s;
  }
  function formatDuration(sec){
    sec = Math.max(0, Math.floor(+sec||0));
    var h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
    return h>0 ? (h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0'))
               : (m+':'+String(s).padStart(2,'0'));
  }

  function normalizeItem(raw){
    raw = raw || {};
    var id = raw.id || (raw.videoId) || (raw.snippet && raw.snippet.resourceId && raw.snippet.resourceId.videoId) || (raw.snippet && raw.snippet.videoId) || '';
    var title = raw.title || (raw.snippet && raw.snippet.title) || '';
    var channel = raw.channel || raw.channelTitle || (raw.snippet && raw.snippet.channelTitle) || '';
    var durSec = Number(raw.durationSec || raw.duration_seconds || 0);
    if (!durSec) {
      var iso = raw.duration || (raw.contentDetails && raw.contentDetails.duration) || '';
      if (iso) durSec = parseISO8601Duration(iso);
    }
    return {
      id: id,
      title: title,
      channel: channel,
      durationSec: durSec,
      duration: formatDuration(durSec)
    };
  }
  function mapItems(items){
    if (!Array.isArray(items)) return [];
    var out = [];
    for (var i=0;i<items.length;i++){
      var n = normalizeItem(items[i]);
      if (n.id) out.push(n);
    }
    return out;
  }
  function itemsFromIds(ids){
    if (!Array.isArray(ids)) return [];
    var out = [];
    for (var i=0;i<ids.length;i++){
      var id = String(ids[i]||'').trim();
      if (id) out.push({ id: id, title: '', channel: '', durationSec: 0, duration: '' });
    }
    return out;
  }
  function isLong(item, minSec){
    var sec = Number(item && item.durationSec || 0);
    return sec >= (Number(minSec)||0);
  }

  function dispatchSuggest(type, items, q){
    try {
      w.dispatchEvent(new CustomEvent('assistant:pro.suggest.result', {
        detail: { type: type, items: items||[], q: q||'' }
      }));
    } catch(_) {}
  }
  function addMsg(html){
    try { if (typeof w.addMsg === 'function') w.addMsg('bot', html); } catch(_){}
  }

  // -------- SUGGEST flow --------
  async function handleSuggest(detail){
    var type = detail && detail.type === 'audiobook' ? 'audiobook' : 'movie';
    var q = buildQuery((detail && detail.title) || '', type);
    var minSec = minSeconds(type);
    var limit = (detail && detail.limit) || 12;

    // 1) длинные
    var r1 = await postJSON(API_BASE + '/api/yt/search', { q: q, max: limit, filters: { durationSecMin: minSec } });
    var items1 = mapItems(r1 && r1.items);

    if (items1.length) { dispatchSuggest(type, items1, q); return; }

    // 2) общий поиск — показать хоть что-то (без автозапуска)
    var r2 = await postJSON(API_BASE + '/api/yt/search', { q: q, max: Math.max(5, limit) });
    var items2 = mapItems(r2 && r2.items);
    if (!items2.length) items2 = itemsFromIds(r2 && r2.ids);

    if (items2.length) { dispatchSuggest(type, items2, q); }
    else {
      addMsg('Полноценные результаты не нашёл. <a href="'+ytSearchUrl(q)+'" target="_blank" rel="noopener">Открыть YouTube</a>?');
    }
  }

  // -------- PLAY flow (строго long-only для автозапуска) --------
  async function handlePlay(detail){
    var type = detail && detail.type === 'audiobook' ? 'audiobook' : 'movie';
    var q = buildQuery((detail && detail.title) || '', type);
    var minSec = minSeconds(type);
    var limit = (detail && detail.limit) || 12;

    // 1) ищем длинные и сразу стартуем первый длинный
    var r1 = await postJSON(API_BASE + '/api/yt/search', { q: q, max: limit, filters: { durationSecMin: minSec } });
    var list1 = mapItems(r1 && r1.items);
    var longs1 = list1.filter(function(it){ return isLong(it, minSec); });

    if (longs1.length) {
      var best1 = longs1[0];
      if (best1 && best1.id) {
        if (typeof w.loadAndPlayYouTubeVideo === 'function') {
          try { await w.loadAndPlayYouTubeVideo(best1.id, best1); return; } catch(_){}
        }
        // если глобального лоадера нет — покажем карточки длинных
        dispatchSuggest(type, longs1, q);
        return;
      }
    }

    // 2) расширенный поиск. Если появятся длинные — можно автозапустить (long-only)
    var r2 = await postJSON(API_BASE + '/api/yt/search', { q: q, max: Math.max(6, limit) });
    var list2 = mapItems(r2 && r2.items);
    var longs2 = list2.filter(function(it){ return isLong(it, minSec); });

    if (longs2.length) {
      var best2 = longs2[0];
      if (best2 && best2.id) {
        if (typeof w.loadAndPlayYouTubeVideo === 'function') {
          try { await w.loadAndPlayYouTubeVideo(best2.id, best2); return; } catch(_){}
        }
        dispatchSuggest(type, longs2, q);
        return;
      }
    }

    // 3) длинных нет — карточки без автозапуска (что нашлось) + ссылка на YouTube
    var any = list1.length ? list1 : (list2.length ? list2 : itemsFromIds(r2 && r2.ids));
    if (any.length) { dispatchSuggest(type, any, q); }
    addMsg('Полной версии не нашёл. <a href="'+ytSearchUrl(q)+'" target="_blank" rel="noopener">Открыть YouTube</a>?');
  }

  // wire
  try { w.addEventListener('assistant:pro.suggest', function(e){ handleSuggest((e && e.detail) || {}); }, false); } catch(_){}
  try { w.addEventListener('assistant:pro.play',    function(e){ handlePlay((e && e.detail) || {}); }, false); } catch(_){}

  try { console.log('[longform] server-driven longform (strict long-only autoplay) active'); } catch(_){}
})();
