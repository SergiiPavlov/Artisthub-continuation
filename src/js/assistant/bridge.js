// Создаём мини-плеер
const player = createMiniPlayer?.();

// Дадим мосту доступ к экземпляру плеера
window.__miniPlayer = player;
document.dispatchEvent(new CustomEvent('assistant:player-ready', { detail: { ok: !!player } }));
