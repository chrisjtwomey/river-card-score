'use strict';
/* Player view: your bid pad, and the trick pad when you are the dealer. */

const $ = (s) => document.querySelector(s);

let ST = null, ME = null;      // ME = my seat id
let WATCH = false;             // this window only shows the seat, it cannot act
let lastTotals = null;         // seat id -> score, to show what a round paid
let lastBids = null;           // { key, bids, turn }, to catch a bid landing
let draft = [], draftKey = '';
let dealtKey = null;           // the round already dealt on this phone
let lastPhase = null;          // to catch the moment the game ends
let joinAddr = null;           // the address the others should open

const KEY_THEME = 'river-card-score:theme:v1';
(function () {
  let t = null; try { t = localStorage.getItem(KEY_THEME); } catch (e) {}
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
})();

const mySeat = () => (ST && ME ? ST.seats.findIndex((s) => s.id === ME) : -1);
const amHost = () => !!(ST && ME && ST.captainId === ME);

// A link like play.html#c=CODE&t=TOKEN drops that seat into this browser.
// It is how the dev page hands out seats, and how you move a seat to another
// device: the token is the seat.
// With w= instead of t= the page only watches: it shows that seat's screen,
// off the same state, but it cannot touch the game.
function claimFromHash() {
  const h = location.hash || '';
  const q = new URLSearchParams(h.replace(/^#/, ''));
  const code = (q.get('c') || '').toUpperCase();
  const token = q.get('t') || '';
  const eye = q.get('w') || '';
  if (!code || (!token && !eye)) return;
  // Inside the dev previews, keep it in this frame only. A watching window
  // never saves itself at all, so it cannot evict your own seat.
  const framed = window.top !== window.self;
  Net.setSession({ code, token: eye || token, role: eye ? 'watch' : 'player', seatId: null },
    !!eye || framed);
  // The link stays in the address bar for anything held in memory, so the page
  // still knows its seat if it reloads. A seat claimed for keeps drops it.
  if (!eye && !framed) history.replaceState(null, '', location.pathname + location.search);
}

function boot() {
  claimFromHash();
  const s = Net.session();
  if (!s || !s.code || (s.role !== 'player' && s.role !== 'watch')) { location.href = 'index.html'; return; }
  WATCH = s.role === 'watch';
  document.body.classList.toggle('watching', WATCH);
  $('#watchpill').hidden = !WATCH;
  ME = s.seatId;                       // null after a hash claim: the hello fills it in
  Net.connect({
    onOpen: () => Net.send(WATCH
      ? { t: 'watch', code: s.code, token: s.token }
      : { t: 'resume', code: s.code, token: s.token }),
    onHello: (m) => { ME = m.seatId; },
    onState: (m) => { ST = m; render(); },
    onError: (msg) => {
      if (/seat is gone|table is gone/i.test(msg)) { Net.setSession(null); location.href = 'index.html'; return; }
      const el = $('#play-err'); el.textContent = msg; el.hidden = false;
      setTimeout(() => { el.hidden = true; }, 3500);
    },
    onKicked: () => { location.href = 'index.html'; },
    onDown: () => { $('#netpill').hidden = false; },
    onUp: () => { $('#netpill').hidden = true; },
  });
}

function render() {
  const me = mySeat();
  if (me < 0) {
    if (!ME) return;                   // the hello has not arrived yet
    Net.setSession(null); location.href = 'index.html'; return;
  }
  $('#my-name').textContent = ST.seats[me].name;
  $('#subtitle').textContent = `Table ${ST.code} · seat ${me + 1} of ${ST.seats.length}`;

  const lobby = ST.phase === 'lobby';
  $('#lobby').hidden = !lobby;
  $('#game').hidden = lobby;
  renderCaptain(lobby);
  if (lobby) { lastTotals = lastBids = null; return renderLobby(me); }

  const r = ST.rounds[ST.idx] || null;
  dealWatch(r);
  finaleWatch();
  UI.keepAwake(ST.phase !== 'lobby').then((s) => {
    if (s !== 'on' && s !== 'off') console.info('[wake] screen lock status:', s);
  });
  renderRound(r, me);
  renderTurn(r, me);
  renderPlay(r, me);
  renderWinner();
  renderVote(r, me);
  renderBidStrip(r);
  renderStandings(me);
  UI.measureSticky();
  $('#scorecard').innerHTML = Table.scorecardHTML(ST, me);
  Table.followCurrent('#scorecard');
}

// What each player is remembered for, once the last round is scored.
function renderWinner() {
  const panel = $('#winner-panel');
  const done = ST.phase === 'done';
  panel.hidden = !done;
  if (!done) return;
  const t = ST.totals, top = Math.max.apply(null, t);
  const champs = ST.seats.filter((s, i) => t[i] === top).map((s) => s.name);
  $('#winner-title').textContent = champs.length > 1
    ? `${champs.join(' & ')} tie on ${top}`
    : `${champs[0]} wins with ${top}`;
  Accolades.render($('#accolades'),
    Accolades.list(ST.rounds, ST.seats.length, (b, w) => Game.roundScore(b, w, ST.cfg)),
    ST.seats.map((s) => s.name));
}

// The hand, when the table plays with a virtual deck. The server holds the
// cards and the rules; this draws them and sends the one that is tapped.
function renderPlay(r, me) {
  const panel = $('#play-panel');
  const bidding = ST.phase === 'bid';
  const on = ST.cfg.deck === 'virtual' && (bidding || ST.phase === 'tricks') && !!r && !!ST.play;
  panel.hidden = !on;
  if (!on) return;
  const p = ST.play;
  const suit = (k) => (Game.SUITS.find((x) => x.k === k) || { name: 'none', g: '—' });

  Table.trickEl($('#trick'), ST, me);
  $('#play-title').textContent = bidding ? 'Your cards' : 'The hand';
  $('#play-tally').textContent = bidding
    ? `trump ${suit(r.trump).g} · ${r.cards} card${r.cards === 1 ? '' : 's'}`
    : `you bid ${r.bids[me]} · won ${p.won[me]} of ${r.cards}`;

  const hand = ST.hand || [];
  const led = p.trick.length ? Game.suitOf(p.trick[0].card) : null;
  const mine = p.turn === me;
  const can = mine ? Game.legalPlays(hand, led) : [];
  const box = $('#hand');
  box.innerHTML = '';
  hand.forEach((c) => {
    const el = Table.cardEl(c, 'button');
    el.type = 'button';
    el.disabled = !mine || can.indexOf(c) < 0;
    if (!el.disabled) el.classList.add('live');
    el.addEventListener('click', () => {
      box.querySelectorAll('.pcard').forEach((x) => { x.disabled = true; });
      Net.send({ t: 'play', card: c });
    });
    box.appendChild(el);
  });

  const suitName = (k) => suit(k).name.toLowerCase();
  let hint;
  if (bidding) {
    hint = r.trump && r.trump !== 'NT'
      ? `Trump is ${suitName(r.trump)}. Bid the tricks you think these win.`
      : 'No trumps this hand. Bid the tricks you think these win.';
  } else if (mine) {
    hint = !led ? 'Your lead. Play any card.'
      : can.length === hand.length ? `You have no ${suitName(led)}, so play anything.`
      : `Follow ${suitName(led)}.`;
  } else if (p.turn === null) {
    hint = p.last ? `${ST.seats[p.last.winner].name} won that trick.` : 'Waiting…';
  } else {
    hint = `Waiting for ${ST.seats[p.turn].name}.`;
  }
  $('#hand-hint').textContent = hint;

  // a phone that has gone quiet would stop the table
  const stuck = !bidding && p.turn !== null && !ST.seats[p.turn].online;
  $('#playfor-row').hidden = !(stuck && amHost());
  if (stuck) $('#btn-playfor').textContent = `Play a card for ${ST.seats[p.turn].name}`;
}

// A bum deal throws the hand in. The dealer can do it alone; anybody else asks
// the table, and every player must agree.
function renderVote(r, me) {
  const box = $('#votebox');
  const acts = $('#vote-actions');
  const bumRow = $('#bum-row');
  const n = ST.seats.length;
  const live = r && (ST.phase === 'bid' || ST.phase === 'tricks');
  const v = ST.vote;

  bumRow.hidden = !live || !!v;
  if (live) {
    $('#btn-bum').textContent = r.dealer === me ? 'Bum deal — deal again' : 'Call a bum deal';
  }

  if (!v || !live) { box.hidden = true; return; }
  box.hidden = false;
  const mine = v.yes.includes(me) || v.no.includes(me);
  $('#vote-text').textContent = v.by === me
    ? `You called a bum deal. ${v.yes.length} of ${n} agree.`
    : `${ST.seats[v.by].name} says it is a bum deal. ${v.yes.length} of ${n} agree.`;

  acts.innerHTML = '';
  if (!mine) {
    const yes = document.createElement('button');
    yes.className = 'btn primary'; yes.type = 'button'; yes.textContent = 'Agree, deal again';
    yes.addEventListener('click', () => Net.send({ t: 'vote', agree: true }));
    const no = document.createElement('button');
    no.className = 'btn ghost'; no.type = 'button'; no.textContent = 'No, play on';
    no.addEventListener('click', () => Net.send({ t: 'vote', agree: false }));
    acts.append(yes, no);
  } else if (v.by === me) {
    const c = document.createElement('button');
    c.className = 'btn ghost'; c.type = 'button'; c.textContent = 'Take it back';
    c.addEventListener('click', () => Net.send({ t: 'votecancel' }));
    acts.appendChild(c);
  }
}

// The finish plays once, when the last round is scored. A phone that opens on
// a game already over does not replay it.
function finaleWatch() {
  if (ST.phase === 'done' && lastPhase && lastPhase !== 'done') {
    Deal.finale({
      names: ST.seats.map((s) => s.name),
      totals: ST.totals,
      linger: 1000,             // a phone gets a second longer to read it
    });
  }
  lastPhase = ST.phase;
}

// The deal plays at the start of each round. It does not hold on a phone: the
// bid pad has to be reachable. A tap skips it.
function dealWatch(r) {
  if (ST.phase === 'lobby') { dealtKey = null; return; }
  if (!r || ST.phase !== 'bid') return;
  const key = `${ST.idx}:${r.redeals || 0}`;
  if (dealtKey === key) return;
  const first = dealtKey === null && ST.idx > 0;     // a reload part way through
  dealtKey = key;
  if (first) return;                                  // do not replay on a reload
  Deal.play({
    names: ST.seats.map((s) => s.name),
    dealer: r.dealer, cards: r.cards, round: ST.idx + 1,
    linger: 1000,               // a phone gets a second longer to read it
  });
}

// The table host runs the game from their phone: rules, seats, start, go
// back, new game. No host screen needed.
function renderCaptain(lobby) {
  const panel = $('#captain-panel');
  panel.hidden = !amHost();
  $('#cap-lobby').hidden = !lobby;
  $('#cap-game').hidden = lobby;
  if (!amHost()) return;

  if (!lobby) {
    $('#btn-undo').disabled = false;
    return;
  }

  renderJoinBox();

  const n = ST.seats.length;
  $('#btn-start').disabled = n < 2;
  $('#btn-start').textContent = n < 2 ? 'Waiting for players…' : `Start game with ${n} players`;

  const c = ST.cfg;
  const setVal = (sel, v) => { const el = $(sel); if (el && document.activeElement !== el) el.value = String(v); };
  $('#cfg-max').max = String(Game.maxCardsFor(Math.max(2, n)));
  setVal('#cfg-max', c.max); setVal('#cfg-ones', c.ones); setVal('#cfg-pattern', c.pattern);
  setVal('#cfg-bonus', c.bonus); setVal('#cfg-miss', c.miss);
  $('#cfg-screw').checked = !!c.screw;
  $('#cfg-trump').checked = !!c.trump;
  setVal('#cfg-deck', c.deck || 'physical');
  $('#deck-hint').textContent = c.deck === 'virtual'
    ? 'The server deals to each phone, turns the trump, and counts the tricks.'
    : 'You deal real cards. The dealer types in the tricks at the end of a round.';
  const cards = Game.schedule(c.max, c.pattern, c.ones);
  $('#rounds-hint').textContent = `${cards.length} rounds: ${cards.join(' ')}`;
  const ex = (w) => Game.roundScore(2, w, c);
  $('#miss-hint').textContent = `Bid 2: win 3 = ${ex(3)} · win 2 = ${ex(2)} · win 1 = ${ex(1)}`;
}

// The table host may be the only screen, so the code and the QR live here too.
function renderJoinBox() {
  $('#code-badge').textContent = ST.code;
  if (joinAddr === null) {
    joinAddr = '';                                    // ask once
    UI.serverAddresses().then((found) => { joinAddr = found.best; renderJoinBox(); });
    return;
  }
  if (!joinAddr) return;
  const url = `${joinAddr}/?code=${ST.code}`;
  $('#join-url').textContent = url.replace(/^https?:\/\//, '');
  const img = $('#qr');
  img.alt = `QR code for ${url}`;
  const src = `/qr.svg?cell=6&d=${encodeURIComponent(url)}`;
  if (img.getAttribute('src') !== src) img.src = src;
}

function renderLobby(me) {
  const box = $('#lobby-seats');
  box.innerHTML = '';
  const boss = amHost();
  ST.seats.forEach((s, i) => {
    const isCap = s.id === ST.captainId;
    const isFirst = ST.firstDealerId ? ST.firstDealerId === s.id : i === 0;
    const row = document.createElement('div');
    row.className = 'seat-item' + (i === me ? ' me' : '') + (s.online ? '' : ' off') +
      (isFirst ? ' first-dealer' : '');
    row.innerHTML = `<span class="seat">${i + 1}</span><span class="nm"></span>` +
      (isCap ? '<span class="badge">host</span>' : '') +
      (isFirst ? '<span class="badge soft">deals first</span>' : '') +
      '<span class="dotstat"></span>' +
      (boss ? `<button class="mini" data-a="cap" title="Make this player the table host" aria-pressed="${isCap}">★</button>` +
              `<button class="mini d" data-a="deal" title="Deals the first round" aria-pressed="${isFirst}">🂠</button>` +
              '<button class="mini" data-a="up" title="Move up">↑</button>' +
              '<button class="mini" data-a="down" title="Move down">↓</button>' +
              (i === me ? '' : '<button class="mini x" data-a="kick" title="Remove">×</button>') : '');
    row.querySelector('.nm').textContent = s.name + (i === me ? ' (you)' : '');
    row.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.a;
      if (a === 'kick') Net.send({ t: 'kick', id: s.id });
      else if (a === 'cap') Net.send({ t: 'captain', id: s.id });
      else if (a === 'deal') Net.send({ t: 'config', patch: { firstDealer: isFirst ? null : s.id } });
      else Net.send({ t: 'seatMove', id: s.id, dir: a });
    }));
    box.appendChild(row);
  });

  const capName = (ST.seats.find((s) => s.id === ST.captainId) || {}).name || 'nobody';
  $('#lobby-title').textContent = boss ? 'Set the table' : 'Waiting for the table host';
  $('#lobby-hint').textContent = ST.seats.length < 2
    ? 'Waiting for more players…'
    : (boss ? 'Start the game when everybody is seated.' : `${capName} starts the game when everybody is seated.`);
}

