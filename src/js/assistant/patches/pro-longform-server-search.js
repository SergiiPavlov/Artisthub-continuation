/**
 * PRO Longform client (server-driven) — long-first suggestions
 * Movies: never autoplay, only suggest cards (long >= 60m preferred).
 * Audiobooks: can autoplay if long >= 30m, otherwise suggest.
 */
(function proLongformServerSearch(){
  const w = window;

  // ✅ DEV-safe API base: fallback на 8787 при пустом API_BASE в локалке
  const fromEnv = (w.API_BASE || (w.env && w.env.API_BASE) || '').replace(/\/+$/,'');
  const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(location.host);
  const API_BASE = fromEnv || (isLocal ? 'http://localhost:8787' : '');
  const hasPlay = typeof w.loadAndPlayYouTubeVideo === 'function';

  function postJSON(url, body){
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      credentials: 'include'
    }).then(r => r.ok ? r.json() : null).catch(()=>null);
  }
  function parseISO8601(iso){
    if (!iso) return 0; const m = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0; const h=+m[1]||0, mm=+m[2]||0, s=+m[3]||0; return h*3600+mm*60+s;
  }
  function fmt(sec){
    sec = Math.max(0, Math.floor(+sec||0));
    const h = (sec/3600)|0, m = ((sec%3600)/60)|0, s = (sec%60)|0;
    return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
  }
  function norm(x){
    x = x||{};
    const id = x.id || x.videoId || (x.snippet && x.snippet.resourceId && x.snippet.resourceId.videoId) || (x.snippet && x.snippet.videoId) || '';
    const title = x.title || (x.snippet && x.snippet.title) || '';
    const channel = x.channel || x.channelTitle || (x.snippet && x.snippet.channelTitle) || '';
    let durationSec = Number(x.durationSec || x.duration_seconds || 0);
    if (!durationSec) { const iso = x.duration || (x.contentDetails && x.contentDetails.duration) || ''; durationSec = parseISO8601(iso); }
    const thumbnail = x.thumbnail || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '');
    return { id, title, channel, durationSec, duration: fmt(durationSec), thumbnail };
  }
  function map(list){ return Array.isArray(list) ? list.map(norm).filter(it=>!!it.id) : []; }
  function idsOnly(ids){ return Array.isArray(ids) ? ids.map(id => norm({id})) : []; }

  function buildQuery(title, type){
    title = String(title || '').trim();
    const suffix = type === 'audiobook' ? 'аудиокнига' : 'фильм';
    if (!title) return suffix;
    if (new RegExp('\\b'+suffix+'\\b','i').test(title)) return title;
    return (title + ' ' + suffix).trim();
  }
  function minSec(type){ return type === 'audiobook' ? 1800 : 3600; }

  function suggest(detail){
    const type = detail && detail.type === 'audiobook' ? 'audiobook' : 'movie';
    const q = buildQuery((detail && detail.title) || '', type);
    const limit = (detail && detail.limit) || 12;
    const min = minSec(type);

    postJSON(API_BASE + '/api/yt/search', { q, max: limit, filters: { durationSecMin: min } })
      .then(r => {
        let items = map(r && r.items);
        if (items.length) return items;
        return postJSON(API_BASE + '/api/yt/search', { q, max: Math.max(5, limit) })
          .then(r2 => {
            let alt = map(r2 && r2.items); if (alt.length) return alt;
            return idsOnly(r2 && r2.ids);
          });
      }).then(items => {
        w.dispatchEvent(new CustomEvent('assistant:pro.suggest.result', { detail: { type, q, items } }));
      });
  }

  function play(detail){
    const type = detail && detail.type === 'audiobook' ? 'audiobook' : 'movie';
    if (type === 'movie') return suggest(detail); // movies never autoplay
    const q = buildQuery((detail && detail.title) || '', type);
    const limit = (detail && detail.limit) || 12;
    const min = minSec(type);
    postJSON(API_BASE + '/api/yt/search', { q, max: limit, filters: { durationSecMin: min } })
      .then(r => {
        let items = map(r && r.items);
        let longs = items.filter(it => it.durationSec >= min);
        if (longs.length && hasPlay) return w.loadAndPlayYouTubeVideo(longs[0].id, longs[0]);
        // fallback to suggest
        w.dispatchEvent(new CustomEvent('assistant:pro.suggest.result', { detail: { type, q, items: items.length?items:idsOnly(r && r.ids) } }));
      });
  }

  try { w.addEventListener('assistant:pro.suggest', e => suggest((e && e.detail) || {}), false); }catch(_){}
  try { w.addEventListener('assistant:pro.play', e => play((e && e.detail) || {}), false); }catch(_){}
})();
