// Lightweight backend warmup with banner + retry
// Usage: warmupBackend(API_BASE, { maxTries: 6, banner: true })

export async function warmupBackend(apiBase, opts = {}) {
  const base = String(apiBase || '').replace(/\/+$/, '');
  const maxTries = Number(opts.maxTries ?? 6);
  const withBanner = opts.banner !== false;

  if (!base) return false;

  if (withBanner) showWarmupBanner();
  try {
    let delay = 1000;
    for (let i = 1; i <= maxTries; i++) {
      const ok = await ping(`${base}/api/health`, 8000);
      if (ok) return true;
      await sleep(delay);
      delay = Math.min(delay * 2, 8000);
    }
    return false;
  } finally {
    if (withBanner) hideWarmupBanner();
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function ping(url, timeoutMs = 8000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
}

// ── Minimal banner (safe to include multiple times)
const BANNER_ID = 'warmup-banner';
function ensureStyle() {
  if (document.getElementById(`${BANNER_ID}-style`)) return;
  const st = document.createElement('style');
  st.id = `${BANNER_ID}-style`;
  st.textContent = `
    #${BANNER_ID}{
      position: fixed; top: 12px; right: 12px; z-index: 9999;
      background: rgba(0,0,0,.75); color:#fff; font: 600 13px/1.4 system-ui,Roboto,Arial;
      padding: 10px 12px; border-radius: 10px; box-shadow: 0 6px 20px rgba(0,0,0,.25);
      opacity: 0; transform: translateY(-6px); transition: all .25s ease;
    }
    #${BANNER_ID}.on{ opacity:1; transform: translateY(0); }
  `;
  document.head.appendChild(st);
}
function showWarmupBanner() {
  ensureStyle();
  let el = document.getElementById(BANNER_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = BANNER_ID;
    el.textContent = 'Разогреваю сервер… (до ~60 сек)';
    document.body.appendChild(el);
    // next tick → animate
    requestAnimationFrame(() => el.classList.add('on'));
  } else {
    el.classList.add('on');
  }
}
function hideWarmupBanner() {
  const el = document.getElementById(BANNER_ID);
  if (el) el.classList.remove('on'), setTimeout(() => el.remove(), 300);
}
