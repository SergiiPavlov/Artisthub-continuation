/**
 * UI shortCandidate prompt v3:
 * - waits for addMsg up to 2 seconds; if still missing -> confirm fallback
 * - renders buttons in chat
 */
(function uiShortCandidatePromptV3(){
  const w = window;
  let last = null;

  function linkTo(q){ return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`; }
  function haveAdd(){ try{ return typeof w.addMsg === 'function'; }catch{ return false; } }
  function render(d){
    const typeRu = d.type==='audiobook' ? 'аудиокнигу' : 'фильм';
    const q = (d.title || '').trim() || (typeRu==='аудиокнигу' ? 'аудиокнига' : 'фильм');
    const link = `<a href="${linkTo(q)}" target="_blank">открыть YouTube</a>`;
    const html = [
      `Полную ${typeRu} не нашёл. Посмотрите на YouTube: ${link}.`,
      `Нашёл короткое видео — включить его?`,
      `<div class="short-choice">`,
      `<button class="btn btn-xs" data-short-yes="1">Включить короткий</button>`,
      `<button class="btn btn-xs" data-short-no="1">Не включать</button>`,
      `</div>`
    ].join('<br>');
    try { w.addMsg('bot', html); } catch {}
  }
  function confirmFallback(d){
    const typeRu = d.type==='audiobook' ? 'аудиокнигу' : 'фильм';
    const q = (d.title || '').trim() || (typeRu==='аудиокнигу' ? 'аудиокнига' : 'фильм');
    const txt = `Полную ${typeRu} не нашёл. Посмотрите на YouTube: открыть YouTube.\nНашёл короткое видео — включить его?`;
    const ok = window.confirm(txt);
    if (ok && last) {
      if (typeof w.loadAndPlayYouTubeVideo === 'function') {
        w.loadAndPlayYouTubeVideo(last.id, last);
      } else {
        w.dispatchEvent(new CustomEvent('assistant:pro.playConfirmed', { detail: { video: last } }));
      }
    }
  }

  function waitAndRender(d){
    if (haveAdd()) { render(d); return; }
    let tries = 0;
    const timer = setInterval(()=>{
      tries++;
      if (haveAdd()) { clearInterval(timer); render(d); }
      else if (tries>=10) { clearInterval(timer); confirmFallback(d); }
    }, 200);
  }

  window.addEventListener('assistant:pro.shortCandidate', (e)=>{
    const d=(e&&e.detail)||{}; last = d.video||null; waitAndRender(d);
  }, false);

  document.addEventListener('click', (ev)=>{
    const t = ev.target; if (!t || !(t instanceof Element)) return;
    if (t.hasAttribute('data-short-yes')){
      ev.preventDefault(); if (!last) return;
      if (typeof w.loadAndPlayYouTubeVideo === 'function') w.loadAndPlayYouTubeVideo(last.id, last);
      else w.dispatchEvent(new CustomEvent('assistant:pro.playConfirmed', { detail: { video: last } }));
    } else if (t.hasAttribute('data-short-no')) {
      ev.preventDefault(); try{ w.addMsg && w.addMsg('bot','Ок, короткое видео не включаю.'); }catch{}
    }
  }, false);

  console.log('[ui] shortCandidate prompt v3 active');
})();
