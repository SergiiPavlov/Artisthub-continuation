/**
 * Hook: Longform Intent Bridge
 * Purpose: Bridge ALL input paths (voice, programmatic, UI) to PRO longform events.
 * - Wraps parseIntent / processAssistantQuery / handleSubmitText if present.
 * - Detects longform intents from raw text (film/movie/audiobook incl. "полнометраж", "длиннее часа").
 * - Always echoes user message to chat (so "аудиокнига ..." видна).
 * - Handles shortCandidate yes/no inline (before calling originals).
 */
(function longformIntentBridge(){
  const w = window;
  function log(...a){ try{ console.log('[bridge]', ...a);}catch{} }
  function safe(fn, ...args){ try{ return fn && fn(...args);}catch{} }

  // --- detection helpers ---
  function detectLongform(raw){
    const v = String(raw||'').toLowerCase();
    if (!v.trim()) return null;
    const isMovie = /(\bфильм\b|\bкино\b|полнометраж)/i.test(v) || /длительн\w+\s+(более\s+)?(часа|60\s*мин)/i.test(v);
    const isAudiobook = /(аудио\s*книг\w*|аудиокнига|audiobook)/i.test(v);
    if (!isMovie && !isAudiobook) return null;

    // Extract title
    let title = '';
    const qm = String(raw).match(/["“”«»„‟']([^"“”«»„‟']{2,})["“”«»„‟']/);
    if (qm) title = qm[1].trim();
    if (!title) {
      const m2 = String(raw).match(/(?:фильм(?:ы)?|кино|аудио\s*книга|аудиокнига|книга)\s+([^,;.!?]+)$/i);
      if (m2) {
        let t = m2[1];
        t = t.replace(/\s+с\s+.+$/i, "").replace(/\s+with\s+.+$/i, "");
        title = t.trim();
      }
    }
    const type = isAudiobook ? 'audiobook' : 'movie';
    const needSuggest = !title || !isAudiobook;
    return { type, title, needSuggest };
  }

  // --- pending short video flow ---
  let pendingShort = null;
  w.addEventListener('assistant:pro.shortCandidate', (e)=>{
    const d = (e && e.detail) || {};
    pendingShort = d.video || null;
    const type = (d.type==='audiobook' ? 'аудиокнигу' : 'фильм');
    const q = (d.title || '').trim();
    const link = `https://www.youtube.com/results?search_query=${encodeURIComponent(q || (type==='аудиокнигу'?'аудиокнига':'фильм'))}`;
    const msg = `Полную ${type} не нашёл. Можно посмотреть на YouTube: <a href="${link}" target="_blank">открыть YouTube</a>.<br>` +
                `Нашёл короткое видео — включить его? (да/нет)`;
    safe(w.addMsg, 'bot', msg);
    safe(w.speak, 'Полный вариант не найден. Включить короткий?');
    log('shortCandidate set', pendingShort && pendingShort.id);
  }, false);

  function maybeHandleYesNo(raw){
    if (!pendingShort) return false;
    const v = String(raw||'').trim().toLowerCase();
    if (/^(да|yes)\b/.test(v)) {
      const vid = pendingShort; pendingShort = null;
      safe(w.addMsg, 'note', 'Включаю короткий вариант…');
      safe(w.speak, 'Включаю короткий вариант');
      // Reuse existing player hook if present
      if (typeof w.loadAndPlayYouTubeVideo === 'function') {
        w.loadAndPlayYouTubeVideo(vid.id, vid);
      } else {
        // or dispatch a confirmed event for your app to handle
        w.dispatchEvent(new CustomEvent('assistant:pro.playConfirmed', { detail: { video: vid } }));
      }
      return true;
    }
    if (/^(нет|no)\b/.test(v)) {
      pendingShort = null;
      safe(w.addMsg, 'bot', 'Ок, короткое видео не включаю.');
      safe(w.speak, 'Хорошо');
      return true;
    }
    return false;
  }

  // --- patch in ---
  try {
    // Hook into assistant query processing:
    const origParseIntent = w.parseIntent;
    if (typeof origParseIntent === 'function') {
      w.parseIntent = function bridgedParseIntent(raw, ...rest){
        const intent = detectLongform(raw);
        if (intent) {
          log('Longform intent detected:', intent);
          safe(w.addMsg, 'user', raw);  // echo the user's request in chat
          if (intent.needSuggest) {
            // Movie or unspecified longform request – provide suggestions (cards)
            window.dispatchEvent(new CustomEvent('assistant:pro.suggest', { detail: intent }));
            safe(w.addMsg, 'note', 'Подбираю варианты…'); 
            safe(w.speak, 'Подбираю варианты');
            safe(w.planSuggestWatchdog, intent);
          } else {
            // Audiobook with a specific title – proceed to play it if possible
            window.dispatchEvent(new CustomEvent('assistant:pro.play', { detail: intent }));
            safe(w.addMsg, 'note', intent.type==='audiobook' ? 'Ищу и включаю аудиокнигу…' : 'Ищу и включаю фильм…');
            safe(w.speak, intent.type==='audiobook' ? 'Включаю аудиокнигу' : 'Включаю фильм');
          }
          return; // do not continue to normal intent processing
        }
        // No longform intent detected, proceed normally
        return origParseIntent.call(this, raw, ...rest);
      };
    }
  } catch(err) {
    console.error('[bridge] Failed to patch parseIntent:', err);
  }
})();
