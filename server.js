'use strict';
/* Up the River, Down the River — table server.
   One host screen per room. Players join on their phones and bid in turn. */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dgram = require('dgram');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const qrcode = require('qrcode-generator');
const G = require('./game.js');
const A = require('./public/accolades.js');

const PORT = Number(process.env.PORT) || 8787;
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
// A phone only gets the screen lock (and other secure-context features) over
// https. Drop a key and certificate in certs/ (npm run cert) to serve https.
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const KEEP_GAMES = Math.max(1, Number(process.env.KEEP_GAMES) || 200);
const TLS_KEY = process.env.TLS_KEY || path.join(__dirname, 'certs', 'key.pem');
const TLS_CERT = process.env.TLS_CERT || path.join(__dirname, 'certs', 'cert.pem');
let tls = null;
if (process.env.NO_TLS !== '1') {
  try {
    if (fs.existsSync(TLS_KEY) && fs.existsSync(TLS_CERT)) {
      tls = { key: fs.readFileSync(TLS_KEY), cert: fs.readFileSync(TLS_CERT) };
    }
  } catch (e) { console.warn('[tls] cannot read the certificate:', e.message); }
}
const SCHEME = tls ? 'https' : 'http';
const DEV = process.env.DEV === '1';        // live reload, for working on it

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

/* ---------------- addresses and QR ---------------- */

// Every address a phone can use to reach the table. PUBLIC_URL replaces the
// detected addresses, it does not add to them: behind a proxy or in a
// container the detected ones are private and no phone can reach them.
let hiddenNets = false;                    // the OS would not say what they are
let probed = '';                           // the address the routing table gave

// Android hides the interface list from every app, so os.networkInterfaces()
// is empty or throws there. The kernel still answers one question: "which of
// my addresses would you use to reach that host?" A UDP socket is connected
// -- which sends nothing -- and its local address is the answer. It costs
// nothing, needs no permission, and is right on any machine.
function probeLanAddress() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (addr) => { if (!done) { done = true; try { sock.close(); } catch (e) {} resolve(addr); } };
    let sock;
    try { sock = dgram.createSocket('udp4'); } catch (e) { resolve(''); return; }
    sock.on('error', () => finish(''));
    setTimeout(() => finish(''), 1000).unref();
    try {
      sock.connect(9, '203.0.113.1', () => {           // TEST-NET-3, never routed
        let a = '';
        try { a = sock.address().address; } catch (e) {}
        finish(a && a !== '0.0.0.0' ? a : '');
      });
    } catch (e) { finish(''); }
  });
}

// Keep it fresh: the address changes when the phone joins another network.
async function refreshLanAddress() {
  const a = await probeLanAddress();
  if (a) probed = a;
}

function lanUrls() {
  const named = (process.env.PUBLIC_URL || '').split(',')
    .map((u) => u.trim().replace(/\/$/, '')).filter(Boolean);
  if (named.length) return Array.from(new Set(named));

  const out = [];
  // Android keeps the interface list from apps, so on a phone in Termux this
  // throws. That must not take the server down: an empty list is an answer,
  // and the pages fall back to the address they were opened at.
  let nets = {};
  try { nets = os.networkInterfaces(); } catch (e) { hiddenNets = true; }
  Object.values(nets).forEach((list) => (list || []).forEach((ni) => {
    if (ni.family === 'IPv4' && !ni.internal) out.push(`${SCHEME}://${ni.address}:${PORT}`);
  }));
  if (probed) out.push(`${SCHEME}://${probed}:${PORT}`);
  return Array.from(new Set(out));
}

// White background and black modules whatever the page theme is, or a phone
// camera will not read it.
function qrSvg(text, cell, margin) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = (n + margin * 2) * cell;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      d += `M${(c + margin) * cell} ${(r + margin) * cell}h${cell}v${cell}h-${cell}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="Join code">` +
    `<rect width="100%" height="100%" fill="#ffffff"/><path d="${d}" fill="#000000"/></svg>`;
}

/* ---------------- live reload (dev only) ---------------- */

const liveClients = new Set();

if (DEV) {
  let timer = null;
  const bump = (what) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.log(`[dev] ${what} changed: reloading ${liveClients.size} page(s)`);
      liveClients.forEach((res) => res.write(`event: reload\ndata: ${JSON.stringify(what)}\n\n`));
    }, 150);                                 // editors write more than once
  };
  try {
    fs.watch(PUB, { recursive: true }, (e, f) => { if (f) bump(String(f)); });
    fs.watch(path.join(ROOT, 'game.js'), () => bump('game.js'));
  } catch (e) {
    console.warn('[dev] cannot watch the files:', e.message);
  }
  setInterval(() => liveClients.forEach((res) => res.write(': ping\n\n')), 25000);
}

/* ---------------- static files ---------------- */

