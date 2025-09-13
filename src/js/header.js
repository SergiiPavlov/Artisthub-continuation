// src/js/header.js

const refs = {
  openBtn: document.querySelector('[data-menu-open]'),
  closeBtn: document.querySelector('[data-menu-close]'),
  menu: document.querySelector('[data-menu]'),
  links: document.querySelectorAll('[data-menu-link]'),
  logos: document.querySelectorAll('.header-logo'),
  header: document.querySelector('.header'),
};

const html = document.documentElement;

// --- helper: мягкая «блокировка» ассистента, если нет CSS .menu-open ---
function blockAssistant(on) {
  const root = document.getElementById('assistant-root') || document.querySelector('.assistant');
  if (!root) return;
  try {
    if (on) {
      root.style.pointerEvents = 'none';
      const panel = root.querySelector('.assistant__panel');
      if (panel) panel.style.opacity = '.25';
    } else {
      root.style.pointerEvents = '';
      const panel = root.querySelector('.assistant__panel');
      if (panel) panel.style.opacity = '';
    }
  } catch {}
}

function openMenu() {
  if (!refs.menu) return;
  refs.menu.hidden = false;
  refs.menu.classList.add('show');
  document.body.style.overflow = 'hidden';
  refs.openBtn?.setAttribute('aria-expanded', 'true');

  // Поднимаем меню над ассистентом и отключаем клики по чату
  html.classList.add('menu-open');
  blockAssistant(true);
}

function closeMenu() {
  return new Promise(resolve => {
    if (!refs.menu) {
      html.classList.remove('menu-open');
      blockAssistant(false);
      return resolve();
    }
    refs.menu.classList.remove('show');
    setTimeout(() => {
      refs.menu.hidden = true;
      document.body.style.overflow = '';
      refs.openBtn?.setAttribute('aria-expanded', 'false');

      html.classList.remove('menu-open');
      blockAssistant(false);

      resolve();
    }, 400);
  });
}

/* ---------- header offset helpers ---------- */
function getHeaderOffset() {
  return (refs.header?.offsetHeight || 80) + 8;
}
function applyScrollPadding() {
  document.documentElement.style.scrollPaddingTop = `${getHeaderOffset()}px`;
}
applyScrollPadding();
window.addEventListener('resize', () => requestAnimationFrame(applyScrollPadding));

/* ---------- custom smooth scroll (no teleports) ---------- */
function smoothScroll(targetHref, duration = 500) {
  const raw = (targetHref || '').replace('#', '');
  const el = document.getElementById(raw) || document.getElementById(`${raw}-section`);
  if (!el) return;

  const headerOffset = getHeaderOffset();
  const targetY = el.getBoundingClientRect().top + window.pageYOffset - headerOffset;

  const startY = window.pageYOffset;
  const diff = targetY - startY;
  let t0 = null;

  const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  function step(ts) {
    if (t0 === null) t0 = ts;
    const p = Math.min(1, (ts - t0) / duration);
    window.scrollTo(0, startY + diff * ease(p));
    if (p < 1) {
      requestAnimationFrame(step);
    } else {
      // переносим фокус на секцию, чтобы ссылка потеряла :focus
      el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
      setTimeout(() => el.removeAttribute('tabindex'), 0);
    }
  }
  requestAnimationFrame(step);
}

/* ---------- menu events ---------- */
refs.openBtn?.addEventListener('click', openMenu);
refs.closeBtn?.addEventListener('click', closeMenu);

refs.logos.forEach(logo => {
  logo.addEventListener('click', e => {
    if (logo.closest('.mobile-menu')) {
      e.preventDefault();
      closeMenu();
      setTimeout(() => {
        window.location.href = logo.getAttribute('href');
      }, 400);
    }
  });
});

refs.menu?.addEventListener('click', e => {
  // клик по подложке — закрываем
  if (e.target === refs.menu) {
    closeMenu();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && refs.menu?.classList.contains('show')) {
    closeMenu();
  }
});

/* ---------- scroll-spy with IO ---------- */
const navLinks = document.querySelectorAll('.header-nav-link, .mobile-menu-nav-link');

