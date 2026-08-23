'use strict';
/* Host screen: shows the table, the turn order, and the scorecard. */

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let ST = null;          // last state from the server
let draft = [];         // host-side trick entry
let draftKey = '';
let dealtKey = null;    // the round already dealt on screen
let addrs = [];         // addresses this server answers on
let addr = null;        // the one shown in the QR code

/* ---------- theme ---------- */
const KEY_THEME = 'river-card-score:theme:v1';
(function () {
  let t = null; try { t = localStorage.getItem(KEY_THEME); } catch (e) {}
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
})();

/* ---------- join address and QR ---------- */

const isLocal = (u) => UI.isLocalUrl(u);

async function loadAddresses() {
  const found = await UI.serverAddresses();
  addrs = found.urls;
  addr = found.best;
  if (!found.ok) $('#qr-err').hidden = false;   // an old server has no /net.json

  const pick = $('#addr-pick');
  pick.innerHTML = '';
  addrs.forEach((u) => {
    const o = document.createElement('option');
    o.value = u; o.textContent = u.replace(/^https?:\/\//, '') + (isLocal(u) ? '  (this machine only)' : '');
    pick.appendChild(o);
  });
  pick.value = addr;
  $('#addr-field').hidden = addrs.length < 2;
  pick.addEventListener('change', () => {
    addr = pick.value;
    UI.rememberAddress(addr);
    renderJoin();
  });
  renderJoin();
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

// A link like play.html#c=CODE&t=TOKEN drops that seat into this browser.
// It is how dev-seed.js hands out seats, and how you move a seat to another
// device: the token is the seat.
function claimFromHash() {
  const h = location.hash || '';
  const q = new URLSearchParams(h.replace(/^#/, ''));
  const code = (q.get('c') || '').toUpperCase();
  const token = q.get('t') || '';
  if (!code || !token) return;
  Net.setSession({ code, token, role: 'host', seatId: null }, window.top !== window.self);
  history.replaceState(null, '', location.pathname + location.search);
}

function boot() {
  claimFromHash();
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
  }, mode);
  pushDealStatus();          // fill in the bids that are already made
  return p;
}

// What the held scene shows: every bid so far and who has to act.
function pushDealStatus() {
  const r = ST && ST.rounds[ST.idx];
  if (!r || !Deal.isOpen()) return;
  Deal.update({
    key: roundKey(),
    bids: r.bids || [],
    turn: ST.turn,
    text: ST.phase !== 'bid' ? 'All bids are in'
      : (ST.turn === null ? 'All bids are in' : `Waiting for ${ST.seats[ST.turn].name} to bid`),
  });
}

function dealWatch() {
  const r = ST.rounds[ST.idx];
  if (ST.phase !== 'bid' || !r) {
    if (ST.phase !== 'bid') Deal.close();     // the bids are in: show the table again
    if (ST.phase === 'lobby') dealtKey = null;
    return;
  }
  if (dealtKey !== roundKey()) { dealtKey = roundKey(); playDealNow(); }
  pushDealStatus();
}

function render() {
  const lobby = ST.phase === 'lobby';
  UI.keepAwake(!lobby).then((s) => {
    if (s !== 'on' && s !== 'off') console.info('[wake] screen lock status:', s);
  });
  $('#btn-deal').hidden = lobby;

  $('#lobby').hidden = !lobby;
  $('#game').hidden = lobby;
  $('#btn-reset').hidden = lobby;
  $('#code-badge').textContent = ST.code;
  $('#code-small').textContent = ST.code;
  renderJoin();
  $('#subtitle').textContent = lobby
    ? `Table ${ST.code} · waiting to start`
    : `Table ${ST.code} · ${ST.seats.length} players`;
  if (lobby) { Deal.close(); dealtKey = null; renderLobby(); } else renderGame();
}

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
  $('#max-hint').textContent = `Up to ${cap} cards each with ${Math.max(2, n)} players.`;
  const cards = Game.schedule(c.max, c.pattern, c.ones);
  $('#rounds-hint').textContent = `${cards.length} rounds: ${cards.join(' ')}`;
  const ex = (w) => Game.roundScore(2, w, c);
  $('#miss-hint').textContent = `Bid 2: win 3 = ${ex(3)} · win 2 = ${ex(2)} · win 1 = ${ex(1)}`;
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
  renderTrump(r);
  renderTurn(r, n);
  renderVote(r, n);
  $('#btn-bum').hidden = !r;
  renderStandings();
  renderScorecard();
  renderWinner(done);
}

function renderVote(r, n) {
  const box = $('#votebox');
  const v = ST.vote;
  if (!v || !r) { box.hidden = true; return; }
  box.hidden = false;
  const yes = v.yes.map((i) => ST.seats[i].name).join(', ');
  $('#vote-text').textContent =
    `${ST.seats[v.by].name} says it is a bum deal. ${v.yes.length} of ${n} agree` +
    (yes ? ` (${yes}).` : '.');
}

function renderTrump(r) {
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
    if (canAmend) pill.title = 'can still change this bid';
    pill.innerHTML = '<span class="nm"></span><span class="v"></span>';
    pill.querySelector('.nm').textContent = ST.seats[p].name + (p === r.dealer ? ' (D)' : '');
    pill.querySelector('.v').textContent = bid === null ? (isTurn ? 'bidding…' : '—') : bid;
    strip.appendChild(pill);
  });

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

  // tricks phase
  $('#turn-title').textContent = 'Tricks won';
  $('#turn-tally').textContent = `Bids ${sum} of ${r.cards}`;
  $('#turn-tally').className = 'tally';
  $('#turn-hint').textContent = `${ST.seats[r.dealer].name} enters the tricks. You can enter them here instead. ` +
    'Everybody starts on 0, so only tap the players who won tricks.';
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

