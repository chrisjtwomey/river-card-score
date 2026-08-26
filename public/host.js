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

// The dev page, opened on this table so a game in play can be put right.
function devLink() {
  const sess = Net.session();
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

function boot() {
  Net.claimFromHash('host');
  Net.connect({
    onOpen: () => {
      const s = Net.session();
      if (s && s.role === 'host' && s.code) Net.send({ t: 'resume', code: s.code, token: s.token });
      else Net.send({ t: 'create' });
    },
    onHello: (m) => { $('#code-badge').textContent = m.code; },
    onState: (m) => { ST = m; render(); },
    onError: (msg) => {
      if (/table is gone|no table/i.test(msg)) { Net.setSession(null); Net.send({ t: 'create' }); return; }
      const el = $('#host-err'); el.textContent = msg; el.hidden = false;
      setTimeout(() => { el.hidden = true; }, 4000);
    },
    onDown: () => { $('#netpill').hidden = false; },
    onUp: () => { $('#netpill').hidden = true; },
  });
}

/* ---------- render ---------- */

// The deal on screen belongs to one round and one re-deal of it.
function roundKey() {
  const r = ST && ST.rounds[ST.idx];
  return r ? `${ST.idx}:${r.redeals || 0}` : null;
}

// Deals the round that is on screen, so the button works at any point.
// While the bids are still coming in, the scene stays up.
function playDealNow(mode) {
  if (!ST || !ST.rounds.length) return Promise.resolve(console.warn('[deal] start a game first'));
  const i = Math.min(ST.idx, ST.rounds.length - 1);
  const r = ST.rounds[i];
  const p = Deal.play({
    names: ST.seats.map((s) => s.name),
    dealer: r.dealer, cards: r.cards, round: i + 1,
    hold: ST.phase === 'bid', key: roundKey(),
    // With a virtual deck the table has no cards of its own, so this screen
    // shuffles, deals the whole hand, and turns the card it turned. With real
    // cards the deck on screen shuffles along with the dealer, and deals only
    // once the trump suit is picked.
    deck: ST.cfg.deck,
    avatars: ST.seats.map((s) => Avatar.url(ST.code, s)),
    upcard: ST.play ? ST.play.upcard : null,
    trump: r.trump || null,
    waitTrump: ST.cfg.deck !== 'virtual' && !!ST.cfg.trump && !r.trump && ST.phase === 'bid',
  }, mode);
  pushDealStatus();          // fill in the bids that are already made
  return p;
}

// What the held scene shows: every bid so far and who has to act.
function pushDealStatus() {
  const r = ST && ST.rounds[ST.idx];
  if (!r || !Deal.isOpen('deal')) return;
  const shuffling = ST.cfg.deck !== 'virtual' && ST.cfg.trump && !r.trump;
  Deal.update({
    key: roundKey(),
    bids: r.bids || [],
    turn: ST.turn,
    trump: r.trump || null,
    text: ST.phase !== 'bid' ? 'All bids are in'
      : shuffling ? `${ST.seats[r.dealer].name} shuffles — turn the top card`
      : (ST.turn === null ? 'All bids are in' : `Waiting for ${ST.seats[ST.turn].name} to bid`),
  });
}

// The finish plays once, when the last round is scored. A screen that opens on
// a game already over does not replay it.
function playFinaleNow(mode) {
  if (!ST || !ST.seats.length) return Promise.resolve(console.warn('[finale] no table'));
  return Deal.finale({
    names: ST.seats.map((s) => s.name),
    totals: ST.totals,                       // the accolades are already in these
    awards: ST.awards || [],
    points: ST.cfg.accoladePay,
    bonus: ST.bonus || [],
  }, mode);
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
  if (dealtKey !== roundKey()) { dealtKey = roundKey(); playDealNow(); }
  pushDealStatus();
}

function render() {
  Chat.update(ST, null);
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
  $('#subtitle').textContent = lobby
    ? `Table ${ST.code} · waiting to start`
    : `Table ${ST.code} · ${ST.seats.length} players`;
  if (lobby) { Deal.close(); dealtKey = null; lastTotals = lastBids = null; renderLobby(); }
  else renderGame();
}

function renderLobby() {
  const n = ST.seats.length;
  $('#seat-count').textContent = `${n} player${n === 1 ? '' : 's'}`;
  $('#lobby-wait').hidden = n >= 2;
  renderBots();
  const fd = ST.seats.find((s) => s.id === ST.firstDealerId) || ST.seats[0];
  const capSeat = ST.seats.find((s) => s.id === ST.captainId);
  $('#first-dealer-hint').textContent = fd
    ? `${fd.name} deals the first round. Tap 🂠 beside a player to change it.` +
      (capSeat ? ` ${capSeat.name} runs the table from their phone: tap ★ to pass that on.` : '')
    : '';
  $('#btn-start').disabled = n < 2;
  $('#btn-start').textContent = n < 2 ? 'Waiting for players…' : `Start game with ${n} players`;

  const list = $('#seatlist');
  list.innerHTML = '';
  ST.seats.forEach((s, i) => {
    const isFirst = ST.firstDealerId ? ST.firstDealerId === s.id : i === 0;
    const isCap = s.id === ST.captainId;
    const row = document.createElement('div');
    row.className = 'seat-item' + (s.online ? '' : ' off') + (isFirst ? ' first-dealer' : '');
    row.innerHTML = `<span class="seat">${i + 1}</span><span class="nm"></span>` +
      (isCap ? '<span class="badge">host</span>' : '') +
      (isFirst ? '<span class="badge soft">deals first</span>' : '') +
      `<span class="dotstat" title="${s.online ? 'connected' : 'not connected'}"></span>` +
      `<button class="mini" data-a="cap" title="Make this player the table host" ` +
        `aria-pressed="${isCap}">★</button>` +
      `<button class="mini d" data-a="deal" title="This player deals the first round" ` +
        `aria-pressed="${isFirst}">🂠</button>` +
      `<button class="mini" data-a="up" title="Move up">↑</button>` +
      `<button class="mini" data-a="down" title="Move down">↓</button>` +
      `<button class="mini x" data-a="kick" title="Remove">×</button>`;
    row.querySelector('.nm').textContent = s.name;
    row.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.a;
      if (a === 'kick') Net.send({ t: 'kick', id: s.id });
      else if (a === 'cap') Net.send({ t: 'captain', id: s.id });
      else if (a === 'deal') Net.send({ t: 'config', patch: { firstDealer: isFirst ? null : s.id } });
      else Net.send({ t: 'seatMove', id: s.id, dir: a });
    }));
    list.appendChild(row);
  });

  // rules form, without fighting the field the host is typing in
  const c = ST.cfg, cap = Game.maxCardsFor(Math.max(2, n));
  const setVal = (sel, v) => { const el = $(sel); if (document.activeElement !== el) el.value = String(v); };
  $('#cfg-max').max = String(cap);
  setVal('#cfg-max', c.max);
  setVal('#cfg-ones', c.ones);
  setVal('#cfg-pattern', c.pattern);
  setVal('#cfg-bonus', c.bonus);
  setVal('#cfg-miss', c.miss);
  $('#cfg-screw').checked = !!c.screw;
  $('#cfg-trump').checked = !!c.trump;
  setVal('#cfg-deck', c.deck || 'physical');
  setVal('#cfg-accolade-pay', c.accoladePay === undefined ? 10 : c.accoladePay);
  setVal('#cfg-accolade-count', c.accoladeCount === undefined ? 3 : c.accoladeCount);
  $('#deck-hint').textContent = c.deck === 'virtual'
    ? 'The server deals to each phone, turns the trump, and counts the tricks.'
    : 'You deal real cards. The dealer types in the tricks at the end of a round.';
  $('#max-hint').textContent = `Up to ${cap} cards each with ${Math.max(2, n)} players.`;
  const cards = Game.schedule(c.max, c.pattern, c.ones);
  $('#rounds-hint').textContent = `${cards.length} rounds: ${cards.join(' ')}`;
  const ex = (w) => Game.roundScore(2, w, c);
  $('#miss-hint').textContent = `Bid 2: win 3 = ${ex(3)} · win 2 = ${ex(2)} · win 1 = ${ex(1)}`;
}

