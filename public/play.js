'use strict';
/* Player view: your bid pad, and the count of tricks as they are taken. */

const $ = (s) => document.querySelector(s);

let ST = null, ME = null;      // ME = my seat id
let WATCH = false;             // this window only shows the seat, it cannot act
let lastTotals = null;         // seat id -> score, to show what a round paid
let lastBids = null;           // { key, bids, turn }, to catch a bid landing
let dealtKey = null;           // the round already dealt on this phone
let lastPhase = null;          // to catch the moment the game ends
let lastDone = null;           // rounds scored, to catch a round landing
let lastTrick = null;          // tricks counted, to catch one landing
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
  if (lobby) { lastTotals = lastBids = lastDone = lastTrick = null; return renderLobby(me); }

  const r = ST.rounds[ST.idx] || null;
  tableWatch(r);
  finaleWatch();
  UI.keepAwake(ST.phase !== 'lobby').then((s) => {
    if (s !== 'on' && s !== 'off') console.info('[wake] screen lock status:', s);
  });
  renderRound(r);
  /* On a virtual table the felt is the game, so this page is the scorecard:
     the round, the bids, the standings, the card. The bidding and the hand
     live on the felt. What stays beyond those is the attention panel, and
     only while the table actually needs a decision from this phone. */
  const virtual = Game.virtual(ST);
  // No turn panel once the game is over: the round line and the winner
  // panel say so between them.
  $('#turn-panel').hidden = virtual || !r;
  // The bids stay on the page in both modes: the felt names them too, but
  // the page under it is the scorecard, and a scorecard has the bids on it.
  $('#bids-panel').hidden = false;
  if (!virtual && r) renderTurn(r, me);
  renderWinner();
  renderVote();
  renderAttention(r, me);
  renderBidStrip(r);
  renderStandings(me);
  // What the round paid, unless the felt is up and saying it itself.
  lastDone = Table.sayRound(ST, me, lastDone, virtual && Felt.shown());
  lastTrick = Table.sayTrick(ST, lastTrick);      // a trick counted, with real cards
  UI.measureSticky();
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
// the table, and every player must agree. The button and the vote box are
// widgets, so the felt can carry the vote too.
function renderVote() {
  const v = view();
  Round.bum($('#bum-row'), ST, v);
  Round.vote($('#votebox'), ST, v);
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

// The deal plays at the start of each round, on every phone, the dealer's
// too -- the shuffle only. The real cards are on the real table, dealt by
// the real dealer, so the scene stops before a card goes out, and the bid
// pad is not kept waiting. A tap skips it.
function dealWatch(r) {
  if (ST.phase === 'lobby') { dealtKey = null; return; }
  if (!r || ST.phase !== 'bid') { Deal.close('deal'); return; }   // the cards are out: the count is wanted
  const key = Table.roundKey(ST);
  if (dealtKey !== key) {
    const first = dealtKey === null && ST.idx > 0;     // a reload part way through
    dealtKey = key;
    if (!first) {                                        // do not replay on a reload
      Deal.play(Object.assign(Table.dealOpts(ST, ST.idx), {
        avatars: ST.seats.map((s) => Avatar.url(ST.code, s)),
        mine: mySeat(),
        key,
        shuffleOnly: true,
      }));
    }
  }
}

// The table host runs the game from their phone: rules, seats, start, go
// back, new game. No host screen needed.
/* What the player who runs the table can do to a game already going. The
   lobby's own controls are in the lobby, drawn with it. */
function renderCaptain(lobby) {
  const boss = amHost();
  $('#captain-panel').hidden = !boss || lobby;
  $('#cap-game').hidden = lobby;
  if (boss && !lobby) $('#btn-undo').disabled = false;
}

// The table host may be the only screen, so the code and the QR live here too.
function renderJoinBox() {
  $('#code-badge').textContent = ST.code;
  if (joinAddr === null) {
    joinAddr = '';                                    // built once, then it tells us
    /* Quiet: the phone takes the best address it has and shows no choice
       about it. The one case it still asks is a phone that cannot see its own
       address at all -- hosting a hotspot, most often -- where the code is
       useless until somebody types one in. */
    UI.addressPicker($('#addr-mount'), (u) => { joinAddr = u; renderJoinBox(); }, { quiet: true });
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

/* Inside the dev previews every seat is a frame in one browser, so the
   phone's remembered name and photo belong to nobody in particular. A frame
   sets only what is picked in it, and neither keeps that pick nor helps
   itself to one another frame made. */
const framed = () => window.top !== window.self;

/* The picture picked before the seat existed -- on the front page -- is
   handed over now, once. */
let avSent = false;

function handOverPhoto(me) {
  const seat = me >= 0 ? ST.seats[me] : null;
  if (seat && seat.av) { avSent = true; return; }
  if (framed() || !seat || avSent) return;
  const kept = Avatar.saved();
  if (kept) { avSent = true; Net.send({ t: 'avatar', data: kept }); }
}

/* Who you are lives on the settings page. At a table the name and the photo
   are the seat's: a change in the lobby goes to the table, and a change
   during a game goes with the next table, because the scorecard is a column
   under the name it has. A watching window has no seat to change. */
function wireSettings() {
  const seat = () => (ST && mySeat() >= 0 ? ST.seats[mySeat()] : null);
  const lobby = () => !!(ST && ST.phase === 'lobby');
  Settings.wire('#btn-settings', {
    items: UI.commonSettings({ motion: true, home: true }),
    who: WATCH ? null : {
      name: () => (seat() ? seat().name : Net.name()),
      photo: () => (seat() ? Avatar.url(ST.code, seat()) : (framed() ? null : Avatar.saved())),
      note: () => (lobby() ? ''
        : 'At this table the name and the photo are set in the lobby. A change here goes with your next table.'),
      onName: (n) => {
        if (!framed()) Net.setName(n);
        if (lobby()) Net.send({ t: 'rename', name: n });
      },
      onPhoto: (d) => {
        if (!framed()) Avatar.remember(d);
        avSent = true;
        if (lobby()) Net.send({ t: 'avatar', data: d });
      },
    },
  });
}

function renderLobby(me) {
  handOverPhoto(me);
  const v = view();
  Lobby.seats($('#lobby-seats'), ST, v);
  Lobby.bots($('#bot-row'), ST, v);
  Lobby.rulesForm($('#rules-form'), ST, v);      // read by everybody, changed by the host
  /* Folded away, the heading still says what the rules are, so a player who
     only wants to know reads it without opening anything. It is opened once
     for whoever runs the table: they came to set them. */
  const rules = $('#rules-box');
  if (rules) {
    $('#rules-sum').textContent = Lobby.rulesLine(ST);
    if (!rules._asked) { rules._asked = true; rules.open = v.boss; }
  }
  const capName = (ST.seats.find((s) => s.id === ST.captainId) || {}).name || 'nobody';
  /* The way in at the top, and the button that ends the waiting at the foot:
     both are the table host's, and both belong where the thing is done. A TV
     screen that runs the table has the code up already, so the phone says the
     screen is there instead of repeating it. */
  $('#cap-join').hidden = !v.boss || !!ST.tv;
  $('#cap-tv').hidden = !v.boss || !ST.tv;
  if (v.boss && !ST.tv) renderJoinBox();
  $('#btn-start').hidden = !v.boss;
  Lobby.startButton($('#btn-start'), ST, v);
  /* Nothing for whoever runs the table: the code, the seats, the rules and
     the button say what this screen is and what to do with it. A player who
     runs nothing is told who they are waiting on. */
  const hint = $('#lobby-hint');
  hint.textContent = v.boss ? '' : `${capName} starts the game when everybody is seated.`;
  hint.hidden = !hint.textContent;
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
  Round.trickCount($('#trick-count'), ST, r, view());
  panel.classList.remove('mine', 'amend');

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
  // With real cards the table counts, and that is everybody's job, so the
  // panel is lit for everybody.
  const taken = ST.play && ST.play.log ? ST.play.log.length : 0;
  panel.classList.add('mine');
  $('#turn-text').textContent = taken === 0
    ? `${leads} the first trick. Tap who takes it.`
    : `Trick ${Math.min(taken + 1, r.cards)} of ${r.cards}. Tap who takes it.`;
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
  Round.tally($('#bid-tally'), ST, r);      // the same line the TV screen has
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
  // A watching window reads the talk and does not join it, the same as every
  // other control on it.
  Chat.wire('#btn-chat', WATCH ? null : (text) => Net.send({ t: 'chat', text }));
  $('#btn-back-felt').addEventListener('click', () => Felt.show());
  $('#btn-leave').addEventListener('click', () => {
    const lobby = !ST || ST.phase === 'lobby';
    UI.ask(lobby ? 'Leave the table?' : 'Leave the game?',
      lobby
        ? 'Your seat is given up. Join again with the table code while the game has not started.'
        : 'Your seat stays on the scorecard and auto-play takes your hand from here. '
          + 'This phone can come back to it from the front page.',
      'Leave', true).then((yes) => { if (yes) Net.send({ t: 'leave' }); });
  });
  $('#btn-undo').addEventListener('click', () => Round.undo(view(), ST));
  $('#btn-reset').addEventListener('click', () => Round.newGame(view()));
  boot();
  wireSettings();                   // after boot: it needs to know whether this window may act
});
