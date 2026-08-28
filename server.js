'use strict';
/* Up the River, Down the River — table server.
   One host screen per room. Players join on their phones and bid in turn. */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const G = require('./game.js');
const A = require('./public/accolades.js');
const Games = require('./lib/games.js');
const TablesOf = require('./lib/tables.js');
const Http = require('./lib/http.js');
const Dev = require('./lib/dev.js');
const Messages = require('./lib/messages.js');
const RoomOf = require('./lib/room.js');

const PORT = Number(process.env.PORT) || 8787;
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
// A phone only gets the screen lock (and other secure-context features) over
// https. Drop a key and certificate in certs/ (npm run cert) to serve https.
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const KEEP_GAMES = Math.max(1, Number(process.env.KEEP_GAMES) || 200);
// How long a table nobody has touched is kept -- in memory, and on the disk it
// is read back from. One rule, so a table cannot be dropped from one and held
// by the other.
const KEEP_HOURS = Math.max(0, Number(process.env.KEEP_HOURS) || 6);
// How many lines of table talk a table keeps. Long enough to scroll back
// through a game, short enough that every state carries it without a thought.
const CHAT_KEEP = Math.max(1, Number(process.env.CHAT_KEEP) || 100);
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
const { saveGame, readGame, listGames } = Games({ DATA, KEEP_GAMES, G });

// And the tables still in play, so that stopping this server does not end them.
const Tables = TablesOf({ DATA, KEEP_HOURS });

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
function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
// A bot plays through the same door as a phone and has no socket to be told on.
function fail(ws, msg) { if (ws) send(ws, { t: 'error', msg }); }

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

// The table as the game sees it: every verb that moves a game on, written
// once. The server adds the sockets, the presence, and the telling.
const Room = RoomOf({ G, A, token, saveGame, DEV });
const { curRound, seatIndex, Deck } = Room;

function createRoom() {
  const room = Room.create(newCode(), token());
  rooms.set(room.code, room);
  return room;
}

// A hand is a secret, so each socket gets the table plus its own cards. A
// screen with no seat -- the host screen -- gets the table alone.
function broadcast(room) {
  room.lastSeen = Date.now();
  const base = Room.publicState(room);
  const shared = JSON.stringify(base);
  room.sockets.forEach((ws) => {
    if (ws.readyState !== 1) return;
    const seat = (room.play && ws.ctx && ws.ctx.seatId) ? seatIndex(room, ws.ctx.seatId) : -1;
    if (seat < 0) { ws.send(shared); return; }
    base.hand = room.play.hands[seat];
    ws.send(JSON.stringify(base));
  });
  delete base.hand;
  // A table in play outlives the server it is on: this is the one moment
  // something about it has changed, so this is where it is written down.
  Tables.save(room);
  // Whoever is on play now, this is where a bot finds out it is them.
  Bots.nudge(room);
}

/* The tables this machine had when it was last up. A phone that hosts a game
   is stopped and started again -- from its own notification, or by Android --
   and every seat at that table is held on another phone with nothing to come
   back to unless the table comes back too. */
function restore() {
  Tables.all().forEach((rec) => {
    if (rooms.has(rec.code)) return;
    const room = Object.assign(Room.create(rec.code, rec.hostToken), rec, { sockets: new Set() });
    // Nobody is at the table until they connect to this server. A bot never
    // went anywhere.
    room.seats.forEach((s) => { s.online = !!s.bot; });
    /* A trick was being held up for the table to read when the server stopped.
       It has been read by now, so the table moves on rather than sitting on a
       hold that nothing is left to end. */
    if (room.phase === 'tricks' && room.play && room.play.turn === null && room.play.last) {
      Deck.settleTrick(room, room.play.last.winner);
    }
    rooms.set(room.code, room);
  });
}
restore();

function markPresence(room) {
  room.seats.forEach((s) => {
    // A bot never goes anywhere, so it is never away.
    s.online = s.bot || (!s.left && Array.from(room.sockets).some(
      (w) => w.ctx && w.ctx.seatId === s.id && w.ctx.role !== 'watch'));
  });
}

/* One card, from a phone or from a bot. The deck says whether it may go and
   moves it; this is where a full trick is held up long enough for the table
   to read it before the winner leads. */
