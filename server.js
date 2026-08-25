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
const Games = require('./lib/games.js');
const Http = require('./lib/http.js');
const Deck = require('./lib/deck.js');
const Dev = require('./lib/dev.js');

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

/* ---------------- what the browser asks for ---------------- */

// Finished games on disk. It knows where they go and how many are kept.
const { gameRecord, saveGame, readGame, listGames } = Games({ DATA, KEEP_GAMES, G });

// The pages, the QR code, the addresses, a finished game, a picture. It reads
// the rooms for a picture and knows nothing else about a game.
const { handler, lanUrls, hiddenNets, refreshLanAddress } = Http({
  PORT, SCHEME, DEV, ROOT, PUB, pictureOf, readGame, listGames,
});

// The socket server rides on this one, so both answer on the same port.
const server = tls ? https.createServer(tls, handler) : http.createServer(handler);

// The one thing the HTTP side needs of a room: a seat's picture, or nothing.
function pictureOf(code, seatId) {
  const room = rooms.get(String(code || '').toUpperCase());
  const seat = room && room.seats.find((x) => x.id === seatId);
  return (seat && seat.av) || null;
}

/* ---------------- what a socket is told ---------------- */

// The two smallest verbs on a socket, and everything uses them: they are
// declared before anything that could ask.
function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function fail(ws, msg) { send(ws, { t: 'error', msg }); }

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
function curRound(room) { return room.rounds[room.idx] || null; }

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

// The dealer, when the table plays with no real cards. It holds the hands and
// the rules of a trick; scoring a finished round is the table's own business,
// so it hands that back.
const { TRICK_HOLD, virtual, dealHands, startPlay, playPublic, playCard } = Deck({
  G, curRound, broadcast, fail, scoreRound,
});

// The dev controls. Nothing here is reachable unless a 'dev' message asks for
// it, and the half that invents data answers only a table of stand-ins.
const { handleDev, devHello } = Dev({
  DEV, G, A, token, createRoom, attach, send, fail, broadcast, seatIndex, curRound,
  syncCfg, newGame, unfinish, setAvatar, virtual, dealHands, startPlay, scoreRound,
  finishGame,
});

/* ---------------- socket protocol ---------------- */

const wss = new WebSocketServer({ server, path: '/ws' });



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

  if (m.t === 'dev') return handleDev(ws, m);

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