function handler(req, res) {
  const [rawPath, rawQuery] = (req.url || '/').split('?');
  let url = decodeURIComponent(rawPath);
  const query = new URLSearchParams(rawQuery || '');

  if (url === '/live') {                           // page reload stream, dev only
    if (!DEV) { res.writeHead(404, { 'content-type': 'text/plain' }).end('live reload is off'); return; }
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',                   // nginx must not hold it back
    });
    res.write('retry: 1000\n\n');
    liveClients.add(res);
    req.on('close', () => liveClients.delete(res));
    return;
  }

  if (url === '/net.json') {                       // addresses for the host screen
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
    res.end(JSON.stringify({ port: PORT, urls: lanUrls() }));
    return;
  }

  if (url === '/qr.svg') {                         // QR for the join address
    const text = String(query.get('d') || '').slice(0, 300);
    if (!text) { res.writeHead(400).end('missing d'); return; }
    const cell = Math.max(2, Math.min(20, Number(query.get('cell')) || 8));
    try {
      res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(qrSvg(text, cell, 4));
    } catch (e) {
      res.writeHead(500).end('qr failed');
    }
    return;
  }

  if (url === '/games.json') {                     // what the table has on file
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
    res.end(JSON.stringify({ games: listGames(query.get('code')) }));
    return;
  }

  if (url.startsWith('/game/')) {                  // one finished game, whole
    const rec = readGame(url.slice('/game/'.length).replace(/\.json$/, ''));
    if (!rec) { res.writeHead(404, { 'content-type': 'text/plain' }).end('no such game'); return; }
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=31536000, immutable',   // a finished game never changes
    });
    res.end(JSON.stringify(rec));
    return;
  }

  if (url.startsWith('/avatar/')) {                // a player's picture, by seat
    const part = url.split('/');                   // '', 'avatar', code, seat
    const room = rooms.get(String(part[2] || '').toUpperCase());
    const seat = room && room.seats.find((x) => x.id === part[3]);
    if (!seat || !seat.av) { res.writeHead(404, { 'content-type': 'text/plain' }).end('no picture'); return; }
    // The version is in the address, so a hit on the right one can be held for
    // good. A guess at the address must not be.
    res.writeHead(200, {
      'content-type': seat.av.type,
      'cache-control': query.get('v') === seat.av.ver
        ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(seat.av.buf);
    return;
  }

  if (url === '/') url = '/index.html';
  const file = url === '/game.js' ? path.join(ROOT, 'game.js') : path.join(PUB, url);
  const safe = path.normalize(file);
  if (!safe.startsWith(PUB) && safe !== path.join(ROOT, 'game.js')) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(safe, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(safe)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
}

const server = tls ? https.createServer(tls, handler) : http.createServer(handler);

/* ---------------- rooms ---------------- */

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
const rooms = new Map();
const token = () => crypto.randomBytes(12).toString('hex');

/* ---------------- player pictures ---------------- */

/* A seat may carry a picture. It never rides in the state: the state goes out
   on every bid and every card, and a picture in there would go with it. The
   state carries a version only, and the picture itself is fetched once over
   HTTP and held in the browser cache. */
const AV_TYPES = { 'image/webp': 1, 'image/jpeg': 1, 'image/png': 1 };
const AV_MAX = 48 * 1024;

// Returns null when the picture is set, or a line to show the player.
function setAvatar(seat, data) {
  if (data === null || data === undefined || data === '') { seat.av = null; return null; }
  const m = /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=]*)$/.exec(String(data));
  if (!m) return 'that picture did not arrive in a form the table understands';
  if (!AV_TYPES[m[1]]) return 'the picture must be a WebP, a JPEG or a PNG';
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) return 'that picture is empty';
  if (buf.length > AV_MAX) return 'that picture is too big';
  seat.av = { buf, type: m[1], ver: token().slice(0, 8) };
  return null;
}

function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join(''); }
  while (rooms.has(c));
  return c;
}

