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

  const Room = RoomOf({ G, A, token, saveGame: (r) => saved.push(r.gameId), DEV: !!o.dev });
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
    DEV: !!o.dev, CHAT_KEEP: o.chatKeep || 100, G, send, fail: bounce, broadcast, Room, playCard,
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
    Room, room, say, said, casts, saved, Bots,
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
    // Bid the whole round through, in turn, never the forbidden number.
    bidAll(v) {
      for (let g = 0; g < room.seats.length; g++) {
        const p = G.onTurn(room);
        if (p === null) break;
        const no = G.forbiddenBid(Room.curRound(room), p, room.cfg, room.seats.length);
        const want = typeof v === 'number' ? v : 1;
        say(p, { t: 'bid', v: want === no ? (want === 0 ? 1 : want - 1) : want });
      }
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

  ok(/no such seat/i.test(t.say(1, { t: 'trick', p: 7 })), 'a trick goes to a seat at the table');
  ok(t.say(1, { t: 'trick', p: 0 }) === null, 'a player who is not the dealer counts a trick');
  ok(play().won.join() === '1,0,0' && play().last.winner === 0, 'and it lands on the seat that took it');
  ok(t.say(2, { t: 'trickback' }) === null && play().won.join() === '0,0,0', 'another player takes it back');
  ok(play().last === null, 'and nobody is shown as having taken the last one');
  ok(/no trick to take back/i.test(t.say(2, { t: 'trickback' })), 'once only');
  ok(t.say('host', { t: 'trick', p: 0 }) === null, 'the host screen counts one too');
  ok(t.room.idx === 0 && t.room.phase === 'tricks', 'and the round waits for the rest');

  t.say(0, { t: 'trick', p: 1 });
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
  t.bidAll(1);
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
  ok(/not bidding now/.test(t.say(1, { t: 'dealt' }) || ''), 'and no phone is dealt to once they are');
}

{
  // the lobby: the rules are the table host's until the cards go out
  const t = table().sit(['Ann', 'Bob']);
  ok(t.say(0, { t: 'config', patch: { max: 2, pattern: 'down', ones: 3 } }) === null,
     'the table host sets the rules in the lobby');
  ok(t.room.cfg.max === 2 && t.room.cfg.ones === 3, 'and they land');
  ok(t.say(0, { t: 'config', patch: { max: 99 } }) === null && t.room.cfg.max === G.maxCardsFor(2),
     'a hand bigger than the deck is cut down to it');
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
