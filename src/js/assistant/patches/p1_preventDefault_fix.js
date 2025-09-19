/**
 * Patch: P1 preventDefault ordering fix (non-invasive)
 * Place this file AFTER chat.longform.merge.js in your HTML/entry.
 * It ensures default form submit / send click / Enter key do not race with PRO flow.
 *
 * Strategy:
 *  - Capture phase listeners stop default immediately when the input clearly contains a longform intent.
 *  - Then we synchronously dispatch the same custom events your code already uses:
 *      assistant:pro.suggest  / assistant:pro.play
 *  - We DO NOT remove your existing handlers — we just prevent the browser default first.
 *
 * Assumptions:
 *  - getSelectors() and qs(selector, root?) exist in global scope (as in your codebase).
 *  - parseIntent(v) exists and returns {type, title, mood, actor, needSuggest} OR falsy.
 *  - addMsg, esc, speak, planSuggestWatchdog, planPlayWatchdog exist (no-ops if missing).
 */
(function patchP1PreventDefault(){
  try {
    const w = window;
    const d = document;
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

    function runIntentFlow(v){
      const parseIntent = w.parseIntent || null;
      const intent = parseIntent ? parseIntent(v) : null;
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
      const v = String(value || '').trim();
      if (!v) return false;
      // quick check to avoid intercepting ordinary chat:
      return /(\bфильм\b|\bкино\b|audiobook|аудио\s*книга|аудиокниг)/i.test(v);
    }

    // Submit (capture)
    if (form) {
      form.addEventListener('submit', (ev) => {
        try {
          const valNode = qs(S.input, ev.target) || qs(S.input, document);
          const value = (valNode && ('value' in valNode ? valNode.value : valNode.textContent)) || '';
          if (shouldIntercept(value)) {
            // STOP DEFAULT FIRST — main fix
            ev.stopPropagation(); ev.preventDefault();
            // then run longform flow synchronously
            runIntentFlow(value);
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
              runIntentFlow(val);
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
            runIntentFlow(value);
          }
        } catch(e){ /*noop*/ }
      }, true);
    }
    // Done
    console.log('[patch] P1 preventDefault fix active');
  } catch (e) {
    console.warn('[patch] P1 fix failed', e);
  }
})();
