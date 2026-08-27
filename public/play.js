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
let seenWho = null;            // who was at the table on the state before

const mySeat = () => (ST && ME ? ST.seats.findIndex((s) => s.id === ME) : -1);
const amHost = () => !!(ST && ME && ST.captainId === ME);

function boot() {
  Net.claimFromHash('player');
  /* The address says which table this page belongs to. A browser can hold a
     seat at more than one; without this, a page at one table would answer for
     whichever table was joined last. */
  const pinned = new URLSearchParams(location.search).get('c');
  const s = Net.session(pinned);
  if (!s || !s.code || (s.role !== 'player' && s.role !== 'watch')) { location.href = 'index.html'; return; }
  WATCH = s.role === 'watch';
  document.body.classList.toggle('watching', WATCH);
  $('#watchpill').hidden = !WATCH;
  ME = s.seatId;                       // null after a hash claim: the hello fills it in
  Net.connect({
    onOpen: () => Net.send(WATCH
      ? { t: 'watch', code: s.code, token: s.token }
      : { t: 'resume', code: s.code, token: s.token }),
    onHello: (m) => { ME = m.seatId; Net.pin(m.code); },
    onState: (m) => { ST = m; render(); },
    onError: (msg) => {
      if (/seat is gone|table is gone/i.test(msg)) { Net.setSession(null); location.href = 'index.html'; return; }
      const el = $('#play-err'); el.textContent = msg; el.hidden = false;
      setTimeout(() => { el.hidden = true; }, 3500);
    },
    onKicked: () => { location.href = 'index.html'; },
    // You left. The seat is still yours to come back to, so it is remembered.
    onLeft: () => { location.href = 'index.html'; },
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
  Chat.update(ST, ME);
  seenWho = Table.sayPresence(ST, me, seenWho);   // who came, who went
  renderLeave();
  $('#my-name').textContent = ST.seats[me].name;
  $('#subtitle').textContent = `Table ${ST.code} · seat ${me + 1} of ${ST.seats.length}`;
  // With a photo set, the pip in the corner is you.
  const pipAv = Avatar.url(ST.code, ST.seats[me]);
  const pip = $('#pip');
  pip.classList.toggle('avpic', !!pipAv);
  pip.style.backgroundImage = pipAv ? `url("${pipAv}")` : '';

  const lobby = ST.phase === 'lobby';
  $('#lobby').hidden = !lobby;
  $('#game').hidden = lobby;
  renderCaptain(lobby);
  if (lobby) { lastTotals = lastBids = null; return renderLobby(me); }

  const r = ST.rounds[ST.idx] || null;
  tableWatch(r);
  // A deal waiting on the real dealer is released by the trump being picked.
  if (r && ST.cfg.deck !== 'virtual' && Deal.isOpen('deal')) Deal.update({ trump: r.trump || null });
  finaleWatch();
  UI.keepAwake(ST.phase !== 'lobby').then((s) => {
    if (s !== 'on' && s !== 'off') console.info('[wake] screen lock status:', s);
  });
  renderRound(r, me);
  /* On a virtual table the felt is the game, so this page is the scorecard
     and nothing else: the round, the standings, the card. The bidding and
     the hand live on the felt, and the bids are read off the scorecard. What
     stays beyond the three is the attention panel, and only while the table
     actually needs a decision from this phone. */
  const virtual = ST.cfg.deck === 'virtual';
  $('#turn-panel').hidden = virtual;
  $('#bids-panel').hidden = virtual;
  if (!virtual) renderTurn(r, me);
  renderWinner();
  renderVote(r, me);
  renderAttention(r, me);
  renderBidStrip(r);
  renderStandings(me);
  UI.measureSticky();
  const sc = document.querySelector('.scorecard-panel');
  sc.classList.toggle('pinned', virtual);  // the card is the page here: never folded
  if (virtual) sc.open = true;
  $('#scorecard').innerHTML = Table.scorecardHTML(ST, me);
  Table.followCurrent('#scorecard');
}

/* The panel that is only there when the table needs a decision from this
   phone: a vote to answer, or a seat with nobody behind it that the table is
   stopped on. renderVote has already said whether the vote box shows. */
function renderAttention(r, me) {
  renderBidFor(r, me);
  renderPlayout();
  renderPlayFor();
  const rows = ['#votebox', '#bidfor-pad', '#playfor-row', '#playout-row'];
  $('#attn-panel').hidden = rows.every((sel) => $(sel).hidden);
}

// A phone that has gone quiet would stop the table: whoever runs it plays a
// card for that seat. The server picks, and only from the legal cards.
function renderPlayFor() {
  const row = $('#playfor-row');
  const p = ST.phase === 'tricks' ? awaySeat() : -1;
  const on = !WATCH && amHost() && p >= 0;
  row.hidden = !on;
  if (on) $('#btn-playfor').textContent = `Play a card for ${ST.seats[p].name}`;
}

/* Leaving on purpose, which the table can tell from a phone going quiet: a
   quiet phone is waited for, a player who has left is played out. */
function renderLeave() {
  const row = $('#leave-row');
  const seated = !WATCH && mySeat() >= 0;
  row.hidden = !seated;
  if (seated) $('#btn-leave').textContent = ST.phase === 'lobby' ? 'Leave the table' : 'Leave the game';
}

// What each player is remembered for, once the last round is scored.
function renderWinner() {
  const panel = $('#winner-panel');
  const done = ST.phase === 'done';
  if (done) Games.keep(ST, mySeat());
  panel.hidden = !done;
  if (!done) return;
  $('#winner-title').textContent = Table.winner(ST).title;
  Accolades.render($('#accolades'), ST.awards || [], ST.seats.map((s) => s.name), ST.cfg.accoladePay);
}

// A bum deal throws the hand in. The dealer can do it alone; anybody else asks
// the table, and every player must agree.
function renderVote(r, me) {
  const box = $('#votebox');
  const acts = $('#vote-actions');
  const bumRow = $('#bum-row');
  const live = r && (ST.phase === 'bid' || ST.phase === 'tricks');
  const v = ST.vote;

  bumRow.hidden = !live || !!v;
  if (live) {
    $('#btn-bum').textContent = r.dealer === me ? 'Bum deal — deal again' : 'Call a bum deal';
  }

  if (!v || !live) { box.hidden = true; return; }
  box.hidden = false;
  $('#vote-text').textContent = Table.voteText(ST, me);

  // Only a phone answers a vote, so the buttons live here.
  const mine = v.yes.includes(me) || v.no.includes(me);
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
  if (Table.justFinished(ST, lastPhase)) {
    Deal.finale({
      names: ST.seats.map((s) => s.name),
      totals: ST.totals,                     // the accolades are already in these
      awards: ST.awards || [],
      points: ST.cfg.accoladePay,
      bonus: ST.bonus || [],
      linger: 1000,             // a phone gets a second longer to read it
    });
  }
  lastPhase = ST.phase;
}

/* With a virtual deck the felt is the game: the deal lands on it and the round
   is played there, with this page one tap away behind it. With real cards there
   is nothing to touch, so the deal stays what it always was -- a flourish that
   plays and goes. */
function tableWatch(r) {
  if (ST.cfg.deck === 'virtual') {
    dealtKey = null;                       // the felt owns the deal on this table
    Felt.sync(ST, mySeat(), {
      send: (m) => Net.send(m),
      watch: WATCH,
      onView: feltView,
    });
    return;
  }
  dealWatch(r);
}

// The felt covers the page, so the page says how to get back to it.
function feltView(on) {
  const bar = $('#felt-bar');
  if (!bar) return;
  const live = ST && ST.cfg.deck === 'virtual' && (ST.phase === 'bid' || ST.phase === 'tricks');
  bar.hidden = !!on || !live;
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
  const virtual = ST.cfg.deck === 'virtual';
  // The dealer is the one shuffling the real deck. A scene of it shuffling
  // itself would only be in the way on that phone.
  if (!virtual && r.dealer === mySeat()) return;
  Deal.play({
    names: ST.seats.map((s) => s.name),
    dealer: r.dealer, cards: r.cards, round: ST.idx + 1,
    // With a virtual deck the cards come to you: your own land face up in a
    // fan, so the scene already shows the hand and needs no extra pause.
    deck: ST.cfg.deck,
    avatars: ST.seats.map((s) => Avatar.url(ST.code, s)),
    mine: mySeat(),
    hand: ST.hand || [],
    upcard: ST.play ? ST.play.upcard : null,
    trump: r.trump || null,
    linger: virtual ? 300 : 1000,   // a phone gets longer to read a bare deal
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
  setVal('#cfg-accolade-pay', c.accoladePay === undefined ? 10 : c.accoladePay);
  setVal('#cfg-accolade-count', c.accoladeCount === undefined ? 3 : c.accoladeCount);
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
    joinAddr = '';                                    // built once, then it tells us
    UI.addressPicker($('#addr-mount'), (u) => { joinAddr = u; renderJoinBox(); });
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

/* The picture, picked here or brought from the join page. It is built once and
   kept: rebuilding it on every state would throw away a pick in flight. */
let avPicker = null, avSent = false;

function renderAvatar(me) {
  const mount = $('#lobby-av');
  if (!mount) return;
  // Inside the dev previews every seat is a frame in one browser, so the
  // phone's remembered photo belongs to nobody in particular. A frame sets
  // only what is picked in it, and neither keeps that pick nor helps itself
  // to one another frame made.
  const framed = window.top !== window.self;
  if (!avPicker) {
    avPicker = Avatar.picker((d) => {
      if (!framed) Avatar.remember(d);
      avSent = true;
      Net.send({ t: 'avatar', data: d });
    });
    mount.appendChild(avPicker.el);
  }
  const seat = me >= 0 ? ST.seats[me] : null;
  // A picture picked before the seat existed is handed over now, once.
  if (!framed && seat && !seat.av && !avSent) {
    const kept = Avatar.saved();
    if (kept) { avSent = true; Net.send({ t: 'avatar', data: kept }); return; }
  }
  if (seat && seat.av) avSent = true;
  avPicker.show(Avatar.url(ST.code, seat));
}

function renderLobby(me) {
  renderAvatar(me);
  const box = $('#lobby-seats');
  box.innerHTML = '';
  const boss = amHost();
  ST.seats.forEach((s, i) => {
    const isCap = s.id === ST.captainId;
    const isFirst = ST.firstDealerId ? ST.firstDealerId === s.id : i === 0;
    const row = document.createElement('div');
    row.className = 'seat-item' + (i === me ? ' me' : '') + (s.online ? '' : ' off') +
      (isFirst ? ' first-dealer' : '') + (s.bot ? ' bot' : '');
    row.innerHTML = `<span class="seat">${i + 1}</span><span class="nm"></span>` +
      (isCap ? '<span class="badge">host</span>' : '') +
      (s.bot ? '<span class="badge soft">bot</span>' : '') +
      (isFirst ? '<span class="badge soft">deals first</span>' : '') +
      '<span class="dotstat"></span>' +
      // A bot cannot run the table, so it is never offered the star.
      (boss ? (s.bot ? '' : `<button class="mini" data-a="cap" title="Make this player the table host" aria-pressed="${isCap}">★</button>`) +
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

  renderBots(boss);

  const capName = (ST.seats.find((s) => s.id === ST.captainId) || {}).name || 'nobody';
  $('#lobby-title').textContent = boss ? 'Set the table' : 'Waiting for the table host';
  $('#lobby-hint').textContent = ST.seats.length < 2
    ? 'Waiting for more players…'
    : (boss ? 'Start the game when everybody is seated.' : `${capName} starts the game when everybody is seated.`);
}

/* Players the table provides, for a hand short of people. They hold cards, so
   they belong to a table that deals them. */
function renderBots(boss) {
  const row = $('#bot-row');
  if (!row) return;
  row.hidden = !boss;
  if (!boss) return;
  const bots = ST.seats.filter((s) => s.bot).length;
  const full = ST.seats.length >= 8;
  const cards = ST.cfg.deck === 'virtual';
  const btn = $('#btn-addbot');
  btn.disabled = full;
  btn.textContent = bots ? '+ Add another bot' : '+ Add a bot';
  $('#bot-hint').textContent = full ? 'The table is full.'
    : bots ? `${bots} of the ${ST.seats.length} seats play themselves.`
    : cards ? 'It plays its own hand. Remove it with ×.'
    : 'It plays its own hand, so the cards move to the phones.';
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
  // The table can see the card that was turned; noting its suit here is for
  // the scorecard, and nothing waits on it.
  now.textContent = cur ? cur.name : 'Not noted';
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

/* The seat the table is stopped on, if there is nobody behind it. A bot is
   never away, and a seat the table already plays is not waited for. */
function awaySeat() {
  const p = ST.phase === 'bid' ? ST.turn : (ST.play ? ST.play.turn : null);
  if (p === null || p === undefined) return -1;
  const s = ST.seats[p];
  return (s && !s.online && !s.left && !s.bot) ? p : -1;
}

/* A phone that is not coming back. Bidding and playing for it a turn at a time
   works, but somebody has to be there to do it; this hands the seat to the
   table for the rest of the game. The seat keeps its name and its column, and
   the phone it belongs to takes it back by coming to the table. */
function renderPlayout() {
  const row = $('#playout-row');
  const p = awaySeat();
  const on = !WATCH && amHost() && p >= 0 && ST.cfg.deck === 'virtual';
  row.hidden = !on;
  if (on) $('#btn-playout').textContent = `Let the table play ${ST.seats[p].name}'s hand`;
}

// The one place a table can stop dead: nobody may bid out of turn, so a
// phone that has gone quiet holds up everybody. Whoever runs the table can
// bid for that seat -- off its own cards where there are cards to read.
function renderBidFor(r, me) {
  const pad = $('#bidfor-pad');
  const p = ST.phase === 'bid' ? ST.turn : null;
  const on = !WATCH && amHost() && p !== null && p !== me
          && !ST.seats[p].online && !ST.seats[p].left && !ST.seats[p].bot;
  pad.hidden = !on;
  if (!on) return;
  const who = ST.seats[p];
  const dealt = ST.cfg.deck === 'virtual';
  const forbidden = Game.forbiddenBid(r, p, ST.cfg, ST.seats.length);
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
    } else if (ST.turn === null) {
      $('#turn-text').textContent = 'All bids are in.';
    } else {
      const who = ST.seats[ST.turn];
      $('#turn-text').textContent = who.online
        ? `Waiting for ${who.name} to bid`
        : `${who.name} is not at the table`;
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
  // Once the cards are out these pills carry what each player has won against
  // what they bid. Only a virtual deck knows that as the hand is played; at a
  // table with real cards the tricks arrive all at once at the end.
  const play = ST.phase === 'tricks' && ST.play ? ST.play : null;
  $('#bid-title').textContent = play ? 'Tricks won' : 'Bids';
  Game.bidOrder(r.dealer, ST.seats.length).forEach((p) => {
    const bid = r.bids ? r.bids[p] : null;
    const won = play ? play.won[p] : null;
    const isTurn = play ? play.turn === p : ST.turn === p;
    const pill = document.createElement('div');
    pill.className = 'bidpill' + (isTurn ? ' now' : '') + (bid !== null ? ' in' : '') +
      (play && won === bid ? ' hit' : '') + (play && won > bid ? ' over' : '');
    pill.dataset.k = String(p);
    pill.innerHTML = '<span class="nm"></span><span class="v"></span>';
    pill.querySelector('.nm').textContent = ST.seats[p].name + (p === r.dealer ? ' (D)' : '');
    pill.querySelector('.v').textContent = play ? `${won}/${bid}`
      : (bid === null ? (isTurn ? '…' : '—') : bid);
    strip.appendChild(pill);
  });
  lastBids = Table.bidsAfter(strip, ST, r, lastBids);   // a bid lands, the turn moves on
  Table.sayBids(ST, r, lastBids.landed, mySeat());     // and a line says so, in case you looked away
  const sum = (r.bids || []).reduce((a, v) => a + (v || 0), 0);
  $('#bid-tally').textContent = play
    ? `${play.won.reduce((a, v) => a + v, 0)} of ${r.cards} played`
    : `${sum} of ${r.cards}`;
}

// The rows slide to their new places, the scores run to their new values, and
// what the round paid floats up out of them.
function renderStandings(me) {
  const t = ST.totals;
  // A phone shows its own score in big figures above the list, and counts up
  // to it, so the change is readable without hunting for your row.
  const mine = lastTotals ? lastTotals[ST.seats[me].id] : undefined;
  UI.fx.count($('#my-score'), mine === undefined ? t[me] : mine, t[me], { fmt: (v) => `You: ${v}` });
  lastTotals = Table.standings($('#standings'), ST, { me, lastTotals });
}

document.addEventListener('DOMContentLoaded', () => {
  UI.settingsMenu('#btn-settings', UI.commonSettings({ motion: true }));
  // A watching window reads the talk and does not join it, the same as every
  // other control on it.
  Chat.wire('#btn-chat', WATCH ? null : (text) => Net.send({ t: 'chat', text }));
  $('#btn-back-felt').addEventListener('click', () => Felt.show());
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
  $('#cfg-accolade-pay').addEventListener('change', (e) => patch({ accoladePay: e.target.value }));
  $('#cfg-accolade-count').addEventListener('change', (e) => patch({ accoladeCount: e.target.value }));
  $('#btn-playfor').addEventListener('click', () => Net.send({ t: 'playfor' }));
  $('#btn-bidfor').addEventListener('click', () => Net.send({ t: 'bidfor' }));
  $('#btn-playout').addEventListener('click', () => {
    const p = awaySeat();
    const who = p >= 0 ? ST.seats[p].name : 'that seat';
    UI.ask(`Let the table play ${who}'s hand?`,
      `The seat keeps its name and its place on the scorecard, and the table plays it `
      + `from here on. ${who} takes it back by coming to the table on the phone that holds the seat.`,
      'Hand it over').then((yes) => { if (yes) Net.send({ t: 'playout' }); });
  });
  $('#btn-leave').addEventListener('click', () => {
    const lobby = !ST || ST.phase === 'lobby';
    UI.ask(lobby ? 'Leave the table?' : 'Leave the game?',
      lobby
        ? 'Your seat is given up. Join again with the table code while the game has not started.'
        : 'Your seat stays on the scorecard and the table plays your hand from here. '
          + 'This phone can come back to it from the front page.',
      'Leave').then((yes) => { if (yes) Net.send({ t: 'leave' }); });
  });
  $('#btn-addbot').addEventListener('click', () => Net.send({ t: 'addbot' }));
  $('#btn-start').addEventListener('click', () => Net.send({ t: 'start' }));
  $('#btn-undo').addEventListener('click', () => Net.send({ t: 'undo' }));
  $('#btn-reset').addEventListener('click', () => {
    UI.ask('New game?', 'The same players stay at the table. The scorecard is deleted.',
      'New game').then((yes) => { if (yes) Net.send({ t: 'reset' }); });
  });
  boot();
});
