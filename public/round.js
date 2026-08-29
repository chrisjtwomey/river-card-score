'use strict';
/* The round in play, drawn the same on the host screen and the phone: the
   round line, the bids as they land, the dealer's trick pad, the pads for a
   seat with nobody behind it, and the winner.

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
     whether the bid was hit or passed. Returns what the strip showed, which
     the caller keeps to see what landed on the next state. */
  function bidStrip(strip, ST, r, view, last) {
    if (!strip) return null;
    strip.innerHTML = '';
    if (!r) return null;
    const n = ST.seats.length;
    const play = ST.phase === 'tricks' && ST.play ? ST.play : null;
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

  /* ---------- the dealer's trick pad ----------
     One row a seat, a chip for every count. Everybody starts on 0, so only
     the winners need a tap, and the chips that would take the total past the
     hand are refused. The draft is the pad's own, and it starts again when
     the round, its re-deal or the phase changes. It is the dealer's to fill,
     or a screen that belongs to nobody and runs the table. */
  let draft = [], draftKey = '';

  function trickPad(root, ST, r, view) {
    if (!root) return;
    const may = !!r && (r.dealer === view.me || (view.me < 0 && view.boss));
    const on = may && ST.phase === 'tricks' && !Game.virtual(ST);
    root.hidden = !on;
    if (!on) return;
    const key = `${Table.roundKey(ST)}:${ST.phase}`;
    if (draftKey !== key) { draftKey = key; draft = ST.seats.map(() => 0); }

    const rows = part(root, '.entry-rows', () => make('div', 'entry-rows'));
    const btn = part(root, '.btn', () => button('btn primary big', 'Score the round'));
    rows.innerHTML = '';
    ST.seats.forEach((s, p) => {
      const row = make('div', 'entry-row' + (p === r.dealer ? ' dealer' : ''));
      const who = make('div', 'who');
      who.appendChild(make('span', '', s.name + (p === view.me ? ' (you)' : '')));
      who.appendChild(make('span', 'badge soft', `bid ${r.bids[p]}`));
      row.appendChild(who);
      const chips = make('div', 'chips');
      const others = draft.reduce((a, v, i) => a + (i === p ? 0 : (v || 0)), 0);
      for (let v = 0; v <= r.cards; v++) {
        const c = chip(v, draft[p] === v, others + v > r.cards ? `Only ${r.cards - others} tricks are left` : null);
        c.addEventListener('click', () => { draft[p] = draft[p] === v ? 0 : v; trickPad(root, ST, r, view); });
        chips.appendChild(c);
      }
      row.appendChild(chips);
      rows.appendChild(row);
    });
    const sum = draft.reduce((a, v) => a + (v || 0), 0);
    const ready = sum === r.cards;
    btn.disabled = !ready;
    btn.textContent = ready ? 'Score the round' : `${r.cards - sum} of ${r.cards} tricks still to give`;
    onClick(btn, () => view.send({ t: 'tricks', values: draft }));
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
        'Auto-play').then((yes) => { if (yes) view.send({ t: 'playout' }); });
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

  /* ---------- the two things a table is asked twice about ---------- */

  function newGame(view) {
    UI.ask('New game?', 'The same players stay at the table. The scorecard is deleted.', 'New game')
      .then((yes) => { if (yes) view.send({ t: 'reset' }); });
  }

  // The dealer and whoever runs the table deal again on the spot, so they are
  // asked first. Anybody else is asking the table, which can still be taken back.
  function bumDeal(view, now) {
    const ask = now
      ? UI.ask('Bum deal?', 'The hand is thrown in. The same dealer deals it again, and the bids so far are lost.', 'Deal again')
      : UI.ask('Call a bum deal?', 'Every player has to agree before the hand is thrown in.', 'Ask the table');
    ask.then((yes) => { if (yes) view.send({ t: 'bumdeal' }); });
  }

  return { header, bidStrip, trickPad, bidFor, playFor, playout, winner, newGame, bumDeal };
})();
