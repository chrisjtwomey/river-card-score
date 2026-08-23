'use strict';
/* Up the River, Down the River — table server.
   One host screen per room. Players join on their phones and bid in turn. */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const qrcode = require('qrcode-generator');
const G = require('./game.js');

const PORT = Number(process.env.PORT) || 8787;
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
// A phone only gets the screen lock (and other secure-context features) over
// https. Drop a key and certificate in certs/ (npm run cert) to serve https.
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
function lanUrls() {
  const named = (process.env.PUBLIC_URL || '').split(',')
    .map((u) => u.trim().replace(/\/$/, '')).filter(Boolean);
  if (named.length) return Array.from(new Set(named));

  const out = [];
  const nets = os.networkInterfaces();
  Object.values(nets).forEach((list) => (list || []).forEach((ni) => {
    if (ni.family === 'IPv4' && !ni.internal) out.push(`${SCHEME}://${ni.address}:${PORT}`);
  }));
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
  return {
    t: 'state',
    code: room.code,
    phase: room.phase,
    cfg: room.cfg,
    seats: room.seats.map((s) => ({ id: s.id, name: s.name, online: s.online })),
    firstDealerId: room.firstDealerId,
    captainId: room.captainId,
    rounds: room.rounds,
    idx: room.idx,
    turn: (room.phase === 'bid' && r) ? G.turnSeat(r, n) : null,
    vote: (room.vote && room.vote.round === room.idx) ? room.vote : null,
    totals: n ? G.totals(room.cfg, room.rounds, n) : [],
  };
}

function broadcast(room) {
  room.lastSeen = Date.now();
  const msg = JSON.stringify(publicState(room));
  room.sockets.forEach((ws) => { if (ws.readyState === 1) ws.send(msg); });
}

