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
  const OWN_NAME_UP = 66;          // the heading over your own hand, above the fan
  const RING_PAD = { x: 11, top: 9, bot: 7 };   // the air inside the dealer's ring

  function nameAt(el, R, p, own, n, W, H) {
    const z = seatScale(n);
    const s = R.at(p);
    el.style.left = `calc(50% + ${own ? 0 : Math.round(s.x)}px)`;
    el.style.top = `calc(50% + ${own ? Math.round(fan(1, W, H).y - OWN_NAME_UP)
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

  /* The seat that deals, ringed where it sits. The round line used to name the
     dealer in words, which had to be read and then matched to a seat; the ring
     says it where the answer is wanted. It goes round what that seat has on the
     table -- its cards and the name under them -- and the word cuts the line at
     the top rather than sitting inside it, where the name already is.

     Your own seat is a fan across the bottom and a heading over it. A box round
     the fan would be most of the screen wide, would shrink with every card
     played, and would lie over the line a card is dragged across; a box round
     the heading alone crowded the hand. So your own seat gets the word and no
     outline -- the same mark, standing on the line a card is dragged over.

     The box is fixed to the round, not to what is left of the pile: a ring that
     followed the cards away would crawl all round the seat as they were played.

     Both the deal and the table it hands over to draw it, so it is placed here.
     Safe to ask again -- it is one element, moved. */
  function dealerRing(stage, o) {
    if (!stage) return null;
    let el = stage.querySelector('.dring');
    if (!el) {
      el = document.createElement('div');
      el.className = 'dring';
      const bx = document.createElement('div');
      bx.className = 'dring-box';
      const tg = document.createElement('div');
      tg.className = 'dring-tag';
      tg.textContent = 'dealer';
      el.append(bx, tg);
      // First on the stage: every card lies over it, whatever its z-index.
      stage.insertBefore(el, stage.firstChild);
    }
    el.classList.toggle('own', !!o.own);          // the word alone, with no box round it
    const b = dealerAt(o);
    el.style.left = `calc(50% + ${Math.round(b.x)}px)`;
    el.style.top = `calc(50% + ${Math.round(b.y)}px)`;
    el.style.width = `${Math.round(b.w)}px`;
    el.style.height = `${Math.round(b.h)}px`;
    el.style.marginLeft = `${-Math.round(b.w / 2)}px`;
    /* The line is broken for the word, not covered by it: the table behind is a
       gradient, so a patch of the table's colour would show as a patch. How wide
       to break it only the word knows, so it is measured and handed to the
       stylesheet. */
    const tag = el.querySelector('.dring-tag');
    el.style.setProperty('--dring-gap', `${((tag && tag.offsetWidth) || 46) + 13}px`);
    return el;
  }

  /* The line a card has to be dragged over to be played: clear of the fan, in
     the open ground between the hand and the middle of the table.

     It is also the top of the ring round the heading, when the deal is the
     reader's own. Both are gold and dashed, and a line running near the box
     rather than into it read as two marks that had missed each other, so they
     are one answer and meet exactly. */
  const playLine = (W, H) => fan(1, W, H).y - OWN_NAME_UP - RING_PAD.top;

  /* Where that ring is drawn, in offsets from the middle of the stage: `x` the
     middle of the box and `y` its top edge, the way a name is placed. */
  function dealerAt(o) {
    const { R, p, n, W, H } = o;
    const z = seatScale(n), c = cardSize(W);
    const padX = RING_PAD.x, padTop = RING_PAD.top, padBot = RING_PAD.bot;
    const nameW = (o.nameEl && o.nameEl.offsetWidth) || 0;
    if (o.own) {
      return { x: 0, y: playLine(W, H), w: Math.max(nameW, 104) + padX * 2,
               h: 16 + padTop + padBot };
    }
    const of = Math.max(1, o.of || 1);
    const F = fan(of, W, H);
    const a = pile(R, F, p, 0, n), b = pile(R, F, p, of - 1, n);
    /* A card in a pile is turned a little, which widens and deepens what it
       covers -- and the turn grows across the pile, so the two ends are not
       turned the same. Allowed for once, at the worst of the two, the box
       carried up to nine pixels of dead air at the straighter end, and the word
       centred on the box then read as pushed off the cards it stands over. Each
       end is allowed for on its own. */
    const wide = (d) => ((c.w * Math.cos(rad(Math.abs(d))) + c.h * Math.sin(rad(Math.abs(d)))) * z) / 2;
    const deep = (d) => ((c.h * Math.cos(rad(Math.abs(d))) + c.w * Math.sin(rad(Math.abs(d)))) * z) / 2;
    const s = R.at(p);
    /* The box is what it holds: the pile, and the name hanging under it. The
       name is centred on the seat and the pile is not quite, so both have a say
       in either edge. */
    const left = Math.min(a.x - wide(a.tilt), b.x - wide(b.tilt), s.x - nameW / 2) - padX;
    const right = Math.max(a.x + wide(a.tilt), b.x + wide(b.tilt), s.x + nameW / 2) + padX;
    const nameTop = s.y + c.h * z / 2 + 19;
    const nameH = Math.round((z < 0.9 ? Math.max(10, Math.round(13 * z)) : 14) * 1.3);
    const y = Math.min(a.y - deep(a.tilt), b.y - deep(b.tilt)) - padTop;
    return { x: (left + right) / 2, y, w: right - left,
             h: nameTop + nameH + padBot - y };
  }

  /* The row of bid numbers stands on a line above the fan, with its own
     heading above that. The felt draws them there and the fan is placed with
     room for them, so the two have to be one answer. Everything is measured up
     from the line the row stands on, which is 88 above the first card. */
  function bidRow(W) {
    const size = W <= 420 ? 40 : 44;
    // A number under the thumb grows and rises a little; this is how tall it
    // then stands, measured up from the line the row stands on.
    const up = size * 1.17 + 6;
    /* How high the row stands over the middle of the fan. It has the heading
       over the hand to clear, and -- when the reader is the one dealing -- the
       ring drawn round that heading and the word cutting the top of it. */
    const foot = 94;
    /* The heading hugs the row, the way the one over the hand hugs the fan. A
       number held up under a thumb rises into the leading under the heading's
       letters, and no further. */
    const head = Math.max(size + 9, up - 4);
    return { size, foot, up, head, tall: head + 15 };
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

  /* The card of the seat the table waits on tips up on its edge, shivers,
     settles, and waits -- once every three seconds -- so whose turn it is can
     be read from across the room. It is the one way a screen says "waiting
     on you": the deal gives it to the player to bid, the felt to the seat a
     bid or a card is wanted from. `at` is the transform the card lies at,
     and the peek ends back on it. The landing used the Web Animations API,
     and that owns the transform, so this has to be an animation too, not a
     CSS class. Nothing fills forwards: whoever placed the card still owns it.
     A repeating animation is drawn for its whole length, the two seconds in
     which the card lies still included, and a whole core went on the
     bidding; so the peek is the animation and the wait between peeks is a
     timer. Returns a handle with cancel(), or null when nothing can move. */
  function peek(card, at) {
    if (!card || !card.animate) return null;
    at = at || '';
    // Written in milliseconds, because that is how it is judged.
    const UP = 182, SHIVER_IN = 280, SHIVER_OUT = 784, SIDE = 84, DOWN_AT = 868, FLAT = 1050;
    const EVERY = 3000;
    const o = (ms) => Number((ms / FLAT).toFixed(4));
    const rest = 'drop-shadow(0 5px 9px rgba(0,0,0,.45)) drop-shadow(0 0 5px rgba(255,255,255,.22))';
    const up = 'drop-shadow(0 16px 18px rgba(0,0,0,.55)) drop-shadow(0 0 12px rgba(255,255,255,.4))';
    const tip = `${at} translateY(-11px) rotateX(-26deg)`.trim();
    const flat = at || 'none';

    // The transform rides on the card, but the shadow has to ride on the
    // faces: a filter on the card itself would flatten its 3D, and a card
    // lying face down would paint a blank front instead of its back. A flat
    // card with no faces of its own carries the shadow itself.
    const faces = Array.prototype.slice.call(card.querySelectorAll('.face'));
    const lit = faces.length ? faces : [card];
    const frames = [
      { transform: flat, offset: 0, easing: 'cubic-bezier(.3,.7,.35,1)' },
      { transform: tip, offset: o(UP), easing: 'linear' },
    ];
    const glow = [
      { filter: rest, offset: 0, easing: 'cubic-bezier(.3,.7,.35,1)' },
      { filter: up, offset: o(UP), easing: 'linear' },
    ];
    for (let ms = SHIVER_IN, i = 0; ms <= SHIVER_OUT; ms += SIDE, i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      frames.push({
        transform: `${tip} translateX(${dir * 3}px) rotate(${dir * 1.2}deg)`,
        offset: o(ms), easing: 'linear',
      });
    }
    frames.push({ transform: tip, offset: o(DOWN_AT), easing: 'cubic-bezier(.45,0,.55,1)' });
    frames.push({ transform: flat, offset: 1 });
    glow.push({ filter: up, offset: o(DOWN_AT), easing: 'cubic-bezier(.45,0,.55,1)' });
    glow.push({ filter: rest, offset: 1 });

    let set = [], timer = null, off = false;
    const drop = () => set.forEach((a) => { try { a.cancel(); } catch (e) {} });
    const once = () => {
      if (off) return;
      drop();
      set = [card.animate(frames, { duration: FLAT })];
      lit.forEach((f) => set.push(f.animate(glow, { duration: FLAT })));
      timer = setTimeout(once, EVERY);
    };
    once();
    return { cancel: () => { off = true; clearTimeout(timer); drop(); } };
  }

  /* A bid lands: the number slams down in gold onto that seat's card, holds,
     and lifts away; the card takes the hit and the name under it pops. The
     deal stamps the bids that land while it holds the stage, and the felt
     the ones that land after it. `at` is the transform the card lies at. */
  function stamp(stage, card, at, label, value) {
    if (!stage || !card || !at || !card.animate) return;
    // The pile lies face down, and a stamp that inherits its rotateY(180)
    // prints the number in a mirror. The stamp lies flat; the card stays as
    // it is.
    const flat = at.replace('rotateY(180deg)', 'rotateY(0deg)');

    const el = document.createElement('div');
    el.className = 'dstamp';
    el.textContent = String(value);
    stage.appendChild(el);
    const a = el.animate(
      [{ transform: `${flat} scale(2.7) rotate(-15deg)`, opacity: 0, offset: 0,
         easing: 'cubic-bezier(.2,.9,.3,1.5)' },
       { transform: `${flat} scale(.9) rotate(5deg)`, opacity: 1, offset: .16 },
       { transform: `${flat} scale(1.08) rotate(-1deg)`, opacity: 1, offset: .26 },
       { transform: `${flat} scale(1) rotate(0deg)`, opacity: 1, offset: .74 },
       { transform: `${flat} scale(1.6) rotate(0deg)`, opacity: 0, offset: 1 }],
      { duration: 1200, fill: 'both' });
    a.onfinish = () => el.remove();

    card.animate(
      [{ transform: at }, { transform: `${at} scale(1.13)`, offset: .3 },
       { transform: `${at} scale(.98)`, offset: .55 }, { transform: at }],
      { duration: 420, easing: 'cubic-bezier(.2,.9,.3,1.3)' });
    if (label && label.animate) {
      label.animate(
        [{ transform: 'translate(-50%,0) scale(1)' },
         { transform: 'translate(-50%,0) scale(1.22)', offset: .35 },
         { transform: 'translate(-50%,0) scale(1)' }],
        { duration: 420, easing: 'cubic-bezier(.2,.9,.3,1.3)' });
    }
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

  /* The round line across the top of the stage -- the caption and a status
     line under it. The deal builds it, and the felt builds it when there was
     no deal; a line placed two ways would jump at the handover, so it is
     placed here. `ringTop` is the top card's top edge, from the middle of the
     stage. Returns the parts, for the deal to animate. */
  function head(stage, o) {
    const box = document.createElement('div');
    box.className = 'deal-head';
    const cap = document.createElement('div');
    cap.className = 'deal-cap';
    cap.textContent = `Round ${o.round} · ${o.cards} card${o.cards === 1 ? '' : 's'}`;
    const status = document.createElement('div');
    status.className = 'deal-status';
    box.append(cap, status);
    stage.appendChild(box);
    band(box, o.ringTop);
    return { box, cap, status };
  }

  /* Where a toast comes up while a scene is on: the empty band between the
     round line and the top of the ring, which belongs to neither. The page
     chrome cannot work this out for itself -- only the stage knows where the
     ring begins -- so the head says, and the stylesheet reads it. Kept clear
     of the cards: a toast that reaches the ring covers the top player's pile,
     which is what put it here. Safe to ask again. */
  function band(box, ringTop) {
    // offsetTop, not a client rect: the line may already be carrying its
    // entry animation, and a transform would skew what a rect reports.
    const foot = box.offsetTop + box.getBoundingClientRect().height;
    const drop = Math.max(6, Math.round(Math.max(0, (ringTop || 0) - foot) * 0.30));
    const top = Math.round(Math.min(foot + drop, Math.max(foot + 6, (ringTop || 0) - 64)));
    document.body.classList.add('stage-head');
    document.body.style.setProperty('--stage-band', `${top}px`);
    return top;
  }

  /* The scene is down: a toast comes up under the top bar again, where it
     does on a page with no table on it. */
  function bandOff() {
    document.body.classList.remove('stage-head');
    document.body.style.removeProperty('--stage-band');
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

  return { S, faceOf, cardEl, tf, rad, fade, parts, head, band, bandOff, close, isOpen,
           ring, fan, pile, seatScale, cardSize, nameAt, dealerRing, playLine, bidRow, settle, peek, stamp };
})();
