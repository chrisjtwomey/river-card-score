'use strict';
/* Fills a table with stand-in players and drives it to a chosen state, so the
   screens can be worked on without gathering real people.

   node dev-seed.js --state mid --players 5 --take 2

   It talks the same protocol as a phone, so every state it makes is a state a
   real game can reach. It prints a link per seat: open one and that browser
   becomes that player. */

const WebSocket = require('ws');
const G = require('./game.js');

/* ---------- arguments ---------- */

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  if (i < 0) return dflt;
  const v = argv[i + 1];
  return (v === undefined || v.startsWith('--')) ? true : v;
};
const has = (name) => argv.includes('--' + name);

const STATES = ['lobby', 'bid', 'tricks', 'mid', 'end', 'vote', 'redeal'];
const state = String(arg('state', 'mid'));
const BASE = String(arg('url', 'http://localhost:8787')).replace(/\/$/, '');
const players = Math.max(2, Math.min(8, Number(arg('players', 4)) || 4));
const rounds = Number(arg('rounds', 2)) || 2;          // finished rounds for "mid"
const take = arg('take', null) === null ? -1 : Number(arg('take', 1)) - 1;
const auto = has('auto') || take >= 0;                 // stand-ins keep playing
const seed = Number(arg('seed', 7)) || 7;

if (has('help') || !STATES.includes(state)) {
  console.log(`states: ${STATES.join(', ')}

  --state <name>     what to set up (default mid)
  --players <2-8>    how many seats (default 4)
  --rounds <n>       finished rounds for "mid" (default 2)
  --take <seat>      keep that seat free of a stand-in, for you to play
  --auto             stand-ins keep playing (on when --take is used)
  --url <base>       server (default http://localhost:8787)
  --max, --pattern, --ones, --miss, --bonus   rules
  --seed <n>         same number, same cards`);
  process.exit(has('help') ? 0 : 1);
}

// One seeded generator, so a run can be repeated exactly.
let rnd = seed >>> 0;
const random = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (n) => Math.floor(random() * n);

const NAMES = ['Amy', 'Hugh', 'Joe', 'Nia', 'Owen', 'Pia', 'Rhys', 'Sian'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

process.on('unhandledRejection', (e) => { console.error('seed failed:', e); process.exit(1); });

/* ---------- one socket ---------- */

function client(label) {
  const url = BASE.replace(/^http/, 'ws') + '/ws';
  const ws = new WebSocket(url);
  const c = { ws, label, state: null, hello: null, errors: [] };
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.t === 'state') { c.state = m; if (c.onState) c.onState(m); }
    else if (m.t === 'hello') c.hello = m;
    else if (m.t === 'error') { c.errors.push(m.msg); console.warn(`  [${label}] ${m.msg}`); }
  });
  ws.on('error', (e) => { console.error(`cannot reach ${url}: ${e.message}`); process.exit(1); });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.ready = new Promise((r) => ws.on('open', r));
  return c;
}

/* ---------- driving a hand ---------- */

const seats = [];
let host = null;
const S = () => host.state;
const round = () => S().rounds[S().idx];

// A legal bid: never the one the screw-the-dealer rule forbids.
function bidFor(p) {
  const r = round(), n = seats.length;
  const forbidden = G.forbiddenBid(r, p, S().cfg, n);
  const choices = [];
  for (let v = 0; v <= r.cards; v++) if (v !== forbidden) choices.push(v);
  return choices[pick(choices.length)];
}

async function bidOnce() {
  const p = S().turn;
  if (p === null || p === undefined) return false;
  if (p === take) return false;                      // that seat is yours
  seats[p].send({ t: 'bid', v: bidFor(p) });
  await wait(60);
  return true;
}

async function bidAll() {
  let guard = 40;                                    // never spin on a stale state
  while (guard-- > 0 && S() && S().phase === 'bid') {
    const before = JSON.stringify(round().bids);
    if (!await bidOnce()) break;
    await wait(40);
    if (JSON.stringify(round().bids) === before) break;   // the bid did not land
  }
}

