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
const TrailOf = require('./lib/trail.js');
const ReplayOf = require('./lib/replay.js');

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
// How big one table's trail of what happened may get before it stops being
// written. A whole game is about ninety kilobytes; past this something has gone
// wrong, and the table matters more than the note of it.
const TRAIL_MAX = Math.max(64 * 1024, Number(process.env.TRAIL_MAX) || 4 * 1024 * 1024);
/* The beat between two points of a replay, and the longer one a scored round is
   left up for. The beats a hand itself is built around -- the bids standing to
   be read, a finished trick sitting on the table -- are borrowed rather than
   named again, so a game watched again keeps the timing of the game. */
const REPLAY_STEP = Math.max(20, Number(process.env.REPLAY_STEP) || 700);
const REPLAY_HOLD = Math.max(20, Number(process.env.REPLAY_HOLD) || 2300);
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

// What happened to each of them, written down as it happens, in a file of its
// own: a table's record is rewritten whole every time, and a trail is appended.
const Trail = TrailOf({ DATA, KEEP_HOURS, KEEP_GAMES, TRAIL_MAX, record: Tables.record });
Trail.sweep();

// The pages, the QR code, the addresses, a finished game, a picture. It reads
// the rooms for a picture and knows nothing else about a game.
const { handler, lanUrls, hiddenNets, refreshLanAddress } = Http({
  PORT, SCHEME, DEV, ROOT, PUB, pictureOf, readGame, listGames, listTables, endTable,
});

// The socket server rides on this one, so both answer on the same port.
const server = tls ? https.createServer(tls, handler) : http.createServer(handler);

/* A table the machine that runs the server has done with. Not a game ending --
   nothing is scored and nothing is filed -- the table itself is taken away:
   every screen at it is told so and lets it go, the bots stop, and the file it
   would have come back from is removed. */
function endTable(code) {
  const room = roomOf(code);
  if (!room) return false;
  Bots.stop(room);
  // The line every page already knows: it forgets the table and walks away.
  room.sockets.forEach((ws) => { if (ws.readyState === 1) fail(ws, 'that table is gone'); });
  rooms.delete(room.code);
  Tables.forget(room.code);
  Trail.forget(room.code);
  sayBusy();
  return true;
}

/* Every table this server is running, newest first, for the machine it runs
   on. The phone that hosts has one page for all of them: a seat it holds is
   rejoined, a table it holds no seat at is watched. Names and seat ids only --
   the tokens that make a seat yours never leave the server. */
function listTables() {
  return Array.from(rooms.values())
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
    .map((room) => ({
      code: room.code,
      phase: room.phase,
      cards: (curRound(room) || {}).cards || null,
      round: room.phase === 'lobby' || room.phase === 'done' ? null : room.idx + 1,
      rounds: room.rounds.length || null,
      stand: !!room.stand,
      replay: room.replay ? room.replay.of : null,
      seats: room.seats.map((s) => ({ id: s.id, name: s.name, bot: !!s.bot,
                                      left: !!s.left, online: !!s.online })),
    }));
}

// The one thing the HTTP side needs of a room: a seat's picture, or nothing.
function pictureOf(code, seatId) {
  const room = roomOf(code);
  const seat = room && room.seats.find((x) => x.id === seatId);
  return (seat && seat.av) || null;
}

/* ---------------- what a socket is told ---------------- */

// The two smallest verbs on a socket, and everything uses them: they are
// declared before anything that could ask.
function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
// A bot plays through the same door as a phone and has no socket to be told on.
/* Every refusal leaves here, so this is where it is made a sentence: a
   capital and a full stop, the same voice the pages use, whichever file the
   words came from. */
function sentence(s) {
  const t = String(s || '').trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.');
}
function fail(ws, msg) { if (ws) send(ws, { t: 'error', msg: sentence(msg) }); }

/* ---------------- rooms ---------------- */

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
const rooms = new Map();
const token = () => crypto.randomBytes(12).toString('hex');