function renderStandings() {
  const box = $('#standings');
  box.innerHTML = '';
  const t = ST.totals;
  const order = t.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const hi = Math.max(...t), lo = Math.min(0, ...t), span = hi - lo;
  order.forEach((o, rank) => {
    const row = document.createElement('div');
    row.className = 'stand-row' + (o.v === hi && hi !== lo ? ' lead' : '');
    const w = span > 0 ? Math.round(((o.v - lo) / span) * 100) : 0;
    row.innerHTML = `<span class="rank">${rank + 1}</span><span class="name"></span>` +
      `<span class="pts">${o.v}</span><span class="bar"><i style="width:${w}%"></i></span>`;
    row.querySelector('.name').textContent = ST.seats[o.i].name;
    box.appendChild(row);
  });
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
  const t = ST.totals;
  const order = t.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const top = order[0].v;
  const champs = order.filter((o) => o.v === top).map((o) => ST.seats[o.i].name);
  $('#winner-title').textContent = champs.length > 1
    ? `Tie: ${champs.join(' and ')} — ${top} points`
    : `${champs[0]} wins with ${top} points`;
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
  $('#btn-theme').addEventListener('click', () => {
    const now = document.documentElement.getAttribute('data-theme');
    const next = now === 'dark' ? 'light' : now === 'light' ? null : 'dark';
    if (next) document.documentElement.setAttribute('data-theme', next);
    else document.documentElement.removeAttribute('data-theme');
    try { next ? localStorage.setItem(KEY_THEME, next) : localStorage.removeItem(KEY_THEME); } catch (e) {}
  });

  const patch = (p) => Net.send({ t: 'config', patch: p });
  $('#cfg-max').addEventListener('change', (e) => patch({ max: e.target.value }));
  $('#cfg-ones').addEventListener('change', (e) => patch({ ones: e.target.value }));
  $('#cfg-pattern').addEventListener('change', (e) => patch({ pattern: e.target.value }));
  $('#cfg-bonus').addEventListener('change', (e) => patch({ bonus: e.target.value }));
  $('#cfg-miss').addEventListener('change', (e) => patch({ miss: e.target.value }));
  $('#cfg-screw').addEventListener('change', (e) => patch({ screw: e.target.checked }));
  $('#cfg-trump').addEventListener('change', (e) => patch({ trump: e.target.checked }));

  UI.wireFullscreen('#btn-full');
  loadAddresses();
  UI.wireZoom('#zoom-out', '#zoom-in');
  $('#btn-deal').addEventListener('click', () => playDealNow());
  $('#btn-bum').addEventListener('click', () => {
    if (confirm('Bum deal? The hand is thrown in and dealt again by the same dealer.')) Net.send({ t: 'bumdeal' });
  });
  $('#btn-vote-do').addEventListener('click', () => Net.send({ t: 'bumdeal' }));
  $('#btn-vote-cancel').addEventListener('click', () => Net.send({ t: 'votecancel' }));
  // playDeal() in the console replays it for the current table.
  window.playDeal = (mode) => playDealNow(mode || 'full');

  $('#btn-start').addEventListener('click', () => Net.send({ t: 'start' }));
  $('#btn-undo').addEventListener('click', () => Net.send({ t: 'undo' }));
  $('#btn-tricks').addEventListener('click', () => Net.send({ t: 'tricks', values: draft }));
  $('#btn-reset').addEventListener('click', () => {
    if (confirm('Start a new game with the same players? The scorecard is deleted.')) Net.send({ t: 'reset' });
  });

  boot();
});
