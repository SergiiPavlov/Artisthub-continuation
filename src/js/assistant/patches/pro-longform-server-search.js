/**
 * PRO Longform client (server-driven) – minimal invasive
 * Listens for assistant:pro.suggest / assistant:pro.play and uses backend /api/yt/search
 * to retrieve LONG videos (movies ≥ 60m, audiobooks ≥ 30m). If none found, offers a
 * short candidate and a YouTube search link via assistant:pro.shortCandidate event.
 *
 * Place AFTER your core assistant scripts.
 */
(function proLongformServerSearch(){
  const w = window;
  const d = document;

  // Resolve API base from window or default
  const API_BASE = (w.API_BASE || (w.env && w.env.API_BASE) || '').replace(/\/+$/,'') || '';
  if (!API_BASE) { console.warn('[longform] No API_BASE detected'); }

  function buildQuery(title, type){
    title = String(title || '').trim();
    const suffix = type === 'audiobook' ? 'аудиокнига' : 'фильм';
    if (!title) return suffix; // allow mood-based suggest
    // avoid duplicating keywords if user already added them
    if (new RegExp(`\\b${suffix}\\b`, 'i').test(title)) return title;
    return `${title} ${suffix}`.trim();
  }
  function minSeconds(type){
    return type === 'audiobook' ? 1800 : 3600;
  }
  function ytSearchUrl(q){ return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`; }

  async function postJSON(url, body){
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        credentials: 'include',
      });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }

  function mapItems(items){
    return (items || []).map(x => ({
      id: x.id,
      title: x.title || '',
      channel: x.channelTitle || '',
      durationSec: Number(x.durationSec || 0),
      duration: formatDuration(Number(x.durationSec || 0)),
      thumbnail: x.thumbnail || '',
    }));
  }
  function formatDuration(sec){
    sec = Math.max(0, Math.floor(sec||0));
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
    return h>0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
    }

  async function handleSuggest(detail){
    const type = detail.type==='audiobook' ? 'audiobook' : 'movie';
    const q = buildQuery(detail.title || '', type);
    const minSec = minSeconds(type);

    // 1) try long only
    const r1 = await postJSON(`${API_BASE}/api/yt/search`, { q, max: detail.limit || 12, filters: { durationSecMin: minSec } });
    const items1 = mapItems((r1 && r1.items) || []);

    if (items1.length) {
      w.dispatchEvent(new CustomEvent('assistant:pro.suggest.result', { detail: { type, items: items1 } }));
      return;
    }

    // 2) fallback: nothing long → ask user, propose short and link
    const r2 = await postJSON(`${API_BASE}/api/yt/search`, { q, max: Math.max(5, (detail.limit||12)) });
    const ids = (r2 && r2.ids) || [];
    if (ids.length) {
      const short = { id: ids[0], title: detail.title || q, duration: '', durationSec: 0 };
      w.dispatchEvent(new CustomEvent('assistant:pro.shortCandidate', { detail: { video: short, type, title: (detail.title||'').trim() || q } }));
      return;
    }

    // 3) absolutely nothing → just suggest YouTube search
    const link = ytSearchUrl(q);
    const msg = `Не нашёл длинных видео по запросу. Посмотрите на YouTube: <a href="${link}" target="_blank">открыть YouTube</a>`;
    if (typeof w.addMsg === 'function') w.addMsg('bot', msg);
  }

  async function handlePlay(detail){
    const type = detail.type==='audiobook' ? 'audiobook' : 'movie';
    const q = buildQuery(detail.title || '', type);
    const minSec = minSeconds(type);

    // 1) try long (few)
    const r1 = await postJSON(`${API_BASE}/api/yt/search`, { q, max: 6, filters: { durationSecMin: minSec } });
    const items1 = mapItems((r1 && r1.items) || []);

    if (items1.length) {
      // prefer the first long result; also show list as backup
      const best = items1[0];
      // If app exposes a direct loader, use it; else show list
      if (typeof w.loadAndPlayYouTubeVideo === 'function') {
        w.loadAndPlayYouTubeVideo(best.id, best);
      }
      // Always dispatch suggestion list so user can switch
      w.dispatchEvent(new CustomEvent('assistant:pro.suggest.result', { detail: { type, items: items1 } }));
      return;
    }

    // 2) fallback to short
    const r2 = await postJSON(`${API_BASE}/api/yt/search`, { q, max: 6 });
    const ids = (r2 && r2.ids) || [];
    if (ids.length) {
      const short = { id: ids[0], title: detail.title || q, duration: '', durationSec: 0 };
      w.dispatchEvent(new CustomEvent('assistant:pro.shortCandidate', { detail: { video: short, type, title: (detail.title||'').trim() || q } }));
      return;
    }

    const link = ytSearchUrl(q);
    const msg = `Полной версии не нашёл. Посмотрите на YouTube: <a href="${link}" target="_blank">открыть YouTube</a>`;
    if (typeof w.addMsg === 'function') w.addMsg('bot', msg);
  }

  // Wire events
  window.addEventListener('assistant:pro.suggest', (e) => { const d = e.detail || {}; handleSuggest(d); }, false);
  window.addEventListener('assistant:pro.play', (e) => { const d = e.detail || {}; handlePlay(d); }, false);

  console.log('[longform] Server-driven longform search active');
})();
