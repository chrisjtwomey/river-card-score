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
  let pausing = false;             // the round just scored is being held up
  let dealtOnce = false;           // the first deal of a game is the long one
  let want = true;                 // the reader wants the felt, not the page
  let T = null;                    // the table: every element standing on it
  let onView = null;               // the page, told when the felt comes and goes
  let held = -1;                   // the card in the reader's fingers, or none
  let drag = null;                 // the gesture in progress
  let spread = false;              // the pile in the middle, laid out to be read
  let heldBid = -1;                // the number under the thumb, or none
  let bidSlots = [];               // where each number sits, to aim a thumb at
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
    // The stage is made hidden, and the deal is what usually shows it. A table
    // built without one -- a phone that arrived in the middle of a round, or a
    // reader with animations off -- has to show it itself.
    if (want) overlay.hidden = false;
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
    // The table covers the page's top bar, and the talk has to stay reachable.
    if (typeof Chat !== 'undefined' && Chat.also && !overlay.querySelector('.felt-talk')) {
      const talk = document.createElement('button');
      talk.className = 'felt-talk';
      talk.type = 'button';
      talk.title = 'Table talk';
      talk.setAttribute('aria-label', 'Table talk');
      talk.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.6 3h10.8A2.6 2.6 0'
        + ' 0 1 18 5.6v6.3a2.6 2.6 0 0 1-2.6 2.6H9.1l-3.5 3.1a.7.7 0 0 1-1.2-.52v-2.58H4.6A2.6 2.6 0'
        + ' 0 1 2 11.9V5.6A2.6 2.6 0 0 1 4.6 3z"/></svg><span class="chat-badge" hidden></span>';
      overlay.appendChild(talk);
      Chat.also(talk);
    }
    if (!overlay.querySelector('.felt-hint')) {
      const hint = document.createElement('p');
      hint.className = 'felt-hint';
      overlay.appendChild(hint);
    }
    if (!overlay.querySelector('.felt-bids')) {
      const rail = document.createElement('div');
      rail.className = 'felt-bids';
      rail.hidden = true;
      overlay.appendChild(rail);
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
    ['.felt-out', '.felt-hint', '.felt-line', '.felt-bids', '.felt-beat'].forEach((s) => {
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

  /* The tricks a seat has won, in a little stack beside its own cards. A real
     table keeps them there, and they say at a glance who is doing well.

     The stack grows upward, not sideways: a seat that wins seven tricks must
     take up no more room than one that wins none, and the middle of the table
     and the fan below it are both already spoken for. */
  function wonAt(g, p, k) {
    const s = g.R.at(p);
    const side = (s.x + g.cw * 1.6 > g.W / 2) ? -1 : 1;   // in, if out would fall off
    return tf(s.x + side * g.cw * 0.95 + k * 0.8, s.y - 4 - k * 1.6,
              -4 + k * 1.2, 180, 0.42);
  }

  /* The pile, laid out to be read: side by side in the order they were played,
     each under the name of whoever played it. The card the deck turned is the
     bottom of that pile, so it is the first in the row and comes down to the
     size of the rest -- it would cover the card beside it otherwise. */
  function spreadX(g, i, of) {
    // Not past the seats on either side: a row that reached the piles would be
    // read as part of them. A big table's row overlaps instead, and overlaps
    // leftward, so every card still shows the corner it is named in.
    const room = Math.min(g.W * 0.9, 380, 2 * (g.R.rx - g.cw * 0.6));
    const step = of > 1 ? Math.min(g.cw * 1.14, (room - g.cw) / (of - 1)) : 0;
    return (i - (of - 1) / 2) * step;
  }
  const spreadAt = (g, i, of) => tf(spreadX(g, i, of), -10, 0, 0, 1);

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
    T = { stage, piles: [], labels: [], hero: null, hand: new Map(), table: new Map(),
          slots: [], won: [], heldWinner: null, shown: '' };
    held = -1; drag = null; spread = false;

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
          labels: ctx.labels || [], hero: ctx.hero, hand: new Map(), table: new Map(),
          slots: [], won: [], heldWinner: null, shown: '' };
    held = -1; drag = null; spread = false;
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

    // A new card on the table stacks the pile again: whoever was reading it has
    // read it.
    const sig = shown.map((x) => x.p + x.card).join(',');
    if (sig !== T.shown) { spread = false; T.shown = sig; }

    /* A finished trick leaves the middle, and it does not vanish: it goes to
       whoever took it, face down, and joins the little stack of tricks they
       have won. One card stands for each trick -- a whole trick a side would be
       a stack too wide for a phone -- so the first card of the trick makes the
       journey and the rest go with it. */
    const gathered = [];
    T.table.forEach((el, c) => {
      if (onTable.has(c)) return;
      gathered.push(el);
      T.table.delete(c);
    });
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

    /* The stacks of won tricks, against what the server counted. A trick that
       is still on the table has been counted but not yet gathered, so it is not
       on the stack yet either -- that is what makes the gather something the
       table can see. A phone that arrived in the middle of a round has no cards
       to gather, so plain backs stand in for the tricks it missed. */
    const wonBy = (p && p.won) || [];
    const holding = !!(p && p.last && !p.trick.length);
    const heir = T.heldWinner;
    for (let q = 0; q < ST.seats.length; q++) {
      T.won[q] = T.won[q] || [];
      const target = Math.max(0, (wonBy[q] || 0) - (holding && p.last.winner === q ? 1 : 0));
      while (T.won[q].length > target) { const el = T.won[q].pop(); if (el) el.remove(); }
      while (T.won[q].length < target) {
        let el = (heir === q && gathered.length) ? gathered.shift() : null;
        if (!el) { el = cardEl(null, ''); T.stage.appendChild(el); }
        el.classList.remove('mine', 'took', 'up', 'dud', 'drag', 'no');
        el.classList.add('slow', 'gone');
        T.won[q].push(el);
      }
    }
    gathered.forEach((el) => el.remove());     // nobody's: a round thrown in
    T.heldWinner = p && p.last && !p.trick.length ? p.last.winner : null;

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
    T.stage.querySelectorAll('.tname').forEach((el) => el.remove());
    // Read out, the turned card takes the first place in the row.
    const row = spread ? shown.length + 1 : 0;
    const label = (i, text, gold) => {
      const nm = document.createElement('div');
      nm.className = 'tname' + (gold ? ' took' : '');
      nm.textContent = text;
      nm.style.left = `calc(50% + ${Math.round(spreadX(g, i, row))}px)`;
      nm.style.top = `calc(50% + ${Math.round(-10 + g.ch / 2 + 12)}px)`;
      T.stage.appendChild(nm);
    };
    shown.forEach((x, i) => {
      const el = T.table.get(x.card);
      if (!el) return;
      el.style.zIndex = String(7 + i);
      el.classList.toggle('took', winner !== null && x.p === winner);
      el.classList.toggle('slow', spread);
      at(el, spread ? spreadAt(g, i + 1, row) : trickAt(g, x.p));
      if (spread) label(i + 1, x.p === me ? 'You' : ST.seats[x.p].name, x.p === winner);
    });
    if (spread) label(0, 'Trump', false);

    (T.won || []).forEach((stack, q) => (stack || []).forEach((el, k) => {
      el.style.zIndex = String(2);
      at(el, wonAt(g, q, k));
    }));

    T.piles.forEach((pile, q) => (pile || []).forEach((el, k) => {
      el.style.zIndex = String(k);
      at(el, pileAt(g, q, k, r.cards));
    }));
    if (T.hero) {
      T.hero.classList.toggle('slow', spread);
      T.hero.style.zIndex = spread ? '6' : '';
      at(T.hero, spread
        ? tf(spreadX(g, 0, row), -10, 0, 0, g.cw / 86)
        : tf(0, -10, 0, 0, 1.15));
    }
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
    bidRail(r);
    hint(r);
  }

  /* The bid, made while you are holding your cards -- which is when a bid is
     really made. The numbers arc across the empty band between the card the
     deck turned and the top of your fan, and they echo the fan's own curve.

     Every rule they obey belongs to the shared rules and to the server: the
     range is the hand, the seat that may bid is turnSeat, the seat that may
     still change its mind is changeableSeat, and the one number the dealer may
     not call is forbiddenBid. */
  function bidRail(r) {
    const rail = document.querySelector('#deal .felt-bids');
    if (!rail) return;
    const n = ST.seats.length;
    const mine = ST.turn === me;
    const amend = Game.changeableSeat(r, n) === me;
    const on = ST.phase === 'bid' && !watch && !!send && (mine || amend);
    rail.hidden = !on;
    if (!on) { rail.innerHTML = ''; rail.dataset.k = ''; bidSlots = []; heldBid = -1; return; }

    const forbidden = Game.forbiddenBid(r, me, ST.cfg, n);
    const k = `${ST.idx}:${r.redeals || 0}:${r.cards}:${r.bids[me]}:${forbidden}:${amend}`;
    if (rail.dataset.k === k) { placeBids(); return; }   // nothing about it changed
    rail.dataset.k = k;
    rail.innerHTML = '';
    heldBid = -1;

    const g = geom();
    /* Anchored by its foot, not its head: the heading above the fan has to stay
       readable, and a long hand's numbers must grow upward into the empty
       middle of the table and never down over the cards. */
    rail.style.bottom = `calc(50% - ${Math.round(g.F.at(0).y - 88)}px)`;

    const count = r.cards + 1;
    const size = g.W <= 420 ? 40 : 44;
    const room = Math.min(g.W - 20, 400);
    // Numbers step along at a fixed distance like the cards do, and like the
    // cards they overlap when there are a lot of them -- which is no trouble,
    // because a thumb passing over them lifts each in turn.
    const step = count > 1 ? Math.min(size + 6, (room - size) / (count - 1)) : 0;
    const arc = Stage.fan(count, g.W, g.H);
    bidSlots = [];
    for (let v = 0; v <= r.cards; v++) {
      const b = document.createElement('button');
      b.className = 'bidchip';
      b.type = 'button';
      b.textContent = String(v);
      b.style.width = `${size}px`;
      b.style.height = `${size}px`;
      const off = arc.off(v);
      const x = off * step;
      const dy = (arc.at(v).y - arc.y) * 0.45;
      const tilt = off * arc.tilt * 0.5;
      b.style.left = `calc(50% + ${Math.round(x)}px)`;
      b.style.zIndex = String(10 + v);
      if (r.bids[me] === v) b.setAttribute('aria-pressed', 'true');
      if (v === forbidden) {
        b.classList.add('nope');
        b.disabled = true;
        b.title = `Screw the dealer: the bids must not total ${r.cards}`;
      }
      // A keyboard needs no thumb: the key that presses the button bids it.
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.preventDefault) e.preventDefault();
        bidIt(v);
      });
      rail.appendChild(b);
      bidSlots.push({ v, el: b, x, dy, tilt });
    }
    placeBids();
  }

  // A number lifts and enlarges under the thumb, the same as a card does.
  function placeBids() {
    bidSlots.forEach((s) => {
      const up = s.v === heldBid;
      s.el.classList.toggle('up', up);
      s.el.style.zIndex = String(up ? 40 : 10 + s.v);
      s.el.style.transform = `translate(-50%,${Math.round(s.dy) - (up ? 13 : 0)}px) `
        + `rotate(${s.tilt.toFixed(2)}deg) scale(${up ? 1.34 : 1})`;
    });
  }

  // Which number the thumb is on, by the same reckoning the fan uses.
  function bidUnder(px, py) {
    if (!bidSlots.length) return -1;
    const g = geom();
    const rail = document.querySelector('#deal .felt-bids');
    if (!rail || rail.hidden) return -1;
    const foot = g.H / 2 + g.F.at(0).y - 88;          // the rail's own foot
    const size = g.W <= 420 ? 40 : 44;
    if (py > foot + 14 || py < foot - size - 24) return -1;
    const cx = px - g.W / 2;
    const lo = Math.min(...bidSlots.map((s) => s.x)) - size / 2 - 12;
    const hi = Math.max(...bidSlots.map((s) => s.x)) + size / 2 + 12;
    if (cx < lo || cx > hi) return -1;
    let best = -1, near = Infinity;
    bidSlots.forEach((s) => {
      const d = Math.abs(cx - s.x);
      if (d < near) { near = d; best = s.v; }
    });
    return best;
  }

  function bidIt(v) {
    const s = bidSlots.find((x) => x.v === v);
    if (!s || s.el.disabled || !send) return;
    bidSlots.forEach((x) => { x.el.disabled = true; });
    heldBid = -1;
    placeBids();
    send({ t: 'bid', v });
  }

  function say(text) {
    const el = document.querySelector('#deal .felt-hint');
    if (el) el.textContent = text;
  }

  function hint(r) {
    const p = ST.play;
    const bidding = ST.phase === 'bid';
    if (spread) return say('Tap again to stack them.');
    if (watch) return say('You are watching this table.');
    if (bidding) {
      const n = ST.seats.length;
      if (ST.turn === me) {
        const forbidden = Game.forbiddenBid(r, me, ST.cfg, n);
        return say(forbidden === null
          ? `How many of the ${r.cards} tricks will you win?`
          : `You deal, so you bid last. ${forbidden} is not allowed: `
            + `the bids must not total ${r.cards}.`);
      }
      if (Game.changeableSeat(r, n) === me) {
        return say(`You bid ${r.bids[me]}. You can change it until `
          + `${ST.seats[ST.turn] ? ST.seats[ST.turn].name : 'the next player'} bids.`);
      }
      if (ST.turn === null) return say('All bids are in.');
      const who = ST.seats[ST.turn];
      if (!who) return say('Waiting for the table to bid.');
      // A seat with nobody behind it stops the table, and the felt should not
      // leave a player guessing why nothing is happening. The bid for it is
      // made from the page under the felt, by whoever runs the table.
      if (!who.online) {
        return say(who.left
          ? `${who.name} left the game. The table is playing that hand.`
          : `${who.name} is not at the table. The table waits, or the host bids for them.`);
      }
      return say(`Waiting for ${who.name} to bid.`);
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
    const on = ST.seats[p.turn];
    if (on && !on.online) {
      return say(on.left
        ? `${on.name} left the game. The table is playing that hand.`
        : `${on.name} is not at the table.`);
    }
    return say(`Waiting for ${on ? on.name : 'the table'}.`);
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

  // The pile in the middle: a generous box round the card the deck turned, so
  // a thumb aimed at it hits it.
  function onPile(px, py) {
    if (!T || !T.table.size) return false;
    const g = geom();
    const cx = px - g.W / 2, cy = py - g.H / 2 + 10;
    if (spread) return Math.abs(cy) < g.ch * 0.9 && Math.abs(cx) < g.W * 0.48;
    return Math.abs(cx) < g.cw * 1.15 && Math.abs(cy) < g.ch * 1.1;
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
    held = -1; drag = null; spread = false;
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
    // The scorecard button answers for itself.
    if (e.target && e.target.closest && e.target.closest('.felt-out,.felt-talk')) return;

    // The numbers are picked up the way the cards are: a touch lifts one, a
    // thumb along them lifts each in turn, and a tap on the one already up
    // calls it.
    const v = bidUnder(e.clientX, e.clientY);
    if (v >= 0) {
      const was = heldBid === v;
      drag = { id: e.pointerId, kind: 'bid', v, x0: e.clientX, y0: e.clientY,
               x: e.clientX, y: e.clientY, moved: false, was };
      heldBid = v;
      placeBids();
      if (e.preventDefault) e.preventDefault();
      return;
    }

    const i = cardUnder(e.clientX, e.clientY);
    if (i < 0) {
      // A tap on the pile separates it, so the cards played can be read; the
      // next one stacks it again.
      if (onPile(e.clientX, e.clientY)) {
        spread = !spread;
        drop();
        layout();
        hint(round());
        return;
      }
      drop();
      return;
    }
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

    if (drag.kind === 'bid') {
      const v = bidUnder(e.clientX, e.clientY);
      if (v >= 0 && v !== drag.v) {
        drag.v = v; drag.was = false;
        heldBid = v;
        placeBids();
      }
      return;
    }

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
    if (d.kind === 'bid') {
      // A number already up, tapped again, is the bid.
      if (!d.moved && d.was) bidIt(d.v);
      return;
    }
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

  /* What the round paid, held for a moment before the next one is dealt. The
     server scores a round and deals the next in the same breath, so without
     this the result of a hand you have just played goes by unremarked. */
  function beat(prev) {
    const overlay = overlayEl();
    let el = overlay.querySelector('.felt-beat');
    if (!el) {
      el = document.createElement('div');
      el.className = 'felt-beat';
      overlay.appendChild(el);
    }
    const bid = prev.bids[me], won = prev.tricks[me];
    const pts = Game.roundScore(bid, won, ST.cfg);
    el.className = 'felt-beat' + (bid === won ? ' hit' : '');
    const line = (tag, text) => {
      const x = document.createElement(tag);
      x.textContent = text;
      return x;
    };
    el.textContent = '';
    el.append(line('b', bid === won ? 'You made it' : 'You went down'),
              line('span', `bid ${bid} · won ${won}`),
              line('i', `${pts >= 0 ? '+' : ''}${pts} point${Math.abs(pts) === 1 ? '' : 's'}`));
    el.hidden = false;
    return el;
  }

  function endBeat() {
    const el = document.querySelector('#deal .felt-beat');
    if (el) el.hidden = true;
  }

  function leave() {
    key = null;
    pausing = false;
    endBeat();
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
      const was = key;
      key = k;
      T = null;
      dealing = false;
      sent = null;
      spread = false;
      if (!want) return;
      // A round has been played and scored on this table: its result is held up
      // for a moment, over the trick that ended it, before the next deal.
      const prev = ST.idx > 0 ? ST.rounds[ST.idx - 1] : null;
      if (was && prev && Game.roundDone(prev) && !still()) {
        pausing = true;
        beat(prev);
        setTimeout(() => {
          if (!pausing) return;
          pausing = false;
          endBeat();
          if (key === k && want && round()) start(round());
        }, 1900);
        return;
      }
      start(r);
      return;
    }
    if (!want) return;
    if (pausing) return;                 // the round just gone is still up
    // While the cards are still in the air the deal owns the stage. It knows
    // how to take a bid landing mid-deal -- the number is stamped on the pile
    // it belongs to -- so it is told, and the table waits its turn.
    if (dealing) {
      // The deal has its own captions, and last round's line has nothing to say
      // over them.
      say('');
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
    drag = null; held = -1; spread = false;
    if (pausing) { pausing = false; endBeat(); }
    const overlay = document.getElementById('deal');
    if (overlay) { overlay.hidden = true; overlay.classList.remove('dragging', 'armed'); }
    if (onView) onView(false);
  }

  const isOpen = () => want && !!T;
  const shown = () => want;

  window.addEventListener('resize', () => { if (T && want) layout(); });

  return { sync, show, hide, isOpen, shown };
})();
