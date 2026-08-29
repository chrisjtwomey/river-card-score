'use strict';
/* A table, as the game sees it.

   Everything that moves a game on is a verb here, written once: a round
   opens, a bid lands, the bidding closes, a round scores, a hand is thrown
   in, a step is taken back, the table goes back to the lobby. The protocol
   (lib/messages.js) and the dev controls (lib/dev.js) call these and add
   nothing of their own, so the two cannot drift apart.

   Nothing here knows about a socket. A verb changes the room and returns;
   telling every screen is the server's, and it does that once afterwards.
*/
module.exports = ({ G, A, token, saveGame, DEV }) => {
  const curRound = (room) => room.rounds[room.idx] || null;
  const seatIndex = (room, id) => room.seats.findIndex((s) => s.id === id);

  // The dealer, when the table plays with no real cards. It holds the hands
  // and the rules of a trick; scoring a finished round is the table's own
  // business, so it hands that back. (scoreRound is hoisted.)
  const Deck = require('./deck.js')({ G, curRound, scoreRound });

  function create(code, hostToken) {
    return {
      code,
      hostToken,
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
      gameId: null,               // the file a finished game is kept under
      finishedAt: null,
      sockets: new Set(),
      chat: [],                   // table talk, the last CHAT_KEEP lines
      chatSeq: 0,                 // every line numbered, so a page knows what is new
      lastSeen: Date.now(),
    };
  }

  // A seat, whoever sits in it: a player, a bot, or a stand-in on the dev page.
  function seat(name, extra) {
    return Object.assign({ id: token().slice(0, 8), name, token: token(), watch: token(), online: true }, extra);
  }

  function syncCfg(room) {
    const n = Math.max(2, room.seats.length);
    room.cfg.max = Math.min(room.cfg.max, G.maxCardsFor(n));
    if (!room.onesLocked) room.cfg.ones = n;
    if (room.firstDealerId && seatIndex(room, room.firstDealerId) < 0) room.firstDealerId = null;
    const boss = room.seats.find((s) => s.id === room.captainId);
    if (!boss || boss.left) {
      // Somebody has to run the table, and neither a bot nor a player who has
      // left can: it would leave a game with nobody able to move it on.
      const who = room.seats.find((s) => !s.bot && !s.left)
               || room.seats.find((s) => !s.bot) || room.seats[0];
      room.captainId = who ? who.id : null;
    }
  }

  // A player the table provides. It takes a seat like anybody else -- it has a
  // name and a hand -- and the server plays it.
  function addBot(room, name) {
    room.seats.push(seat(name, { bot: true }));
    syncCfg(room);
  }

  /* The round in play opens for its bids. This is the one place a round is
     put back to the start, whatever brought it there: a game starting, the
     last round scoring, a bum deal, a step back. With the cards dealt on the
     phones this is also where they are dealt. */
  function openRound(room) {
    const r = curRound(room);
    if (!r) return;
    r.bids = Array(room.seats.length).fill(null);
    r.tricks = null;
    room.phase = 'bid';
    room.vote = null;
    room.play = null;
    if (G.virtual(room)) Deck.dealHands(room);
  }

  /* A fresh set of rounds is a fresh game, and it gets a file of its own.
     Going back into a game that was already over does not: it writes over
     its own. */
  function startGame(room) {
    syncCfg(room);
    const first = Math.max(0, seatIndex(room, room.firstDealerId));
    room.rounds = G.buildRounds(room.cfg, room.seats.length, first);
    room.gameId = null;
    room.finishedAt = null;
    room.idx = 0;
    unfinish(room);
    openRound(room);
  }

  // The same players, no scorecard.
  function toLobby(room) {
    room.phase = 'lobby';
    room.vote = null;
    room.rounds = [];
    room.idx = 0;
    room.play = null;
    unfinish(room);
    syncCfg(room);
  }

  /* One bid, however it arrived: from a phone, from the host for an empty
     seat, or from a bot. The last bid closes the bidding, so this is the one
     place that decides it. */
  /* A phone says the round it was dealt is on its screen: the deal played out,
     or was tapped away, or was never played at all. The table waits for this
     before it bids a hand for anybody -- a bot that bids while the cards are
     still in the air has bid before anybody saw one. */
  function seatReady(room, p) {
    if (!room.play || room.play.round !== room.idx) return;
    (room.play.ready || (room.play.ready = []))[p] = true;
  }

  function seatBid(room, p, v) {
    const r = curRound(room);
    if (!r || !r.bids) return;
    r.bids[p] = v;
    if (G.turnSeat(r, room.seats.length) === null) closeBidding(room);
  }

  // The bids are in: with the cards on the phones the player left of the
  // dealer leads; with real cards the table plays and the dealer types the
  // tricks in at the end.
  function closeBidding(room) {
    room.phase = 'tricks';
    if (G.virtual(room)) Deck.startPlay(room);
  }

  // A bum deal: the cards were dealt wrong, so throw the hand in and deal it
  // again. Same dealer, same hand size, bids and tricks cleared.
  function bumDeal(room) {
    const r = curRound(room);
    if (!r) return false;
    r.redeals = (r.redeals || 0) + 1;     // before the round reopens: the screens key the deal on it
    r.trump = null;
    openRound(room);
    return true;
  }

  // The round is over, however the tricks were counted.
  function scoreRound(room, values) {
    curRound(room).tricks = values;
    room.vote = null;
    room.play = null;
    room.idx += 1;
    if (room.idx >= room.rounds.length) finishGame(room);
    else openRound(room);
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

  /* One step back: the last round's tricks, or this round's bids, or the
     round before. Returns the line to say when there is nothing to take
     back, else null. */
  function undo(room) {
    const n = room.seats.length;
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
    } else return 'nothing to undo';
    // With the cards dealt on the phones those cards are gone, so whichever
    // step was taken back, the round it landed on is dealt again from its bids.
    if (G.virtual(room)) openRound(room);
    return null;
  }

  /* Is the table stopped, waiting on this one seat? Nobody may bid or play out
     of turn, so a seat that is on turn holds up everybody else. It is the one
     moment where a player who has lost their seat can be let back in on nothing
     but their name: the table has gone nowhere without them, and everybody at it
     can see who is missing. */
  function waitingOn(room, p) {
    if (p < 0) return false;
    if (G.onTurn(room) === p) return true;
    // With real cards the dealer types the tricks in, and until they do the
    // table goes nowhere without them.
    const r = curRound(room);
    return room.phase === 'tricks' && !G.virtual(room) && !!r && r.dealer === p;
  }

  // What every screen is told. Never a hand: the server adds each socket's own.
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
                                      bot: !!s.bot, left: !!s.left,
                                      av: s.av ? s.av.ver : null })),
      firstDealerId: room.firstDealerId,
      captainId: room.captainId,
      rounds: room.rounds,
      idx: room.idx,
      turn: (room.phase === 'bid' && r) ? G.turnSeat(r, n) : null,
      vote: (room.vote && room.vote.round === room.idx) ? room.vote : null,
      totals: n ? G.totalsWithBonus(room.cfg, room.rounds, n, bonus) : [],
      bonus,                          // what the accolades paid, once they are drawn
      awards: room.awards || null,    // the three drawn at the end
      gameId: room.phase === 'done' ? (room.gameId || null) : null,
      play: Deck.playPublic(room),    // the cards on the table, never the hands
      chat: room.chat,                // what has been said at this table
      dev: DEV,                       // the host screen offers the dev page when it is on
      // A TV screen that runs this table is at it. The table host's phone
      // then knows the code is already up on a wall, and says so.
      tv: Array.from(room.sockets).some((w) => w.ctx && w.ctx.role === 'host'),
    };
  }

  return { curRound, seatIndex, Deck, create, seat, syncCfg, addBot, openRound, startGame, toLobby,
           seatBid, seatReady, closeBidding, bumDeal, scoreRound, finishGame, unfinish, undo,
           waitingOn, publicState };
};
