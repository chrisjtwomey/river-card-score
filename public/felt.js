'use strict';
/* The table, and the whole round played on it.

   The deal used to be a flourish: a card flew to each seat, your hand landed
   in a fan, and two seconds later the lot was thrown away and the same hand
   was drawn again as a row of flat buttons on the page. This is the other way
   round. The deal is the first move of the round and the felt it lands on is
   the screen you play on: your hand is the fan you were dealt, the card the
   deck turned stays in the middle, and the cards you play go on top of it.

   The page underneath keeps everything else -- the round bar, the bids, the
   standings, the scorecard -- and the button in the corner drops the felt away
   to reach it.

   Nothing here decides anything. The rules live on the server, which is what
   stops a phone from reneging; every card, bid and trick in here came out of
   the state, and every move goes back as a message.
*/
const Felt = (function () {
  const { cardEl, tf, faceOf, overlayEl } = Stage;

  let ST = null, me = -1, send = null, watch = false;
  let key = null;                  // the round on the table: `idx:redeals`
  let dealing = false;             // a deal is in the air; the table is its own
  let dealtOnce = false;           // the first deal of a game is the long one
  let want = true;                 // the reader wants the felt, not the page
  let T = null;                    // the table: every element standing on it
  let onView = null;               // the page, told when the felt comes and goes

  const virtual = () => !!(ST && ST.cfg && ST.cfg.deck === 'virtual');
  const round = () => (ST && ST.rounds ? ST.rounds[ST.idx] || null : null);
  const suitName = (k) => {
    const s = Game.SUITS.find((x) => x.k === k);
    return s ? s.name.toLowerCase() : 'the suit led';
  };

  /* ---------------- the overlay, and the way out of it ---------------- */

  // The felt borrows the stage every scene uses, and marks it: a table is not
  // tapped away, so the "tap to skip" line and the pointer cursor go.
  function mount() {
    const overlay = overlayEl();
    overlay.classList.add('table');
    if (!overlay.querySelector('.felt-out')) {
      const out = document.createElement('button');
      out.className = 'felt-out';
      out.type = 'button';
      out.title = 'The round, the bids and the scorecard';
      out.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true">'
        + '<rect x="2.5" y="3" width="15" height="14" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/>'
        + '<path d="M2.5 7.5h15M8 7.5V17M2.5 12h15" stroke="currentColor" stroke-width="1.3" fill="none"/>'
        + '</svg><span>Scorecard</span>';
      out.addEventListener('click', () => hide());
      overlay.appendChild(out);
    }
    if (!overlay.querySelector('.felt-hint')) {
      const hint = document.createElement('p');
      hint.className = 'felt-hint';
      overlay.appendChild(hint);
    }
    return { overlay, stage: overlay.querySelector('.deal-stage') };
  }

  function unmount() {
    const overlay = document.getElementById('deal');
    if (!overlay) return;
    overlay.classList.remove('table');
    const out = overlay.querySelector('.felt-out');
    if (out) out.remove();
    const hint = overlay.querySelector('.felt-hint');
    if (hint) hint.remove();
  }

  /* ---------------- where everything sits ---------------- */

  /* The same two answers the deal used, asked again: the fan closes up as the
     hand is played, so it is asked on every change and not kept. */
  function geom() {
    const overlay = overlayEl();
    const W = overlay.clientWidth, H = overlay.clientHeight;
    const n = ST.seats.length;
    const R = Stage.ring(n, Math.max(0, me), W, H);
    return { W, H, n, R, seat: R.at(Math.max(0, me)) };
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
  // it, so nothing jumps at the handover.
  function handAt(g, i, of) {
    const F = Stage.fan(of, g.W, g.H);
    const spot = F.at(i);
    return tf(g.seat.x + spot.x, spot.y,
              (g.seat.x / (g.R.rx || 1)) * 9 + spot.tilt, 0, 1);
  }

  function nameAt(el, g, p, own) {
    const s = g.R.at(p);
    const F = Stage.fan(1, g.W, g.H);
    el.style.left = `calc(50% + ${own ? 0 : s.x}px)`;
    el.style.top = `calc(50% + ${own ? F.y - 76 : s.y + 56}px)`;
  }

  /* ---------------- building it ---------------- */

  // A hand, a pile per seat, the turned card, a name under each pile: the deal
  // leaves exactly this standing, and a phone that arrives in the middle of a
  // round has to draw it without one.
  function build(r) {
    const { stage } = mount();
    stage.innerHTML = '';
    const g = geom();
    const p = ST.play;
    T = { stage, piles: [], labels: [], hero: null, hand: new Map(), calm: Stage.mode() !== 'full' };

    for (let q = 0; q < g.n; q++) {
      T.piles[q] = [];
      if (q === me) continue;
      const held = p.counts ? (p.counts[q] || 0) : r.cards;
      for (let k = 0; k < held; k++) {
        const el = cardEl(null, '', k === held - 1 ? Avatar.url(ST.code, ST.seats[q]) : null);
        el.style.transform = pileAt(g, q, k, r.cards);
        stage.appendChild(el);
        T.piles[q].push(el);
      }
    }

    // Your own cards are a fan, face up, and yours alone: the server sends the
    // hand only to the socket that holds it.
    (ST.hand || []).forEach((c) => {
      const el = cardEl(faceOf(c), 'mine');
      stage.appendChild(el);
      T.hand.set(c, el);
    });

    const hero = cardEl(faceOf(p.upcard), 'hero');
    hero.style.transform = tf(0, -10, 0, 0, 1.15);
    stage.appendChild(hero);
    T.hero = hero;

    for (let q = 0; q < g.n; q++) {
      const own = q === me;
      const el = document.createElement('div');
      el.className = 'dname' + (own ? ' mine' : '');
      el.style.opacity = '1';
      nameAt(el, g, q, own);
      stage.appendChild(el);
      T.labels[q] = el;
    }

    head(r);
    layout();
    paint(r);
  }

  // What the deal left standing, taken over as it stands.
  function adopt(ctx, r) {
    T = { stage: ctx.stage, piles: (ctx.piles || []).map((a) => (a || []).slice()),
          labels: ctx.labels || [], hero: ctx.hero, hand: new Map(), calm: ctx.calm };
    const mineCards = T.piles[me] || [];
    (ST.hand || []).forEach((c, i) => { if (mineCards[i]) T.hand.set(c, mineCards[i]); });
    T.piles[me] = [];                      // your cards are a hand now, not a pile
    layout();
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

  // Every card on the table, put where it belongs now. The fan closes up as
  // the hand is played, so this runs on every change and not only on a resize.
  function layout() {
    if (!T || !ST) return;
    const r = round();
    if (!r) return;
    const g = geom();
    const hand = ST.hand || [];
    hand.forEach((c, i) => {
      const el = T.hand.get(c);
      if (el) el.style.transform = handAt(g, i, hand.length);
    });
    T.piles.forEach((pile, q) => (pile || []).forEach((el, k) => {
      el.style.transform = pileAt(g, q, k, r.cards);
    }));
    if (T.hero) T.hero.style.transform = tf(0, -10, 0, 0, 1.15);
    T.labels.forEach((el, q) => { if (el) nameAt(el, g, q, q === me); });
  }

  /* The cards, against the state. A card that has left your hand goes; a card
     the state has and the table does not is drawn. Then everything is placed
     again, because a fan of six is not a fan of seven with one taken out. */
  function reconcile(r) {
    const hand = ST.hand || [];
    const want = new Set(hand);
    T.hand.forEach((el, c) => {
      if (want.has(c)) return;
      el.remove();
      T.hand.delete(c);
    });
    hand.forEach((c) => {
      if (T.hand.has(c)) return;
      const el = cardEl(faceOf(c), 'mine');
      T.stage.appendChild(el);
      T.hand.set(c, el);
    });

    // The other seats' piles thin as they play. The server says how many each
    // still holds, so the pile is trimmed from the top -- the last card dealt
    // is the first one off.
    const counts = (ST.play && ST.play.counts) || [];
    T.piles.forEach((pile, q) => {
      if (q === me || !pile) return;
      const held = counts[q] === undefined ? pile.length : counts[q];
      while (pile.length > held) { const el = pile.pop(); if (el) el.remove(); }
    });
    layout();
  }

  // What each pile is called, what the table is doing, and the line at the
  // bottom that says what you may do about it.
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
      el.classList.toggle('turn', bidding ? ST.turn === q : (p && p.turn === q));
      el.classList.toggle('bidin', bid !== null && bid !== undefined);
    });
    head(r);
    hint(r);
  }

  function hint(r) {
    const el = document.querySelector('#deal .felt-hint');
    if (!el) return;
    const p = ST.play;
    const bidding = ST.phase === 'bid';
    let say;
    if (watch) {
      say = 'You are watching this table.';
    } else if (bidding) {
      // The bid pad is still on the page behind the felt, so the felt says
      // where to find it.
      say = ST.turn === me
        ? 'Your bid — tap Scorecard to make it.'
        : `Waiting for ${ST.seats[ST.turn] ? ST.seats[ST.turn].name : 'the table'} to bid.`;
    } else if (!p) {
      say = 'Dealing…';
    } else if (p.turn === me) {
      const led = p.trick.length ? Game.suitOf(p.trick[0].card) : null;
      const can = Game.legalPlays(ST.hand || [], led);
      say = !led ? 'Your lead — tap Scorecard to play a card.'
        : can.length === (ST.hand || []).length ? `You have no ${suitName(led)}, so play anything.`
        : `Follow ${suitName(led)}.`;
    } else if (p.turn === null) {
      say = p.last
        ? (p.last.winner === me ? 'You won it.' : `${ST.seats[p.last.winner].name} won that trick.`)
        : 'Waiting…';
    } else {
      say = `Waiting for ${ST.seats[p.turn].name}.`;
    }
    el.textContent = say;
  }

  /* ---------------- coming and going ---------------- */

  function start(r) {
    // A phone that arrives in the middle of a round has missed the deal, and
    // replaying it would be a lie about where the game is. Only an untouched
    // round is dealt.
    const untouched = ST.phase === 'bid'
      && (r.bids || []).every((b) => b === null || b === undefined)
      && ST.play && !ST.play.trick.length && ST.play.won.every((v) => !v);
    if (!untouched || Stage.mode() === 'off') { build(r); return; }

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

    const k = `${ST.idx}:${r.redeals || 0}`;
    if (k !== key) {
      key = k;
      T = null;
      dealing = false;
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
    if (!T) build(r); else { mount(); layout(); paint(r); }
    if (onView) onView(true);
  }

  function hide() {
    want = false;
    const overlay = document.getElementById('deal');
    if (overlay) overlay.hidden = true;
    if (onView) onView(false);
  }

  const isOpen = () => want && !!T;
  const shown = () => want;

  window.addEventListener('resize', () => { if (T && want) layout(); });

  return { sync, show, hide, isOpen, shown };
})();
