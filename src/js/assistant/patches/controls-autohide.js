// Player-only auto-hide (scoped to .am-player).
// Does not touch assistant chat controls.

(() => {
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const DEFAULTS = {
    inactivityMs: isTouch ? 1500 : 2500,
    // strictly the player dock
    rootSelector: '.am-player',
    // only the player's control bar
    controlsSelector: '.am-player__bar'
  };

  function qIn(root, selList){
    const sels = String(selList).split(',');
    for (const sel of sels){
      const el = root.querySelector(sel.trim());
      if (el) return el;
    }
    return null;
  }

  function install(opts = {}) {
    const root = opts.root || document.querySelector(opts.rootSelector || DEFAULTS.rootSelector);
    if (!root) {
      // No player dock in DOM — do nothing.
      return { show(){}, hide(){}, lock(){}, uninstall(){} };
    }
    const controls = opts.controls || qIn(root, opts.controlsSelector || DEFAULTS.controlsSelector);
    if (!controls) {
      console.warn('[autohide] not installed: controls not found inside player root', { root });
      return { show(){}, hide(){}, lock(){}, uninstall(){} };
    }

    let hidden = false, locked = false, t = null;
    const ms = Number(opts.inactivityMs ?? DEFAULTS.inactivityMs);

    function show(){
      hidden = false;
      if (t) { clearTimeout(t); t = null; }
      controls.style.opacity = '';
      controls.style.transform = '';
      controls.style.pointerEvents = '';
      root.classList.remove('is-controls-hidden');
    }
    function hide(){
      if (locked) return;
      hidden = true;
      // Inline styles to override any external CSS
      controls.style.opacity = '0';
      controls.style.transform = 'translateY(8px)';
      controls.style.pointerEvents = 'none';
      root.classList.add('is-controls-hidden');
    }
    function schedule(){
      if (locked) return;
      if (t) clearTimeout(t);
      t = setTimeout(hide, ms);
    }
    function onAct(e){
      if (e?.type === 'keydown'){
        const k = (e.key || '').toLowerCase();
        if (['shift','alt','meta','control','tab'].includes(k)) return;
      }
      show(); schedule();
    }

    const passive = { passive: true };
    ['pointermove','pointerdown','touchstart','wheel'].forEach(ev => root.addEventListener(ev, onAct, passive));
    controls.addEventListener('pointerdown', onAct, passive);
    controls.addEventListener('pointerover', onAct, passive);
    root.addEventListener('keydown', onAct);

    // First hide after a short delay to avoid flicker
    setTimeout(schedule, isTouch ? 1200 : 1600);

    const api = {
      show, hide,
      lock(v=true){ locked = !!v; if (locked) show(); else schedule(); },
      uninstall(){
        ['pointermove','pointerdown','touchstart','wheel','keydown'].forEach(ev => root.removeEventListener(ev, onAct));
        controls.removeEventListener('pointerdown', onAct);
        controls.removeEventListener('pointerover', onAct);
        if (t) clearTimeout(t);
        show();
      },
      _dbg(){ return { root, controls, hidden, locked, inactivityMs: ms }; }
    };
    window.AM_AutoHide = api;
    window.__autohide_debug = () => { const d = api._dbg(); console.log('[autohide]', d); return d; };
    console.log('[autohide] installed (player-only)', { root, controls, ms });
    return api;
  }

  // Auto-install only if the player exists in DOM
  document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector(DEFAULTS.rootSelector)) install();
  });
  window.installAutoHide = install;
})();
