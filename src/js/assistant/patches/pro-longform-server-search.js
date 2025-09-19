/**
 * PRO Longform client v4: multi-query + rerank + dedupe (server-first)
 */
(function proLongformServerSearch_v4(){
  const w = window;
  const API_BASE = (w.API_BASE || (w.env && w.env.API_BASE) || '').replace(/\/+$/,'') || '';
  const YT_KEY  = (w.__YT_API_KEY__ || '').trim();

  function log(...a){ try{ console.log('[longform]', ...a);}catch{} }
  function addBot(html){ try{ w.addMsg && w.addMsg('bot', html); }catch{} }

  function minSeconds(type){ return type === 'audiobook' ? 1800 : 3600; }
  function ytSearchUrl(q){ return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`; }

  function buildVariants(title, type){
    const t = String(title||'').trim();
    const isBook = (type==='audiobook');
    const base = t || (isBook ? 'аудиокнига' : 'фильм');
    const v = [];
    if (isBook) {
      v.push(`${base}`);
      v.push(`${base} аудиокнига`);
      v.push(`${base} аудиокнига полностью`);
      v.push(`${base} полная аудиокнига`);
      v.push(`${base} audiobook full`);
    } else {
      v.push(`${base}`);
      v.push(`${base} фильм`);
      v.push(`${base} полный фильм`);
      v.push(`${base} фильм полностью`);
      v.push(`${base} full movie`);
      v.push(`${base} hd`);
    }
    // dedupe simple
    const seen = new Set();
    return v.map(s=>s.trim()).filter(s=>{ const k=s.toLowerCase(); if(seen.has(k)) return false; seen.add(k); return true; });
  }

  async function postJSON(url, body){
    try {
      const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body||{}), credentials:'include' });
      if (!r.ok) return null;
      return await r.json();
    } catch(e){ return null; }
  }

  function iso8601ToSec(iso){
    if (!iso) return 0;
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    const h = parseInt(m[1]||'0',10), mm = parseInt(m[2]||'0',10), s = parseInt(m[3]||'0',10);
    return h*3600+mm*60+s;
  }
  function formatDuration(sec){
    sec = Math.max(0, Math.floor(sec||0));
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
    return h>0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
  }

  function mapServerItems(r){
    const list = (r && (r.items || r.list)) || [];
    return list.map(x => ({
      id: x.id,
      title: x.title || '',
      channel: x.channelTitle || x.channel || '',
      durationSec: Number(x.durationSec || x.duration || 0),
      duration: formatDuration(Number(x.durationSec || x.duration || 0)),
      thumbnail: x.thumbnail || ''
    }));
  }

  function norm(s){ return String(s||'').toLowerCase().replace(/[ё]/g,'е').replace(/[^a-zа-я0-9\s]+/g,' ').replace(/\s+/g,' ').trim(); }
  function tokens(s){ return norm(s).split(' ').filter(Boolean); }
  function jaccard(a, b){ const A=new Set(a),B=new Set(b); let inter=0; for(const x of A) if(B.has(x)) inter++; const u=A.size+B.size-inter; return u?inter/u:0; }
  function phraseHit(q, t){
    q = norm(q); t = norm(t);
    if (!q || !t) return 0;
    if (t.includes(q)) return 1.0;
    const drop=['фильм','аудиокнига','полный','полная','полностью','hd','full','movie','audiobook','сериал'];
    const filtered = tokens(q).filter(x => !drop.includes(x)).join(' ');
    if (filtered && t.includes(filtered)) return 0.85;
    return 0;
  }
  function scoreTitle(q, title){
    const ph = phraseHit(q, title);
    const jac = jaccard(tokens(q), tokens(title));
    let boost = 0;
    if (/\bфильм\b/.test(norm(q)) && /\bфильм\b/.test(norm(title))) boost += 0.1;
    if (/аудиокнига/.test(norm(q)) && /аудиокнига/.test(norm(title))) boost += 0.1;
    return ph*0.7 + jac*0.3 + boost;
  }
  function rerank(items, q){ return (items||[]).slice().sort((a,b)=> (scoreTitle(q,b.title) - scoreTitle(q,a.title))); }
  function dedupeItems(items){
    const out=[], seen=new Set();
    for(const x of items||[]){
      const key = (x.id||'')+'|'+norm(x.title);
      if(seen.has(key)) continue;
      seen.add(key); out.push(x);
    }
    return out;
  }

  async function searchLongVariants(type, title, limit){
    const minSec = minSeconds(type);
    const variants = buildVariants(title, type).slice(0, 5); // берём первые 5 чтобы не спамить
    log('variants', variants);
    let all = [];
    for (const q of variants) {
      // server long
      if (API_BASE) {
        const r = await postJSON(`${API_BASE}/api/yt/search`, { q, max: limit || 10, filters: { durationSecMin: minSec } });
        const arr = mapServerItems(r);
        if (arr && arr.length) all = all.concat(arr);
      }
      // краткая пауза чтобы не DDOS
      try { await new Promise(rs=>setTimeout(rs, 120)); } catch {}
    }
    all = dedupeItems(all);
    if (all.length) return rerank(all, title || variants[0]);
    // client fallback long (по базовой фразе)
    if (YT_KEY) {
      const q = buildVariants(title, type)[0];
      const c = await ytClientSearchLong(q);
      return rerank(c.items||[], title||q);
    }
    return [];
  }

  async function ytClientSearchLong(q){
    if (!YT_KEY) return { items: [] };
    try {
      const sUrl = `https://www.googleapis.com/youtube/v3/search?key=${YT_KEY}&part=snippet&type=video&maxResults=10&q=${encodeURIComponent(q)}&videoDuration=long`;
      const s = await fetch(sUrl); if (!s.ok) throw new Error('search bad'); const sJ = await s.json();
      const ids = (sJ.items || []).map(it => it.id && it.id.videoId).filter(Boolean);
      if (!ids.length) return { items: [] };
      const vUrl = `https://www.googleapis.com/youtube/v3/videos?key=${YT_KEY}&part=contentDetails,snippet&id=${ids.join(',')}`;
      const v = await fetch(vUrl); if (!v.ok) throw new Error('videos bad'); const vJ = await v.json();
      const items = (vJ.items||[]).map(x => {
        const id = x.id;
        const dur = (x.contentDetails && x.contentDetails.duration) || '';
        const sec = iso8601ToSec(dur);
        const sn  = x.snippet || {};
        const th  = (sn.thumbnails && (sn.thumbnails.medium || sn.thumbnails.default || sn.thumbnails.high)) || {};
        return { id, title: sn.title||'', channel: sn.channelTitle||'', durationSec: sec, duration: formatDuration(sec), thumbnail: th.url||'' };
      });
      return { items };
    } catch(e){
      log('client fallback error', e);
      return { items: [] };
    }
  }

  async function suggest(detail){
    const type = detail.type==='audiobook' ? 'audiobook' : 'movie';
    const title = detail.title || '';
    log('suggest start v4', { type, title, API_BASE: !!API_BASE });

    const items = await searchLongVariants(type, title, detail.limit || 12);
    log('suggest long items', items.length);
    if (items.length) {
      w.dispatchEvent(new CustomEvent('assistant:pro.suggest.result', { detail: { type, items } }));
      return;
    }

    // short + link
    const variants = buildVariants(title, type);
    let shortId='';
    if (API_BASE) {
      const r2 = await postJSON(`${API_BASE}/api/yt/search`, { q: variants[0], max: Math.max(5, (detail.limit||12)) });
      const ids = (r2 && (r2.ids || r2.items && r2.items.map(x=>x.id))) || [];
      shortId = ids && ids[0];
      log('server short candidate', shortId);
    }
    if (shortId) {
      const short = { id: shortId, title: title || variants[0], duration: '', durationSec: 0 };
      w.dispatchEvent(new CustomEvent('assistant:pro.shortCandidate', { detail: { video: short, type, title: title || variants[0] } }));
    }
    const link = ytSearchUrl(variants[0]);
    addBot(`Полную версию не нашёл. Посмотрите на YouTube: <a href="${link}" target="_blank">открыть YouTube</a>`);
  }

  async function play(detail){
    const type = detail.type==='audiobook' ? 'audiobook' : 'movie';
    const title = detail.title || '';
    log('play start v4', { type, title, API_BASE: !!API_BASE });

    const items = await searchLongVariants(type, title, 8);
    log('play long items', items.length);
    if (items.length) {
      const best = items[0];
      if (typeof w.loadAndPlayYouTubeVideo === 'function') {
        w.loadAndPlayYouTubeVideo(best.id, best);
      }
      w.dispatchEvent(new CustomEvent('assistant:pro.suggest.result', { detail: { type, items } }));
      return;
    }

    // short + link
    const variants = buildVariants(title, type);
    let shortId='';
    if (API_BASE) {
      const r2 = await postJSON(`${API_BASE}/api/yt/search`, { q: variants[0], max: 6 });
      const ids = (r2 && (r2.ids || r2.items && r2.items.map(x=>x.id))) || [];
      shortId = ids && ids[0];
      log('server short candidate', shortId);
    }
    if (shortId) {
      const short = { id: shortId, title: title || variants[0], duration: '', durationSec: 0 };
      w.dispatchEvent(new CustomEvent('assistant:pro.shortCandidate', { detail: { video: short, type, title: title || variants[0] } }));
    }
    const link = ytSearchUrl(variants[0]);
    addBot(`Полной версии не нашёл. Посмотрите на YouTube: <a href="${link}" target="_blank">открыть YouTube</a>`);
  }

  window.addEventListener('assistant:pro.suggest', e => suggest(e.detail||{}), false);
  window.addEventListener('assistant:pro.play',    e => play(e.detail||{}),    false);

  log('v4 active (multi-query, rerank)', { API_BASE: !!API_BASE, YT_KEY: !!YT_KEY });
})();
