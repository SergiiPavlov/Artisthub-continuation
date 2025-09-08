// src/js/features/player-patch.js (compat v2.1)
// Мост ассистента <-> плеера. Совместим с default-экспортом и с createMiniPlayer().
// Слушает assistant:* и на window, и на document. Диспетч тоже в обе стороны.

import * as PlayerMod from './player.js';
const Player = PlayerMod.default
  || (typeof PlayerMod.createMiniPlayer === 'function' ? PlayerMod.createMiniPlayer() : PlayerMod);

function dispatchAssistant(name, payload = {}) {
  const evInit = { detail: payload, bubbles: true, composed: true };
  window.dispatchEvent(new CustomEvent(`assistant:${name}`, evInit));
  document.dispatchEvent(new CustomEvent(`assistant:${name}`, evInit));
}

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

// Seeds for mixradio (fallback if app has no internal pool)
const MIX_SEEDS = [
  'random music mix',
  'popular hits playlist',
  'indie rock mix',
  'classic rock hits',
  'lofi chill beats to relax',
  'jazz essentials playlist',
  'hip hop classic mix',
  'ambient focus music long'
];

export function handleAssistantAction(a) {
  if (!a || typeof a !== 'object') return;

  switch (a.type) {
    case 'play': {
      // Prefer id, else query via search playlist
      if (a.id) {
        dispatchAssistant('play', { id: a.id, query: a.query || '' });
        if (typeof Player.open === 'function') Player.open(String(a.id));
        else if (typeof Player.play === 'function') Player.play(String(a.id));
      } else if (a.query) {
        dispatchAssistant('play', { id: '', query: String(a.query) });
        if (typeof Player.playSearch === 'function') Player.playSearch(String(a.query));
        else {
          // мягкий фоллбек: если нет playSearch, просто эмитим событие — его может подхватить другой модуль
          dispatchAssistant('play-search-missing', { query: String(a.query) });
        }
      }
      break;
    }
    case 'recommend': {
      // Backward compatibility: some servers may still send recommend + autoplay
      const wantAuto = a.autoplay === true;
      if (wantAuto) {
        let q = '';
        if (a.like) q = `${a.like} official audio`;
        else if (a.genre) {
          const map = new Map([
            ['джаз', 'best jazz music relaxing'],
            ['рок', 'classic rock hits'],
            ['поп', 'pop hits playlist'],
            ['электрон', 'edm house techno mix'],
            ['lofi', 'lofi hip hop radio'],
            ['классик', 'classical symphony playlist'],
            ['рэп', 'hip hop playlist'],
            ['инди', 'indie rock playlist'],
            ['ambient', 'ambient music long playlist'],
            ['блюз', 'best blues songs playlist'],
            ['шансон', 'russian chanson mix'],
            ['folk', 'folk acoustic playlist'],
            ['rnb', 'rnb soul classics playlist'],
            ['latin', 'latin hits playlist'],
            ['reggae', 'best reggae mix'],
            ['k-pop', 'kpop hits playlist'],
            ['j-pop', 'jpop hits playlist'],
            ['soundtrack', 'movie soundtrack playlist'],
          ]);
          q = map.get(String(a.genre).toLowerCase()) || `${a.genre} music playlist`;
        } else if (a.mood) {
          const moods = new Map([
            ['happy','upbeat feel good hits'],
            ['calm','lofi chill beats to relax'],
            ['sad','sad emotional songs playlist'],
            ['energetic','high energy workout rock mix'],
          ]);
          q = moods.get(String(a.mood).toLowerCase()) || 'music playlist';
        }
        if (q) {
          dispatchAssistant('recommend', { ...a, query: q });
          if (typeof Player.playSearch === 'function') Player.playSearch(q);
          else dispatchAssistant('play-search-missing', { query: q });
        }
      } else {
        // just emit event for UI
        dispatchAssistant('recommend', { ...a });
      }
      break;
    }
    case 'mixradio': {
      const rand = MIX_SEEDS[Math.floor(Math.random()*MIX_SEEDS.length)];
      dispatchAssistant('mixradio', { query: rand });
      if (typeof Player.playSearch === 'function') Player.playSearch(rand);
      else dispatchAssistant('play-search-missing', { query: rand });
      break;
    }
    case 'player': {
      const act = String(a.action || '').toLowerCase();
      dispatchAssistant(`player-${act}`, {});
      if (act === 'play'  && typeof Player.play  === 'function') Player.play();
      if (act === 'pause' && typeof Player.pause === 'function') Player.pause();
      if (act === 'stop'  && typeof Player.stop  === 'function') Player.stop();
      if (act === 'next'  && typeof Player.next  === 'function') Player.next();
      if (act === 'prev'  && typeof Player.prev  === 'function') Player.prev();
      break;
    }
    case 'volume': {
      const d = Number(a.delta || 0);
      dispatchAssistant('volume', { delta: d });
      if (typeof Player.setVolume === 'function') Player.setVolume(clamp(d, -1, 1));
      break;
    }
    case 'ui': {
      const act = String(a.action || '').toLowerCase();
      if (act === 'minimize') {
        dispatchAssistant('minimize', {});
        if (typeof Player.minimize === 'function') Player.minimize();
      } else if (act === 'expand') {
        dispatchAssistant('expand', {});
        if (typeof Player.expand === 'function') Player.expand();
      }
      break;
    }
    default:
      // unknown action type — ignore silently
      break;
  }
}

// Listen legacy assistant:* events from UI and control the player (backward compatibility)
function on(target, type, fn) { target.addEventListener(type, fn); }

on(window,   'assistant:play',  (e)=> { const {id, query} = e.detail || {}; id ? (Player.open?.(id) || Player.play?.(id)) : (query && Player.playSearch?.(query)); });
on(document, 'assistant:play',  (e)=> { const {id, query} = e.detail || {}; id ? (Player.open?.(id) || Player.play?.(id)) : (query && Player.playSearch?.(query)); });

on(window,   'assistant:mixradio', ()=> { const q = MIX_SEEDS[Math.floor(Math.random()*MIX_SEEDS.length)]; Player.playSearch?.(q); });
on(document, 'assistant:mixradio', ()=> { const q = MIX_SEEDS[Math.floor(Math.random()*MIX_SEEDS.length)]; Player.playSearch?.(q); });

on(window,   'assistant:player-play',  ()=> Player.play?.());
on(document, 'assistant:player-play',  ()=> Player.play?.());
on(window,   'assistant:player-pause', ()=> Player.pause?.());
on(document, 'assistant:player-pause', ()=> Player.pause?.());
on(window,   'assistant:player-stop',  ()=> Player.stop?.());
on(document, 'assistant:player-stop',  ()=> Player.stop?.());
on(window,   'assistant:player-next',  ()=> Player.next?.());
on(document, 'assistant:player-next',  ()=> Player.next?.());
on(window,   'assistant:player-prev',  ()=> Player.prev?.());
on(document, 'assistant:player-prev',  ()=> Player.prev?.());

on(window,   'assistant:minimize',     ()=> Player.minimize?.());
on(document, 'assistant:minimize',     ()=> Player.minimize?.());
on(window,   'assistant:expand',       ()=> Player.expand?.());
on(document, 'assistant:expand',       ()=> Player.expand?.());

export default { handleAssistantAction };
