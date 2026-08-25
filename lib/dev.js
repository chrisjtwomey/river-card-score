'use strict';
/* The dev controls, and nothing a game needs.

   Two ways in. With DEV=1 the dev page makes a table of stand-in players and
   may do anything to it, including inventing bids and scores. From the host
   screen of a real table it may only force that table's own state, to put a
   game in play right.

   Nothing here is reachable unless a message says so, and the inventing half
   answers only a table of stand-ins.
*/
module.exports = ({ DEV, G, A, token, createRoom, attach, send, fail, broadcast,
                    seatIndex, curRound, syncCfg, newGame, unfinish, setAvatar,
                    virtual, dealHands, startPlay, scoreRound, finishGame }) => {
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

  /* The dev page, two ways in.
     With DEV=1 it makes a table of stand-in players and may do anything to it,
     including inventing bids and scores. From the host screen of a real table
     it may only force that table's own state, to fix a game in play. */
  function handleDev(ws, m) {
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

  return { handleDev, devHello, devSeats };
};
