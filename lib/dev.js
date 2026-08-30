'use strict';
/* The dev controls, and nothing a game needs.

   What the page may do follows the server, not the table. With DEV=1 every
   table gets every control -- one the page made of stand-ins, and one made by
   real players at the front door alike. On a normal server the host token
   opens the page on its own table with the state forcer alone, to put a game
   in play right; nothing there invents data.

   Either way it gets there through `open`: a code and the host token, or on a
   dev server the code alone. `tables` says what there is to open.

   Nothing here is reachable unless a message says so, and the inventing half
   answers only a table of stand-ins. Everything that moves a game on goes
   through the room's own verbs, so a state the dev page makes is a state a
   real game can reach.
*/
module.exports = ({ DEV, G, createRoom, roomOf, listTables, attach, send, fail, broadcast,
                   setAvatar, Room, Tables }) => {
  const { curRound, seatIndex, Deck } = Room;
  const DEV_NAMES = ['Amy', 'Hugh', 'Joe', 'Nia', 'Owen', 'Pia', 'Rhys', 'Sian'];
  const rand = (n) => Math.floor(Math.random() * n);

  function devSeats(room, count) {
    room.stand = true;            // a table of stand-ins, never a real game
    room.seats = [];
    for (let i = 0; i < Math.max(2, Math.min(8, count)); i++) {
      room.seats.push(Room.seat(DEV_NAMES[i], { online: false }));
    }
    room.captainId = room.seats[0].id;
    room.firstDealerId = null;
    Room.toLobby(room);
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
      Room.seatBid(room, p, choices[rand(choices.length)]);   // the last one closes the bidding
      p = G.turnSeat(r, n);
    }
    if (room.phase !== 'tricks') Room.closeBidding(room);    // a phase forced with the bids already in
  }

  // Play the hand out at once, through the deck's own rules but with no pause
  // between the tricks. Only the dev page does this: a real table watches
  // each trick land.
  function devPlayOut(room) {
    const r = curRound(room), n = room.seats.length, play = room.play;
    if (!play) return;
    Room.openPlay(room);                       // a table of stand-ins does not read the bids
    if (play.turn === null) play.turn = G.firstLeader(r, n);
    let guard = 400;
    while (guard-- > 0 && play.hands.some((h) => h.length)) {
      const p = play.turn;
      const can = G.legalPlays(play.hands[p], Deck.ledSuit(play));
      const winner = Deck.putCard(room, p, can[rand(can.length)]);
      if (winner !== null) Deck.settleTrick(room, winner);   // no hold on a table of stand-ins
    }
    if (room.play === play) Deck.settleTrick(room, play.turn);  // every card was down already
  }

  function devFillTricks(room) {
    const r = curRound(room), n = room.seats.length;
    if (!r || !r.bids || r.bids.some((b) => b === null)) return;
    if (G.virtual(room)) return devPlayOut(room);        // the cards decide, and score
    const out = Array(n).fill(0);
    for (let i = 0; i < r.cards; i++) out[rand(n)] += 1;
    r.tricks = out;
  }

  function devNextRound(room) {
    if (!room.rounds.length) { Room.startGame(room); return; }
    if (room.phase === 'done') return;
    const r = curRound(room);
    if (r && room.cfg.trump && !r.trump && !G.virtual(room)) r.trump = G.SUITS[rand(G.SUITS.length)].k;
    const at = room.idx;
    devFillBids(room);
    devFillTricks(room);
    if (room.idx !== at) return;                       // a virtual hand scored itself
    Room.scoreRound(room, curRound(room).tricks);      // the same road a real round takes
  }

  function devEndGame(room) {
    if (!room.rounds.length) Room.startGame(room);
    let guard = 60;
    while (room.phase !== 'done' && guard-- > 0) devNextRound(room);
  }

  /* Take the game to a round and a phase, in one go. The card is rebuilt and
     played up to the doorstep of round R with rounds a real table could make,
     and then, for `tricks`, the bids of R go in too. Landing the last round
     at `tricks` is one click from watching the game end. */
  function devGoto(room, round, phase) {
    const total = room.rounds.length || G.buildRounds(room.cfg, room.seats.length, 0).length;
    const R = Math.max(1, Math.min(Math.round(Number(round) || 1), total));
    devFillCard(room, R - 1);
    if (phase === 'tricks' && room.idx === R - 1) devFillBids(room);
  }

  // Fill the scorecard. Plays whole rounds of bids and tricks that a real table
  // could make, and leaves the next round waiting for its bids. The rules, the
  // seats and the first dealer stay as they are. `count` rounds, or a random
  // number of them when `count` is not a number.
  function devFillCard(room, count) {
    Room.startGame(room);                 // an empty card, built from the rules in force
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
    Room.startGame(room);
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

  /* The whole table, replaced by an edited copy of its own record -- the
     same shape lib/tables.js writes to disk. The code stays (it is the key
     the table is held under), the server's own things stay (sockets,
     timers), and each seat keeps its picture: the record never carries them,
     and a round-trip must not strip them. Everything else is what the text
     says. */
  function devState(room, rec) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return 'that is not a table';
    if (!Array.isArray(rec.seats) || rec.seats.length < 1) return 'a table needs its seats';
    const av = new Map(room.seats.map((x) => [x.id, x.av]));
    const keep = ['code', 'sockets', 'botTimer', 'bidTimer'];
    Object.keys(room).forEach((k) => { if (!keep.includes(k)) delete room[k]; });
    Object.keys(rec).forEach((k) => { if (!keep.includes(k)) room[k] = rec[k]; });
    room.seats.forEach((x) => { if (av.get(x.id)) x.av = av.get(x.id); });
    Room.syncCfg(room);
    return null;
  }

  // Force values the protocol would not allow, for looking at a screen.
  function devPatch(room, p) {
    const n = room.seats.length;
    if (p.cfg && DEV) Object.assign(room.cfg, p.cfg);
    if (typeof p.idx === 'number' && room.rounds.length) {
      room.idx = Math.max(0, Math.min(p.idx, room.rounds.length));
      if (room.idx < room.rounds.length && !room.rounds[room.idx].bids) {
        room.rounds[room.idx].bids = Array(n).fill(null);
      }
    }
    if (p.phase && ['lobby', 'bid', 'tricks', 'done'].includes(p.phase)) {
      room.phase = p.phase;
      if (p.phase === 'done') Room.finishGame(room);
      else Room.unfinish(room);
    }
    if (p.captainId && seatIndex(room, p.captainId) >= 0) room.captainId = p.captainId;
    if ('firstDealerId' in p) {
      room.firstDealerId = (p.firstDealerId && seatIndex(room, p.firstDealerId) >= 0) ? p.firstDealerId : null;
    }
    if (p.hands && room.play && DEV && Array.isArray(p.hands)) {
      room.play.hands = p.hands.map((h) => (Array.isArray(h) ? h.slice(0, 13) : []));
    }
    if (p.seat && room.seats[Number(p.seat.i)]) {
      const one = room.seats[Number(p.seat.i)];
      if (typeof p.seat.name === 'string' && p.seat.name.trim()) one.name = p.seat.name.trim().slice(0, 16);
      if ('bot' in p.seat) {
        one.bot = !!p.seat.bot;
        if (one.bot) { one.left = false; one.online = true; }   // a bot never goes anywhere
      }
      if ('left' in p.seat) {
        one.left = !!p.seat.left;
        if (one.left) one.online = false;
      }
      Room.syncCfg(room);          // the job moves off a seat that cannot hold it
    }
    if (p.round && room.rounds[p.round.i]) {
      const r = room.rounds[p.round.i];
      if ('bids' in p.round) r.bids = devNums(p.round.bids, n, r.cards, true);
      if ('tricks' in p.round) r.tricks = devNums(p.round.tricks, n, r.cards, false);
      if ('trump' in p.round) r.trump = p.round.trump;
      if ('redeals' in p.round) r.redeals = Number(p.round.redeals) || 0;
      if ('dealer' in p.round) {
        const dd = Number(p.round.dealer);
        if (dd >= 0 && dd < n) r.dealer = dd;
      }
    }
    if (p.vote === null) room.vote = null;
  }

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

  /* The dev page, two ways in. `tables` and `open` come before the rest:
     they are what a page with no table yet asks for. */
  function handleDev(ws, m) {
    if (m.action === 'setup') {
      if (!DEV) return fail(ws, 'a table of stand-ins needs the server started with DEV=1');
      const made = createRoom();
      attach(ws, made, { role: 'host' });
      devSeats(made, Number(m.players) || 4);
      return devHello(ws, made);
    }

    // What this server is running, so the page can offer a way onto any of it.
    if (m.action === 'tables') {
      if (!DEV) return fail(ws, 'the list of tables needs the server started with DEV=1');
      return send(ws, { t: 'tables', tables: listTables() });
    }

    /* Onto a table already in play. The host token is the way in on any
       server: it is authority the TV screen already holds. With DEV=1 the code
       alone is enough, because that server hands its tables to the page
       anyway. Either way the room decides what may then be done to it. */
    if (m.action === 'open') {
      const room = roomOf(m.code);
      if (!room) return fail(ws, 'no table with that code');
      if (!DEV && m.token !== room.hostToken) return fail(ws, 'that table needs its host token');
      attach(ws, room, { role: 'host' });
      return devHello(ws, room);
    }
    const room = ws.ctx && ws.ctx.room;
    if (!room) return fail(ws, 'open a table first');
    if (ws.ctx.role === 'watch') return fail(ws, 'this window is only watching');
    const mine = ws.ctx.seatId ? seatIndex(room, ws.ctx.seatId) : -1;
    const runs = ws.ctx.role === 'host' || (mine >= 0 && room.seats[mine].id === room.captainId);
    if (!runs) return fail(ws, 'only the host can use the dev controls');
    // What may be done follows the server. A dev server gives every table
    // every control; on any other, the host token forces state and no more.
    if (m.action !== 'patch' && !DEV) {
      return fail(ws, 'inventing data for a table needs the server started with DEV=1');
    }
    // Playing rounds needs players. A real table opens empty, and the old
    // stand-in gate hid that; now the refusal has to be its own.
    if (['startGame', 'fillBids', 'fillTricks', 'nextRound', 'endGame', 'bumVote',
         'fillCard', 'randomise', 'goto'].includes(m.action) && room.seats.length < 2) {
      return fail(ws, 'the table needs at least 2 players first');
    }
    switch (m.action) {
      case 'players': devSeats(room, Number(m.players) || 4); break;
      case 'startGame': Room.startGame(room); break;
      case 'fillBids': devFillBids(room); break;
      case 'fillTricks': devFillTricks(room); break;
      case 'nextRound': devNextRound(room); break;
      case 'endGame': devEndGame(room); break;
      case 'lobby': Room.toLobby(room); break;
      case 'bumVote': devBumVote(room); break;
      case 'fillCard': devFillCard(room, m.rounds); break;
      case 'goto': devGoto(room, m.round, m.phase); break;
      case 'randomise': devRandomise(room); break;
      case 'avatar': {
        const seat = room.seats[Number(m.seat)];
        if (!seat) return fail(ws, 'no such seat');
        const bad = setAvatar(seat, m.data);
        if (bad) return fail(ws, bad);
        break;
      }
      case 'patch': devPatch(room, m.patch || {}); break;
      case 'state': {
        // With a record: become it. Without: hand the record over to edit.
        if (!('record' in m)) return send(ws, { t: 'stateRaw', record: Tables.record(room) });
        const bad = devState(room, m.record);
        if (bad) return fail(ws, bad);
        break;
      }
      case 'seat': {
        // The seat itself, so a pane can act as the player. Only a dev server
        // gets here: on any other the seats never leave the server.
        const one = room.seats.find((x) => x.id === m.id);
        if (!one) return fail(ws, 'no such seat');
        return send(ws, { t: 'seat', id: one.id, token: one.token });
      }
      default: return fail(ws, 'unknown dev action');
    }
    return devHello(ws, room);
  }

  return { handleDev, devHello };
};
