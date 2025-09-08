/* Bridge: превращаем события assistant:* в реальные действия плеера/интерфейса */
(() => {
  // Signal presence of assistant bridge to avoid duplicate wiring
  try { window.__AH_BRIDGE_PRESENT = true; } catch {}
  // If the dedicated player patch is installed, skip this bridge to avoid double-handling.
  if (typeof window !== 'undefined' && window.__AM_PLAYER_PATCH_INSTALLED__) {
    return;
  }

  const q = (sel) => document.querySelector(sel);

  function safeCall(method, ...args) {
    try { return method?.(...args); } catch { /* no-op */ }
  }
  function clickFirst(...selectors) {
    for (const s of selectors) {
      const el = q(s);
      if (el) { el.click(); return true; }
    }
    return false;
  }

  function player() { return (window.AM && window.AM.player) || null; }

  // Вид (list/grid)
  document.addEventListener("assistant:view", (e) => {
    const mode = e?.detail?.mode;
    const isList = mode === "list";
    document.documentElement.classList.toggle("list-view", !!isList);
  });

  // Прямой запуск по ID/URL (если ассистент прислал конкретную песню)
  document.addEventListener("assistant:play", (e) => {
    const id = e?.detail?.id;
    const query = e?.detail?.query;
    const p = player();
    const ytid = (s) => {
      if (!s) return "";
      if (/^[\w-]{11}$/.test(s)) return s;
      try {
        const u = new URL(s, location.href);
        if (/youtu\.be$/i.test(u.hostname)) return u.pathname.slice(1);
        const m = u.pathname.match(/\/(?:embed|v|shorts)\/([^/?#]+)/i);
        if (m && m[1] && /^[\w-]{11}$/.test(m[1])) return m[1];
        const v = u.searchParams.get("v");
        if (v && /^[\w-]{11}$/.test(v)) return v;
      } catch {}
      return "";
    };

    const tid = id || ytid(query);
    if (p && tid && typeof p.openQueue === "function") {
      p.openQueue([tid], { startIndex: 0, shuffle: false, loop: true });
    } else if (tid) {
      // как фоллбэк — попробуем просто кликнуть на ссылку в DOM, если она есть
      const link = document.querySelector(`a[href*="${tid}"]`);
      if (link) link.click();
    }
  });

  // Транспорт
  document.addEventListener("assistant:player-play", () => {
    const p = player();
    if (!p || !safeCall(p.play)) {
      clickFirst(".am-player [data-action='play']",
                 ".am-player__btn--play",
                 "button[aria-label='Play']");
    }
  });

  document.addEventListener("assistant:player-pause", () => {
    const p = player();
    if (!p || !safeCall(p.pause)) {
      clickFirst(".am-player [data-action='pause']",
                 ".am-player__btn--pause",
                 "button[aria-label='Pause']");
    }
  });

  document.addEventListener("assistant:player-stop", () => {
    const p = player();
    if (!p || !safeCall(p.stop)) {
      clickFirst(".am-player [data-action='stop']",
                 "button[aria-label='Stop']");
    }
  });

  document.addEventListener("assistant:player-next", () => {
    const p = player();
    if (!p || !safeCall(p.next)) {
      clickFirst(".am-player [data-action='next']",
                 ".am-player__btn--next",
                 "button[aria-label='Next']");
    }
  });

  document.addEventListener("assistant:player-prev", () => {
    const p = player();
    if (!p || !safeCall(p.prev)) {
      clickFirst(".am-player [data-action='prev']",
                 ".am-player__btn--prev",
                 "button[aria-label='Previous']", "button[aria-label='Prev']");
    }
  });

  // Громкость
  document.addEventListener("assistant:volume", (e) => {
    const delta = Number(e?.detail?.delta ?? 0);
    const p = player();
    if (p && typeof p.setVolume === "function") {
      const cur = p.getVolume?.() ?? 0.7;
      const next = Math.max(0, Math.min(1, cur + delta));
      p.setVolume(next);
      return;
    }

    // Фоллбэк по слайдеру громкости в DOM
    const slider = document.querySelector(".am-player input[type='range'][name='volume'], .am-player .volume input[type='range']");
    if (slider) {
      const cur = Number(slider.value || 70) / 100;
      const next = Math.max(0, Math.min(1, cur + delta));
      slider.value = String(Math.round(next * 100));
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  // MixRadio — отдаём в index.js, там есть buildPool/startMixRadio
  document.addEventListener("assistant:mixradio", () => {
    const btn = q("#random-radio");
    if (btn) btn.click();
  });
})();