function renderRound(r, me) {
  if (!r) {
    $('#round-label').textContent = 'Game over';
    $('#round-cards').textContent = '—';
    $('#round-dealer').textContent = '—';
    $('#trump-row').hidden = true;
    return;
  }
  $('#round-label').textContent = `Round ${ST.idx + 1} of ${ST.rounds.length}` +
    (r.redeals ? ` · re-deal ${r.redeals}` : '');
  $('#round-cards').textContent = r.cards;
  $('#round-dealer').textContent = ST.seats[r.dealer].name + (r.dealer === me ? ' (you)' : '');
  const cur = Game.SUITS.find((s) => s.k === r.trump) || null;
  $('#round-trump').textContent = ST.cfg.trump ? (cur ? cur.g : '—') : 'n/a';

  // only the dealer picks the trump on a phone
  const bar = $('#trump-row');
  if (!ST.cfg.trump || r.dealer !== me) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.classList.toggle('set', !!cur);
  const now = $('#trump-now');
  now.textContent = cur ? cur.name : 'Turn the top card';
  now.className = 'trump-now' + (cur ? (cur.red ? ' red' : '') : ' unset');
  const pick = $('#trump-picker');
  pick.innerHTML = '';
  Game.SUITS.forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = s.g; b.title = s.name;
    b.className = (s.red ? 'red' : '') + (s.k === 'NT' ? ' nt' : '');
    b.setAttribute('aria-pressed', String(r.trump === s.k));
    b.addEventListener('click', () => Net.send({ t: 'trump', k: s.k }));
    pick.appendChild(b);
  });
}

