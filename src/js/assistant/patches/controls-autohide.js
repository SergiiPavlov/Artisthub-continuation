// Автоскрытие контролов плеера БЕЗ внешнего CSS: инлайновые стили + отладка.
// Показывает при любом жесте (pointer/touch/wheel/keydown), скрывает через таймер.
// Экспортирует window.AM_AutoHide (show/hide/lock) и window.__autohide_debug().

(() => {
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const DEFAULTS = {
    inactivityMs: isTouch ? 1500 : 2500,
    rootSelector: '.assistant__player,[data-am-player],[data-player],#player',
    controlsSelector: '.assistant__controls,.player__controls,[data-controls]'
  };

  function q(sel) { try { return document.querySelector(sel); } catch { return null; } }
  function find(selList) {
    for (const sel of String(selList).split(',')) {
      const el = q(sel.trim());
      if (el) return el;
    }
    return null;
  }

  function install(opts = {}) {
    const root = opts.root || find(opts.rootSelector || DEFAULTS.rootSelector) || document.body;
    const controls =
      opts.controls ||
      find(opts.controlsSelector || DEFAULTS.controlsSelector) ||
      (root && root.querySelector('[class*="controls"], button')) ||
      null;

    if (!root || !controls) {
      console.warn('[autohide] not installed: root/controls not found', { root, controls });
      return { show(){}, hide(){}, lock(){} };
    }

    let hidden = false, locked = false, t = null, lastActivity = Date.now();
    const ms = Number(opts.inactivityMs ?? DEFAULTS.inactivityMs);

    const show = () => {
      hidden = false;
      if (t) { clearTimeout(t); t = null; }
      controls.style.opacity = '';
      controls.style.transform = '';
      controls.style.pointerEvents = '';
      root.classList.remove('is-controls-hidden');
    };

    const hide = () => {
      if (locked) return;
      hidden = true;
      // Инлайново, чтобы перебить любые внешние стили
      controls.style.opacity = '0';
      controls.style.transform = 'translateY(8px)';
      controls.style.pointerEvents = 'none';
      root.classList.add('is-controls-hidden');
    };

    const schedule = () => {
      if (locked) return;
      if (t) clearTimeout(t);
      t = setTimeout(hide, ms);
    };

    const onAct = (e) => {
      if (e?.type === 'keydown') {
        const k = (e.key || '').toLowerCase();
        if (['shift','alt','meta','control','tab'].includes(k)) return;
      }
      lastActivity = Date.now();
      show(); schedule();
    };

    const passive = { passive: true };
    ['pointermove','pointerdown','touchstart','wheel'].forEach(ev => root.addEventListener(ev, onAct, passive));
    root.addEventListener('keydown', onAct);
    controls.addEventListener('pointerdown', onAct, passive);
    controls.addEventListener('pointerover', onAct, passive);

    // Первичное скрытие чуть позже, чтобы не мигало при появлении
    setTimeout(schedule, isTouch ? 1200 : 1600);

    const api = {
      show, hide,
      lock(v = true) { locked = !!v; if (locked) show(); else schedule(); },
      uninstall() {
        ['pointermove','pointerdown','touchstart','wheel','keydown'].forEach(ev => root.removeEventListener(ev, onAct));
        controls.removeEventListener('pointerdown', onAct);
        controls.removeEventListener('pointerover', onAct);
        if (t) clearTimeout(t);
        show();
      },
      _dbg() { return { root, controls, hidden, locked, inactivityMs: ms, lastActivity }; }
    };

    window.AM_AutoHide = api;
    window.__autohide_debug = () => { const d = api._dbg(); console.log('[autohide]', d); return d; };
    console.log('[autohide] installed', { root, controls, ms });

    return api;
  }

  window.installAutoHide = install;
  document.addEventListener('DOMContentLoaded', () => install());
})();
