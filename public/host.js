'use strict';
/* Host screen: shows the table, the turn order, and the scorecard. */

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let ST = null;          // last state from the server
let draft = [];         // host-side trick entry
let draftKey = '';
let dealtKey = null;    // the round already dealt on screen
let lastPhase = null;   // to catch the moment the game ends
let lastTotals = null;  // seat id -> score, to show what a round paid
let lastBids = null;    // { key, bids, turn }, to catch a bid landing
let addr = null;        // the address shown in the QR code

let menu = null;         // the settings menu, once the page is wired
let SHOW = false;        // this screen shows a table it does not run
let CODE = null;         // the table this screen belongs to
let seenWho = null;      // who was at the table on the state before

// The dev page, opened on this table so a game in play can be put right.
function devLink() {
  const sess = Net.session(CODE);
  return (sess && sess.code && sess.token) ? `dev.html#c=${sess.code}&t=${sess.token}` : 'dev.html';
}

function newGame() {
  UI.ask('New game?', 'The same players stay at the table. The scorecard is deleted.',
    'New game').then((yes) => { if (yes) Net.send({ t: 'reset' }); });
}

/* ---------- join address and QR ---------- */

function loadAddresses() {
  // The control, the choice and the warning when this machine cannot see its
  // own address are all the same on the player's phone, so they live in UI.
  UI.addressPicker($('#addr-mount'), (u) => { addr = u; renderJoin(); });
}