function playCard(ws, room, p, card) {
  const why = Deck.refusal(room, p, card);
  if (why) return fail(ws, why);
  const winner = Deck.putCard(room, p, card);
  if (winner !== null) {
    const tag = room.play, at = room.idx;
    setTimeout(() => {
      if (room.play !== tag || room.idx !== at) return;      // the game moved on
      Deck.settleTrick(room, winner);
      broadcast(room);
    }, Deck.TRICK_HOLD);
  }
  return broadcast(room);
}

// The players the table provides. They hold cards like everybody else and go
// through the same rules; all the server does is take their turn for them.
const Bots = require('./lib/bots.js')({
  G, curRound, broadcast, seatBid: Room.seatBid, playCard, bumDeal: Room.bumDeal,
});

// The dev controls. Nothing here is reachable unless a 'dev' message asks for
// it, and the half that invents data answers only a table of stand-ins.
const { handleDev, devHello } = Dev({
  DEV, G, createRoom, attach, send, fail, broadcast, setAvatar, Room,
});

// Every message a seated socket may send, and who may send it, as a table.
const { handleTable } = Messages({
  DEV, CHAT_KEEP, G, send, fail, broadcast, Room, playCard, markPresence,
  addBot: (room) => Room.addBot(room, Bots.botName(room)),
  bidValue: Bots.bidFor,
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
    const name = String(m.name || '').trim().slice(0, 16) || `Player ${room.seats.length + 1}`;
    const held = room.seats.find((s) => s.name.toLowerCase() === name.toLowerCase());

    /* The game has started, so there is no new seat to be had. There is one
       way in: back into your own. A phone that lost its seat -- a flat
       battery, a browser that forgot, a second table on the same phone -- has
       nothing but the code and the name it played under, and that is enough.
       A seat somebody is sitting in is never handed over. */
    if (room.phase !== 'lobby') {
      if (!held) return fail(ws, 'that game has already started. To come back to your seat, type the name you played under');
      if (held.bot) return fail(ws, `${held.name} is a player the table provides`);
      if (held.online) return fail(ws, `${held.name} is already at the table`);
      if (held.left) return fail(ws, `${held.name} left the game, so the table is playing that hand`);
      if (!Room.waitingOn(room, seatIndex(room, held.id))) {
        return fail(ws, `the game has gone on without ${held.name}. Only the phone that holds that seat can come back to it`);
      }
      attach(ws, room, { role: 'player', seatId: held.id });
      send(ws, { t: 'hello', role: 'player', code: room.code, token: held.token, seatId: held.id });
      return broadcast(room);
    }

    if (room.seats.length >= 8) return fail(ws, 'the table is full');
    if (held) return fail(ws, 'that name is taken');
    const seat = Room.seat(name);
    room.seats.push(seat);
    if (!room.captainId) room.captainId = seat.id;      // first in, table host
    Room.syncCfg(room);
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
    seat.left = false;                       // whoever left has come back to it
    attach(ws, room, { role: 'player', seatId: seat.id });
    send(ws, { t: 'hello', role: 'player', code: room.code, token: seat.token, seatId: seat.id });
    return broadcast(room);
  }

  /* A screen that shows a table: the scorecard, the deal, whose turn it is.
     It holds no seat and no token, so it cannot touch the game and nobody at
     the table becomes present because of it. A code is all it needs: the state
     it is given is the state already on show. */
  if (m.t === 'screen') {
    const room = rooms.get(String(m.code || '').toUpperCase().trim());
    if (!room) return fail(ws, 'no table with that code');
    attach(ws, room, { role: 'screen' });
    send(ws, { t: 'hello', role: 'screen', code: room.code, token: null });
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
  if (ctx.role === 'screen' && m.t !== 'ping') return fail(ws, 'this screen only shows the table');
  const mySeat = ctx.seatId ? seatIndex(room, ctx.seatId) : -1;
  // The table host is a player with the same powers as the host screen, so a
  // game can run with no host screen at all.
  const isCaptain = mySeat >= 0 && room.seats[mySeat].id === room.captainId;
  const boss = isHost || isCaptain;
  const r = curRound(room);

  return handleTable(ws, m, { ws, room, n, r, mySeat, boss, isHost, ctx });
}

/* ---------------- upkeep ---------------- */

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

setInterval(() => {                       // drop idle rooms, memory and disk alike
  const cutoff = Date.now() - KEEP_HOURS * 3600e3;
  rooms.forEach((room, code) => {
    if (room.sockets.size === 0 && room.lastSeen < cutoff) {
      Bots.stop(room);
      rooms.delete(code);
      Tables.forget(code);
    }
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
