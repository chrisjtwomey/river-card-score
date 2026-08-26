const { spawn } = require('child_process');
const path = __dirname;
const path2 = require('path');
const WebSocket = require('ws');
const PORT = Number(process.env.TEST_PORT) || 8899;
const fs = require('fs');
const os = require('os');
// The finished games are written to a folder of their own, thrown away after.
const DATA_DIR = fs.mkdtempSync(path2.join(os.tmpdir(), 'rcs-games-'));
const srv = spawn('node', [path + '/server.js'], { env: { ...process.env, PORT, NO_TLS: '1', TRICK_HOLD: '120', DATA_DIR, KEEP_GAMES: '3' }, stdio: ['ignore', 'pipe', 'pipe'] });
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

  // ---- the accolades, worked out from a scorecard alone ----
  {
    const G = require(path + '/game.js');
    global.document = { createElement: () => ({ append() {} }) };
    eval(require('fs').readFileSync(path + '/public/accolades.js', 'utf8') + '\nglobal.Accolades = Accolades;');
    const cfg = { bonus: 10, miss: 'atleast' };
    const card = (cards, bids, tricks) => ({ cards, dealer: 0, trump: null, bids, tricks });
    const rounds = [
      card(2, [2, 0, 1, 0], [2, 0, 0, 0]),
      card(2, [1, 1, 0, 0], [0, 1, 1, 0]),
      card(1, [0, 1, 0, 0], [0, 1, 0, 0]),
      card(1, [1, 0, 0, 0], [1, 0, 0, 0]),
    ];
    const got = Accolades.list(rounds, 4, (b, w) => G.roundScore(b, w, cfg));
    const find = (k) => got.find((a) => a.key === k);
    const who = (k) => (find(k) ? find(k).who.join(',') : 'none');
    ok(who('fearless') === '0', 'the biggest total bid is the most fearless  got ' + who('fearless'));
    ok(who('careful') === '3', 'and the smallest is the most careful  got ' + who('careful'));
    ok(who('tricks') === '0', 'the most tricks won is its own accolade  got ' + who('tricks'));
    ok(who('zeros') === '3', 'a player who bids nothing and takes nothing is the zero hero');
    ok(who('steady') === '1,3', 'an accolade two players earn names them both  got ' + who('steady'));
    ok(find('steady').note === 'never missed a bid', 'and it says what they did  got ' + find('steady').note);
    ok(!got.some((a) => a.key === 'made'), 'bang on is not an accolade any more');

    // three of them are drawn, and each pays whoever earned it
    const three = Accolades.pick(got, 3);
    ok(three.length === 3 && three.every((a) => got.indexOf(a) >= 0), 'three are drawn from the ones earned');
    ok(new Set(three.map((a) => a.key)).size === 3, 'and never the same one twice');
    const seen = new Set();
    for (let i = 0; i < 40; i++) Accolades.pick(got, 3).forEach((a) => seen.add(a.key));
    ok(seen.size > 3, 'the draw is not always the same three  got ' + seen.size + ' different');
    ok(Accolades.pick(got.slice(0, 2), 3).length === 2, 'a table that earned two gets two');
    const paid = Accolades.bonus([{ who: [0] }, { who: [1, 3] }], 4, 10);
    ok(paid.join(',') === '10,10,0,10', 'each seat is paid for what it was given  got ' + paid.join(','));
    ok(Accolades.bonus([{ who: [0] }], 4, 0).join(',') === '0,0,0,0', 'and nothing when they pay nothing');
    ok(Accolades.list(rounds.slice(0, 2), 4, (b, w) => G.roundScore(b, w, cfg)).length === 0,
       'a game too short to judge gets none');
    const level = [card(1, [0, 0, 0, 0], [1, 0, 0, 0]), card(1, [0, 0, 0, 0], [0, 1, 0, 0]),
                   card(1, [0, 0, 0, 0], [0, 0, 1, 0])];
    ok(!Accolades.list(level, 4, (b, w) => G.roundScore(b, w, cfg)).some((a) => a.key === 'fearless'),
       'and nothing is awarded where every seat is level');
    delete global.document;
  }

  // ---- a table that plays with a virtual deck ----
  {
    const vh = client('vhost'); await vh.ready;
    vh.send({ t: 'create' }); await wait(120);
    const code = vh.hello.code;
    const P = [];
    for (const nm of ['Ann', 'Bob', 'Cal']) {
      const c = client('v' + nm); await c.ready;
      c.send({ t: 'join', code, name: nm }); await wait(110);
      P.push(c);
    }
    vh.send({ t: 'config', patch: { deck: 'virtual', max: 3, pattern: 'down', ones: 1 } }); await wait(120);
    vh.send({ t: 'start' }); await wait(200);

    // ---- the deal ----
    ok(P.every((c) => c.state.hand && c.state.hand.length === 3), 'every player is dealt a hand');
    ok(!vh.state.hand, 'the host screen is dealt none');
    const dealt = P.flatMap((c) => c.state.hand);
    ok(new Set(dealt).size === 9, 'and no card is dealt twice');
    ok(P[0].state.play.counts.join(',') === '3,3,3', 'the table sees only how many cards each hand holds');
    ok(!P[0].state.play.hands, 'and never the cards themselves');
    const up = P[0].state.play.upcard;
    ok(!!up && dealt.indexOf(up) < 0, 'the trump is turned from the rest of the deck');
    ok(P[0].state.rounds[0].trump === up.slice(-1), 'and it sets the trump suit');
    P[0].errors.length = 0;
    P[0].send({ t: 'trump', k: 'S' }); await wait(120);
    ok(P[0].errors.some((e) => /deck turns the trump/.test(e)), 'nobody may set the trump by hand');

    // ---- the bidding, as usual ----
    const r0 = P[0].state.rounds[0];
    for (let i = 0; i < 3; i++) {
      const st = P[0].state, rr = st.rounds[st.idx], turn = st.turn;
      const sum = rr.bids.reduce((a, b) => a + (b || 0), 0);
      const forbidden = (st.cfg.screw && turn === rr.dealer) ? rr.cards - sum : -1;
      P[turn].send({ t: 'bid', v: forbidden === 1 ? 0 : 1 }); await wait(120);
    }
    ok(P[0].state.phase === 'tricks', 'the last bid starts the play');
    ok(P[0].state.play.turn === (r0.dealer + 1) % 3, 'and the player left of the dealer leads');

    // ---- one card at a time ----
    const suit = (c) => c.slice(-1);
    const legalFor = (hand, led) => {
      const same = hand.filter((c) => suit(c) === led);
      return led && same.length ? same : hand;
    };
    async function playOne() {
      const st = P[0].state;
      const p = st.play.turn;
      const led = st.play.trick.length ? suit(st.play.trick[0].card) : null;
      const can = legalFor(P[p].state.hand, led);
      P[p].send({ t: 'play', card: can[0] });
      await wait(140);
      if (P[0].state.play && P[0].state.play.turn === null) await wait(260);   // a trick is held up
      return { p, card: can[0] };
    }

    // out of turn, and a card nobody holds
    const onPlay = P[0].state.play.turn;
    const off = P[(onPlay + 1) % 3];
    off.errors.length = 0;
    off.send({ t: 'play', card: off.state.hand[0] }); await wait(140);
    ok(off.errors.some((e) => /not your turn/.test(e)), 'a card out of turn is refused');
    P[onPlay].errors.length = 0;
    P[onPlay].send({ t: 'play', card: 'AS' + 'X' }); await wait(140);
    ok(P[onPlay].errors.some((e) => /do not hold/.test(e)), 'and a card you do not hold');

    const first = await playOne();
    const led = suit(first.card);
    // somebody who holds the suit led must follow it
    let tested = false;
    for (let k = 1; k < 3 && !tested; k++) {
      const p = (first.p + k) % 3;
      if (P[0].state.play.turn !== p) continue;
      const hand = P[p].state.hand;
      const hasLed = hand.some((c) => suit(c) === led);
      const other = hand.find((c) => suit(c) !== led);
      if (!hasLed || !other) continue;
      P[p].errors.length = 0;
      P[p].send({ t: 'play', card: other }); await wait(140);
      ok(P[p].errors.some((e) => /must follow/.test(e)), 'a player holding the suit led must follow it');
      tested = true;
    }
    if (!tested) ok(true, 'a player holding the suit led must follow it (no such hand this deal)');

    // play the rest of the hand out
    let guard = 40;
    while (P[0].state.phase === 'tricks' && guard-- > 0) await playOne();
    const done = P[0].state.rounds[0];
    ok(Array.isArray(done.tricks) && done.tricks.reduce((a, b) => a + b, 0) === 3,
       'the cards count the tricks themselves, and they total the hand');
    ok(P[0].state.idx === 1 && P[0].state.phase === 'bid', 'and the round scores and moves on');
    ok(P[0].state.hand.length === P[0].state.rounds[1].cards, 'the next hand is dealt at once');

    vh.errors.length = 0;
    vh.send({ t: 'tricks', values: [1, 1, 1] }); await wait(140);
    ok(vh.errors.some((e) => /count themselves/.test(e)), 'nobody may type the tricks in');

    // ---- a hand survives a phone going away and coming back ----
    const held = P[2].state.hand.join(',');
    const seatTok = P[2].hello.token;
    P[2].ws.close(); await wait(200);
    const back = client('vCal2'); await back.ready;
    back.send({ t: 'resume', code, token: seatTok }); await wait(200);
    ok(back.state.hand.join(',') === held, 'a phone that comes back gets its own hand again');
    ok(back.state.seats[2].online === true, 'and the seat is at the table again');
  }

  // ---- the dev controls are refused unless DEV=1 ----
  {
    const d = client('devprobe'); await d.ready;
    d.send({ t: 'dev', action: 'setup', players: 4 }); await wait(150);
    ok(d.errors.some((e) => /DEV=1/.test(e)), 'the dev controls are refused on a normal server');
    ok(!d.state, 'and no table is made');
    ok(host.state.dev === false, 'and the state says tables of stand-ins are off');
  }

  // ---- but the host of a real table can fix that table, on any server ----
  {
    const h = client('fixhost'); await h.ready;
    h.send({ t: 'create' }); await wait(120);
    const code = h.hello.code;
    const p1 = client('fixp1'); await p1.ready;
    const p2 = client('fixp2'); await p2.ready;
    p1.send({ t: 'join', code, name: 'Ann' }); await wait(110);
    p2.send({ t: 'join', code, name: 'Bob' }); await wait(110);
    h.send({ t: 'config', patch: { max: 1, pattern: 'down', ones: 2 } }); await wait(110);
    h.send({ t: 'start' }); await wait(150);

    h.send({ t: 'dev', action: 'patch', patch: { round: { i: 0, bids: [1, 0], tricks: [1, 0] } } });
    await wait(150);
    ok(JSON.stringify(h.state.rounds[0].bids) === '[1,0]', 'the host of a real table can force a round');
    ok(h.hello.stand === false, 'and is told it is not a table of stand-ins');
    ok(h.hello.seats.every((x) => !x.token), 'and gets no seat tokens back');

    h.errors.length = 0;
    h.send({ t: 'dev', action: 'randomise' }); await wait(140);
    ok(h.errors.some((e) => /stand-ins/.test(e)), 'but nothing on the page may invent data for it');
    h.send({ t: 'dev', action: 'endGame' }); await wait(140);
    ok(h.state.phase === 'bid', 'and it cannot be played out with made-up rounds');

    p2.errors.length = 0;
    p2.send({ t: 'dev', action: 'patch', patch: { phase: 'done' } }); await wait(140);
    ok(p2.errors.some((e) => /only the host/.test(e)) && h.state.phase === 'bid',
       'a player who does not run the table cannot use the dev controls');

    h.send({ t: 'dev', action: 'patch', patch: { round: { i: 0, tricks: ['x', 9] } } }); await wait(140);
    ok(h.state.rounds[0].tricks === null, 'junk tricks are dropped, not stored');
    h.send({ t: 'dev', action: 'patch', patch: { round: { i: 0, tricks: [5, 0] } } }); await wait(140);
    ok(JSON.stringify(h.state.rounds[0].tricks) === '[1,0]', 'and a count above the hand size is clamped');

    // ---- the seats come back as watching windows, not as seats ----
    const seats = h.hello.seats;
    ok(seats.length === 2 && seats.every((x) => x.watch && !x.token),
       'a real table gives the dev page a watch token a seat, never the seat itself');

    const bobWatch = seats.find((x) => x.name === 'Bob').watch;
    p2.ws.close(); await wait(200);                       // Bob puts his phone down
    ok(h.state.seats[1].online === false, 'Bob is offline once his phone goes');

    const eye = client('watcher'); await eye.ready;
    eye.send({ t: 'watch', code, token: bobWatch }); await wait(160);
    ok(eye.hello.role === 'watch' && eye.hello.seatId === h.state.seats[1].id,
       'a watch token opens that seat and says which one it is');
    ok(eye.state && eye.state.code === code, 'and the window gets the same state the phone gets');
    ok(h.state.seats[1].online === false, 'and watching does not put the player back at the table');

    eye.errors.length = 0;
    eye.send({ t: 'bid', v: 1 }); await wait(140);
    eye.send({ t: 'dev', action: 'patch', patch: { phase: 'done' } }); await wait(140);
    ok(eye.errors.filter((e) => /only watching/.test(e)).length === 2, 'and it can do nothing at all');
    ok(h.state.phase === 'bid', 'so the game is untouched');

    const fake = client('faker'); await fake.ready;
    fake.send({ t: 'resume', code, token: bobWatch }); await wait(150);
    ok(fake.errors.some((e) => /seat is gone/.test(e)) && !fake.state,
       'a watch token cannot be used to take the seat');
  }

  // ---- the dev controls on a server started with DEV=1 ----
  {
    const port3 = PORT + 2;
    const srv3 = spawn('node', [path + '/server.js'], {
      env: { ...process.env, PORT: port3, NO_TLS: '1', DEV: '1', TRICK_HOLD: '120', DATA_DIR }, stdio: 'ignore',
    });
    await wait(700);
    const d = client('dev', `ws://127.0.0.1:${port3}/ws`); await d.ready;
    d.send({ t: 'dev', action: 'setup', players: 4 }); await wait(200);
    ok(d.hello && d.hello.dev && d.hello.seats.length === 4, 'dev setup makes 4 stand-in seats with tokens');
    ok(d.state.dev === true, 'and the state says tables of stand-ins are on');
    d.send({ t: 'dev', action: 'startGame' }); await wait(150);
    d.send({ t: 'dev', action: 'fillBids' }); await wait(150);
    const r0 = d.state.rounds[0];
    const bidSum = r0.bids.reduce((a, b) => a + b, 0);
    ok(d.state.phase === 'tricks' && r0.bids.every((b) => b !== null), 'fillBids fills every bid');
    ok(!d.state.cfg.screw || bidSum !== r0.cards, 'and keeps the screw-the-dealer rule');
    d.send({ t: 'dev', action: 'endGame' }); await wait(600);
    ok(d.state.phase === 'done', 'endGame plays every round');

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
      d.send({ t: 'undo' }); await wait(150);
      ok(!d.state.awards && d.state.bonus.every((b) => !b), 'going back puts the accolades away');
      d.send({ t: 'dev', action: 'endGame' }); await wait(600);
      ok((d.state.awards || []).length > 0, 'and ending it again draws them afresh');

      // how many are drawn is a rule of the table
      const again = async (patch) => {
        d.send({ t: 'dev', action: 'patch', patch: { phase: 'tricks' } }); await wait(120);
        if (patch) { d.send({ t: 'config', patch }); await wait(120); }
        d.send({ t: 'dev', action: 'patch', patch: { phase: 'done' } }); await wait(150);
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
      d.send({ t: 'config', patch: { accoladeCount: 99, accoladePay: 7 } }); await wait(120);
      ok(d.state.cfg.accoladeCount === 3 && d.state.cfg.accoladePay === 20,
         'values outside the rules are refused  got ' + d.state.cfg.accoladeCount + '/' + d.state.cfg.accoladePay);
    }
    d.send({ t: 'dev', action: 'patch', patch: { idx: 1, phase: 'bid' } }); await wait(150);
    ok(d.state.idx === 1 && d.state.phase === 'bid', 'patch forces the round and the phase');
    d.send({ t: 'dev', action: 'patch', patch: { round: { i: 0, bids: [1, 0, 2, 1], tricks: [1, 1, 1, 1] } } });
    await wait(150);
    ok(JSON.stringify(d.state.rounds[0].bids) === '[1,0,2,1]' && d.state.totals.some((t) => t !== 0),
       'patch forces a round, and the totals follow');

    // ---- a random scorecard ----
    d.send({ t: 'dev', action: 'fillCard', rounds: 3 }); await wait(300);
    const full = (r) => r.bids && r.bids.every((b) => b !== null) && Array.isArray(r.tricks);
    const played = d.state.rounds.filter(full);
    ok(played.length === 3 && d.state.idx === 3 && d.state.phase === 'bid',
       'fillCard plays the number of rounds asked for');
    ok(played.every((r) => r.tricks.reduce((a, b) => a + b, 0) === r.cards),
       'and every filled hand has all of its tricks');
    ok(played.every((r) => !d.state.cfg.screw || r.bids.reduce((a, b) => a + b, 0) !== r.cards),
       'and every filled round keeps the screw-the-dealer rule');
    ok(played.every((r) => !d.state.cfg.trump || r.trump), 'and every filled round has a trump');
    ok(d.state.rounds.slice(3).every((r) => !full(r)), 'and the rounds after it are still empty');
    d.send({ t: 'dev', action: 'fillCard' }); await wait(400);
    const many = d.state.rounds.filter(full).length;
    ok(many >= 1 && many <= d.state.rounds.length, 'fillCard with no number plays a random number of rounds');

    // ---- the rules of a trick, with the cards stacked on purpose ----
    {
      d.send({ t: 'dev', action: 'setup', players: 3 }); await wait(200);
      const seats = d.hello.seats;
      d.send({ t: 'config', patch: { deck: 'virtual', max: 3, pattern: 'down', ones: 1, screw: false } });
      await wait(150);
      d.send({ t: 'dev', action: 'startGame' }); await wait(200);

      // The lead holds hearts. The next player holds a heart and two diamonds,
      // so they must follow. The last holds no heart, and a diamond is trump.
      const dealer = d.state.rounds[0].dealer;
      const lead = (dealer + 1) % 3, second = (lead + 1) % 3, third = (second + 1) % 3;
      const stack = [];
      stack[lead] = ['KH', '3S', '4C'];
      stack[second] = ['9H', 'AD', 'KD'];
      stack[third] = ['AS', '2C', 'QD'];
      d.send({ t: 'dev', action: 'patch', patch: { hands: stack } }); await wait(150);
      d.send({ t: 'dev', action: 'patch', patch: { round: { i: 0, trump: 'D' } } }); await wait(150);

      const at = [];
      for (const st of seats) {
        const c = client('stack-' + st.name, `ws://127.0.0.1:${port3}/ws`); await c.ready;
        c.send({ t: 'resume', code: d.state.code, token: st.token }); await wait(150);
        at.push(c);
      }
      ok(at[second].state.hand.join(',') === '9H,AD,KD', 'a stand-in table can have its hands stacked');
      for (let i = 0; i < 3; i++) { at[at[0].state.turn].send({ t: 'bid', v: 1 }); await wait(120); }
      ok(at[0].state.play.turn === lead, 'the player left of the dealer leads');

      at[lead].send({ t: 'play', card: 'KH' }); await wait(150);
      at[second].errors.length = 0;
      at[second].send({ t: 'play', card: 'AD' }); await wait(150);
      ok(at[second].errors.some((e) => /must follow/.test(e)),
         'a player holding the suit led may not play another');
      ok(at[0].state.play.trick.length === 1, 'and the refused card stays in the hand');
      at[second].send({ t: 'play', card: '9H' }); await wait(150);
      at[third].errors.length = 0;
      at[third].send({ t: 'play', card: 'QD' }); await wait(500);
      ok(at[third].errors.length === 0, 'a player with none of the suit led may play anything');
      ok(at[0].state.play.won[third] === 1, 'a trump beats the highest card of the suit led');
      ok(at[0].state.play.last && at[0].state.play.last.winner === third, 'the table is told who won it');
      ok(at[0].state.play.turn === third, 'and the winner leads the next trick');
      ok(at[0].state.play.counts.join(',') === '2,2,2', 'every hand is one card lighter');
      at.forEach((c) => c.ws.close());
    }

    // a real table on a dev server is still not a table of stand-ins
    const real = client('devreal', `ws://127.0.0.1:${port3}/ws`); await real.ready;
    real.send({ t: 'create' }); await wait(140);
    real.send({ t: 'dev', action: 'randomise' }); await wait(140);
    ok(real.errors.some((e) => /stand-ins/.test(e)),
       'even with DEV=1, a real table cannot have data invented on it');
    real.send({ t: 'dev', action: 'patch', patch: { phase: 'done' } }); await wait(140);
    ok(real.state.phase === 'done', 'but its state can still be forced');
    srv3.kill();
  }

  // ---- a player's picture ----
  {
    const h = client('avhost'); await h.ready; h.send({ t: 'create' }); await wait(150);
    const code = h.hello.code;
    const a = client('ava'); await a.ready; a.send({ t: 'join', code, name: 'Ava' }); await wait(150);
    const b = client('bob'); await b.ready; b.send({ t: 'join', code, name: 'Bob' }); await wait(150);

    const seatOf = (st, id) => st.seats.find((x) => x.id === id);
    ok(seatOf(h.state, a.seatId).av === null, 'a new seat has no picture');
    const url = (st, id, v) => `http://127.0.0.1:${PORT}/avatar/${st.code}/${id}` + (v ? `?v=${v}` : '');
    ok((await fetch(url(h.state, a.seatId))).status === 404, 'a seat with no picture serves a 404');

    // a one-pixel PNG is enough: the bytes only have to come back whole
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    a.send({ t: 'avatar', data: 'data:image/png;base64,' + png }); await wait(150);
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

    a.errors.length = 0;
    a.send({ t: 'avatar', data: 'data:text/html;base64,' + png }); await wait(120);
    ok(a.errors.some((e) => /WebP/.test(e)), 'only a WebP, a JPEG or a PNG is taken');
    a.send({ t: 'avatar', data: 'data:image/png;base64,' + 'A'.repeat(80000) }); await wait(150);
    ok(a.errors.some((e) => /too big/.test(e)), 'an oversized picture is refused');
    ok(seatOf(h.state, a.seatId).av === ver, 'and a refused picture leaves the old one alone');

    a.send({ t: 'avatar', data: null }); await wait(150);
    ok(seatOf(h.state, a.seatId).av === null, 'a player can take their picture down');

    b.send({ t: 'avatar', data: 'data:image/png;base64,' + png }); await wait(150);
    h.send({ t: 'start' }); await wait(200);
    b.errors.length = 0;
    b.send({ t: 'avatar', data: 'data:image/png;base64,' + png }); await wait(120);
    ok(b.errors.some((e) => /before the game starts/.test(e)),
       'the pictures are set in the lobby, not mid-game');
    ok(seatOf(h.state, b.seatId).av !== null, 'and the one already set stays up');

    h.ws.close(); a.ws.close(); b.ws.close();
  }

  // ---- a finished game is kept on file ----
  {
    const port4 = PORT + 3;
    const srv4 = spawn('node', [path + '/server.js'], {
      env: { ...process.env, PORT: port4, NO_TLS: '1', DEV: '1', TRICK_HOLD: '60',
             DATA_DIR, KEEP_GAMES: '3' }, stdio: 'ignore',
    });
    await wait(800);
    const d = client('gamefile', `ws://127.0.0.1:${port4}/ws`); await d.ready;
    d.send({ t: 'dev', action: 'setup', players: 3 }); await wait(300);
    d.send({ t: 'dev', action: 'startGame' }); await wait(200);
    d.send({ t: 'dev', action: 'endGame' }); await wait(900);
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

    const list = await fetch(`http://127.0.0.1:${port4}/games.json?code=${d.state.code}`).then((r) => r.json());
    ok(list.games.length === 1 && list.games[0].id === id, 'GET /games.json finds it by table code');
    ok(!list.games[0].rounds, 'the listing is the headline only');
    const none = await fetch(`http://127.0.0.1:${port4}/games.json?code=ZZZZ`).then((r) => r.json());
    ok(none.games.length === 0, 'and finds nothing for a table that never played');
    ok((await fetch(`http://127.0.0.1:${port4}/game/nosuchgameid`)).status === 404,
       'an id that is not a game is a 404');

    // a second game on the same table is a second record
    d.send({ t: 'dev', action: 'lobby' }); await wait(200);
    d.send({ t: 'dev', action: 'startGame' }); await wait(200);
    d.send({ t: 'dev', action: 'endGame' }); await wait(900);
    ok(d.state.gameId !== id, 'a new game on the same table gets a new id');
    const two = await fetch(`http://127.0.0.1:${port4}/games.json?code=${d.state.code}`).then((r) => r.json());
    ok(two.games.length === 2 && two.games[0].id === d.state.gameId,
       'both are on file, newest first');

    // past the cap the oldest go
    for (let i = 0; i < 3; i++) {
      d.send({ t: 'dev', action: 'lobby' }); await wait(150);
      d.send({ t: 'dev', action: 'startGame' }); await wait(150);
      d.send({ t: 'dev', action: 'endGame' }); await wait(900);
    }
    ok(fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).length === 3,
       'the table keeps no more than the cap  got ' +
       fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).length);
    ok((await fetch(`http://127.0.0.1:${port4}/game/${id}`)).status === 404,
       'and the oldest is gone');
    d.ws.close(); srv4.kill();
  }

  // ---- PUBLIC_URL replaces the detected addresses ----
  {
    const port2 = PORT + 1;
    const srv2 = spawn('node', [path + '/server.js'], {
      env: { ...process.env, PORT: port2, NO_TLS: '1', PUBLIC_URL: 'https://table.example.com/', DATA_DIR },
      stdio: 'ignore',
    });
    await wait(700);
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
    const port5 = PORT + 4;
    const listed = 'http://127.0.0.1:' + port5;
    const srv5 = spawn('node', [path + '/server.js'], {
      env: { ...process.env, PORT: port5, NO_TLS: '1', LAN_ADDRS: '192.168.99.9,not-an-address', DATA_DIR },
      stdio: 'ignore',
    });
    await wait(700);
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

  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {}
  console.log(fails ? `\n${fails} FAILURES` : '\nall integration checks passed');
  srv.kill(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });

function Game_schedule(cfg) {
  const G = require(path + '/game.js');
  return G.schedule(cfg.max, cfg.pattern, cfg.ones);
}
