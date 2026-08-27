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

  // A card from the server, 'TH' or '9S', as the face this stage draws: the
  // rank to print, and the suit's glyph and colour, read off the shared rules.
  // Null for anything that is not a card.
  function faceOf(card) {
    if (!card) return null;
    const s = SUITS_BY_KEY[Game.suitOf(card)];
    return s ? { r: Game.cardFace(card), s: { g: s.g, red: s.red } } : null;
  }
  const SUITS_BY_KEY = {};
  Game.SUITS.forEach((s) => { if (s.k !== 'NT') SUITS_BY_KEY[s.k] = s; });

  // Every card on this stage is placed the same way, so a move only has to say
  // what changed: where it sits, how it lies, which way up, how big.
  const tf = (x, y, tilt, face, sc) =>
    `translate3d(${x}px,${y}px,0) rotate(${tilt}deg) rotateY(${face}deg) scale(${sc})`;

  const rad = (deg) => deg * Math.PI / 180;

  /* ---------- where things sit ----------

     The deal places the seats and the fan, and then the table lives on in the
     same places for the rest of the round. Two answers to the same question
     would drift, and the handover from one to the other would jump, so the
     question is asked here.
  */

  /* The seats, round an ellipse. `anchor` sits at the bottom, nearest the
     player watching, and the rest follow round from there. */
  function ring(n, anchor, W, H) {
    const rx = Math.min(W * 0.33, 250);
    // A wider screen gives the ring more room, so the piles stand clear of the
    // round line above and the turned card in the middle. A phone has none to
    // spare, so it keeps the tighter ring.
    const ry = Math.min(H * 0.27, W < 560 ? 160 : 192);
    const at = (p) => {
      const a = (Math.PI / 2) + ((((p - anchor) % n) + n) % n) * 2 * Math.PI / n;
      return { x: Math.cos(a) * rx, y: Math.sin(a) * ry };
    };
    return { rx, ry, at };
  }

  /* A hand is a fan, not a row. Each card steps a fixed distance along from the
     one before -- far enough to read the corner, near enough to still overlap --
     and turns a fixed amount further round. A step worked out by dividing a
     width between the cards does the opposite of a fan: the fewer the cards, the
     farther apart they land, and two cards end up at opposite edges of the
     screen.

     The fan tightens instead as the hand grows, and never grows past the room it
     is given. `at(i)` answers in offsets from the middle of the fan, so a caller
     can hang it off a seat.  */
  function fan(count, W, H) {
    const cardW = W <= 420 ? 52 : 64;             // .dcard, and its narrow rule
    // The hand sits below the ring, not in it: at a full table the seats either
    // side reach down far enough to clip a fan left at seat height.
    const y = Math.min(H * 0.34, 240);
    const room = Math.min(W * 0.86, 340);
    const step = count > 1 ? Math.min(cardW * 0.62, (room - cardW) / (count - 1)) : 0;
    // The whole fan turns through 34 degrees at most, however many cards are in
    // it, or the end cards of a long hand lie on their sides.
    const tilt = count > 1 ? Math.min(6.5, 34 / (count - 1)) : 0;
    // Turning about a point below the fan is what gives it its dome: the farther
    // a card is from the middle, the lower it sits. This is the point that fits
    // that step to that turn.
    const pivot = tilt ? step / Math.sin(rad(tilt)) : 0;
    const off = (i) => (count > 1 ? i - (count - 1) / 2 : 0);
    const at = (i) => {
      const o = off(i);
      return { x: o * step, y: y + pivot * (1 - Math.cos(rad(o * tilt))), tilt: o * tilt };
    };
    return { count, cardW, y, room, step, tilt, pivot, off, at };
  }

  /* A card keeps its resting place as an inline transform, and never more than
     one live animation. Stacking them makes Chrome give up preserve-3d, and a
     card lying face down then paints a blank front instead of its back. The deal
     lasts seconds and gets away with a few; the table lasts a whole round and
     does not. */
  function settle(anim) {
    if (!anim) return;
    try { anim.commitStyles(); } catch (e) {}
    try { anim.cancel(); } catch (e) {}
  }

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

  /* The round line across the top of the stage -- the caption, a status line
     under it, and the trump line, which drops most of the way down the empty
     band between the line and the top of the ring so it belongs to neither.
     The deal builds it, and the felt builds it when there was no deal; a
     line placed two ways would jump at the handover, so it is placed here.
     `ringTop` is the top card's top edge, from the middle of the stage.
     Returns the parts, for the deal to animate. */
  function head(stage, o) {
    const box = document.createElement('div');
    box.className = 'deal-head';
    const cap = document.createElement('div');
    cap.className = 'deal-cap';
    cap.textContent = `Round ${o.round} · ${o.cards} card${o.cards === 1 ? '' : 's'} · ${o.dealer} deals`;
    const status = document.createElement('div');
    status.className = 'deal-status';
    const tag = document.createElement('div');
    tag.className = 'deal-tag';
    tag.textContent = o.tag || '';
    box.append(cap, status, tag);
    stage.appendChild(box);
    // Measured from the free space below the line, so a screen with a narrow
    // band moves it a little and never pushes it into the cards. offsetTop,
    // not a client rect: the line may already be carrying its entry
    // animation, and a transform would skew what a rect reports.
    const foot = box.offsetTop + tag.offsetTop + tag.getBoundingClientRect().height;
    tag.style.marginTop = `${Math.max(6, Math.round((o.ringTop - foot) * 0.45))}px`;
    return { box, cap, status, tag };
  }

  // What the trump line says of a suit, or of no trumps at all.
  function trumpLine(k) {
    const su = Game.SUITS.find((x) => x.k === k && x.k !== 'NT');
    return su ? `${su.name} are trumps` : 'No trumps';
  }

  // The overlay and what stands on it: the stage the cards are placed on and
  // the "tap to skip" line. Nobody else asks the overlay for its parts by
  // name. With `make` false it only looks: a felt being taken down must not
  // build an overlay to take it down from. Null then, when there is none.
  function parts(make) {
    const overlay = make === false ? document.getElementById('deal') : overlayEl();
    if (!overlay) return null;
    return { overlay, stage: overlay.querySelector('.deal-stage'), skip: overlay.querySelector('.deal-skip') };
  }

  // Shuts whichever scene is open, or only that kind of scene.
  function close(kind) { if (S.live && (!kind || S.live.kind === kind)) S.live.finish(); }
  const isOpen = (kind) => !!S.live && (!kind || S.live.kind === kind);

  return { S, faceOf, cardEl, tf, rad, fade, parts, head, trumpLine, close, isOpen, ring, fan, settle };
})();