function createRoom() {
  const room = {
    code: newCode(),
    hostToken: token(),
    phase: 'lobby',
    cfg: G.defaultCfg(2),
    onesLocked: false,
    firstDealerId: null,        // seat that deals round 1, or null for seat 1
    captainId: null,            // the player who runs the table from their phone
    seats: [],
    rounds: [],
    idx: 0,
    vote: null,                 // an open "bum deal" vote, or null
    stand: false,               // true for a dev table of stand-in players
    play: null,                 // the hands and the trick, when the deck is virtual
    awards: null,               // the accolades drawn at the end of the game
    bonus: null,                // and what they paid each seat
    sockets: new Set(),
    lastSeen: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

const seatIndex = (room, id) => room.seats.findIndex((s) => s.id === id);
const curRound = (room) => room.rounds[room.idx] || null;

function syncCfg(room) {
  const n = Math.max(2, room.seats.length);
  room.cfg.max = Math.min(room.cfg.max, G.maxCardsFor(n));
  if (!room.onesLocked) room.cfg.ones = n;
  if (room.firstDealerId && seatIndex(room, room.firstDealerId) < 0) room.firstDealerId = null;
  if (seatIndex(room, room.captainId) < 0) room.captainId = room.seats.length ? room.seats[0].id : null;
}

function publicState(room) {
  const n = room.seats.length;
  const r = curRound(room);
  const bonus = room.bonus || Array(n).fill(0);
  return {
    t: 'state',
    code: room.code,
    phase: room.phase,
    cfg: room.cfg,
    seats: room.seats.map((s) => ({ id: s.id, name: s.name, online: s.online,
                                    av: s.av ? s.av.ver : null })),
    firstDealerId: room.firstDealerId,
    captainId: room.captainId,
    rounds: room.rounds,
    idx: room.idx,
    turn: (room.phase === 'bid' && r) ? G.turnSeat(r, n) : null,
    vote: (room.vote && room.vote.round === room.idx) ? room.vote : null,
    totals: n ? G.totals(room.cfg, room.rounds, n).map((v, i) => v + (bonus[i] || 0)) : [],
    bonus,                          // what the accolades paid, once they are drawn
    awards: room.awards || null,    // the three drawn at the end
    gameId: room.phase === 'done' ? (room.gameId || null) : null,
    play: playPublic(room),         // the cards on the table, never the hands
    dev: DEV,                       // the host screen offers the dev page when it is on
  };
}

// A hand is a secret, so each socket gets the table plus its own cards. A
// screen with no seat -- the host screen -- gets the table alone.
function broadcast(room) {
  room.lastSeen = Date.now();
  const base = publicState(room);
  const shared = JSON.stringify(base);
  room.sockets.forEach((ws) => {
    if (ws.readyState !== 1) return;
    const seat = (room.play && ws.ctx && ws.ctx.seatId) ? seatIndex(room, ws.ctx.seatId) : -1;
    if (seat < 0) { ws.send(shared); return; }
    base.hand = room.play.hands[seat];
    ws.send(JSON.stringify(base));
  });
  delete base.hand;
}

function markPresence(room) {
  room.seats.forEach((s) => {
    s.online = Array.from(room.sockets).some(
      (w) => w.ctx && w.ctx.seatId === s.id && w.ctx.role !== 'watch');
  });
}

// A bum deal: the cards were dealt wrong, so throw the hand in and deal it
// again. Same dealer, same hand size, bids and tricks cleared.
function bumDeal(room) {
  const r = curRound(room);
  if (!r) return false;
  r.bids = Array(room.seats.length).fill(null);
  r.tricks = null;
  r.trump = null;
  r.redeals = (r.redeals || 0) + 1;
  room.phase = 'bid';
  room.vote = null;
  if (virtual(room)) dealHands(room);
  return true;
}

/* ---------------- the virtual deck ---------------- */

const TRICK_HOLD = Number(process.env.TRICK_HOLD) || 1500;   // how long a finished trick stays up
const virtual = (room) => room.cfg.deck === 'virtual';

// Shuffle, deal, and turn the next card for trump. With no card left over --
// four players at thirteen cards -- the hand is played at no trumps.
function dealHands(room) {
  const r = curRound(room), n = room.seats.length;
  if (!r) return;
  const d = G.shuffle(G.deck());
  const hands = [];
  for (let p = 0; p < n; p++) hands.push(G.sortHand(d.splice(0, r.cards)));
  const up = (room.cfg.trump && d.length) ? d.shift() : null;
  r.trump = room.cfg.trump ? (up ? G.suitOf(up) : 'NT') : null;
  room.play = { round: room.idx, hands, upcard: up, trick: [], turn: null,
                won: Array(n).fill(0), last: null };
}

// The bids are in: the player left of the dealer leads the first trick.
function startPlay(room) {
  const r = curRound(room), n = room.seats.length;
  if (!room.play || room.play.round !== room.idx) dealHands(room);
  room.play.trick = [];
  room.play.last = null;
  room.play.turn = (r.dealer + 1) % n;
}

// What everybody may see: the cards on the table, how many are left in each
// hand, and who won the last trick. Never a hand.
function playPublic(room) {
  const p = room.play;
  if (!p) return null;
  return { turn: p.turn, trick: p.trick, won: p.won, last: p.last,
           upcard: p.upcard, counts: p.hands.map((h) => h.length) };
}

// One card. The server holds the rules, so a phone cannot renege.
function playCard(ws, room, p, card) {
  const play = room.play, r = curRound(room), n = room.seats.length;
  if (play.turn !== p) return fail(ws, 'not your turn');
  const hand = play.hands[p];
  if (hand.indexOf(card) < 0) return fail(ws, 'you do not hold that card');
  const led = play.trick.length ? G.suitOf(play.trick[0].card) : null;
  if (G.legalPlays(hand, led).indexOf(card) < 0) {
    const suit = G.SUITS.find((x) => x.k === led);
    return fail(ws, `you must follow ${suit ? suit.name.toLowerCase() : 'the suit led'}`);
  }

  if (!play.trick.length) play.last = null;        // the last trick has had its moment
  hand.splice(hand.indexOf(card), 1);
  play.trick.push({ p, card });
  if (play.trick.length < n) {
    play.turn = (p + 1) % n;
    return broadcast(room);
  }

  // the trick is full: name the winner and hold it up for the table
  const winner = G.trickWinner(play.trick, r.trump);
  play.won[winner] += 1;
  play.last = { trick: play.trick.slice(), winner };
  play.trick = [];
  play.turn = null;
  const tag = play, at = room.idx;
  setTimeout(() => {
    if (room.play !== tag || room.idx !== at) return;      // the game moved on
    if (tag.hands.every((h) => !h.length)) scoreRound(room, tag.won.slice());
    else tag.turn = winner;
    broadcast(room);
  }, TRICK_HOLD);
  return broadcast(room);
}

// The last round is in. A few of the accolades the table earned are drawn at
// random and paid, and only then is the winner known.
function finishGame(room) {
  const n = room.seats.length;
  room.phase = 'done';
  room.idx = room.rounds.length;
  const earned = A.list(room.rounds, n, (b, w) => G.roundScore(b, w, room.cfg));
  room.awards = A.pick(earned, room.cfg.accoladeCount);
  room.bonus = A.bonus(room.awards, n, room.cfg.accoladePay);
  if (!room.gameId) room.gameId = token().slice(0, 12);
  saveGame(room);
}

/* A finished game, as it is kept. It is the scorecard and nothing else: no
   tokens, no pictures, no hands. The same shape goes to the phones, so one
   reader draws either. */
function gameRecord(room) {
  const n = room.seats.length;
  const bonus = room.bonus || Array(n).fill(0);
  const totals = n ? G.totals(room.cfg, room.rounds, n).map((v, i) => v + (bonus[i] || 0)) : [];
  const best = totals.length ? Math.max.apply(null, totals) : 0;
  return {
    id: room.gameId,
    code: room.code,
    at: room.finishedAt || (room.finishedAt = Date.now()),
    cfg: room.cfg,
    seats: room.seats.map((s) => ({ id: s.id, name: s.name })),
    rounds: room.rounds,
    totals,
    bonus,
    awards: room.awards || [],
    winners: totals.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0),
  };
}

/* Games are kept as one file each, newest last by name. Past the cap the
   oldest go. A table that finishes twice -- a score put right, say -- writes
   over its own file. */
function saveGame(room) {
  let rec;
  try { rec = gameRecord(room); } catch (e) { console.warn('[games] could not build the record:', e.message); return; }
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(path.join(DATA, `${rec.at}-${rec.id}.json`), JSON.stringify(rec));
    const kept = fs.readdirSync(DATA).filter((f) => f.endsWith('.json')).sort();
    kept.slice(0, Math.max(0, kept.length - KEEP_GAMES))
      .forEach((f) => { try { fs.unlinkSync(path.join(DATA, f)); } catch (e) {} });
  } catch (e) {
    console.warn('[games] could not write the record:', e.message);
  }
}