// Every way in names a table by its code, and a code is typed by people. One
// trim and one case for all of them, so no door is fussier than another.
const roomOf = (code) => rooms.get(String(code || '').toUpperCase().trim());

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
/* A game filed keeps the trail of how it was played beside its scorecard. The
   table plays on and starts a fresh trail at its next game, so this copy is the
   only one that outlives it. */
const Room = RoomOf({ G, A, token, DEV, Trail,
                      saveGame: (room) => { if (room.replay) return; saveGame(room); Trail.keep(room); } });
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
    // Only a deck dealt on the phones has hands to give; the count a table
    // with real cards keeps in the same place has none.
    const seat = (room.play && room.play.hands && ws.ctx && ws.ctx.seatId) ? seatIndex(room, ws.ctx.seatId) : -1;
    if (seat < 0) { ws.send(shared); return; }
    base.hand = room.play.hands[seat];
    ws.send(JSON.stringify(base));
  });
  delete base.hand;
  // A table in play outlives the server it is on: this is the one moment
  // something about it has changed, so this is where it is written down.
  Tables.save(room);
  // And what happened on the way to it, appended to a file of its own.
  Trail.flush(room);
  // Somebody is at this table, or has just left it. Whoever is holding the
  // machine awake for the table wants to know either way.
  sayBusy();
  // Whoever is on play now, this is where a bot finds out it is them.
  Bots.nudge(room);
  // And if the bids have just gone up to be read, this is where the beat
  // before the first card is started.
  holdBids(room);
}

/* The bids are in and the table is reading them. The hold itself is the
   room's; ending it is here, beside the trick hold, and like that one it
   re-checks the table it was armed for: a bum deal or a seat going can move
   the game on while it runs. */
