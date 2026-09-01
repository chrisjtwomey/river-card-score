'use strict';
/* Host screen: shows the table, the turn order, and the scorecard. */

const $ = (s) => document.querySelector(s);

let ST = null;          // last state from the server
let dealtKey = null;    // the round already dealt on screen
let lastPhase = null;   // to catch the moment the game ends
let lastDone = null;    // rounds scored, to catch a round landing
let lastTrick = null;   // tricks counted, to catch one landing
let lastTotals = null;  // seat id -> score, to show what a round paid
let lastBids = null;    // { key, bids, turn }, to catch a bid landing
let addr = null;        // the address shown in the QR code

let menu = null;         // the settings page, once the page is wired
let ending = false;      // this screen has asked for the table to be taken away
let SHOW = false;        // this screen shows a table it does not run
let CODE = null;         // the table this screen belongs to
let seenWho = null;      // who was at the table on the state before
let stateAt = 0;         // when the last state landed, so a quiet clock counts on from it

// The dev page, opened on this table so a game in play can be put right.
function devLink() {
  const sess = Net.session(CODE);
  return (sess && sess.code && sess.token) ? `dev.html#c=${sess.code}&t=${sess.token}` : 'dev.html';
}

const newGame = () => Round.newGame(view());

/* ---------- join address and QR ---------- */

