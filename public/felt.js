'use strict';
/* The table, and the whole round played on it.

   The deal used to be a flourish: a card flew to each seat, your hand landed
   in a fan, and two seconds later the lot was thrown away and the same hand
   was drawn again as a row of flat buttons on the page. This is the other way
   round. The deal is the first move of the round and the felt it lands on is
   the screen you play on: your hand is the fan you were dealt, the card the
   deck turned stays in the middle, and the cards you play go on top of it.

   A card is picked up by touching it, and a thumb run along the fan picks up
   each card in turn -- the way a hand of real cards is read. A card is played
   by pushing it up out of the fan. A card that may not be played says so and
   will not go.

   The page underneath keeps everything else -- the round bar, the bids, the
   standings, the scorecard -- and the button in the corner drops the felt away
   to reach it.

   Nothing here decides anything. The rules live on the server, which is what
   stops a phone from reneging; every card, bid and trick in here came out of
   the state, and every move goes back as a message.

   How a card moves: the transform on the style is where the card belongs, and
   a CSS transition carries it there. Nothing on this table is animated with
   the Web Animations API. A round lasts minutes, and a card that collects
   animations loses its third dimension -- the back stops facing the room and a
   blank front is painted instead. A style and a transition cannot pile up, and
   a move interrupted half way carries on from where the card actually is.
*/
const Felt = (function () {
  const { cardEl, tf, faceOf, overlayEl } = Stage;

  const LIFT = 52;              // how far a card comes up out of the fan
  const BIG = 1.3;              // and how much bigger it gets while it is up
  const DEAD = 16;              // a push this far up means it is being played
  const GRAB = 30;              // and the card rides this far above the thumb
  const PUSH = 18;              // how far a played card sits toward its player

  let ST = null, me = -1, send = null, watch = false;
  let key = null;                  // the round on the table: `idx:redeals`
  let dealing = false;             // a deal is in the air; the table is its own
  let dealtOnce = false;           // the first deal of a game is the long one
  let want = true;                 // the reader wants the felt, not the page
  let T = null;                    // the table: every element standing on it
  let onView = null;               // the page, told when the felt comes and goes
  let held = -1;                   // the card in the reader's fingers, or none
  let drag = null;                 // the gesture in progress
  let sent = null;                 // a card played, until the table says so

  const virtual = () => !!(ST && ST.cfg && ST.cfg.deck === 'virtual');
  const round = () => (ST && ST.rounds ? ST.rounds[ST.idx] || null : null);
  const still = () => Stage.mode() === 'off';
  const suitName = (k) => {
    const s = Game.SUITS.find((x) => x.k === k);
    return s ? s.name.toLowerCase() : 'the suit led';
  };
  // What is in your hand as far as the table is concerned: a card already sent
  // is gone, whatever the last state still says.
  const myHand = () => (ST.hand || []).filter((c) => c !== sent);
  const ledSuit = () => {
    const p = ST.play;
    return p && p.trick.length ? Game.suitOf(p.trick[0].card) : null;
  };

  /* ---------------- the overlay, and the way out of it ---------------- */

  // The felt borrows the stage every scene uses, and marks it: a table is not
  // tapped away, so the "tap to skip" line and the pointer cursor go, and the
  // browser must not take the gestures for scrolling.
  function mount() {
    const overlay = overlayEl();
    overlay.classList.add('table');
    overlay.classList.toggle('still', still());
    if (!overlay.querySelector('.felt-out')) {
      const out = document.createElement('button');
      out.className = 'felt-out';
      out.type = 'button';
      out.title = 'The round, the bids and the scorecard';
      out.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true">'
        + '<rect x="2.5" y="3" width="15" height="14" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/>'
        + '<path d="M2.5 7.5h15M8 7.5V17M2.5 12h15" stroke="currentColor" stroke-width="1.3" fill="none"/>'
        + '</svg><span>Scorecard</span>';
      out.addEventListener('click', (e) => { e.stopPropagation(); hide(); });
      overlay.appendChild(out);
    }
    if (!overlay.querySelector('.felt-hint')) {
      const hint = document.createElement('p');
      hint.className = 'felt-hint';
      overlay.appendChild(hint);
    }
    if (!overlay.querySelector('.felt-line')) {
      const line = document.createElement('div');
      line.className = 'felt-line';
      overlay.appendChild(line);
    }
    wire(overlay);
    return { overlay, stage: overlay.querySelector('.deal-stage') };
  }

  function unmount() {
    const overlay = document.getElementById('deal');
    if (!overlay) return;
    overlay.classList.remove('table', 'still', 'dragging');
    ['.felt-out', '.felt-hint', '.felt-line'].forEach((s) => {
      const el = overlay.querySelector(s);
      if (el) el.remove();
    });
    held = -1; drag = null; sent = null;
  }

  /* ---------------- where everything sits ---------------- */

  /* The same two answers the deal used, asked again: the fan closes up as the
     hand is played, so it is asked on every change and not kept. */
  function geom() {
    const overlay = overlayEl();
    const W = overlay.clientWidth, H = overlay.clientHeight;
    const n = ST.seats.length;
    const R = Stage.ring(n, Math.max(0, me), W, H);
    const F = Stage.fan(Math.max(1, myHand().length), W, H);
    return { W, H, n, R, F, seat: R.at(Math.max(0, me)),
             cw: W <= 420 ? 52 : 64, ch: W <= 420 ? 74 : 90 };
  }

  // A pile lies where the deal left it: the seat's spot, stepped along and
  // stacked a little for each card in it. `of` is how many cards were dealt,
  // which is what set the step.
  function pileAt(g, p, k, of) {
    const s = g.R.at(p);
    const off = Stage.fan(of, g.W, g.H).off(k);
    return tf(s.x + off * 4.5, s.y - k * 1.6,
              (s.x / (g.R.rx || 1)) * 9 + off * 2.2, 180, 1);
  }

  // Your own hand: the fan, hung off your seat's spot exactly as the deal hung
  // it, so nothing jumps at the handover. `up` lifts the card out of it.
  function handAt(g, i, up) {
    const spot = g.F.at(i);
    const tilt = (g.seat.x / (g.R.rx || 1)) * 9 + spot.tilt;
    return up
      ? tf(g.seat.x + spot.x, spot.y - LIFT, tilt * 0.35, 0, BIG)
      : tf(g.seat.x + spot.x, spot.y, tilt, 0, 1);
  }

  /* A card played lies on the one the deck turned, pushed a little toward
     whoever played it, so a glance says whose it is and a tap can separate
     them. */
  function trickAt(g, p) {
    const s = g.R.at(p);
    const len = Math.max(1, Math.sqrt(s.x * s.x + s.y * s.y));
    return tf(s.x / len * PUSH, -10 + s.y / len * PUSH,
              (s.x / (g.R.rx || 1)) * 12, 0, 1);
  }

  function nameAt(el, g, p, own) {
    const s = g.R.at(p);
    el.style.left = `calc(50% + ${own ? 0 : s.x}px)`;
    el.style.top = `calc(50% + ${own ? Stage.fan(1, g.W, g.H).y - 76 : s.y + 56}px)`;
  }

  /* ---------------- cards ---------------- */

  // A card face down, turned over to show what it is. The pile a seat plays
  // from is real: the card that lands in the middle is the one that was on top
  // of their pile, turned up.
  function faceInto(el, card) {
    const f = faceOf(card);
    const front = el.querySelector('.front');
    if (!front || !f) return;
    front.classList.toggle('red', !!f.s.red);
    front.innerHTML = '<span class="r"></span><span class="big"></span>';
    front.querySelector('.r').textContent = f.r;
    front.querySelector('.big').textContent = f.s.g;
  }

  /* Taking a card over from the deal: where it belongs becomes a style, and
     every animation on it is let go. An animation that fills forwards outranks
     the style, so until it goes the card cannot be moved at all. */
  function own(el, to) {
    el.style.transform = to;
    if (el.getAnimations) {
      el.getAnimations().forEach((a) => { try { a.cancel(); } catch (e) {} });
    }
    (el.querySelectorAll ? el.querySelectorAll('.face') : []).forEach((f) => {
      f.style.opacity = '';
      if (f.getAnimations) f.getAnimations().forEach((a) => { try { a.cancel(); } catch (e) {} });
    });
  }

  const at = (el, to) => { el.style.transform = to; };

  /* ---------------- building it ---------------- */

  // A hand, a pile per seat, the turned card, a name under each pile: the deal
  // leaves exactly this standing, and a phone that arrives in the middle of a
  // round has to draw it without one.
  function build(r) {
    const { stage } = mount();
    stage.innerHTML = '';
    const p = ST.play;
    T = { stage, piles: [], labels: [], hero: null, hand: new Map(), table: new Map(), slots: [] };
    held = -1; drag = null;

    const g0 = geom();
    for (let q = 0; q < g0.n; q++) {
      T.piles[q] = [];
      if (q === me) continue;
      const held0 = p.counts ? (p.counts[q] || 0) : r.cards;
      for (let k = 0; k < held0; k++) {
        const el = cardEl(null, '', k === held0 - 1 ? Avatar.url(ST.code, ST.seats[q]) : null);
        stage.appendChild(el);
        T.piles[q].push(el);
      }
    }

    // Your own cards are a fan, face up, and yours alone: the server sends the
    // hand only to the socket that holds it.
    myHand().forEach((c) => {
      const el = cardEl(faceOf(c), 'mine');
      stage.appendChild(el);
      T.hand.set(c, el);
    });

    const hero = cardEl(faceOf(p.upcard), 'hero');
    stage.appendChild(hero);
    T.hero = hero;

    for (let q = 0; q < g0.n; q++) {
      const own = q === me;
      const el = document.createElement('div');
      el.className = 'dname' + (own ? ' mine' : '');
      el.style.opacity = '1';
      stage.appendChild(el);
      T.labels[q] = el;
    }

    head(r);
    reconcile(r);
    paint(r);
  }

  // What the deal left standing, taken over as it stands.
  function adopt(ctx, r) {
    T = { stage: ctx.stage, piles: (ctx.piles || []).map((a) => (a || []).slice()),
          labels: ctx.labels || [], hero: ctx.hero, hand: new Map(), table: new Map(), slots: [] };
    held = -1; drag = null;
    const mineCards = T.piles[me] || [];
    (ST.hand || []).forEach((c, i) => { if (mineCards[i]) T.hand.set(c, mineCards[i]); });
    T.piles[me] = [];                      // your cards are a hand now, not a pile
    // The deck has given everything out and faded; it has no part in the round.
    (ctx.deckEls || []).forEach((d) => d.remove());
    const g = geom();
    T.piles.forEach((pile, q) => (pile || []).forEach((el, k) => own(el, pileAt(g, q, k, r.cards))));
    let i = 0;
    T.hand.forEach((el) => { own(el, handAt(g, i, false)); i += 1; });
    if (T.hero) own(T.hero, tf(0, -10, 0, 0, 1.15));
    T.labels.forEach((el) => { if (el) { el.style.opacity = '1'; own(el, el.style.transform || ''); } });
    mount();
    head(r);
    reconcile(r);
    paint(r);
  }

  // The round line at the top, and the trump under it. The deal builds these
  // itself; a table built from nothing has to.
  function head(r) {
    const stage = T.stage;
    let box = stage.querySelector('.deal-head');
    if (!box) {
      box = document.createElement('div');
      box.className = 'deal-head';
      box.innerHTML = '<div class="deal-cap"></div><div class="deal-status"></div><div class="deal-tag"></div>';
      stage.appendChild(box);
      const g = geom();
      const tag = box.querySelector('.deal-tag');
      // The same measure the deal takes: most of the way down the empty band
      // between the round line and the top of the ring, so it belongs to
      // neither.
      const ringTop = g.H / 2 - g.R.ry - 56;
      const foot = box.offsetTop + tag.offsetTop + tag.getBoundingClientRect().height;
      tag.style.marginTop = `${Math.max(6, Math.round((ringTop - foot) * 0.45))}px`;
    }
    box.querySelectorAll('.deal-cap,.deal-status,.deal-tag').forEach((el) => { el.style.opacity = '1'; });
    const cap = box.querySelector('.deal-cap');
    if (cap) {
      cap.textContent = `Round ${ST.idx + 1} · ${r.cards} card${r.cards === 1 ? '' : 's'} · `
        + `${ST.seats[r.dealer].name} deals`;
    }
    const tag = box.querySelector('.deal-tag');
    if (tag) {
      const s = Game.SUITS.find((x) => x.k === r.trump);
      tag.textContent = r.trump && r.trump !== 'NT' && s ? `${s.name} are trumps` : 'No trumps';
    }
  }

  /* ---------------- keeping it right ---------------- */

  /* The cards, against the state. A card that has left your hand is on the
     table or gone; a card the state has and the table has not is drawn. Then
     everything is placed again, because a fan of six is not a fan of seven
     with one taken out. */
  function reconcile(r) {
    const p = ST.play;
    const hand = myHand();
    // A finished trick is held up for a moment before it is gathered, and while
    // it is, it is still the thing on the table.
    const shown = p.trick.length ? p.trick : (p.last ? p.last.trick : []);
    const onTable = new Set(shown.map((x) => x.card));
    const inHand = new Set(hand);

    // Cards that have gone from both: last trick's, gathered by its winner.
    T.table.forEach((el, c) => { if (!onTable.has(c)) { el.remove(); T.table.delete(c); } });
    T.hand.forEach((el, c) => {
      if (inHand.has(c)) return;
      if (onTable.has(c)) { T.table.set(c, el); T.hand.delete(c); return; }
      el.remove(); T.hand.delete(c);
    });
    // A play the table would not take comes back to the hand it left.
    T.table.forEach((el, c) => { if (inHand.has(c)) { T.hand.set(c, el); T.table.delete(c); } });

    shown.forEach((x) => {
      if (T.table.has(x.card)) return;
      // The card that lands is the one that was on top of that seat's pile,
      // turned over. Yours comes out of your own hand, in your own fingers.
      let el = T.hand.get(x.card);
      if (el) T.hand.delete(x.card);
      else if (x.p !== me && T.piles[x.p] && T.piles[x.p].length) el = T.piles[x.p].pop();
      if (!el) { el = cardEl(faceOf(x.card), ''); T.stage.appendChild(el); }
      el.classList.add('mine');            // face up, and lit like a card in play
      faceInto(el, x.card);
      T.table.set(x.card, el);
    });

    hand.forEach((c) => {
      if (T.hand.has(c)) return;
      const el = cardEl(faceOf(c), 'mine');
      T.stage.appendChild(el);
      T.hand.set(c, el);
    });

    // The other seats' piles thin as they play. The server says how many each
    // still holds, so a pile is trimmed from the top -- the last card dealt is
    // the first one off.
    const counts = (p && p.counts) || [];
    T.piles.forEach((pile, q) => {
      if (q === me || !pile) return;
      const left = counts[q] === undefined ? pile.length : counts[q];
      while (pile.length > left) { const el = pile.pop(); if (el) el.remove(); }
    });

    layout();
  }

  // Every card on the table, put where it belongs now.
  function layout() {
    if (!T || !ST) return;
    const r = round();
    if (!r) return;
    const g = geom();
    const p = ST.play;
    const hand = myHand();

    T.slots = [];
    hand.forEach((c, i) => {
      const el = T.hand.get(c);
      if (!el) return;
      const spot = g.F.at(i);
      const up = i === held;
      el.classList.toggle('up', up);
      el.style.zIndex = String(up ? 30 : 10 + i);
      if (!drag || !drag.out || drag.i !== i) at(el, handAt(g, i, up));
      T.slots.push({ card: c, el, x: g.seat.x + spot.x, y: spot.y, i });
    });

    const shown = p && p.trick.length ? p.trick : (p && p.last ? p.last.trick : []);
    const winner = p && p.last && !p.trick.length ? p.last.winner : null;
    shown.forEach((x, i) => {
      const el = T.table.get(x.card);
      if (!el) return;
      el.style.zIndex = String(6 + i);
      el.classList.toggle('took', winner !== null && x.p === winner);
      at(el, trickAt(g, x.p));
    });

    T.piles.forEach((pile, q) => (pile || []).forEach((el, k) => {
      el.style.zIndex = String(k);
      at(el, pileAt(g, q, k, r.cards));
    }));
    if (T.hero) at(T.hero, tf(0, -10, 0, 0, 1.15));
    T.labels.forEach((el, q) => { if (el) nameAt(el, g, q, q === me); });
  }

  // What each pile is called, which cards you may play, and the line at the
  // bottom that says what to do about it.
  function paint(r) {
    const p = ST.play;
    const bidding = ST.phase === 'bid';
    T.labels.forEach((el, q) => {
      if (!el) return;
      const bid = r.bids ? r.bids[q] : null;
      const won = p ? p.won[q] : null;
      if (q === me) {
        el.textContent = bidding ? 'Your hand' : `You · ${won}/${bid}`;
      } else {
        el.textContent = ST.seats[q].name
          + (bidding ? (bid === null || bid === undefined ? '' : ` · ${bid}`) : ` · ${won}/${bid}`);
      }
      el.classList.toggle('turn', bidding ? ST.turn === q : !!(p && p.turn === q));
      el.classList.toggle('bidin', bid !== null && bid !== undefined);
    });

    // A card you may not play says so before you try: it is yours to see, so
    // it is dimmed and not hidden.
    const led = ledSuit();
    const mine = !!(p && p.turn === me) && ST.phase === 'tricks';
    const can = mine ? Game.legalPlays(myHand(), led) : null;
    T.hand.forEach((el, c) => el.classList.toggle('dud', !!can && can.indexOf(c) < 0));

    head(r);
    hint(r);
  }

  function say(text) {
    const el = document.querySelector('#deal .felt-hint');
    if (el) el.textContent = text;
  }

  function hint(r) {
    const p = ST.play;
    const bidding = ST.phase === 'bid';
    if (watch) return say('You are watching this table.');
    if (bidding) {
      // The bid pad is still on the page behind the felt, so the felt says
      // where to find it.
      return say(ST.turn === me
        ? 'Your bid — tap Scorecard to make it.'
        : `Waiting for ${ST.seats[ST.turn] ? ST.seats[ST.turn].name : 'the table'} to bid.`);
    }
    if (!p) return say('Dealing…');
    if (sent) return say('…');
    if (p.turn === me) {
      const led = ledSuit();
      const can = Game.legalPlays(myHand(), led);
      return say(!led ? 'Your lead. Push a card up to play it.'
        : can.length === myHand().length ? `You have no ${suitName(led)}, so play anything.`
        : `Follow ${suitName(led)}.`);
    }
    if (p.turn === null) {
      return say(p.last
        ? (p.last.winner === me ? 'You won it.' : `${ST.seats[p.last.winner].name} won that trick.`)
        : 'Waiting…');
    }
    return say(`Waiting for ${ST.seats[p.turn].name}.`);
  }

  /* ---------------- the hand, in your fingers ---------------- */

  // Which card the thumb is on. A fan overlaps, so this is not asked of the
  // browser: the card nearest the thumb along the fan is the one meant, which
  // is what makes a thumb run along the hand read every card in turn.
  function cardUnder(px, py) {
    if (!T || !T.slots.length) return -1;
    const g = geom();
    const cx = px - g.W / 2, cy = py - g.H / 2;
    const top = Math.min(...T.slots.map((s) => s.y)) - g.ch / 2 - LIFT - 10;
    const bot = Math.max(...T.slots.map((s) => s.y)) + g.ch / 2 + 30;
    if (cy < top || cy > bot) return -1;
    const lo = Math.min(...T.slots.map((s) => s.x)) - g.cw / 2 - 14;
    const hi = Math.max(...T.slots.map((s) => s.x)) + g.cw / 2 + 14;
    if (cx < lo || cx > hi) return -1;
    let best = -1, near = Infinity;
    T.slots.forEach((s) => {
      const d = Math.abs(cx - s.x);
      if (d < near) { near = d; best = s.i; }
    });
    return best;
  }

  function lift(i) {
    if (held === i) return;
    held = i;
    layout();
  }

  function drop() {
    if (held < 0) return;
    held = -1;
    layout();
  }

  // Why a card will not go. The same three answers the server would give, said
  // before the card leaves the hand instead of after.
  function refusal() {
    const p = ST.play;
    if (watch || !send) return 'This window is only watching.';
    if (ST.phase !== 'tricks' || !p) return 'The bids come first.';
    if (sent) return '…';
    if (p.turn === null) return 'That trick is still on the table.';
    if (p.turn !== me) return `It is ${ST.seats[p.turn].name}'s turn.`;
    const led = ledSuit();
    return `You must follow ${suitName(led)}.`;
  }

  function playable(card) {
    const p = ST.play;
    if (watch || !send || sent) return false;
    if (ST.phase !== 'tricks' || !p || p.turn !== me) return false;
    return Game.legalPlays(myHand(), ledSuit()).indexOf(card) >= 0;
  }

  function refuse(i) {
    const s = T.slots.find((x) => x.i === i);
    if (s) {
      s.el.classList.remove('no');
      void s.el.offsetWidth;                  // so it shakes again
      s.el.classList.add('no');
      setTimeout(() => s.el.classList.remove('no'), 420);
    }
    say(refusal());
  }

  // The card leaves the hand. The table decides whether it may -- this only
  // sends it and lets go of it, and the state that comes back says where it
  // ended up.
  function playIt(i) {
    const s = T.slots.find((x) => x.i === i);
    if (!s) return;
    if (!playable(s.card)) { refuse(i); return; }
    const g = geom();
    const el = s.el;
    el.classList.remove('up', 'drag');
    el.classList.add('slow');
    el.style.zIndex = '9';
    at(el, trickAt(g, me));
    T.hand.delete(s.card);
    T.table.set(s.card, el);
    sent = s.card;
    held = -1; drag = null;
    send({ t: 'play', card: s.card });
    layout();
    say('…');
    setTimeout(() => el.classList.remove('slow'), 400);
  }

  /* Where the thumb has to get to for the card to be played: clear of the fan,
     in the open ground between the hand and the pile. It is the thumb that is
     judged, not the card -- the card rides above the thumb, and judging the
     card would make the shortest nudge a played card. */
  function lineY(g) {
    return g.F.at(0).y - g.ch / 2 - 70;
  }

  function showLine(on, g) {
    const overlay = document.getElementById('deal');
    if (!overlay) return;
    const line = overlay.querySelector('.felt-line');
    overlay.classList.toggle('dragging', !!on);
    if (line && on && g) line.style.top = `calc(50% + ${Math.round(lineY(g))}px)`;
  }

  function wire(overlay) {
    if (overlay._felt) return;
    overlay._felt = true;
    overlay.addEventListener('pointerdown', onDown);
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', onUp);
    overlay.addEventListener('pointercancel', onUp);
  }

  function onDown(e) {
    if (!T || !want || (e.button !== undefined && e.button > 0)) return;
    const i = cardUnder(e.clientX, e.clientY);
    if (i < 0) { drop(); return; }
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
             i, moved: false, out: false, was: held === i, told: false };
    lift(i);
    const overlay = document.getElementById('deal');
    if (overlay && overlay.setPointerCapture) {
      try { overlay.setPointerCapture(e.pointerId); } catch (err) {}
    }
    if (e.preventDefault) e.preventDefault();
  }

  function onMove(e) {
    if (!T || !drag || e.pointerId !== drag.id) return;
    drag.x = e.clientX; drag.y = e.clientY;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;

    const g = geom();
    if (drag.out) {
      const el = (T.slots.find((x) => x.i === drag.i) || {}).el;
      if (el) {
        el.classList.add('drag');
        at(el, tf(e.clientX - g.W / 2, e.clientY - g.H / 2 - GRAB, 0, 0, BIG));
      }
      showLine(true, g);
      const over = e.clientY - g.H / 2 < lineY(g);
      const overlay = document.getElementById('deal');
      if (overlay) overlay.classList.toggle('armed', over);
      return;
    }

    // A push straight up out of the fan is a card being played.
    if (dy < -DEAD && Math.abs(dy) > Math.abs(dx)) {
      const s = T.slots.find((x) => x.i === drag.i);
      if (s && playable(s.card)) { drag.out = true; showLine(true, g); return; }
      if (!drag.told) { drag.told = true; refuse(drag.i); }
      return;
    }

    // Otherwise the thumb is reading along the hand.
    const i = cardUnder(e.clientX, e.clientY);
    if (i >= 0 && i !== drag.i) {
      drag.i = i; drag.x0 = e.clientX; drag.y0 = e.clientY;
      drag.was = false; drag.told = false;
      lift(i);
    }
  }

  function onUp(e) {
    if (!T || !drag || (e && e.pointerId !== drag.id)) return;
    const d = drag;
    drag = null;
    const g = geom();
    const overlay = document.getElementById('deal');
    if (overlay) overlay.classList.remove('armed');
    showLine(false);
    const el = (T.slots.find((x) => x.i === d.i) || {}).el;
    if (el) el.classList.remove('drag');

    if (d.out) {
      // Released clear of the fan: it is played. Released short of the line, it
      // goes back where it came from.
      if (d.y - g.H / 2 < lineY(g)) { playIt(d.i); return; }
      layout();
      return;
    }
    // A card already up, tapped again, is played: nothing on this table needs
    // a drag.
    if (!d.moved && d.was) { playIt(d.i); return; }
    layout();
  }

  /* ---------------- coming and going ---------------- */

  function start(r) {
    // A phone that arrives in the middle of a round has missed the deal, and
    // replaying it would be a lie about where the game is. Only an untouched
    // round is dealt.
    const untouched = ST.phase === 'bid'
      && (r.bids || []).every((b) => b === null || b === undefined)
      && ST.play && !ST.play.trick.length && ST.play.won.every((v) => !v);
    if (!untouched || still()) { build(r); return; }

    mount();
    const long = !dealtOnce;
    dealtOnce = true;
    T = null;
    dealing = true;
    const mine = key;                    // the round this deal belongs to
    Deal.play({
      names: ST.seats.map((s) => s.name),
      dealer: r.dealer, cards: r.cards, round: ST.idx + 1,
      deck: 'virtual', mine: me, hand: ST.hand || [],
      upcard: ST.play.upcard, trump: r.trump || null,
      avatars: ST.seats.map((s) => Avatar.url(ST.code, s)),
      keep: true, brief: !long,
      onTable: (ctx) => {
        dealing = false;
        // The round may have moved on while the cards were in the air -- a bum
        // deal, or a phone that came back slowly. Then this table is out of
        // date before it is stood up, and the next sync builds the right one.
        if (mine !== key || !want) return;
        const now = round();
        if (now) adopt(ctx, now);
      },
    }).then(() => {
      // The deal bowed out without handing anything over -- no Web Animations
      // API, or a table of nobody. The felt is the game now, so it is drawn
      // anyway.
      if (dealing && mine === key) { dealing = false; if (want && round()) build(round()); }
    });
  }

  function leave() {
    key = null;
    if (T || dealing) { Stage.close('deal'); T = null; dealing = false; }
    unmount();
    if (onView) onView(false);
  }

  /* Every state the page gets. The felt is opened, dealt, kept up to date and
     closed from here and nowhere else. */
  function sync(state, mySeat, hooks) {
    ST = state; me = mySeat;
    if (hooks) {
      if (hooks.send) send = hooks.send;
      if ('watch' in hooks) watch = !!hooks.watch;
      if (hooks.onView) onView = hooks.onView;
    }
    const r = round();
    const on = virtual() && !!r && !!ST.play
      && (ST.phase === 'bid' || ST.phase === 'tricks') && me >= 0;
    if (!on) { leave(); return; }

    // The card we sent has arrived, one way or the other: the state is the
    // truth about the hand again.
    if (sent && (ST.hand || []).indexOf(sent) < 0) sent = null;

    const k = `${ST.idx}:${r.redeals || 0}`;
    if (k !== key) {
      key = k;
      T = null;
      dealing = false;
      sent = null;
      if (want) start(r);
      return;
    }
    if (!want) return;
    // While the cards are still in the air the deal owns the stage. It knows
    // how to take a bid landing mid-deal -- the number is stamped on the pile
    // it belongs to -- so it is told, and the table waits its turn.
    if (dealing) {
      Deal.update({ bids: (r.bids || []).slice(), turn: ST.turn, text: '' });
      return;
    }
    if (!T) { build(r); return; }
    reconcile(r);
    paint(r);
  }

  /* The felt and the page are two views of one round. The button in the felt's
     corner drops it; the bar at the top of the page brings it back. */
  function show() {
    want = true;
    const r = round();
    if (!ST || !r) return;
    const overlay = overlayEl();
    overlay.hidden = false;
    if (!T) build(r);
    else { mount(); reconcile(r); paint(r); }
    if (onView) onView(true);
  }

  function hide() {
    want = false;
    drag = null; held = -1;
    const overlay = document.getElementById('deal');
    if (overlay) { overlay.hidden = true; overlay.classList.remove('dragging', 'armed'); }
    if (onView) onView(false);
  }

  const isOpen = () => want && !!T;
  const shown = () => want;

  window.addEventListener('resize', () => { if (T && want) layout(); });

  return { sync, show, hide, isOpen, shown };
})();
