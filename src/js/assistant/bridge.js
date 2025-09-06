/* Мост: связывает чат-ассистента с твоим сайтом/плеером */
(() => {
  const root = document.documentElement;

  const $ = (s, ctx=document) => ctx.querySelector(s);

  function clickIfExists(...sels){
    for (const sel of sels) {
      const el = $(sel);
      if (el) { el.click(); return true; }
    }
    return false;
  }

  // Переключение вида (List/Grid)
  function setListMode(on){
    // 1) пробуем твою настоящую кнопку (подставь свои селекторы, если другие)
    if (on) {
      if (clickIfExists('[data-action="view-list"]', '.js-view-list', '[data-view="list"]')) return;
      root.classList.add('list-view');
    } else {
      if (clickIfExists('[data-action="view-grid"]', '.js-view-grid', '[data-view="grid"]')) return;
      root.classList.remove('list-view');
    }
  }

  // Громкость: YT Iframe API или <audio>/<video>
  function adjustVolume(delta){
    try {
      const yt = window.player || window.YTPlayer || window.ytPlayer;
      if (yt && typeof yt.getVolume === 'function' && typeof yt.setVolume === 'function') {
        const cur = yt.getVolume?.() ?? 50;
        const next = Math.max(0, Math.min(100, Math.round(cur + delta * 100)));
        yt.setVolume(next);
        return;
      }
    } catch {}

    const media = $('audio, video');
    if (media) media.volume = Math.max(0, Math.min(1, media.volume + delta));
  }

  // Мини-фильтр по настроению (fallback):
  function filterByMood(mood){
    // 1) если есть твои фильтр-кнопки
    if (clickIfExists(`[data-mood="${mood}"]`, `[data-filter="${mood}"]`)) return;

    // 2) иначе скрываем/показываем карточки по data-mood
    const cards = document.querySelectorAll('.card');
    if (cards.length) {
      const m = (mood || '').toLowerCase();
      cards.forEach(c => {
        const v = (c.getAttribute('data-mood') || '').toLowerCase();
        c.style.display = (!m || v.includes(m)) ? '' : 'none';
      });
    }

    // 3) и кидаем событие — вдруг у тебя своя логика слушает это
    document.dispatchEvent(new CustomEvent('filter:mood', { detail: { mood } }));
  }

  // Привязки событий ассистента
  document.addEventListener('assistant:view', e => setListMode(e.detail.mode === 'list'));

  document.addEventListener('assistant:player-next', () => {
    if (clickIfExists('[data-action="next"]', '.js-next', '.player-next')) return;
    document.dispatchEvent(new Event('player-next'));
  });
  document.addEventListener('assistant:player-prev', () => {
    if (clickIfExists('[data-action="prev"]', '.js-prev', '.player-prev')) return;
    document.dispatchEvent(new Event('player-prev'));
  });
  document.addEventListener('assistant:player-play', () => {
    if (clickIfExists('[data-action="play"]', '.js-play', '.player-play')) return;
    document.dispatchEvent(new Event('player-play'));
  });
  document.addEventListener('assistant:player-pause', () => {
    if (clickIfExists('[data-action="pause"]', '.js-pause', '.player-pause')) return;
    document.dispatchEvent(new Event('player-pause'));
  });

  document.addEventListener('assistant:volume', e => adjustVolume(e.detail?.delta ?? 0));

  document.addEventListener('assistant:recommend', e => {
    const mood = e.detail?.mood;
    filterByMood(mood);
  });
})();
