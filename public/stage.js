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
     player watching, and the rest follow round from there.

     `cy` is the middle of the table, and everything on it -- the seats, the
     card the deck turned, the trick -- hangs off that and not off the middle
     of the screen. The reader's own hand takes the foot of the screen, and
     takes more room there than the round line takes at the head, so the table
     sits a little above the middle: it has to be in the middle of the band
     between those two, which is not the middle of the screen. */
  // How deep the ring is. A wider screen gives it more room, so the piles stand
  // clear of the round line above and the turned card in the middle; a phone
  // has none to spare and keeps the tighter ring. The fan below asks this too.
  const ringRy = (W, H) => Math.min(H * 0.27, W < 560 ? 160 : 192);
  // And how far above the middle of the screen it sits. The fan below asks
  // this too, to know what room is left under the table.
  const ringCy = (H) => -Math.round(Math.min(H * 0.035, 30));

  function ring(n, anchor, W, H) {
    const rx = Math.min(W * 0.33, 250);
    const ry = ringRy(W, H);
    const cy = ringCy(H);
    const at = (p) => {
      const a = (Math.PI / 2) + ((((p - anchor) % n) + n) % n) * 2 * Math.PI / n;
      return { x: Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
    };
    return { rx, ry, cy, at };
  }

  /* How big a card is drawn, which the stylesheet's narrow rule says too. One
     question, so a layout worked out here and a card drawn there agree. */
  const cardSize = (W) => (W <= 420 ? { w: 52, h: 74 } : { w: 64, h: 90 });

  /* How big a seat's furniture is drawn. Eight piles at full size do not go
     round a phone: they run into their neighbours, into the names under them,
     and into the row of bid numbers. A table of many comes down in size, and
     a table of few is left alone. */
  const seatScale = (n) => Math.max(0.55, Math.min(1, 5.4 / Math.max(1, n)));

  /* What a pile is called, written under it and hugging it: a name held a
     fixed way down would be reaching into the seat below on a table of eight.
     The reader's own cards are named above their fan instead. Both the deal
     and the table it hands over to write these, so the answer is here. */
  function nameAt(el, R, p, own, n, W, H) {
    const z = seatScale(n);
    const s = R.at(p);
    el.style.left = `calc(50% + ${own ? 0 : Math.round(s.x)}px)`;
    el.style.top = `calc(50% + ${own ? Math.round(fan(1, W, H).y - 76)
                                    : Math.round(s.y + cardSize(W).h * z / 2 + 19)}px)`;
    if (!own) el.style.fontSize = z < 0.9 ? `${Math.max(10, Math.round(13 * z))}px` : '';
  }

  /* A seat's pile: where the kth card of `of` lies. The deal puts it there and
     the table it hands over to keeps it there, so the question is asked once
     -- two answers would drift, and the handover would jump. */
  function pile(R, F, p, k, n) {
    const s = R.at(p);
    const z = seatScale(n);
    const off = F.off(k);
    return { x: s.x + off * 4.5 * z, y: s.y - k * 1.6 * z,
             tilt: (s.x / (R.rx || 1)) * 9 + off * 2.2, z };
  }

  /* The row of bid numbers stands on a line above the fan, with its own
     heading above that. The felt draws them there and the fan is placed with
     room for them, so the two have to be one answer. Everything is measured up
     from the line the row stands on, which is 88 above the first card. */
  function bidRow(W) {
    const size = W <= 420 ? 40 : 44;
    const up = size * 1.34;             // a number under the thumb stands this tall
    const head = up + 14;               // its heading sits clear of one
    return { size, foot: 88, up, head, tall: head + 15 };
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
    const cardW = cardSize(W).w;
    /* Where the fan lies. Between the seats either side of the reader and the
       line along the bottom of the screen there is a band, and what stands in
       that band is the hand, the heading that names it and -- while the
       bidding is on -- the row of numbers with its own heading. All of that
       goes in the middle of the band, and never so low that the outer cards of
       the fan reach the line along the bottom.

       The band is measured for a full table, so the hand keeps its place
       whoever is at the table: a seat arriving must not move the reader's own
       cards. */
    const card = cardSize(W);
    // A full table's neighbours sit a quarter turn round the ring, at the size
    // a full table draws them, with their names hung under them.
    const bandTop = ringCy(H) + ringRy(W, H) * Math.cos(Math.PI / 4)
                  + card.h * seatScale(8) / 2 + 36;
    const bandBottom = H / 2 - 76;               // the line along the bottom of the screen
    const above = bidRow(W).foot + bidRow(W).tall;   // the block, from the fan's middle up
    const below = card.h / 2 + 12;                   // and down past its lowest card
    const want = (bandTop + bandBottom) / 2 + (above - below) / 2;
    const y = Math.min(want, bandBottom - below);
    // A short screen has less band than block: it is pressed against the line
    // along the bottom, and the numbers reach the piles either side.
    const pressed = y < want;
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
    return { count, cardW, y, room, step, tilt, pivot, off, at, pressed };
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
    dropTag(box, o.ringTop, o.reserve);
    return { box, cap, status, tag };
  }

  /* The trump line drops most of the way down the empty band between the round
     line and the top of the ring, so it belongs to neither. `reserve` is room
     kept below it: the table parks the card the deck turned there, and the
     line has to leave space for it. Answers where the line now ends, so the
     caller can hang something off it. Safe to ask again. */
  function dropTag(box, ringTop, reserve) {
    const tag = box && box.querySelector('.deal-tag');
    if (!tag) return 0;
    tag.style.marginTop = '0px';
    // Measured from the free space below the line, so a screen with a narrow
    // band moves it a little and never pushes it into the cards. offsetTop,
    // not a client rect: the line may already be carrying its entry
    // animation, and a transform would skew what a rect reports.
    const foot = box.offsetTop + tag.offsetTop + tag.getBoundingClientRect().height;
    const drop = Math.max(6, Math.round(Math.max(0, ringTop - (reserve || 0) - foot) * 0.45));
    tag.style.marginTop = `${drop}px`;
    return foot + drop;
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

  return { S, faceOf, cardEl, tf, rad, fade, parts, head, dropTag, trumpLine, close, isOpen,
           ring, fan, pile, seatScale, cardSize, nameAt, bidRow, settle };
})();