// One game off the disk, by its id, or null.
function readGame(id) {
  if (!/^[0-9a-f]{12}$/.test(String(id || ''))) return null;
  try {
    const f = fs.readdirSync(DATA).find((x) => x.endsWith(`-${id}.json`));
    return f ? JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')) : null;
  } catch (e) { return null; }
}

// What the table has on file for one code: newest first, the headline only.
function listGames(code) {
  const want = String(code || '').toUpperCase();
  try {
    return fs.readdirSync(DATA).filter((f) => f.endsWith('.json')).sort().reverse()
      .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return null; } })
      .filter((r) => r && (!want || r.code === want))
      .slice(0, KEEP_GAMES)
      .map((r) => ({ id: r.id, code: r.code, at: r.at,
                     names: r.seats.map((s) => s.name), totals: r.totals, winners: r.winners }));
  } catch (e) { return []; }
}

// Back into play: the accolades are not settled after all.
function unfinish(room) { room.awards = null; room.bonus = null; }

/* A fresh set of rounds is a fresh game, and it gets a file of its own. Going
   back into a game that was already over does not: it writes over its own. */
function newGame(room) { room.gameId = null; room.finishedAt = null; }

// The round is over, however the tricks were counted.
function scoreRound(room, values) {
  const n = room.seats.length;
  curRound(room).tricks = values;
  room.vote = null;
  room.play = null;
  room.idx += 1;
  if (room.idx >= room.rounds.length) { finishGame(room); }
  else {
    room.rounds[room.idx].bids = Array(n).fill(null);
    room.phase = 'bid';
    if (virtual(room)) dealHands(room);
  }
}

/* ---------------- dev controls (DEV=1 only) ---------------- */

const DEV_NAMES = ['Amy', 'Hugh', 'Joe', 'Nia', 'Owen', 'Pia', 'Rhys', 'Sian'];
const rand = (n) => Math.floor(Math.random() * n);

function devSeats(room, count) {
  room.stand = true;            // a table of stand-ins, never a real game
  room.seats = [];
  for (let i = 0; i < Math.max(2, Math.min(8, count)); i++) {
    room.seats.push({ id: token().slice(0, 8), name: DEV_NAMES[i], token: token(), watch: token(), online: false });
  }
  room.captainId = room.seats[0].id;
  room.firstDealerId = null;
  room.phase = 'lobby';
  room.rounds = [];
  room.idx = 0;
  room.vote = null;
  unfinish(room);
  syncCfg(room);
}

function devStart(room) {
  const n = room.seats.length;
  syncCfg(room);
  const first = Math.max(0, seatIndex(room, room.firstDealerId));
  room.rounds = G.buildRounds(room.cfg, n, first);
  newGame(room);
  room.idx = 0;
  room.rounds[0].bids = Array(n).fill(null);
  room.phase = 'bid';
  room.vote = null;
  room.play = null;
  unfinish(room);
  if (virtual(room)) dealHands(room);
}

// Bids that a real table could make, including the screw-the-dealer rule.
function devFillBids(room) {
  const r = curRound(room), n = room.seats.length;
  if (!r) return;
  if (!r.bids) r.bids = Array(n).fill(null);
  let p = G.turnSeat(r, n);
  while (p !== null) {
    const forbidden = G.forbiddenBid(r, p, room.cfg, n);
    const choices = [];
    for (let v = 0; v <= r.cards; v++) if (v !== forbidden) choices.push(v);
    r.bids[p] = choices[rand(choices.length)];
    p = G.turnSeat(r, n);
  }
  room.phase = 'tricks';
  if (virtual(room)) startPlay(room);
}

// Play the hand out at once, with no pause between the tricks. Only the dev
// page does this: a real table watches each trick land.
function devPlayOut(room) {
  const r = curRound(room), n = room.seats.length, play = room.play;
  if (!play) return;
  if (play.turn === null) play.turn = (r.dealer + 1) % n;
  let guard = 400;
  while (guard-- > 0 && play.hands.some((h) => h.length)) {
    const p = play.turn;
    const led = play.trick.length ? G.suitOf(play.trick[0].card) : null;
    const can = G.legalPlays(play.hands[p], led);
    const card = can[rand(can.length)];
    play.hands[p].splice(play.hands[p].indexOf(card), 1);
    play.trick.push({ p, card });
    if (play.trick.length < n) { play.turn = (p + 1) % n; continue; }
    const w = G.trickWinner(play.trick, r.trump);
    play.won[w] += 1;
    play.last = { trick: play.trick.slice(), winner: w };
    play.trick = [];
    play.turn = w;
  }
  scoreRound(room, play.won.slice());
}

function devFillTricks(room) {
  const r = curRound(room), n = room.seats.length;
  if (!r || !r.bids || r.bids.some((b) => b === null)) return;
  if (virtual(room)) return devPlayOut(room);        // the cards decide, and score
  const out = Array(n).fill(0);
  for (let i = 0; i < r.cards; i++) out[rand(n)] += 1;
  r.tricks = out;
}

function devNextRound(room) {
  if (!room.rounds.length) { devStart(room); return; }
  if (room.phase === 'done') return;
  const r = curRound(room);
  if (r && room.cfg.trump && !r.trump && !virtual(room)) r.trump = G.SUITS[rand(G.SUITS.length)].k;
  const at = room.idx;
  devFillBids(room);
  devFillTricks(room);
  if (room.idx !== at) return;                       // a virtual hand scored itself
  scoreRound(room, curRound(room).tricks);           // the same road a real round takes
}

function devEndGame(room) {
  if (!room.rounds.length) devStart(room);
  let guard = 60;
  while (room.phase !== 'done' && guard-- > 0) devNextRound(room);
}

// Fill the scorecard. Plays whole rounds of bids and tricks that a real table
// could make, and leaves the next round waiting for its bids. The rules, the
// seats and the first dealer stay as they are. `count` rounds, or a random
// number of them when `count` is not a number.
function devFillCard(room, count) {
  devStart(room);                       // an empty card, built from the rules in force
  const total = room.rounds.length;
  let want = Number(count);
  if (!Number.isFinite(want)) want = 1 + rand(total);
  want = Math.max(0, Math.min(Math.round(want), total));
  for (let i = 0; i < want; i++) devNextRound(room);
}

