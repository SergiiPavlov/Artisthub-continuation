/**
 * UI Patch: shortCandidate prompt renderer
 * Shows a YouTube link + asks "Включить короткий? (да/нет)" whenever assistant:pro.shortCandidate fires.
 * Uses addMsg('bot', html) if available; otherwise falls back to alert/console.
 */
(function uiShortCandidatePrompt(){
  const w = window;
  function add(html){
    try { if (typeof w.addMsg === 'function') return w.addMsg('bot', html); } catch {}
    try { console.log('[ui-shortCandidate]', html.replace(/<[^>]+>/g,'')); alert(html.replace(/<[^>]+>/g,'')); } catch {}
  }
  function linkTo(q){ return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`; }

  window.addEventListener('assistant:pro.shortCandidate', (e) => {
    const d = (e && e.detail) || {};
    const typeRu = d.type==='audiobook' ? 'аудиокнигу' : 'фильм';
    const q = (d.title || '').trim() || (typeRu==='аудиокнигу' ? 'аудиокнига' : 'фильм');
    const msg = `Полную ${typeRu} не нашёл. Посмотрите на YouTube: <a href="${linkTo(q)}" target="_blank">открыть YouTube</a>.<br>`+
                `Нашёл короткое видео — включить его? (да/нет)`;
    add(msg);
  }, false);

  console.log('[ui] shortCandidate prompt active');
})();
