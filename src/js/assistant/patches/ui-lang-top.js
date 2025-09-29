// ui-lang-top.js — UI language dropdown + short header + robust layout (messages shrink, settings keep full size)
(function(){
  'use strict';

  const UI_KEY = 'assistant.ui.lang';
  const get = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  // 'chat' => Чат/Chat, 'guide' => Гид/Гід/Guide
  const TITLE_MODE = 'chat';

  const STR = {
    ru: { headerChat:'Чат', headerGuide:'Гид', modeLabel:'Режим', uiLabel:'Яз.', uiTitle:'Язык интерфейса',
      placeholder:'Скажи або напиши…', send:'Отправить',
      settings:{ langLabel:'Мова (RU/UK/EN)', voiceLabel:'Голос озвучки', serverTts:'Серверный TTS (Piper)',
        serverTtsHint:'Нужно настроить /api/tts на сервере. Иначе будет браузерный голос.',
        mute:'Режим без звука (mute)', muteHint:'Выключает звук плеера и озвучку ответов.',
        wakeOn:'Пост. прослушивание (wake word)', wakePhrase:'Фраза активации',
        testVoice:'Проба голоса', clear:'Очистить чат', hideSettings:'Свернуть настройки',
        wakeBgHint:'Фоновое прослушивание работает только при активной вкладке и выданном доступе к микрофону.' } },
    uk: { headerChat:'Чат', headerGuide:'Гід', modeLabel:'Режим', uiLabel:'Мова', uiTitle:'Мова інтерфейсу',
      placeholder:'Скажи або напиши…', send:'Надіслати',
      settings:{ langLabel:'Мова (RU/UK/EN)', voiceLabel:'Голос озвучення', serverTts:'Серверний TTS (Piper)',
        serverTtsHint:'Потрібно налаштувати /api/tts на сервері. Інакше буде браузерний голос.',
        mute:'Режим без звуку (mute)', muteHint:'Вимикає звук плеєра та озвучення відповідей.',
        wakeOn:'Постійне прослуховування (wake word)', wakePhrase:'Фраза активації',
        testVoice:'Проба голосу', clear:'Очистити чат', hideSettings:'Згорнути налаштування',
        wakeBgHint:'Фонове прослуховування працює лише за активної вкладки та наданого доступу до мікрофона.' } },
    en: { headerChat:'Chat', headerGuide:'Guide', modeLabel:'Mode', uiLabel:'Lang', uiTitle:'Interface language',
      placeholder:'Say or type…', send:'Send',
      settings:{ langLabel:'Language (RU/UK/EN)', voiceLabel:'TTS voice', serverTts:'Server TTS (Piper)',
        serverTtsHint:'Configure /api/tts on the server. Otherwise a browser voice will be used.',
        mute:'Mute mode (mute)', muteHint:'Disables player sound and answer speech.',
        wakeOn:'Always listen (wake word)', wakePhrase:'Wake phrase',
        testVoice:'Test voice', clear:'Clear chat', hideSettings:'Hide settings',
        wakeBgHint:'Background listening works only with the tab active and microphone permission granted.' } }
  };

  function waitFor(selector, root=document){
    return new Promise((resolve) => {
      const el = root.querySelector(selector);
      if (el) return resolve(el);
      const obs = new MutationObserver(() => {
        const e = root.querySelector(selector);
        if (e) { obs.disconnect(); resolve(e); }
      });
      obs.observe(root.documentElement || root.body || document.body, { childList:true, subtree:true });
    });
  }

  function currentHeaderTitle(lang){
    const L = STR[lang] || STR.ru;
    return TITLE_MODE === 'guide' ? L.headerGuide : L.headerChat;
  }

  function applyUiLang(lang, root){
    const L = STR[lang] || STR.ru;
    const title = currentHeaderTitle(lang);
    const hdrStrong = root.querySelector('.assistant__header strong'); if (hdrStrong) hdrStrong.replaceChildren(document.createTextNode(title));
    const prov = root.querySelector('.assistant__prov-label'); if (prov) prov.replaceChildren(document.createTextNode(L.modeLabel));
    const input = root.querySelector('.assistant__input'); if (input) input.setAttribute('placeholder', L.placeholder);
    const btnSend = root.querySelector('.assistant__send'); if (btnSend) btnSend.textContent = L.send;

    const lbl = root.querySelector('.assistant__uilang-label'); if (lbl) lbl.textContent = L.uiLabel;
    const wrap = root.querySelector('.assistant__uilang-wrap'); if (wrap) wrap.title = L.uiTitle;

    const selLang = root.querySelector('#as-lang'); if (selLang && selLang.previousElementSibling) selLang.previousElementSibling.textContent = L.settings.langLabel;
    const selVoice = root.querySelector('#as-voice'); if (selVoice && selVoice.previousElementSibling) selVoice.previousElementSibling.textContent = L.settings.voiceLabel;

    const asTts = root.querySelector('#as-tts-server');
    if (asTts){ const row = asTts.closest('label.assistant__row'); if (row){ const sp = row.querySelector('span'); if (sp) sp.textContent = L.settings.serverTts; const hint = row.querySelector('small.assistant__hint'); if (hint) hint.textContent = L.settings.serverTtsHint; } }

    const asMute = root.querySelector('#as-mute');
    if (asMute){ const row = asMute.closest('label.assistant__row'); if (row){ const sp = row.querySelector('span'); if (sp) sp.textContent = L.settings.mute; const hint = row.querySelector('small.assistant__hint'); if (hint) hint.textContent = L.settings.muteHint; } }

    const asWake = root.querySelector('#as-wake-on'); if (asWake){ const row = asWake.closest('label.assistant__row'); if (row){ const sp = row.querySelector('span'); if (sp) sp.textContent = L.settings.wakeOn; } }
    const asPhrase = root.querySelector('#as-wake-phrase'); if (asPhrase){ const row = asPhrase.closest('label.assistant__row'); if (row){ const sp = row.querySelector('span'); if (sp) sp.textContent = L.settings.wakePhrase; } }

    const btnTest2 = root.querySelector('#as-test-voice'); if (btnTest2) btnTest2.textContent = L.settings.testVoice;
    const btnClear = root.querySelector('#as-clear-log'); if (btnClear) btnClear.textContent = L.settings.clear;
    const btnHide  = root.querySelector('#as-hide-settings'); if (btnHide) btnHide.textContent = L.settings.hideSettings;

    const settings = root.querySelector('.assistant__settings');
    if (settings){ const hints = settings.querySelectorAll('small.assistant__hint'); if (hints && hints.length){ const last = hints[hints.length - 1]; if (last) last.textContent = L.settings.wakeBgHint; } }
  }

  function isMobileLayout(){ return window.innerWidth < 768; }

  function equalizeSettingsRows(root){
    const settings = root.querySelector('.assistant__settings'); if (!settings) return;
    const rows = Array.from(settings.querySelectorAll('label.assistant__row')); if (!rows.length) return;

    if (isMobileLayout()){ rows.forEach(r => r.style.minHeight = ''); return; }
    const rect = settings.getBoundingClientRect(); const midX = rect.left + rect.width / 2;
    const left = []; const right = [];
    rows.forEach(r => { r.style.minHeight = ''; const b = r.getBoundingClientRect(); (b.left < midX ? left : right).push(r); });
    const maxLen = Math.max(left.length, right.length);
    for (let i = 0; i < maxLen; i++){ const a = left[i]; const b = right[i]; const ha = a ? a.getBoundingClientRect().height : 0; const hb = b ? b.getBoundingClientRect().height : 0; const h = Math.max(ha, hb); if (a) a.style.minHeight = Math.ceil(h) + 'px'; if (b) b.style.minHeight = Math.ceil(h) + 'px'; }
  }

  // Robust open-state detection for fixed elements
  function panelIsOpen(panel){
    if (!panel) return false;
    const cs = getComputedStyle(panel);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    const r = panel.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function setupOutsideClose(root){
    const panel = root.querySelector('.assistant__panel'); if (!panel) return;
    function close(){
      const btn = root.querySelector('.assistant__close, .assistant__btn-close, .assistant__hdr .btn-close, .assistant__header .assistant__close');
      if (btn) { btn.dispatchEvent(new MouseEvent('click', { bubbles:true })); return; }
      const bubble = document.querySelector('.assistant__bubble, #assistant-bubble'); if (bubble) { bubble.dispatchEvent(new MouseEvent('click', { bubbles:true })); return; }
      panel.style.display = 'none';
    }
    function onPointerDown(e){ if (!panelIsOpen(panel)) return; if (panel.contains(e.target)) return; close(); }
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('touchstart', onPointerDown, { passive:true, capture:true });
    function onKey(e){ if (!panelIsOpen(panel)) return; if (e.key === 'Escape' || e.key === 'Esc') close(); }
    document.addEventListener('keydown', onKey);
  }

  // Try to mark the scrollable chat area (messages/history) so CSS can target it
  function markLogArea(root){
    const candidates = root.querySelectorAll('.assistant__log, .assistant__messages, .assistant__history, .assistant__dialog, .assistant__content, .assistant__scroll, .assistant__body');
    let el = null;
    candidates.forEach(c => {
      // Heuristic: must be a block with considerable height above the composer
      const r = c.getBoundingClientRect();
      if (r.height > 80 && !el) el = c;
    });
    if (el) el.classList.add('as-logarea');
  }

  function ensureCss(){
    const id = 'assistant-ui-lang-inline-style';
    if (document.getElementById(id)) return;
    const st = document.createElement('style'); st.id = id;
    st.textContent = `
      /* Panel and vertical layout: messages flex, settings don't shrink */
      #assistant-root .assistant__panel{ width:min(96vw, 920px) !important; max-width:min(96vw, 920px) !important; display:flex; flex-direction:column; overflow:hidden }
      #assistant-root .assistant__header{ flex:0 0 auto }
      #assistant-root .assistant__composer, #assistant-root .assistant__inputbar, #assistant-root .assistant__footer{ flex:0 0 auto }
      #assistant-root .assistant__settings{ flex:0 0 auto; max-height:none !important }
      /* Any plausible chat log container becomes flex child with scroll */
      #assistant-root .assistant__panel .assistant__log,
      #assistant-root .assistant__panel .assistant__messages,
      #assistant-root .assistant__panel .assistant__history,
      #assistant-root .assistant__panel .assistant__dialog,
      #assistant-root .assistant__panel .assistant__content,
      #assistant-root .assistant__panel .assistant__scroll,
      #assistant-root .assistant__panel .assistant__body,
      #assistant-root .assistant__panel .as-logarea{
        flex:1 1 auto; min-height:0 !important; overflow:auto;
      }

      /* Top bar */
      #assistant-root .assistant__hdr-actions{ display:flex; flex-wrap:wrap; gap:.35rem .5rem }
      .assistant__uilang-wrap{ display:flex; align-items:center; gap:.35rem; color:#cbd5e1; flex:0 0 auto }
      .assistant__uilang-wrap select{ background:#0b0f14; border:1px solid #263142; color:#e8f1ff; border-radius:8px; padding:.25rem .5rem; min-width:64px }

      /* Settings text wrapping */
      #assistant-root .assistant__settings label.assistant__row span{ white-space:normal; line-height:1.25 }
      #assistant-root .assistant__settings small.assistant__hint{ white-space:normal }

      /* Checkbox row alignment */
      #assistant-root .assistant__settings label.assistant__row{ display:grid; grid-template-columns:auto 1fr; align-items:center; column-gap:.6rem; min-height:40px }
      #assistant-root .assistant__settings label.assistant__row input[type="checkbox"]{ width:18px; height:18px }
      #assistant-root .assistant__settings label.assistant__row small.assistant__hint{ grid-column: 2 / -1; margin-top:.3rem; display:block }

      /* Mobile layout: stack columns under 768px */
      @media (max-width: 768px){
        #assistant-root .assistant__settings{ display:block }
        #assistant-root .assistant__settings > *{ display:block !important; width:100% !important; max-width:100% !important }
        #assistant-root .assistant__settings label.assistant__row{ min-height:unset }
      }

      /* Tiny screens */
      @media (max-width: 360px){
        #assistant-root .assistant__header{ gap:.35rem }
        #assistant-root .assistant__hdr-actions{ flex-basis:100% }
      }
    `;
    document.head.appendChild(st);
  }

  async function init(){
    await waitFor('#assistant-root');
    const root = document.querySelector('#assistant-root');
    if (!root) return;
    ensureCss();

    const actions = root.querySelector('.assistant__hdr-actions');
    if (!actions) return;

    // Build dropdown
    const wrap = document.createElement('label'); wrap.className = 'assistant__uilang-wrap'; wrap.title = 'Язык интерфейса';
    const span = document.createElement('span'); span.className = 'assistant__uilang-label'; span.textContent = (STR[get(UI_KEY,'ru')]||STR.ru).uiLabel;
    const sel  = document.createElement('select'); sel.id = 'as-ui-lang-top';
    sel.innerHTML = '<option value="ru">RU</option><option value="uk">UK</option><option value="en">EN</option>';
    wrap.appendChild(span); wrap.appendChild(sel);
    const gear = actions.querySelector('.assistant__gear'); if (gear) actions.insertBefore(wrap, gear); else actions.appendChild(wrap);

    const initial = get(UI_KEY, (get('assistant.lang','') || 'ru'));
    sel.value = /^(ru|uk|en)$/.test(initial) ? initial : 'ru';

    applyUiLang(sel.value, root);
    markLogArea(root);
    equalizeSettingsRows(root);
    setupOutsideClose(root);

    const rebalance = () => { markLogArea(root); equalizeSettingsRows(root); };
    window.addEventListener('resize', () => { clearTimeout(window.__as_eq_deb); window.__as_eq_deb = setTimeout(rebalance, 50); });
    setTimeout(rebalance, 100);

    sel.addEventListener('change', () => {
      const v = sel.value;
      set(UI_KEY, v);
      applyUiLang(v, root);
      equalizeSettingsRows(root);
      try { window.dispatchEvent(new StorageEvent('storage', { key:UI_KEY, newValue:v })); } catch {}
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
