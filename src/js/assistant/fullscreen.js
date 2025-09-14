// src/js/assistant/fullscreen.js
(() => {
  if (window.__ASSISTANT_FS_INIT__) return;
  window.__ASSISTANT_FS_INIT__ = true;

  const FS_DOC_CLASS  = 'assistant-fs-doc';
  const FS_NODE_CLASS = 'assistant-fs';

  function getFSRoot() {
    // Разворачиваем сам плеер, если он есть; иначе — документ
    return document.querySelector('.am-player') || document.documentElement;
  }

  function signalChange() {
    try {
      document.dispatchEvent(new CustomEvent('assistant:fs-change', { bubbles: true, composed: true }));
    } catch {}
  }

  function inFs() {
    return !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.documentElement.classList.contains(FS_DOC_CLASS)
    );
  }

  function applyCssFallback() {
    const el = getFSRoot();
    el?.classList.add(FS_NODE_CLASS);
    document.documentElement.classList.add(FS_DOC_CLASS);
    signalChange();
  }
  function clearCssFallback() {
    const el = getFSRoot();
    el?.classList.remove(FS_NODE_CLASS);
    document.documentElement.classList.remove(FS_DOC_CLASS);
    signalChange();
  }

  async function enterFS() {
    const el = getFSRoot();
    if (!el) return false;
    if (inFs()) return true;

    const hasNative = !!(el.requestFullscreen || el.webkitRequestFullscreen);

    // Если нативного API нет — используем CSS-фоллбэк
    if (!hasNative) {
      applyCssFallback();
      return true;
    }

    try {
      if (el.requestFullscreen) {
        await el.requestFullscreen({ navigationUI: 'hide' });
        return true;
      }
      if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen(); // WebKit sync
        return true;
      }
    } catch (e) {
      // На мобильных голос/автовызов без жеста → NotAllowed/Premissions
      const msg = String(e?.message || '').toLowerCase();
      const name = String(e?.name || '').toLowerCase();
      if (
        name.includes('notallowed') ||
        msg.includes('gesture') ||
        msg.includes('permission') ||
        msg.includes('denied') ||
        msg.includes('permissions check failed')
      ) {
        showPrompt();      // предложим пользователю нажать кнопку
        return false;
      }
      console.warn('[fs] request failed', e);
      showPrompt();
      return false;
    }

    return true;
  }

  function exitFS() {
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen();
        return;
      }
      if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
        return;
      }
    } catch {}
    // если работали через CSS-фоллбэк
    clearCssFallback();
  }

  async function toggleFS() {
    if (inFs()) exitFS(); else await enterFS();
  }

  function showPrompt() {
    if (document.getElementById('assistant-fs-prompt')) return;

    const wrap = document.createElement('div');
    wrap.id = 'assistant-fs-prompt';
    wrap.style.cssText = `
      position:fixed; right:16px; bottom:86px; z-index:10050;
      background:#0f1216; color:#e8f1ff; border:1px solid #2b3646;
      border-radius:10px; padding:10px 12px; box-shadow:0 10px 30px rgba(0,0,0,.35);
      font:500 14px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Arial;
    `;
    wrap.innerHTML = `
      <div style="display:flex; gap:8px; align-items:center;">
        <span>Tap to enter fullscreen</span>
        <button id="assistant-fs-go"
          style="background:#0ea5e9;border:none;border-radius:8px;color:#fff;padding:.45rem .6rem;cursor:pointer">
          Fullscreen
        </button>
        <button id="assistant-fs-close"
          style="background:transparent;border:1px solid #2b3646;border-radius:8px;color:#cbd5e1;padding:.35rem .5rem;cursor:pointer">
          ×
        </button>
      </div>
    `;
    document.body.appendChild(wrap); // <-- фикс: wrap, не "wap"

    function removePrompt() {
      document.getElementById('assistant-fs-prompt')?.remove();
    }

    document.getElementById('assistant-fs-go')?.addEventListener('click', async () => {
      await enterFS();
      removePrompt();
    });
    document.getElementById('assistant-fs-close')?.addEventListener('click', removePrompt);
  }

  /* --- События ассистента --- */
  document.addEventListener('assistant:fullscreen',        () => { enterFS(); },   true);
  document.addEventListener('assistant:exit-fullscreen',   () => { exitFS(); },    true);
  document.addEventListener('assistant:fullscreen-toggle', () => { toggleFS(); },  true);

  /* --- Выход по Esc --- */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && inFs()) exitFS();
  });

  /* --- Поддержка нативных изменений --- */
  document.addEventListener('fullscreenchange',      signalChange);
  document.addEventListener('webkitfullscreenchange', signalChange);

  /* --- Немного CSS для фоллбэка --- */
  const st = document.createElement('style');
  st.textContent = `
    .${FS_DOC_CLASS}{ overflow: hidden !important; }
    .${FS_NODE_CLASS}{ position:fixed !important; inset:0 !important; z-index:10000 !important; background:#000; }
  `;
  document.head.appendChild(st);

  // Маркер готовности
  window.__ASSISTANT_FS_READY__ = true;
})();