function renderTurn(r, me) {
  const panel = $('#turn-panel');
  const bidPad = $('#bid-pad');
  const trickPad = $('#trick-pad');
  bidPad.hidden = true; trickPad.hidden = true;
  panel.classList.remove('mine', 'amend');

  if (!r) {
    $('#turn-eyebrow').textContent = 'Game over';
    const t = ST.totals, top = Math.max(...t);
    const champs = ST.seats.filter((s, i) => t[i] === top).map((s) => s.name);
    $('#turn-text').textContent = champs.length > 1
      ? `Tie: ${champs.join(' and ')} on ${top}`
      : `${champs[0]} wins with ${top}`;
    return;
  }

  if (ST.phase === 'bid') {
    $('#turn-eyebrow').textContent = 'Bidding';
    const amend = Game.changeableSeat(r, ST.seats.length) === me;

    const showPad = () => {
      bidPad.hidden = false;
      const forbidden = Game.forbiddenBid(r, me, ST.cfg, ST.seats.length);
      const chips = $('#bid-chips');
      chips.innerHTML = '';
      for (let v = 0; v <= r.cards; v++) {
        const c = document.createElement('button');
        c.type = 'button'; c.className = 'chip'; c.textContent = v;
        if (r.bids[me] === v) c.setAttribute('aria-pressed', 'true');
        if (v === forbidden) { c.disabled = true; c.title = 'Screw the dealer: this bid is not allowed'; }
        c.addEventListener('click', () => {
          chips.querySelectorAll('.chip').forEach((x) => { x.disabled = true; });
          Net.send({ t: 'bid', v });
        });
        chips.appendChild(c);
      }
      return forbidden;
    };

    if (ST.turn === me) {
      panel.classList.add('mine');
      $('#turn-text').textContent = 'Your bid';
      const forbidden = showPad();
      $('#bid-hint').textContent = forbidden === null
        ? `How many of the ${r.cards} tricks will you win?`
        : `You deal, so you bid last. ${forbidden} is not allowed: the bids must not total ${r.cards}.`;
    } else if (amend) {
      // You bid last and the next player has not bid yet, so you can change it.
      panel.classList.add('amend');
      $('#turn-text').textContent = `You bid ${r.bids[me]}`;
      showPad();
      $('#bid-hint').textContent = `Tap another number to change your bid. You can change it until ${ST.seats[ST.turn].name} bids.`;
    } else {
      $('#turn-text').textContent = ST.turn === null ? 'All bids are in.' : `Waiting for ${ST.seats[ST.turn].name} to bid`;
    }
    return;
  }

  // tricks phase
  // The player left of the dealer leads the first trick, the same one who bid
  // first.
  const leader = (r.dealer + 1) % ST.seats.length;
  const leads = leader === me ? 'You lead' : `${ST.seats[leader].name} leads`;
  $('#turn-eyebrow').textContent = 'Tricks won';
  if (ST.cfg.deck === 'virtual') {                 // the hand is played below
    const p = ST.play;
    $('#turn-text').textContent = !p ? 'Dealing…'
      : p.turn === me ? 'Your card'
      : p.turn === null ? 'That trick is done'
      : `${ST.seats[p.turn].name} to play`;
    if (p && p.turn === me) panel.classList.add('mine');
    return;
  }
  if (r.dealer !== me) {
    $('#turn-text').textContent = `${leads} the first trick. ${ST.seats[r.dealer].name} enters the tricks.`;
    return;
  }
  panel.classList.add('mine');
  $('#turn-text').textContent = `${leads} the first trick. Enter the tricks each player won.`;
  trickPad.hidden = false;

  // Everybody starts on 0, so the dealer only taps the players who won tricks.
  const key = `${ST.idx}:${ST.phase}`;
  if (draftKey !== key) { draftKey = key; draft = ST.seats.map(() => 0); }

  const rows = $('#trick-rows');
  rows.innerHTML = '';
  ST.seats.forEach((s, p) => {
    const row = document.createElement('div');
    row.className = 'entry-row' + (p === me ? ' dealer' : '');
    const who = document.createElement('div');
    who.className = 'who';
    const nm = document.createElement('span'); nm.textContent = s.name + (p === me ? ' (you)' : ''); who.appendChild(nm);
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
      c.addEventListener('click', () => { draft[p] = draft[p] === v ? 0 : v; renderTurn(r, me); });
      chips.appendChild(c);
    }
    row.appendChild(chips);
    rows.appendChild(row);
  });

  const sum = draft.reduce((a, v) => a + (v || 0), 0);
  const ready = sum === r.cards;
  const btn = $('#btn-tricks');
  btn.disabled = !ready;
  btn.textContent = ready ? 'Score the round' : `${r.cards - sum} of ${r.cards} tricks still to give`;
}

