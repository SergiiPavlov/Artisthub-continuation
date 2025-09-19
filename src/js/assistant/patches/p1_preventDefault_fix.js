/**
 * Patch: P1 preventDefault ordering fix (v2, wider intercept)
 * - Stops default submit/send/enter BEFORE any async code (fixes race).
 * - Intercepts more phrasings: фильм/кино/полнометраж(н), длительностью/более часа,
 *   аудиокнига/книга (включи/поставь/слушать).
 * - Dispatches your existing events: assistant:pro.suggest / assistant:pro.play
 */
(function patchP1PreventDefault_v2(){
  try {
    const w = window, d = document;
    const S = (w.getSelectors && w.getSelectors()) || {
      form: 'form[data-assistant-chat]',
      input: 'textarea[data-assistant-input], input[data-assistant-input]',
      send:  '[data-assistant-send]'
    };
    const qs = (sel, root) => (root || d).querySelector(sel);
    const form  = qs(S.form);
    const input = qs(S.input);
    const send  = qs(S.send);

    function safe(fn, ...args){ try { return fn && fn(...args); } catch(e){ /*noop*/ } }

    // Dumb intent extractor (mirrors your parseIntent enough for gating)
    function roughIntent(vRaw){
      const v = String(vRaw||'').toLowerCase();
      if (!v.trim()) return null;
      const isMovie = /(\bфильм\b|\bкино\b|полнометраж)/i.test(v) || /более\s+(часа|60\s*мин)/i.test(v);
      const bookHint = /(аудиокнига|аудио\s*книга|книг[ауеы])/i.test(v);
      const isAudiobook = bookHint && /(включи|поставь|слушать|проиграй|play)/i.test(v);
      if (!isMovie && !isAudiobook) return null;

      // Try to extract a title in quotes or after keywords
      let title = '';
      const qm = vRaw.match(/["“”«»„‟']([^"“”«»„‟']{2,})["“”«»„‟']/);
      if (qm) title = qm[1].trim();
      if (!title) {
        const m2 = vRaw.match(/(?:фильм(?:ы)?|кино|аудио\s*книга|аудиокнига|книга)\s+([^,;.!?]+)$/i);
        if (m2) {
          let t = m2[1];
          t = t.replace(/\s+с\s+.+$/i, "").replace(/\s+with\s+.+$/i, "");
          title = t.trim();
        }
      }
      return { type: isAudiobook ? 'audiobook' : 'movie', title };
    }

    function runIntentFlowFromText(v){
      const parseIntent = w.parseIntent || null;
      const intent = (parseIntent ? parseIntent(v) : null) || roughIntent(v);
      if (!intent) return false;
      safe(w.addMsg, 'user', safe(w.esc, v) || v);
      const detail = { type:intent.type, title:intent.title, mood:intent.mood, actor:intent.actor, limit: 12 };
      if (intent.needSuggest || !intent.title) {
        w.dispatchEvent(new CustomEvent('assistant:pro.suggest', { detail }));
        safe(w.addMsg, 'note','Подбираю варианты…'); safe(w.speak,'Подбираю варианты'); safe(w.planSuggestWatchdog, detail);
      } else {
        w.dispatchEvent(new CustomEvent('assistant:pro.play', { detail }));
        safe(w.addMsg,'note', intent.type==='audiobook' ? 'Ищу и включаю аудиокнигу…' : 'Ищу и включаю фильм…');
        safe(w.speak, intent.type==='audiobook' ? 'Ищу аудиокнигу' : 'Ищу фильм');
        safe(w.planPlayWatchdog, detail);
      }
      return true;
    }

    function shouldIntercept(value){
      const v = String(value || '').trim().toLowerCase();
      if (!v) return false;
      // Broad triggers for longform
      if (/(\bфильм\b|\bкино\b|полнометраж)/i.test(v)) return true;
      if (/более\s+(часа|60\s*мин)/i.test(v)) return true;
      if (/(аудиокнига|аудио\s*книга|книг[ауеы])/i.test(v) && /(включи|поставь|слушать|проиграй|play)/i.test(v)) return true;
      return false;
    }

    // Submit (capture)
    if (form) {
      form.addEventListener('submit', (ev) => {
        try {
          const valNode = qs(S.input, ev.target) || qs(S.input, document);
          const value = (valNode && ('value' in valNode ? valNode.value : valNode.textContent)) || '';
          if (shouldIntercept(value)) {
            ev.stopPropagation(); ev.preventDefault();
            runIntentFlowFromText(value);
          }
        } catch(e){ /*noop*/ }
      }, true);
    }

    // Enter on input w/o form (capture)
    if (input && !form) {
      input.addEventListener('keydown', (ev) => {
        try {
          if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey) {
            const val = ('value' in input ? input.value : input.textContent) || '';
            if (shouldIntercept(val)) {
              ev.stopPropagation(); ev.preventDefault();
              runIntentFlowFromText(val);
            }
          }
        } catch(e){ /*noop*/ }
      }, true);
    }

    // Click on send (capture)
    if (send) {
      send.addEventListener('click', (ev) => {
        try {
          const valNode = qs(S.input) || document.activeElement;
          const value = (valNode && ('value' in valNode ? valNode.value : valNode.textContent)) || '';
          if (shouldIntercept(value)) {
            ev.stopPropagation(); ev.preventDefault();
            runIntentFlowFromText(value);
          }
        } catch(e){ /*noop*/ }
      }, true);
    }
    console.log('[patch] P1 preventDefault v2 active');
  } catch (e) {
    console.warn('[patch] P1 v2 failed', e);
  }
})();
