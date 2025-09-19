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
    const needSuggest = !title;
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

  // --- dispatcher ---
  function dispatchLongformIntent(intent){
    const detail = { type:intent.type, title:intent.title, mood:intent.mood, actor:intent.actor, limit: 12 };
    if (intent.needSuggest) {
      w.dispatchEvent(new CustomEvent('assistant:pro.suggest', { detail }));
      safe(w.addMsg, 'note','Подбираю варианты…'); safe(w.speak,'Подбираю варианты'); safe(w.planSuggestWatchdog, detail);
    } else {
      w.dispatchEvent(new CustomEvent('assistant:pro.play', { detail }));
      safe(w.addMsg,'note', intent.type==='audiobook' ? 'Ищу и включаю аудиокнигу…' : 'Ищу и включаю фильм…');
      safe(w.speak, intent.type==='audiobook' ? 'Ищу аудиокнигу' : 'Ищу фильм');
      safe(w.planPlayWatchdog, detail);
    }
  }

  // --- wrap parseIntent ---
  const _parseIntent = w.parseIntent;
  if (typeof _parseIntent === 'function') {
    w.parseIntent = function(v){
      let r = null;
      try { r = _parseIntent.apply(this, arguments); } catch {}
      if (r && (r.type==='audiobook' || r.type==='movie')) return r;
      const det = detectLongform(v);
      if (det) { log('parseIntent bridged', det); return det; }
      return r;
    };
    log('wrapped parseIntent');
  }

  // --- wrap processAssistantQuery ---
  const _proc = w.processAssistantQuery;
  if (typeof _proc === 'function') {
    w.processAssistantQuery = function(v){
      // echo user text so "аудиокнига ..." always visible
      safe(w.addMsg, 'user', (safe(w.esc, v) || v));
      // handle yes/no for pending short
      if (maybeHandleYesNo(v)) return true;
      // detect longform
      const det = detectLongform(v);
      if (det) { log('PAQ bridged', det); dispatchLongformIntent(det); return true; }
      // else continue normal flow
      try { return _proc.apply(this, arguments); } catch(e){ log('PAQ error', e); }
    };
    log('wrapped processAssistantQuery');
  }

  // --- wrap handleSubmitText if exists ---
  const _hst = w.handleSubmitText;
  if (typeof _hst === 'function') {
    w.handleSubmitText = function(v){
      // echo user text
      safe(w.addMsg, 'user', (safe(w.esc, v) || v));
      if (maybeHandleYesNo(v)) return true;
      const det = detectLongform(v);
      if (det) { log('handleSubmit bridged', det); dispatchLongformIntent(det); return true; }
      try { return _hst.apply(this, arguments); } catch(e){ log('handleSubmit err', e); return false; }
    };
    log('wrapped handleSubmitText');
  }

  log('longform intent bridge active');
})();