function devBumVote(room) {
  const r = curRound(room);
  if (!r) return;
  const by = room.seats.findIndex((seat, i) => i !== r.dealer && seat.id !== room.captainId);
  if (by < 0) return;
  room.vote = { kind: 'bumdeal', by, round: room.idx, yes: [by], no: [] };
}

// A table part way through, with the rules shuffled about.
function devRandomise(room) {
  const n = room.seats.length;
  room.cfg.max = 2 + rand(Math.min(6, G.maxCardsFor(n) - 1));
  room.cfg.pattern = ['downup', 'updown', 'down', 'up'][rand(4)];
  room.cfg.ones = 1 + rand(n);
  room.cfg.bonus = [10, 5, 1, 0][rand(4)];
  room.cfg.miss = Object.keys(G.MISS_RULES)[rand(5)];
  room.cfg.screw = rand(2) === 0;
  room.onesLocked = true;
  room.firstDealerId = room.seats[rand(n)].id;
  room.captainId = room.seats[rand(n)].id;
  devStart(room);
  const played = rand(room.rounds.length);
  for (let i = 0; i < played; i++) devNextRound(room);
  if (room.phase === 'bid' && rand(2) === 0) {          // part way through the bids
    const r = curRound(room);
    const order = G.bidOrder(r.dealer, n);
    const upto = rand(n);
    for (let i = 0; i < upto; i++) r.bids[order[i]] = rand(r.cards + 1);
  }
  const r = curRound(room);
  if (r && room.cfg.trump && rand(3) > 0) r.trump = G.SUITS[rand(G.SUITS.length)].k;
}

// Bids and tricks come in from the dev page, so keep the shape right: one
// whole number a seat, inside the hand. The values themselves may still be as
// odd as the page likes, which is the point of the page.
function devNums(v, n, cards, allowNull) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = v[i];
    if (x === null || x === undefined) {
      if (!allowNull) return null;
      out.push(null);
      continue;
    }
    const k = Math.round(Number(x));
    if (!Number.isFinite(k)) return null;
    out.push(Math.max(0, Math.min(k, cards)));
  }
  return out;
}

// Force values the protocol would not allow, for looking at a screen.
function devPatch(room, p) {
  const n = room.seats.length;
  if (p.cfg && room.stand) Object.assign(room.cfg, p.cfg);
  if (typeof p.idx === 'number' && room.rounds.length) {
    room.idx = Math.max(0, Math.min(p.idx, room.rounds.length));
    if (room.idx < room.rounds.length && !room.rounds[room.idx].bids) {
      room.rounds[room.idx].bids = Array(n).fill(null);
    }
  }
  if (p.phase && ['lobby', 'bid', 'tricks', 'done'].includes(p.phase)) {
    room.phase = p.phase;
    if (p.phase === 'done') finishGame(room);
    else unfinish(room);
  }
  if (p.captainId && seatIndex(room, p.captainId) >= 0) room.captainId = p.captainId;
  if ('firstDealerId' in p) {
    room.firstDealerId = (p.firstDealerId && seatIndex(room, p.firstDealerId) >= 0) ? p.firstDealerId : null;
  }
  if (p.hands && room.play && room.stand && Array.isArray(p.hands)) {
    room.play.hands = p.hands.map((h) => (Array.isArray(h) ? h.slice(0, 13) : []));
  }
  if (p.round && room.rounds[p.round.i]) {
    const r = room.rounds[p.round.i];
    if ('bids' in p.round) r.bids = devNums(p.round.bids, n, r.cards, true);
    if ('tricks' in p.round) r.tricks = devNums(p.round.tricks, n, r.cards, false);
    if ('trump' in p.round) r.trump = p.round.trump;
    if ('redeals' in p.round) r.redeals = Number(p.round.redeals) || 0;
  }
  if (p.vote === null) room.vote = null;
}

/* ---------------- socket protocol ---------------- */

const wss = new WebSocketServer({ server, path: '/ws' });

const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
const fail = (ws, msg) => send(ws, { t: 'error', msg });

// What the dev page gets back after every action. The seat tokens go with it
// only for a table of stand-ins, so the previews can open each phone. A real
// table never hands its seats out.
function devHello(ws, room) {
  // A table of stand-ins hands over the seats themselves, so every phone in
  // the previews can be played. A real table hands over watch tokens instead:
  // they open the same screen, but they cannot act and nobody comes online.
  send(ws, {
    t: 'hello', role: 'host', code: room.code, token: room.hostToken,
    dev: true, stand: !!room.stand,
    seats: room.seats.map((x) => (room.stand
      ? { id: x.id, name: x.name, token: x.token }
      : { id: x.id, name: x.name, watch: x.watch })),
  });
  return broadcast(room);
}

function attach(ws, room, ctx) {
  if (ws.ctx && ws.ctx.room && ws.ctx.room !== room) ws.ctx.room.sockets.delete(ws);
  ws.ctx = Object.assign({ room }, ctx);
  room.sockets.add(ws);
  markPresence(room);
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(String(data)); } catch (e) { return fail(ws, 'bad message'); }
    try { handle(ws, m); } catch (e) { fail(ws, e.message || 'server error'); }
  });

  ws.on('close', () => {
    const room = ws.ctx && ws.ctx.room;
    if (!room) return;
    room.sockets.delete(ws);
    markPresence(room);
    broadcast(room);
  });
});