function renderJoin() {
  if (!ST || !addr) return;
  const img = $('#qr');
  img.onerror = () => { $('#qr-err').hidden = false; };
  img.onload = () => { $('#qr-err').hidden = true; };
  const url = `${addr}/?code=${ST.code}`;
  $('#join-url').textContent = url.replace(/^https?:\/\//, '');
  img.src = `/qr.svg?cell=8&d=${encodeURIComponent(url)}`;
  img.alt = `QR code for ${url}`;
}

/* ---------- connection ---------- */

/* This screen belongs to one table. It used to make a new one whenever the
   browser did not already hold a host token, which meant a television could
   not be pointed at a game that was already going: everybody had to move to
   the table the television had just invented. So it asks. */
function boot() {
  Net.claimFromHash('host');
  const pinned = new URLSearchParams(location.search).get('c');
  const s = Net.session(pinned);
  if (s && s.code && (s.role === 'host' || s.role === 'screen')) { enter(null, s.code); return; }
  $('#pick-panel').hidden = false;
}

const pickErr = (msg) => {
  const el = $('#pick-err');
  el.textContent = msg || '';
  el.hidden = !msg;
};

/* `mode` is what to do when this browser holds nothing for the table yet:
   'new' makes one, 'show' asks to be shown the one named. On every reconnect
   after that the table is already known, so neither happens twice. */
function enter(mode, code) {
  CODE = code || null;
  Net.connect({
    onOpen: () => {
      const s = Net.session(CODE);
      if (s && s.role === 'screen' && s.code) Net.send({ t: 'screen', code: s.code });
      else if (s && s.role === 'host' && s.code) Net.send({ t: 'resume', code: s.code, token: s.token });
      else if (mode === 'show') Net.send({ t: 'screen', code: CODE });
      else Net.send({ t: 'create' });
    },
    onHello: (m) => {
      CODE = m.code;
      SHOW = m.role === 'screen';
      document.body.classList.toggle('showing', SHOW);
      // A screen that only shows a table has nothing to say at it.
      $('#btn-chat').hidden = SHOW;
      Net.pin(m.code);
      $('#code-badge').textContent = m.code;
      $('#pick-panel').hidden = true;
      pickErr('');
    },
    onState: (m) => { ST = m; render(); },
    onError: (msg) => {
      if (!CODE) { pickErr(msg); return; }            // still choosing: say it there
      if (/table is gone|no table/i.test(msg)) {
        Net.forget(CODE);
        if (SHOW) { location.href = 'host.html'; return; }   // ask again, do not invent one
        CODE = null;
        Net.send({ t: 'create' });
        return;
      }
      const el = $('#host-err'); el.textContent = msg; el.hidden = false;
      setTimeout(() => { el.hidden = true; }, 4000);
    },
    onDown: () => { $('#netpill').hidden = false; },
    onUp: () => { $('#netpill').hidden = true; },
  });
}

/* ---------- render ---------- */

// Deals the round that is on screen, so the button works at any point.
// While the bids are still coming in, the scene stays up.
function playDealNow(mode) {
  if (!ST || !ST.rounds.length) return Promise.resolve(console.warn('[deal] start a game first'));
  const i = Math.min(ST.idx, ST.rounds.length - 1);
  // With a virtual deck the table has no cards of its own, so this screen
  // shuffles, deals the whole hand, and turns the card it turned. With real
  // cards the real deck on the real table is the one that matters: the scene
  // deals straight through and waits on nobody. While the bids are coming in
  // the scene holds, and the bids are stamped onto it as they land.
  const p = Deal.play(Object.assign(Table.dealOpts(ST, i), {
    hold: ST.phase === 'bid', key: Table.roundKey(ST),
    avatars: ST.seats.map((s) => Avatar.url(ST.code, s)),
  }), mode);
  pushDealStatus();          // fill in the bids that are already made
  return p;
}

// What the held scene shows: every bid so far and who has to act.
function pushDealStatus() {
  const r = ST && ST.rounds[ST.idx];
  if (!r || !Deal.isOpen('deal')) return;
  Deal.update({
    key: Table.roundKey(ST),
    bids: r.bids || [],
    turn: ST.turn,
    trump: r.trump || null,
    text: (ST.phase !== 'bid' || ST.turn === null) ? 'All bids are in'
      : `Waiting for ${ST.seats[ST.turn].name} to bid`,
  });
}

// The finish plays once, when the last round is scored. A screen that opens on
// a game already over does not replay it.
function playFinaleNow(mode) {
  if (!ST || !ST.seats.length) return Promise.resolve(console.warn('[finale] no table'));
  return Deal.finale(Table.finaleOpts(ST), mode);
}

function finaleWatch() {
  if (Table.justFinished(ST, lastPhase)) playFinaleNow();
  lastPhase = ST.phase;
}

let closingDeal = false;   // the held scene is playing the dealer's bid out

function dealWatch() {
  const r = ST.rounds[ST.idx];
  if (ST.phase !== 'bid' || !r) {
    // The dealer's bid ends the bidding, so the scene would close before the
    // stamp ever landed. Push that last bid in and give the table two
    // seconds to read it before the cards come down.
    if (ST.phase === 'tricks' && Deal.isOpen('deal')) {
      if (!closingDeal) {
        closingDeal = true;
        pushDealStatus();
        setTimeout(() => { closingDeal = false; Deal.close('deal'); }, 2000);
      }
    } else if (ST.phase !== 'bid') {
      Deal.close('deal');                         // game over, or back to the lobby
      closingDeal = false;
    }
    if (ST.phase === 'lobby') dealtKey = null;
    return;
  }
  closingDeal = false;
  if (dealtKey !== Table.roundKey(ST)) { dealtKey = Table.roundKey(ST); playDealNow(); }
  pushDealStatus();
}

function render() {
  Chat.update(ST, null);
  seenWho = Table.sayPresence(ST, -1, seenWho);   // who came, who went
  const lobby = ST.phase === 'lobby';
  UI.keepAwake(!lobby).then((s) => {
    if (s !== 'on' && s !== 'off') console.info('[wake] screen lock status:', s);
  });
  const over = ST.phase === 'done';
  if (over) Games.keep(ST, -1);
  // The settings menu holds the screen's own rows, and they read the state
  // themselves. An open menu is redrawn so it keeps up with the game.
  if (menu) menu.refresh();

  $('#lobby').hidden = !lobby;
  $('#game').hidden = lobby;
  $('#code-badge').textContent = ST.code;
  $('#code-small').textContent = ST.code;
  renderJoin();
  $('#subtitle').textContent = (SHOW ? 'Showing ' : '') + (lobby
    ? `Table ${ST.code} · waiting to start`
    : `Table ${ST.code} · ${ST.seats.length} players`);
  if (lobby) { Deal.close(); dealtKey = null; lastTotals = lastBids = null; renderLobby(); }
  else renderGame();
}

// This screen belongs to nobody, and runs the table unless it is only showing one.
const view = () => ({ me: -1, boss: !SHOW, send: (m) => Net.send(m) });

function renderLobby() {
  const n = ST.seats.length;
  $('#seat-count').textContent = `${n} player${n === 1 ? '' : 's'}`;
  $('#lobby-wait').hidden = n >= 2;
  const fd = ST.seats.find((s) => s.id === ST.firstDealerId) || ST.seats[0];
  const capSeat = ST.seats.find((s) => s.id === ST.captainId);
  $('#first-dealer-hint').textContent = fd
    ? `${fd.name} deals the first round. Tap 🂠 beside a player to change it.` +
      (capSeat ? ` ${capSeat.name} runs the table from their phone: tap ★ to pass that on.` : '')
    : '';
  const v = view();
  Lobby.seats($('#seatlist'), ST, v);
  Lobby.bots($('#bot-row'), ST, v);
  Lobby.rulesForm($('#lobby'), ST, v);
  Lobby.startButton($('#btn-start'), ST, v);
}

function renderGame() {
  const n = ST.seats.length;
  const r = ST.rounds[ST.idx] || null;
  const done = ST.phase === 'done';

  $('#round-dots').innerHTML = '';
  ST.rounds.forEach((rr, i) => {
    const d = document.createElement('span');
    d.className = 'dot' + (Game.roundDone(rr) ? ' done' : (i === ST.idx && !done ? ' now' : ''));
    d.title = `Round ${i + 1} · ${rr.cards} cards`;
    $('#round-dots').appendChild(d);
  });

  $('.round-bar').classList.toggle('quiet', done);
  if (r) {
    $('#round-label').textContent = `Round ${ST.idx + 1} of ${ST.rounds.length}` +
      (r.redeals ? ` · re-deal ${r.redeals}` : '');
    $('#round-cards').textContent = r.cards;
    $('#round-dealer').textContent = ST.seats[r.dealer].name;
  } else {
    $('#round-label').textContent = 'Game over';
    $('#round-cards').textContent = '—';
    $('#round-dealer').textContent = '—';
  }

  dealWatch();
  finaleWatch();
  renderTrump(r);
  renderTurn(r, n);
  renderVote(r);
  $('#btn-bum').hidden = !r;
  renderTable(r);
  renderStandings();
  renderScorecard();
  renderWinner(done);
}

function renderVote(r) {
  const box = $('#votebox');
  if (!ST.vote || !r) { box.hidden = true; return; }
  box.hidden = false;
  $('#vote-text').textContent = Table.voteText(ST, -1);
}

// What the deck turned, when the server deals. On a real table the card is
// lying there for everybody to see, so this screen says nothing about it.
function renderTrump(r) {
  const row = $('#trump-row');
  row.hidden = !Game.virtual(ST);
  if (row.hidden) return;
  const up = ST.play && ST.play.upcard;
  const s = r && r.trump ? Game.SUITS.find((x) => x.k === r.trump) : null;
  $('#trump-now').textContent = !s ? 'No trumps'
    : (up ? `${Game.cardName(up)} — ${s.name}` : s.name);
}

function renderTurn(r, n) {
  const strip = $('#bidstrip');
  strip.innerHTML = '';
  const pad = $('#host-tricks');
  $('#bidfor-pad').hidden = true;
  renderPlayout();

  if (!r) {
    $('#turn-title').textContent = 'Game over';
    $('#turn-tally').textContent = '';
    $('#turn-hint').textContent = 'Press "New game" to play again with the same table.';
    pad.hidden = true;
    return;
  }

  Game.bidOrder(r.dealer, n).forEach((p) => {
    const pill = document.createElement('div');
    const bid = r.bids ? r.bids[p] : null;
    const isTurn = ST.turn === p;
    const canAmend = ST.phase === 'bid' && Game.changeableSeat(r, n) === p;
    pill.className = 'bidpill' + (isTurn ? ' now' : '') + (bid !== null ? ' in' : '') + (canAmend ? ' amend' : '');
    pill.dataset.k = String(p);
    if (canAmend) pill.title = 'can still change this bid';
    pill.innerHTML = '<span class="nm"></span><span class="v"></span>';
    pill.querySelector('.nm').textContent = ST.seats[p].name + (p === r.dealer ? ' (D)' : '');
    pill.querySelector('.v').textContent = bid === null ? (isTurn ? 'bidding…' : '—') : bid;
    strip.appendChild(pill);
  });
  lastBids = Table.bidsAfter(strip, ST, r, lastBids);   // a bid lands, the turn moves on
  // While the deal is up, the bid stamps onto that player's card instead.
  if (!Deal.isOpen('deal')) Table.sayBids(ST, r, lastBids.landed, -1);

  const sum = (r.bids || []).reduce((a, v) => a + (v || 0), 0);

  if (ST.phase === 'bid') {
    $('#turn-title').textContent = 'Bidding';
    $('#turn-tally').textContent = `Bids ${sum} of ${r.cards}`;
    $('#turn-tally').className = 'tally';
    const amender = Game.changeableSeat(r, n);
    $('#turn-hint').textContent = ST.turn === null ? '' :
      `${ST.seats[ST.turn].name} bids now.` +
      (ST.cfg.screw && ST.turn === r.dealer ? ` The dealer cannot make the bids total ${r.cards}.` : '') +
      (amender !== null ? ` ${ST.seats[amender].name} can still change their bid.` : '');
    pad.hidden = true;
    renderBidFor(r, n);
    return;
  }

  if (Game.virtual(ST)) {                 // the cards below do the counting
    const p = ST.play;
    $('#turn-title').textContent = 'Playing the hand';
    $('#turn-tally').textContent = `Bids ${sum} of ${r.cards}`;
    $('#turn-tally').className = 'tally';
    const leader = ST.seats[Game.firstLeader(r, n)].name;
    $('#turn-hint').textContent = !p || !p.won.some((x) => x)
      ? `${leader} leads the first trick.`
      : 'The cards count the tricks. The round scores itself when the last one is played.';
    pad.hidden = true;
    return;
  }

  // tricks phase
  $('#turn-title').textContent = 'Tricks won';
  $('#turn-tally').textContent = `Bids ${sum} of ${r.cards}`;
  $('#turn-tally').className = 'tally';
  const leader = ST.seats[Game.firstLeader(r, n)].name;
  $('#turn-hint').textContent = `${leader} leads the first trick. ${ST.seats[r.dealer].name} enters the tricks, ` +
    'or you can enter them here. Everybody starts on 0, so only tap the players who won tricks.';
  pad.hidden = false;

  const key = `${ST.idx}:${ST.phase}`;
  if (draftKey !== key) { draftKey = key; draft = ST.seats.map(() => 0); }

  const rows = $('#trick-rows');
  rows.innerHTML = '';
  ST.seats.forEach((s, p) => {
    const row = document.createElement('div');
    row.className = 'entry-row' + (p === r.dealer ? ' dealer' : '');
    const who = document.createElement('div');
    who.className = 'who';
    const nm = document.createElement('span'); nm.textContent = s.name; who.appendChild(nm);
    const b = document.createElement('span'); b.className = 'badge soft'; b.textContent = `bid ${r.bids[p]}`; who.appendChild(b);
    row.appendChild(who);
    const chips = document.createElement('div');
    chips.className = 'chips';
    const others = draft.reduce((a, v, i) => a + (i === p ? 0 : (v || 0)), 0);
    for (let v = 0; v <= r.cards; v++) {
      const c = document.createElement('button');
      c.type = 'button'; c.className = 'chip'; c.textContent = v;
      c.setAttribute('aria-pressed', String(draft[p] === v));
      if (others + v > r.cards) { c.disabled = true; c.title = `Only ${r.cards - others} tricks are left`; }
      c.addEventListener('click', () => { draft[p] = draft[p] === v ? 0 : v; renderTurn(r, n); });
      chips.appendChild(c);
    }
    row.appendChild(chips);
    rows.appendChild(row);
  });

  const tsum = draft.reduce((a, v) => a + (v || 0), 0);
  const ready = tsum === r.cards;
  const btn = $('#btn-tricks');
  btn.disabled = !ready;
  btn.textContent = ready ? 'Score the round' : `${r.cards - tsum} of ${r.cards} tricks still to give`;
}

/* A phone that is not coming back. This hands the seat to the table for the
   rest of the game, rather than bidding and playing for it a turn at a time. */
function renderPlayout() {
  const row = $('#playout-row');
  const p = Game.awaySeat(ST);
  const on = !SHOW && p >= 0 && Game.virtual(ST);
  row.hidden = !on;
  if (on) $('#btn-playout').textContent = `Let the table play ${ST.seats[p].name}'s hand`;
}

/* Nobody may bid out of turn, so a phone that has gone quiet at the bidding
   stops the whole table. The screen can bid for that seat -- off its own cards
   where there are cards to read. */
function renderBidFor(r, n) {
  const pad = $('#bidfor-pad');
  const p = Game.awaySeat(ST);               // the bidding is stopped on a seat with nobody behind it
  const on = !SHOW && p >= 0;
  pad.hidden = !on;
  if (!on) return;
  const who = ST.seats[p];
  const dealt = Game.virtual(ST);
  const forbidden = Game.forbiddenBid(r, p, ST.cfg, n);
  $('#bidfor-hint').textContent = dealt
    ? `${who.name} is not at the table. Bid from their hand, or tap the number they want.`
    : `${who.name} is not at the table. Tap the bid they want.`;
  const btn = $('#btn-bidfor');
  btn.hidden = !dealt;
  btn.textContent = `Bid for ${who.name}`;
  const chips = $('#bidfor-chips');
  chips.innerHTML = '';
  for (let v = 0; v <= r.cards; v++) {
    const c = document.createElement('button');
    c.type = 'button'; c.className = 'chip'; c.textContent = v;
    if (v === forbidden) { c.disabled = true; c.title = 'Screw the dealer: this bid is not allowed'; }
    c.addEventListener('click', () => {
      chips.querySelectorAll('.chip').forEach((x) => { x.disabled = true; });
      Net.send({ t: 'bidfor', v });
    });
    chips.appendChild(c);
  }
}

// The table, when the deck is virtual: the trick in the middle, and what each
// seat has left. No hands: this screen is the one everybody can see.
function renderTable(r) {
  const panel = $('#table-panel');
  const on = Game.virtual(ST) && ST.phase === 'tricks' && !!r && !!ST.play;
  panel.hidden = !on;
  if (!on) return;
  const p = ST.play;

  Table.trickEl($('#trick'), ST, -1);
  $('#table-title').textContent = p.turn === null && p.last
    ? `${ST.seats[p.last.winner].name} wins the trick`
    : p.turn === null ? 'Dealing…' : `${ST.seats[p.turn].name} to play`;
  const played = p.won.reduce((a, b) => a + b, 0);
  $('#table-tally').textContent = `trick ${Math.min(played + 1, r.cards)} of ${r.cards}`;

  const box = $('#seatcounts');
  box.innerHTML = '';
  ST.seats.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'seatcount' + (p.turn === i ? ' now' : '');
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = s.name + (i === r.dealer ? ' (D)' : '');
    const won = document.createElement('span');
    won.className = 'badge soft';
    won.textContent = `${p.won[i]} of ${r.bids[i]}`;
    const left = document.createElement('span');
    left.className = 'left';
    left.textContent = `${p.counts[i]} card${p.counts[i] === 1 ? '' : 's'}`;
    row.append(nm, won, left);
    box.appendChild(row);
  });

  const away = Game.awaySeat(ST);            // a seat the table itself cannot play
  $('#playfor-row').hidden = away < 0;
  if (away >= 0) $('#btn-playfor').textContent = `Play a card for ${ST.seats[away].name}`;
}

