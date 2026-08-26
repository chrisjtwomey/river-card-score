'use strict';
/* The stage both scenes are played on.

   One scene at a time: the deal, or the accolade finale. They share the
   overlay, the card element, the fade, and the reader's motion setting -- and
   they share the slot that says which scene is open, because opening one must
   close the other. That slot is a field on a held object, so both files see
   the same one.
*/
const Stage = (function () {
  const S = { live: null };        // the scene on screen, while it is held open

  const KEY_MOTION = 'river-card-score:motion:v1';
  const FACES = [{ g: '♠', red: false }, { g: '♥', red: true }, { g: '♦', red: true }, { g: '♣', red: false }];

  // 'full' | 'reduced' | 'off'.  ?motion=full in the URL wins and is remembered.
  function mode() {
    let saved = null;
    try { saved = localStorage.getItem(KEY_MOTION); } catch (e) {}
    const q = new URLSearchParams(window.location.search).get('motion');
    if (q === 'full' || q === 'reduced' || q === 'off') {
      saved = q;
      try { localStorage.setItem(KEY_MOTION, q); } catch (e) {}
    }
    if (saved) return saved;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return reduce ? 'reduced' : 'full';
  }

  // A card from the server, 'TH' or '9S', turned into a face this scene can
  // draw. Deal.js stands alone -- the offline tracker has no game.js -- so it
  // reads the card itself.
  const SUIT_OF = { S: FACES[0], H: FACES[1], D: FACES[2], C: FACES[3] };
  const SUIT_NAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
  function faceOf(card) {
    const c = String(card || '');
    const s = SUIT_OF[c.slice(-1)];
    if (!s) return null;
    const r = c.slice(0, -1);
    return { r: r === 'T' ? '10' : r, s };
  }

  // Every card on this stage is placed the same way, so a move only has to say
  // what changed: where it sits, how it lies, which way up, how big.
  const tf = (x, y, tilt, face, sc) =>
    `translate3d(${x}px,${y}px,0) rotate(${tilt}deg) rotateY(${face}deg) scale(${sc})`;

  /* `av` is a player's picture. It goes on the back, which carries its own
     rotateY(180deg) and so faces the room the right way up when the card is
     lying face down. Nothing else about the card changes. */
  function cardEl(face, cls, av) {
    const el = document.createElement('div');
    el.className = 'dcard' + (cls ? ' ' + cls : '');
    const front = document.createElement('div');
    front.className = 'face front' + (face && face.s.red ? ' red' : '');
    if (face) {
      front.innerHTML = '<span class="r"></span><span class="big"></span>';
      front.querySelector('.r').textContent = face.r;
      front.querySelector('.big').textContent = face.s.g;
    }
    const back = document.createElement('div');
    back.className = 'face back' + (av ? ' av' : '');
    if (av) back.style.backgroundImage = `url("${av}")`;
    el.append(front, back);
    return el;
  }

  /* Fading a card is not free: an animated opacity makes the browser give up
     `transform-style: preserve-3d`, and a card lying face down then paints a
     blank front instead of its back. So a card only ever moves, and the two
     faces do the fading. */
  function fade(card, frames, opts, into) {
    const made = [];
    Array.prototype.forEach.call(card.querySelectorAll('.face'), (f) => {
      const a = f.animate(frames, opts);
      if (into) into.push(a);
      made.push(a);
    });
    return made;
  }

  function overlayEl() {
    let el = document.getElementById('deal');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'deal';
    el.className = 'deal';
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="deal-stage" id="deal-stage"></div><div class="deal-skip">tap to skip</div>';
    document.body.appendChild(el);
    return el;
  }

  // Shuts whichever scene is open, or only that kind of scene.
  function close(kind) { if (S.live && (!kind || S.live.kind === kind)) S.live.finish(); }
  const isOpen = (kind) => !!S.live && (!kind || S.live.kind === kind);

  // SUIT_OF and SUIT_NAME go out with the rest: with real cards the deal
  // knows only the suit the dealer turned, and has to draw and name it
  // without a card to read it off.
  return { S, mode, faceOf, cardEl, tf, fade, overlayEl, close, isOpen, SUIT_OF, SUIT_NAME };
})();