function handle(ws, m) {
  /* --- entry points --- */
  if (m.t === 'create') {
    const room = createRoom();
    attach(ws, room, { role: 'host' });
    send(ws, { t: 'hello', role: 'host', code: room.code, token: room.hostToken });
    return broadcast(room);
  }

  /* The dev page, two ways in.
     With DEV=1 it makes a table of stand-in players and may do anything to it,
     including inventing bids and scores. From the host screen of a real table
     it may only force that table's own state, to fix a game in play. */
  if (m.t === 'dev') {
    if (m.action === 'setup') {
      if (!DEV) return fail(ws, 'a table of stand-ins needs the server started with DEV=1');
      const made = createRoom();
      attach(ws, made, { role: 'host' });
      devSeats(made, Number(m.players) || 4);
      return devHello(ws, made);
    }
    const room = ws.ctx && ws.ctx.room;
    if (!room) return fail(ws, 'open a table first');
    if (ws.ctx.role === 'watch') return fail(ws, 'this window is only watching');
    const mine = ws.ctx.seatId ? seatIndex(room, ws.ctx.seatId) : -1;
    const runs = ws.ctx.role === 'host' || (mine >= 0 && room.seats[mine].id === room.captainId);
    if (!runs) return fail(ws, 'only the host can use the dev controls');
    // Everything that invents data belongs to a table of stand-ins. A real
    // table gets the state editor and nothing else.
    if (m.action !== 'patch' && !(DEV && room.stand)) {
      return fail(ws, 'that control only works on a table of stand-ins');
    }
    switch (m.action) {
      case 'players': devSeats(room, Number(m.players) || 4); break;
      case 'startGame': devStart(room); break;
      case 'fillBids': devFillBids(room); break;
      case 'fillTricks': devFillTricks(room); break;
      case 'nextRound': devNextRound(room); break;
      case 'endGame': devEndGame(room); break;
      case 'lobby': room.phase = 'lobby'; room.rounds = []; room.idx = 0; room.vote = null; unfinish(room); break;
      case 'bumVote': devBumVote(room); break;
      case 'fillCard': devFillCard(room, m.rounds); break;
      case 'randomise': devRandomise(room); break;
      case 'avatar': {
        const seat = room.seats[Number(m.seat)];
        if (!seat) return fail(ws, 'no such seat');
        const bad = setAvatar(seat, m.data);
        if (bad) return fail(ws, bad);
        break;
      }
      case 'patch': devPatch(room, m.patch || {}); break;
      default: return fail(ws, 'unknown dev action');
    }
    return devHello(ws, room);
  }

  if (m.t === 'avatar') {
    const room = ws.ctx && ws.ctx.room;
    if (!room) return fail(ws, 'take a seat first');
    if (ws.ctx.role !== 'player' || !ws.ctx.seatId) return fail(ws, 'only a player has a picture');
    if (room.phase !== 'lobby') return fail(ws, 'the pictures are set before the game starts');
    const seat = room.seats.find((x) => x.id === ws.ctx.seatId);
    if (!seat) return fail(ws, 'that seat is gone');
    const bad = setAvatar(seat, m.data);
    if (bad) return fail(ws, bad);
    return broadcast(room);
  }

  if (m.t === 'join') {
    const room = rooms.get(String(m.code || '').toUpperCase().trim());
    if (!room) return fail(ws, 'no table with that code');
    if (room.phase !== 'lobby') return fail(ws, 'that game has already started');
    if (room.seats.length >= 8) return fail(ws, 'the table is full');
    const name = String(m.name || '').trim().slice(0, 16) || `Player ${room.seats.length + 1}`;
    if (room.seats.some((s) => s.name.toLowerCase() === name.toLowerCase())) return fail(ws, 'that name is taken');
    const seat = { id: token().slice(0, 8), name, token: token(), watch: token(), online: true };
    room.seats.push(seat);
    if (!room.captainId) room.captainId = seat.id;      // first in, table host
    syncCfg(room);
    attach(ws, room, { role: 'player', seatId: seat.id });
    send(ws, { t: 'hello', role: 'player', code: room.code, token: seat.token, seatId: seat.id });
    return broadcast(room);
  }

  if (m.t === 'resume') {
    const room = rooms.get(String(m.code || '').toUpperCase().trim());
    if (!room) return fail(ws, 'that table is gone');
    if (m.token === room.hostToken) {
      attach(ws, room, { role: 'host' });
      send(ws, { t: 'hello', role: 'host', code: room.code, token: room.hostToken });
      return broadcast(room);
    }
    const seat = room.seats.find((s) => s.token === m.token);
    if (!seat) return fail(ws, 'that seat is gone');
    attach(ws, room, { role: 'player', seatId: seat.id });
    send(ws, { t: 'hello', role: 'player', code: room.code, token: seat.token, seatId: seat.id });
    return broadcast(room);
  }

  // A window that shows one seat's screen. It is the same page the player has,
  // off the same state, but it cannot touch the game and it does not count as
  // that player being at the table.
  if (m.t === 'watch') {
    const room = rooms.get(String(m.code || '').toUpperCase().trim());
    if (!room) return fail(ws, 'that table is gone');
    const tok = String(m.token || '');
    const seat = tok && room.seats.find((x) => x.watch === tok);
    if (!seat) return fail(ws, 'that seat is gone');
    attach(ws, room, { role: 'watch', seatId: seat.id });
    send(ws, { t: 'hello', role: 'watch', code: room.code, token: m.token, seatId: seat.id });
    return broadcast(room);
  }

  /* --- everything below needs a room --- */
  const ctx = ws.ctx;
  if (!ctx || !ctx.room) return fail(ws, 'join a table first');
  const room = ctx.room;
  const n = room.seats.length;
  const isHost = ctx.role === 'host';
  if (ctx.role === 'watch' && m.t !== 'ping') return fail(ws, 'this window is only watching');
  const mySeat = ctx.seatId ? seatIndex(room, ctx.seatId) : -1;
  // The table host is a player with the same powers as the host screen, so a
  // game can run with no host screen at all.
  const isCaptain = mySeat >= 0 && room.seats[mySeat].id === room.captainId;
  const boss = isHost || isCaptain;
  const r = curRound(room);

  switch (m.t) {
    case 'ping': return send(ws, { t: 'pong' });

    case 'config': {
      if (!boss) return fail(ws, 'only the table host changes the rules');
      if (room.phase !== 'lobby' && !DEV) return fail(ws, 'the game has started');
      const c = room.cfg, p = m.patch || {};
      if ('max' in p) c.max = Math.max(1, Math.min(Number(p.max) || 1, G.maxCardsFor(Math.max(2, n))));
      if ('ones' in p) { c.ones = Math.max(1, Math.min(8, Number(p.ones) || 1)); room.onesLocked = true; }
      if ('pattern' in p && ['downup', 'updown', 'down', 'up'].includes(p.pattern)) c.pattern = p.pattern;
      if ('bonus' in p) c.bonus = [0, 1, 5, 10].includes(Number(p.bonus)) ? Number(p.bonus) : c.bonus;
      if ('miss' in p && p.miss in G.MISS_RULES) c.miss = p.miss;
      if ('screw' in p) c.screw = !!p.screw;
      if ('trump' in p) c.trump = !!p.trump;
      if ('deck' in p && ['physical', 'virtual'].includes(p.deck)) c.deck = p.deck;
      if ('accoladePay' in p) {
        c.accoladePay = [0, 5, 10, 20].includes(Number(p.accoladePay)) ? Number(p.accoladePay) : c.accoladePay;
      }
      if ('accoladeCount' in p) {
        const k = Math.round(Number(p.accoladeCount));
        if (Number.isFinite(k) && k >= 0 && k <= 6) c.accoladeCount = k;
      }
      if ('firstDealer' in p) {
        room.firstDealerId = (p.firstDealer && seatIndex(room, p.firstDealer) >= 0) ? p.firstDealer : null;
      }
      return broadcast(room);
    }

    case 'seatMove': {
      if (!boss || room.phase !== 'lobby') return fail(ws, 'not allowed now');
      const i = seatIndex(room, m.id);
      const j = i + (m.dir === 'up' ? -1 : 1);
      if (i < 0 || j < 0 || j >= n) return;
      const tmp = room.seats[i]; room.seats[i] = room.seats[j]; room.seats[j] = tmp;
      return broadcast(room);
    }

    case 'kick': {
      if (!boss || room.phase !== 'lobby') return fail(ws, 'not allowed now');
      const i = seatIndex(room, m.id);
      if (i < 0) return;
      room.seats.splice(i, 1);
      syncCfg(room);
      room.sockets.forEach((w) => { if (w.ctx && w.ctx.seatId === m.id) send(w, { t: 'kicked' }); });
      return broadcast(room);
    }

    case 'captain': {
      if (!boss) return fail(ws, 'only the table host can pass it on');
      if (seatIndex(room, m.id) < 0) return fail(ws, 'no such seat');
      room.captainId = m.id;
      return broadcast(room);
    }

    case 'start': {
      if (!boss) return fail(ws, 'only the table host starts the game');
      if (room.phase !== 'lobby') return fail(ws, 'already started');
      if (n < 2) return fail(ws, 'you need at least 2 players');
      syncCfg(room);
      const first = Math.max(0, seatIndex(room, room.firstDealerId));
      room.rounds = G.buildRounds(room.cfg, n, first);
      newGame(room);
      room.idx = 0;
      room.rounds[0].bids = Array(n).fill(null);
      room.phase = 'bid';
      room.play = null;
      unfinish(room);
      if (virtual(room)) dealHands(room);
      return broadcast(room);
    }

    case 'trump': {
      if (!r) return;
      if (virtual(room)) return fail(ws, 'the deck turns the trump on this table');
      if (!boss && mySeat !== r.dealer) return fail(ws, 'the table host or the dealer sets the trump');
      const ok = G.SUITS.some((s) => s.k === m.k);
      r.trump = (m.k === null || r.trump === m.k) ? null : (ok ? m.k : r.trump);
      return broadcast(room);
    }

    case 'bid': {
      if (room.phase !== 'bid' || !r) return fail(ws, 'not bidding now');
      if (mySeat < 0) return fail(ws, 'only players bid');
      const turn = G.turnSeat(r, n);
      // The last bidder may still change, until the player after them bids.
      const amender = G.changeableSeat(r, n);
      if (mySeat !== turn && mySeat !== amender) {
        return fail(ws, r.bids[mySeat] !== null
          ? 'too late to change your bid'
          : `it is ${room.seats[turn].name}'s turn to bid`);
      }
      const v = Number(m.v);
      if (!Number.isInteger(v) || v < 0 || v > r.cards) return fail(ws, 'bid out of range');
      const forbidden = G.forbiddenBid(r, mySeat, room.cfg, n);
      if (forbidden !== null && v === forbidden) return fail(ws, `the bids must not total ${r.cards}`);
      r.bids[mySeat] = v;
      if (G.turnSeat(r, n) === null) {
        room.phase = 'tricks';
        if (virtual(room)) startPlay(room);
      }
      return broadcast(room);
    }

    case 'tricks': {
      if (virtual(room)) return fail(ws, 'the cards count themselves on this table');
      if (room.phase !== 'tricks' || !r) return fail(ws, 'not counting tricks now');
      if (!boss && mySeat !== r.dealer) return fail(ws, 'the dealer enters the tricks');
      const v = Array.isArray(m.values) ? m.values.map(Number) : [];
      if (v.length !== n || v.some((x) => !Number.isInteger(x) || x < 0 || x > r.cards)) return fail(ws, 'bad trick counts');
      const sum = v.reduce((a, b) => a + b, 0);
      if (sum !== r.cards) return fail(ws, `the tricks must total ${r.cards}, not ${sum}`);
      scoreRound(room, v);
      return broadcast(room);
    }

    // A card. Everything about whether it may be played is decided here.
    case 'play': {
      if (!virtual(room)) return fail(ws, 'this table plays with real cards');
      if (room.phase !== 'tricks' || !r || !room.play) return fail(ws, 'no hand in play');
      if (mySeat < 0) return fail(ws, 'only the players hold cards');
      return playCard(ws, room, mySeat, String(m.card || ''));
    }

    // A phone has gone: the table would sit there for ever, so whoever runs
    // the table can make that seat play. The server picks, and only from the
    // cards the rules allow, so nobody chooses another player's card.
    case 'playfor': {
      if (!virtual(room)) return fail(ws, 'this table plays with real cards');
      if (!boss) return fail(ws, 'only the table host can play for a seat');
      if (room.phase !== 'tricks' || !room.play) return fail(ws, 'no hand in play');
      const p = room.play.turn;
      if (p === null) return fail(ws, 'nobody is on play');
      if (room.seats[p].online) return fail(ws, `${room.seats[p].name} is here and can play`);
      const led = room.play.trick.length ? G.suitOf(room.play.trick[0].card) : null;
      const can = G.legalPlays(room.play.hands[p], led);
      return playCard(ws, room, p, can[Math.floor(Math.random() * can.length)]);
    }

    case 'bumdeal': {
      if (room.phase !== 'bid' && room.phase !== 'tricks') return fail(ws, 'no hand to throw in');
      const isDealer = mySeat >= 0 && r && mySeat === r.dealer;
      if (boss || isDealer) { bumDeal(room); return broadcast(room); }
      if (mySeat < 0) return fail(ws, 'only the table can call a bum deal');
      if (room.vote && room.vote.round === room.idx) {          // already asked: count as a yes
        if (!room.vote.yes.includes(mySeat)) room.vote.yes.push(mySeat);
      } else {
        room.vote = { kind: 'bumdeal', by: mySeat, round: room.idx, yes: [mySeat], no: [] };
      }
      if (room.vote.yes.length >= n) bumDeal(room);
      return broadcast(room);
    }

    case 'vote': {
      if (!room.vote || room.vote.round !== room.idx) return;    // nothing to answer
      if (mySeat < 0) return fail(ws, 'only players vote');
      const v = room.vote;
      v.yes = v.yes.filter((i) => i !== mySeat);
      v.no = v.no.filter((i) => i !== mySeat);
      if (m.agree) v.yes.push(mySeat); else v.no.push(mySeat);
      if (v.no.length > 0) room.vote = null;                     // one no ends it
      else if (v.yes.length >= n) bumDeal(room);
      return broadcast(room);
    }

    case 'votecancel': {
      if (!room.vote) return;
      if (!boss && mySeat !== room.vote.by) return fail(ws, 'only the table host or the player who asked can cancel');
      room.vote = null;
      return broadcast(room);
    }

    case 'undo': {
      if (!boss) return fail(ws, 'only the table host can go back');
      room.vote = null;
      unfinish(room);
      if (room.phase === 'done') {
        room.idx = room.rounds.length - 1;
        room.rounds[room.idx].tricks = null;
        room.phase = 'tricks';
      } else if (room.phase === 'tricks') {
        room.rounds[room.idx].bids = Array(n).fill(null);
        room.phase = 'bid';
      } else if (room.phase === 'bid' && room.idx > 0) {
        room.rounds[room.idx].bids = null;
        room.idx -= 1;
        room.rounds[room.idx].tricks = null;
        room.phase = 'tricks';
      } else return fail(ws, 'nothing to undo');
      if (virtual(room)) {              // those cards are gone: deal that hand again
        room.rounds[room.idx].tricks = null;
        room.rounds[room.idx].bids = Array(n).fill(null);
        room.phase = 'bid';
        dealHands(room);
      }
      return broadcast(room);
    }

    case 'reset': {
      if (!boss) return fail(ws, 'only the table host can reset');
      room.phase = 'lobby';
      room.vote = null;
      room.rounds = [];
      room.idx = 0;
      room.play = null;
      unfinish(room);
      syncCfg(room);
      return broadcast(room);
    }

    default: return fail(ws, 'unknown message');
  }
}