/* Players the table provides, for a hand short of people. They hold cards, so
   they belong to a table that deals them. */
function renderBots() {
  const btn = $('#btn-addbot');
  if (!btn) return;
  const bots = ST.seats.filter((s) => s.bot).length;
  const full = ST.seats.length >= 8;
  const cards = ST.cfg.deck === 'virtual';
  btn.disabled = full;
  btn.textContent = bots ? '+ Add another bot' : '+ Add a bot';
  $('#bot-hint').textContent = full ? 'The table is full.'
    : bots ? `${bots} of the ${ST.seats.length} seats play themselves.`
    : cards ? 'It plays its own hand. Remove it with ×.'
    : 'It plays its own hand, so the cards move to the phones.';
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

function renderTrump(r) {
  // With a virtual deck the deck turns the trump, so there is nothing to pick.
  if (ST.cfg.deck === 'virtual') {
    const row = $('#trump-row');
    const up = ST.play && ST.play.upcard;
    row.classList.add('turned');
    $('#trump-picker').innerHTML = '';
    const s = r && r.trump ? Game.SUITS.find((x) => x.k === r.trump) : null;
    $('#trump-now').textContent = !s ? 'No trumps'
      : (up ? `${Game.cardName(up)} — ${s.name}` : s.name);
    return;
  }
  $('#trump-row').classList.remove('turned');
  return renderTrumpPicker(r);
}

function renderTrumpPicker(r) {
  const bar = $('#trump-row');
  if (!ST.cfg.trump || !r) { bar.hidden = true; return; }
  bar.hidden = false;
  const cur = Game.SUITS.find((s) => s.k === r.trump) || null;
  bar.classList.toggle('set', !!cur);
  const now = $('#trump-now');
  now.textContent = cur ? cur.name : 'Turn the top card';
  now.className = 'trump-now' + (cur ? (cur.red ? ' red' : '') : ' unset');
  const pick = $('#trump-picker');
  pick.innerHTML = '';
  Game.SUITS.forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = s.g;
    b.title = s.name;
    b.className = (s.red ? 'red' : '') + (s.k === 'NT' ? ' nt' : '');
    b.setAttribute('aria-pressed', String(r.trump === s.k));
    b.addEventListener('click', () => Net.send({ t: 'trump', k: s.k }));
    pick.appendChild(b);
  });
}

