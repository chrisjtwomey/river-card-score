'use strict';
/* Player view: your bid pad, and the trick pad when you are the dealer. */

const $ = (s) => document.querySelector(s);

let ST = null, ME = null;      // ME = my seat id
let WATCH = false;             // this window only shows the seat, it cannot act
let lastTotals = null;         // seat id -> score, to show what a round paid
let lastBids = null;           // { key, bids, turn }, to catch a bid landing
let dealtKey = null;           // the round already dealt on this phone
let lastPhase = null;          // to catch the moment the game ends
let joinAddr = null;           // the address the others should open
let seenWho = null;            // who was at the table on the state before

const mySeat = () => (ST && ME ? ST.seats.findIndex((s) => s.id === ME) : -1);
const amHost = () => !!(ST && ME && ST.captainId === ME);
// This phone's seat, and whether it runs the table. A watching window runs nothing.
const view = () => ({ me: mySeat(), boss: !WATCH && amHost(), send: (m) => Net.send(m) });

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
      // The table is over, or this seat is not at it any more. Say which
      // table it was: the front page is otherwise a silent bounce.
      if (/seat is gone|table is gone/i.test(msg)) {
        Net.setSession(null);
        location.href = 'index.html?gone=' + encodeURIComponent(s.code || '');
        return;
      }
      // A line under the top bar, over whatever is on screen. The panel that
      // carried this was hidden on a virtual table, in the lobby and under the
      // felt, so a refusal went unseen exactly where it mattered.
      UI.fx.toast(msg, { err: true, ms: 4000 });
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
  finaleWatch();
  UI.keepAwake(ST.phase !== 'lobby').then((s) => {
    if (s !== 'on' && s !== 'off') console.info('[wake] screen lock status:', s);
  });
  renderRound(r);
  /* On a virtual table the felt is the game, so this page is the scorecard
     and nothing else: the round, the standings, the card. The bidding and
     the hand live on the felt, and the bids are read off the scorecard. What
     stays beyond the three is the attention panel, and only while the table
     actually needs a decision from this phone. */
  const virtual = Game.virtual(ST);
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
  Table.scorecard('#scorecard', ST, me);
}

/* The panel that is only there when the table needs a decision from this
   phone: a vote to answer, or a seat with nobody behind it that the table is
   stopped on. renderVote has already said whether the vote box shows. */
function renderAttention(r, me) {
  const v = view();
  Round.bidFor($('#bidfor-pad'), ST, r, v);
  Round.playout($('#playout-row'), ST, v);
  Round.playFor($('#playfor-row'), ST, v);
  const rows = ['#votebox', '#bidfor-pad', '#playfor-row', '#playout-row'];
  $('#attn-panel').hidden = rows.every((sel) => $(sel).hidden);
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
  if (ST.phase === 'done') Games.keep(ST, mySeat());
  Round.winner($('#winner-panel'), ST);
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
    // The dealer and the table host throw the hand in themselves; anybody else asks.
    $('#btn-bum').textContent = (r.dealer === me || amHost()) ? 'Bum deal' : 'Ask for a bum deal';
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
    c.className = 'btn ghost'; c.type = 'button'; c.textContent = 'Withdraw the vote';
    c.addEventListener('click', () => Net.send({ t: 'votecancel' }));
    acts.appendChild(c);
  }
}

// The finish plays once, when the last round is scored. A phone that opens on
// a game already over does not replay it.
function finaleWatch() {
  if (Table.justFinished(ST, lastPhase)) {
    // a phone gets a second longer to read it
    Deal.finale(Object.assign(Table.finaleOpts(ST), { linger: 1000 }));
  }
  lastPhase = ST.phase;
}

/* With a virtual deck the felt is the game: the deal lands on it and the round
   is played there, with this page one tap away behind it. With real cards there
   is nothing to touch, so the deal stays what it always was -- a flourish that
   plays and goes. */
