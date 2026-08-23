const { spawn } = require('child_process');
const path = __dirname;
const WebSocket = require('ws');
const PORT = Number(process.env.TEST_PORT) || 8899;
const srv = spawn('node', [path + '/server.js'], { env: { ...process.env, PORT, NO_TLS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.stderr.on('data', d => process.stderr.write('[srv] ' + d));

const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };

function client(name, url) {
  const ws = new WebSocket(url || `ws://127.0.0.1:${PORT}/ws`);
  const c = { ws, name, state: null, hello: null, errors: [], seatId: null };
  ws.on('message', d => {
    const m = JSON.parse(d);
    if (m.t === 'state') c.state = m;
    else if (m.t === 'hello') { c.hello = m; c.seatId = m.seatId; }
    else if (m.t === 'error') c.errors.push(m.msg);
  });
  c.send = o => ws.send(JSON.stringify(o));
  c.ready = new Promise(r => ws.on('open', r));
  return c;
}

(async () => {
  await wait(600);

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
  host.send({ t: 'create' }); await wait(150);
  const code = host.hello.code;
  ok(!!code && code.length === 4, 'host created table ' + code);

  const P = [];
  for (const nm of ['Amy', 'Hugh', 'Joe']) {
    const c = client(nm); await c.ready; c.send({ t: 'join', code, name: nm }); await wait(120); P.push(c);
  }
  ok(host.state.seats.length === 3, '3 seats taken');
  ok(host.state.cfg.ones === 3, 'ones follows the player count');

  const dupe = client('dupe'); await dupe.ready; dupe.send({ t: 'join', code, name: 'amy' }); await wait(120);
  ok(dupe.errors.some(e => /taken/.test(e)), 'duplicate name is refused');

  // rules: 2 cards down to 1, three 1-card rounds => 2,1,1,1
  P[0].send({ t: 'config', patch: { max: 2, pattern: 'down', ones: 3 } }); await wait(120);
  ok(JSON.stringify(Game_schedule(host.state.cfg)) === '[2,1,1,1]', 'schedule is 2,1,1,1');

  // the first player to sit down runs the table
  ok(host.state.captainId === P[0].seatId, 'the first player to sit down is the table host');
  P[1].send({ t: 'start' }); await wait(120);
  ok(P[1].errors.some(e => /only the table host/.test(e)), 'another player cannot start the game');
  P[1].errors.length = 0;
  P[1].send({ t: 'config', patch: { max: 9 } }); await wait(100);
  ok(P[1].errors.some(e => /only the table host/.test(e)), 'and cannot change the rules');

  P[0].send({ t: 'captain', id: P[2].seatId }); await wait(120);
  ok(host.state.captainId === P[2].seatId, 'the table host can pass it on');
  P[1].send({ t: 'captain', id: P[1].seatId }); await wait(100);
  ok(host.state.captainId === P[2].seatId, 'a player cannot take it for themselves');
  host.send({ t: 'captain', id: P[0].seatId }); await wait(120);
  ok(host.state.captainId === P[0].seatId, 'the host screen can hand it back');

  P[0].send({ t: 'config', patch: { max: 2 } }); await wait(100);
  ok(host.state.cfg.max === 2, 'the table host can change the rules');

  // pick who deals the first round, then put it back for the rest of this game
  host.send({ t: 'config', patch: { firstDealer: P[2].seatId } }); await wait(120);
  ok(host.state.firstDealerId === P[2].seatId, 'the host can choose the first dealer');
  host.send({ t: 'config', patch: { firstDealer: null } }); await wait(120);
  ok(host.state.firstDealerId === null, 'and can clear it again');

  host.send({ t: 'start' }); await wait(150);
  ok(host.state.phase === 'bid' && host.state.rounds.length === 4, 'game started, 4 rounds');
  ok(host.state.turn === 1, 'round 1: seat 1 bids first (dealer is seat 0)');

  // ---- bidding order is enforced ----
  P[0].send({ t: 'bid', v: 1 }); await wait(100);
  ok(P[0].errors.some(e => /turn to bid/.test(e)), 'out-of-turn bid is refused');
  P[2].send({ t: 'bid', v: 1 }); await wait(100);
  ok(P[2].errors.some(e => /turn to bid/.test(e)), 'skipping ahead is refused');

  P[1].send({ t: 'bid', v: 1 }); await wait(100);
  ok(host.state.turn === 2, 'turn moved to seat 2');

  // the last bidder may change, until the next player bids
  P[1].send({ t: 'bid', v: 2 }); await wait(100);
  ok(host.state.rounds[0].bids[1] === 2, 'the last bidder can change their bid');
  ok(host.state.turn === 2, 'changing a bid does not move the turn');
  P[1].send({ t: 'bid', v: 1 }); await wait(100);
  ok(host.state.rounds[0].bids[1] === 1, 'and can change it back');

  P[2].send({ t: 'bid', v: 1 }); await wait(100);
  ok(host.state.turn === 0, 'dealer bids last');
  P[1].errors.length = 0;
  P[1].send({ t: 'bid', v: 0 }); await wait(100);
  ok(P[1].errors.some(e => /too late to change/.test(e)), 'too late once the next player has bid');
  ok(host.state.rounds[0].bids[1] === 1, 'the late change did not land');

  P[0].send({ t: 'bid', v: 5 }); await wait(100);
  ok(P[0].errors.some(e => /out of range/.test(e)), 'bid above the hand size is refused');
  P[0].send({ t: 'bid', v: 0 }); await wait(100);
  ok(P[0].errors.some(e => /must not total 2/.test(e)), 'screw the dealer blocks the equalising bid');
  P[0].send({ t: 'bid', v: 1 }); await wait(120);
  ok(host.state.phase === 'tricks', 'all bids in, phase is tricks');
  P[0].errors.length = 0;
  P[0].send({ t: 'bid', v: 2 }); await wait(100);
  ok(P[0].errors.some(e => /not bidding now/.test(e)), 'no changes once every bid is in');

  // ---- tricks: dealer only ----
  P[1].send({ t: 'tricks', values: [1, 1, 0] }); await wait(100);
  ok(P[1].errors.some(e => /dealer enters/.test(e)), 'a non-dealer cannot enter the tricks');
  P[0].send({ t: 'tricks', values: [2, 1, 0] }); await wait(100);
  ok(P[0].errors.some(e => /must total 2/.test(e)), 'tricks that do not total the hand are refused');
  P[0].send({ t: 'tricks', values: [1, 1, 0] }); await wait(150);
  ok(host.state.idx === 1 && host.state.phase === 'bid', 'round 1 scored, round 2 bidding');
  ok(JSON.stringify(host.state.totals) === '[11,11,0]', 'scores: 11 / 11 / 0  got ' + JSON.stringify(host.state.totals));

  const r2 = host.state.rounds[1];
  ok(r2.cards === 1 && r2.dealer === 1, 'round 2: 1 card, dealer is seat 1');
  ok(host.state.turn === 2, 'round 2 starts with seat 2');

  // ---- trump ----
  P[1].send({ t: 'trump', k: 'H' }); await wait(100);
  ok(host.state.rounds[1].trump === 'H', 'the dealer can set the trump');
  P[2].send({ t: 'trump', k: 'S' }); await wait(100);
  ok(host.state.rounds[1].trump === 'H', 'another player cannot set the trump');
  host.send({ t: 'trump', k: 'S' }); await wait(100);
  ok(host.state.rounds[1].trump === 'S', 'the host can set the trump');

  // ---- undo ----
  host.send({ t: 'undo' }); await wait(120);
  ok(host.state.idx === 0 && host.state.phase === 'tricks', 'undo reopens the tricks of round 1');
  P[0].send({ t: 'tricks', values: [0, 1, 1] }); await wait(120);
  ok(JSON.stringify(host.state.totals) === '[0,11,11]', 'rescored after undo  got ' + JSON.stringify(host.state.totals));

  // ---- bum deal ----
  // a fresh round to work on: round 2, dealer is seat 1
  P[2].send({ t: 'bid', v: 1 }); await wait(80);
  ok(host.state.rounds[1].bids[2] === 1, 'a bid is in on round 2');
  P[2].errors.length = 0;
  P[2].send({ t: 'bumdeal' }); await wait(120);
  ok(host.state.vote && host.state.vote.by === 2, 'a player calling a bum deal opens a vote');
  ok(host.state.rounds[1].bids[2] === 1, 'the hand is not thrown in on one voice');
  P[0].send({ t: 'vote', agree: true }); await wait(100);
  ok(host.state.vote.yes.length === 2, 'a second player agrees');
  P[1].send({ t: 'vote', agree: false }); await wait(100);
  ok(host.state.vote === null, 'one "no" ends the vote');
  ok(host.state.rounds[1].bids[2] === 1, 'and the hand stands');

  P[2].send({ t: 'bumdeal' }); await wait(100);
  P[0].send({ t: 'vote', agree: true }); await wait(100);
  P[1].send({ t: 'vote', agree: true }); await wait(120);
  ok(host.state.vote === null && host.state.rounds[1].bids.every(b => b === null),
     'every player agreeing throws the hand in');
  ok(host.state.rounds[1].dealer === 1 && host.state.rounds[1].cards === 1, 'same dealer and hand size');
  ok(host.state.rounds[1].redeals === 1, 'the re-deal is counted');
  ok(host.state.idx === 1 && host.state.phase === 'bid', 'and bidding starts again on the same round');

  P[2].send({ t: 'bid', v: 1 }); await wait(80);
  P[1].send({ t: 'bumdeal' }); await wait(120);            // seat 1 deals round 2
  ok(host.state.rounds[1].bids.every(b => b === null) && host.state.rounds[1].redeals === 2,
     'the dealer can call a bum deal alone');
  P[2].send({ t: 'bid', v: 1 }); await wait(80);
  host.send({ t: 'bumdeal' }); await wait(120);
  ok(host.state.rounds[1].redeals === 3, 'the host can call a bum deal alone');

  // ---- reconnect ----
  const tok = P[2].hello.token;
  P[2].ws.close(); await wait(250);
  ok(host.state.seats[2].online === false, 'seat 2 shows as offline');
  const back = client('Joe2'); await back.ready;
  back.send({ t: 'resume', code, token: tok }); await wait(150);
  ok(back.hello && back.hello.seatId === P[2].seatId, 'resume returns the same seat');
  ok(host.state.seats[2].online === true, 'seat 2 is back online');

  // ---- late join is refused ----
  const late = client('late'); await late.ready;
  late.send({ t: 'join', code, name: 'Zoe' }); await wait(120);
  ok(late.errors.some(e => /already started/.test(e)), 'joining after the start is refused');

  // ---- a second table, to check the chosen first dealer ----
  {
    const h2 = client('host2'); await h2.ready;
    h2.send({ t: 'create' }); await wait(120);
    const c2 = h2.hello.code;
    const seats = [];
    for (const nm of ['Ann', 'Bob', 'Cal']) {
      const c = client(nm); await c.ready; c.send({ t: 'join', code: c2, name: nm }); await wait(110); seats.push(c);
    }
    h2.send({ t: 'config', patch: { max: 2, pattern: 'down', ones: 3, firstDealer: seats[1].seatId } }); await wait(120);
    h2.send({ t: 'start' }); await wait(150);
    ok(h2.state.rounds.map(r => r.dealer).join(',') === '1,2,0,1', 'the deal starts with the chosen player');
    ok(h2.state.turn === 2, 'and bidding starts left of that dealer');
    // removing that player clears the choice
    h2.send({ t: 'reset' }); await wait(100);
    h2.send({ t: 'kick', id: seats[1].seatId }); await wait(120);
    ok(h2.state.firstDealerId === null, 'removing the chosen dealer clears the choice');
  }

  // ---- a table with no host screen at all ----
  {
    const seats = [];
    let code3 = null;
    for (const nm of ['Dot', 'Eve']) {
      const c = client(nm); await c.ready;
      if (!code3) {                                   // the first one needs a room
        const h3 = client('host3'); await h3.ready;
        h3.send({ t: 'create' }); await wait(120);
        code3 = h3.hello.code;
        h3.ws.close(); await wait(120);               // the host screen walks away
      }
      c.send({ t: 'join', code: code3, name: nm }); await wait(120);
      seats.push(c);
    }
    seats[0].send({ t: 'config', patch: { max: 1, pattern: 'down', ones: 2 } }); await wait(120);
    seats[0].send({ t: 'start' }); await wait(150);
    ok(seats[0].state.phase === 'bid' && seats[0].state.rounds.length === 2,
       'the table host starts a game with no host screen');
    const r = seats[0].state.rounds[0];
    const first = seats[0].state.turn;
    seats[first].send({ t: 'bid', v: 1 }); await wait(110);
    // one card, one bid of 1: screw the dealer leaves the dealer only 1
    seats[seats[0].state.turn].send({ t: 'bid', v: 1 }); await wait(120);
    ok(seats[0].state.phase === 'tricks', 'and the bidding runs without one');
    seats[r.dealer].send({ t: 'tricks', values: [1, 0] }); await wait(140);
    ok(seats[0].state.idx === 1, 'and the round scores');
    seats[0].send({ t: 'undo' }); await wait(120);
    ok(seats[0].state.idx === 0 && seats[0].state.phase === 'tricks', 'the table host can go back');
    seats[0].send({ t: 'reset' }); await wait(120);
    ok(seats[0].state.phase === 'lobby', 'and can call a new game');
  }

  // ---- start a table and take a seat, from one phone ----
  {
    const solo = client('solo'); await solo.ready;
    solo.send({ t: 'create' }); await wait(120);
    const code4 = solo.hello.code;
    solo.send({ t: 'join', code: code4, name: 'Solo' }); await wait(150);
    ok(solo.hello.role === 'player' && !!solo.hello.seatId, 'one socket can make a table and take a seat');
    ok(solo.state.seats.length === 1 && solo.state.seats[0].name === 'Solo', 'the seat is at the new table');
    ok(solo.state.captainId === solo.hello.seatId, 'and that player runs the table');
    ok(solo.state.code === code4, 'the code is the one the QR shows');
  }

  // ---- the dev controls are refused unless DEV=1 ----
  {
    const d = client('devprobe'); await d.ready;
    d.send({ t: 'dev', action: 'setup', players: 4 }); await wait(150);
    ok(d.errors.some((e) => /DEV=1/.test(e)), 'the dev controls are refused on a normal server');
    ok(!d.state, 'and no table is made');
  }

  // ---- the dev controls on a server started with DEV=1 ----
  {
    const port3 = PORT + 2;
    const srv3 = spawn('node', [path + '/server.js'], {
      env: { ...process.env, PORT: port3, NO_TLS: '1', DEV: '1' }, stdio: 'ignore',
    });
    await wait(700);
    const d = client('dev', `ws://127.0.0.1:${port3}/ws`); await d.ready;
    d.send({ t: 'dev', action: 'setup', players: 4 }); await wait(200);
    ok(d.hello && d.hello.dev && d.hello.seats.length === 4, 'dev setup makes 4 stand-in seats with tokens');
    d.send({ t: 'dev', action: 'startGame' }); await wait(150);
    d.send({ t: 'dev', action: 'fillBids' }); await wait(150);
    const r0 = d.state.rounds[0];
    const bidSum = r0.bids.reduce((a, b) => a + b, 0);
    ok(d.state.phase === 'tricks' && r0.bids.every((b) => b !== null), 'fillBids fills every bid');
    ok(!d.state.cfg.screw || bidSum !== r0.cards, 'and keeps the screw-the-dealer rule');
    d.send({ t: 'dev', action: 'endGame' }); await wait(600);
    ok(d.state.phase === 'done', 'endGame plays every round');
    d.send({ t: 'dev', action: 'patch', patch: { idx: 1, phase: 'bid' } }); await wait(150);
    ok(d.state.idx === 1 && d.state.phase === 'bid', 'patch forces the round and the phase');
    d.send({ t: 'dev', action: 'patch', patch: { round: { i: 0, bids: [1, 0, 2, 1], tricks: [1, 1, 1, 1] } } });
    await wait(150);
    ok(JSON.stringify(d.state.rounds[0].bids) === '[1,0,2,1]' && d.state.totals.some((t) => t !== 0),
       'patch forces a round, and the totals follow');
    srv3.kill();
  }

  // ---- PUBLIC_URL replaces the detected addresses ----
  {
    const port2 = PORT + 1;
    const srv2 = spawn('node', [path + '/server.js'], {
      env: { ...process.env, PORT: port2, NO_TLS: '1', PUBLIC_URL: 'https://table.example.com/' },
      stdio: 'ignore',
    });
    await wait(700);
    const net2 = await fetch(`http://127.0.0.1:${port2}/net.json`).then((r) => r.json());
    ok(JSON.stringify(net2.urls) === '["https://table.example.com"]',
       'PUBLIC_URL is the only address offered, with no private ones  got ' + JSON.stringify(net2.urls));
    srv2.kill();
  }

  console.log(fails ? `\n${fails} FAILURES` : '\nall integration checks passed');
  srv.kill(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });

function Game_schedule(cfg) {
  const G = require(path + '/game.js');
  return G.schedule(cfg.max, cfg.pattern, cfg.ones);
}