function loadAddresses() {
  // The control, the choice and the warning when this machine cannot see its
  // own address are all the same on the player's device, so they live in UI.
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
  // A table named in the address this screen holds nothing for is shown, not
  // asked about: that is what the address says, and showing changes nothing at
  // the table. It is how the front page watches a table this browser has no
  // seat at.
  if (pinned) { enter('show', pinned.toUpperCase().slice(0, 4)); return; }
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
    onState: (m) => { ST = m; stateAt = Date.now(); render(); },
    onError: (msg) => {
      if (ending) return;                             // it is going because this screen said so
      if (!CODE) { pickErr(msg); return; }            // still choosing: say it there
      if (/table is gone|no table/i.test(msg)) {
        Net.forget(CODE);
        if (SHOW) { location.href = 'host.html'; return; }   // ask again, do not invent one
        /* A screen on a wall puts up a fresh table so play can go on. A pane
           inside the dev page must not: its parent heard the same line and is
           already moving to another table -- a table made here would be a
           second one, made by a frame about to be torn down. */
        if (window.top !== window) { CODE = null; return; }
        CODE = null;
        Net.send({ t: 'create' });
        return;
      }
      UI.fx.toast(msg, { err: true, ms: 4000 });   // the same line a bid is said in
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
    dealer: r.dealer,           // who dealt can be corrected while the scene holds
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
  // A copy of a game being watched again is played back at a speed, and this
  // screen draws at it: the table says so, and nothing else here has to know.
  UI.setPlayed(ST.rate || 1);
  Chat.update(ST, null);
  seenWho = Table.sayPresence(ST, -1, seenWho);   // who came, who went
  const lobby = ST.phase === 'lobby';
  UI.keepAwake(!lobby).then((s) => {
    if (s !== 'on' && s !== 'off') console.info('[wake] screen lock status:', s);
  });
  const over = ST.phase === 'done';
  if (over) Games.keep(ST, -1);
  // The settings page holds the screen's own rows, and they read the state
  // themselves. An open page is redrawn so it keeps up with the game.
  if (menu) menu.refresh();

  $('#lobby').hidden = !lobby;
  $('#game').hidden = lobby;
  $('#code-badge').textContent = ST.code;
  $('#code-small').textContent = ST.code;
  renderJoin();
  $('#subtitle').textContent = (SHOW ? 'Showing ' : '') + (lobby
    ? `Table ${ST.code} · waiting to start`
    : `Table ${ST.code} · ${ST.seats.length} players`);
  if (lobby) { Deal.close(); dealtKey = null; lastTotals = lastBids = lastDone = lastTrick = null; renderLobby(); }
  else renderGame();
}

// This screen belongs to nobody, and runs the table unless it is only showing one.
const view = () => ({ me: -1, boss: !SHOW, send: (m) => Net.send(m) });

function renderLobby() {
  const n = ST.seats.length;
  $('#seat-count').textContent = `${n} player${n === 1 ? '' : 's'}`;
  const fd = ST.seats.find((s) => s.id === ST.firstDealerId) || ST.seats[0];
  const capSeat = ST.seats.find((s) => s.id === ST.captainId);
  $('#first-dealer-hint').textContent = fd
    ? `${fd.name} deals the first round` +
      (capSeat ? `, and ${capSeat.name} runs the table from their device.` : '.') +
      ' Drag a player by the handle to change the order; the ⋯ beside a player changes either, or removes them.'
    : '';
  const v = view();
  Lobby.seats($('#seatlist'), ST, v);
  Lobby.bots($('#bot-row'), ST, v);
  Lobby.rulesForm($('#rules-form'), ST, v);
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
  Round.header($('.round-bar'), ST, view());

  dealWatch();
  finaleWatch();
  renderTrump(r);
  renderTurn(r, n);
  Round.vote($('#votebox'), ST, view());
  Round.bum($('#btn-bum'), ST, view());
  // Everything this screen does to a game already going sits in one row under
  // the bids. Each of these hides itself where there is nothing to do, and a
  // screen that only shows a table runs nothing at all.
  Round.pause($('#btn-pause'), ST, view());
  Round.unstick($('#unstick-row'), ST, view());
  Round.resetRound($('#btn-reset-round'), ST, view());
  $('#btn-reset').hidden = SHOW;
  renderTable(r);
  Round.playFor($('#playfor-row'), ST, view());
  renderStandings();
  lastDone = Table.sayRound(ST, -1, lastDone);    // what the round paid everybody
  lastTrick = Table.sayTrick(ST, lastTrick);      // a trick counted, with real cards
  renderScorecard();
  Round.winner($('#winner-panel'), ST);
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
  const vw = view();
  Round.bidFor($('#bidfor-pad'), ST, r, vw);
  Round.playout($('#playout-row'), ST, vw);
  Round.stalled($('#stalled-row'), ST, vw);
  Round.trickCount($('#host-count'), ST, r, vw);
  lastBids = Round.bidStrip($('#bidstrip'), ST, r, vw, lastBids);
  // While the deal is up, the bid stamps onto that player's card instead.
  if (lastBids && !Deal.isOpen('deal')) Table.sayBids(ST, r, lastBids.landed, -1);

  // The round line says the game is over, and the winner panel says who
  // won; this panel keeps only the buttons and the line that names them.
  $('#turn-head').hidden = !r;
  if (!r) {
    $('#turn-hint').textContent = SHOW
      ? 'The table host starts a new game from their device.'
      : 'Press "New game" to play again with the same players.';
    return;
  }
  Round.tally($('#turn-tally'), ST, r);
  $('#turn-tally').className = 'tally';

  if (ST.phase === 'bid') {
    $('#turn-title').textContent = 'Bidding';
    const amender = Game.changeableSeat(r, n);
    $('#turn-hint').textContent = ST.turn === null ? '' :
      `${ST.seats[ST.turn].name} bids now.` +
      (ST.cfg.screw && ST.turn === r.dealer ? ` The dealer cannot make the bids total ${r.cards}.` : '') +
      (amender !== null ? ` ${ST.seats[amender].name} can still change their bid.` : '');
    return;
  }

  const leader = ST.seats[Game.firstLeader(r, n)].name;
  /* The beat between the last bid and the first card. The bids are still up
     on the strip as bids, so this says what the table is looking at and who
     is about to lead; the flip to won/bid is the hand starting. */
  if (Game.bidsHeld(ST)) {
    $('#turn-title').textContent = 'Bids are in';
    $('#turn-hint').textContent = `${leader} leads the first trick.`;
    return;
  }
  if (Game.virtual(ST)) {                          // the cards below do the counting
    const p = ST.play;
    $('#turn-title').textContent = 'Playing the hand';
    $('#turn-hint').textContent = !p || !p.won.some((x) => x)
      ? `${leader} leads the first trick.`
      : 'The cards count the tricks. The round scores itself when the last one is played.';
    return;
  }
  $('#turn-title').textContent = 'Tricks won';
  // The dealer keeps the round. A screen that runs the table can count for it;
  // one that only shows the table names whose job it is and leaves it there.
  const keeper = ST.seats[Game.countingSeat(ST)];
  $('#turn-hint').textContent = `${leader} leads the first trick. ` + (SHOW
    ? `${keeper.name} taps who takes each trick.`
    : `${keeper.name} taps who takes each trick, or tap it here. The last one scores the round.`);
}

// The table, when the deck is virtual: the trick in the middle, and what each
// seat has left. No hands: this screen is the one everybody can see.
function renderTable(r) {
  const panel = $('#table-panel');
  const on = Game.virtual(ST) && ST.phase === 'tricks' && !!r && !!ST.play;
  panel.hidden = !on;
  // Off, the box is emptied with it: nothing peeks behind a hidden panel.
  Table.trickEl($('#trick'), on ? ST : Object.assign({}, ST, { play: null }), -1);
  if (!on) return;
  const p = ST.play;

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
}

function renderStandings() {
  // Who is where, and -- for whoever runs the table -- what may be done about
  // each of them: the one list of everybody a game in play has.
  lastTotals = Table.standings($('#standings'), ST, { lastTotals, view: view(), quietAt: stateAt });
}

function renderScorecard() {
  UI.measureSticky();
  Table.scorecard('#scorecard', ST, -1, view());
}

/* ---------- wiring ---------- */

document.addEventListener('DOMContentLoaded', () => {
  // The host screen has no seat, so it speaks as the table itself.
  Chat.wire('#btn-chat', (text) => Net.send({ t: 'chat', text }));

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
  /* A host screen is read from across the room, so text size belongs here.
     The page holds settings and nothing else: a new game is a button on the
     page, where the game-over line says it is. */
  /* The table is the device's to take away when the device is the one running
     it -- watching a table is otherwise a screen with no way to put it down.
     Never on a TV or a laptop across the room: they only show what is there. */
  const canEnd = () => !!(CODE && UI.servedHere());
  menu = Settings.wire('#btn-settings', { items: UI.commonSettings({ motion: true, zoom: true }).concat([
    { kind: 'group', label: 'This table', hidden: () => !canEnd() },
    { kind: 'action', label: 'End this table', danger: true, hidden: () => !canEnd(),
      run: () => {
        const code = CODE;
        UI.endTable(code, () => { ending = true; })
          .then((gone) => { if (gone) { Net.forget(code); location.href = 'index.html'; } });
      } },
    /* The way to put this game right, wherever it is running: on a normal
       server the page opens with the repair form and the record and nothing
       that invents data. It goes by the host token, so it is offered only
       where this screen holds one -- without it the link opens a page with no
       table, which is no use to anybody. Not inside a dev preview either,
       where it would only open the page it sits in. */
    { kind: 'link', label: 'Dev controls', blank: true,
      hidden: () => window.top !== window || !(Net.session(CODE) || {}).token,
      href: devLink },          // read when the menu draws: there is no table yet here
  ]) });
  $('#btn-reset').addEventListener('click', newGame);
  // playDeal() in the console replays it for the current table.
  window.playDeal = (mode) => playDealNow(mode || 'full');
  // playFinale() in the console replays the result.
  window.playFinale = (mode) => playFinaleNow(mode || 'full');

  boot();
});