function renderTurn(r, n) {
  const strip = $('#bidstrip');
  strip.innerHTML = '';
  const pad = $('#host-tricks');

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
    return;
  }

  if (ST.cfg.deck === 'virtual') {                 // the cards below do the counting
    const p = ST.play;
    $('#turn-title').textContent = 'Playing the hand';
    $('#turn-tally').textContent = `Bids ${sum} of ${r.cards}`;
    $('#turn-tally').className = 'tally';
    const leader = ST.seats[(r.dealer + 1) % n].name;
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
  const leader = ST.seats[(r.dealer + 1) % n].name;
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

// The rows slide to their new places, the scores run to their new values, and
// what the round paid floats up out of them.
// The table, when the deck is virtual: the trick in the middle, and what each
// seat has left. No hands: this screen is the one everybody can see.
function renderTable(r) {
  const panel = $('#table-panel');
  const on = ST.cfg.deck === 'virtual' && ST.phase === 'tricks' && !!r && !!ST.play;
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

  const stuck = p.turn !== null && !ST.seats[p.turn].online;
  $('#playfor-row').hidden = !stuck;
  if (stuck) $('#btn-playfor').textContent = `Play a card for ${ST.seats[p.turn].name}`;
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

  const patch = (p) => Net.send({ t: 'config', patch: p });
  $('#cfg-max').addEventListener('change', (e) => patch({ max: e.target.value }));
  $('#cfg-ones').addEventListener('change', (e) => patch({ ones: e.target.value }));
  $('#cfg-pattern').addEventListener('change', (e) => patch({ pattern: e.target.value }));
  $('#cfg-bonus').addEventListener('change', (e) => patch({ bonus: e.target.value }));
  $('#cfg-miss').addEventListener('change', (e) => patch({ miss: e.target.value }));
  $('#cfg-screw').addEventListener('change', (e) => patch({ screw: e.target.checked }));
  $('#cfg-trump').addEventListener('change', (e) => patch({ trump: e.target.checked }));
  $('#cfg-deck').addEventListener('change', (e) => patch({ deck: e.target.value }));
  $('#cfg-accolade-pay').addEventListener('change', (e) => patch({ accoladePay: e.target.value }));
  $('#cfg-accolade-count').addEventListener('change', (e) => patch({ accoladeCount: e.target.value }));
  $('#btn-playfor').addEventListener('click', () => Net.send({ t: 'playfor' }));

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

  $('#btn-addbot').addEventListener('click', () => Net.send({ t: 'addbot' }));
  $('#btn-start').addEventListener('click', () => Net.send({ t: 'start' }));
  $('#btn-undo').addEventListener('click', () => Net.send({ t: 'undo' }));
  $('#btn-tricks').addEventListener('click', () => Net.send({ t: 'tricks', values: draft }));
  boot();
});
