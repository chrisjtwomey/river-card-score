'use strict';
/* The round in play, drawn the same on the host screen and the phone: the
   round line, the bids as they land, the count of tricks taken, the pads for
   a seat with nobody behind it, and the winner.

   Every widget takes the element it draws into, the state, and a view:
     me     this screen's seat, or -1 for a screen that belongs to nobody
     boss   whether this screen may act for the table
     send   how a message reaches the table
   A widget builds the parts a page's markup does not carry, once, and wires
   its own buttons the first time it draws them; a page calls it on every
   state and adds nothing. What a page does not have is simply not drawn. */
const Round = (function () {
  const q = (root, sel) => (root ? root.querySelector(sel) : null);
  const text = (root, sel, v) => { const el = q(root, sel); if (el) el.textContent = v; };
  // A button is wired the first time it is drawn, and never twice.
  const onClick = (el, fn) => { if (el && !el._wired) { el._wired = true; el.addEventListener('click', fn); } };
  const make = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  };
  const button = (cls, txt) => { const b = make('button', cls, txt); b.type = 'button'; return b; };
  // The part of `root` that matches `sel`; `build` makes it when the page did not.
  /* The hand as it is being played, or null: before the cards are out, and
     through the beat in which the bids stand to be read, there is nothing
     played yet to draw. */
  const playing = (ST) =>
    (ST.phase === 'tricks' && ST.play && !Game.bidsHeld(ST)) ? ST.play : null;

  function part(root, sel, build) {
    let el = q(root, sel);
    if (!el) { root.appendChild(build()); el = q(root, sel); }
    return el;
  }
  // A number to pick. `on` marks it picked; `no` is why it may not be.
  function chip(v, on, no) {
    const c = button('chip', String(v));
    c.setAttribute('aria-pressed', String(!!on));
    if (no) { c.disabled = true; c.title = no; }
    return c;
  }

  /* ---------- the round line ---------- */

  function header(root, ST, view) {
    /* The table has been stopped. Every screen says so, on the round line it
       already has: a hand that is waiting on a bot looks exactly like a hand
       that has hung, and nobody should have to guess which. */
    const mark = q(root, '#round-paused');
    if (mark) mark.hidden = !ST.paused;
    const r = ST.rounds[ST.idx] || null;
    if (!r) {
      text(root, '#round-label', 'Game over');
      text(root, '#round-cards', '—');
      text(root, '#round-dealer', '—');
      return;
    }
    text(root, '#round-label', `Round ${ST.idx + 1} of ${ST.rounds.length}` +
      (r.redeals ? ` · re-deal ${r.redeals}` : ''));
    text(root, '#round-cards', r.cards);
    text(root, '#round-dealer', ST.seats[r.dealer].name + (r.dealer === view.me ? ' (you)' : ''));
  }

  /* ---------- the bids, in bidding order ----------
     One pill a seat. While the bids come in it carries the bid; once the
     cards are out on a table that deals them it carries won/bid, and says
     whether the bid was hit or passed. While the bids are held up to be read
     they are still bids: the flip to won/bid is what says the hand has
     started. Returns what the strip showed, which the caller keeps to see
     what landed on the next state. */
  function bidStrip(strip, ST, r, view, last) {
    if (!strip) return null;
    strip.innerHTML = '';
    if (!r) return null;
    const n = ST.seats.length;
    const play = playing(ST);
    Game.bidOrder(r.dealer, n).forEach((p) => {
      const bid = r.bids ? r.bids[p] : null;
      const won = play ? play.won[p] : null;
      const isTurn = play ? play.turn === p : ST.turn === p;
      const canAmend = ST.phase === 'bid' && Game.changeableSeat(r, n) === p;
      const pill = make('div', 'bidpill' + (isTurn ? ' now' : '') + (bid !== null ? ' in' : '') +
        (canAmend ? ' amend' : '') + (play && won === bid ? ' hit' : '') + (play && won > bid ? ' over' : ''));
      pill.dataset.k = String(p);
      if (canAmend) pill.title = 'can still change this bid';
      pill.innerHTML = '<span class="nm"></span><span class="v"></span>';
      pill.querySelector('.nm').textContent = ST.seats[p].name + (p === r.dealer ? ' (D)' : '');
      pill.querySelector('.v').textContent = play ? `${won}/${bid}`
        : (bid === null ? (isTurn ? 'bidding…' : '—') : bid);
      strip.appendChild(pill);
    });
    return Table.bidsAfter(strip, ST, r, last);   // a bid lands, the turn moves on
  }

  /* ---------- the bids against the hand ----------
     "Bids total 3 · 5 tricks" while the bids come in; "2 of 5 tricks played"
     once the cards are out and the table counts them. The TV screen and the
     phone said it two ways; the figure is the same figure. */
  function tally(el, ST, r) {
    if (!el) return;
    if (!r) { el.textContent = ''; return; }
    const play = playing(ST);
    const sum = (r.bids || []).reduce((a, v) => a + (v || 0), 0);
    el.textContent = play
      ? `${play.won.reduce((a, v) => a + v, 0)} of ${r.cards} tricks played`
      : `Bids total ${sum} · ${r.cards} tricks`;
  }

  /* ---------- the tricks, counted as they are taken ----------
     With real cards the dealer keeps the round, as at a kitchen table: after
     each trick they tap who took it. One row a seat, the row a button; the
     last tap scores the round, and a wrong one is taken back. A screen that
     runs the table and holds no seat counts for the table -- it is the one
     everybody can see. Every other screen sees none of it: the pills carry
     the count for them. */
  function trickCount(root, ST, r, view) {
    if (!root) return;
    const p = ST.play;
    const may = Game.countingSeat(ST) === view.me || (view.me < 0 && view.boss);
    const on = may && !!r && !!playing(ST) && !Game.virtual(ST) && !!p && !!p.log;
    root.hidden = !on;
    if (!on) return;
    const rows = part(root, '.count-rows', () => make('div', 'count-rows'));
    const foot = part(root, '.count-foot', () => make('div', 'count-foot'));
    rows.innerHTML = '';
    ST.seats.forEach((s, i) => {
      const b = button('countrow' + (p.last && p.last.winner === i ? ' took' : ''));
      b.append(make('span', 'nm', s.name + (i === view.me ? ' (you)' : '') + (i === r.dealer ? ' (D)' : '')),
               make('span', 'badge soft', `bid ${r.bids[i]}`),
               make('span', 'won', `won ${p.won[i]}`));
      b.addEventListener('click', () => view.send({ t: 'trick', p: i }));
      rows.appendChild(b);
    });
    foot.innerHTML = '';
    const taken = p.log.length;
    foot.appendChild(make('span', 'hint', `Trick ${Math.min(taken + 1, r.cards)} of ${r.cards}`));
    if (taken > 0) {
      const back = button('btn ghost', 'Take back the last trick');
      back.addEventListener('click', () => view.send({ t: 'trickback' }));
      foot.appendChild(back);
    }
  }

  /* ---------- a seat with nobody behind it ----------
     Nobody may bid or play out of turn, so a phone that has gone quiet stops
     the whole table. Whoever runs the table can act for that seat: bid for
     it -- off its own cards where there are cards to read -- play a card for
     it, or hand the seat to auto-play for good. */

  function bidFor(root, ST, r, view) {
    if (!root) return;
    const p = ST.phase === 'bid' && r ? Game.awaySeat(ST) : -1;
    const on = view.boss && p >= 0 && p !== view.me;
    root.hidden = !on;
    if (!on) return;
    const who = ST.seats[p], dealt = Game.virtual(ST);
    const forbidden = Game.forbiddenBid(r, p, ST.cfg, ST.seats.length);
    const hint = part(root, '.hint', () => make('p', 'hint'));
    const chips = part(root, '.chips', () => make('div', 'chips'));
    const btn = part(root, '.btn', () => {
      const row = make('div', 'row-actions');
      row.appendChild(button('btn ghost', 'Bid for them'));
      return row;
    });
    hint.textContent = dealt
      ? `${who.name} is not at the table. Bid from their hand, or tap the number they want.`
      : `${who.name} is not at the table. Tap the bid they want.`;
    btn.hidden = !dealt;
    btn.textContent = `Bid for ${who.name}`;
    onClick(btn, () => view.send({ t: 'bidfor' }));
    chips.innerHTML = '';
    for (let v = 0; v <= r.cards; v++) {
      const c = chip(v, false, v === forbidden ? 'Screw the dealer: this bid is not allowed' : null);
      c.addEventListener('click', () => {
        chips.querySelectorAll('.chip').forEach((x) => { x.disabled = true; });
        view.send({ t: 'bidfor', v });
      });
      chips.appendChild(c);
    }
  }

  // The server picks the card, and only from the ones the rules allow.
  function playFor(root, ST, view) {
    if (!root) return;
    const p = ST.phase === 'tricks' && Game.virtual(ST) ? Game.awaySeat(ST) : -1;
    const on = view.boss && p >= 0;
    root.hidden = !on;
    if (!on) return;
    const btn = part(root, '.btn', () => button('btn ghost', 'Play a card for them'));
    btn.textContent = `Play a card for ${ST.seats[p].name}`;
    onClick(btn, () => view.send({ t: 'playfor' }));
  }

  /* A phone that is not coming back. The seat keeps its name and its column,
     auto-play takes it from here on, and the phone that holds the seat takes
     it back by coming to the table. Only a table that deals the cards has a
     hand to play. */
  function playout(root, ST, view) {
    if (!root) return;
    const p = Game.awaySeat(ST);
    const on = view.boss && p >= 0 && Game.virtual(ST);
    root.hidden = !on;
    if (!on) return;
    root._who = ST.seats[p].name;               // read at the tap, not at the draw
    const btn = part(root, '.btn', () => button('btn ghost danger', 'Auto-play that hand'));
    btn.textContent = `Auto-play ${root._who}'s hand`;
    onClick(btn, () => {
      const who = root._who || 'that seat';
      UI.ask(`Auto-play ${who}'s hand?`,
        `The seat keeps its name and its place on the scorecard, and auto-play takes the hand `
        + `from here on. ${who} takes it back by coming to the table on the phone that holds the seat.`,
        'Auto-play', true).then((yes) => { if (yes) view.send({ t: 'playout' }); });
    });
  }

  /* ---------- the winner ---------- */

  // Who won, what each player is remembered for, and -- where the page has
  // room for it -- every place.
  function winner(root, ST) {
    if (!root) return;
    const done = ST.phase === 'done';
    root.hidden = !done;
    if (!done) return;
    const { title, order, top } = Table.winner(ST);
    text(root, 'h2', title);
    const acc = q(root, '.accolades');
    if (acc) Accolades.render(acc, ST.awards || [], ST.seats.map((s) => s.name), ST.cfg.accoladePay);
    const list = q(root, '.winner-list');
    if (!list) return;
    list.innerHTML = '';
    order.forEach((o, i) => {
      const d = make('div', 'w' + (o.v === top ? ' first' : ''));
      d.append(make('span', '', `${i + 1}. ${ST.seats[o.i].name}`), make('span', '', String(o.v)));
      list.appendChild(d);
    });
  }

  /* ---------- a bum deal, and the vote on one ----------
     The button and the vote box were each page's own, and the phone's went
     with the panel it sat in: on a table dealt on the phones that panel is
     not there, so no phone could throw a hand in. The dealer and whoever runs
     the table throw it in; a player asks, and the table votes. */

  // `root` is the button, or a row that carries one.
  function bum(root, ST, view) {
    if (!root) return;
    const r = ST.rounds[ST.idx] || null;
    const live = !!r && (ST.phase === 'bid' || ST.phase === 'tricks');
    const may = view.me >= 0 || view.boss;     // a seat asks; a screen that runs the table decides
    const on = live && may && !ST.vote;        // the vote box carries it while a vote is open
    root.hidden = !on;
    if (!on) return;
    const btn = root.tagName === 'BUTTON' ? root : part(root, '.btn', () => button('btn ghost', 'Bum deal'));
    root._now = view.boss || r.dealer === view.me;    // read at the tap, not at the draw
    btn.textContent = root._now ? 'Bum deal' : 'Ask for a bum deal';
    onClick(btn, () => bumDeal(view, !!root._now));
  }

  /* The sentence, and the answers. A phone answers; a screen that runs the
     table ends it either way; a screen that only shows the table reads it. */
  function vote(root, ST, view) {
    if (!root) return;
    const r = ST.rounds[ST.idx] || null;
    const v = ST.vote;
    const on = !!v && !!r && (ST.phase === 'bid' || ST.phase === 'tricks');
    root.hidden = !on;
    if (!on) return;
    const text = part(root, '.vote-text', () => make('div', 'vote-text'));
    const acts = part(root, '.row-actions', () => make('div', 'row-actions'));
    text.textContent = Table.voteText(ST, view.me);
    // Built afresh on every state: a vote cast is said, and the other answer
    // stays, so a mind can be changed.
    acts.innerHTML = '';
    const say = (cls, label, fn) => { const b = button(cls, label); b.addEventListener('click', fn); acts.appendChild(b); };
    const me = view.me;
    if (me >= 0) {
      if (v.by === me) { say('btn ghost', 'Withdraw the vote', () => view.send({ t: 'votecancel' })); return; }
      if (v.yes.includes(me)) acts.appendChild(make('span', 'hint', 'You agreed. Waiting for the others.'));
      else say('btn primary', 'Agree, deal again', () => view.send({ t: 'vote', agree: true }));
      say('btn ghost', 'No, play on', () => view.send({ t: 'vote', agree: false }));
      return;
    }
    if (!view.boss) return;
    say('btn primary', 'Throw it in now', () => bumDeal(view, true));   // asked first, like the button
    say('btn ghost', 'Withdraw the vote', () => view.send({ t: 'votecancel' }));
  }

  /* ---------- the three things a table is asked twice about ---------- */

  /* A step back takes bids or a score with it, and on a table that deals the
     cards it deals the round again, so it is asked first and told what goes.
     The server decides what is undone; this says the same thing before the
     tap lands. */
  function undo(view, ST) {
    if (!ST || ST.phase === 'lobby') return;
    const back = ST.phase === 'tricks' ? ST.idx : ST.phase === 'done' ? ST.rounds.length - 1 : ST.idx - 1;
    if (back < 0) { view.send({ t: 'undo' }); return; }   // nothing to undo: the table says so
    const body = Game.virtual(ST)
      ? `Round ${back + 1} is dealt again and bid again.`
      : ST.phase === 'tricks'
        ? `The bids of round ${back + 1} are cleared, and it is bid again.`
        : `Round ${back + 1} is unscored, and its tricks are counted again.`;
    UI.ask('Undo the last step?', body, 'Undo', true).then((yes) => { if (yes) view.send({ t: 'undo' }); });
  }

  function newGame(view) {
    UI.ask('New game?', 'The same players stay at the table. The scorecard is deleted.', 'New game', true)
      .then((yes) => { if (yes) view.send({ t: 'reset' }); });
  }

  // The dealer and whoever runs the table deal again on the spot, so they are
  // asked first. Anybody else is asking the table, which can still be taken back.
  /* Stop the table playing its own hands, and let it go again. Offered only
     where there are hands it plays for itself -- a bot's, or a seat handed
     over to it -- so a table of people never sees it. Being stopped does not
     take the button away: it is how you start it again. */
  function pause(root, ST, view) {
    if (!root) return;
    const on = view.boss && Game.canPause(ST);
    root.hidden = !on;
    if (!on) return;
    root._now = !!ST.paused;                  // read at the tap, not at the draw
    root.textContent = root._now ? '▶ Play' : '❚❚ Pause';
    root.title = root._now
      ? 'Let the table play the hands nobody is behind again'
      : 'Stop the table playing the hands nobody is behind. Everybody else plays on.';
    root.setAttribute('aria-pressed', String(root._now));
    onClick(root, () => view.send({ t: 'pause', on: !root._now }));
  }

  function bumDeal(view, now) {
    const ask = now
      ? UI.ask('Bum deal?', 'The hand is thrown in. The same dealer deals it again, and the bids so far are lost.', 'Throw the hand in')
      : UI.ask('Ask for a bum deal?', 'Every player has to agree before the hand is thrown in.', 'Ask the table');
    ask.then((yes) => { if (yes) view.send({ t: 'bumdeal' }); });
  }

  return { header, bidStrip, tally, trickCount, bidFor, playFor, playout, winner, bum, vote, pause, newGame, bumDeal, undo };
})();