function renderBidStrip(r) {
  const strip = $('#bidstrip');
  strip.innerHTML = '';
  if (!r) { $('#bid-tally').textContent = ''; return; }
  Game.bidOrder(r.dealer, ST.seats.length).forEach((p) => {
    const bid = r.bids ? r.bids[p] : null;
    const isTurn = ST.turn === p;
    const pill = document.createElement('div');
    pill.className = 'bidpill' + (isTurn ? ' now' : '') + (bid !== null ? ' in' : '');
    pill.dataset.k = String(p);
    pill.innerHTML = '<span class="nm"></span><span class="v"></span>';
    pill.querySelector('.nm').textContent = ST.seats[p].name + (p === r.dealer ? ' (D)' : '');
    pill.querySelector('.v').textContent = bid === null ? (isTurn ? '…' : '—') : bid;
    strip.appendChild(pill);
  });
  lastBids = Table.bidsAfter(strip, ST, r, lastBids);   // a bid lands, the turn moves on
  Table.sayBids(ST, r, lastBids.landed, mySeat());     // and a line says so, in case you looked away
  const sum = (r.bids || []).reduce((a, v) => a + (v || 0), 0);
  $('#bid-tally').textContent = `${sum} of ${r.cards}`;
}

// The rows slide to their new places, the scores run to their new values, and
// what the round paid floats up out of them.
function renderStandings(me) {
  const box = $('#standings');
  const t = ST.totals;
  const mine = lastTotals ? lastTotals[ST.seats[me].id] : undefined;
  UI.fx.count($('#my-score'), mine === undefined ? t[me] : mine, t[me], { fmt: (v) => `You: ${v}` });
  const order = t.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const hi = Math.max(...t), lo = Math.min(0, ...t), span = hi - lo;
  const before = UI.fx.barsBefore(box);

  UI.fx.flip(box, () => {
    box.innerHTML = '';
    order.forEach((o, rank) => {
      const row = document.createElement('div');
      row.className = 'stand-row' + (o.v === hi && hi !== lo ? ' lead' : '') + (o.i === me ? ' me' : '');
      row.dataset.k = ST.seats[o.i].id;
      const w = span > 0 ? Math.round(((o.v - lo) / span) * 100) : 0;
      row.innerHTML = `<span class="rank">${rank + 1}</span><span class="name"></span>` +
        `<span class="pts">${o.v}</span><span class="bar"><i style="width:${w}%"></i></span>`;
      row.querySelector('.name').textContent = ST.seats[o.i].name + (o.i === me ? ' (you)' : '');
      box.appendChild(row);
    });
  });
  const now = {};
  ST.seats.forEach((seat, i) => { now[seat.id] = t[i]; });
  lastTotals = UI.fx.scores(box, now, lastTotals, before);
}

