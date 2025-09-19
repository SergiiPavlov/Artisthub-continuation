// server/patches/yt-longsearch.mjs
// Adds smart LONG search on the same /api/yt/search route when a duration filter is passed.
// If filters aren't present, falls through to the next handler (your original short-ids search).

const YT_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const YT_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';

function iso8601ToSeconds(iso = '') {
  // PT#H#M#S
  if (!iso || typeof iso !== 'string') return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h = parseInt(m[1] || '0', 10);
  const mm = parseInt(m[2] || '0', 10);
  const s = parseInt(m[3] || '0', 10);
  return h * 3600 + mm * 60 + s;
}

function pickThumb(snippet) {
  const t = (snippet && snippet.thumbnails) || {};
  return (t.maxres && t.maxres.url)
      || (t.standard && t.standard.url)
      || (t.high && t.high.url)
      || (t.medium && t.medium.url)
      || (t.default && t.default.url)
      || '';
}

async function fetchJSON(url) {
  const r = await fetch(url).catch(() => null);
  if (!r || !r.ok) return null;
  try { return await r.json(); } catch { return null; }
}

export default function registerLongSearch(app, { YT_API_KEY } = {}) {
  if (!app) return;
  app.post('/api/yt/search', async (req, res, next) => {
    try {
      const hasFilters = req?.body && req.body.filters && typeof req.body.filters.durationSecMin === 'number';
      if (!hasFilters) return next(); // let the original /api/yt/search handle it

      const q = String(req.body?.q || '').trim();
      const max = Math.max(1, Math.min(50, Number(req.body?.max || 12)));
      const minSec = Math.max(1, Number(req.body?.filters?.durationSecMin || 3600));
      const exclude = Array.isArray(req.body?.exclude)
        ? req.body.exclude.filter(id => /^[A-Za-z0-9_-]{11}$/.test(id))
        : [];

      if (!q) return res.status(400).json({ items: [], error: 'no_query' });
      if (!YT_API_KEY) return res.status(400).json({ items: [], error: 'no_yt_key' });

      // 1) initial search → get candidate IDs
      const u = new URL(YT_SEARCH_URL);
      u.searchParams.set('part', 'id');
      u.searchParams.set('type', 'video');
      u.searchParams.set('q', q);
      u.searchParams.set('maxResults', String(Math.min(50, Math.max(10, max))));
      u.searchParams.set('order', 'relevance');
      u.searchParams.set('videoEmbeddable', 'true');
      u.searchParams.set('key', YT_API_KEY);

      const j = await fetchJSON(String(u));
      const ids = (j?.items || [])
        .map(x => x?.id?.videoId)
        .filter(id => id && /^[A-Za-z0-9_-]{11}$/.test(id) && !exclude.includes(id));

      if (!ids || !ids.length) {
        return res.json({ items: [], q, took: 0, cached: false, excluded: exclude.length });
      }

      // 2) videos details (durations, titles, embeddable)
      const v = new URL(YT_VIDEOS_URL);
      v.searchParams.set('part', 'contentDetails,snippet,status');
      v.searchParams.set('id', ids.slice(0, 50).join(','));
      v.searchParams.set('key', YT_API_KEY);
      const jv = await fetchJSON(String(v));
      const raw = Array.isArray(jv?.items) ? jv.items : [];

      // 3) filter by length & embeddable
      const longItems = raw.map(r => {
        const id = r?.id;
        const durIso = r?.contentDetails?.duration || '';
        const sec = iso8601ToSeconds(durIso);
        const emb = r?.status?.embeddable !== false;
        return {
          id,
          title: r?.snippet?.title || '',
          channelTitle: r?.snippet?.channelTitle || '',
          durationSec: sec,
          thumbnail: pickThumb(r?.snippet || {}),
          embeddable: !!emb
        };
      }).filter(x => x.id && x.embeddable && x.durationSec >= minSec);

      // 4) sort: longest first ≈ better chance it's a full movie/audiobook, then by relevance order fallback
      longItems.sort((a, b) => b.durationSec - a.durationSec);

      const items = longItems.slice(0, max).map(x => ({
        id: x.id,
        title: x.title,
        channelTitle: x.channelTitle,
        durationSec: x.durationSec,
        thumbnail: x.thumbnail
      }));

      return res.json({ items, q, took: 0, cached: false, excluded: exclude.length });
    } catch (e) {
      console.warn('[yt-longsearch] error', e?.message || e);
      return res.status(500).json({ items: [], error: 'server_error' });
    }
  });

  console.log('[yt-longsearch] route patched: POST /api/yt/search (with filters.durationSecMin)');
}
