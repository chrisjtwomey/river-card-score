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
   a CSS transition carries it there. A round lasts minutes, and a card that
   collects animations loses its third dimension -- the back stops facing the
   room and a blank front is painted instead. A style and a transition cannot
   pile up, and a move interrupted half way carries on from where the card
   actually is.

   The two ways round the table are the exception. A trick gathered in and a
   pile unwound are each drawn as a run of places along an arc, and a
   transition cannot draw a curve. The gather does not fill: where the card
   belongs is written to the style before it sets off, so the arc is only the
   way it gets there and the card is left owing nothing when it arrives. The
   unwind does fill, because those cards are being put away for good.
*/
const Felt = (function () {
  const { cardEl, tf, faceOf, parts } = Stage;

  /* How long the trick just taken stays named before the cards are gathered to
     whoever took it. The server holds the table on that trick for a little
     longer still (TRICK_HOLD in lib/deck.js): the winner must not lead while
     the news of the last one is still on the screen. */
  const TOOK_HOLD = 2000;

  /* How long the cards take to come in. They set off before the news of the
     trick has gone and arrive as it does, the way a trick is gathered at a
     real table while it is still being read, so this is spent inside
     TOOK_HOLD and the round is no slower for it. */
  const SWEEP = 420;

  /* And the floor under one card's share of it: what the transition on a
     .dcard takes, the pace every other card on this table moves at. The seat
     next to the winner has the shortest way round, and it still has to read
     as a card going round it. */
  const CARD_MOVE = 140;

  /* How long what the round paid stands before the table is put away for the
     next one. A figure a player has to catch inside two seconds is a figure
     they read once and are not sure of. */
  const PAID_HOLD = 2000;

  /* How long the table takes to put itself away: the tricks come off the
     seats one at a time, go round the ring the other way, and square up under
     the card the deck turned, which then goes face down on top of them. A
     round that ends by the table being replaced is a round nobody saw end.

     It is the whole of the putting away, not the time one card takes: a hand
     of thirteen tricks must not take three times as long to clear as a hand
     of four, so it is the interval between cards that gives, not the total. */
  const UNWIND = 1500;

  /* How long one card takes to come in, how far round the table the arc
     carries it, and how finely that arc is drawn. Half a turn is enough to
     read as going round the table and not as crossing it. */
  const ARC = 760, ARC_SWEEP = Math.PI, ARC_STEPS = 14;
  /* And the hand both arcs are drawn with: away slowly, round, and down onto
     the spot. A trick gathered in and a pile unwound are the same movement in
     opposite directions, so they are drawn the same way. */
  const ARC_EASE = 'cubic-bezier(.35,.05,.3,1)';
  const TURN = Math.PI * 2;
  /* And how far apart two cards set off. They go one after another in one
     stream rather than a trick at a time in clumps: eight cards of a trick
     leaving together is a block of cards moving, not cards. Close enough to
     read as a stream, far enough apart to read as cards. */
  const LEAD_MIN = 42, LEAD_MAX = 110;

  /* How long the places stand over the fresh deck before the next round is
     dealt, counted from the moment they come up. Long enough to find your own
     row and then watch what the round did to it; not so long that the game is
     waiting on a table nobody is playing. */
  const STAND_HOLD = 3000;

  // And how long it stands still first, showing where the round found things
  // before it says what it did to them.
  const STAND_WAIT = 500;
  const LIFT = 52;              // how far a card comes up out of the fan
  const BIG = 1.3;              // and how much bigger it gets while it is up
  const DEAD = 16;              // a push this far up means it is being played
  const GRAB = 30;              // and the card rides this far above the thumb

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
  let heldBid = -1;                // the number under the thumb, or none
  let bidSlots = [];               // where each number sits, to aim a thumb at
  let sent = null;                 // a card played, until the table says so
  let ready = null;                // the round this screen has said it can see
  let peeking = null;              // the pile the table waits on: { q, el, at, off }
  let stamped = null;              // the bids on the table at the last paint, or null before the first
  let told = null;                 // the finished trick this screen has announced
  let swept = null;                // and the one it has gathered in
  let bidsUp = false;              // the bids are up to be read, before the first card
  let sweeping = null;             // the trick whose cards are on their way to the winner

  const virtual = () => !!ST && Game.virtual(ST);
  /* A trick that has been taken and is still lying in the middle. The server
     leaves it there, with nobody on play, until the winner leads again. */
  const heldTrick = (p) => (p && p.last && !p.trick.length ? p.last : null);
  const trickSig = (h) => (h ? h.winner + ':' + h.trick.map((x) => x.card).join(',') : null);
  const round = () => (ST && ST.rounds ? ST.rounds[ST.idx] || null : null);
  const still = () => UI.motion() === 'off';
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
    const overlay = parts().overlay;
    // The stage is made hidden, and the deal is what usually shows it. A table
    // built without one -- a phone that arrived in the middle of a round, or a
    // reader with animations off -- has to show it itself. The page is told
    // too: what it says in passing (a bid landing, a phone going) moves to the
    // foot of the felt, off the round line.
    if (want) { overlay.hidden = false; document.body.classList.add('felt-up'); }
    overlay.classList.add('table');
    overlay.classList.toggle('still', still());
    if (!overlay.querySelector('.felt-out')) {
      const out = document.createElement('button');
      out.className = 'felt-out';
      out.type = 'button';
      out.title = 'The scores and the round';
      out.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true">'
        + '<rect x="2.5" y="3" width="15" height="14" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/>'
        + '<path d="M2.5 7.5h15M8 7.5V17M2.5 12h15" stroke="currentColor" stroke-width="1.3" fill="none"/>'
        + '</svg><span>Scores</span>';
      out.addEventListener('click', (e) => { e.stopPropagation(); hide(); });
      overlay.appendChild(out);
    }
    // The table covers the page's top bar, and the talk has to stay reachable.
    if (typeof Chat !== 'undefined' && Chat.button && !overlay.querySelector('.felt-talk')) {
      overlay.appendChild(Chat.button('felt-talk'));
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
    // A vote on a bum deal reaches a player where they are, which is here.
    if (!overlay.querySelector('.felt-vote')) {
      const box = document.createElement('div');
      box.className = 'felt-vote votebox';
      box.hidden = true;
      overlay.appendChild(box);
    }
    wire(overlay);
    return parts();
  }

  function unmount() {
    const overlay = (parts(false) || {}).overlay;
    if (!overlay) return;
    overlay.classList.remove('table', 'still', 'dragging');
    document.body.classList.remove('felt-up');
    ['.felt-out', '.felt-hint', '.felt-line', '.felt-bids', '.felt-beat', '.felt-vote',
     '.felt-stands'].forEach((s) => {
      const el = overlay.querySelector(s);
      if (el) el.remove();
    });
    held = -1; drag = null; sent = null;
  }

  /* ---------------- where everything sits ---------------- */

  /* The same two answers the deal used, asked again: the fan closes up as the
     hand is played, so it is asked on every change and not kept. */
  function geom() {
    const overlay = parts().overlay;
    const W = overlay.clientWidth, H = overlay.clientHeight;
    const n = ST.seats.length;
    const R = Stage.ring(n, Math.max(0, me), W, H);
    const F = Stage.fan(Math.max(1, myHand().length), W, H);
    const c = Stage.cardSize(W);
    return { W, H, n, R, F, seat: R.at(Math.max(0, me)), cw: c.w, ch: c.h };
  }

  // A pile lies where the deal left it: the seat's spot, stepped along and
  // stacked a little for each card in it. `of` is how many cards were dealt,
  // which is what set the step.
  function pileAt(g, p, k, of) {
    const h = Stage.pile(g.R, Stage.fan(of, g.W, g.H), p, k, g.n);
    return tf(h.x, h.y, h.tilt, 180, h.z);
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

  // How far a card played into a seat is turned: by where that seat stands,
  // so a glance down the table says whose it is.
  const trickTilt = (g, p) => (g.R.at(p).x / (g.R.rx || 1)) * 12;

  /* A card played lies on the one the deck turned, pushed a little toward
     whoever played it, so a glance says whose it is and a tap can separate
     them. The spots make a circle round the middle of the table, and that
     circle is the way a trick comes in when it is gathered. */
  function trickAt(g, p, face) {
    const d = dirTo(g, p), r = trickRing(g);
    return tf(d.x * r, g.R.cy + d.y * r,
              trickTilt(g, p), face || 0, Stage.seatScale(g.n));
  }

  /* A card lifted off a seat's won pile and stood up where that seat sits.
     The pile itself is drawn small and tucked in beside the seat, so a card
     that goes straight from there to the middle has left before anybody saw
     it go: it comes up to the size of a card in play, over its own seat,
     and travels from there. */
  function overSeat(g, q, face) {
    const s = g.R.at(q);
    return tf(s.x, s.y, (s.x / (g.R.rx || 1)) * 10, face || 0, Stage.seatScale(g.n));
  }

  /* The tricks a seat has won, in a little stack beside its own cards. A real
     table keeps them there, and they say at a glance who is doing well.

     The stack grows upward, not sideways: a seat that wins seven tricks must
     take up no more room than one that wins none, and the middle of the table
     and the fan below it are both already spoken for. */
  function wonAt(g, p, t, j) {
    const s = g.R.at(p), z = Stage.seatScale(g.n);
    const side = (s.x + g.cw * 1.6 * z > g.W / 2) ? -1 : 1;   // in, if out would fall off
    // `t` steps the stack up a trick at a time; `j` fans that trick's own
    // cards across it, so a trick reads as the several cards it is.
    return tf(s.x + side * g.cw * 0.95 * z + t * 0.8 + j * 1.1,
              s.y - 4 - t * 1.6 - j * 0.5,
              -4 + t * 1.2 + j * 2.2, 180, 0.42 * z);
  }

  /* The card the deck turned lies in the middle of the table, where a turned
     card lies. It comes down to the size of a card played, so the ring the
     trick makes around it can close in tight rather than reach the seats. */
  const heroH = (g) => (T && T.hero && T.hero.offsetHeight) || 98;
  const heroAt = (g) => tf(0, g.R.cy, 0, 0, g.ch / heroH(g));

  // The way from the middle of the table out to a seat.
  function dirTo(g, p) {
    const s = g.R.at(p), y = s.y - g.R.cy;
    const len = Math.max(1, Math.hypot(s.x, y));
    return { x: s.x / len, y: y / len };
  }

  /* The cards played ring the turned card rather than pile onto it. Every card
     played used to land in the middle, so the second card of every trick
     covered the one thing the middle is there to say.

     The ring is as tight as it will go, because everything else on the table
     is outside it. Two things set it: a card played must clear the turned
     card, and it must clear the card played beside it. Neither is a matter of
     card widths alone -- a played card is turned a little, which widens what
     it covers, and the seats are spread round an ellipse, so the way out to
     one seat is not evenly spaced from the way out to the next. The closest
     pair is the one the ring has to fit. */
  function trickRing(g) {
    const z = Stage.seatScale(g.n);
    const t = 12 * Math.PI / 180;                    // the most a played card is turned
    const hh = ((g.cw * Math.sin(t) + g.ch * Math.cos(t)) * z) / 2;
    const hw = ((g.cw * Math.cos(t) + g.ch * Math.sin(t)) * z) / 2;
    let ring = hh + g.ch / 2 + 4;                    // past the turned card
    /* Two cards clear each other as soon as they are apart across or apart
       down: whichever the ring reaches first is the one to ask for. The seats
       up the sides of the table are all but level with each other, so what
       parts those two is the drop between them, not the step across. */
    for (let p = 0; p < g.n; p++) {
      const a = dirTo(g, p), b = dirTo(g, (p + 1) % g.n);
      const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
      const across = dx > 0.001 ? (hw * 2 + 6) / dx : Infinity;
      const down = dy > 0.001 ? (hh * 2 + 6) / dy : Infinity;
      const need = Math.min(across, down);
      if (need < Infinity) ring = Math.max(ring, need);
    }
    return ring;
  }

  const nameAt = (el, g, p, own) => Stage.nameAt(el, g.R, p, own, g.n, g.W, g.H);

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

  /* The table is up: the deal has played out, or was tapped away, or was never
     played at all. The room waits to hear this before it bids a hand for a bot,
     so that nothing is bid while the cards are still in the air. Once a round. */
  function sayReady() {
    if (watch || !send || me < 0 || ready === key || !virtual()) return;
    ready = key;
    send({ t: 'dealt' });
  }

  /* ---------------- building it ---------------- */

  // A hand, a pile per seat, the turned card, a name under each pile: the deal
  // leaves exactly this standing, and a phone that arrives in the middle of a
  // round has to draw it without one.
  function build(r) {
    const { stage } = mount();
    unpeek();
    stamped = null;
    stage.innerHTML = '';
    const p = ST.play;
    T = { stage, piles: [], labels: [], hero: null, hand: new Map(), table: new Map(),
          slots: [], places: [], won: [], heldWinner: null };
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
    sayReady();
  }

  // What the deal left standing, taken over as it stands.
  function adopt(ctx, r) {
    unpeek();
    stamped = null;
    T = { stage: ctx.stage, piles: (ctx.piles || []).map((a) => (a || []).slice()),
          labels: ctx.labels || [], hero: ctx.hero, hand: new Map(), table: new Map(),
          slots: [], places: [], won: [], heldWinner: null };
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
    // Left where the deal turned it; layout lifts it to its perch from there.
    if (T.hero) own(T.hero, tf(0, g.R.cy, 0, 0, 1.15));
    T.labels.forEach((el) => { if (el) { el.style.opacity = '1'; own(el, el.style.transform || ''); } });
    // The deal faded the dealer's ring in, and a filled animation outranks the
    // style: let it go, or the ring cannot be moved for the rest of the round.
    const ring = T.stage.querySelector('.dring');
    if (ring && ring.getAnimations) {
      ring.getAnimations().forEach((a) => { try { a.cancel(); } catch (e) {} });
    }
    mount();
    head(r);
    reconcile(r);
    paint(r);
    sayReady();
  }

  // The round line at the top, and the trump under it. The deal builds these
  // itself; a table built from nothing has to.
  function head(r) {
    const stage = T.stage;
    let box = stage.querySelector('.deal-head');
    if (!box) {
      const g = geom();
      box = Stage.head(stage, { round: ST.idx + 1, cards: r.cards,
                                ringTop: g.H / 2 + g.R.cy - g.R.ry - 56 }).box;
    }
    // Asked again every paint: the band a toast comes up in follows the ring,
    // and the ring moves when the screen is turned.
    Stage.band(box, geom().H / 2 + geom().R.cy - geom().R.ry - 56);
    box.querySelectorAll('.deal-cap,.deal-status').forEach((el) => { el.style.opacity = '1'; });
    const cap = box.querySelector('.deal-cap');
    if (cap) cap.textContent = `Round ${ST.idx + 1} · ${r.cards} card${r.cards === 1 ? '' : 's'}`;
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
    // A trick that has had its moment is gathered, whatever the server still
    // holds: the cards are on the winner's stack from here.
    const taken = heldTrick(p);
    const gone = !!taken && swept === trickSig(taken);
    const shown = p.trick.length ? p.trick : (taken && !gone ? taken.trick : []);
    const onTable = new Set(shown.map((x) => x.card));
    const inHand = new Set(hand);

    /* A finished trick leaves the middle, and it does not vanish: it goes to
       whoever took it, face down, and joins the little stack of tricks they
       have won -- all of it, fanned across the trick under it. A card standing
       for a trick keeps the stack narrow, but then there is nothing to come
       back out when the round is put away, and a player watching their tricks
       go is watching a count rather than their cards. The deck is 52 either
       way: these are cards the deal has already made. */
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
    const holding = !!taken && !gone;
    const heir = T.heldWinner;
    for (let q = 0; q < ST.seats.length; q++) {
      T.won[q] = T.won[q] || [];
      const target = Math.max(0, (wonBy[q] || 0) - (holding && p.last.winner === q ? 1 : 0));
      while (T.won[q].length > target) {
        (T.won[q].pop() || []).forEach((el) => el.remove());
      }
      while (T.won[q].length < target) {
        // The whole trick goes to whoever took it, not one card standing for
        // it: they are the cards that were played, and they are what comes
        // back out when the round is put away.
        let cards = (heir === q && gathered.length) ? gathered.splice(0, ST.seats.length) : [];
        if (!cards.length) { cards = [cardEl(null, '')]; T.stage.appendChild(cards[0]); }
        cards.forEach((el) => {
          el.classList.remove('mine', 'took', 'up', 'dud', 'drag', 'no');
          el.classList.add('slow', 'gone');
        });
        T.won[q].push(cards);
      }
    }
    gathered.forEach((el) => el.remove());     // nobody's: a round thrown in
    T.heldWinner = holding ? taken.winner : null;

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

    places(g, r, hand.length);

    const taken = heldTrick(p);
    const gone = !!taken && swept === trickSig(taken);
    const shown = p && p.trick.length ? p.trick : (taken && !gone ? taken.trick : []);
    const winner = taken && !gone ? taken.winner : null;
    shown.forEach((x, i) => {
      const el = T.table.get(x.card);
      if (!el) return;
      el.style.zIndex = String(7 + i);
      el.classList.toggle('took', winner !== null && x.p === winner);
      el.classList.remove('slow');       // a card played moves at a card's pace
      // A card being gathered is somewhere between two seats, and the sweep
      // is steering it; its own spot is no longer where it belongs.
      if (!sweeping) at(el, trickAt(g, x.p));
    });

    (T.won || []).forEach((stack, q) => (stack || []).forEach((trick, t) =>
      (trick || []).forEach((el, j) => {
        el.style.zIndex = String(2);
        at(el, wonAt(g, q, t, j));
      })));

    T.piles.forEach((pile, q) => (pile || []).forEach((el, k) => {
      el.style.zIndex = String(k);
      at(el, pileAt(g, q, k, r.cards));
    }));
    if (T.hero) {
      T.hero.classList.add('slow');       // it has a place of its own to glide to
      at(T.hero, heroAt(g));
    }
    T.labels.forEach((el, q) => { if (el) nameAt(el, g, q, q === me); });
    // Who deals, said at the seat rather than in the round line. Placed again
    // with the names, since it is drawn round one of them.
    const ring = Stage.dealerRing(T.stage, { R: g.R, p: r.dealer, n: g.n, W: g.W, H: g.H,
                                            of: r.cards, own: r.dealer === me,
                                            nameEl: T.labels[r.dealer] });
    /* The line a card is dragged over lies along the top of that ring when the
       ring is your own, so it is broken for the word in the same place: one
       line across the table with "dealer" cutting it, rather than a line
       written through the word. Nobody else's ring is on the line. */
    if (ring && T.stage.parentNode) {
      T.stage.parentNode.style.setProperty('--dring-gap',
        r.dealer === me ? (ring.style.getPropertyValue('--dring-gap') || '0px') : '0px');
    }
    if (peeking) peekAt(peeking.q, r);   // the pile may lie somewhere else now
  }

  /* Where a hand was. A seat playing its last card leaves a hole in the table
     -- suddenly nothing where a hand has been all round -- so the last card of
     a hand is played off a dashed outline of itself, and the outline stays
     until the round does not. It is drawn only under that last card, so it is
     never seen between cards and never has to appear from nowhere. */
  function places(g, r, mine) {
    for (let q = 0; q < g.n; q++) {
      let el = T.places[q];
      if (!el) {
        el = document.createElement('div');
        el.className = 'dplace';
        // First on the stage: every card lies over it, whatever its z-index.
        T.stage.insertBefore(el, T.stage.firstChild);
        T.places[q] = el;
      }
      const left = q === me ? mine : (T.piles[q] || []).length;
      el.hidden = left > 1;
      if (el.hidden) continue;
      if (q === me) { at(el, handAt(g, 0, false)); continue; }
      const h = Stage.pile(g.R, Stage.fan(r.cards, g.W, g.H), q, 0, g.n);
      at(el, tf(h.x, h.y, h.tilt, 0, h.z));
    }
  }

  // What each pile is called, which cards you may play, and the line at the
  // bottom that says what to do about it.
  function paint(r) {
    const p = ST.play;
    const bidding = ST.phase === 'bid';
    /* The beat after the last bid, before the first card. The bids are what
       the table is looking at through it, so the piles keep saying what was
       bid rather than flipping to won/bid over the moment. */
    const reading = Game.bidsHeld(ST);
    const asBids = bidding || reading;
    // A bid landing is stamped onto that seat's pile, as on the deal and on
    // the TV screen. What was already on the table when it was stood up is
    // not: there is nothing to compare it with.
    const bids = r.bids || [];
    if (stamped) {
      bids.forEach((b, q) => {
        const had = stamped[q];
        if (b === null || b === undefined || (had !== null && had !== undefined)) return;
        stampBid(q, b, r);
      });
    }
    stamped = bids.slice();
    T.labels.forEach((el, q) => {
      if (!el) return;
      const bid = r.bids ? r.bids[q] : null;
      const won = p ? p.won[q] : null;
      if (q === me) {
        // Your own bid was the lit number on the rail, and the rail goes with
        // the bidding, so while the bids are read your label carries it.
        el.textContent = bidding ? 'Your hand' : reading ? `Your hand · ${bid}` : `You · ${won}/${bid}`;
      } else {
        el.textContent = ST.seats[q].name
          + (asBids ? (bid === null || bid === undefined ? '' : ` · ${bid}`) : ` · ${won}/${bid}`);
      }
      el.classList.toggle('turn', asBids ? ST.turn === q : !!(p && p.turn === q));
      el.classList.toggle('bidin', bid !== null && bid !== undefined);
    });
    peekAt(asBids ? ST.turn : (p ? p.turn : null), r);

    // A card you may not play says so before you try: it is yours to see, so
    // it is dimmed and not hidden.
    const led = ledSuit();
    const mine = !!(p && p.turn === me) && ST.phase === 'tricks';
    const can = mine ? Game.legalPlays(myHand(), led) : null;
    T.hand.forEach((el, c) => el.classList.toggle('dud', !!can && can.indexOf(c) < 0));

    head(r);
    bidRail(r);
    hint(r);
    voteBox();
  }

  /* The pile of the seat the table waits on peeks -- the top card tips up
     and shivers, every few seconds -- the same as on the deal and on the TV
     screen, so whose turn it is reads without the words. Your own seat is
     your hand and the line under it, so it is never peeked. The peek rides
     on the card lying where layout put it, so it is placed again whenever
     that card, or where it lies, changes, and left alone otherwise. */
  function peekAt(q, r) {
    const pile = (T && q !== null && q !== undefined && q !== me) ? T.piles[q] : null;
    const el = pile && pile.length ? pile[pile.length - 1] : null;
    const at = el ? pileAt(geom(), q, pile.length - 1, r.cards) : null;
    if (peeking && peeking.el === el && peeking.at === at) return;
    unpeek();
    if (!el || !UI.fx.on()) return;
    const off = Stage.peek(el, at);
    if (off) peeking = { q, el, at, off };
  }

  // Another seat's bid lands on the top card of their pile. Your own is the
  // lit number on the rail, in your own hand: nothing to stamp.
  function stampBid(q, b, r) {
    const pile = (T && q !== me) ? T.piles[q] : null;
    const el = pile && pile.length ? pile[pile.length - 1] : null;
    if (!el || !UI.fx.on()) return;
    Stage.stamp(T.stage, el, pileAt(geom(), q, pile.length - 1, r.cards), T.labels[q], b);
  }

  function unpeek() {
    if (!peeking) return;
    peeking.off.cancel();
    peeking = null;
  }

  // The vote on a bum deal, the same widget the page under the felt draws. A
  // window that only watches reads the sentence and gets no answers.
  function voteBox() {
    const el = document.querySelector('#deal .felt-vote');
    if (!el || typeof Round === 'undefined') return;
    Round.vote(el, ST, { me: watch ? -1 : me, boss: false, send });
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
    const B = Stage.bidRow(g.W);
    /* Anchored by its foot, not its head: the heading above the fan has to stay
       readable, and a long hand's numbers must grow upward into the empty
       middle of the table and never down over the cards.

       That foot stands over the middle of the fan, which is the room `fan`
       reserves for it. Hung off the lowest card of the fan instead, the row
       crept down as the hand grew -- the outer cards of a long fan sit lower --
       until at seven cards it stood on the heading, and on the word cutting the
       ring round it when the reader is the one dealing. */
    rail.style.bottom = `calc(50% - ${Math.round(g.F.y - B.foot)}px)`;

    // Named, the way the hand below it is named.
    const title = document.createElement('div');
    title.className = 'bidname';
    title.textContent = 'Your bid';
    title.style.bottom = `${Math.round(B.head)}px`;
    rail.appendChild(title);

    const count = r.cards + 1;
    const size = B.size;
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
      s.el.style.transform = `translate(-50%,${Math.round(s.dy) - (up ? 6 : 0)}px) `
        + `rotate(${s.tilt.toFixed(2)}deg) scale(${up ? 1.34 : 1})`;
    });
  }

  // Which number the thumb is on, by the same reckoning the fan uses.
  function bidUnder(px, py) {
    if (!bidSlots.length) return -1;
    const g = geom();
    const rail = document.querySelector('#deal .felt-bids');
    if (!rail || rail.hidden) return -1;
    const B = Stage.bidRow(g.W);
    const foot = g.H / 2 + g.F.y - B.foot;            // the rail's own foot
    const size = B.size;
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
      if (!who) return say('Waiting for a bid.');
      // A seat with nobody behind it stops the table, and the felt should not
      // leave a player guessing why nothing is happening. The bid for it is
      // made from the page under the felt, by whoever runs the table.
      if (!who.online) {
        return say(who.left
          ? `${who.name} left the game. Auto-play has that hand.`
          : `${who.name} is not at the table. The game waits, or the table host bids for them.`);
      }
      return say(`Waiting for ${who.name} to bid.`);
    }
    if (Game.bidsHeld(ST)) {
      const lead = Game.firstLeader(r, ST.seats.length);
      return say(lead === me ? 'Bids are in. You lead the first trick.'
        : `Bids are in. ${ST.seats[lead].name} leads the first trick.`);
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
        ? `${on.name} left the game. Auto-play has that hand.`
        : `${on.name} is not at the table.`);
    }
    return say(`Waiting for ${on ? on.name : 'the next card'}.`);
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

  /* Where the thumb has to get to for the card to be played. It is the thumb
     that is judged, not the card -- the card rides above the thumb, and judging
     the card would make the shortest nudge a played card.

     The height is the stage's: the line is the top of the ring round the
     heading over your hand, so when the deal is yours the two are one mark
     rather than two gold dashed marks that have missed each other. It used to
     be measured off the lowest card of the fan, which sank as the hand grew. */
  function lineY(g) {
    return Stage.playLine(g.W, g.H);
  }

  function showLine(on, g) {
    const overlay = (parts(false) || {}).overlay;
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
    if (e.target && e.target.closest && e.target.closest('.felt-out,.felt-talk,.felt-vote')) return;

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
    if (i < 0) { drop(); return; }
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
             i, moved: false, out: false, was: held === i, told: false };
    lift(i);
    const overlay = (parts(false) || {}).overlay;
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
      const overlay = (parts(false) || {}).overlay;
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
    const overlay = (parts(false) || {}).overlay;
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

  function start(r, carry) {
    // A phone that arrives in the middle of a round has missed the deal, and
    // replaying it would be a lie about where the game is. Only an untouched
    // round is dealt.
    const untouched = ST.phase === 'bid'
      && (r.bids || []).every((b) => b === null || b === undefined)
      && ST.play && !ST.play.trick.length && ST.play.won.every((v) => !v);
    if (!untouched || still()) { build(r); return; }
    // A deck put away by the round before is the deck this one is shuffled
    // from, so the scene carries on from the table rather than opening on one.
    const from = !!carry;

    mount();
    say('');                             // last round's line has no place over a shuffle
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
      keep: true, brief: !long || from, carry: from,
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
  function beatEl() {
    const overlay = parts().overlay;
    let el = overlay.querySelector('.felt-beat');
    if (!el) {
      el = document.createElement('div');
      el.className = 'felt-beat';
      overlay.appendChild(el);
    }
    return el;
  }

  const beatLine = (tag, text) => {
    const x = document.createElement(tag);
    x.textContent = text;
    return x;
  };

  function beat(prev) {
    const bid = prev.bids[me], won = prev.tricks[me];
    const pts = Game.roundScore(bid, won, ST.cfg);
    const el = beatEl();
    el.className = 'felt-beat' + (bid === won ? ' hit' : '');
    el.textContent = '';
    el.append(beatLine('b', bid === won ? 'You made it' : 'You went down'),
              beatLine('span', `bid ${bid} · won ${won}`),
              beatLine('i', `${pts >= 0 ? '+' : ''}${pts} point${Math.abs(pts) === 1 ? '' : 's'}`));
    el.hidden = false;
    return el;
  }

  /* Who took the trick, said over the table while the cards are still in the
     middle -- the same bubble the round's result comes up in, because a table
     has one place it says things. Under the pile, not over it: the card that
     took the trick is half the news. */
  function tookBeat(p, r) {
    const w = p.last.winner, mine = w === me;
    const el = beatEl();
    el.className = 'felt-beat trick' + (mine ? ' hit' : '');
    el.textContent = '';
    // What each seat has against its bid is under its own pile already, so
    // this says the one thing the table does not: who took this one.
    el.append(beatLine('b', mine ? 'You won that trick' : `${ST.seats[w].name} won that trick`),
              beatLine('span', `trick ${p.won.reduce((a, b) => a + b, 0)} of ${r.cards}`));
    el.hidden = false;
    return el;
  }

  /* The bids, up to be read. What each seat bid is already under its own
     pile, so this says the two things the table does not: what they come to
     against the hand, and who leads. The beat is the room's -- there is no
     clock here, only the state going still and moving on again. */
  function bidsBeat(r) {
    const sum = (r.bids || []).reduce((a, v) => a + (v || 0), 0);
    const lead = Game.firstLeader(r, ST.seats.length);
    const el = beatEl();
    el.className = 'felt-beat bids';
    el.textContent = '';
    el.append(beatLine('b', 'Bids are in'),
              beatLine('span', `bids total ${sum} · ${r.cards} trick${r.cards === 1 ? '' : 's'}`),
              beatLine('i', lead === me ? 'You lead' : `${ST.seats[lead].name} leads`));
    el.hidden = false;
  }

  function tellBids(r) {
    const on = Game.bidsHeld(ST) && !still();
    if (on === bidsUp) return;
    bidsUp = on;
    if (on) bidsBeat(r); else endBeat();
  }

  /* The trick comes in the way it went out: each card travels round the ring
     clockwise -- which is the way the seats run, and the order the cards were
     played -- and they meet on the winner's spot. Only then does the stack go
     to the pile beside them. A card that crosses the middle to get there says
     nothing about who won; a card that comes round the table does.

     The way round is drawn rather than stepped from seat to seat, the same as
     the putting away: a card set down at each seat in turn travels in straight
     lines and reads as hopping, and this is meant to read as coming round the
     table.

     Where the card belongs is written to the style first and nothing fills
     forwards, so the arc is only the way it gets there. A card gathered has a
     round still to play -- it goes to a pile, and comes back out when the
     table is put away -- and it must be left owing nothing when it arrives. */
  function sweepIn(taken, sig) {
    if (!T || still() || !UI.fx.on()) return;
    const g = geom(), n = ST.seats.length, win = taken.winner;
    const legs = [];
    taken.trick.forEach((x) => {
      const el = T.table.get(x.card);
      if (!el) return;
      const steps = (((win - x.p) % n) + n) % n;
      if (steps) legs.push({ el, from: x.p, steps });   // the winner's own card stays put
    });
    if (!legs.length) return;
    sweeping = sig;
    /* The longest way round takes the whole sweep, whatever the table size:
       eight seats must not take twice as long to come in as four. The nearer
       seats have proportionally less to do, so they all set off together and
       come in in the order they sit. */
    const most = legs.reduce((a, l) => Math.max(a, l.steps), 0);
    const home = trickAt(g, win);
    legs.forEach(({ el, from, steps }) => {
      at(el, home);              // where it belongs, before it sets off
      if (!el.animate) return;   // and where it simply slides to, with no arc
      el.animate(arcRound(g, from, win, home),
        { duration: Math.max(CARD_MOVE, Math.round(SWEEP * steps / most)),
          easing: ARC_EASE });
    });
  }

  /* The way a trick comes in: round the circle the played cards stand on,
     clockwise from the seat that played the card to the seat that took it,
     turning as it goes from the way it was lying to the way the winner's own
     card lies. It sets off from where the card actually is and ends on the
     spot the table says it belongs, so there is no jump into the movement and
     none out of it.

     Drawn as a run of places along that circle rather than a hop from seat to
     seat -- the same as the putting away, the other way round. */
  function arcRound(g, from, to, home) {
    const r = trickRing(g), z = Stage.seatScale(g.n);
    const d0 = dirTo(g, from), d1 = dirTo(g, to);
    const a0 = Math.atan2(d0.y, d0.x);
    // Clockwise: the ring runs clockwise as the angle grows, which is the way
    // the seats -- and the cards played into them -- run.
    const span = (((Math.atan2(d1.y, d1.x) - a0) % TURN) + TURN) % TURN;
    const t0 = trickTilt(g, from), t1 = trickTilt(g, to);
    // As finely as the putting away is drawn, for as far round as this goes.
    const steps = Math.max(3, Math.round(ARC_STEPS * span / ARC_SWEEP));
    const kf = [{ transform: trickAt(g, from) }];
    for (let i = 1; i < steps; i++) {
      const u = i / steps, a = a0 + span * u;
      kf.push({ transform: tf(Math.cos(a) * r, g.R.cy + Math.sin(a) * r,
                              t0 + (t1 - t0) * u, 0, z) });
    }
    kf.push({ transform: home });
    return kf;
  }

  /* The table puts itself away. Each seat's pile of tricks unwinds: a card
     lifts off the little stack beside the seat and spirals in -- anticlockwise,
     the way round the table opposite to the way a trick was gathered -- coming
     up to size and turning face up as it goes, until it settles under the card
     the deck turned. One card at a time, and the seats in the same
     anticlockwise order, so the whole table unwinds one way.

     The path is drawn rather than stepped between seats: a card set down at
     each seat in turn travels in straight lines and reads as hopping, and this
     is meant to read as an arc. The resting place is written to the card as
     well, so the table is where it says it is even if the arc is cut short.

     `last` is the table the round left behind; the felt has already let go of
     it, so this moves elements and reads no state but the round's. */
  function unwind(last, r, done) {
    if (!last || !T0(last) || still() || !UI.fx.on()) return done(false);
    const g = geom(), n = ST.seats.length;
    const hero = last.hero;
    /* The card the deck turned stands over everything while the tricks come in
       under it, and is still on top when it turns over: what is being built is
       a deck, and that card is the top of it. */
    if (hero && hero.parentNode) hero.style.zIndex = '40';

    /* A trick with a face shows it on the way in: a card put away face down
       says nothing about the hand that was played. A stand-in for a trick this
       phone never saw taken has no face to show, so it stays face down. */
    /* Card by card, trick by trick, and the seats anticlockwise: what leaves
       the table is one stream of cards, each following the last round the same
       arc, rather than a trick landing whole every so often. */
    const legs = [];
    (last.won || []).forEach((stack, q) => (stack || []).forEach((trick, t) => {
      const cards = (trick || []).filter((el) => el && el.parentNode);
      if (!cards.length) return;
      legs.push({ cards, q, t, turn: ((((seatStep(g, q) === 0 ? 0 : n - seatStep(g, q)) % n) + n) % n) });
    }));
    // Anticlockwise round the table from the reader's own seat, and the top of
    // each pile first.
    legs.sort((x, y) => (x.turn - y.turn) || (y.t - x.t));

    /* The names and the outlines under the last hand belong to a round that is
       over, so they go -- but not at the moment the first card lifts. A seat
       whose name goes as its cards do leaves nothing for them to have come
       from. */
    const away = (el) => {
      if (!el || !el.animate) return;
      el.animate([{ opacity: 1 }, { opacity: 0 }],
        { duration: 320, delay: Math.round(UNWIND * 0.45), easing: 'ease-out', fill: 'forwards' });
    };
    (last.labels || []).forEach(away);
    (last.places || []).forEach(away);
    // The ring goes with the names it was drawn round: the next round deals a
    // new one, and it must not be seen standing over an empty table meanwhile.
    away(last.stage && last.stage.querySelector('.dring'));

    /* Every card takes the same time to come in and sets off after the one
       before it. The whole of that is UNWIND where it can be: a hand of many
       tricks closes the gap between cards rather than making the round longer,
       down to a floor that keeps them cards and not a blur. */
    const count = legs.reduce((a, l) => a + l.cards.length, 0);
    const lead = count > 1
      ? Math.max(LEAD_MIN, Math.min(LEAD_MAX, Math.round((UNWIND - ARC) / (count - 1))))
      : 0;
    const k = key;
    let put = 0;
    legs.forEach(({ cards, q, t }) => {
      cards.forEach((el, j) => {
        const face = el.querySelector('.front .big') ? 0 : 180;
        const i = put;
        el.style.zIndex = String(3 + put);
        el.classList.remove('slow');
        const rest = deckAt(g, put, face === 180);
        put += 1;
        if (!el.animate) { el.style.transform = rest; return; }
        /* Forwards, not both: a card holds where the round left it -- on its
           own pile, face down and small -- until its trick's turn comes.
           Filling backwards would put every card into its lifted pose the
           moment the first one set off, so the whole table would turn over at
           once and then a few would trickle in out of poses they had already
           taken. */
        el.animate(arcIn(g, q, t, j, face, rest),
          { duration: ARC, delay: i * lead, easing: ARC_EASE, fill: 'forwards' });
        // And it is where the table says it is once it has got there.
        setTimeout(() => { if (key === k) el.style.transform = rest; }, i * lead + ARC);
      });
    });

    // The last one is in. The turned card goes face down on the pile they have
    // made of themselves, and the deck is whole again.
    const over = Math.max(0, count - 1) * lead + ARC;
    setTimeout(() => {
      if (key !== k || !hero || !hero.parentNode) return;
      hero.classList.add('slow');
      at(hero, deckAt(g, legs.length, true));
    }, over);
    setTimeout(() => { if (key === k) done(true); }, over + 340);
  }

  // Where a seat sits round the ring, counted clockwise from the reader's own.
  const seatStep = (g, q) => ((((q - Math.max(0, me)) % g.n) + g.n) % g.n);

  /* The way a trick comes in: from the little pile beside its seat, round the
     table anticlockwise, closing on the middle as it goes and coming up to the
     size of a card as it turns face up. Drawn as a run of places along the
     spiral rather than a hop from seat to seat, so what it reads as is one
     movement and not a series of them. */
  function arcIn(g, q, t, j, face, rest) {
    const s = g.R.at(q), z = Stage.seatScale(g.n);
    const a0 = Math.atan2((s.y - g.R.cy) / (g.R.ry || 1), s.x / (g.R.rx || 1));
    const to = g.ch / heroH(g);
    /* A card of a trick sits a little wide of the one under it on the way
       round, so a stream of them is a stream and not a line. What keeps them
       apart along the arc is that they set off apart, not this. */
    const wide = 1 + (j % 4) * 0.03;
    // Off the pile it is lying on, so the lift is part of the movement and not
    // a jump into it.
    const kf = [{ transform: wonAt(g, q, t, j) }];
    for (let i = 0; i <= ARC_STEPS; i++) {
      const u = i / ARC_STEPS;
      // Anticlockwise: the ring runs clockwise as the angle grows, so this
      // takes it back the other way.
      const a = a0 - ARC_SWEEP * u;
      const out = (1 - u * u) * (u < 1 ? wide : 1);   // holds its place, then closes in
      const sc = (0.42 * z) + (to - 0.42 * z) * Math.min(1, u * 1.6);
      kf.push({ transform: tf(Math.cos(a) * g.R.rx * out,
                              g.R.cy + Math.sin(a) * g.R.ry * out,
                              (1 - u) * (-4 + (j % 4) * 3), face, sc) });
    }
    kf.push({ transform: rest });
    return kf;
  }

  // Something worth putting away: a table that was never stood up has nothing.
  const T0 = (last) => !!(last && (last.hero || (last.won || []).some((a) => a && a.length)));

  /* Where the deck squares up: the middle of the table, where the turned card
     already lies, with the cards under it stacked a hair apart so the pile
     reads as a pile and not as one card. */
  function deckAt(g, k, face) {
    const lift = Math.min(6, k * 0.5);
    return tf(0, g.R.cy - lift, 0, face ? 180 : 0, g.ch / heroH(g));
  }

  /* Where the round leaves everybody, held over the deck it has just put
     away. The rows are the scorecard's own, so the places and the figures
     read the same way here as on the page underneath, and the scores run up
     from where they stood before this round rather than simply being the new
     ones. What each seat was paid is asked of the rule the scorecard asks. */
  function stands(prev, done) {
    if (typeof Table === 'undefined' || still() || !UI.fx.on()) return done();
    const overlay = parts().overlay;
    let el = overlay.querySelector('.felt-stands');
    if (!el) {
      el = document.createElement('div');
      el.className = 'felt-stands';
      const first = document.createElement('div');
      first.className = 'standings';
      el.appendChild(first);
      overlay.appendChild(el);
    }
    /* The same box every round, kept between them. It is what the rows were
       drawn into last time, and that is where the movement comes from: the
       widths the bars had, and the order the names were in. A box built fresh
       has nothing to have changed from, and the list simply appears in its
       new shape. */
    const box = el.querySelector('.standings');
    const before = ST.totals.map((v, i) => v - Game.roundScore(prev.bids[i], prev.tricks[i], ST.cfg));
    const was = {};
    ST.seats.forEach((s, i) => { was[s.id] = before[i]; });
    // Standing before the rows are drawn, not after: a box that is not laid
    // out has no places to slide from.
    el.hidden = false;
    /* It comes up showing where things stood, and holds there for a moment.
       A list that is already moving as it arrives has moved before anybody
       has found their own row in it. */
    Table.standings(box, Object.assign({}, ST, { totals: before }), { me, lastTotals: was });
    if (el.animate) {
      el.animate([{ opacity: 0, transform: 'translate(-50%,-46%)' },
                  { opacity: 1, transform: 'translate(-50%,-50%)' }],
        { duration: 240, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'both' });
    }
    const k = key;
    // Then what the round did to it: the scores run up, the bars grow, and
    // anybody who has changed places slides past whoever they passed.
    setTimeout(() => {
      if (key !== k) return;
      Table.standings(box, ST, { me, lastTotals: was });
    }, STAND_WAIT);
    setTimeout(() => {
      if (key !== k) return;
      const off = el.animate
        ? el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-out', fill: 'forwards' })
        : null;
      setTimeout(() => {
        el.hidden = true;
        if (key === k) done();
      }, off ? 260 : 0);
    }, STAND_HOLD);
  }

  /* A trick taken is a moment: it is named, and only when that has been read
     are the cards gathered to whoever took them. Without it a trick ends by
     the cards simply being somewhere else. */
  function tellTrick(r) {
    const p = ST.play;
    const taken = heldTrick(p);
    const sig = trickSig(taken);
    if (!taken) {
      if (told) { told = null; swept = null; endBeat(); }
      return;
    }
    if (sig === told) return;
    /* With no movement asked for, or with the felt dropped, nothing is said
       and nothing is gathered early: the trick lies there until the table
       moves on, which is what it does with no help from this screen. */
    if (still() || !want) return;
    told = sig;
    swept = null;
    tookBeat(p, r);
    const k = key;
    // The cards set off while the news is still up and arrive as it goes.
    setTimeout(() => {
      if (told !== sig || key !== k) return;
      sweepIn(taken, sig);
    }, Math.max(0, TOOK_HOLD - SWEEP));
    setTimeout(() => {
      if (told !== sig || key !== k) return;   // the table moved on without us
      swept = sig;
      sweeping = null;
      endBeat();
      const now = round();
      if (T && want && now) { reconcile(now); paint(now); }
    }, TOOK_HOLD);
  }

  function endBeat() {
    const el = document.querySelector('#deal .felt-beat');
    if (el) el.hidden = true;
  }

  function leave() {
    key = null;
    unpeek();
    pausing = false;
    told = null; swept = null; bidsUp = false; sweeping = null;
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
      const last = T;                    // the table this round is leaving behind
      key = k;
      unpeek();
      T = null;
      dealing = false;
      sent = null;
      told = null; swept = null; bidsUp = false; sweeping = null;
      if (!want) return;
      // A round has been played and scored on this table: its result is held up
      // for a moment, over the trick that ended it, before the next deal.
      const prev = ST.idx > 0 ? ST.rounds[ST.idx - 1] : null;
      if (was && prev && Game.roundDone(prev) && !still()) {
        pausing = true;
        beat(prev);
        setTimeout(() => {
          if (!pausing || key !== k) return;
          endBeat();
          // What the round paid has been read; now the table is put away.
          unwind(last, r, (carried) => {
            // The deck is squared up; where the round leaves everybody stands
            // over it, and then the next one is shuffled from it.
            stands(prev, () => {
              pausing = false;
              if (key === k && want && round()) start(round(), carried);
            });
          });
        }, PAID_HOLD);
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
    tellTrick(r);
    tellBids(r);
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
    const overlay = parts().overlay;
    overlay.hidden = false;
    tellTrick(r);
    tellBids(r);
    if (!T) build(r);
    else { mount(); reconcile(r); paint(r); }
    if (onView) onView(true);
  }

  function hide() {
    want = false;
    unpeek();
    drag = null; held = -1;
    if (pausing) { pausing = false; endBeat(); }
    const overlay = (parts(false) || {}).overlay;
    if (overlay) { overlay.hidden = true; overlay.classList.remove('dragging', 'armed'); }
    Stage.bandOff();
    document.body.classList.remove('felt-up');
    if (onView) onView(false);
  }

  const isOpen = () => want && !!T;
  const shown = () => want;

  window.addEventListener('resize', () => { if (T && want) layout(); });

  return { sync, show, hide, isOpen, shown };
})();
