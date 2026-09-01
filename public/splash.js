'use strict';
/* The game introducing itself: the name and the boat, on the two screens that
   are doors into it -- the front page in a browser, and the app's own first
   screen before any server is running.

   It is a picture and a beat, and nothing else: no state, no socket, nothing
   the game reads back. So it lives in one small file that either door may load,
   and the CSS that draws it is in styles.css with everything else, which is
   also how the chooser gets it -- that page links the game's stylesheet, so
   `url(art/boat.webp)` resolves against the stylesheet and lands in the same
   place from both.

   Call it from the top of the body, before the page is drawn. Later than that
   and the page shows itself first, which is the one thing a splash must not
   let happen. */
const Splash = (() => {
  // One a session on a page that is come back to. The app's own screen asks
  // for it by hand instead, because opening the app IS the once.
  const KEY = 'river-card-score:splashed:v1';

  // Off the window rather than bare, so a screen without one -- and a check
  // standing in for a browser -- can say what it has.
  const store = () => (window && window.sessionStorage) || null;
  const seen = () => {
    try { const s = store(); return !!(s && s.getItem(KEY)); } catch (e) { return false; }
  };
  const mark = () => {
    try { const s = store(); if (s) s.setItem(KEY, '1'); } catch (e) {}
  };

  /* play({ once, hold, ground })
       once    only the first time this session -- for a page that is returned to
       hold    how long it stands before it goes, in ms; the movement is over
               well before it
       ground  a colour to lie on, where the page behind is not the right one:
               the app's screen matches the splash the phone drew before it
     Returns whether anything was shown, so a caller can tell.

     The animations setting is obeyed: off means there is no splash at all,
     because a splash is nothing but animation. Short plays it at about half. */
  function play(opts) {
    const o = opts || {};
    // `typeof` and not `window.UI`: a classic script's top-level const is a
    // binding in the shared scope, not a property of the window, so asking the
    // window would always say no -- and quietly take the other branch.
    const motion = (typeof UI !== 'undefined' && UI.motion) ? UI.motion() : 'full';
    if (motion === 'off') return false;
    if (o.once) {
      if (seen()) return false;
      mark();
    }

    const el = document.createElement('div');
    el.id = 'splash';
    if (motion === 'reduced') el.className = 'short';
    if (o.ground) el.style.background = o.ground;
    el.setAttribute('aria-hidden', 'true');
    ['sp-glow', 'sp-title', 'sp-boat'].forEach((c) => {
      const bit = document.createElement('span');
      bit.className = c;
      el.appendChild(bit);
    });
    document.body.appendChild(el);

    let going = false;
    const go = () => {
      if (going) return;
      going = true;
      el.classList.add('gone');
      // The transition is what takes it away; the timer is in case a browser
      // never says the transition ended, which happens on a hidden tab.
      const off = () => { if (el.parentNode) el.remove(); };
      el.addEventListener('transitionend', off, { once: true });
      window.setTimeout(off, 900);
    };
    // A tap takes it away early. Nobody should have to sit through this twice.
    el.addEventListener('click', go);
    el.addEventListener('touchstart', go, { passive: true });
    const hold = Number(o.hold) || 1750;
    window.setTimeout(go, motion === 'reduced' ? hold * .55 : hold);
    return true;
  }

  return { play, KEY };
})();

if (typeof module !== 'undefined') module.exports = Splash;
