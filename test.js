const { spawn } = require('child_process');
const path = __dirname;
const path2 = require('path');
const WebSocket = require('ws');
const PORT = Number(process.env.TEST_PORT) || 8899;
const fs = require('fs');
const os = require('os');
// The finished games are written to a folder of their own, thrown away after.
const DATA_DIR = fs.mkdtempSync(path2.join(os.tmpdir(), 'rcs-games-'));
/* The four pauses a game is built around, turned down for the suite.

   A bot waits a moment before it answers so that a table of them can be read;
   the bids stand to be read before the hand is played; a trick sits on the
   table before it is gathered; and a bot bidding a round waits for the phones
   to say the deal has been watched. Every one of them is
   seconds, on purpose, and none of them is what these checks are about -- the
   clients here are not phones and never say their table is up, so the last one
   would run its whole course every round. What the pauses actually are is
   checked in test-rules.js, and that each is really waited out is checked on a
   server of its own below. */
const TUNED = { TRICK_HOLD: '120', BID_HOLD: '120', BOT_DELAY: '120', BOT_DEAL_WAIT: '150',
                REPLAY_STEP: '30', REPLAY_HOLD: '40' };
const srv = spawn('node', [path + '/server.js'],
  { env: { ...process.env, PORT, NO_TLS: '1', DATA_DIR, KEEP_GAMES: '3', CHAT_KEEP: '5', ...TUNED },
    stdio: ['ignore', 'pipe', 'pipe'] });
srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));

const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, done = false;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };

/* The table answers in a millisecond or two, so sleeping a fixed tenth of a
   second after every message was this file spending most of a minute doing
   nothing -- and, on a machine that was busy, still not always long enough.

   So nothing here waits by the clock. It waits for the answer: `until` polls
   until what it is watching for is true and gives up after a couple of
   seconds, so a rule that really is broken still fails, and fails with its own
   line. Where there is nothing to watch for -- a message that changes nothing,
   or a step that only sets the table up -- `c.rt()` sends a ping and waits for
   the pong, which proves the server has dealt with everything that socket sent
   before it. The waits that are left are the ones being measured: a trick held
   up, a bot thinking, a phone timed out. */
const truthy = (pred) => { try { return !!pred(); } catch (e) { return false; } };
async function until(pred, ms = 2000) {
  const end = Date.now() + ms;
  while (!truthy(pred)) {
    if (Date.now() >= end) {
      /* A wait that gives up costs its whole length, and the check after it can
         still pass for its own reasons -- so it is silent, and slow, and looks
         like nothing at all. Say it. */
      console.log(`  SLOW  waited ${ms}ms for nothing: ${String(pred).replace(/\s+/g, ' ').slice(0, 80)}`);
      return false;
    }
    await wait(2);
  }
  return true;
}
// A check, once the table has had its chance to make it true.
const okBy = async (pred, m) => { await until(pred); ok(truthy(pred), m); };
// And a server, once it is answering.
async function upAt(port, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/net.json`)).ok) return true; } catch (e) {}
    if (Date.now() >= end) return false;
    await wait(10);
  }
}

function client(name, url) {
  const ws = new WebSocket(url || `ws://127.0.0.1:${PORT}/ws`);
  const c = { ws, name, state: null, hello: null, errors: [], seatId: null, pongs: 0 };
  ws.on('message', d => {
    const m = JSON.parse(d);
    if (m.t === 'state') c.state = m;
    else if (m.t === 'hello') { c.hello = m; c.seatId = m.seatId; }
    else if (m.t === 'error') c.errors.push(m.msg);
    else if (m.t === 'pong') c.pongs++;
    else if (m.t === 'tables') c.tables = m.tables;
    else if (m.t === 'seat') c.seat = m;
    else if (m.t === 'stateRaw') c.raw = m.record;
    else if (m.t === 'replay') c.replay = m;
    else if (m.t === 'kicked') c.kicked = true;
    else if (m.t === 'left') c.left = true;
  });
  c.send = o => ws.send(JSON.stringify(o));
  c.ready = new Promise(r => ws.on('open', r));
  // Sent, and answered: everything before it has been dealt with.
  c.rt = () => { const n = c.pongs; c.send({ t: 'ping' }); return until(() => c.pongs > n); };
  // The line this socket was last told it could not do.
  c.last = () => c.errors[c.errors.length - 1] || '';
  return c;
}

/* A table, made and sat at. Nearly every block below opens with one, and the
   dance is the same each time: a screen makes it, the phones join it, the
   rules are set on it. */
async function tableOf(names, cfg, url) {
  const h = client('screen', url); await h.ready;
  h.send({ t: 'create' }); await until(() => h.hello);
  const code = h.hello.code;
  const P = [];
  for (const nm of names) {
    const c = client(nm, url); await c.ready;
    c.send({ t: 'join', code, name: nm });
    await until(() => c.hello && c.hello.seatId);
    P.push(c);
  }
  await until(() => h.state && h.state.seats.length === names.length);
  if (cfg) { h.send({ t: 'config', patch: cfg }); await h.rt(); }
  return { h, P, code };
}

// Bid the round through, in turn, never the number the dealer may not say.
async function bidRound(P) {
  for (let g = 0; g < P.length; g++) {
    const st = P[0].state, r = st.rounds[st.idx], turn = st.turn;
    if (turn === null || turn === undefined) break;
    const sum = r.bids.reduce((a, b) => a + (b || 0), 0);
    const no = (st.cfg.screw && turn === r.dealer) ? r.cards - sum : -1;
    P[turn].send({ t: 'bid', v: no === 1 ? 0 : 1 });
    await until(() => P[0].state.rounds[P[0].state.idx].bids[turn] !== null
                   || P[0].state.idx !== st.idx || P[0].state.phase !== 'bid');
  }
}

