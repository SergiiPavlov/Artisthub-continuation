/**
 * Hook: Longform Intent Bridge (movies -> suggest, audiobooks keep behavior)
 * Removes short-video yes/no flow. No duplicate "Подбираю варианты…" messages.
 */
(function longformIntentBridge(){
  const w = window;
  function log(){ try{ console.log.apply(console, ['[bridge]'].concat([].slice.call(arguments))); }catch{} }
  function safe(fn){ try{ return (typeof fn==='function') ? fn.apply(null, Array.prototype.slice.call(arguments,1)) : void 0; }catch{} }

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
    const needSuggest = type === 'movie' ? true : !title;
    return { type, title, needSuggest, limit: 12 };
  }

  try {
    const orig = w.parseIntent;
    if (typeof orig === 'function') {
      w.parseIntent = function bridgedParseIntent(raw){
        const intent = detectLongform(raw);
        if (!intent) return orig.apply(this, arguments);

        log('longform intent', intent);

        if (intent.needSuggest) {
          // 🔹 Сообщаем chat.js, что стандартный вызов ИИ не нужен для этого ввода
          try { w.__ASSIST_SKIP_AI_ONCE__ = true; } catch {}
          w.dispatchEvent(new CustomEvent('assistant:pro.suggest', { detail: intent }));
          safe(w.addMsg, 'note', 'Подбираю варианты…');
          safe(w.speak, 'Подбираю варианты');
          return;
        }
        // audiobooks with explicit title -> play
        try { w.__ASSIST_SKIP_AI_ONCE__ = true; } catch {}
        w.dispatchEvent(new CustomEvent('assistant:pro.play', { detail: intent }));
        safe(w.addMsg,'note','Ищу и включаю аудиокнигу…');
        safe(w.speak,'Включаю аудиокнигу');
      };
    }
  } catch(err) {
    console.error('[bridge] failed to attach', err);
  }
})();
