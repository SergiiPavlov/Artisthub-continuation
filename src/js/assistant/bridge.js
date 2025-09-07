// Assistant bridge: переводит события чата в действия плеера и умеет
// найти YouTube-видео "по фразе" через oEmbed (без ключей). Кэш в localStorage.
(() => {
  // --- доступ к плееру ---
  let player = (window.AM && window.AM.player) || null;
  document.addEventListener('am:player-ready', (e) => { player = e.detail?.player || player; });

  // --- извлечь YT id из url/строки ---
  function getId(urlOrId) {
    if (!urlOrId) return '';
    if (/^[\w-]{11}$/.test(urlOrId)) return urlOrId;
    try {
      const u = new URL(urlOrId, location.href);
      if (/youtu\.be$/i.test(u.hostname)) return u.pathname.slice(1);
      const v = u.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/\/(?:embed|v|shorts)\/([^/?#]+)/i);
      if (m && m[1] && /^[\w-]{11}$/.test(m[1])) return m[1];
    } catch {}
    return '';
  }

  // --- пул id: из кеша (am.radio.pool) или быстроскан DOM ---
  function readPoolLS() {
    try { const a = JSON.parse(localStorage.getItem('am.radio.pool') || '[]'); return Array.isArray(a) ? a : []; }
    catch { return []; }
  }
  function collectFromDOM() {
    const set = new Set();
    document.querySelectorAll('a[href*="youtu"],[data-yt],[data-youtube],[data-ytid]').forEach(el => {
      const raw = el.getAttribute('href') || el.getAttribute('data-yt') || el.getAttribute('data-youtube') || el.getAttribute('data-ytid') || '';
      const id = getId(raw); if (id) set.add(id);
    });
    return [...set];
  }
  function getPool() {
    const ls = readPoolLS();
    if (ls.length) return ls;
    return collectFromDOM();
  }

  // --- oEmbed мета (title/author) с кэшем ---
  const metaCache = new Map();
  async function getMeta(id) {
    if (metaCache.has(id)) return metaCache.get(id);
    const key = `am.ytmeta.${id}`;
    try { const raw = localStorage.getItem(key); if (raw) { const obj = JSON.parse(raw); metaCache.set(id, obj); return obj; } } catch {}
    try {
      const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
      if (!r.ok) throw 0;
      const j = await r.json();
      const meta = { title: j.title || '', author: j.author_name || '' };
      localStorage.setItem(key, JSON.stringify(meta));
      metaCache.set(id, meta);
      return meta;
    } catch {
      const meta = { title: '', author: '' };
      metaCache.set(id, meta);
      return meta;
    }
  }

  // --- простая «фаззи» оценка совпадения ---
  function norm(s) {
    return (s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N} ]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function score(query, title, author) {
    const nq = norm(query), nt = norm(title), na = norm(author);
    let s = 0;
    if (nt.includes(nq)) s += 4;
    for (const w of nq.split(' ')) {
      if (!w) continue;
      if (nt.includes(w)) s += 1;
      if (na.includes(w)) s += 0.5;
    }
    return s;
  }

  async function findBestIdByQuery(query) {
    const ids = getPool();
    if (!ids.length) return null;
    const subset = ids.slice(0, 150); // ограничим, чтобы не дёргать слишком много
    let best = { id: null, s: -1 };
    await Promise.all(subset.map(async (id) => {
      const meta = await getMeta(id);
      const s = score(query, meta.title, meta.author);
      if (s > best.s) best = { id, s };
    }));
    return best.id;
  }

  async function playByQuery(query) {
    if (!player) return;
    const direct = getId(query);
    if (direct) {
      player.openQueue?.([direct], { shuffle: false, loop: true, startIndex: 0 });
      return;
    }
    const id = await findBestIdByQuery(query);
    if (id) {
      player.openQueue?.([id], { shuffle: false, loop: true, startIndex: 0 });
    }
  }

  // --- события от ассистента ---
  document.addEventListener('assistant:play', (e) => {
    const { id, query } = e.detail || {};
    if (id && player) player.openQueue?.([id], { shuffle: false, loop: true, startIndex: 0 });
    else if (query) playByQuery(query);
  });
  document.addEventListener('assistant:play-query', (e) => {
    const { query } = e.detail || {};
    if (query) playByQuery(query);
  });

  // базовые кнопки/режимы
  document.addEventListener('assistant:player-play',  () => player?.play?.());
  document.addEventListener('assistant:player-pause', () => player?.pause?.());
  document.addEventListener('assistant:player-next',  () => player?.next?.());
  document.addEventListener('assistant:player-prev',  () => player?.prev?.());
  document.addEventListener('assistant:view', (e) => {
    const mode = e.detail?.mode;
    document.documentElement.classList.toggle('list-view', mode === 'list');
  });
  document.addEventListener('assistant:recommend', () => { /* твои фильтры уже обрабатываются в artists/index */ });
})();