/* ---------------- upkeep ---------------- */

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

setInterval(() => {                       // drop idle rooms after 6 hours
  const cutoff = Date.now() - 6 * 3600e3;
  rooms.forEach((room, code) => {
    if (room.sockets.size === 0 && room.lastSeen < cutoff) rooms.delete(code);
  });
}, 600000);

// HOST pins the listening address. Unset, Node takes every address, IPv6 and
// IPv4 both; HOST=0.0.0.0 is the IPv4-only fallback for a device that will
// not do the dual-stack bind.
server.listen({ port: PORT, host: process.env.HOST || undefined }, async () => {
  await refreshLanAddress();               // the banner should carry it too
  setInterval(refreshLanAddress, 60000).unref();
  console.log(`Up the River, Down the River — table server (${SCHEME})`);
  console.log(`  host screen:  ${SCHEME}://localhost:${PORT}/host.html`);
  console.log(`  players join: ${SCHEME}://localhost:${PORT}/`);
  const advertised = process.env.PUBLIC_URL ? 'players join at' : 'on this network';
  const urls = lanUrls();
  urls.forEach((u) => console.log(`  ${advertised}: ${u}/`));
  if (process.env.PUBLIC_URL) console.log('  PUBLIC_URL is set, so this machine\'s own addresses are not offered');
  if (!urls.length) {
    console.log(hiddenNets
      ? '  this device hides its network addresses from apps (Android does), so none can be shown.'
      : '  no network address was found on this device.');
    console.log('  To find it: on a phone that has joined this network, open the Wi-Fi details;');
    console.log(`  the "router" or "gateway" address is this device. Players join at ${SCHEME}://<that address>:${PORT}/`);
    console.log(`  Start with PUBLIC_URL=${SCHEME}://<that address>:${PORT} and the QR code will carry it.`);
    console.log('  If phones still cannot connect, start with HOST=0.0.0.0 as well.');
  }
  if (!tls) console.log('  note: phones keep the screen awake only over https. Run "npm run cert" and restart.');
  if (DEV) console.log('  live reload is on: a change under public/ reloads every open page');
});
