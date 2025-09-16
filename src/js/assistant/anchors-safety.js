// src/js/assistant/anchors-safety.js
// «Страховочный» скроллер: работает даже если основной header.js не успел инициализироваться.
(function () {
  const HEADER_SEL = '.header';
  const getHeaderOffset = () => {
    const h = document.querySelector(HEADER_SEL);
    const r = h ? Math.max(0, h.getBoundingClientRect().height) : 0;
    return r;
  };

  function closeOverlays() {
    document.body.classList.remove('menu-open', 'no-scroll');
    // Сброс фиксации body, если где-то выставили
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
  }

  function scrollToId(id) {
    const target =
      document.getElementById(id) ||
      document.querySelector(`[data-anchor="${id}"]`) ||
      document.getElementById(`${id}-section`);
    if (!target) return false;

    const offset = window.pageYOffset + target.getBoundingClientRect().top - getHeaderOffset() - 8;
    window.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
    return true;
  }

  function onDocClick(e) {
    const a = e.target.closest('a[href^="#"], [data-menu-link]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    const id = (a.dataset.menuLink || href.replace(/^#/, '')).trim();
    if (!id) return;

    e.preventDefault();
    closeOverlays();
    setTimeout(() => scrollToId(id), 20);
  }

  document.addEventListener('click', onDocClick, { capture: true });
})();
