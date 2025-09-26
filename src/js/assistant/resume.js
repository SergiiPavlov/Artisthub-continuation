// src/js/assistant/resume.js
(() => {
  if (window.__AM_RESUME_INIT__) return;
  window.__AM_RESUME_INIT__ = true;

  const KEY = "am.resume.v1";

  const sel = (s, r=document) => { try { return r.querySelector(s); } catch { return null; } };
  const esc = (s) => String(s || "").replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function loadState() {
    try { return JSON.parse(localStorage.getItem(KEY) || "null") || {}; } catch { return {}; }
  }
  function saveState(st) {
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {}
  }
  function saveEntry(e) {
    const st = loadState();
    const items = Array.isArray(st.items) ? st.items : [];
    const filtered = items.filter(x => x && x.id !== e.id);
    filtered.unshift({ ...e });
    st.items = filtered.slice(0, 10);
    st.last = { ...e };
    saveState(st);
  }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  }

  // Текущее «что и где играем»
  let cur = { id: null, title: "", pos: 0, duration: 0, updatedAt: 0 };
  let lastSaveAt = 0;

  // Подписки на события плеера
  window.addEventListener("AM.player.track", (ev) => {
    const { id, title = "" } = (ev && ev.detail) || {};
    cur = { id: id || null, title: String(title || ""), pos: 0, duration: 0, updatedAt: Date.now() };
  });

  window.addEventListener("AM.player.progress", (ev) => {
    const { current = 0, duration = 0 } = (ev && ev.detail) || {};
    if (!cur.id) return;
    cur.pos = clamp(current, 0, (duration || cur.duration || Infinity));
    cur.duration = duration || cur.duration || 0;

    const now = Date.now();
    if (now - lastSaveAt > 4000) { // троттлинг ~4с
      lastSaveAt = now;
      saveEntry({ ...cur, updatedAt: now });
    }
  });

  window.addEventListener("AM.player.pause", () => {
    if (!cur.id) return;
    saveEntry({ ...cur, updatedAt: Date.now() });
  });

  window.addEventListener("AM.player.ended", () => {
    if (!cur.id) return;
    // По окончании сбрасываем pos=0, но сам факт последнего воспроизведения сохраняем
    saveEntry({ ...cur, pos: 0, updatedAt: Date.now() });
  });

  window.addEventListener("beforeunload", () => {
    if (!cur.id) return;
    saveEntry({ ...cur, updatedAt: Date.now() });
  });

  // UI-плашка «Продолжить»
  function ensureStyles() {
    if (sel("#am-resume-style")) return;
    const css = `
      .am-resume{position:fixed;left:16px;bottom:96px;max-width:520px;z-index:11010;
        background:linear-gradient(180deg,#11161d,#0e141a);color:#e5e7eb;border:1px solid rgba(255,255,255,.06);
        border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.55);padding:.85rem 1rem;display:flex;gap:.75rem;align-items:flex-start}
      .am-resume__txt{line-height:1.45}
      .am-resume__title{font-weight:700}
      .am-resume__btns{margin-left:auto;display:flex;gap:.5rem}
      .am-resume__btn{background:#19212b;border:1px solid rgba(255,255,255,.08);color:#e5e7eb;
        border-radius:10px;padding:.44rem .7rem;cursor:pointer}
      .am-resume__btn:hover{background:#1c2631}
      .am-resume__x{background:transparent;border:none;color:#9aa0a6;cursor:pointer;margin-left:.25rem}
      @media(max-width:640px){.am-resume{left:12px;right:12px;bottom:84px;max-width:none}}
       /* --- Mobile folding (<=768px) --- */
      @media (max-width: 768px){
        .am-resume{ left: 10px; right: 10px; padding: .8rem .85rem; flex-direction: column; }
        .am-resume__btns{
          width: 100%;
          margin-left: 0;
          display: grid;
          grid-template-columns: 1fr auto; /* left col grows, right for × */
          gap: .5rem;
          align-items: stretch;
        }
        .am-resume__btns [data-act="resume"]{ grid-column: 1 / -1; } /* full width first row */
        .am-resume__btns [data-act="restart"]{ grid-column: 1; }     /* left on second row */
        .am-resume__btns [data-act="dismiss"]{ grid-column: 2; justify-self: end; } /* right (×) */
      }
      /* Safety for ultra narrow (<=320px) */
      @media (max-width: 320px){
        .am-resume{ left: 6px; right: 6px; }
      }
    `.trim();
    const s = document.createElement("style");
    s.id = "am-resume-style";
    s.textContent = css;
    document.head.appendChild(s);
  }

  function showPrompt() {
    const st = loadState();
    const e = st && st.last;
    if (!e || !e.id) return;
    // Если почти дослушали/досмотрели — не предлагаем
    if (e.duration && e.pos / e.duration > 0.98) return;

    ensureStyles();
    if (sel(".am-resume")) return;

    const div = document.createElement("div");
    div.className = "am-resume";
    div.innerHTML = `
      <div class="am-resume__txt">
        <div>Продовжити <span class="am-resume__title">«${esc(e.title || "Аудіо/відео")}»</span> с ${esc(fmt(e.pos))}?</div>
      </div>
      <div class="am-resume__btns">
        <button class="am-resume__btn" data-act="resume">Продовжити</button>
        <button class="am-resume__btn" data-act="restart">Спочатку</button>
        <button class="am-resume__x" title="Приховати" data-act="dismiss">×</button>
      </div>
    `.trim();
    document.body.appendChild(div);

    const act = (name) => (ev) => {
      ev?.preventDefault?.();
      if (name === "resume") startAt(e.id, e.pos);
      if (name === "restart") startAt(e.id, 0);
      if (name === "dismiss") {/* просто скрываем */}
      div.remove();
    };

    div.querySelector('[data-act="resume"]')?.addEventListener("click", act("resume"));
    div.querySelector('[data-act="restart"]')?.addEventListener("click", act("restart"));
    div.querySelector('[data-act="dismiss"]')?.addEventListener("click", act("dismiss"));
  }

  // Запуск с нужной позиции
  function startAt(id, sec) {
    try { window.Player?.open(id); } catch {}
    // Дождёмся события «track» именно для этого id, затем дожмём seek
    const onTrack = (ev) => {
      const det = (ev && ev.detail) || {};
      if (det.id !== id) return;
      window.removeEventListener("AM.player.track", onTrack);
      // Небольшая задержка, чтобы YT успел реально начать играть
      setTimeout(() => {
        try {
          if (typeof window.Player?.seekTo === "function") window.Player.seekTo(sec || 0);
          if (typeof window.Player?.play === "function") window.Player.play();
        } catch {}
      }, 400);
    };
    window.addEventListener("AM.player.track", onTrack);
  }

  // Показать подсказку через ~1 секунду после загрузки
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(showPrompt, 1000);
  });
})();