function tableWatch(r) {
  if (Game.virtual(ST)) {
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
  const live = ST && Game.virtual(ST) && (ST.phase === 'bid' || ST.phase === 'tricks');
  bar.hidden = !!on || !live;
}

// The deal plays at the start of each round. It does not hold on a phone: the
// bid pad has to be reachable. A tap skips it.
function dealWatch(r) {
  if (ST.phase === 'lobby') { dealtKey = null; return; }
  if (!r || ST.phase !== 'bid') return;
  const key = Table.roundKey(ST);
  if (dealtKey === key) return;
  const first = dealtKey === null && ST.idx > 0;     // a reload part way through
  dealtKey = key;
  if (first) return;                                  // do not replay on a reload
  const virtual = Game.virtual(ST);
  // The dealer is the one shuffling the real deck. A scene of it shuffling
  // itself would only be in the way on that phone.
  if (!virtual && r.dealer === mySeat()) return;
  // With a virtual deck the cards come to you: your own land face up in a
  // fan, so the scene already shows the hand and needs no extra pause.
  Deal.play(Object.assign(Table.dealOpts(ST, ST.idx), {
    avatars: ST.seats.map((s) => Avatar.url(ST.code, s)),
    mine: mySeat(),
    hand: ST.hand || [],
    linger: virtual ? 300 : 1000,   // a phone gets longer to read a bare deal
  }));
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
  Lobby.rulesForm($('#cap-lobby'), ST, view());
  Lobby.startButton($('#btn-start'), ST, view());
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
  const v = view();
  Lobby.seats($('#lobby-seats'), ST, v);
  Lobby.bots($('#bot-row'), ST, v);
  const capName = (ST.seats.find((s) => s.id === ST.captainId) || {}).name || 'nobody';
  $('#lobby-title').textContent = v.boss ? 'Set the table' : 'Waiting for the table host';
  $('#lobby-hint').textContent = ST.seats.length < 2
    ? 'Waiting for more players…'
    : (v.boss ? 'Start the game when everybody is seated.' : `${capName} starts the game when everybody is seated.`);
}

function renderRound(r) {
  Round.header($('.round-bar'), ST, view());
  if (!r) return;
  // Only a deck the server deals turns a trump. On a real table the card is
  // lying there for everybody to see, so the page says nothing about it.
  const cur = Game.SUITS.find((s) => s.k === r.trump) || null;
  $('#round-trump-row').hidden = !Game.virtual(ST);
  $('#round-trump').textContent = cur ? cur.g : 'none';   // no card turned, or trumps off
}

function renderTurn(r, me) {
  const panel = $('#turn-panel');
  const bidPad = $('#bid-pad');
  bidPad.hidden = true;
  Round.trickPad($('#trick-pad'), ST, r, view());
  panel.classList.remove('mine', 'amend');

  if (!r) {
    $('#turn-eyebrow').textContent = 'Game over';
    $('#turn-text').textContent = Table.winner(ST).title;
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
  const leader = Game.firstLeader(r, ST.seats.length);
  const leads = leader === me ? 'You lead' : `${ST.seats[leader].name} leads`;
  $('#turn-eyebrow').textContent = 'Tricks won';
  if (Game.virtual(ST)) {                 // the hand is played below
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
}

function renderBidStrip(r) {
  lastBids = Round.bidStrip($('#bidstrip'), ST, r, view(), lastBids);
  if (!r) { $('#bid-tally').textContent = ''; return; }
  Table.sayBids(ST, r, lastBids.landed, mySeat());     // a line says so, in case you looked away
  // Once the cards are out the pills carry what each player has won against
  // what they bid. Only a virtual deck knows that as the hand is played; at a
  // table with real cards the tricks arrive all at once at the end.
  const play = ST.phase === 'tricks' && ST.play ? ST.play : null;
  $('#bid-title').textContent = play ? 'Tricks won' : 'Bids';
  const sum = (r.bids || []).reduce((a, v) => a + (v || 0), 0);
  // "total 3 · 5 tricks", not "3 of 5": the sum of the bids against the
  // hand, which is what screw the dealer and the table both care about.
  $('#bid-tally').textContent = play
    ? `${play.won.reduce((a, v) => a + v, 0)} of ${r.cards} tricks played`
    : `total ${sum} · ${r.cards} tricks`;
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
  // The dealer and the table host deal again on the spot, so they are asked
  // first. Anybody else is asking the table, which can still be taken back.
  $('#btn-bum').addEventListener('click', () => {
    const r = ST && ST.rounds[ST.idx];
    Round.bumDeal(view(), amHost() || !!(r && r.dealer === mySeat()));
  });

  $('#btn-leave').addEventListener('click', () => {
    const lobby = !ST || ST.phase === 'lobby';
    UI.ask(lobby ? 'Leave the table?' : 'Leave the game?',
      lobby
        ? 'Your seat is given up. Join again with the table code while the game has not started.'
        : 'Your seat stays on the scorecard and auto-play takes your hand from here. '
          + 'This phone can come back to it from the front page.',
      'Leave').then((yes) => { if (yes) Net.send({ t: 'leave' }); });
  });
  $('#btn-undo').addEventListener('click', () => Round.undo(view(), ST));
  $('#btn-reset').addEventListener('click', () => Round.newGame(view()));
  boot();
});
