'use strict';
/* The game introducing itself: the name and the boat, on the app's own first
   screen -- the one thing you see between tapping the icon and the chooser,
   before any server is running.

   The web pages do not show it. A page served over a network opens in a moment
   and has nothing to cover, and the front page is one you come back to over and
   over; an app has a cold start whether anybody wants one or not, and that is
   what a splash is for.

   It is a picture and a beat, and nothing else: no state, no socket, nothing
   the game reads back. It lives in public/ all the same, with the CSS that
   draws it in styles.css -- the chooser links the game's stylesheet already, so
   `url(art/boat.webp)` resolves against it and lands in the right place, and
   there is one home for the splash rather than a second copy in a page that
   sits outside the tree the tests can see.

   Call it from the top of the body, before the page is drawn. Later than that
   and the page shows itself first, which is the one thing a splash must not
   let happen. */
const Splash = (() => {
  /* play({ hold, ground })
       hold    how long it stands before it goes, in ms; the movement is over
               well before it
       ground  a colour to lie on, so it can begin on the one the phone drew
               behind it rather than on whatever the theme is
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

  return { play };
})();

if (typeof module !== 'undefined') module.exports = Splash;
