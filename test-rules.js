'use strict';
/* The rules, checked where they live.

   game.js, lib/room.js, lib/deck.js and lib/messages.js are plain functions
   over plain data. A room is an object; a verb changes it and returns; a guard
   says yes or no. Nothing here opens a socket, and nothing here waits.

   These were once all checked through a running server, one message at a time,
   with a sleep after each to let it arrive. That proved the wiring as well as
   the rule -- and the wiring is worth proving, which is what test.js is for --
   but proving it again for every rule is what made the suite take a minute. So
   a rule is checked here, once, in this process; test.js plays one whole game
   down each path over real sockets.

   If a check here fails, the rule is wrong. If a check in test.js fails and its
   rule passes here, the wiring is wrong.
*/
const G = require('./game.js');
const A = require('./public/accolades.js');
const RoomOf = require('./lib/room.js');
const BotsOf = require('./lib/bots.js');
const Messages = require('./lib/messages.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };
const part = (n) => console.log('\n-- ' + n + ' --');

let seq = 0;
const token = () => 'tk' + (++seq).toString(36);

/* A table with nobody at it but the rules.

   The sockets are stand-ins that write down what they were told, so a refusal
   is a string we can read back and a broadcast is a number. The pause a
   finished trick is held up for is the server's and not the deck's, so here it
   is a list of tricks waiting for their moment, settled when we say. */
function table(o) {
  o = o || {};
  const said = [];                                  // every line said back to a socket
  const casts = { n: 0 };                           // how often the table was told
  const held = [];                                  // tricks waiting for their moment
  const saved = [];                                 // the games written to file
  const send = (ws, m) => { (ws.got || (ws.got = [])).push(m); };
  const bounce = (ws, msg) => { said.push(msg); ws.said.push(msg); };
  const broadcast = () => { casts.n += 1; };

  /* The trail the room writes what happened onto. Its pure half only: the
     points are read straight off the room, and nothing here goes near a disk. */
  const Tables = require('./lib/tables.js')({ DATA: '/nowhere', KEEP_HOURS: 6 });
  const Trail = require('./lib/trail.js')({ DATA: '/nowhere', KEEP_HOURS: 6, KEEP_GAMES: 200,
                                            TRAIL_MAX: 1e9, record: Tables.record });
  const Room = RoomOf({ G, A, token, saveGame: (r) => saved.push(r.gameId), DEV: !!o.dev, Trail });
  const room = Room.create(o.code || 'TEST', 'hosttoken');

  // The server's own playCard, without the hold: the rules are the deck's, the
  // pause is the server's, and test.js times that against a real clock.
  function playCard(ws, r, p, card) {
    const why = Room.Deck.refusal(r, p, card);
    if (why) { if (ws) bounce(ws, why); return; }
    const winner = Room.Deck.putCard(r, p, card);
    if (winner !== null) held.push(winner);
    broadcast();
  }

  const Bots = BotsOf({ G, curRound: Room.curRound, broadcast,
                        seatBid: Room.seatBid, playCard, bumDeal: Room.bumDeal });

  const { handleTable } = Messages({
    DEV: !!o.dev, CHAT_KEEP: o.chatKeep || 100, G, A, send, fail: bounce, broadcast, Room, playCard,
    markPresence: () => {},
    addBot: (r) => Room.addBot(r, Bots.botName(r)),
    bidValue: Bots.bidFor,
  });

  // One socket per player, kept, because a message may remember the last one
  // it sent (nobody may say two lines of table talk at once).
  const wires = new Map();
  function wire(who) {
    if (!wires.has(who)) {
      const ws = { said: [], got: [] };
      ws.ctx = { room, role: who === 'host' ? 'host' : 'player' };
      wires.set(who, ws);
      room.sockets.add(ws);
    }
    return wires.get(who);
  }

  /* One message, from one socket, with the context worked out exactly as
     server.js works it out. `who` is a seat number, or 'host' for the screen
     that runs the table. Returns the line said back, or null when it went
     through. */
  function say(who, m) {
    const isHost = who === 'host';
    const p = typeof who === 'number' ? who : -1;
    const seat = p >= 0 ? room.seats[p] : null;
    const ws = wire(who);
    ws.ctx.seatId = seat ? seat.id : null;
    ws.said.length = 0;
    handleTable(ws, m, { ws, room, n: room.seats.length, r: Room.curRound(room),
                         mySeat: seat ? p : -1, boss: isHost || (!!seat && seat.id === room.captainId),
                         isHost, ctx: ws.ctx });
    return ws.said.length ? ws.said[ws.said.length - 1] : null;
  }

  const t = {
    Room, room, say, said, casts, saved, Bots, Trail,
    // What the table has written down, as a line of kinds: 'G R b b s c c w e'.
    trail() { return room.trail.map((e) => e.k).join(' '); },
    points(k) { return room.trail.filter((e) => e.k === k); },
    // Sit players down. The first one down runs the table, as on a real one.
    sit(names, extra) {
      names.forEach((nm) => room.seats.push(Room.seat(nm, extra)));
      Room.syncCfg(room);
      return t;
    },
    // The rules, as the config message sets them: naming the number of
    // one-card rounds pins it, or the seat count takes it back.
    // Where the player who runs the table is sitting. A seat dragged to a new
    // place moves everybody's number, and the table is still theirs.
    boss() { return room.seats.findIndex((x) => x.id === room.captainId); },
    rules(patch) {
      if ('ones' in patch) room.onesLocked = true;
      Object.assign(room.cfg, patch);
      Room.syncCfg(room);
      return t;
    },
    round() { return Room.curRound(room); },
    // The moment a finished trick is held up for has passed.
    settle() { while (held.length) Room.Deck.settleTrick(room, held.shift()); return t; },
    holding() { return held.length > 0; },
    // The moment the bids are held up for has passed, and the hand may be
    // played. server.js does this on a timer; here it is done by hand.
    open() { Room.openPlay(room); return t; },
    /* Bid the whole round through, in turn, never the forbidden number. The
       last bid leaves the bids standing to be read, as at a real table; pass
       `hold` to stop there. Every other check wants a playable hand. */
    bidAll(v, hold) {
      for (let g = 0; g < room.seats.length; g++) {
        const p = G.onTurn(room);
        if (p === null) break;
        const no = G.forbiddenBid(Room.curRound(room), p, room.cfg, room.seats.length);
        const want = typeof v === 'number' ? v : 1;
        say(p, { t: 'bid', v: want === no ? (want === 0 ? 1 : want - 1) : want });
      }
      if (!hold) Room.openPlay(room);
      return t;
    },
  };
  return t;
}

// A table of `names`, its rules patched, started, ready to bid.
function started(names, cfg) {
  const t = table().sit(names).rules(Object.assign({ max: 3, pattern: 'down', ones: 1 }, cfg));
  t.Room.startGame(t.room);
  return t;
}


part('the rules the server and every screen ask alike');

/* Whose turn it is, which seats the table plays itself, and which one seat the
   table is stopped on with nobody behind it. Each used to be worked out again
   wherever it was needed, and the copies disagreed. */
{
  const seats = (n) => Array.from({ length: n }, (_, i) => ({ id: 's' + i, name: 'P' + i, online: true }));
  const v = { deck: 'virtual' }, real = { deck: 'physical' };
  const round = (dealer, bids) => ({ cards: 3, dealer, trump: null, bids, tricks: null });
  let st = { phase: 'bid', cfg: v, seats: seats(3), rounds: [round(0, [null, null, null])], idx: 0, play: null };
  ok(G.onTurn(st) === 1, 'bidding: the seat left of the dealer is on turn');
  st.rounds[0].bids = [null, 2, 0];
  ok(G.onTurn(st) === 0, 'and the dealer bids last');
  st = { phase: 'tricks', cfg: v, seats: seats(3), rounds: [round(0, [1, 1, 0])], idx: 0, play: { turn: 2 } };
  ok(G.onTurn(st) === 2, 'playing: the seat on play is on turn');
  st.play.turn = null;
  ok(G.onTurn(st) === null, 'and nobody is, while a trick is held up');
  st = { phase: 'tricks', cfg: real, seats: seats(3), rounds: [round(0, [1, 1, 0])], idx: 0, play: null };
  ok(G.onTurn(st) === null, 'with real cards nobody is on turn: typing the tricks in is not a turn');
  ok(G.onTurn({ phase: 'lobby', cfg: v, seats: seats(2), rounds: [], idx: 0 }) === null, 'nor is anybody in the lobby');
  ok(G.tablePlays({ bot: true }, real) && G.tablePlays({ bot: true }, v), 'the table plays a bot at either kind of table');
  ok(G.tablePlays({ left: true }, v), 'and a seat that left, where it deals the cards');
  ok(!G.tablePlays({ left: true }, real), 'but not where the cards are real: nobody can hold that hand');
  ok(!G.tablePlays({ online: false }, v), 'a phone that went quiet is waited for');
  st = { phase: 'bid', cfg: real, seats: seats(3), rounds: [round(0, [null, null, null])], idx: 0, play: null };
  ok(G.awaySeat(st) === -1, 'everybody here: no seat is away');
  st.seats[1].online = false;
  ok(G.awaySeat(st) === 1, 'the seat on turn with nobody behind it is the away seat');
  st.seats[1].left = true;
  ok(G.awaySeat(st) === 1, 'a seat that left a real-cards table still needs somebody to bid for it');
  st.cfg = v;
  ok(G.awaySeat(st) === -1, 'where the table can play that hand, it is not away');
  st.seats[1] = { id: 's1', name: 'Bot', online: true, bot: true };
  ok(G.awaySeat(st) === -1, 'and a bot is never away');
  ok(G.firstLeader(round(2, null), 3) === 0, 'the seat left of the dealer leads');
  ok(G.totalsWithBonus({ bonus: 10, miss: 'atleast' },
                       [{ cards: 1, dealer: 0, bids: [1, 0], tricks: [1, 0] }], 2, [5, 0]).join() === '16,10',
     'the accolades are paid into the totals');
  ok(G.virtual({ cfg: v }) && !G.virtual({ cfg: real }) && !G.virtual(null),
     'and one place says which kind of table this is');
}

part('the scorecard');

{
  const sched = (cfg) => G.schedule(cfg.max, cfg.pattern, cfg.ones);
  ok(sched({ max: 2, pattern: 'down', ones: 3 }).join() === '2,1,1,1', 'down from 2 with three ones');
  ok(sched({ max: 3, pattern: 'downup', ones: 1 }).join() === '3,2,1,2,3', 'down and back up again');
  ok(sched({ max: 3, pattern: 'up', ones: 1 }).join() === '1,2,3', 'and straight up');
  ok(G.maxCardsFor(4) === 13 && G.maxCardsFor(8) === 6, 'no hand is bigger than the deck can deal');

  const cfg = { bonus: 10, miss: 'atleast' };
  ok(G.roundScore(2, 2, cfg) === 12, 'a bid made pays the tricks and the bonus');
  ok(G.roundScore(2, 3, cfg) === 3, 'over the bid pays the tricks alone');
  ok(G.roundScore(2, 1, cfg) === 0, 'and short of it pays nothing at all');
  ok(G.roundScore(0, 0, cfg) === 10, 'nothing bid and nothing taken is the bonus');
  ok(G.roundScore(2, 1, { bonus: 10, miss: 'diff' }) === -1, 'another table charges a point a trick off');
  ok(G.roundScore(2, 1, { bonus: 10, miss: 'atleastdiff' }) === -1, 'and another only for coming up short');
  ok(G.roundScore(2, 3, { bonus: 10, miss: 'tricks' }) === 3, 'and another pays the tricks, made or missed');
}


part('the accolades, worked out from a scorecard alone');

{
  const cfg = { bonus: 10, miss: 'atleast' };
  const card = (cards, bids, tricks) => ({ cards, dealer: 0, trump: null, bids, tricks });
  const rounds = [
    card(2, [2, 0, 1, 0], [2, 0, 0, 0]),
    card(2, [1, 1, 0, 0], [0, 1, 1, 0]),
    card(1, [0, 1, 0, 0], [0, 1, 0, 0]),
    card(1, [1, 0, 0, 0], [1, 0, 0, 0]),
  ];
  const got = A.list(rounds, 4, (b, w) => G.roundScore(b, w, cfg));
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
  const three = A.pick(got, 3);
  ok(three.length === 3 && three.every((a) => got.indexOf(a) >= 0), 'three are drawn from the ones earned');
  ok(new Set(three.map((a) => a.key)).size === 3, 'and never the same one twice');
  const seen = new Set();
  for (let i = 0; i < 40; i++) A.pick(got, 3).forEach((a) => seen.add(a.key));
  ok(seen.size > 3, 'the draw is not always the same three  got ' + seen.size + ' different');
  ok(A.pick(got.slice(0, 2), 3).length === 2, 'a table that earned two gets two');
  const paid = A.bonus([{ who: [0] }, { who: [1, 3] }], 4, 10);
  ok(paid.join(',') === '10,10,0,10', 'each seat is paid for what it was given  got ' + paid.join(','));
  ok(A.bonus([{ who: [0] }], 4, 0).join(',') === '0,0,0,0', 'and nothing when they pay nothing');
  ok(A.list(rounds.slice(0, 2), 4, (b, w) => G.roundScore(b, w, cfg)).length === 0,
     'a game too short to judge gets none');
  const level = [card(1, [0, 0, 0, 0], [1, 0, 0, 0]), card(1, [0, 0, 0, 0], [0, 1, 0, 0]),
                 card(1, [0, 0, 0, 0], [0, 0, 1, 0])];
  ok(!A.list(level, 4, (b, w) => G.roundScore(b, w, cfg)).some((a) => a.key === 'fearless'),
     'and nothing is awarded where every seat is level');

  /* A table says which of them it hands out. Every accolade the game has is
     named in one place, and a table that has never said otherwise plays with
     the lot -- as does every game played before the rule existed. */
  ok(A.ALL.length === 11 && A.ALL.every((a) => a.key && a.title), 'every accolade is named in one list');
  ok(A.ALL.some((a) => a.key === 'steady' && a.title === 'Steadiest hand'),
     'and the name it is drawn under is the name it is chosen by');
  ok(A.only(got, undefined).length === got.length, 'a table that chose none of them hands out all of them');
  const two = A.only(got, ['steady', 'tricks']);
  ok(two.length === 2 && two.every((a) => ['steady', 'tricks'].indexOf(a.key) >= 0),
     'and one that chose two hands out those two  got ' + two.map((a) => a.key).join(','));
  ok(A.only(got, []).length === 0, 'choosing none hands out none');
  ok(A.only(got, ['nosuchthing']).length === 0, 'and a name the game does not know wins nothing');
}

part('a round opens in one place, whatever brought it there');

/* openRound is the only place a round is put back to the start. Every way in
   has to land the same, or a screen keying its deal on the round comes back to
   a hand that is not the one on the table. */
{
  const ways = {
    'a game starting': (t) => t.Room.startGame(t.room),
    'the round before scoring': (t) => { t.Room.startGame(t.room); t.Room.scoreRound(t.room, [1, 0, 0]); },
    'a hand thrown in': (t) => { t.Room.startGame(t.room); t.Room.bumDeal(t.room); },
    'a step back': (t) => { t.Room.startGame(t.room); t.bidAll(1); t.Room.undo(t.room); },
  };
  Object.keys(ways).forEach((why) => {
    const t = table().sit(['Ann', 'Bob', 'Cal']).rules({ max: 3, pattern: 'down', ones: 2 });
    ways[why](t);
    const r = t.round();
    ok(t.room.phase === 'bid', `${why}: the round is open for bids`);
    ok(r.bids.every((b) => b === null), `${why}: with no bid in`);
    ok(r.tricks === null, `${why}: and no tricks`);
    ok(t.room.vote === null, `${why}: nothing is being voted on`);
    ok(t.room.play === null, `${why}: and real cards are dealt on the table, not here`);
  });

  // and on a table dealt on the phones, the same again with a hand each
  Object.keys(ways).forEach((why) => {
    const t = table().sit(['Ann', 'Bob', 'Cal']).rules({ deck: 'virtual', max: 3, pattern: 'down', ones: 2 });
    ways[why](t);
    const play = t.room.play;
    ok(!!play && play.round === t.room.idx, `${why}, dealt on the phones: the hands are this round's`);
    ok(play.hands.every((h) => h.length === t.round().cards), `${why}, dealt on the phones: a full hand each`);
    ok(new Set(play.hands.flat()).size === play.hands.flat().length,
       `${why}, dealt on the phones: and no card twice`);
  });
}

{
  const t = started(['Ann', 'Bob', 'Cal'], { max: 2, pattern: 'down', ones: 3 });
  ok(t.room.rounds.map((r) => r.cards).join() === '2,1,1,1', 'a game starting builds the scorecard');
  ok(t.room.rounds.map((r) => r.dealer).join() === '0,1,2,0', 'and deals round by round about the table');
  ok(t.room.idx === 0 && t.room.phase === 'bid', 'the first round is open');
  ok(t.room.gameId === null, 'a game has no file until it is finished');

  // a hand thrown in keeps its place, and says so
  const before = t.round().cards;
  t.Room.bumDeal(t.room);
  ok(t.round().redeals === 1, 'a hand thrown in counts the re-deal');
  ok(t.room.idx === 0 && t.round().cards === before && t.round().dealer === 0,
     'same round, same dealer, same hand size');
  ok(t.round().trump === null, 'and the card turned for trumps is turned again');
  t.Room.bumDeal(t.room);
  ok(t.round().redeals === 2, 'twice thrown in, twice counted');
}

{
  // the last round scores, and the game is over
  const t = started(['Ann', 'Bob'], { max: 1, pattern: 'down', ones: 1 });
  ok(t.room.rounds.length === 1, 'a one-round game');
  t.Room.scoreRound(t.room, [1, 0]);
  ok(t.room.phase === 'done', 'the last round scoring finishes the game');
  ok(!!t.room.gameId && t.saved[0] === t.room.gameId, 'and it is written to file, once');
  ok(Array.isArray(t.room.awards) && Array.isArray(t.room.bonus), 'the accolades are drawn and paid');
}

{
  /* A game hands out only the accolades its table chose. A one-round game is
     too short to earn any, so this one is played out long enough to. */
  const t = started(['Ann', 'Bob', 'Cal', 'Dee'], { max: 2, pattern: 'downup', ones: 2 });
  t.rules({ accolades: ['steady'] });
  while (t.room.phase !== 'done') {
    t.bidAll(0);
    t.Room.scoreRound(t.room, [1, 0, 0, 1]);
  }
  ok(t.room.awards.every((a) => a.key === 'steady'),
     'only the accolades the table chose are drawn  got ' + t.room.awards.map((a) => a.key).join(','));
  ok(t.room.awards.length <= 1, 'and one that was not earned is not invented');
  t.Room.toLobby(t.room);
  ok(t.room.phase === 'lobby' && t.room.rounds.length === 0, 'back to the lobby: the same players, no scorecard');
  ok(t.room.awards === null && t.room.bonus === null, 'and nothing owing from the last game');
}


part('one bid at a time, and only from the seat on turn');

{
  const t = started(['Ann', 'Bob', 'Cal'], { max: 2, pattern: 'down', ones: 3, screw: true });
  const r = t.round();
  ok(t.room.idx === 0 && r.dealer === 0 && G.onTurn(t.room) === 1, 'seat 1 bids first, the dealer last');

  ok(/turn to bid/.test(t.say(0, { t: 'bid', v: 1 })), 'the dealer bidding first is refused');
  ok(/turn to bid/.test(t.say(2, { t: 'bid', v: 1 })), 'and so is skipping ahead');
  ok(t.say(1, { t: 'bid', v: 1 }) === null, 'the seat on turn bids');
  ok(G.onTurn(t.room) === 2, 'and the turn moves on');

  ok(t.say(1, { t: 'bid', v: 2 }) === null, 'the last bidder can change their bid');
  ok(r.bids[1] === 2 && G.onTurn(t.room) === 2, 'changing a bid does not move the turn');
  t.say(1, { t: 'bid', v: 1 });
  ok(r.bids[1] === 1, 'and can change it back');

  t.say(2, { t: 'bid', v: 1 });
  ok(G.onTurn(t.room) === 0, 'the dealer bids last');
  ok(/too late to change/i.test(t.say(1, { t: 'bid', v: 0 })), 'too late once the next player has bid');
  ok(r.bids[1] === 1, 'and the late change did not land');

  ok(/out of range/.test(t.say(0, { t: 'bid', v: 5 })), 'a bid bigger than the hand is refused');
  ok(/out of range/.test(t.say(0, { t: 'bid', v: -1 })), 'and so is one below nothing');
  ok(/must not total 2/.test(t.say(0, { t: 'bid', v: 0 })), 'screw the dealer blocks the equalising bid');
  ok(t.say(0, { t: 'bid', v: 1 }) === null && t.room.phase === 'tricks', 'the last bid in starts the play');
  ok(/not bidding now/i.test(t.say(0, { t: 'bid', v: 2 })), 'and nothing changes once they are all in');
}

{
  // without the rule, the dealer may level the bids
  const t = started(['Ann', 'Bob', 'Cal'], { max: 2, pattern: 'down', ones: 3, screw: false });
  t.say(1, { t: 'bid', v: 1 });
  t.say(2, { t: 'bid', v: 1 });
  ok(t.say(0, { t: 'bid', v: 0 }) === null, 'with screw the dealer off, the bids may total the hand');
}

{
  // a seat that has gone quiet stops everybody, so the table host bids for it
  const t = started(['Ann', 'Bob', 'Cal'], { max: 2, pattern: 'down', ones: 3 });
  ok(/only the table host/.test(t.say(2, { t: 'bidfor', v: 1 })), 'no player bids for another');
  ok(/is here and can bid/.test(t.say('host', { t: 'bidfor', v: 1 }) || ''),
     'and nobody bids for a seat whose phone is at the table');
  t.room.seats[1].online = false;
  ok(t.say('host', { t: 'bidfor', v: 1 }) === null, 'the table host bids for the seat that is away');
  ok(t.round().bids[1] === 1, 'and the number lands in it');
  t.room.seats[2].online = false;
  ok(/there are no cards to read/.test(t.say('host', { t: 'bidfor', v: null }) || ''),
     'with real cards there is no hand to read a bid off, so the number must be typed');
  t.say('host', { t: 'bidfor', v: 1 });
  t.room.seats[0].online = false;
  ok(/must not total 2/.test(t.say('host', { t: 'bidfor', v: 0 }) || ''),
     'and a bid made for a seat obeys the same rules as one the player makes');
}

{
  // where the cards are dealt on the phones, the number is read off the hand
  const t = started(['Ann', 'Bob', 'Cal'], { deck: 'virtual', max: 3, pattern: 'down', ones: 1 });
  t.room.seats[1].online = false;
  ok(t.say('host', { t: 'bidfor', v: null }) === null, 'a bid asked for is read off that seat\'s own hand');
  const v = t.round().bids[1];
  ok(Number.isInteger(v) && v >= 0 && v <= t.round().cards, 'and it is a bid that hand could make  got ' + v);
}

part('counting the tricks, with real cards on the table');

{
  const t = started(['Ann', 'Bob', 'Cal'], { max: 2, pattern: 'down', ones: 3 });
  t.bidAll(1);
  ok(t.room.phase === 'tricks', 'the bids are in');
  const play = () => t.room.play;
  ok(play() && play().real && play().won.join() === '0,0,0', 'the count opens with nobody having taken one');

  const dealer = t.round().dealer, other = (dealer + 2) % 3;
  ok(G.countingSeat(t.room) === dealer, 'the dealer keeps the round');
  ok(G.countingSeat(started(['Ann', 'Bob', 'Cal'], { deck: 'virtual' }).room) === -1,
     'and nobody keeps it where the cards count themselves');

  ok(t.say(other, { t: 'trick', p: 0 }) === 'the dealer counts the tricks',
     'a player who is not the dealer counts nothing');
  ok(play().won.join() === '0,0,0', 'and nothing lands on the table');
  ok(/no such seat/i.test(t.say(dealer, { t: 'trick', p: 7 })), 'a trick goes to a seat at the table');
  ok(t.say(dealer, { t: 'trick', p: 0 }) === null, 'the dealer counts a trick');
  ok(play().won.join() === '1,0,0' && play().last.winner === 0, 'and it lands on the seat that took it');
  ok(t.say(other, { t: 'trickback' }) === 'the dealer counts the tricks',
     'nor does anybody else take one back');
  ok(t.say(dealer, { t: 'trickback' }) === null && play().won.join() === '0,0,0', 'the dealer takes it back');
  ok(play().last === null, 'and nobody is shown as having taken the last one');
  ok(/no trick to take back/i.test(t.say(dealer, { t: 'trickback' })), 'once only');
  ok(t.say('host', { t: 'trick', p: 0 }) === null, 'the screen that runs the table counts for it');
  ok(t.room.idx === 0 && t.room.phase === 'tricks', 'and the round waits for the rest');

  t.say(dealer, { t: 'trick', p: 1 });
  ok(t.room.idx === 1 && t.room.phase === 'bid', 'the last trick scores the round, and the next one opens');
  ok(t.room.rounds[0].tricks.join() === '1,1,0', 'with the tricks as counted  got ' + t.room.rounds[0].tricks);
  ok(t.room.play === null, 'and the next round counts nothing until its bids are in');
  ok(G.totalsWithBonus(t.room.cfg, t.room.rounds, 3, [0, 0, 0]).join() === '11,11,0',
     'the scores are 11 / 11 / 0');
}

part('the trump card, and who may set it');

{
  // With real cards the trump is lying on the table for everybody to see, so
  // there is nothing for a phone to say about it. There is no such message.
  const t = started(['Ann', 'Bob', 'Cal'], { max: 2, pattern: 'down', ones: 3 });
  ok(t.say(1, { t: 'trump', k: 'H' }) === 'unknown message', 'nobody sets a trump by hand');
  ok(t.round().trump === null, 'and the round is left as it was');
  const v = started(['Ann', 'Bob', 'Cal'], { deck: 'virtual', max: 3, pattern: 'down', ones: 1 });
  const was = v.round().trump;
  ok(!!was && v.room.play.upcard.slice(-1) === was, 'where the deck deals, the card turned sets it');
  ok(v.say(1, { t: 'trump', k: 'S' }) === 'unknown message' && v.round().trump === was,
     'and nobody may change it there either');
}

part('one step back');

{
  // from the end of the game
  const t = started(['Ann', 'Bob'], { max: 1, pattern: 'down', ones: 1 });
  t.Room.scoreRound(t.room, [1, 0]);
  ok(t.room.phase === 'done', 'the game is over');
  ok(t.Room.undo(t.room) === null, 'a step back is taken');
  ok(t.room.phase === 'tricks' && t.room.idx === 0, 'and it reopens the last round for its tricks');
  ok(t.room.rounds[0].tricks === null, 'with the tricks cleared');
  ok(t.room.awards === null, 'and the accolades unsettled');
}
{
  // from the middle of a round, and from the start of the next
  const t = started(['Ann', 'Bob', 'Cal'], { max: 2, pattern: 'down', ones: 3 });
  t.bidAll(1);
  ok(t.room.phase === 'tricks', 'the bids are in');
  t.Room.undo(t.room);
  ok(t.room.phase === 'bid' && t.round().bids.every((b) => b === null), 'a step back from the tricks clears the bids');
  t.bidAll(1);
  t.Room.scoreRound(t.room, [1, 1, 0]);
  ok(t.room.idx === 1 && t.room.phase === 'bid', 'the round is scored and the next opens');
  t.Room.undo(t.room);
  ok(t.room.idx === 0 && t.room.phase === 'tricks', 'a step back from a fresh round reopens the one before');
  ok(t.room.rounds[0].tricks === null, 'and its tricks go');
  ok(t.room.play && t.room.play.won.join() === '0,0,0', 'to be counted again from nothing');
  ok(t.room.rounds[1].bids === null, 'the round stepped out of is left with no bids at all');
  ok(t.Room.undo(t.room) === null && t.room.phase === 'bid', 'and back again to its bids');
  ok(t.Room.undo(t.room) === 'nothing to undo', 'there is nothing before the first bid of the first round');
}
{
  // where the cards were dealt on the phones, they are gone: whichever step
  // was taken back, the round it lands on is dealt again
  const t = started(['Ann', 'Bob', 'Cal'], { deck: 'virtual', max: 3, pattern: 'down', ones: 1 });
  const first = t.room.play.hands.map((h) => h.join()).join('|');
  t.bidAll(1);
  t.Room.undo(t.room);
  ok(t.room.phase === 'bid', 'a step back lands on the bids');
  ok(t.room.play.hands.every((h) => h.length === t.round().cards), 'with a full hand each');
  ok(t.room.play.hands.map((h) => h.join()).join('|') !== first, 'dealt again, not the hands that were played');
}


part('the bids stand for a moment before the hand is played');

/* The last bid landing and the first card becoming playable used to be one
   moment. Now the round goes to tricks with nobody on play: the bids are up
   to be read, and only then does the hand open. Both decks hold the same
   way, so every screen has the same still table to say it on. */
{
  const t = started(['Ann', 'Bob', 'Cal'], { deck: 'virtual' });
  t.bidAll(1, 'hold');
  ok(t.room.phase === 'tricks', 'the last bid takes the round to tricks');
  ok(G.bidsHeld(t.room), 'and the bids stand there to be read');
  ok(t.room.play.turn === null, 'with nobody on play');
  ok(G.onTurn(t.room) === null, 'so the table is waiting on no one');

  const lead = G.firstLeader(t.round(), 3);
  ok(t.say(lead, { t: 'play', card: t.room.play.hands[lead][0] }) === 'not your turn',
     'no card goes down over the moment');

  t.open();
  ok(!G.bidsHeld(t.room), 'the moment passes');
  ok(t.room.play.turn === lead, 'and the player left of the dealer leads');
  ok(t.say(lead, { t: 'play', card: t.room.play.hands[lead][0] }) === null, 'now the card plays');
  ok(t.Room.openPlay(t.room) === false, 'a table already playing has nothing to open');
}

{
  // With real cards nobody holds a hand, so the hold is on the counting.
  const t = started(['Ann', 'Bob', 'Cal'], { deck: 'physical' });
  t.bidAll(1, 'hold');
  ok(G.bidsHeld(t.room), 'a table with real cards holds its bids the same way');
  ok(t.say(0, { t: 'trick', p: 0 }) === 'the bids are still up', 'and counts no trick over the moment');
  t.open();
  ok(!G.bidsHeld(t.room), 'the moment passes here too');
  ok(t.say(0, { t: 'trick', p: 0 }) === null, 'and then the taps count');
}

{
  // A bot is on lead. Nothing is asked of it while the bids are up, because
  // the table says nobody is on turn.
  const t = table().sit(['Ann']).rules({ deck: 'virtual', max: 3, pattern: 'down', ones: 1 });
  t.say('host', { t: 'addbot' });
  t.say('host', { t: 'addbot' });
  t.Room.startGame(t.room);
  t.bidAll(1, 'hold');
  ok(G.awaySeat(t.room) === -1, 'no seat is being waited on while the bids stand');
  ok(t.room.play.hands.every((h) => h.length === t.round().cards),
     'and every hand is still whole, bots included');
}

part('the rules of a trick, with the cards stacked on purpose');

/* The lead holds hearts. The next player holds a heart and two diamonds, so
   must follow. The last holds no heart at all, and a diamond is trump. */
function stacked(hands, trump) {
  const t = started(['Ann', 'Bob', 'Cal'], { deck: 'virtual', max: 3, pattern: 'down', ones: 1, screw: false });
  const r = t.round();
  const lead = G.firstLeader(r, 3);
  hands.forEach((h, i) => { t.room.play.hands[(lead + i) % 3] = h.slice(); });
  r.trump = trump;
  t.bidAll(1);
  return Object.assign(t, { lead, second: (lead + 1) % 3, third: (lead + 2) % 3 });
}

{
  const t = stacked([['KH', '3S', '4C'], ['9H', 'AD', 'KD'], ['AS', '2C', 'QD']], 'D');
  const { lead, second, third } = t;
  ok(t.room.play.turn === lead, 'the player left of the dealer leads');
  ok(t.room.play.hands[second].join() === '9H,AD,KD', 'a hand can be stacked on purpose');

  ok(t.Room.Deck.refusal(t.room, second, '9H') === 'not your turn', 'nobody plays out of turn');
  ok(t.Room.Deck.refusal(t.room, lead, 'AH') === 'you do not hold that card', 'nor a card they do not hold');
  ok(t.say(lead, { t: 'play', card: 'KH' }) === null, 'the lead plays');
  ok(t.room.play.trick.length === 1, 'and the card is on the table');

  ok(/must follow hearts/.test(t.say(second, { t: 'play', card: 'AD' }) || ''),
     'a player holding the suit led may not play another');
  ok(t.room.play.trick.length === 1, 'and the refused card stays in the hand');
  ok(t.room.play.hands[second].indexOf('AD') >= 0, 'really stays in it');
  ok(t.say(second, { t: 'play', card: '9H' }) === null, 'the heart they hold goes');

  ok(t.say(third, { t: 'play', card: 'QD' }) === null, 'a player with none of the suit led may play anything');
  ok(t.room.play.won[third] === 1, 'and a trump beats the highest card of the suit led');
  ok(t.room.play.last.winner === third, 'the table is told who won it');
  ok(t.room.play.turn === null, 'nobody is on turn while the trick is held up');
  ok(t.holding(), 'the trick is waiting for its moment to pass');
  t.settle();
  ok(t.room.play.turn === third, 'and then the winner leads the next one');
  ok(t.room.play.counts === undefined && t.room.play.hands.map((h) => h.length).join() === '2,2,2',
     'every hand is one card lighter');
  ok(t.room.play.trick.length === 0, 'and the table is clear');
}

{
  // the highest of the suit led takes it, when nobody trumps
  const t = stacked([['KH', '3S', '4C'], ['9H', 'AD', 'KD'], ['AH', '2C', 'QD']], 'S');
  t.say(t.lead, { t: 'play', card: 'KH' });
  t.say(t.second, { t: 'play', card: '9H' });
  t.say(t.third, { t: 'play', card: 'AH' });
  ok(t.room.play.won[t.third] === 1, 'the highest of the suit led takes the trick');
  ok(t.room.play.last.trick.length === 3, 'and the trick it took is kept, to be shown');
}

{
  // a trump played over a trump
  const t = stacked([['KH', '3S', '4C'], ['AD', '9C', 'KD'], ['QD', '2C', 'AS']], 'D');
  t.say(t.lead, { t: 'play', card: 'KH' });
  t.say(t.second, { t: 'play', card: 'AD' });
  t.say(t.third, { t: 'play', card: 'QD' });
  ok(t.room.play.won[t.second] === 1, 'the highest trump takes it  got seat ' + t.room.play.last.winner);
}

{
  // the last trick of the round scores it, and the next round opens dealt
  const t = stacked([['KH', '3S', '4C'], ['9H', 'AD', 'KD'], ['AS', '2C', 'QD']], 'D');
  t.say(t.lead, { t: 'play', card: 'KH' });
  t.say(t.second, { t: 'play', card: '9H' });
  t.say(t.third, { t: 'play', card: 'QD' });
  t.settle();
  for (let k = 0; k < 2; k++) {
    for (let g = 0; g < 3; g++) {
      const p = t.room.play.turn;
      if (p === null) break;
      const led = t.Room.Deck.ledSuit(t.room.play);
      t.say(p, { t: 'play', card: G.legalPlays(t.room.play.hands[p], led)[0] });
    }
    t.settle();
  }
  ok(t.room.idx === 1, 'the last trick of the round scores it');
  ok(t.room.rounds[0].tricks.reduce((a, b) => a + b, 0) === 3, 'and the tricks add up to the hand  got '
     + t.room.rounds[0].tricks);
  ok(t.room.phase === 'bid' && t.room.play.round === 1, 'the next round is dealt and open for bids');
}

part('the hands are the table\'s secret');

{
  const t = started(['Ann', 'Bob', 'Cal'], { deck: 'virtual', max: 3, pattern: 'down', ones: 1 });
  const seen = t.Room.publicState(t.room);
  ok(seen.play && !seen.play.hands, 'what every screen is told never carries a hand');
  ok(seen.play.counts.join() === '3,3,3', 'only how many cards each one holds');
  ok(!!seen.play.upcard, 'the card turned for trumps is everybody\'s');
  ok(seen.turn === G.onTurn(t.room), 'and the seat on turn, while the bidding is on');
  const all = t.room.play.hands.flat().concat(seen.play.upcard);
  ok(new Set(all).size === all.length, 'no card is dealt twice');
  t.bidAll(1, 'hold');
  ok(t.Room.publicState(t.room).play.held === true,
     'a screen is told the bids are standing to be read');
  t.open();
  ok(t.Room.publicState(t.room).play.held === false, 'and told when the moment has passed');
  ok(t.Room.publicState(t.room).turn === null,
     'once the play starts the bid turn is nobody: the seat on play is in the play');
}


part('a hand thrown in, and who may throw it');

{
  const t = started(['Ann', 'Bob', 'Cal'], { max: 2, pattern: 'down', ones: 3 });
  t.say(1, { t: 'bid', v: 1 });
  ok(t.round().bids[1] === 1, 'a bid is in');
  ok(t.say(2, { t: 'bumdeal' }) === null, 'a player calling a bum deal opens a vote');
  ok(t.room.vote && t.room.vote.by === 2, 'and it says who asked');
  ok(t.round().bids[1] === 1, 'the hand is not thrown in on one voice');
  t.say(0, { t: 'vote', agree: true });
  ok(t.room.vote.yes.length === 2, 'a second player agrees');
  t.say(1, { t: 'vote', agree: false });
  ok(t.room.vote === null, 'one "no" ends the vote');
  ok(t.round().bids[1] === 1, 'and the hand stands');

  t.say(2, { t: 'bumdeal' });
  t.say(0, { t: 'vote', agree: true });
  t.say(1, { t: 'vote', agree: true });
  ok(t.room.vote === null && t.round().bids.every((b) => b === null), 'every player agreeing throws the hand in');
  ok(t.round().redeals === 1, 'and the re-deal is counted');

  t.say(1, { t: 'bid', v: 1 });
  ok(t.say(0, { t: 'bumdeal' }) === null && t.round().redeals === 2, 'the dealer can call one alone');
  t.say(1, { t: 'bid', v: 1 });
  ok(t.say('host', { t: 'bumdeal' }) === null && t.round().redeals === 3, 'and so can whoever runs the table');
  ok(/no hand to throw in/.test(t.say('host', { t: 'bumdeal' }) || '') === false, 'while a hand is in play');

  t.Room.toLobby(t.room);
  ok(/no hand to throw in/.test(t.say('host', { t: 'bumdeal' }) || ''), 'but not in the lobby');
}

{
  // whoever asked can take it back, and so can the table host
  const t = started(['Ann', 'Bob', 'Cal'], { max: 2, pattern: 'down', ones: 3 });
  t.say(2, { t: 'bumdeal' });
  ok(/only the table host or the player who asked/.test(t.say(1, { t: 'votecancel' }) || ''),
     'a bystander cannot cancel the vote');
  ok(t.say(2, { t: 'votecancel' }) === null && t.room.vote === null, 'the player who asked can');
  t.say(2, { t: 'bumdeal' });
  ok(t.say('host', { t: 'votecancel' }) === null && t.room.vote === null, 'and so can whoever runs the table');
}

part('who may send what, and when');

/* Every guard on the message table, read once. A message that forgets one is
   a message anybody can send at any time. */
{
  const t = started(['Ann', 'Bob', 'Cal'], { max: 2, pattern: 'down', ones: 3 });
  ok(t.say('host', { t: 'nosuchthing' }) === 'unknown message', 'a message nobody wrote is refused');

  // who
  ok(/only the table host/.test(t.say(1, { t: 'config', patch: { max: 9 } }) || ''),
     'a player who does not run the table cannot change the rules');
  ok(/only the table host/.test(t.say(1, { t: 'start' }) || ''), 'nor start the game');
  ok(/only the table host/.test(t.say(1, { t: 'undo' }) || ''), 'nor go back');
  ok(/only the table host/.test(t.say(1, { t: 'reset' }) || ''), 'nor put the table back to the lobby');
  ok(/only players/.test(t.say('host', { t: 'bid', v: 1 }) || ''), 'the host screen holds no cards, so it does not bid');
  ok(/only players/.test(t.say('host', { t: 'vote', agree: true }) || ''), 'and does not vote');

  // the seat that runs the table can be passed on, but not taken
  ok(t.room.captainId === t.room.seats[0].id, 'the first player to sit down runs the table');
  ok(/only the table host/.test(t.say(1, { t: 'captain', id: t.room.seats[1].id }) || ''),
     'a player cannot take it for themselves');
  ok(t.say(0, { t: 'captain', id: t.room.seats[2].id }) === null, 'the one who has it can pass it on');
  ok(t.room.captainId === t.room.seats[2].id, 'and it lands');
  ok(t.say('host', { t: 'captain', id: t.room.seats[0].id }) === null, 'the host screen can hand it back');
  ok(t.say('host', { t: 'captain', id: 'nobody' }) === 'no such seat', 'to a seat at this table only');

  // phase
  ok(/the game has started/.test(t.say(0, { t: 'config', patch: { max: 1 } }) || ''),
     'the rules are settled before the cards go out');
  ok(/already started/.test(t.say(0, { t: 'start' }) || ''), 'a game already going is not started again');
  ok(/not allowed now/.test(t.say(0, { t: 'seatMove', id: t.room.seats[1].id, to: 0 }) || ''),
     'and no seat moves once the game is on');
  ok(/not allowed now/.test(t.say(0, { t: 'kick', id: t.room.seats[1].id }) || ''), 'nor is anybody put out of one');
  ok(/the game has started/.test(t.say(0, { t: 'addbot', }) || ''), 'nor does the table add a player');
  ok(/before the game starts/.test(t.say(0, { t: 'rename', name: 'Zed' }) || ''),
     'nor does a name change: the scorecard is a column under it');
  ok(/only a player/.test(t.say('host', { t: 'rename', name: 'Zed' }) || ''), 'and the host screen has no name to change');

  // deck
  ok(/real cards/.test(t.say(1, { t: 'dealt' }) || ''),
     'a table with real cards deals nothing on the phones, so it is told nothing');
  ok(/this table plays with real cards/.test(t.say(1, { t: 'play', card: 'AS' }) || ''),
     'and no card is played on it');
  ok(/real cards/.test(t.say('host', { t: 'playfor', }) || ''), 'nor played for a seat');
  ok(/real cards/.test(t.say('host', { t: 'playout', }) || ''), 'nor is a seat handed to auto-play');
}

{
  const t = started(['Ann', 'Bob', 'Cal'], { deck: 'virtual', max: 3, pattern: 'down', ones: 1 });
  ok(/count themselves/.test(t.say(1, { t: 'trick', p: 0 }) || ''),
     'a table dealt on the phones counts its own tricks');
  ok(/count themselves/.test(t.say(1, { t: 'trickback' }) || ''), 'and takes them back itself');
  ok(/no hand in play/.test(t.say(1, { t: 'play', card: 'AS' }) || ''), 'no card goes down before the bids are in');
  t.bidAll(1);
  /* A phone says its deal has been watched. It can arrive after the bidding
     has closed -- the table bid that seat's hand while the cards were still in
     the air, or the phone is coming back to a round that moved on -- and it is
     nothing to record then, not something to tell a player off for. */
  t.casts.n = 0;
  ok(t.say(1, { t: 'dealt' }) === null, 'a deal watched after the bids are in is quiet, not a refusal');
  ok(t.casts.n === 0, 'and says nothing to the table either');
}

{
  // the lobby: the rules are the table host's until the cards go out
  const t = table().sit(['Ann', 'Bob']);
  ok(t.say(0, { t: 'config', patch: { max: 2, pattern: 'down', ones: 3 } }) === null,
     'the table host sets the rules in the lobby');
  ok(t.room.cfg.max === 2 && t.room.cfg.ones === 3, 'and they land');
  ok(t.say(0, { t: 'config', patch: { max: 99 } }) === null && t.room.cfg.max === G.maxCardsFor(2),
     'a hand bigger than the deck is cut down to it');
  // which accolades the table hands out, in the game's own order, its own names only
  ok(t.room.cfg.accolades === undefined, 'a new table has not been asked which accolades it wants');
  ok(t.say(0, { t: 'config', patch: { accolades: ['blank', 'tricks', 'nosuchthing'] } }) === null,
     'the table host picks them');
  ok(t.room.cfg.accolades.join(',') === 'tricks,blank',
     'kept in the order the game works them out, and nothing it does not know  got '
     + t.room.cfg.accolades.join(','));
  ok(t.say(0, { t: 'config', patch: { accolades: 'all of them' } }) === null
     && t.room.cfg.accolades.join(',') === 'tricks,blank', 'and a list that is not one changes nothing');
  ok(t.say(0, { t: 'config', patch: { accolades: [] } }) === null && t.room.cfg.accolades.length === 0,
     'a table can hand out none of them');
  ok(t.say(0, { t: 'seatMove', id: t.room.seats[1].id, to: 0 }) === null, 'a seat is dragged to a new place');
  ok(t.room.seats.map((s) => s.name).join() === 'Bob,Ann', 'and lands there');
  ok(t.room.captainId === t.room.seats[1].id, 'and dragging it does not change who runs the table');
  ok(t.say(t.boss(), { t: 'addbot' }) === null, 'the table host adds a player the table provides');
  ok(t.room.seats.length === 3 && t.room.seats[2].bot, 'and it takes a seat');
  ok(t.room.cfg.deck === 'virtual', 'a bot needs cards to hold, so the deck goes onto the phones');
  ok(/take the bots off the table first/.test(t.say(t.boss(), { t: 'config', patch: { deck: 'physical' } }) || ''),
     'and the table cannot go back to real cards while one is sitting there');
  const boss = t.room.captainId;
  ok(t.say(t.boss(), { t: 'kick', id: t.room.seats[2].id }) === null && t.room.seats.length === 2, 'a seat is put out');
  ok(t.say(t.boss(), { t: 'config', patch: { deck: 'physical' } }) === null && t.room.cfg.deck === 'physical',
     'and then the real cards come back');
  ok(t.room.captainId === boss, 'through all of which the same player runs the table');

  // a name is changed in the lobby, and is one seat's
  const bob = t.room.seats.findIndex((x) => x.name === 'Bob');
  ok(t.say(bob, { t: 'rename', name: '  Robert  ' }) === null && t.room.seats[bob].name === 'Robert',
     'a player changes their own name, trimmed');
  ok(t.say(bob, { t: 'rename', name: 'ann' }) === 'that name is taken', 'but not to a name already at the table, in any case');
  ok(t.say(bob, { t: 'rename', name: '   ' }) === 'type a name', 'and not to nothing');
  ok(t.say(bob, { t: 'rename', name: 'A name far longer than sixteen' }) === null
     && t.room.seats[bob].name === 'A name far longe', 'a long name is cut to sixteen, as it is on joining');
  ok(t.say(bob, { t: 'rename', name: 'A name far longe' }) === null, 'the same name again changes nothing');
}

{
  // a table needs two to start
  const t = table().sit(['Ann']);
  ok(/at least 2 players/.test(t.say(0, { t: 'start' }) || ''), 'one player is not a game');
  t.sit(['Bob']);
  ok(t.say(0, { t: 'start' }) === null && t.room.phase === 'bid', 'two are');
}

{
  // the table is full at eight
  const t = table().sit(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  ok(/the table is full/.test(t.say(0, { t: 'addbot' }) || ''), 'a ninth player does not fit');
}


part('leaving on purpose, which is not the same as a phone going quiet');

{
  // before the cards go out, a seat simply goes
  const t = table().sit(['Ann', 'Bob', 'Cal']);
  ok(t.say(1, { t: 'leave' }) === null, 'a player leaves the lobby');
  ok(t.room.seats.map((s) => s.name).join() === 'Ann,Cal', 'and the seat goes with them');
}

{
  /* Once the game is on it cannot: the scorecard is a column for every seat
     and the rounds already played are that player's. So the seat stays,
     marked gone, and the table plays its hand from there on. */
  const t = started(['Ann', 'Bob', 'Cal'], { deck: 'virtual', max: 3, pattern: 'down', ones: 1 });
  ok(t.say(1, { t: 'leave' }) === null, 'a player leaves a game in play');
  ok(t.room.seats.length === 3, 'the seat stays: the scorecard is a column for it');
  ok(t.room.seats[1].left && !t.room.seats[1].online, 'marked gone, with nobody behind it');
  ok(G.tablePlays(t.room.seats[1], t.room.cfg), 'and the table plays its hand from here on');
  ok(G.awaySeat(t.room) === -1, 'so the table is not waiting on it');
  ok(G.tablePlaysOn(t.room), 'and it does play it: Ann and Cal are still in the game');
}

{
  /* The table plays a hand nobody is behind -- while somebody is there to see
     it. A player alone with bots who leaves came back to a game that had
     played itself out: the bots bid the hand that was left, the bidding
     closed, and the tricks ran to the end with nobody watching. */
  const t = table().sit(['Ann']).sit(['Otter', 'Heron'], { bot: true })
    .rules({ deck: 'virtual', max: 3, pattern: 'down', ones: 1 });
  t.Room.startGame(t.room);
  ok(G.tablePlaysOn(t.room) && t.Bots.anyAuto(t.room), 'with a player at it, the table plays the bots\' hands');
  ok(t.say(0, { t: 'leave' }) === null, 'the one player leaves');
  ok(!G.tablePlaysOn(t.room), 'and now nobody is in the game to see a card played');
  ok(!t.Bots.anyAuto(t.room), 'so the table has nothing to do');
  t.Bots.nudge(t.room);
  ok(!t.room.botTimer, 'and nothing is set going: the game stands where it was left');
  const bids = JSON.stringify(t.round().bids);
  t.room.seats[0].left = false;                  // the phone comes back to the seat
  ok(JSON.stringify(t.round().bids) === bids, 'the round is untouched by the wait');
  ok(G.tablePlaysOn(t.room) && t.Bots.anyAuto(t.room), 'and with the player back the table plays on');
}

{
  /* ...and it plays on for somebody watching it, with no player in the game at
     all. A table of bots is worth looking at -- a screen showing one, or the
     dev page -- and standing still is no use to whoever is looking. `seen` is
     the server's word for it; here it is set by hand. */
  const t = table().sit(['Otter', 'Heron'], { bot: true })
    .rules({ deck: 'virtual', max: 3, pattern: 'down', ones: 1 });
  t.Room.startGame(t.room);
  ok(!G.tablePlaysOn(t.room) && !t.Bots.anyAuto(t.room),
     'a table of bots with nobody at it stands still');
  t.Bots.nudge(t.room);
  ok(!t.room.botTimer, 'and nothing is set going');

  t.room.seen = true;                            // a screen opens on it
  ok(G.tablePlaysOn(t.room) && t.Bots.anyAuto(t.room),
     'somebody watching is somebody to play it for');
  t.Bots.nudge(t.room);
  ok(!!t.room.botTimer, 'so the bots are set going');

  t.room.seen = false;                           // and the last window goes
  t.Bots.nudge(t.room);
  ok(!t.room.botTimer, 'and it stands still again when nobody is looking');
}

{
  /* Watching a table play itself is no good without a way to stop it. Pause
     holds the hands the table plays for itself and nothing else. */
  const t = table().sit(['Ann']).sit(['Otter'], { bot: true })
    .rules({ deck: 'virtual', max: 3, pattern: 'down', ones: 1 });
  t.Room.startGame(t.room);
  ok(G.tableSelfPlays(t.room), 'a table with a bot at it plays a hand of its own');
  ok(t.Bots.anyAuto(t.room), 'and it is playing it');

  ok(t.say(0, { t: 'pause', on: true }) === null, 'the table host stops the table');
  ok(t.room.paused === true, 'and it is stopped');
  ok(!t.Bots.anyAuto(t.room), 'so it plays none of its own hands');
  t.Bots.nudge(t.room);
  ok(!t.room.botTimer, 'and nothing is set going');
  ok(G.tableSelfPlays(t.room),
     'but it is still a table that plays a hand, so the control stays offered');

  /* A stopped table is stopped for everybody. Whichever seat is on turn --
     Ann's or the bot's -- nothing lands on it until the table is let go. */
  const turn = G.turnSeat(t.round(), 2);
  ok(/stopped/.test(t.say(turn, { t: 'bid', v: 1 }) || ''), 'and no bid lands while it is stopped');
  ok(t.round().bids[turn] === null, 'so the seat on turn has still not bid');

  // But everything that puts a game right does: that is what it was stopped for.
  ok(t.say(0, { t: 'bumdeal' }) === null, 'a hand can still be thrown in');
  ok(t.room.paused === true, 'and throwing it in does not let the table go');

  ok(t.say(0, { t: 'pause', on: false }) === null, 'and the table is let go again');
  ok(!t.room.paused && t.Bots.anyAuto(t.room), 'so it plays on');

  // Said outright, so two screens pressing at once agree where it lands.
  t.say(0, { t: 'pause', on: true });
  t.say('host', { t: 'pause', on: true });
  ok(t.room.paused === true, 'stopping a stopped table leaves it stopped');

  // A pause belongs to the game it was called in.
  t.Room.startGame(t.room);
  ok(t.room.paused === false, 'and a new game does not start somebody else\'s pause');
}

{
  /* A table of people with real cards has no hand of its own to hold, and it
     is still the table most likely to want to stop for a moment: the food
     arrives, or somebody is arguing about a rule. So it stops too, and while
     it is stopped the count is refused along with everything else. */
  const t = table().sit(['Ann', 'Bob']).rules({ max: 3, pattern: 'down', ones: 1 });
  t.Room.startGame(t.room);
  ok(!G.tableSelfPlays(t.room), 'a table of players plays no hand of its own');
  ok(G.canPause(t.room), 'and it can be stopped all the same');
  t.bidAll(1);
  ok(t.say(0, { t: 'pause', on: true }) === null, 'the table host stops it');
  ok(/stopped/.test(t.say(0, { t: 'trick', p: 0 }) || ''), 'and no trick is counted while it is');
  ok(t.say(0, { t: 'pause', on: false }) === null, 'let go again');
  ok(t.say(0, { t: 'trick', p: 0 }) === null, 'and the count goes on');

  const v = table().sit(['Ann', 'Bob']).rules({ deck: 'virtual', max: 3, pattern: 'down', ones: 1 });
  v.Room.startGame(v.room);
  ok(v.say(0, { t: 'pause', on: true }) === null,
     'so does a table where every seat has somebody behind it');
  ok(/only the table host/.test(v.say(1, { t: 'pause', on: true }) || ''),
     'and a player who does not run the table cannot stop it');

  // Nothing to stop before the cards are out, or once they are all in.
  const q = table().sit(['Ann', 'Bob']).rules({ max: 3, pattern: 'down', ones: 1 });
  ok(/no hand in play/.test(q.say(0, { t: 'pause', on: true }) || ''),
     'and a lobby has no hand in play to stop');
}

{
  // a phone that is not coming back is handed over by whoever runs the table
  const t = started(['Ann', 'Bob', 'Cal'], { deck: 'virtual', max: 3, pattern: 'down', ones: 1 });
  ok(/only the table host/.test(t.say(2, { t: 'playout' }) || ''), 'no player hands over another\'s seat');
  ok(/is at the table/.test(t.say('host', { t: 'playout' }) || ''), 'and a seat whose phone is here is not handed over');
  t.room.seats[1].online = false;
  ok(t.say('host', { t: 'playout' }) === null, 'a seat that is away can be');
  ok(t.room.seats[1].left, 'and it is marked gone, exactly as if that player had left');
  ok(/already has/.test(t.say('host', { t: 'playout' }) || ''), 'once only');
}

{
  // the seat that runs the table never goes to somebody who cannot run it
  const t = table().sit(['Ann', 'Bob']).sit(['Bot'], { bot: true });
  ok(t.room.captainId === t.room.seats[0].id, 'Ann runs the table');
  t.Room.startGame(t.room);
  t.say(0, { t: 'leave' });
  ok(t.room.captainId === t.room.seats[1].id, 'she leaves, and it passes to the other player');
  t.say(1, { t: 'leave' });
  ok(t.room.captainId === t.room.seats[0].id,
     'and with both gone it waits on a player rather than a bot: their token still works, so coming back takes it back');
  ok(!G.tablePlaysOn(t.room), 'and the bot does not play the game out on its own');
}

part('a seat nobody is behind');

/* The clock runs while nobody holds a seat, and while the table is stopped on
   it. It never runs on a player who is at the table with nothing to do: at a
   table with real cards a phone is touched to bid and not again, and dropping
   those players would empty a room of people sat around a table. */
const MS = { idle: 5 * 60e3, warn: 60e3 };
const later = (mins) => Date.now() + mins * 60e3;

{
  const t = table().sit(['Ann', 'Bob', 'Cal']);
  t.room.seats[1].online = false;
  ok(!t.Room.idleSeat(t.room, 0), 'a phone open in the lobby is never idle, however long it waits');
  ok(t.Room.idleSeat(t.room, 1), 'a seat with no window on it is');
  let out = t.Room.sweep(t.room, later(4), MS);
  ok(t.room.seats.length === 3 && !out.gone.length, 'and it keeps its seat until the clock runs out');
  out = t.Room.sweep(t.room, later(6), MS);
  ok(t.room.seats.length === 2 && out.gone.length === 1, 'then the seat goes');
  ok(out.gone[0].how === 'kicked' && out.gone[0].seat.name === 'Bob', 'and the server is told whose phone to tell');
  ok(t.room.seats.every((x) => x.name !== 'Bob'), 'nothing of a lobby seat is kept: nothing was played');
}

{
  const t = table().sit(['Ann', 'Bob']).sit(['Bot'], { bot: true });
  t.room.seats[1].online = false;
  t.Room.sweep(t.room, later(6), { idle: 0, warn: 0 });
  ok(t.room.seats.length === 3, 'a clock set to nought puts nobody out');
  const b = table().sit(['Ann']).sit(['Bot'], { bot: true });
  b.room.seats[1].online = false;
  b.Room.sweep(b.room, later(60), MS);
  ok(b.room.seats.length === 2, 'and a bot is never away, whatever its seat says');
}

{
  // a table of stand-ins on the dev page is nobody's game
  const t = table().sit(['Ann', 'Bob'], { online: false });
  t.room.stand = true;
  t.Room.sweep(t.room, later(60), MS);
  ok(t.room.seats.length === 2, 'the stand-ins on a dev table keep their seats');
}

{
  // in a game, the clock runs on the seat the table is stopped on
  const t = started(['Ann', 'Bob', 'Cal'], { deck: 'virtual' });
  const p = G.onTurn(t.room);
  ok(p === 1, 'the player left of the dealer bids first');
  ok(t.Room.idleSeat(t.room, p), 'the table is stopped on them, so their clock runs');
  ok(!t.Room.idleSeat(t.room, 2), 'and the players waiting their turn are not idle at all');
  let out = t.Room.sweep(t.room, later(4.5), MS);
  ok(out.warn.length === 1 && out.warn[0] === p, 'a minute before the end, the phone is asked whether anybody is there');
  ok(!t.Room.sweep(t.room, later(4.6), MS).warn.length, 'and asked once, not again on every look');
  ok(!out.gone.length && !out.changed, 'nothing has happened to the seat yet');
  out = t.Room.sweep(t.room, later(6), MS);
  ok(out.gone.length === 1 && out.gone[0].how === 'left', 'the clock runs out and the hand is handed over');
  ok(t.room.seats[p].left && t.room.seats.length === 3,
     'the seat keeps its name and its column: the rounds already played are that player\'s');
  ok(G.tablePlays(t.room.seats[p], t.room.cfg), 'and auto-play has the hand from here on');
}

{
  // any message a phone sends winds the clock back
  const t = started(['Ann', 'Bob', 'Cal'], { deck: 'virtual' });
  const p = G.onTurn(t.room);
  t.room.seats[p].idleAt = Date.now() - 4.5 * 60e3;    // stopped on them, a while ago now
  ok(t.Room.sweep(t.room, Date.now(), MS).warn.length === 1, 'the phone is asked');
  ok(t.room.seats[p].warned, 'and the table remembers asking');
  t.say(p, { t: 'here' });
  ok(!t.room.seats[p].warned, 'it answers, and the table stops asking');
  ok(!t.Room.sweep(t.room, later(1), MS).gone.length,
     'a minute later the seat is still theirs: the answer wound the clock back');
  ok(t.Room.sweep(t.room, later(6), MS).gone.length === 1, 'and the clock runs again from the answer');
}

{
  // with real cards the table can hold nobody's hand, so it takes none away
  const t = started(['Ann', 'Bob', 'Cal']);
  t.room.seats[1].online = false;
  const out = t.Room.sweep(t.room, later(60), MS);
  ok(!out.gone.length && !t.room.seats[1].left, 'a quiet seat at a table with real cards keeps its hand');
  ok(t.room.seats.length === 3, 'and its place');
  ok(out.changed && t.room.stalled && t.room.stalled.id === t.room.seats[1].id,
     'the table stops on that seat instead, and says which');
  ok(t.room.stalled.ms === MS.idle, 'and how long it waited, so every screen can say so');
  ok(/only the table host/.test(t.say(1, { t: 'carryon' }) || ''), 'no player starts the table again');
  ok(t.say('host', { t: 'carryon' }) === null, 'whoever runs the table does');
  ok(!t.room.stalled, 'and the table is not stopped any more');
  t.Room.sweep(t.room, later(120), MS);
  ok(!t.room.stalled, 'nor stopped again on the seat the host has looked at');
  ok(!t.room.seats[1].left && t.room.seats.length === 3, 'and still nothing is taken from it');
}

/* Once the bids are in and the tricks are being counted, a table with real
   cards waits on nobody: the only clock running is on a seat with no window on
   it. These two are that seat, and nothing else. */
{
  // the seat comes back by itself, and the table takes its own notice down
  const t = started(['Ann', 'Bob', 'Cal']);
  t.bidAll(1);
  t.room.seats[2].online = false;
  t.Room.sweep(t.room, later(6), MS);
  ok(t.room.stalled && t.room.stalled.id === t.room.seats[2].id, 'the table is stopped on the seat that went');
  t.room.seats[2].online = true;
  ok(t.Room.sweep(t.room, later(7), MS).changed, 'the player comes back');
  ok(!t.room.stalled, 'and the table says nothing about it any more');
  ok(/not stopped on anybody/.test(t.say('host', { t: 'carryon' }) || ''),
     'there is nothing left to carry on from');
}

{
  // and one that comes back and goes again is a fresh question for the host
  const t = started(['Ann', 'Bob', 'Cal']);
  t.bidAll(1);
  t.room.seats[2].online = false;
  t.Room.sweep(t.room, later(6), MS);
  t.say('host', { t: 'carryon' });
  t.room.seats[2].online = true;
  t.Room.sweep(t.room, later(7), MS);
  t.room.seats[2].online = false;
  ok(t.Room.sweep(t.room, later(13), MS).changed && !!t.room.stalled,
     'a seat somebody came back to and left again stops the table afresh');
}

{
  // a game that is over is left exactly as it was played
  const t = started(['Ann', 'Bob'], { deck: 'virtual', max: 1, pattern: 'down', ones: 1 });
  t.bidAll(0);
  while (t.room.phase !== 'done') {
    const p = G.onTurn(t.room);
    if (p === null) { t.settle(); continue; }
    t.say(p, { t: 'play', card: t.room.play.hands[p][0] });
  }
  t.room.seats.forEach((x) => { x.online = false; });
  t.Room.sweep(t.room, later(60), MS);
  ok(t.room.seats.length === 2 && !t.room.seats.some((x) => x.left), 'nobody is put out of a finished game');
}

/* A table nobody is at takes itself away. It is not a game ending: nothing is
   scored and nothing is filed. The taking away is the server's -- it is what
   holds the tables -- so what is checked here is the answer. */
const TMS = { idle: 5 * 60e3, warn: 60e3, table: 5 * 60e3, game: 30 * 60e3 };
{
  const t = table().sit(['Ann', 'Bob']);
  ok(!t.Room.idleTable(t.room, later(60), TMS), 'a table with a player at it is nobody\'s to take away');
  t.room.seats.forEach((x) => { x.online = false; });
  ok(!t.Room.idleTable(t.room, later(4), TMS), 'an empty lobby is kept for a while');
  ok(t.Room.idleTable(t.room, later(6), TMS), 'and then it goes');
  t.room.seen = true;
  ok(!t.Room.idleTable(t.room, later(60), TMS), 'unless a screen is watching it');
  t.room.seen = false;
  ok(!t.Room.idleTable(t.room, later(60), { table: 0, game: 0 }), 'and a clock at nought never takes one away');
}

{
  // a game in play is given longer: it is one people mean to come back to
  const t = started(['Ann', 'Bob'], { deck: 'virtual' });
  t.room.seats.forEach((x) => { x.online = false; });
  ok(!t.Room.idleTable(t.room, later(10), TMS), 'a game in play is not taken away at the lobby\'s clock');
  ok(t.Room.idleTable(t.room, later(31), TMS), 'but it does not sit there for ever either');
  t.Room.finishGame(t.room);
  ok(t.Room.idleTable(t.room, later(6), TMS), 'and a game that is over goes at the shorter clock');
}

{
  // a table of bots is nobody at a table, and so are the stand-ins on a dev page
  const t = table().sit(['Ann']).sit(['Bot'], { bot: true });
  t.room.seats[0].online = false;
  ok(t.Room.idleTable(t.room, later(6), TMS), 'a bot does not keep a table up');
  const d = table().sit(['Amy', 'Hugh'], { online: false });
  d.room.stand = true;
  ok(d.Room.idleTable(d.room, later(6), TMS), 'nor do the stand-ins on a dev table');
  ok(d.Room.sweep(d.room, later(6), TMS).end, 'and the sweep says so, seats untouched');
  ok(d.room.seats.length === 2, 'having taken nothing off it');
}

part('the tables this server is running');

/* A table's four characters are the only door it has. A listing of them handed
   to every browser on the network would open every table to anybody who could
   reach the page, so it is answered to the machine the server runs on and
   nowhere else. */
{
  const { isLocal } = require('./lib/http.js');
  ok(isLocal('127.0.0.1'), 'the machine the server runs on may read the tables it is running');
  ok(isLocal('::1') && isLocal('::ffff:127.0.0.1'), 'by whichever name the loopback goes under');
  ok(isLocal('127.0.0.53'), 'the whole loopback range is that machine');
  ok(!isLocal('192.168.1.5') && !isLocal('10.0.0.2') && !isLocal('::ffff:192.168.1.5'),
     'a phone on the network may not: it has the code or it has nothing');
  ok(!isLocal('') && !isLocal(undefined) && !isLocal(null), 'and neither may an address that is not one');
}

part('a table writes down what happened to it');

/* A point a thing that happened, in the order it happened, and a picture only
   where the game could not be worked out again without one. */
{
  const t = table().sit(['Ann', 'Bob']).rules({ deck: 'virtual', max: 2, pattern: 'down', ones: 1 });
  t.Room.startGame(t.room);
  const dealt = JSON.stringify(t.room.play.hands);

  let p = G.turnSeat(t.round(), 2);
  while (p !== null) { t.Room.seatBid(t.room, p, 0); p = G.turnSeat(t.round(), 2); }
  t.Room.openPlay(t.room);
  let guard = 20;
  while (guard-- > 0 && t.room.play && t.room.play.hands.some((h) => h.length)) {
    const on = t.room.play.turn;
    if (on === null) break;
    const can = G.legalPlays(t.room.play.hands[on], t.Room.Deck.ledSuit(t.room.play));
    const w = t.Room.Deck.putCard(t.room, on, can[0]);
    if (w !== null) t.Room.Deck.settleTrick(t.room, w);
  }

  ok(t.trail() === 'G R b b s c c w s c c w e R',
     'a round reads as it was played  got ' + t.trail());

  const first = t.points('R')[0];
  ok(first.w === 'game' && first.i === 0 && first.d === 0,
     'the first round says a game brought it  got ' + first.w);
  ok(JSON.stringify(first.f.play.hands) === dealt,
     'and carries the hands as they were dealt, which no shuffle would find again');
  ok(first.f.rounds[0].trump === t.room.rounds[0].trump, 'and the trump turned with them');
  ok(!('chat' in first.f) && !('hostToken' in first.f) && !('trail' in first.f),
     'a picture carries no talk, no key and not itself');
  ok(!('token' in first.f.seats[0]) && !('watch' in first.f.seats[0]),
     'and hands out no seat of the table it is a picture of');

  const cards = t.points('c');
  ok(cards.length === 4 && cards.every((e) => typeof e.x === 'string' && e.p >= 0),
     'every card is written down, with the seat that played it  got ' + cards.length);
  ok(t.points('w').length === 2, 'and every trick, with the seat that took it');
}

{
  // What a picture is for: the deal. So a round has one whichever way it opened.
  const ways = [
    ['a game starting', (t) => t.Room.startGame(t.room), 'game'],
    ['a round scoring', (t) => { t.Room.startGame(t.room); t.room.trail.length = 0;
                                 t.Room.scoreRound(t.room, [1, 0]); }, 'next'],
    ['a hand thrown in', (t) => { t.Room.startGame(t.room); t.room.trail.length = 0;
                                  t.Room.bumDeal(t.room); }, 'bum'],
  ];
  ways.forEach(([what, go, want]) => {
    const t = table().sit(['Ann', 'Bob']).rules({ deck: 'virtual', max: 2, pattern: 'down', ones: 1 });
    go(t);
    const r = t.points('R').pop();
    ok(r && r.w === want, `${what} opens a round that says so  got ` + (r && r.w));
    ok(r && r.f && r.f.play && r.f.play.hands.every((h) => h.length),
       'and takes a picture of the hands it dealt');
  });
}

{
  // A hand thrown in is the same round again, and says which attempt it is.
  const t = table().sit(['Ann', 'Bob']).rules({ deck: 'virtual', max: 2, pattern: 'down', ones: 1 });
  t.Room.startGame(t.room);
  t.room.trail.length = 0;
  t.Room.bumDeal(t.room);
  const r = t.points('R').pop();
  ok(r.i === 0 && r.d === 1, 'a hand thrown in is the same round, one attempt on  got '
     + r.i + ':' + r.d);
}

{
  // A step back is a thing that happened, and the round it lands on is dealt
  // again -- so the picture that follows is the one that counts.
  const t = table().sit(['Ann', 'Bob']).rules({ deck: 'virtual', max: 2, pattern: 'down', ones: 1 });
  t.Room.startGame(t.room);
  let p = G.turnSeat(t.round(), 2);
  while (p !== null) { t.Room.seatBid(t.room, p, 0); p = G.turnSeat(t.round(), 2); }
  t.room.trail.length = 0;
  t.Room.undo(t.room);
  ok(t.trail() === 'z R', 'a step back is written down, then the round it lands on  got ' + t.trail());
  ok(t.points('R')[0].w === 'undo', 'which says a step back brought it');

  // A step back that was refused is not a step back.
  const u = table().sit(['Ann', 'Bob']).rules({ deck: 'virtual', max: 2, pattern: 'down', ones: 1 });
  u.Room.startGame(u.room);
  u.room.trail.length = 0;
  ok(u.Room.undo(u.room) === 'nothing to undo' && u.trail() === '',
     'and one there was no room for is not written down at all  got ' + u.trail());
}

{
  // A seat may change its bid while it still may, and that is two things said.
  const t = table().sit(['Ann', 'Bob', 'Cal']).rules({ deck: 'virtual', max: 2, pattern: 'down', ones: 1 });
  t.Room.startGame(t.room);
  const first = G.turnSeat(t.round(), 3);
  t.room.trail.length = 0;
  t.Room.seatBid(t.room, first, 1);
  t.Room.seatBid(t.room, first, 2);
  ok(t.trail() === 'b b', 'a bid changed is two points, not one  got ' + t.trail());
  ok(t.points('b')[1].v === 2, 'the second saying what it was changed to');
}

{
  /* With real cards there are no cards to write down. What the trail keeps is
     the bids and the taps, and a tap taken back is written down too. */
  const t = table().sit(['Ann', 'Bob']).rules({ max: 2, pattern: 'down', ones: 1 });
  t.Room.startGame(t.room);
  let p = G.turnSeat(t.round(), 2);
  while (p !== null) { t.Room.seatBid(t.room, p, 0); p = G.turnSeat(t.round(), 2); }
  t.Room.openPlay(t.room);
  t.room.trail.length = 0;
  t.Room.countTrick(t.room, 0);
  t.Room.uncountTrick(t.room);
  t.Room.countTrick(t.room, 1);
  ok(t.trail() === 'w W w', 'a trick tapped, taken back, and tapped again  got ' + t.trail());
  ok(t.points('c').length === 0, 'and never a card: there are none to write down');
}

{
  // The finish carries a picture: the accolades are drawn, not worked out.
  const t = table().sit(['Ann', 'Bob']).rules({ deck: 'virtual', max: 1, pattern: 'down', ones: 1 });
  t.Room.startGame(t.room);
  t.Room.scoreRound(t.room, [1, 0]);
  const e = t.points('E')[0];
  ok(e && e.g === t.room.gameId, 'the finish is written down under the game\'s own name');
  ok(e && e.f && JSON.stringify(e.f.awards) === JSON.stringify(t.room.awards),
     'with the accolades it drew, which it would not draw the same way twice');
}

part('a game put back on a table of its own');

/* The whole of it: a game played, then put back point by point on a copy, and
   the copy asked whether it is where the real one was. Every point goes back
   through the game's own verbs, so this is also what proves a replayed table is
   one the rules could have reached.

   The places worth asking about are the ones with no picture to fall back on --
   part way through a round -- because those are the ones the copy has to play
   its way to. */
{
  const ReplayOf = require('./lib/replay.js');

  function played(cfg) {
    const t = table().sit(['Ann', 'Bob', 'Cal']).rules(cfg);
    t.Room.startGame(t.room);
    let guard = 400;
    while (guard-- > 0 && t.room.phase !== 'done') {
      const p = G.turnSeat(t.round(), 3);
      if (p !== null) { t.Room.seatBid(t.room, p, 0); continue; }
      if (!t.room.play) break;
      t.Room.openPlay(t.room);                 // the bids have had their moment
      if (t.room.play.real) { t.Room.countTrick(t.room, guard % 3); continue; }
      const on = t.room.play.turn;
      if (on === null) {
        if (!t.room.play.last) break;
        t.Room.Deck.settleTrick(t.room, t.room.play.last.winner);
        continue;
      }
      const can = G.legalPlays(t.room.play.hands[on], t.Room.Deck.ledSuit(t.room.play));
      const w = t.Room.Deck.putCard(t.room, on, can[0]);
      if (w !== null) t.Room.Deck.settleTrick(t.room, w);
    }
    return t;
  }

  const copyOf = (t, at) => {
    const Replay = ReplayOf({ Room: t.Room, G, token: () => 'wtok' });
    const copy = t.Room.create('COPY', 'ht');
    Replay.open(copy, 'TEST', t.room.trail.slice());
    Replay.seek(copy, at);
    return copy;
  };

  {
    const t = played({ deck: 'virtual', max: 2, pattern: 'down', ones: 1 });
    const trail = t.room.trail;
    ok(t.room.phase === 'done' && trail.filter((e) => e.k === 'c').length >= 9,
       'a whole game is played, cards and all  got ' + trail.map((e) => e.k).join(''));

    /* The bids of the first round, which the copy can only have by having said
       them: the picture it starts from has none. */
    const bids = trail.map((e, at) => (e.k === 'b' ? at : -1)).filter((at) => at >= 0);
    const bidding = copyOf(t, bids[2]);
    ok(JSON.stringify(bidding.rounds[0].bids) === JSON.stringify([0, 0, 0]),
       'three bids in, the copy has the three that were bid  got '
       + JSON.stringify(bidding.rounds[0].bids));
    const oneBid = copyOf(t, bids[0]);
    ok(oneBid.rounds[0].bids.filter((b) => b !== null).length === 1,
       'and one bid in, exactly one  got ' + JSON.stringify(oneBid.rounds[0].bids));

    /* Part way through the first trick: two cards down, nothing scored. There
       is no picture at this point, so the copy can only be here by having
       played the cards itself. */
    const cards = trail.map((e, at) => (e.k === 'c' ? at : -1)).filter((at) => at >= 0);
    const copy = copyOf(t, cards[1]);
    const down = copy.play.trick.map((x) => x.card);
    ok(JSON.stringify(down) === JSON.stringify([trail[cards[0]].x, trail[cards[1]].x]),
       'two cards in, the copy holds the two that were played  got ' + JSON.stringify(down));
    ok(copy.play.hands.every((h, i) => h.length === 2 - down.filter((_, k) => trail[cards[k]].p === i).length),
       'and every hand is short by exactly what it put down');
    ok(copy.idx === 0 && copy.rounds[0].tricks === null, 'with the round still unscored');

    // A whole round in: the tricks are the trail's, taken by the same seats.
    const scored = trail.findIndex((e) => e.k === 'e');
    const after = copyOf(t, scored);
    ok(JSON.stringify(after.rounds[0].tricks) === JSON.stringify(trail[scored].v),
       'a round put back scores what it scored  got ' + JSON.stringify(after.rounds[0].tricks));

    // And the end, which does have a picture: the whole card, and the awards.
    const end = copyOf(t, trail.length - 1);
    ok(JSON.stringify(end.rounds.map((r) => [r.bids, r.tricks]))
       === JSON.stringify(t.room.rounds.map((r) => [r.bids, r.tricks])),
       'played to the end, the copy has the table\'s card, bid for bid');
    ok(JSON.stringify(end.awards) === JSON.stringify(t.room.awards),
       'and the accolades it drew, which it would not draw the same way twice');
  }

  {
    // Real cards: no cards to put back, but the taps are the game.
    const t = played({ max: 2, pattern: 'down', ones: 1 });
    const trail = t.room.trail;
    ok(t.room.phase === 'done' && trail.filter((e) => e.k === 'w').length >= 3,
       'a game of real cards is played, tap by tap  got ' + trail.map((e) => e.k).join(''));
    ok(trail.every((e) => e.k !== 'c'), 'and never a card: there are none');
    /* Part way through the taps, where there is no picture: the copy can only
       have the tally by having tapped it in itself. */
    const taps = trail.map((e, at) => (e.k === 'w' ? at : -1)).filter((at) => at >= 0);
    const mid = copyOf(t, taps[0]);
    const want = [0, 0, 0];
    want[trail[taps[0]].p] += 1;
    ok(JSON.stringify(mid.play.won) === JSON.stringify(want),
       'one trick tapped, the copy has it against the seat that took it  got '
       + JSON.stringify(mid.play.won));
    ok(mid.rounds[0].tricks === null, 'and the round is not scored until it is');

    const scored = trail.findIndex((e) => e.k === 'e');
    const copy = copyOf(t, scored);
    ok(JSON.stringify(copy.rounds[0].tricks) === JSON.stringify(trail[scored].v),
       'a round of taps put back scores what it scored  got ' + JSON.stringify(copy.rounds[0].tricks));
  }

  {
    // The deal is the thing that could not be worked out again.
    const t = played({ deck: 'virtual', max: 2, pattern: 'down', ones: 1 });
    const opened = t.room.trail.findIndex((e) => e.k === 'R');
    const copy = copyOf(t, opened);
    ok(JSON.stringify(copy.play.hands) === JSON.stringify(t.room.trail[opened].f.play.hands),
       'a copy is dealt the hands the table was dealt, not a fresh shuffle');
    ok(copy.seats.every((s) => s.watch && !s.token),
       'and its seats are watched, never played: no seat of the table it copies');
    ok(copy.replay.of === 'TEST' && copy.paused === true,
       'it says what it is a copy of, and plays nothing by itself');
    ok(!copy.trail || copy.trail.length === 0, 'and writes nothing down of its own');
  }

  {
    /* A copy is watched, never played at. Nothing can reach one but a watching
       window, which is refused everything anyway -- so this is the belt under
       the braces, and it is the one that says why. */
    const t = table().sit(['Ann', 'Bob']).rules({ deck: 'virtual', max: 2, pattern: 'down', ones: 1 });
    t.Room.startGame(t.room);
    t.room.replay = { of: 'REAL', at: 0, n: 1, playing: false, points: [] };
    ok(/replay of another/.test(t.say(0, { t: 'bid', v: 1 }) || ''),
       'a copy refuses a bid, and says what it is  got ' + t.say(0, { t: 'bid', v: 1 }));
    ok(/replay of another/.test(t.say('host', { t: 'start' }) || ''),
       'and refuses the table host too: what happened has already happened');
  }

  {
    /* A step back is part of what happened too. With real cards nothing is
       dealt afterwards, so there is no picture to land on: the copy can only
       be here by having stepped back itself. */
    const t = table().sit(['Ann', 'Bob']).rules({ max: 2, pattern: 'down', ones: 1 });
    t.Room.startGame(t.room);
    let p = G.turnSeat(t.round(), 2);
    while (p !== null) { t.Room.seatBid(t.room, p, 1); p = G.turnSeat(t.round(), 2); }
    ok(t.room.phase === 'tricks', 'the bids are in and the hand is on');
    t.Room.undo(t.room);
    const copy = copyOf(t, t.room.trail.length - 1);
    ok(copy.phase === 'bid' && copy.rounds[0].bids.every((b) => b === null),
       'a step back put back takes the bids back with it  got '
       + copy.phase + ' ' + JSON.stringify(copy.rounds[0].bids));
  }

  {
    // A hand thrown in is part of what happened, so it is part of the replay.
    const t = table().sit(['Ann', 'Bob']).rules({ deck: 'virtual', max: 2, pattern: 'down', ones: 1 });
    t.Room.startGame(t.room);
    t.Room.seatBid(t.room, G.turnSeat(t.round(), 2), 1);
    t.Room.bumDeal(t.room);
    const copy = copyOf(t, t.room.trail.length - 1);
    ok(copy.rounds[0].redeals === 1 && JSON.stringify(copy.rounds[0].bids) === '[null,null]',
       'a hand thrown in is thrown in again, and the bids with it');
    ok(JSON.stringify(copy.play.hands) === JSON.stringify(t.room.play.hands),
       'and the second deal is the second deal, not a third');
  }
}

part('a table becomes a record of one');

/* The whole table replaced by a record -- what the dev page's State panel does,
   and what a replay will do to seed its copy. What a record may not say is the
   point: the code it is held under, the keys it is opened with, and the
   server's own things. */
{
  const t = table().sit(['Ann', 'Bob']).rules({ max: 2, pattern: 'down', ones: 1 });
  t.Room.startGame(t.room);
  const seats = t.room.seats.map((s) => ({ id: s.id, token: s.token, watch: s.watch }));
  const hostToken = t.room.hostToken;
  const sockets = t.room.sockets;
  t.room.seats[0].av = { ver: 'pic1' };

  // A record that says everything it is not allowed to say.
  t.Room.become(t.room, {
    code: 'HACK', hostToken: 'EVIL', sockets: null, botTimer: 99,
    phase: 'tricks', idx: 1, cfg: Object.assign({}, t.room.cfg),
    seats: seats.map((s, i) => ({ id: s.id, name: ['Zoe', 'Yan'][i], token: 'EVIL' + i, watch: 'EVIL' + i })),
    rounds: t.room.rounds, captainId: seats[0].id, firstDealerId: null,
  });

  ok(t.room.code === 'TEST', 'the code it is held under is not the text\'s to change');
  ok(t.room.hostToken === hostToken, 'nor the key the table is opened with');
  ok(t.room.sockets === sockets, 'and the server\'s own things are its own');
  ok(t.room.seats[0].token === seats[0].token && t.room.seats[1].token === seats[1].token,
     'each seat keeps the key its phone holds');
  ok(t.room.seats[0].watch === seats[0].watch, 'and the one a window watches by');
  ok(t.room.seats[0].av && t.room.seats[0].av.ver === 'pic1',
     'and its picture, which no record ever carried');

  ok(t.room.seats[0].name === 'Zoe' && t.room.phase === 'tricks' && t.room.idx === 1,
     'everything else is what the record says');
}

part('table talk');

{
  const t = table({ chatKeep: 3 }).sit(['Ann', 'Bob', 'Cal']);
  ok(t.say(0, { t: 'chat', text: 'hello' }) === null, 'a player says a line');
  ok(t.room.chat.length === 1 && t.room.chat[0].name === 'Ann', 'and it is theirs');
  ok(t.room.chat[0].n === 1, 'every line is numbered, so a page knows what is new');
  ok(/one line at a time/.test(t.say(0, { t: 'chat', text: 'and another' }) || ''),
     'and nobody says two at once');
  ok(t.say('host', { t: 'chat', text: 'from the screen' }) === null, 'the host screen speaks as the table');
  ok(t.room.chat[1].name === 'Table', 'and is named as one');
  ok(t.say(1, { t: 'chat', text: '  a  long \n line  ' }) === null, 'a line is one line, however it was typed');
  ok(t.room.chat[2].text === 'a long line', 'with the spaces squared up  got ' + JSON.stringify(t.room.chat[2].text));
  ok(t.say(0, { t: 'chat', text: '' }) === null && t.room.chat.length === 3, 'and nothing is said in silence');
  t.say(2, { t: 'chat', text: 'four' });
  ok(t.room.chat.length === 3 && t.room.chat[0].text === 'from the screen',
     'a table keeps only the last few lines, so every state does not carry a history');
  ok(t.room.chat[2].n === 4, 'and the numbering runs on past the ones let go');
}

part('the pauses a game is built around');

/* Four waits are what makes a game readable rather than a flicker: a bot
   thinks before it answers, the bids stand to be read before the hand is
   played, a finished trick lies on the table before it is gathered, and a bot
   bidding a round waits until the phones say the deal has been watched. Each
   can be turned down for a test, and the bots' two have a floor under them, so
   turning those down cannot turn them off. */
{
  const bots = (env) => {
    const was = { BOT_DELAY: process.env.BOT_DELAY, BOT_DEAL_WAIT: process.env.BOT_DEAL_WAIT };
    Object.keys(env).forEach((k) => { process.env[k] = env[k]; });
    delete require.cache[require.resolve('./lib/bots.js')];
    const B = require('./lib/bots.js')({ G, curRound: () => null, broadcast: () => {},
                                         seatBid: () => {}, playCard: () => {}, bumDeal: () => {} });
    Object.keys(was).forEach((k) => { if (was[k] === undefined) delete process.env[k]; else process.env[k] = was[k]; });
    return B;
  };
  const deck = (env) => {
    const was = process.env.TRICK_HOLD;
    if (env.TRICK_HOLD === undefined) delete process.env.TRICK_HOLD; else process.env.TRICK_HOLD = env.TRICK_HOLD;
    delete require.cache[require.resolve('./lib/deck.js')];
    const D = require('./lib/deck.js')({ G, curRound: () => null, scoreRound: () => {} });
    if (was === undefined) delete process.env.TRICK_HOLD; else process.env.TRICK_HOLD = was;
    return D;
  };

  ok(bots({}).DELAY === 1250, 'a bot thinks for a moment before it answers  got ' + bots({}).DELAY);
  ok(bots({ BOT_DELAY: '400' }).DELAY === 400, 'and the moment can be turned down');
  ok(bots({ BOT_DELAY: '1' }).DELAY === 120, 'but not to nothing: there is a floor under it');
  ok(bots({}).DEAL_WAIT === 9000, 'a bot waits on the phones for as long as a deal takes to watch');
  ok(bots({ BOT_DEAL_WAIT: '150' }).DEAL_WAIT === 150, 'and that wait can be turned down too');
  ok(deck({}).TRICK_HOLD === 2300, 'a finished trick lies on the table for a moment  got ' + deck({}).TRICK_HOLD);
  ok(deck({ TRICK_HOLD: '120' }).TRICK_HOLD === 120, 'and that moment can be turned down');
  const rm = (env) => {
    const was = process.env.BID_HOLD;
    if (env.BID_HOLD === undefined) delete process.env.BID_HOLD; else process.env.BID_HOLD = env.BID_HOLD;
    delete require.cache[require.resolve('./lib/room.js')];
    const R = require('./lib/room.js')({ G, A, token, saveGame: () => {}, DEV: false });
    if (was === undefined) delete process.env.BID_HOLD; else process.env.BID_HOLD = was;
    return R;
  };
  ok(rm({}).BID_HOLD === 2300, 'the bids stand for a moment before the hand is played  got ' + rm({}).BID_HOLD);
  ok(rm({ BID_HOLD: '120' }).BID_HOLD === 120, 'and that moment can be turned down');
  // The felt names who took the trick and gathers it in over TOOK_HOLD; a lead
  // landing while that is still on screen would cut it short.
  const felt = require('fs').readFileSync('./public/felt.js', 'utf8');
  const took = /TOOK_HOLD\s*=\s*(\d+)/.exec(felt);
  ok(took && Number(took[1]) < deck({}).TRICK_HOLD,
     'the table holds the trick longer than the phones take to gather it  got '
     + (took && took[1]) + ' against ' + deck({}).TRICK_HOLD);
  /* The cards come in round the ring while the trick is still named, so the
     sweep is spent inside that moment and costs the round nothing. */
  const sweep = /SWEEP\s*=\s*(\d+)/.exec(felt);
  ok(sweep && Number(sweep[1]) <= Number(took[1]),
     'the cards are gathered inside the moment the trick is named  got '
     + (sweep && sweep[1]) + ' against ' + (took && took[1]));
}

part('what every screen is told');

{
  const t = started(['Ann', 'Bob', 'Cal'], { max: 2, pattern: 'down', ones: 3 });
  t.room.seats[1].av = { ver: 7, data: 'a picture too big to send in every state' };
  const st = t.Room.publicState(t.room);
  ok(st.seats.every((s) => !('token' in s) && !('watch' in s)), 'a seat\'s tokens are never sent out');
  ok(st.seats[1].av === 7, 'a picture is a number, and fetched once');
  ok(st.code === 'TEST' && st.phase === 'bid', 'the table says which it is and where it is up to');
  ok(st.totals.length === 3 && st.totals.every((v) => v === 0), 'and what everybody has scored');
  ok(st.gameId === null, 'a game still in play has no file');
  ok(!('hostToken' in st), 'and the token that runs the table stays on the server');
}

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