// Hand out the tricks at random, but they must total the hand size.
async function tricksNow() {
  const r = round(), n = seats.length;
  const out = Array(n).fill(0);
  for (let i = 0; i < r.cards; i++) out[pick(n)] += 1;
  const who = (r.dealer === take) ? null : seats[r.dealer];
  if (!who) return false;
  who.send({ t: 'tricks', values: out });
  await wait(80);
  return true;
}

async function playRound() {
  await bidAll();
  if (S().phase !== 'tricks') return false;
  return tricksNow();
}

/* ---------- set it up ---------- */

(async () => {
  host = client('host');
  await host.ready;
  host.send({ t: 'create' });
  await wait(200);
  const code = host.hello.code;

  for (let i = 0; i < players; i++) {
    const c = client(NAMES[i]);
    await c.ready;
    c.send({ t: 'join', code, name: NAMES[i] });
    await wait(90);
    seats.push(c);
  }

  const patch = {};
  ['max', 'pattern', 'ones', 'miss'].forEach((k) => { if (arg(k, null) !== null) patch[k] = arg(k); });
  if (arg('bonus', null) !== null) patch.bonus = Number(arg('bonus'));
  if (Object.keys(patch).length) { host.send({ t: 'config', patch }); await wait(120); }

  if (state !== 'lobby') {
    host.send({ t: 'start' });
    await wait(200);

    if (state === 'mid') {
      for (let i = 0; i < rounds && S().phase !== 'done'; i++) await playRound();
      await bidOnce();                                // one bid into the next hand
    } else if (state === 'end') {
      while (S().phase !== 'done') { if (!await playRound()) break; }
    } else if (state === 'tricks') {
      await bidAll();
    } else if (state === 'vote') {
      await bidOnce();
      // The dealer and the table host re-deal on their own, so the caller has
      // to be somebody else for a vote to open.
      const caller = S().seats.findIndex((seat, i) =>
        i !== round().dealer && seat.id !== S().captainId && i !== take);
      if (caller >= 0) { seats[caller].send({ t: 'bumdeal' }); await wait(150); }
      if (!S().vote) console.warn('  no vote opened: too few seats for one');
    } else if (state === 'redeal') {
      await bidAll();
      host.send({ t: 'bumdeal' });
      await wait(120);
    }
  }

  /* ---------- what to open ---------- */

  const line = (label, page, token) =>
    `  ${label.padEnd(12)} ${BASE}/${page}#c=${code}&t=${token}`;

  console.log(`\ntable ${code} · ${players} players · state "${state}"` +
    (S().rounds.length ? ` · round ${Math.min(S().idx + 1, S().rounds.length)} of ${S().rounds.length}` : ''));
  console.log(`  phase        ${S().phase}` + (S().turn !== null ? ` · ${seats[S().turn] ? S().seats[S().turn].name : ''} to bid` : ''));
  console.log('\nopen any of these, the link puts that seat in the browser:');
  console.log(line('host screen', 'host.html', host.hello.token));
  seats.forEach((c, i) => {
    const mine = i === take ? '  <-- free for you' : '';
    console.log(line(S().seats[i].name + (i === take ? '*' : ''), 'play.html', c.hello.token) + mine);
  });
  console.log(`\ntotals: ${S().seats.map((s, i) => `${s.name} ${S().totals[i]}`).join(' · ')}`);

  if (auto) {
    console.log('\nstand-ins keep playing. Ctrl-C to stop.');
    host.onState = async () => {
      if (S().phase === 'bid') await bidOnce();
      else if (S().phase === 'tricks' && round().dealer !== take) await tricksNow();
    };
  } else {
    console.log('\nthe table stays as it is. Ctrl-C to stop (the room lives on for 6 hours).');
  }
})();