function markPresence(room) {
  room.seats.forEach((s) => {
    s.online = Array.from(room.sockets).some((w) => w.ctx && w.ctx.seatId === s.id);
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
  return true;
}

/* ---------------- dev controls (DEV=1 only) ---------------- */

const DEV_NAMES = ['Amy', 'Hugh', 'Joe', 'Nia', 'Owen', 'Pia', 'Rhys', 'Sian'];
const rand = (n) => Math.floor(Math.random() * n);

function devSeats(room, count) {
  room.seats = [];
  for (let i = 0; i < Math.max(2, Math.min(8, count)); i++) {
    room.seats.push({ id: token().slice(0, 8), name: DEV_NAMES[i], token: token(), online: false });
  }
  room.captainId = room.seats[0].id;
  room.firstDealerId = null;
  room.phase = 'lobby';
  room.rounds = [];
  room.idx = 0;
  room.vote = null;
  syncCfg(room);
}

function devStart(room) {
  const n = room.seats.length;
  syncCfg(room);
  const first = Math.max(0, seatIndex(room, room.firstDealerId));
  room.rounds = G.buildRounds(room.cfg, n, first);
  room.idx = 0;
  room.rounds[0].bids = Array(n).fill(null);
  room.phase = 'bid';
  room.vote = null;
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
}

function devFillTricks(room) {
  const r = curRound(room), n = room.seats.length;
  if (!r || !r.bids || r.bids.some((b) => b === null)) return;
  const out = Array(n).fill(0);
  for (let i = 0; i < r.cards; i++) out[rand(n)] += 1;
  r.tricks = out;
}

function devNextRound(room) {
  if (!room.rounds.length) { devStart(room); return; }
  if (room.phase === 'done') return;
  devFillBids(room);
  devFillTricks(room);
  room.vote = null;
  room.idx += 1;
  if (room.idx >= room.rounds.length) { room.idx = room.rounds.length; room.phase = 'done'; }
  else { room.rounds[room.idx].bids = Array(room.seats.length).fill(null); room.phase = 'bid'; }
}

function devEndGame(room) {
  if (!room.rounds.length) devStart(room);
  let guard = 60;
  while (room.phase !== 'done' && guard-- > 0) devNextRound(room);
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

// Force values the protocol would not allow, for looking at a screen.
function devPatch(room, p) {
  const n = room.seats.length;
  if (p.cfg) Object.assign(room.cfg, p.cfg);
  if (typeof p.idx === 'number' && room.rounds.length) {
    room.idx = Math.max(0, Math.min(p.idx, room.rounds.length));
    if (room.idx < room.rounds.length && !room.rounds[room.idx].bids) {
      room.rounds[room.idx].bids = Array(n).fill(null);
    }
  }
  if (p.phase) {
    room.phase = p.phase;
    if (p.phase === 'done') room.idx = room.rounds.length;
  }
  if (p.captainId && seatIndex(room, p.captainId) >= 0) room.captainId = p.captainId;
  if ('firstDealerId' in p) {
    room.firstDealerId = (p.firstDealerId && seatIndex(room, p.firstDealerId) >= 0) ? p.firstDealerId : null;
  }
  if (p.round && room.rounds[p.round.i]) {
    const r = room.rounds[p.round.i];
    if ('bids' in p.round) r.bids = p.round.bids;
    if ('tricks' in p.round) r.tricks = p.round.tricks;
    if ('trump' in p.round) r.trump = p.round.trump;
    if ('redeals' in p.round) r.redeals = Number(p.round.redeals) || 0;
  }
  if (p.vote === null) room.vote = null;
}

/* ---------------- socket protocol ---------------- */

const wss = new WebSocketServer({ server, path: '/ws' });

const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
const fail = (ws, msg) => send(ws, { t: 'error', msg });

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

  // The dev page: makes a table of stand-ins and forces it into a state.
  if (m.t === 'dev') {
    if (!DEV) return fail(ws, 'the dev controls need the server started with DEV=1');
    let room = ws.ctx && ws.ctx.room;
    if (m.action === 'setup' || !room) {
      room = room && m.action !== 'setup' ? room : createRoom();
      attach(ws, room, { role: 'host' });
      devSeats(room, Number(m.players) || 4);
      send(ws, { t: 'hello', role: 'host', code: room.code, token: room.hostToken, dev: true,
                 seats: room.seats.map((x) => ({ id: x.id, name: x.name, token: x.token })) });
      return broadcast(room);
    }
    switch (m.action) {
      case 'players': devSeats(room, Number(m.players) || 4); break;
      case 'startGame': devStart(room); break;
      case 'fillBids': devFillBids(room); break;
      case 'fillTricks': devFillTricks(room); break;
      case 'nextRound': devNextRound(room); break;
      case 'endGame': devEndGame(room); break;
      case 'lobby': room.phase = 'lobby'; room.rounds = []; room.idx = 0; room.vote = null; break;
      case 'bumVote': devBumVote(room); break;
      case 'randomise': devRandomise(room); break;
      case 'patch': devPatch(room, m.patch || {}); break;
      default: return fail(ws, 'unknown dev action');
    }
    // the seat tokens go back every time, so the previews can re-open
    send(ws, { t: 'hello', role: 'host', code: room.code, token: room.hostToken, dev: true,
               seats: room.seats.map((x) => ({ id: x.id, name: x.name, token: x.token })) });
    return broadcast(room);
  }

  if (m.t === 'join') {
    const room = rooms.get(String(m.code || '').toUpperCase().trim());
    if (!room) return fail(ws, 'no table with that code');
    if (room.phase !== 'lobby') return fail(ws, 'that game has already started');
    if (room.seats.length >= 8) return fail(ws, 'the table is full');
    const name = String(m.name || '').trim().slice(0, 16) || `Player ${room.seats.length + 1}`;
    if (room.seats.some((s) => s.name.toLowerCase() === name.toLowerCase())) return fail(ws, 'that name is taken');
    const seat = { id: token().slice(0, 8), name, token: token(), online: true };
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

  /* --- everything below needs a room --- */
  const ctx = ws.ctx;
  if (!ctx || !ctx.room) return fail(ws, 'join a table first');
  const room = ctx.room;
  const n = room.seats.length;
  const isHost = ctx.role === 'host';
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
      room.idx = 0;
      room.rounds[0].bids = Array(n).fill(null);
      room.phase = 'bid';
      return broadcast(room);
    }

    case 'trump': {
      if (!r) return;
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
      if (G.turnSeat(r, n) === null) room.phase = 'tricks';
      return broadcast(room);
    }

    case 'tricks': {
      if (room.phase !== 'tricks' || !r) return fail(ws, 'not counting tricks now');
      if (!boss && mySeat !== r.dealer) return fail(ws, 'the dealer enters the tricks');
      const v = Array.isArray(m.values) ? m.values.map(Number) : [];
      if (v.length !== n || v.some((x) => !Number.isInteger(x) || x < 0 || x > r.cards)) return fail(ws, 'bad trick counts');
      const sum = v.reduce((a, b) => a + b, 0);
      if (sum !== r.cards) return fail(ws, `the tricks must total ${r.cards}, not ${sum}`);
      r.tricks = v;
      room.vote = null;
      room.idx += 1;
      if (room.idx >= room.rounds.length) { room.idx = room.rounds.length; room.phase = 'done'; }
      else { room.rounds[room.idx].bids = Array(n).fill(null); room.phase = 'bid'; }
      return broadcast(room);
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
      return broadcast(room);
    }

    case 'reset': {
      if (!boss) return fail(ws, 'only the table host can reset');
      room.phase = 'lobby';
      room.vote = null;
      room.rounds = [];
      room.idx = 0;
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

server.listen(PORT, () => {
  console.log(`Up the River, Down the River — table server (${SCHEME})`);
  console.log(`  host screen:  ${SCHEME}://localhost:${PORT}/host.html`);
  console.log(`  players join: ${SCHEME}://localhost:${PORT}/`);
  const advertised = process.env.PUBLIC_URL ? 'players join at' : 'on this network';
  lanUrls().forEach((u) => console.log(`  ${advertised}: ${u}/`));
  if (process.env.PUBLIC_URL) console.log('  PUBLIC_URL is set, so this machine\'s own addresses are not offered');
  if (!tls) console.log('  note: phones keep the screen awake only over https. Run "npm run cert" and restart.');
  if (DEV) console.log('  live reload is on: a change under public/ reloads every open page');
});