function holdBids(room) {
  if (room.replay) return;          // a replay has one clock, and it is not this one
  if (room.bidTimer || !G.bidsHeld(room)) return;
  const tag = room.play, at = room.idx;
  room.bidTimer = setTimeout(() => {
    room.bidTimer = null;
    if (room.play !== tag || room.idx !== at) return;      // the game moved on
    if (Room.openPlay(room)) broadcast(room);
  }, Room.BID_HOLD);
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
    if (G.virtual(room) && room.phase === 'tricks' && room.play && room.play.turn === null && room.play.last) {
      Deck.settleTrick(room, room.play.last.winner);
    }
    // The same for bids that were up to be read: they have been read by now.
    Room.openPlay(room);
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
  /* Somebody is at this table who is not playing at it: a TV screen, a screen
     showing it, a watching window, the dev page. The rules ask this to decide
     whether a table of bots plays on, so it is put on the room as a plain fact
     -- game.js is not given a set of sockets to pick through. */
  room.seen = Array.from(room.sockets).some((w) => w.ctx && w.ctx.role !== 'player');
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

/* A game put back on a table of its own, from what was written down about it.
   It knows only the room's verbs: a replayed table is one the rules could have
   reached, and that is the point of it. */
const Replay = ReplayOf({ Room, G, token });

/* How long the table would have taken over the thing that just happened. The
   two real holds are the game's own; the other two are the replay's. */
function replayBeat(room, ev) {
  if (!ev) return REPLAY_STEP;
  if (ev.k === 'w') return Deck.TRICK_HOLD;              // the trick sits to be read
  if (ev.k === 'e' || ev.k === 'E') return REPLAY_HOLD;  // and a score longer still
  if (room.play && room.play.held) return Room.BID_HOLD; // the bids stand before the hand
  return REPLAY_STEP;
}

/* A replay playing itself, one point at a time. The timer is the copy's own --
   nothing else on it has a clock -- and it looks again when it fires, because
   the copy may have been moved or let go in the meantime. */
function replayTick(room) {
  const tag = room.replay;
  if (!tag || !tag.playing) return;
  if (tag.at >= tag.n - 1) { tag.playing = false; return broadcast(room); }
  const ev = tag.points[tag.at + 1];
  Replay.step(room, 1);
  broadcast(room);
  if (room.replay !== tag || !tag.playing) return;
  room.replayTimer = setTimeout(() => {
    room.replayTimer = null;
    if (room.replay !== tag || !tag.playing) return;
    replayTick(room);
  }, replayBeat(room, ev)).unref();
}

// Playing, or stopped where it stands.
function paceReplay(room, on) {
  if (room.replayTimer) { clearTimeout(room.replayTimer); room.replayTimer = null; }
  if (!room.replay) return;
  room.replay.playing = !!on;
  if (on) replayTick(room);
}

/* A copy of a table, let go. Nothing is filed and nothing is told: it was
   never a game, and every screen at it is the page that opened it. */
function dropRoom(code) {
  const room = roomOf(code);
  if (!room) return;
  paceReplay(room, false);
  Bots.stop(room);
  room.sockets.forEach((ws) => { if (ws.ctx) ws.ctx.room = null; });
  rooms.delete(room.code);
}

// The dev controls. Nothing here is reachable unless a 'dev' message asks for
// it, and the half that invents data answers only a table of stand-ins.
const { handleDev, devHello } = Dev({
  DEV, G, createRoom, roomOf, listTables, endTable, attach, send, fail, broadcast, setAvatar,
  Room, Tables, Bots, Trail, Replay, dropRoom, paceReplay,
});

// Every message a seated socket may send, and who may send it, as a table.
const { handleTable } = Messages({
  DEV, CHAT_KEEP, G, A, send, fail, broadcast, Room, playCard, markPresence,
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
    /* A copy of a table belongs to the page watching it. With that page gone
       there is nobody it could be for, and nothing on disk to come back to. */
    if (room.replay && room.sockets.size === 0) { rooms.delete(room.code); return; }
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
    const room = roomOf(m.code);
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
      if (held.bot) return fail(ws, `${held.name} is a bot`);
      if (held.online) return fail(ws, `${held.name} is already at the table`);
      if (held.left) return fail(ws, `${held.name} left the game, so auto-play has that hand`);
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
    const room = roomOf(m.code);
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
    const room = roomOf(m.code);
    if (!room) return fail(ws, 'no table with that code');
    attach(ws, room, { role: 'screen' });
    send(ws, { t: 'hello', role: 'screen', code: room.code, token: null });
    return broadcast(room);
  }

  // A window that shows one seat's screen. It is the same page the player has,
  // off the same state, but it cannot touch the game and it does not count as
  // that player being at the table.
  if (m.t === 'watch') {
    const room = roomOf(m.code);
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

/* Whether anybody is at a table on this server, for whoever is holding the
   machine awake on its behalf. The phone app takes a wake lock so the table
   keeps answering with the screen off, and a table nobody is at does not need
   one: it would hold the phone awake all night for a game that ended hours
   ago. Written to BUSY_FILE, and only when the answer changes.

   A socket that has just gone does not make a table idle. A phone whose
   network drops is coming back in a moment, and the table must not go to
   sleep underneath it, so the last change to any table counts for a while
   after it. */
const BUSY_FILE = process.env.BUSY_FILE || '';
const BUSY_QUIET = Math.max(0, Number(process.env.BUSY_QUIET_MS) || 5 * 60e3);
let saidBusy = null;
function sayBusy() {
  if (!BUSY_FILE) return;
  let newest = 0;
  rooms.forEach((room) => { if (room.lastSeen > newest) newest = room.lastSeen; });
  const busy = wss.clients.size > 0 || (Date.now() - newest) < BUSY_QUIET;
  if (busy === saidBusy) return;
  saidBusy = busy;
  try { fs.writeFileSync(BUSY_FILE, busy ? '1' : '0'); }
  catch (e) { console.warn('[busy] cannot say whether the table is in use:', e.message); }
}
// Often enough that a table wakes up promptly, rarely enough to be nothing.
setInterval(sayBusy, Math.max(200, Math.min(30000, Math.round(BUSY_QUIET / 2)))).unref();
sayBusy();

setInterval(() => {                       // drop idle rooms, memory and disk alike
  const cutoff = Date.now() - KEEP_HOURS * 3600e3;
  rooms.forEach((room, code) => {
    if (room.sockets.size === 0 && room.lastSeen < cutoff) {
      Bots.stop(room);
      rooms.delete(code);
      Tables.forget(code);
      Trail.forget(code);
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