const linkTargets = new Map();
navLinks.forEach(a => {
  const href = (a.getAttribute('href') || '').trim();
  if (!href.startsWith('#')) return;
  const rawId = href.slice(1);
  const el = document.getElementById(rawId) || document.getElementById(`${rawId}-section`);
  if (!el) return;
  if (!linkTargets.has(el)) linkTargets.set(el, []);
  linkTargets.get(el).push(a);
});

let currentEl = null;
function setActiveByEl(el) {
  if (!el || currentEl === el) return;
  navLinks.forEach(a => a.classList.remove('active'));
  (linkTargets.get(el) || []).forEach(a => a.classList.add('active'));
  currentEl = el;
}

let lockUntil = 0;
const LOCK_MS = 700;
const isLocked = () => Date.now() < lockUntil;

let io;
function initScrollSpy() {
  if (io) io.disconnect();

  const rootMargin = `-${getHeaderOffset()}px 0px -55% 0px`;
  const visibleRatio = new Map();

  io = new IntersectionObserver(
    entries => {
      entries.forEach(en => {
        visibleRatio.set(en.target, en.isIntersecting ? en.intersectionRatio : 0);
      });
      if (isLocked()) return;
      const best = [...visibleRatio.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] > 0) setActiveByEl(best[0]);
    },
    { root: null, rootMargin, threshold: [0, 0.25, 0.5, 0.75, 1] }
  );

  linkTargets.forEach((_, el) => io.observe(el));
}
initScrollSpy();
window.addEventListener('resize', () => requestAnimationFrame(initScrollSpy));

// ---------- HERO "Explore Artists" button smooth scroll ----------
const exploreBtn = document.getElementById('exploreBtn');

if (exploreBtn) {
  exploreBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    exploreBtn.blur();

    const href = exploreBtn.getAttribute('href') || '#artists-section';
    const raw  = href.replace('#', '');
    const el   = document.getElementById(raw) || document.getElementById(`${raw}-section`);
    if (!el) return;

    // если открыт мобильный бургер — прикрываем перед скроллом
    if (refs.menu?.classList.contains('show')) {
      await closeMenu();
    }

    // подсветим активный пункт в хедере (если такой есть)
    setActiveByEl(el);

    // слегка «заблокируем» scroll-spy, чтобы он не перебил активный пункт во время анимации
    lockUntil = Date.now() + LOCK_MS;

    // плавный скролл с учётом высоты хедера
    smoothScroll(href, 600);
  });
}

/* ---------- nav handlers ---------- */
// Desktop: не трогаем мобильные (у них есть data-menu-link)
navLinks.forEach(a => {
  a.addEventListener('click', (e) => {
    if (a.matches('[data-menu-link]')) return;
    const href = (a.getAttribute('href') || '').trim();
    if (!href.startsWith('#')) return;

    e.preventDefault();
    a.blur(); // снимаем :focus с кликнутой ссылки

    const raw = href.slice(1);
    const el = document.getElementById(raw) || document.getElementById(`${raw}-section`);
    if (!el) return;

    setActiveByEl(el);
    lockUntil = Date.now() + LOCK_MS;
    smoothScroll(href);
  });
});

// Mobile: ждём закрытие меню, снимаем фокус, потом скроллим
refs.links.forEach(link =>
  link.addEventListener('click', async e => {
    e.preventDefault();
    link.blur();
    const targetId = link.getAttribute('href');
    await closeMenu();
    smoothScroll(targetId);
  })
);

// Подстраховка: при загрузке проскроллим к hash с учётом шапки
window.addEventListener('load', () => {
  applyScrollPadding();
  if (location.hash) {
    setTimeout(() => smoothScroll(location.hash), 0);
  }
});

/* ---------- OPTIONAL: открытие инструкции ассистента из меню ----------
   Добавь в разметку ссылки класс .js-assistant-howto (и в моб. меню тоже),
   чтобы вызывать справку.
*/
document.querySelectorAll('.js-assistant-howto').forEach(el => {
  el.addEventListener('click', async (e) => {
    e.preventDefault();
    await closeMenu();
    // Попросим ассистента показать модалку-инструкцию (если подписан)
    window.dispatchEvent(new CustomEvent('assistant:howto'));
    // и раскроем панель, если была скрыта
    document.querySelector('.assistant__toggle')?.click();
  });
});