function renderStandings() {
  lastTotals = Table.standings($('#standings'), ST, { lastTotals });
}

function renderScorecard() {
  UI.measureSticky();
  $('#scorecard').innerHTML = Table.scorecardHTML(ST, -1);
  Table.followCurrent('#scorecard');
}

function renderWinner(done) {
  const panel = $('#winner-panel');
  panel.hidden = !done;
  if (!done) return;
  Accolades.render($('#accolades'), ST.awards || [], ST.seats.map((s) => s.name), ST.cfg.accoladePay);
  const { title, order, top } = Table.winner(ST);
  $('#winner-title').textContent = title;
  // The host screen is the only one with room for the whole list.
  const list = $('#winner-list');
  list.innerHTML = '';
  order.forEach((o, i) => {
    const d = document.createElement('div');
    d.className = 'w' + (o.v === top ? ' first' : '');
    const a = document.createElement('span'); a.textContent = `${i + 1}. ${ST.seats[o.i].name}`;
    const b = document.createElement('span'); b.textContent = String(o.v);
    d.append(a, b);
    list.appendChild(d);
  });
}

/* ---------- wiring ---------- */

document.addEventListener('DOMContentLoaded', () => {
  // The host screen has no seat, so it speaks as the table itself.
  Chat.wire('#btn-chat', (text) => Net.send({ t: 'chat', text }));

  $('#btn-playfor').addEventListener('click', () => Net.send({ t: 'playfor' }));
  $('#btn-bidfor').addEventListener('click', () => Net.send({ t: 'bidfor' }));
  $('#btn-playout').addEventListener('click', () => {
    const p = Game.awaySeat(ST);
    const who = p >= 0 ? ST.seats[p].name : 'that seat';
    UI.ask(`Let the table play ${who}'s hand?`,
      `The seat keeps its name and its place on the scorecard, and the table plays it `
      + `from here on. ${who} takes it back by coming to the table on the phone that holds the seat.`,
      'Hand it over').then((yes) => { if (yes) Net.send({ t: 'playout' }); });
  });

  // The two ways this screen can come to a table.
  $('#btn-new-here').addEventListener('click', () => { pickErr(''); enter('new'); });
  const show = () => {
    const c = $('#in-show').value.trim().toUpperCase();
    if (c.length !== 4) return pickErr('Type the 4-character table code.');
    pickErr('');
    enter('show', c);
  };
  $('#btn-show').addEventListener('click', show);
  $('#in-show').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  });
  $('#in-show').addEventListener('keydown', (e) => { if (e.key === 'Enter') show(); });

  loadAddresses();
  UI.startZoom();
  /* A host screen is read from across the room, so text size belongs here, and
     so do the screen's own three: play the flourish again, the dev page for a
     game that needs putting right, and a new game. */
  menu = UI.settingsMenu('#btn-settings', UI.commonSettings({ motion: true, zoom: true }).concat([
    { kind: 'group', label: 'This screen' },
    { kind: 'action',
      label: () => (ST && ST.phase === 'done' ? 'Play the result again' : 'Play the deal again'),
      hidden: () => !ST || ST.phase === 'lobby',
      run: () => (ST && ST.phase === 'done' ? playFinaleNow() : playDealNow()) },
    // Not inside a dev preview, where it would only open the page it sits in.
    { kind: 'link', label: () => (ST && ST.dev ? 'Dev controls' : 'Fix this game'), blank: true,
      hidden: () => window.top !== window,
      href: devLink() },
    { kind: 'action', label: 'New game', danger: true,
      hidden: () => !ST || ST.phase === 'lobby',
      run: newGame },
  ]));
  $('#btn-bum').addEventListener('click', () => {
    UI.ask('Bum deal?', 'The hand is thrown in. The same dealer deals it again, and the bids so far are lost.',
      'Deal again').then((yes) => { if (yes) Net.send({ t: 'bumdeal' }); });
  });
  $('#btn-vote-do').addEventListener('click', () => Net.send({ t: 'bumdeal' }));
  $('#btn-vote-cancel').addEventListener('click', () => Net.send({ t: 'votecancel' }));
  // playDeal() in the console replays it for the current table.
  window.playDeal = (mode) => playDealNow(mode || 'full');
  // playFinale() in the console replays the result.
  window.playFinale = (mode) => playFinaleNow(mode || 'full');

  $('#btn-undo').addEventListener('click', () => Net.send({ t: 'undo' }));
  $('#btn-tricks').addEventListener('click', () => Net.send({ t: 'tricks', values: draft }));
  boot();
});
