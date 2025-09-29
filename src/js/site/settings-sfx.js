// site-settings.sfx.popover.js — based on your working modal file, but:
// 1) Shows ONLY the short line: "Turn button/tap sounds on or off." + a toggle
// 2) Opens as a POPOVER directly under the "Settings" link (desktop & mobile)
// 3) Keeps your nav/link styles as-is; no extra class hacks
(function(){
  'use strict';

  const KEY = 'sfx'; // compatible with src/js/global-sfx.js

  function sfxEnabled(){
    try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
  }
  function setSfx(on){
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch {}
    try {
      if (window.SFX && typeof window.SFX[on ? 'enable' : 'disable'] === 'function') {
        window.SFX[on ? 'enable' : 'disable']();
      }
    } catch {}
    try {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: on ? 'on' : 'off' }));
    } catch {}
  }

  function ensureStyles(){
    if (document.getElementById('settings-sfx-style')) return;
    const st = document.createElement('style');
    st.id = 'settings-sfx-style';
    st.textContent = `
      /* Popover wrapper anchored under the clicked Settings link */
      .settings-pop{position:absolute; z-index:10000; display:none;}
      .settings-pop.open{display:block}

      /* Card */
      .settings-card{background:#0b0f14;border:1px solid #263142;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.5);min-width:300px;max-width:min(92vw,360px);color:#e8f1ff}
      .settings-body{padding:1rem;color:#cbd5e1;font-size:.95rem;line-height:1.35}

      /* Single row with text + toggle (reuse your switch styling) */
      .settings-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin:.25rem 0}
      .switch{appearance:none;width:44px;height:24px;border-radius:999px;background:#2b3a4f;position:relative;outline:0;cursor:pointer;border:1px solid #33475f;flex:0 0 auto}
      .switch:before{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#94a3b8;transition:transform .18s ease}
      .switch:checked{background:#2563eb}
      .switch:checked:before{transform:translateX(20px);background:#e8f1ff}

      /* Tiny arrow */
      .settings-pop:before{content:'';position:absolute;width:10px;height:10px;background:#0b0f14;border-left:1px solid #263142;border-top:1px solid #263142;transform:rotate(45deg);top:-6px;left:20px}

      @media (max-width: 360px){
        .settings-card{min-width:260px}
      }
    `;
    document.head.appendChild(st);
  }

  function buildPopover(){
    ensureStyles();
    const pop = document.createElement('div');
    pop.className = 'settings-pop';
    pop.innerHTML = `
      <div class="settings-card">
        <div class="settings-body">
          <div class="settings-row">
            <strong>Turn button/tap sounds on or off.</strong>
            <input type="checkbox" class="switch" id="settings-sfx-toggle">
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(pop);

    const toggle = pop.querySelector('#settings-sfx-toggle');
    toggle.checked = sfxEnabled();
    toggle.addEventListener('change', () => setSfx(toggle.checked));

    // outside click / Escape
    document.addEventListener('pointerdown', (e)=>{
      if (!pop.classList.contains('open')) return;
      if (pop.contains(e.target) || (currentTrigger && currentTrigger.contains(e.target))) return;
      closePopover(pop);
    }, true);
    document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') closePopover(pop); });

    return pop;
  }

  let popover = null;
  let currentTrigger = null;

  function positionPopover(trigger){
    if (!popover) return;
    const rect = trigger.getBoundingClientRect();
    const w = popover.offsetWidth || 320;
    const margin = 8;

    // left aligned under trigger, clamped to viewport
    let left = window.scrollX + rect.left;
    const maxLeft = window.scrollX + window.innerWidth - w - margin;
    left = Math.max(window.scrollX + margin, Math.min(left, maxLeft));

    const top = window.scrollY + rect.bottom + 8;

    popover.style.left = `${left}px`;
    popover.style.top  = `${top}px`;
  }

  function openPopover(trigger){
    if (!popover) popover = buildPopover();
    currentTrigger = trigger;

    // sync state before show
    const t = popover.querySelector('#settings-sfx-toggle');
    if (t) t.checked = sfxEnabled();

    popover.style.left = '-9999px';
    popover.style.top = '0px';
    popover.classList.add('open');
    requestAnimationFrame(()=> positionPopover(trigger));
  }

  function closePopover(pop){
    pop.classList.remove('open');
    currentTrigger = null;
  }

  // Use your injection logic as-is, but open POPOVER instead of fixed modal
  function injectNav(){
    // Desktop nav
    const deskUl = document.querySelector('.header-nav .header-nav-list');
    if (deskUl && !deskUl.querySelector('.js-site-settings')){
      const li = document.createElement('li');
      li.innerHTML = `<a href="#settings" class="header-nav-link js-site-settings" role="button" aria-haspopup="dialog">Settings</a>`;
      deskUl.appendChild(li);
    }
    // Mobile nav
    const mobUl = document.querySelector('.mobile-menu-nav .mobile-menu-nav-list');
    if (mobUl && !mobUl.querySelector('.js-site-settings')){
      const li = document.createElement('li');
      li.innerHTML = `<a href="#settings" class="mobile-menu-nav-link js-site-settings" data-menu-link role="button" aria-haspopup="dialog">Settings</a>`;
      mobUl.appendChild(li);
    }
    // Fallback (rare): show a small pill — still opens the same popover near the pill
    if (!document.querySelector('.js-site-settings')){
      const pill = document.createElement('button');
      pill.className = 'settings-pill';
      pill.textContent = 'Settings';
      document.body.appendChild(pill);
      pill.addEventListener('click', ()=> openPopover(pill));
    }

    // Wire all triggers
    document.querySelectorAll('.js-site-settings').forEach(a => {
      a.addEventListener('click', (e)=>{
        e.preventDefault();
        // If this is inside the mobile menu, close the menu first
        const menu = document.querySelector('[data-menu]');
        const wasMobile = menu?.classList.contains('show') && a.closest('.mobile-menu-nav');
        if (wasMobile){
          document.querySelector('[data-menu-close]')?.click();
          // Wait a frame for menu to close & layout to settle, then anchor to the desktop "Settings" if exists
          requestAnimationFrame(()=>{
            const desktopA = document.querySelector('.header-nav .header-nav-list .js-site-settings') || a;
            openPopover(desktopA);
          });
        } else {
          openPopover(a);
        }
      });
    });

    // Reposition on scroll/resize if open
    const onMove = () => {
      if (!popover || !popover.classList.contains('open') || !currentTrigger) return;
      positionPopover(currentTrigger);
    };
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
  }

  function boot(){
    injectNav();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