(async () => {
  /* A server left behind by a run that was stopped part way still holds this
     port, and the one spawned above quietly fails to bind. Every check then
     runs against yesterday's table and passes for the wrong reason, so say so
     and stop. */
  srv.on('exit', (code) => {
    if (!done) { console.log(`\n  FAIL the server on port ${PORT} stopped (${code}) -- is one already running?`); process.exit(1); }
  });
  await upAt(PORT);

  // static files
  const res = await fetch(`http://127.0.0.1:${PORT}/`);
  ok(res.status === 200 && (await res.text()).includes('Join a table'), 'GET / serves the landing page');
  const g = await fetch(`http://127.0.0.1:${PORT}/game.js`);
  ok(g.status === 200 && (await g.text()).includes('forbiddenBid'), 'GET /game.js serves the shared rules');

  const bad = await fetch(`http://127.0.0.1:${PORT}/../server.js`);
  ok(bad.status !== 200, 'path traversal is blocked (' + bad.status + ')');

  const net = await fetch(`http://127.0.0.1:${PORT}/net.json`).then(r => r.json());
  ok(Array.isArray(net.urls) && net.port === PORT, 'GET /net.json lists the server addresses');

  const text = 'http://192.168.1.9:' + PORT + '/?code=TEST';
  const qrRes = await fetch(`http://127.0.0.1:${PORT}/qr.svg?cell=8&d=${encodeURIComponent(text)}`);
  const svg = await qrRes.text();
  ok(qrRes.headers.get('content-type').startsWith('image/svg+xml'), 'GET /qr.svg is an SVG');
  {
    const qgen = require('qrcode-generator');
    const qr = qgen(0, 'M'); qr.addData(text); qr.make();
    const n = qr.getModuleCount(), cell = 8, margin = 4;
    const got = new Set();
    for (const m of svg.matchAll(/M(\d+) (\d+)h/g)) got.add(((+m[2]) / cell - margin) + ',' + ((+m[1]) / cell - margin));
    let dark = 0, wrong = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const on = qr.isDark(r, c); if (on) dark++;
      if (on !== got.has(r + ',' + c)) wrong++;
    }
    ok(dark > 0 && wrong === 0, `the QR svg matches the encoder (${dark} modules, ${wrong} wrong)`);
    ok(svg.includes('fill="#ffffff"'), 'the QR svg has a white background, so a camera can read it in dark mode');
  }
  const qrBad = await fetch(`http://127.0.0.1:${PORT}/qr.svg`);
  ok(qrBad.status === 400, '/qr.svg without data is refused');

  const host = client('host'); await host.ready;
  host.send({ t: 'create' }); await until(() => host.hello);
  const code = host.hello.code;
  ok(!!code && code.length === 4, 'host created table ' + code);

  const P = [];
  for (const nm of ['Amy', 'Hugh', 'Joe']) {
    const c = client(nm); await c.ready; c.send({ t: 'join', code, name: nm });
    await until(() => c.hello); P.push(c);
  }
  await okBy(() => host.state.seats.length === 3, '3 seats taken');
  ok(host.state.cfg.ones === 3, 'ones follows the player count');

  const dupe = client('dupe'); await dupe.ready; dupe.send({ t: 'join', code, name: 'amy' });
  await okBy(() => /taken/.test(dupe.last()), 'duplicate name is refused');
  ok(dupe.errors.every(e => /^[A-Z].*\.$/.test(e)), 'and a refusal is a sentence, like everything a page says  got ' + JSON.stringify(dupe.errors));

  // rules: 2 cards down to 1, three 1-card rounds => 2,1,1,1
  P[0].send({ t: 'config', patch: { max: 2, pattern: 'down', ones: 3 } });
  await okBy(() => JSON.stringify(Game_schedule(host.state.cfg)) === '[2,1,1,1]', 'schedule is 2,1,1,1');

  // the first player to sit down runs the table
  ok(host.state.captainId === P[0].seatId, 'the first player to sit down is the table host');
  P[1].send({ t: 'start' });
  await okBy(() => /only the table host/i.test(P[1].last()), 'another player cannot start the game');
  P[1].send({ t: 'config', patch: { max: 9 } });
  await okBy(() => P[1].errors.length === 2, 'and cannot change the rules');

  P[0].send({ t: 'captain', id: P[2].seatId });
  await okBy(() => host.state.captainId === P[2].seatId, 'the table host can pass it on');
  host.send({ t: 'captain', id: P[0].seatId });
  await okBy(() => host.state.captainId === P[0].seatId, 'the host screen can hand it back');

  P[0].send({ t: 'config', patch: { max: 2 } });
  await okBy(() => host.state.cfg.max === 2, 'the table host can change the rules');

  // pick who deals the first round, then put it back for the rest of this game
  host.send({ t: 'config', patch: { firstDealer: P[2].seatId } });
  await okBy(() => host.state.firstDealerId === P[2].seatId, 'the host can choose the first dealer');
  // a seat dragged to a new place lands there, and the rest close up
  host.send({ t: 'seatMove', id: P[2].seatId, to: 0 });
  await okBy(() => host.state.seats.map((s) => s.name).join(',') === 'Joe,Amy,Hugh',
     'a seat dragged to the top lands there  got ' + host.state.seats.map((s) => s.name).join(','));
  host.send({ t: 'seatMove', id: P[2].seatId, to: 2 });
  await okBy(() => host.state.seats.map((s) => s.name).join(',') === 'Amy,Hugh,Joe', 'and dragged back');
  host.send({ t: 'config', patch: { firstDealer: null } });
  await okBy(() => host.state.firstDealerId === null, 'and can clear it again');

  host.send({ t: 'start' });
  await okBy(() => host.state.phase === 'bid' && host.state.rounds.length === 4, 'game started, 4 rounds');
  ok(host.state.turn === 1, 'round 1: seat 1 bids first (dealer is seat 0)');

  P[1].send({ t: 'dealt' });
  await okBy(() => /real cards/.test(P[1].last()),
     'a table with real cards deals nothing on the phones, so it is told nothing');

  /* ---- a whole round, over real sockets ----
     Every rule the bidding and the counting obey is settled in test-rules.js,
     against the room itself. What a socket adds is what is checked here: a
     refusal comes back to the phone that earned it, and a bid landing on one
     phone is on every screen at the table a moment later. */
  P[0].send({ t: 'bid', v: 1 });
  await okBy(() => /turn to bid/.test(P[0].last()), 'a bid out of turn is refused, and the phone is told why');

  P[1].send({ t: 'bid', v: 1 });
  await okBy(() => host.state.turn === 2, 'a bid made on a phone moves the turn on every screen');
  await okBy(() => P[2].state.rounds[0].bids[1] === 1, 'and the number is on the other phones too');

  P[2].send({ t: 'bid', v: 1 });
  await until(() => host.state.turn === 0);          // round to the dealer
  P[0].send({ t: 'bid', v: 1 });
  await okBy(() => host.state.phase === 'tricks', 'the last bid in starts the play');
  ok(host.state.play && host.state.play.won.join() === '0,0,0',
     'and the table opens the count with nobody having taken a trick');

  /* ---- the bids stand before anything is counted ----
     The beat is the room's, and a phone that taps over it hears why from the
     table rather than from its own screen. */
  P[0].send({ t: 'trick', p: 0 });                   // seat 0 deals this round
  await okBy(() => /bids are still up/.test(P[0].last()),
     'a trick counted while the bids stand is refused, and the phone is told why');
  await okBy(() => host.state.play.held === false, 'the bids are read, and the count opens');
  ok(host.state.play.won.join() === '0,0,0', 'with nothing counted over the moment');

  // ---- the tricks are counted by the dealer ----
  P[1].send({ t: 'trick', p: 0 });
  await okBy(() => /dealer counts the tricks/i.test(P[1].last()),
     'a phone that is not the dealer is told whose job it is  got ' + JSON.stringify(P[1].last()));
  ok(host.state.play.won.join() === '0,0,0', 'and nothing lands on any screen');
  P[0].send({ t: 'trick', p: 0 });
  await okBy(() => host.state.play.won.join() === '1,0,0', 'the dealer counts a trick');
  P[2].send({ t: 'trickback' });
  await okBy(() => /dealer counts the tricks/i.test(P[2].last()), 'nor may anybody else take one back');
  P[0].send({ t: 'trickback' });
  await okBy(() => host.state.play.won.join() === '0,0,0', 'the dealer takes it back');
  host.send({ t: 'trick', p: 0 });
  await okBy(() => P[0].state.play.won.join() === '1,0,0', 'the host screen counts one too, and the phones see it');
  P[0].send({ t: 'trick', p: 1 });
  await okBy(() => host.state.idx === 1 && host.state.phase === 'bid',
     'the last trick scores the round, and the next one opens');
  ok(JSON.stringify(host.state.rounds[0].tricks) === '[1,1,0]',
     'with the tricks as counted  got ' + JSON.stringify(host.state.rounds[0].tricks));
  ok(JSON.stringify(host.state.totals) === '[11,11,0]', 'and the scores worked out  got ' + JSON.stringify(host.state.totals));
  const r2 = host.state.rounds[1];
  ok(r2.cards === 1 && r2.dealer === 1, 'round 2: 1 card, dealer is seat 1');

  // ---- a step back, and a hand thrown in ----
  host.send({ t: 'undo' });
  await okBy(() => host.state.idx === 0 && host.state.phase === 'tricks', 'the host screen takes a step back');
  P[0].send({ t: 'trick', p: 1 }); await P[0].rt();
  P[0].send({ t: 'trick', p: 2 });
  await okBy(() => JSON.stringify(host.state.totals) === '[0,11,11]',
     'and the round is counted again  got ' + JSON.stringify(host.state.totals));

  P[2].send({ t: 'bid', v: 1 }); await P[2].rt();
  P[2].send({ t: 'bumdeal' });
  await okBy(() => host.state.vote && host.state.vote.by === 2, 'a player calling a bum deal opens a vote');
  ok(host.state.rounds[1].bids[2] === 1, 'and the hand is not thrown in on one voice');
  P[0].send({ t: 'vote', agree: true }); await P[0].rt();
  P[1].send({ t: 'vote', agree: true });
  await okBy(() => host.state.vote === null && host.state.rounds[1].bids.every(b => b === null),
     'every player agreeing throws the hand in');
  ok(host.state.rounds[1].redeals === 1 && host.state.idx === 1 && host.state.phase === 'bid',
     'the re-deal is counted, and the same round opens again');

  // ---- reconnect ----
  const tok = P[2].hello.token;
  P[2].ws.close();
  await okBy(() => host.state.seats[2].online === false, 'seat 2 shows as offline');
  const back = client('Joe2'); await back.ready;
  back.send({ t: 'resume', code, token: tok });
  await okBy(() => back.hello && back.hello.seatId === P[2].seatId, 'resume returns the same seat');
  await okBy(() => host.state.seats[2].online === true, 'seat 2 is back online');

  // ---- late join is refused ----
  const late = client('late'); await late.ready;
  late.send({ t: 'join', code, name: 'Zoe' });
  await okBy(() => /already started/.test(late.last()), 'joining after the start is refused');

  // ---- a second table, to check the chosen first dealer ----
  {
    const { h: h2, P: seats } = await tableOf(['Ann', 'Bob', 'Cal'], { max: 2, pattern: 'down', ones: 3 });
    h2.send({ t: 'config', patch: { firstDealer: seats[1].seatId } });
    await okBy(() => h2.state.firstDealerId === seats[1].seatId, 'the host picks who deals the first round');
    h2.send({ t: 'start' });
    await okBy(() => h2.state.rounds.length === 4, 'the game starts');
    ok(h2.state.rounds.map(r => r.dealer).join(',') === '1,2,0,1', 'the deal starts with the chosen player');
    ok(h2.state.turn === 2, 'and bidding starts left of that dealer');
    // removing that player clears the choice
    h2.send({ t: 'reset' }); await h2.rt();
    h2.send({ t: 'kick', id: seats[1].seatId });
    await okBy(() => h2.state.firstDealerId === null, 'removing the chosen dealer clears the choice');
  }

  // ---- a table with no host screen at all ----
  {
    const { h: h3, P: seats } = await tableOf(['Dot', 'Eve'], { max: 1, pattern: 'down', ones: 2 });
    h3.ws.close();                                    // the host screen walks away
    await okBy(() => !seats[0].state.tv, 'the host screen goes, and the table knows it is on no wall');
    seats[0].send({ t: 'start' });
    await okBy(() => seats[0].state.phase === 'bid' && seats[0].state.rounds.length === 2,
       'the table host starts a game with no host screen');
    const r = seats[0].state.rounds[0];
    await bidRound(seats);
    await okBy(() => seats[0].state.phase === 'tricks', 'and the bidding runs without one');
    await until(() => seats[0].state.play.held === false);   // the bids are read first
    seats[r.dealer].send({ t: 'trick', p: 0 });       // the dealer keeps the round
    await okBy(() => seats[0].state.idx === 1, 'and the round scores');
    seats[0].send({ t: 'undo' });
    await okBy(() => seats[0].state.idx === 0 && seats[0].state.phase === 'tricks', 'the table host can go back');
    seats[0].send({ t: 'reset' });
    await okBy(() => seats[0].state.phase === 'lobby', 'and can call a new game');
  }

  // ---- start a table and take a seat, from one phone ----
  {
    const solo = client('solo'); await solo.ready;
    solo.send({ t: 'create' }); await until(() => solo.hello);
    const code4 = solo.hello.code;
    solo.send({ t: 'join', code: code4, name: 'Solo' });
    await okBy(() => solo.hello.role === 'player' && !!solo.hello.seatId,
       'one socket can make a table and take a seat');
    ok(solo.state.seats.length === 1 && solo.state.seats[0].name === 'Solo', 'the seat is at the new table');
    ok(solo.state.captainId === solo.hello.seatId, 'and that player runs the table');
    ok(solo.state.code === code4, 'the code is the one the QR shows');
  }

  /* ---- a table that plays with a virtual deck ----
     One whole round, dealt by the server and played card by card over real
     sockets. Which card may go is the deck's business and is settled in
     test-rules.js; what is proved here is that the hands reach the phones that
     hold them and nobody else, that a trick played out moves every screen on,
     and that a hand comes back to a phone that comes back. */
  {
    const { h: vh, P, code } = await tableOf(['Ann', 'Bob', 'Cal'],
                                             { deck: 'virtual', max: 3, pattern: 'down', ones: 1 });
    vh.send({ t: 'start' });
    await okBy(() => P.every((c) => c.state.hand && c.state.hand.length === 3), 'every player is dealt a hand');
    ok(!vh.state.hand, 'the host screen is dealt none');
    const dealt = P.flatMap((c) => c.state.hand);
    ok(new Set(dealt).size === 9, 'and no card is dealt twice');
    ok(P[0].state.play.counts.join(',') === '3,3,3', 'the table sees only how many cards each hand holds');
    ok(!P[0].state.play.hands, 'and never the cards themselves');
    const up = P[0].state.play.upcard;
    ok(!!up && dealt.indexOf(up) < 0, 'the trump is turned from the rest of the deck');
    ok(P[0].state.rounds[0].trump === up.slice(-1), 'and it sets the trump suit');

    const r0 = P[0].state.rounds[0];
    await bidRound(P);
    await okBy(() => P[0].state.phase === 'tricks', 'the last bid starts the play');
    ok(P[0].state.play.held === true && P[0].state.play.turn === null,
       'the bids stand to be read, with nobody yet on play');
    await okBy(() => P[0].state.play.held === false, 'and then the hand opens');
    ok(P[0].state.play.turn === (r0.dealer + 1) % 3, 'and the player left of the dealer leads');

    // ---- one card at a time ----
    const suit = (c) => c.slice(-1);
    async function playOne() {
      const st = P[0].state;
      const p = st.play.turn;
      const led = st.play.trick.length ? suit(st.play.trick[0].card) : null;
      const same = P[p].state.hand.filter((c) => suit(c) === led);
      const card = (led && same.length ? same : P[p].state.hand)[0];
      const held = P[p].state.hand.length;
      P[p].send({ t: 'play', card });
      // the card leaves the hand, and then, if that finished the trick, the
      // table waits out the moment it is held up for before anybody leads
      await until(() => P[p].state.hand.length < held || P[0].state.phase !== 'tricks');
      await until(() => P[0].state.phase !== 'tricks' || P[0].state.play.turn !== null, 4000);
      return { p, card };
    }

    let guard = 40;
    while (P[0].state.phase === 'tricks' && guard-- > 0) await playOne();
    const done = P[0].state.rounds[0];
    ok(Array.isArray(done.tricks) && done.tricks.reduce((a, b) => a + b, 0) === 3,
       'the cards count the tricks themselves, and they total the hand');
    ok(P[0].state.idx === 1 && P[0].state.phase === 'bid', 'and the round scores and moves on');
    ok(P[0].state.hand.length === P[0].state.rounds[1].cards, 'the next hand is dealt at once');

    vh.send({ t: 'trick', p: 0 });
    await okBy(() => /count themselves/.test(vh.last()), 'nobody may count a trick by hand');

    // ---- a hand survives a phone going away and coming back ----
    const held = P[2].state.hand.join(',');
    const seatTok = P[2].hello.token;
    P[2].ws.close();
    await until(() => vh.state.seats[2].online === false);
    const back = client('vCal2'); await back.ready;
    back.send({ t: 'resume', code, token: seatTok });
    await okBy(() => back.state && back.state.hand.join(',') === held,
       'a phone that comes back gets its own hand again');
    ok(back.state.seats[2].online === true, 'and the seat is at the table again');
  }

  // ---- the dev controls are refused unless DEV=1 ----
  {
    const d = client('devprobe'); await d.ready;
    d.send({ t: 'dev', action: 'setup', players: 4 });
    await okBy(() => /DEV=1/.test(d.last()), 'the dev controls are refused on a normal server');
    ok(!d.state, 'and no table is made');
    ok(host.state.dev === false, 'and the state says tables of stand-ins are off');
  }

  // ---- but the host of a real table can fix that table, on any server ----
  {
    const { h, P: [p1, p2], code } = await tableOf(['Ann', 'Bob'], { max: 1, pattern: 'down', ones: 2 });
    h.send({ t: 'start' });
    await until(() => h.state.phase === 'bid');

    h.send({ t: 'dev', action: 'patch', patch: { round: { i: 0, bids: [1, 0], tricks: [1, 0] } } });
    await okBy(() => JSON.stringify(h.state.rounds[0].bids) === '[1,0]', 'the host of a real table can force a round');
    ok(h.hello.stand === false, 'and is told it is not a table of stand-ins');
    ok(h.hello.seats.every((x) => !x.token), 'and gets no seat tokens back');

    h.send({ t: 'dev', action: 'randomise' });
    await okBy(() => /DEV=1/.test(h.last()), 'but on a normal server nothing may invent data for it');
    h.send({ t: 'dev', action: 'endGame' }); await h.rt();
    ok(h.state.phase === 'bid', 'and it cannot be played out with made-up rounds');
    h.send({ t: 'dev', action: 'step' });
    await okBy(() => /DEV=1/.test(h.last()),
       'and walking a table on a move at a time is a dev server\'s');

    p2.send({ t: 'dev', action: 'patch', patch: { phase: 'done' } });
    await okBy(() => /only the host/i.test(p2.last()) && h.state.phase === 'bid',
       'a player who does not run the table cannot use the dev controls');

    h.send({ t: 'dev', action: 'patch', patch: { round: { i: 0, tricks: ['x', 9] } } });
    await okBy(() => h.state.rounds[0].tricks === null, 'junk tricks are dropped, not stored');
    h.send({ t: 'dev', action: 'patch', patch: { round: { i: 0, tricks: [5, 0] } } });
    await okBy(() => JSON.stringify(h.state.rounds[0].tricks) === '[1,0]', 'and a count above the hand size is clamped');

    /* ---- the record itself, on a normal server ----
       The whole table as text is how a game nothing else reaches is put
       right, so the host token gets it here too. What it must not carry is
       the way into anybody's seat, and the keys it comes back without must
       still be the table's own after a paste. */
    h.send({ t: 'dev', action: 'state' });
    await okBy(() => h.raw && h.raw.code === code && Array.isArray(h.raw.rounds),
       'the host of a real table can read the record whole');
    ok(h.raw.seats.length === 2 && h.raw.seats.every((x) => !x.token && !x.watch),
       'but the record hands out no seat keys');

    const rec = JSON.parse(JSON.stringify(h.raw));
    rec.rounds[0].bids = [1, 1];
    rec.hostToken = 'EVIL';                       // the keys are the table's, not the text's
    rec.seats[0].token = 'EVIL-SEAT';
    h.send({ t: 'dev', action: 'state', record: rec });
    await okBy(() => JSON.stringify(h.state.rounds[0].bids) === '[1,1]',
       'and an edited record becomes the table');

    const after = client('after'); await after.ready;
    after.send({ t: 'dev', action: 'open', code, token: h.hello.token });
    await okBy(() => after.hello && after.hello.code === code,
       'the host token still opens the table a pasted record tried to rekey');
    const seatBack = client('seatback'); await seatBack.ready;
    seatBack.send({ t: 'resume', code, token: p1.hello.token });
    await okBy(() => seatBack.state && seatBack.state.code === code,
       'and a seat keeps the key its phone holds');

    h.send({ t: 'dev', action: 'state', record: [1, 2] });
    await okBy(() => /not a table/.test(h.last()), 'junk in the editor is refused whole');
    seatBack.ws.close();
    after.ws.close();

    /* ---- a game watched again, on a table of its own ----
       What a replay is, is settled in test-rules.js. What is proved here is
       that it is a copy: a table of its own that nobody can reach, nobody can
       play at, and that goes when the page watching it does. */
    h.send({ t: 'dev', action: 'replay', do: 'open' });
    await okBy(() => h.replay && h.replay.code, 'the host token opens a replay on a normal server');
    const copy = h.replay.code;
    ok(copy !== code, 'and it is a table of its own  got ' + copy);
    ok(h.replay.of === code, 'which says what it is a copy of');
    ok(h.replay.seats.every((s) => s.watch), 'its seats are watched, never played');
    ok(h.replay.n > 0 && h.replay.marks.length > 0, 'with the rounds to move about in');

    const eye2 = client('atcopy'); await eye2.ready;
    eye2.send({ t: 'watch', code: copy, token: h.replay.seats[0].watch });
    await okBy(() => eye2.state && eye2.state.code === copy, 'a window can watch the copy');
    eye2.send({ t: 'bid', v: 1 });
    await okBy(() => /only watching/i.test(eye2.last()),
       'but nothing can be played at it: a watch token is the only way in  got ' + eye2.last());

    const seen = await (await fetch(`http://127.0.0.1:${PORT}/tables.json`)).json();
    ok(!seen.tables.some((x) => x.code === copy),
       'and it is never offered as a table to go to');

    const wasPhase = h.state.phase, wasIdx = h.state.idx;
    h.send({ t: 'dev', action: 'replay', do: 'seek', at: 1 });
    await okBy(() => h.replay.at === 1, 'the replay can be moved about in');
    await h.rt();
    ok(h.state.phase === wasPhase && h.state.idx === wasIdx,
       'and the table it copies does not move with it');

    /* And it plays itself back, at the pace the table played it. */
    h.send({ t: 'dev', action: 'replay', do: 'seek', at: 0 });
    await okBy(() => h.replay.at <= 1,
       'put back to the start, which is the first picture there is  got ' + h.replay.at);
    h.send({ t: 'dev', action: 'replay', do: 'play' });
    await okBy(() => h.replay.playing === true, 'and set going');
    await okBy(() => h.replay.at > 0, 'it walks itself on  got ' + h.replay.at);
    h.send({ t: 'dev', action: 'replay', do: 'pause' });
    await okBy(() => h.replay.playing === false, 'and stops where it is');
    const stoodAt = h.replay.at;
    await wait(300);                       // longer than several of its beats
    ok(h.replay.at === stoodAt, 'and stays there  got ' + h.replay.at + ' from ' + stoodAt);

    // Moving about in it by hand stops it: two clocks would fight over it.
    h.send({ t: 'dev', action: 'replay', do: 'play' });
    await okBy(() => h.replay.playing === true, 'set going again');
    h.send({ t: 'dev', action: 'replay', do: 'seek', at: 1 });
    await okBy(() => h.replay.playing === false && h.replay.at === 1,
       'moving it by hand stops it playing itself');

    h.send({ t: 'dev', action: 'replay', do: 'close' });
    await okBy(() => h.replay.code === null, 'the replay can be let go');
    const after2 = await (await fetch(`http://127.0.0.1:${PORT}/tables.json`)).json();
    ok(!after2.tables.some((x) => x.code === copy), 'and the copy goes with it');
    eye2.ws.close();

    // ---- the seats come back as watching windows, not as seats ----
    const seats = h.hello.seats;
    ok(seats.length === 2 && seats.every((x) => x.watch && !x.token),
       'a real table gives the dev page a watch token a seat, never the seat itself');

    const bobWatch = seats.find((x) => x.name === 'Bob').watch;
    p2.ws.close();                                        // Bob puts his phone down
    await okBy(() => h.state.seats[1].online === false, 'Bob is offline once his phone goes');

    const eye = client('watcher'); await eye.ready;
    eye.send({ t: 'watch', code, token: bobWatch });
    await okBy(() => eye.hello && eye.hello.role === 'watch' && eye.hello.seatId === h.state.seats[1].id,
       'a watch token opens that seat and says which one it is');
    await okBy(() => eye.state && eye.state.code === code, 'and the window gets the same state the phone gets');
    ok(h.state.seats[1].online === false, 'and watching does not put the player back at the table');

    eye.send({ t: 'bid', v: 1 });
    eye.send({ t: 'dev', action: 'patch', patch: { phase: 'done' } });
    eye.send({ t: 'chat', text: 'hello from the sofa' });
    await okBy(() => eye.errors.filter((e) => /only watching/.test(e)).length === 3,
       'and it can do nothing at all');
    ok(h.state.phase === 'bid', 'so the game is untouched');
    ok(!(h.state.chat || []).length, 'and it has said nothing');

    const fake = client('faker'); await fake.ready;
    fake.send({ t: 'resume', code, token: bobWatch });
    await okBy(() => /seat is gone/.test(fake.last()) && !fake.state,
       'a watch token cannot be used to take the seat');

    // ---- the way onto a table already in play ----
    const gate = client('gate'); await gate.ready;
    gate.send({ t: 'dev', action: 'tables' });
    await okBy(() => /DEV=1/.test(gate.last()), 'a normal server will not list its tables');
    gate.send({ t: 'dev', action: 'open', code, token: 'not-the-token' });
    await okBy(() => /host token/.test(gate.last()), 'and will not open one without its host token');
    ok(!gate.hello, 'so the page is left where it was');
    gate.send({ t: 'dev', action: 'open', code, token: h.hello.token });
    await okBy(() => gate.hello && gate.hello.code === code,
       'the host token opens the dev page on that table');
    ok(gate.hello.stand === false && gate.hello.seats.length === 2
       && gate.hello.seats.every((x) => x.watch && !x.token),
       'and the phones come with it as watching windows, before anything is pressed');
    await h.rt();
    ok(h.state.seats[1].online === false, 'and the page opening on it puts nobody back at the table');
    gate.send({ t: 'dev', action: 'seat', id: h.state.seats[0].id });
    await okBy(() => /DEV=1/.test(gate.last()), 'a normal server never hands a seat out');
    gate.send({ t: 'dev', action: 'end', code });
    await okBy(() => /DEV=1/.test(gate.last()) && !!h.state, 'and never destroys a table over a code');
  }

  // ---- the dev controls on a server started with DEV=1 ----
  {
    const port3 = PORT + 2;
    const srv3 = spawn('node', [path + '/server.js'], {
      env: { ...process.env, PORT: port3, NO_TLS: '1', DEV: '1', DATA_DIR, ...TUNED }, stdio: 'ignore',
    });
    await upAt(port3);
    const d = client('dev', `ws://127.0.0.1:${port3}/ws`); await d.ready;
    d.send({ t: 'dev', action: 'setup', players: 4 });
    await okBy(() => d.hello && d.hello.dev && d.hello.seats.length === 4,
       'dev setup makes 4 stand-in seats with tokens');
    // The hello and the first state are two frames, and the hello comes first:
    // read on the hello alone, the state is sometimes not there yet.
    await okBy(() => !!d.state, 'and the table itself reaches the page');
    ok(d.state.dev === true, 'and the state says tables of stand-ins are on');
    d.send({ t: 'dev', action: 'startGame' }); await d.rt();
    d.send({ t: 'dev', action: 'fillBids' });
    await okBy(() => d.state.phase === 'tricks' && d.state.rounds[0].bids.every((b) => b !== null),
       'fillBids fills every bid');
    const r0 = d.state.rounds[0];
    const bidSum = r0.bids.reduce((a, b) => a + b, 0);
    ok(!d.state.cfg.screw || bidSum !== r0.cards, 'and keeps the screw-the-dealer rule');
    d.send({ t: 'dev', action: 'endGame' });
    await okBy(() => d.state.phase === 'done', 'endGame plays every round');

    // ---- the accolades are drawn and paid before anybody wins ----
    {
      const aw = d.state.awards || [];
      const pay = d.state.cfg.accoladePay;
      ok(aw.length > 0 && aw.length <= 3, 'the game ends with up to three accolades drawn  got ' + aw.length);
      ok(aw.every((a) => a.title && a.note && a.who.length), 'each one names a player and says why');
      ok(new Set(aw.map((a) => a.key)).size === aw.length, 'and no accolade is drawn twice');
      const raw = require(path + '/game.js').totals(d.state.cfg, d.state.rounds, 4);
      const want = raw.map((v, i) => v + d.state.bonus[i]);
      ok(JSON.stringify(d.state.totals) === JSON.stringify(want),
         'the totals everybody is ranked by carry what the accolades paid');
      const owed = aw.reduce((sum, a) => sum + a.who.length * pay, 0);
      ok(d.state.bonus.reduce((a, b) => a + b, 0) === owed, 'and every winner is paid ' + pay);
      d.send({ t: 'undo' });
      await okBy(() => !d.state.awards && d.state.bonus.every((b) => !b), 'going back puts the accolades away');
      d.send({ t: 'dev', action: 'endGame' });
      await okBy(() => (d.state.awards || []).length > 0, 'and ending it again draws them afresh');

      // how many are drawn is a rule of the table
      const again = async (patch) => {
        d.send({ t: 'dev', action: 'patch', patch: { phase: 'tricks' } }); await d.rt();
        if (patch) { d.send({ t: 'config', patch }); await d.rt(); }
        d.send({ t: 'dev', action: 'patch', patch: { phase: 'done' } });
        await until(() => d.state.phase === 'done');
        return d.state.awards || [];
      };
      ok((await again({ accoladeCount: 1 })).length === 1, 'a table can ask for one accolade');
      ok((await again({ accoladeCount: 5 })).length === 5, 'or five');
      const none = await again({ accoladeCount: 0 });
      ok(none.length === 0 && d.state.bonus.every((b) => !b), 'or none at all');
      const three = await again({ accoladeCount: 3, accoladePay: 20 });
      ok(three.length === 3, 'and back to three');
      // an accolade two players share pays them both, so count the holders
      const owed20 = three.reduce((sum, a) => sum + a.who.length * 20, 0);
      ok(d.state.bonus.reduce((a, b) => a + b, 0) === owed20,
         'paying 20 each  got ' + d.state.bonus.join(',') + ' for ' +
         three.map((a) => a.who.length).join('+') + ' holders');
      d.send({ t: 'config', patch: { accoladeCount: 99, accoladePay: 7 } }); await d.rt();
      ok(d.state.cfg.accoladeCount === 3 && d.state.cfg.accoladePay === 20,
         'values outside the rules are refused  got ' + d.state.cfg.accoladeCount + '/' + d.state.cfg.accoladePay);
    }
    d.send({ t: 'dev', action: 'patch', patch: { idx: 1, phase: 'bid' } });
    await okBy(() => d.state.idx === 1 && d.state.phase === 'bid', 'patch forces the round and the phase');
    d.send({ t: 'dev', action: 'patch', patch: { round: { i: 0, bids: [1, 0, 2, 1], tricks: [1, 1, 1, 1] } } });
    await okBy(() => JSON.stringify(d.state.rounds[0].bids) === '[1,0,2,1]' && d.state.totals.some((t) => t !== 0),
       'patch forces a round, and the totals follow');

    // ---- a random scorecard ----
    const full = (r) => r.bids && r.bids.every((b) => b !== null) && Array.isArray(r.tricks);
    d.send({ t: 'dev', action: 'fillCard', rounds: 3 });
    await okBy(() => d.state.rounds.filter(full).length === 3 && d.state.idx === 3 && d.state.phase === 'bid',
       'fillCard plays the number of rounds asked for');
    const played = d.state.rounds.filter(full);
    ok(played.every((r) => r.tricks.reduce((a, b) => a + b, 0) === r.cards),
       'and every filled hand has all of its tricks');
    ok(played.every((r) => !d.state.cfg.screw || r.bids.reduce((a, b) => a + b, 0) !== r.cards),
       'and every filled round keeps the screw-the-dealer rule');
    ok(played.every((r) => !d.state.cfg.trump || r.trump), 'and every filled round has a trump');
    ok(d.state.rounds.slice(3).every((r) => !full(r)), 'and the rounds after it are still empty');
    d.send({ t: 'dev', action: 'fillCard' }); await d.rt();
    const many = d.state.rounds.filter(full).length;
    ok(many >= 1 && many <= d.state.rounds.length, 'fillCard with no number plays a random number of rounds');

    // ---- straight to a round and a phase ----
    const last = d.state.rounds.length;
    d.send({ t: 'dev', action: 'goto', round: last, phase: 'tricks' });
    await okBy(() => d.state.idx === last - 1 && d.state.phase === 'tricks',
       'goto lands the game at the last round with its bids in');
    ok(d.state.rounds[last - 1].bids.every((b) => b !== null), 'and every bid of that round is there');
    ok(d.state.rounds.slice(0, last - 1).every(full), 'and every round before it is played');
    d.send({ t: 'dev', action: 'nextRound' });
    await okBy(() => d.state.phase === 'done',
       'so the end of the game is one click from there');
    d.send({ t: 'dev', action: 'goto', round: 1, phase: 'bid' });
    await okBy(() => d.state.idx === 0 && d.state.phase === 'bid' && !d.state.rounds.some(full),
       'and goto backwards rebuilds the card fresh');

    // ---- one player at a time ----
    d.send({ t: 'dev', action: 'patch', patch: { seat: { i: 1, name: 'Hix', bot: true } } });
    await okBy(() => d.state.seats[1].name === 'Hix' && d.state.seats[1].bot === true,
       'a seat can be renamed and handed to a bot');
    d.send({ t: 'dev', action: 'patch', patch: { seat: { i: 1, bot: false } } });
    await okBy(() => d.state.seats[1].bot === false, 'and handed back');
    d.send({ t: 'dev', action: 'patch', patch: { seat: { i: 0, left: true } } });
    await okBy(() => d.state.seats[0].left === true, 'a seat can be stood down');
    ok(d.state.captainId !== d.state.seats[0].id, 'and the table host job moves off it');
    d.send({ t: 'dev', action: 'patch', patch: { seat: { i: 0, left: false }, captainId: d.state.seats[0].id } });
    await okBy(() => d.state.seats[0].left === false && d.state.captainId === d.state.seats[0].id,
       'and stood back up, with the job handed back');
    d.send({ t: 'dev', action: 'patch', patch: { round: { i: 0, dealer: 2 } } });
    await okBy(() => d.state.rounds[0].dealer === 2, 'the round on show can change its dealer');

    // ---- the whole table as text ----
    d.send({ t: 'dev', action: 'state' });
    await okBy(() => d.raw && d.raw.code === d.state.code && Array.isArray(d.raw.rounds)
      && d.raw.seats.length === 4 && !!d.raw.seats[0].token,
       'the page can read the table whole, the same record the disk gets');
    const rec = JSON.parse(JSON.stringify(d.raw));
    rec.rounds[0].bids = [2, 0, 1, 0];
    rec.rounds[0].tricks = [3, 0, 0, 0];
    rec.idx = 1;
    rec.phase = 'bid';
    rec.code = 'HACK';                    // the code is the key the table is held under
    d.send({ t: 'dev', action: 'state', record: rec });
    await okBy(() => d.state.idx === 1 && JSON.stringify(d.state.rounds[0].tricks) === '[3,0,0,0]'
      && d.state.totals.some((v) => v !== 0),
       'an edited record becomes the table, totals and all');
    ok(d.state.code !== 'HACK', 'but its code stays what it was');
    d.send({ t: 'dev', action: 'state', record: [1, 2] });
    await okBy(() => /not a table/.test(d.last()), 'junk in the editor is refused whole');
    /* ---- a table of stand-ins makes a trail like any other ----
       Randomise plays a whole game through the room's own verbs, so the trail
       it leaves is a real one and replays like a real one. This is the path a
       developer actually uses: shuffle up a game, then watch it back. */
    d.send({ t: 'dev', action: 'randomise' });
    await okBy(() => d.state && d.state.rounds.length > 0, 'a table of stand-ins is shuffled up');
    d.send({ t: 'dev', action: 'endGame' });
    await okBy(() => d.state.phase === 'done', 'and played out to the finish');
    const rounds = d.state.rounds.length;
    d.send({ t: 'dev', action: 'replay', do: 'open' });
    await okBy(() => d.replay && d.replay.code, 'and the game it played can be watched again');
    ok(d.replay.marks.length === rounds + 1,
       'with every round to move about in, and the finish  got '
       + d.replay.marks.length + ' for ' + rounds + ' rounds');
    ok(d.replay.marks[d.replay.marks.length - 1].w === 'end', 'the last of them being the finish');
    d.send({ t: 'dev', action: 'replay', do: 'seek', at: d.replay.marks[0].at });
    await okBy(() => d.replay.at === d.replay.marks[0].at, 'and it can be taken to a round');
    ok(/Round|finish/i.test(d.replay.where || ''),
       'which says what is on the table  got ' + d.replay.where);
    d.send({ t: 'dev', action: 'replay', do: 'close' }); await d.rt();

    d.send({ t: 'dev', action: 'goto', round: 1, phase: 'bid' }); await d.rt();

    /* ---- a stopped table, walked on one move at a time ----
       Watching a hand play itself at a bot's pace is no way to read it. With
       the table stopped, Step is the one move the driver would have made. */
    {
      const url3 = `ws://127.0.0.1:${port3}/ws`;
      const { h: hs, P: [amy] } = await tableOf(['Amy'],
        { deck: 'virtual', max: 3, pattern: 'down', ones: 1 }, url3);
      hs.send({ t: 'addbot' }); await until(() => hs.state.seats.length === 2);
      hs.send({ t: 'addbot' }); await until(() => hs.state.seats.length === 3);
      hs.send({ t: 'start' });
      await until(() => hs.state.phase === 'bid');
      amy.send({ t: 'leave' });                 // every seat is the table's now
      await until(() => hs.state.seats.every((s) => s.bot || s.left));

      hs.send({ t: 'pause', on: true });
      await okBy(() => hs.state.paused === true, 'a table of bots can be stopped');
      await wait(300);
      const shot = () => JSON.stringify([hs.state.idx, hs.state.phase, hs.state.rounds, hs.state.play]);
      const held = shot();
      await wait(500);
      ok(shot() === held, 'and it stands still');

      hs.send({ t: 'dev', action: 'step' });
      await okBy(() => shot() !== held, 'Step makes it move');
      const one = shot();
      await wait(500);
      ok(shot() === one, 'and only the once: the table is still stopped');

      hs.ws.close(); amy.ws.close();
    }

    /* ---- a hand stacked on purpose, played over real sockets ----
       What the rules of a trick are is settled in test-rules.js, against the
       deck itself. What is proved here is the wire: hands forced onto a table
       of stand-ins reach the phones that resume into it, and a card the rules
       refuse comes back as a refusal to the one socket that played it. */
    {
      d.send({ t: 'dev', action: 'setup', players: 3 });
      await until(() => d.hello.seats.length === 3);
      const seats = d.hello.seats;
      d.send({ t: 'config', patch: { deck: 'virtual', max: 3, pattern: 'down', ones: 1, screw: false } });
      await d.rt();
      d.send({ t: 'dev', action: 'startGame' });
      await until(() => d.state.phase === 'bid' && d.state.play);

      // The lead holds hearts. The next player holds a heart and two diamonds,
      // so they must follow.
      const dealer = d.state.rounds[0].dealer;
      const lead = (dealer + 1) % 3, second = (lead + 1) % 3, third = (second + 1) % 3;
      const stack = [];
      stack[lead] = ['KH', '3S', '4C'];
      stack[second] = ['9H', 'AD', 'KD'];
      stack[third] = ['AS', '2C', 'QD'];
      d.send({ t: 'dev', action: 'patch', patch: { hands: stack } }); await d.rt();
      d.send({ t: 'dev', action: 'patch', patch: { round: { i: 0, trump: 'D' } } });
      await until(() => d.state.rounds[0].trump === 'D');

      const at = [];
      for (const st of seats) {
        const c = client('stack-' + st.name, `ws://127.0.0.1:${port3}/ws`); await c.ready;
        c.send({ t: 'resume', code: d.state.code, token: st.token });
        await until(() => c.state && c.state.hand);
        at.push(c);
      }
      ok(at[second].state.hand.join(',') === '9H,AD,KD', 'a stand-in table can have its hands stacked');
      await bidRound(at);
      await until(() => at[0].state.play && at[0].state.play.turn === lead);

      at[lead].send({ t: 'play', card: 'KH' });
      await until(() => at[0].state.play.trick.length === 1);
      at[second].send({ t: 'play', card: 'AD' });
      await okBy(() => /must follow/.test(at[second].last()),
         'a card the rules refuse comes back to the socket that played it');
      ok(at[0].state.play.trick.length === 1, 'and the refused card stays in the hand');
      at.forEach((c) => c.ws.close());
    }

    // capability follows the server: with DEV=1 a real table gets everything
    const real = client('devreal', `ws://127.0.0.1:${port3}/ws`); await real.ready;
    real.send({ t: 'create' }); await until(() => real.hello);
    real.send({ t: 'dev', action: 'randomise' });
    await okBy(() => /at least 2 players/.test(real.last()),
       'a table with nobody at it cannot have rounds played');
    for (const nm of ['Cai', 'Dee']) {
      const c = client(nm, `ws://127.0.0.1:${port3}/ws`); await c.ready;
      c.send({ t: 'join', code: real.hello.code, name: nm });
      await until(() => c.hello && c.hello.seatId);
    }
    real.send({ t: 'dev', action: 'randomise' });
    await okBy(() => real.state && real.state.rounds.length > 0,
       'with DEV=1 a real table takes the same controls a table of stand-ins does');
    ok(real.hello.stand === false, 'while still saying it is a real table');
    real.send({ t: 'dev', action: 'patch', patch: { phase: 'done' } });
    await okBy(() => real.state.phase === 'done', 'and its state can be forced');

    // ---- what this server is running, and a way onto any of it ----
    real.send({ t: 'dev', action: 'tables' });
    await okBy(() => real.tables && real.tables.some((t) => t.code === real.hello.code && !t.stand),
       'a dev server says which tables it is running, and which of them are real games');
    ok(real.tables.some((t) => t.stand), 'and which are tables of stand-ins');
    const hop = client('devhop', `ws://127.0.0.1:${port3}/ws`); await hop.ready;
    hop.send({ t: 'dev', action: 'open', code: real.hello.code });
    await okBy(() => hop.hello && hop.hello.code === real.hello.code,
       'and with DEV=1 the code alone opens the dev page on any of them');
    ok(hop.hello.stand === false, 'which says real players may be behind it');
    hop.send({ t: 'dev', action: 'open', code: 'ZZZZ' });
    await okBy(() => /no table with that code/i.test(hop.last()), 'a code with no table is refused');

    // ---- a pane can take a real seat over ----
    const sid = hop.hello.seats[0].id;
    hop.send({ t: 'dev', action: 'seat', id: sid });
    await okBy(() => hop.seat && hop.seat.id === sid && !!hop.seat.token,
       'on a dev server the page can ask for a seat to act as');
    const actor = client('actor', `ws://127.0.0.1:${port3}/ws`); await actor.ready;
    actor.send({ t: 'resume', code: real.hello.code, token: hop.seat.token });
    await okBy(() => actor.hello && actor.hello.seatId === sid,
       'and the token it gets opens that very seat');

    // ---- a table destroyed outright ----
    hop.send({ t: 'dev', action: 'end', code: 'ZZZZ' });
    await okBy(() => /no table with that code/i.test(hop.last()), 'destroying a table that is not there is refused');
    hop.send({ t: 'dev', action: 'end', code: real.hello.code });
    await okBy(() => hop.tables && hop.tables.every((x) => x.code !== real.hello.code),
       'destroying a table by its code takes it off the list');
    await okBy(() => /table is gone/i.test(actor.last()),
       'and every screen at it is told the table is gone');
    srv3.kill();
  }

  // ---- a player's picture ----
  {
    const { h, P: [a, b] } = await tableOf(['Ava', 'Bob']);

    const seatOf = (st, id) => st.seats.find((x) => x.id === id);
    ok(seatOf(h.state, a.seatId).av === null, 'a new seat has no picture');
    const url = (st, id, v) => `http://127.0.0.1:${PORT}/avatar/${st.code}/${id}` + (v ? `?v=${v}` : '');
    ok((await fetch(url(h.state, a.seatId))).status === 404, 'a seat with no picture serves a 404');

    // a one-pixel PNG is enough: the bytes only have to come back whole
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    a.send({ t: 'avatar', data: 'data:image/png;base64,' + png });
    await okBy(() => seatOf(h.state, a.seatId).av !== null, 'a picture is taken');
    const ver = seatOf(h.state, a.seatId).av;
    ok(typeof ver === 'string' && ver.length === 8, 'the state carries a version, not the picture');
    ok(JSON.stringify(h.state).indexOf(png.slice(0, 24)) < 0, 'and the picture itself never rides in the state');
    ok(seatOf(h.state, b.seatId).av === null, 'a picture belongs to one seat only');

    const got = await fetch(url(h.state, a.seatId, ver));
    ok(got.status === 200 && got.headers.get('content-type') === 'image/png',
       'the picture comes back over HTTP as the type it was sent');
    ok(/immutable/.test(got.headers.get('cache-control') || ''),
       'the right version may be held in the cache for good');
    ok(Buffer.from(await got.arrayBuffer()).equals(Buffer.from(png, 'base64')),
       'the bytes come back whole');
    const stale = await fetch(url(h.state, a.seatId, 'deadbeef'));
    ok(!/immutable/.test(stale.headers.get('cache-control') || ''),
       'a guess at the version may not');

    a.send({ t: 'avatar', data: 'data:text/html;base64,' + png });
    await okBy(() => /WebP/.test(a.last()), 'only a WebP, a JPEG or a PNG is taken');
    a.send({ t: 'avatar', data: 'data:image/png;base64,' + 'A'.repeat(80000) });
    await okBy(() => /too big/.test(a.last()), 'an oversized picture is refused');
    ok(seatOf(h.state, a.seatId).av === ver, 'and a refused picture leaves the old one alone');

    a.send({ t: 'avatar', data: null });
    await okBy(() => seatOf(h.state, a.seatId).av === null, 'a player can take their picture down');

    b.send({ t: 'avatar', data: 'data:image/png;base64,' + png });
    await until(() => seatOf(h.state, b.seatId).av !== null);
    h.send({ t: 'start' });
    await until(() => h.state.phase === 'bid');
    b.send({ t: 'avatar', data: 'data:image/png;base64,' + png });
    await okBy(() => /before the game starts/.test(b.last()),
       'the pictures are set in the lobby, not mid-game');
    ok(seatOf(h.state, b.seatId).av !== null, 'and the one already set stays up');

    h.ws.close(); a.ws.close(); b.ws.close();
  }

  // ---- a finished game is kept on file ----
  {
    const port4 = PORT + 3;
    const srv4 = spawn('node', [path + '/server.js'], {
      env: { ...process.env, PORT: port4, NO_TLS: '1', DEV: '1',
             DATA_DIR, KEEP_GAMES: '3', ...TUNED }, stdio: 'ignore',
    });
    await upAt(port4);
    const d = client('gamefile', `ws://127.0.0.1:${port4}/ws`); await d.ready;
    // A whole game played out on a table of stand-ins, from the lobby up.
    const playOut = async () => {
      d.send({ t: 'dev', action: 'startGame' });
      await until(() => d.state.phase === 'bid' && d.state.idx === 0);
      d.send({ t: 'dev', action: 'endGame' });
      await until(() => d.state.phase === 'done' && d.state.gameId, 6000);
    };
    d.send({ t: 'dev', action: 'setup', players: 3 });
    await until(() => d.state && d.state.seats.length === 3);
    await playOut();
    ok(d.state.phase === 'done', 'the stand-in table plays a game out');
    const id = d.state.gameId;
    ok(typeof id === 'string' && id.length === 12, 'a finished game gets an id in the state');

    const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
    ok(files.some((f) => f.includes(id)), 'and a file of its own on the table');

    const rec = await fetch(`http://127.0.0.1:${port4}/game/${id}`).then((r) => r.json());
    ok(rec.id === id && rec.code === d.state.code, 'GET /game/<id> gives the game back');
    ok(rec.rounds.length === d.state.rounds.length && rec.seats.length === 3,
       'with every round and every seat');
    ok(JSON.stringify(rec.totals) === JSON.stringify(d.state.totals), 'and the totals as they stood');
    ok(rec.winners.length >= 1 && rec.totals[rec.winners[0]] === Math.max(...rec.totals),
       'the winner is named in the record');
    ok(JSON.stringify(rec).indexOf('token') < 0, 'and no token rides along with it');

    /* The tables this server is running, for the machine it runs on: the
       phone that hosts has no other way to find a table it holds no seat at. */
    const here = await fetch(`http://127.0.0.1:${port4}/tables.json`).then((r) => r.json());
    const mine = (here.tables || []).find((x) => x.code === d.state.code);
    ok(!!mine, 'GET /tables.json says which tables this server is running  got '
       + JSON.stringify((here.tables || []).map((x) => x.code)));
    ok(here.tables[0].code === d.state.code, 'the one last played on first');
    ok(mine.seats.length === 3 && mine.seats[0].name === d.state.seats[0].name,
       'with who is at each of them');
    ok(mine.phase === d.state.phase, 'and where each has got to');
    ok(JSON.stringify(here).indexOf('token') < 0, 'and no seat token in the listing');

    /* A table taken away by the machine that runs it: not a game ending, the
       table itself going. Asked for with POST, so no link and no page fetching
       ahead of itself can end a game. */
    ok((await fetch(`http://127.0.0.1:${port4}/table/end?c=${d.state.code}`)).status === 405,
       'GET /table/end will not end a table');
    ok((await fetch(`http://127.0.0.1:${port4}/table/end?c=ZZZZ`, { method: 'POST' })).status === 404,
       'and a code that is no table is a 404');

    const list = await fetch(`http://127.0.0.1:${port4}/games.json?code=${d.state.code}`).then((r) => r.json());
    ok(list.games.length === 1 && list.games[0].id === id, 'GET /games.json finds it by table code');
    ok(!list.games[0].rounds, 'the listing is the headline only');
    const none = await fetch(`http://127.0.0.1:${port4}/games.json?code=ZZZZ`).then((r) => r.json());
    ok(none.games.length === 0, 'and finds nothing for a table that never played');
    ok((await fetch(`http://127.0.0.1:${port4}/game/nosuchgameid`)).status === 404,
       'an id that is not a game is a 404');

    // a second game on the same table is a second record
    d.send({ t: 'dev', action: 'lobby' }); await until(() => d.state.phase === 'lobby');
    await playOut();
    ok(d.state.gameId !== id, 'a new game on the same table gets a new id');
    const two = await fetch(`http://127.0.0.1:${port4}/games.json?code=${d.state.code}`).then((r) => r.json());
    ok(two.games.length === 2 && two.games[0].id === d.state.gameId,
       'both are on file, newest first');

    // past the cap the oldest go
    for (let i = 0; i < 3; i++) {
      d.send({ t: 'dev', action: 'lobby' }); await until(() => d.state.phase === 'lobby');
      await playOut();
    }
    ok(fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).length === 3,
       'the table keeps no more than the cap  got ' +
       fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).length);
    ok((await fetch(`http://127.0.0.1:${port4}/game/${id}`)).status === 404,
       'and the oldest is gone');

    /* A game filed keeps the trail of how it was played, under the same name
       as its scorecard, and falls off by the same cap. */
    const trails = fs.readdirSync(path2.join(DATA_DIR, 'trail'))
      .filter((f) => /^\d+-[0-9a-f]{12}\.jsonl$/.test(f));
    ok(trails.length === 3, 'a game keeps the trail of how it was played  got ' + trails.length);
    ok(!trails.some((f) => f.endsWith(`-${id}.jsonl`)),
       'and the oldest trail goes when its scorecard does');
    const one = fs.readFileSync(path2.join(DATA_DIR, 'trail', trails[0]), 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l).k);
    ok(one[0] === 'G' && one[one.length - 1] === 'E',
       'a kept trail runs from the game starting to the game ending  got '
       + one[0] + '..' + one[one.length - 1]);
    d.ws.close(); srv4.kill();
  }

  /* ---- table talk ----
     What a line is made of, and how many a table keeps, are settled in
     test-rules.js. Over the wire what matters is that a line said on one phone
     is on every screen, and that the pause between lines is a real pause on a
     real clock. This server keeps five (CHAT_KEEP above). */
  {
    const { h, P: [ann, ben, cal, dot] } = await tableOf(['Ann', 'Ben', 'Cal', 'Dot']);

    ann.send({ t: 'chat', text: '  who   dealt\n  that?  ' });
    await okBy(() => h.state.chat.length === 1, 'a line a player says reaches the table');
    ok(h.state.chat[0].text === 'who dealt that?', 'as one line, however it was typed');
    ok(h.state.chat[0].name === 'Ann' && h.state.chat[0].who === ann.seatId,
       'and it says which seat said it');
    await okBy(() => ben.state.chat.length === 1, 'every other player has it too');

    h.send({ t: 'chat', text: 'no talking at the table' });
    await okBy(() => h.state.chat.length === 2 && h.state.chat[1].name === 'Table',
       'the host screen speaks as the table');

    ann.send({ t: 'chat', text: 'and again' });
    await okBy(() => /one line at a time/i.test(ann.last()), 'one socket cannot flood the table');
    ok(h.state.chat.length === 2, 'so the flooded line never lands');
    await wait(520);                              // the pause a socket must leave, on a real clock
    ann.send({ t: 'chat', text: 'said after a moment' });
    await okBy(() => h.state.chat.length === 3, 'and a moment later the same socket may speak again');

    /* One line each, from sockets that have not spoken, so nothing here waits
       out the pause between two lines from the same phone. Past the cap the
       list stops growing, so what is watched is the number on the newest line:
       every line is numbered, and the numbering runs on past the ones let go. */
    const newest = () => h.state.chat[h.state.chat.length - 1].n;
    for (const c of [ben, cal, dot]) {
      const was = newest();
      c.send({ t: 'chat', text: 'line' });
      await until(() => newest() > was);
    }
    await okBy(() => h.state.chat.length === 5, 'the table keeps only the last few  got ' + h.state.chat.length);
    ok(!h.state.chat.some((l) => /dealt/.test(l.text)), 'and the oldest have gone');

    // the talk belongs to the table, not to the game on it
    ann.send({ t: 'start' });
    await okBy(() => h.state.phase === 'bid', 'a game starts on that table');
    ok(h.state.chat.length === 5, 'and the talk carries over into it');

    h.ws.close(); ann.ws.close(); ben.ws.close();
  }

  /* ---- players the table provides ----
     A bot is a seat with nobody behind it. It has to bid its own hand and play
     its own cards, through the same rules as everybody else, with nobody
     playing for it. */
  {
    const G = require(path + '/game.js');
    const Bots = require(path + '/lib/bots.js')({
      G, curRound: () => null, broadcast: () => {},
      seatBid: () => {}, playCard: () => {}, bumDeal: () => {},
    });

    // what a hand is worth, asked directly
    ok(Bots.bidFor(['AH'], 1, 'H', null) === 1, 'the ace of trumps is a trick');
    ok(Bots.bidFor(['2S'], 1, 'H', null) === 0, 'a low card in a side suit is not');
    ok(Bots.bidFor(['AH', 'KH', 'QH', '2S', '3S'], 5, 'H', null) >= 2,
       'three top trumps are worth two or more');
    ok(Bots.bidFor(['2S', '3S', '4S', '5D', '6D'], 5, 'H', null) === 0,
       'a hand of nothing bids nothing');
    ok(Bots.bidFor(['AH'], 1, 'H', 1) === 0, 'and the bid screw-the-dealer forbids is not made');
    ok(Bots.bidFor(['2S'], 1, 'H', 0) === 1, 'either way round');
    for (let i = 0; i < 40; i++) {
      const hand = G.sortHand(G.shuffle(G.deck()).slice(0, 5));
      const b = Bots.bidFor(hand, 5, 'S', null);
      ok(b >= 0 && b <= 5, 'a bid is always one it is allowed to make  got ' + b);
    }

    // and which card to play
    const won = (trick, card, trump) =>
      G.trickWinner(trick.concat([{ p: -1, card }]), trump) === -1;
    ok(Bots.cardFor(['AS', '2S'], [], 'H', 1) === 'AS', 'wanting tricks, it leads its best');
    ok(Bots.cardFor(['AS', '2S'], [], 'H', 0) === '2S', 'wanting none, it leads its worst');
    ok(Bots.cardFor(['KS', 'QS', '2S'], [{ p: 0, card: 'JS' }], 'H', 1) === 'QS',
       'it wins a trick with the cheapest card that will');
    ok(Bots.cardFor(['KS', 'QS', '2S'], [{ p: 0, card: 'JS' }], 'H', 0) === '2S',
       'and ducks one it does not want');
    ok(Bots.cardFor(['QH', '9D', '2D'], [{ p: 0, card: 'AS' }, { p: 1, card: 'KS' }], 'H', 0) === '9D',
       'ducking, it throws its best side card and keeps its trump');
    ok(Bots.cardFor(['2H', 'AS', 'KS'], [], 'H', 2) === 'AS',
       'and it leads its ace, not the two of trumps');
    ok(Bots.cardFor(['AH', 'AS', '2S'], [], 'H', 2) === 'AH',
       'the ace of trumps ahead of the other ace');
    ok(Bots.cardFor(['2H', '3S'], [{ p: 0, card: 'AS' }], 'H', 1) === '3S',
       'holding the suit led, it follows it');
    {
      const c = Bots.cardFor(['2H', '4D', 'KD'], [{ p: 0, card: 'AS' }], 'H', 1);
      ok(c === '2H' && won([{ p: 0, card: 'AS' }], c, 'H'),
         'with none of it, it trumps when it wants the trick  got ' + c);
    }
    for (let i = 0; i < 60; i++) {
      const d = G.shuffle(G.deck());
      const hand = G.sortHand(d.slice(0, 4));
      const trick = [{ p: 0, card: d[10] }, { p: 1, card: d[11] }];
      const c = Bots.cardFor(hand, trick, 'S', i % 3);
      ok(G.legalPlays(hand, G.suitOf(trick[0].card)).indexOf(c) >= 0,
         'and it never picks a card the rules forbid');
    }

    // a table with a bot in it plays itself
    const { h, P: [you] } = await tableOf(['You']);

    h.send({ t: 'addbot' });
    await okBy(() => h.state.seats.length === 2 && h.state.seats[1] && h.state.seats[1].bot === true,
       'the host can add a bot  got ' + JSON.stringify(h.state.seats.map((x) => x.name + (x.bot ? '(bot)' : ''))));
    ok(h.state.cfg.deck === 'virtual', 'and asking for one asks for cards on the phones');
    ok(h.state.seats[1].online === true, 'and it is always at the table');
    ok(h.state.captainId === h.state.seats[0].id, 'the table is not handed to it');
    ok(/^[A-Z][a-z]+$/.test(h.state.seats[1].name), 'it has a name  got ' + h.state.seats[1].name);
    h.send({ t: 'addbot' });
    await okBy(() => h.state.seats[2] && h.state.seats[2].name !== h.state.seats[1].name,
       'and the next one is not called the same thing');

    h.send({ t: 'config', patch: { deck: 'physical' } });
    await okBy(() => /take the bots off/i.test(h.last()),
       'a table with bots at it cannot switch to real cards');
    ok(h.state.cfg.deck === 'virtual', 'and the setting does not change');

    you.send({ t: 'addbot' });
    await okBy(() => h.state.seats.length === 4 && you.errors.length === 0,
       'the table host may add one from their phone too');

    h.send({ t: 'kick', id: h.state.seats[3].id });
    await okBy(() => h.state.seats.length === 3, 'a bot is removed like any other seat');

    h.send({ t: 'config', patch: { max: 2, pattern: 'down', ones: 1 } }); await h.rt();
    h.send({ t: 'start' });
    await okBy(() => you.state.phase === 'bid', 'the game starts');
    const mine = you.state.seats.findIndex((x) => x.id === you.seatId);
    // the bots bid on their own, in their own time, and stop when it is the
    // person's turn: the pause between them is what makes it readable, and it
    // is a real pause on a real clock (BOT_DELAY above)
    await until(() => you.state.turn === mine, 8000);
    const r0 = you.state.rounds[0];
    ok(you.state.seats.every((x, i) => x.bot === false || r0.bids[i] !== null),
       'every bot has bid without being asked  got ' + JSON.stringify(r0.bids));
    ok(you.state.turn === mine, 'and the table waits for the person  got turn ' + you.state.turn);

    // the person bids last, so screw the dealer may rule one number out
    const forbidden = G.forbiddenBid(you.state.rounds[0], mine, you.state.cfg, you.state.seats.length);
    you.send({ t: 'bid', v: forbidden === 0 ? 1 : 0 });
    await okBy(() => you.state.phase === 'tricks', 'the last bid puts the cards in play');

    // and then the round plays itself, apart from the person's own cards
    for (let step = 0; step < 30 && you.state.phase === 'tricks'; step++) {
      await until(() => you.state.phase !== 'tricks'
                     || (you.state.play && you.state.play.turn === mine), 8000);
      const p = you.state.play;
      if (!p || p.turn !== mine) continue;
      const led = p.trick.length ? G.suitOf(p.trick[0].card) : null;
      you.send({ t: 'play', card: G.legalPlays(you.state.hand, led)[0] });
      await until(() => !you.state.play || you.state.play.turn !== mine, 4000);
    }
    ok(you.state.idx === 1 || you.state.phase === 'done',
       'the round is played out and scored  got idx ' + you.state.idx + ' ' + you.state.phase);
    const done0 = you.state.rounds[0];
    ok(Array.isArray(done0.tricks) && done0.tricks.reduce((a, b) => a + b, 0) === done0.cards,
       'with every trick accounted for  got ' + JSON.stringify(done0.tricks));
    ok(you.errors.length === 0, 'and nobody had to play for anybody  got ' + JSON.stringify(you.errors));

    // a bot has no opinion about a bum deal, so it agrees
    if (you.state.phase === 'bid' || you.state.phase === 'tricks') {
      const at = you.state.idx, r = you.state.rounds[at], was = r.redeals || 0;
      you.send({ t: 'bumdeal' });
      await okBy(() => (you.state.rounds[at].redeals || 0) > was && !you.state.vote,
         'a bum deal called against bots is agreed to, and the hand is thrown in');
      ok(you.state.idx === at, 'and the table stays in the same round');
    }

    h.ws.close(); you.ws.close();
  }

  /* ---- a bot waits for the phones before it bids ----

     The round is dealt on the phones before it can be bid: the deck is
     shuffled, the cards fly out and the trump is turned. A bot that bids while
     that is playing has bid before anybody saw a card. This table is given a
     long wait, so what answers here has to be the phone saying it is up and
     not the fallback running out. */
  {
    console.log('\n-- a bot waits for the deal to be watched --');
    const port6 = PORT + 4;
    const srv6 = spawn('node', [path + '/server.js'], {
      // this one keeps the real wait: it is the thing being checked
      env: { ...process.env, PORT: port6, NO_TLS: '1', DATA_DIR, BOT_DELAY: '120', BOT_DEAL_WAIT: '6000' },
      stdio: 'ignore',
    });
    await upAt(port6);
    const url = `ws://127.0.0.1:${port6}/ws`;
    const { h, P: [you] } = await tableOf(['You'], null, url);
    you.send({ t: 'addbot' }); await until(() => you.state.seats.length === 2);
    you.send({ t: 'config', patch: { max: 2, pattern: 'down', ones: 1 } }); await you.rt();
    you.send({ t: 'start' });
    await until(() => you.state.phase === 'bid');

    const bids = () => you.state.rounds[you.state.idx].bids;
    // long enough that a bot which was not waiting would have bid by now
    await wait(1600);
    ok(you.state.phase === 'bid' && you.state.turn === 1,
       'the bot bids first  got turn ' + you.state.turn);
    ok(bids().every((b) => b === null || b === undefined),
       'and nothing is bid while the phone is still watching the deal  got ' + JSON.stringify(bids()));

    you.send({ t: 'dealt' });
    await okBy(() => bids()[1] !== null && bids()[1] !== undefined,
       'the phone says its table is up, and the bot bids  got ' + JSON.stringify(bids()));

    /* This server keeps the real pauses, so it is also where the beat after
       the last bid is shown to be waited out and not merely declared: the
       table stands still on its own and starts the hand on its own. */
    console.log('\n-- and the bids stand before the hand is played --');
    you.send({ t: 'bid', v: 0 });
    await okBy(() => you.state.phase === 'tricks', 'the last bid takes the round to tricks');
    ok(you.state.play.held === true, 'and the bids stand to be read');
    await wait(1200);           // long enough that a table not holding would have moved
    ok(you.state.play.held === true, 'they are still standing a second later');
    await until(() => you.state.play.held === false, 4000);
    ok(you.state.play.held === false, 'and the table opens the hand by itself');
    ok(you.state.play.turn !== null, 'with somebody on play  got ' + you.state.play.turn);

    h.ws.close(); you.ws.close();
    srv6.kill();
  }

  /* ---- a table outlives the server it is on ----

     The phone that hosts a game is a phone: it is stopped from its own
     notification, or Android takes the memory back. Every other phone still
     holds its seat, and used to come back to a table that was not there. */
  {
    console.log('\n-- a table that outlives its server --');
    const port7 = PORT + 5;
    const dir = fs.mkdtempSync(path2.join(os.tmpdir(), 'rcs-tables-'));
    const env = { ...process.env, PORT: port7, NO_TLS: '1', DATA_DIR: dir, ...TUNED };
    const url = `ws://127.0.0.1:${port7}/ws`;
    let srv7 = spawn('node', [path + '/server.js'], { env, stdio: 'ignore' });
    await upAt(port7);

    // Dealt on the phones, so the hands are the table's to keep and the test
    // can ask for one back.
    const { h, P: [ann, ben], code } = await tableOf(['Ann', 'Ben'],
      { deck: 'virtual', max: 2, pattern: 'down', ones: 1 }, url);
    const annToken = ann.hello.token;
    ann.send({ t: 'start' });
    await until(() => h.state.phase === 'bid' && h.state.turn !== null);
    const first = h.state.turn;
    const bidder = first === 0 ? ann : ben;
    bidder.send({ t: 'bid', v: 1 });
    await okBy(() => h.state.rounds[0].bids[first] === 1,
       'a game is under way  got ' + JSON.stringify(h.state.rounds[0].bids));

    /* A burst of changes is written down once, when it is over, and what is
       written is the newest of them -- not whichever one the gap fell on. */
    h.send({ t: 'chat', text: 'one' });
    ann.send({ t: 'chat', text: 'two' });
    ben.send({ t: 'chat', text: 'three' });
    await until(() => h.state.chat.length === 3);
    await wait(400);                          // the gap a burst is written down after

    // the phone hosting it is stopped, and started again
    h.ws.close(); ann.ws.close(); ben.ws.close();
    srv7.kill();
    await until(() => new Promise((r) => srv7.once('exit', () => r(true))), 4000);
    srv7 = spawn('node', [path + '/server.js'], { env, stdio: 'ignore' });
    await upAt(port7);

    const back = client('keepback', url); await back.ready;
    back.send({ t: 'resume', code, token: annToken });
    await until(() => back.state || back.errors.length);
    ok(!back.errors.length, 'the seat is still there to come back to  got ' + JSON.stringify(back.errors));
    ok(!!back.state && back.state.code === code, 'and it is the same table  got ' + (back.state && back.state.code));
    ok(!!back.state && back.state.phase === 'bid' && back.state.rounds[0].bids[first] === 1,
       'with the game where it was left  got ' + JSON.stringify(back.state && back.state.rounds[0].bids));
    ok(!!back.state && back.state.seats.length === 2 && back.state.seats[0].name === 'Ann',
       'and everybody still in their seat');
    ok(!!back.state && back.state.seats[1].online === false,
       'the phone that has not come back yet is away, not still at the table');
    ok(Array.isArray(back.state.hand) && back.state.hand.length === back.state.rounds[0].cards,
       'the hand that was dealt is the hand that comes back  got ' + JSON.stringify(back.state.hand));
    ok(back.state.chat.map((c) => c.text).join(',') === 'one,two,three',
       'and a burst of changes is written down whole, newest and all  got '
       + JSON.stringify(back.state.chat.map((c) => c.text)));

    back.ws.close();
    srv7.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  /* ---- the table says when it is in use ----

     The phone that hosts a game holds a wake lock, so the table keeps
     answering with the screen off. It used to hold it from the moment the
     server started until the process died: a table nobody had touched since
     last night kept the phone awake all night. The server writes down whether
     anybody is at a table, and the app takes the lock only while they are. */
  {
    console.log('\n-- the table says whether anybody is at it --');
    const port8 = PORT + 6;
    const dir = fs.mkdtempSync(path2.join(os.tmpdir(), 'rcs-busy-'));
    const busy = path2.join(dir, 'table-busy');
    const url = `ws://127.0.0.1:${port8}/ws`;
    // A quiet table is one nobody has touched for half a second, here.
    const srv8 = spawn('node', [path + '/server.js'],
      { env: { ...process.env, PORT: port8, NO_TLS: '1', DATA_DIR: dir, BUSY_FILE: busy, BUSY_QUIET_MS: '500' },
        stdio: 'ignore' });
    await upAt(port8);
    const says = () => { try { return fs.readFileSync(busy, 'utf8'); } catch (e) { return '(nothing)'; } };

    await okBy(() => says() === '0', 'a server with no table on it is not in use  got ' + says());
    const one = client('busyone', url); await one.ready;
    one.send({ t: 'create' }); await until(() => one.hello);
    await okBy(() => says() === '1', 'a screen at a table is  got ' + says());

    one.ws.close(); await wait(250);          // less than the quiet time above
    ok(says() === '1', 'a phone that has just gone does not put the table to sleep  got ' + says());
    await okBy(() => says() === '0', 'but a table nobody comes back to falls quiet  got ' + says());

    const two = client('busytwo', url); await two.ready;
    two.send({ t: 'create' }); await until(() => two.hello);
    await okBy(() => says() === '1', 'and a table somebody comes to is in use again  got ' + says());
    two.ws.close();
    srv8.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  /* ---- a phone that goes, and a phone that comes back ----

     A game was lost to this. A player's browser held one table, a second table
     was started on the same browser, and the seat at the first was written
     over. When the phone dropped out mid-bid there was no way back into it:
     the token was gone, a name was not accepted once a game had started, and
     nobody could bid for the empty seat, so the table could not move at all.

     Each of those is answered here. */
  {
    console.log('\n-- a seat that goes away, and comes back --');
    const { h, P: [ann, ben], code } = await tableOf(['Ann', 'Ben'], { deck: 'virtual', max: 2 });
    h.send({ t: 'start' });
    await okBy(() => h.state.phase === 'bid', 'the game starts  got ' + h.state.phase);
    const onTurn = h.state.turn;                       // whoever bids first
    const away = h.state.seats[onTurn].name;
    const other = h.state.seats[1 - onTurn].name;

    // the seat the table is waiting on drops out
    (away === 'Ann' ? ann : ben).ws.close();
    await okBy(() => h.state.seats[onTurn].online === false, 'the table sees the phone go  got ' + away);
    ok(h.state.turn === onTurn, 'and it waits there, because nobody may bid out of turn');

    // a name is not enough to sit in a seat somebody is in
    const imp = client('imp'); await imp.ready;
    imp.send({ t: 'join', code, name: other.toUpperCase() });
    await okBy(() => /already at the table/.test(imp.last()),
       'a seat somebody is sitting in is never handed over  got ' + JSON.stringify(imp.errors));
    ok(!imp.hello, 'and nothing is handed to them');
    imp.ws.close();

    // but the phone that lost its seat comes back to it with the name it used
    const back = client('back'); await back.ready;
    back.send({ t: 'join', code, name: away.toLowerCase() });
    await okBy(() => back.hello && back.hello.seatId === h.state.seats[onTurn].id,
       'the phone that lost its seat comes back with the name it played under');
    await okBy(() => h.state.seats[onTurn].online === true, 'and the table has it back');
    ok(Array.isArray(back.state.hand) && back.state.hand.length === h.state.rounds[0].cards,
       'with the hand it was dealt  got ' + JSON.stringify(back.state && back.state.hand));

    // while it is there, nobody bids for it
    h.send({ t: 'bidfor' });
    await okBy(() => /can bid/.test(h.last()),
       'nobody bids for a seat that is at the table  got ' + JSON.stringify(h.errors));

    // it bids, the turn moves on, and now the table has gone on without it
    back.send({ t: 'bid', v: 0 });
    await until(() => h.state.turn !== onTurn);
    back.ws.close();
    await until(() => h.state.seats[onTurn].online === false);
    const late = client('late'); await late.ready;
    late.send({ t: 'join', code, name: away });
    await okBy(() => /gone on without/.test(late.last()),
       'once the table has moved on, a name is not enough  got ' + JSON.stringify(late.errors));
    ok(!late.hello, 'and no seat is handed over');
    late.ws.close();

    // the last seat drops out too, and now the table cannot move at all
    const last = (other === 'Ann' ? ann : ben);
    last.ws.close();
    await until(() => h.state.seats.every((x) => !x.online));
    const stuck = h.state.turn;
    ok(stuck !== null && h.state.seats[stuck].online === false,
       'the table is stopped on an empty seat  got turn ' + stuck);
    h.send({ t: 'bidfor' });
    await okBy(() => h.state.rounds[0].bids[stuck] !== null,
       'the host bids for it  got ' + JSON.stringify(h.errors));
    ok(h.state.rounds[0].bids[stuck] !== null,
       'and the bid is in  got ' + JSON.stringify(h.state.rounds[0].bids));
    ok(h.state.phase === 'tricks', 'so the hand goes into play  got ' + h.state.phase);
    h.ws.close();
  }

  /* ---- a screen that only shows a table ---- */
  {
    console.log('\n-- a screen pointed at a table --');
    const { h, P: [ann], code } = await tableOf(['Ann']);

    const tv = client('tv'); await tv.ready;
    tv.send({ t: 'screen', code: code.toLowerCase() });
    await okBy(() => tv.hello && tv.hello.role === 'screen', 'a screen can be pointed at a table that is running');
    await okBy(() => tv.state && tv.state.code === code, 'and it is given the table  got ' + (tv.state || {}).code);
    ok(tv.state.hand === undefined, 'with nobody\'s cards in it');
    ok(tv.state.seats.length === 1 && tv.state.seats[0].online === true,
       'and it changes nothing about who is at the table');
    tv.send({ t: 'reset' });
    await okBy(() => /only shows the table/.test(tv.last()),
       'it cannot touch the game  got ' + JSON.stringify(tv.errors));
    ok(ann.state.phase === 'lobby', 'and the game is where it was');

    const nowhere = client('nowhere'); await nowhere.ready;
    nowhere.send({ t: 'screen', code: 'ZZZZ' });
    await okBy(() => /no table with that code/i.test(nowhere.last()), 'a screen needs a table that exists');

    // the phones are told when a TV screen runs the table, and only then
    ok(ann.state.tv === true, 'a phone knows a TV screen runs this table');
    h.ws.close();
    await okBy(() => ann.state.tv === false,
       'and knows when it has gone; a screen that only shows the table does not count');
    nowhere.ws.close(); tv.ws.close(); ann.ws.close();
  }

  /* ---- what happened, written down as it happened ----
     What the points are is settled in test-rules.js. What is proved here is
     that they reach a file of their own, appended rather than rewritten, and
     that a new game starts the file again. */
  {
    console.log('\n-- the trail a table leaves --');
    const { h, P: [ann, ben], code } = await tableOf(['Ann', 'Ben'],
      { deck: 'virtual', max: 2, pattern: 'down', ones: 1 });
    const trailFile = path2.join(DATA_DIR, 'trail', `${code}.jsonl`);
    h.send({ t: 'start' });
    await until(() => h.state.phase === 'bid');
    await okBy(() => fs.existsSync(trailFile), 'a table writes down what happened to it');

    const kinds = () => fs.readFileSync(trailFile, 'utf8').split('\n').filter(Boolean)
      .map((l) => JSON.parse(l).k);
    ok(kinds()[0] === 'G' && kinds()[1] === 'R',
       'starting with the game and the round it opened  got ' + kinds().slice(0, 2));

    const before = kinds().join(' ');
    await bidRound([ann, ben]);
    await okBy(() => kinds().length > before.split(' ').length,
       'and every bid is added to it, not written over');
    ok(kinds().join(' ').startsWith(before),
       'what was there before is still there, untouched  got ' + kinds().join(' '));

    // A new game is where the file starts again: a table plays several.
    h.send({ t: 'reset' }); await h.rt();
    h.send({ t: 'start' });
    await until(() => h.state.phase === 'bid');
    await okBy(() => kinds().filter((k) => k === 'G').length === 1,
       'and a new game starts the file over, so one game is on it  got '
       + kinds().filter((k) => k === 'G').length);

    // The trail is the table's own file and never rides in its record.
    const rec = JSON.parse(fs.readFileSync(path2.join(DATA_DIR, 'tables', `${code}.json`), 'utf8'));
    ok(!('trail' in rec), 'and never rides in the table record, which is rewritten whole');
  }

  /* ---- a table of bots plays on for whoever is watching it ----
     The rule is checked in test-rules.js against `seen` set by hand. What is
     proved here is the wire: a real socket on the table is what sets it, and
     the last one leaving is what puts it out. */
  {
    console.log('\n-- a table nobody is playing at, with somebody looking --');
    const { h, P: [ann] } = await tableOf(['Ann'],
      { deck: 'virtual', max: 2, pattern: 'down', ones: 1 });
    h.send({ t: 'addbot' });
    await until(() => h.state.seats.length === 2);
    h.send({ t: 'start' });
    await until(() => h.state.phase === 'bid');

    ann.send({ t: 'leave' });
    await okBy(() => h.state.seats.every((s) => s.bot || s.left),
       'the last player leaves, and only bots are in the game');
    ok(h.state.seen === true, 'the screen on the table says somebody is watching');

    /* Watching it play itself is no good without a way to stop it. The screen
       runs the table, so the screen may. */
    const snap = (c) => JSON.stringify([c.state.idx, c.state.phase, c.state.rounds, c.state.play]);
    h.send({ t: 'pause', on: true });
    await okBy(() => h.state.paused === true, 'the screen stops the table');
    await wait(300);                       // anything already on its way lands
    const stopped = snap(h);
    await wait(600);                       // longer than a bot's think, twice over
    ok(snap(h) === stopped, 'and it makes no move of its own while it is stopped');

    h.send({ t: 'pause', on: false });
    await okBy(() => h.state.paused === false, 'and the screen lets it go again');

    // Nobody is playing at it, so before this the table stood still.
    await until(() => h.state.phase === 'done', 8000);
    ok(h.state.phase === 'done', 'and the table plays itself out for the screen watching it');

    /* And with every window gone it stands still. Bob leaves the game but
       keeps his page open, so there is still a socket to ask with -- and a
       phone that has left the game is not somebody watching it. */
    const { h: h2, P: [bob] } = await tableOf(['Bob'],
      { deck: 'virtual', max: 2, pattern: 'down', ones: 1 });
    h2.send({ t: 'addbot' });
    await until(() => h2.state.seats.length === 2);
    h2.send({ t: 'start' });
    await until(() => h2.state.phase === 'bid');

    const watcher = client('eyes'); await watcher.ready;
    watcher.send({ t: 'screen', code: h2.state.code });
    await until(() => watcher.state);
    await okBy(() => watcher.state.seen === true,
       'a screen only showing the table is watching it too');

    bob.send({ t: 'leave' });
    await until(() => bob.state && bob.state.seats.every((s) => s.bot || s.left));
    watcher.ws.close();
    h2.ws.close();
    await okBy(() => bob.state.seen === false,
       'with every window gone, nobody is watching');
    const at = JSON.stringify(bob.state.rounds);
    await wait(600);                       // longer than a bot's think, twice over
    ok(bob.state.phase !== 'done' && JSON.stringify(bob.state.rounds) === at,
       'and the game is left exactly where it was, for whoever comes back');
    bob.ws.close();
  }

  /* ---- leaving on purpose, which is not the same as dropping out ---- */
  {
    console.log('\n-- leaving the game --');
    const { h, P: [ann, ben, cal], code } = await tableOf(['Ann', 'Ben', 'Cal']);

    // before the cards go out, a seat simply goes
    cal.send({ t: 'leave' });
    await okBy(() => h.state.seats.length === 2,
       'in the lobby, leaving gives the seat up  got ' + h.state.seats.length);
    await okBy(() => cal.left === true, 'and the phone that left is told  got ' + cal.left);
    cal.ws.close();

    h.send({ t: 'config', patch: { deck: 'virtual', max: 2 } }); await h.rt();
    h.send({ t: 'start' });
    await until(() => h.state.phase === 'bid' && h.state.turn !== null);
    const turn = h.state.turn;
    const goer = h.state.seats[turn].name === 'Ann' ? ann : ben;
    goer.send({ t: 'leave' });
    await okBy(() => h.state.seats[turn].left === true, 'in a game, the seat stays and is marked gone');
    ok(h.state.seats[turn].online === false, 'and nobody is behind it');
    ok(h.state.seats.length === 2, 'the scorecard keeps its column  got ' + h.state.seats.length);

    // a seat that was given up is not handed to a name
    const grab = client('grab'); await grab.ready;
    grab.send({ t: 'join', code, name: h.state.seats[turn].name });
    await okBy(() => /left the game/.test(grab.last()),
       'and a name does not take it back  got ' + JSON.stringify(grab.errors));
    grab.ws.close();

    // the table plays that hand rather than waiting for a phone that has gone
    await okBy(() => h.state.rounds[0].bids[turn] !== null,
       'the table bids the hand it was left  got ' + JSON.stringify(h.state.rounds[0].bids));

    // and the phone that left can still come back to its own seat
    const rejoin = client('rejoin'); await rejoin.ready;
    rejoin.send({ t: 'resume', code, token: goer.hello.token });
    await okBy(() => rejoin.hello && rejoin.hello.seatId === h.state.seats[turn].id,
       'the phone that left comes back with its own token');
    await okBy(() => h.state.seats[turn].left === false, 'and the seat is a player\'s again');
    rejoin.ws.close(); ann.ws.close(); ben.ws.close(); h.ws.close();
  }

  /* ---- a phone that is not coming back at all ---- */
  {
    console.log('\n-- handing a seat to the table --');
    const { h, P: [ann, ben], code } = await tableOf(['Ann', 'Ben']);

    // with real cards there is no hand for the table to play
    h.send({ t: 'start' });
    await until(() => h.state.phase === 'bid');
    h.send({ t: 'playout' });
    await okBy(() => /no cards to hold/.test(h.last()),
       'a table with real cards cannot hand a seat over  got ' + JSON.stringify(h.errors));
    h.send({ t: 'reset' });
    await until(() => h.state.phase === 'lobby');

    h.send({ t: 'config', patch: { deck: 'virtual', max: 2 } }); await h.rt();
    h.send({ t: 'start' });
    await until(() => h.state.phase === 'bid' && h.state.turn !== null);
    const p = h.state.turn;
    const who = h.state.seats[p].name;
    const gone = who === 'Ann' ? ann : ben;
    const token = gone.hello.token;
    const stay = who === 'Ann' ? ben : ann;

    // not while that phone is there
    h.send({ t: 'playout' });
    await okBy(() => /is at the table/.test(h.last()),
       'a seat somebody is at is not handed over  got ' + JSON.stringify(h.errors));

    gone.ws.close();
    await until(() => h.state.seats[p].online === false);
    h.send({ t: 'playout' });
    await okBy(() => h.state.seats[p].left === true, 'an empty seat is handed to the table  ' + JSON.stringify(h.errors));
    ok(h.state.seats.length === 2, 'the scorecard keeps its column');
    await okBy(() => stay.state.seats[p].left === true, 'and every phone is told');

    await okBy(() => h.state.rounds[0].bids[p] !== null,
       'the table bids that hand without being asked again  ' + JSON.stringify(h.state.rounds[0].bids));

    h.send({ t: 'playout' });
    // by now the turn has moved to the seat that is present, so either guard
    // answers: the seat on play is at the table, or the hand is already played
    await okBy(() => /already playing|is at the table/.test(h.last()),
       'and it is not handed over twice  got ' + JSON.stringify(h.errors));

    // the phone it belongs to takes it back
    const back = client('hback'); await back.ready;
    back.send({ t: 'resume', code, token });
    await okBy(() => back.hello && back.hello.seatId === h.state.seats[p].id,
       'the phone that holds the seat takes it back');
    await okBy(() => h.state.seats[p].left === false, 'and it is a player\'s again');
    back.ws.close(); stay.ws.close(); h.ws.close();
  }

  // ---- PUBLIC_URL replaces the detected addresses ----
  {
    const port2 = PORT + 1;
    const srv2 = spawn('node', [path + '/server.js'], {
      env: { ...process.env, PORT: port2, NO_TLS: '1', PUBLIC_URL: 'https://table.example.com/', DATA_DIR },
      stdio: 'ignore',
    });
    await upAt(port2);
    const net2 = await fetch(`http://127.0.0.1:${port2}/net.json`).then((r) => r.json());
    ok(JSON.stringify(net2.urls) === '["https://table.example.com"]',
       'PUBLIC_URL is the only address offered, with no private ones  got ' + JSON.stringify(net2.urls));
    srv2.kill();
  }

  /* ---- the addresses a phone cannot find for itself ----
     Android hides the interface list, so the app reads it in Java and hands the
     answer over, and a player who arrives brings one more. Both have to reach
     /net.json, or the host's QR code carries an address nobody can use. */
  {
    const port5 = PORT + 7;
    const listed = 'http://127.0.0.1:' + port5;
    const srv5 = spawn('node', [path + '/server.js'], {
      env: { ...process.env, PORT: port5, NO_TLS: '1', LAN_ADDRS: '192.168.99.9,not-an-address', DATA_DIR },
      stdio: 'ignore',
    });
    await upAt(port5);
    const urls = async () => (await fetch(`${listed}/net.json`).then((r) => r.json())).urls;

    let now = await urls();
    ok(now.includes(`http://192.168.99.9:${port5}`), 'an address handed over in LAN_ADDRS is offered');
    ok(!now.some((u) => u.includes('not-an-address')), 'and anything that is not an address is dropped');

    // fetch() will not send a Host of our choosing -- it is the browser's to
    // write -- so the arriving player is played by a plain request.
    const knock = (host) => new Promise((done) => {
      const req = require('http').request(
        { host: '127.0.0.1', port: port5, path: '/net.json', headers: { host } },
        (res) => { res.resume(); res.on('end', done); });
      req.on('error', done);
      req.end();
    });

    // a player arrives on an address this machine never knew it had
    await knock(`192.168.77.7:${port5}`);
    ok((await urls()).includes(`http://192.168.77.7:${port5}`),
       'the address a player arrived on is remembered');

    // and the ones a player must not be able to plant
    await knock('table.example.com');
    await knock('8.8.8.8:' + port5);
    await knock(`192.168.55.5:${port5 + 1}`);
    now = await urls();
    ok(!now.some((u) => u.includes('example.com')), 'a name in the Host header is ignored');
    ok(!now.some((u) => u.includes('8.8.8.8')), 'a public address in the Host header is ignored');
    ok(!now.some((u) => u.includes('192.168.55.5')), 'and a private one on the wrong port is ignored');
    srv5.kill();
  }

  done = true;
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {}
  console.log(fails ? `\n${fails} FAILURES` : '\nall integration checks passed');
  // Wait for the server to actually go before this process does, or the next
  // run of this file starts while the old one still holds the port.
  srv.kill();
  await until(() => new Promise((r) => srv.once('exit', () => r(true))), 4000);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });

function Game_schedule(cfg) {
  const G = require(path + '/game.js');
  return G.schedule(cfg.max, cfg.pattern, cfg.ones);
}