document.addEventListener('DOMContentLoaded', () => {
  $('#btn-theme').addEventListener('click', () => {
    const now = document.documentElement.getAttribute('data-theme');
    const next = now === 'dark' ? 'light' : now === 'light' ? null : 'dark';
    if (next) document.documentElement.setAttribute('data-theme', next);
    else document.documentElement.removeAttribute('data-theme');
    try { next ? localStorage.setItem(KEY_THEME, next) : localStorage.removeItem(KEY_THEME); } catch (e) {}
  });
  UI.wireFullscreen('#btn-full');
  $('#btn-tricks').addEventListener('click', () => Net.send({ t: 'tricks', values: draft }));
  // The dealer and the table host deal again on the spot, so they are asked
  // first. Anybody else is asking the table, which can still be taken back.
  $('#btn-bum').addEventListener('click', () => {
    const me = mySeat();
    const r = ST && ST.rounds[ST.idx];
    const now = amHost() || (r && r.dealer === me);
    const q = now
      ? UI.ask('Bum deal?', 'The hand is thrown in. The same dealer deals it again, and the bids so far are lost.', 'Deal again')
      : UI.ask('Call a bum deal?', 'Every player has to agree before the hand is thrown in.', 'Ask the table');
    q.then((yes) => { if (yes) Net.send({ t: 'bumdeal' }); });
  });

  const patch = (p) => Net.send({ t: 'config', patch: p });
  $('#cfg-max').addEventListener('change', (e) => patch({ max: e.target.value }));
  $('#cfg-ones').addEventListener('change', (e) => patch({ ones: e.target.value }));
  $('#cfg-pattern').addEventListener('change', (e) => patch({ pattern: e.target.value }));
  $('#cfg-bonus').addEventListener('change', (e) => patch({ bonus: e.target.value }));
  $('#cfg-miss').addEventListener('change', (e) => patch({ miss: e.target.value }));
  $('#cfg-screw').addEventListener('change', (e) => patch({ screw: e.target.checked }));
  $('#cfg-trump').addEventListener('change', (e) => patch({ trump: e.target.checked }));
  $('#cfg-deck').addEventListener('change', (e) => patch({ deck: e.target.value }));
  $('#btn-playfor').addEventListener('click', () => Net.send({ t: 'playfor' }));
  $('#btn-start').addEventListener('click', () => Net.send({ t: 'start' }));
  $('#btn-undo').addEventListener('click', () => Net.send({ t: 'undo' }));
  $('#btn-reset').addEventListener('click', () => {
    UI.ask('New game?', 'The same players stay at the table. The scorecard is deleted.',
      'New game').then((yes) => { if (yes) Net.send({ t: 'reset' }); });
  });
  boot();
});
