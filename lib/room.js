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
module.exports = ({ G, A, token, saveGame, DEV, Trail }) => {
  /* What happened, written down as it happens. A verb pushes one small object
     and returns; the server writes them down at the one moment something has
     changed. A table built without a trail simply keeps none. */
  const T = Trail || { point() {}, frame() { return null; } };
  const curRound = (room) => room.rounds[room.idx] || null;
  const seatIndex = (room, id) => room.seats.findIndex((s) => s.id === id);

  // The dealer, when the table plays with no real cards. It holds the hands
  // and the rules of a trick; scoring a finished round is the table's own
  // business, so it hands that back. (scoreRound is hoisted.)
  const Deck = require('./deck.js')({ G, curRound, scoreRound, T });

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
      paused: false,              // the table plays none of its own hands until let go
      trail: [],                  // what has happened since the last time it was written down
      sockets: new Set(),
      seen: false,                // a screen is watching: the server's own, off the sockets
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

  /* The table becomes a record of one -- the same shape lib/tables.js writes to
     disk. What it keeps is everything a record is not allowed to say: the code,
     which is the key the table is held under; the keys the table is opened
     with; and the server's own things, which no record ever carried.

     Each seat keeps its picture and its keys by id. A record read off a real
     table carries neither, so a paste that has been round-tripped must not
     leave the table unopenable -- and one that invents them must hand nobody a
     way in.

     This is not lib/tables.js's SERVERS_OWN and must not be folded into it:
     that list is what is never written down, and the code and the host token
     are written down and still survive this. */
  const OURS = ['code', 'hostToken', 'sockets', 'seen', 'botTimer', 'bidTimer', 'trail', 'replay', 'replayTimer'];

  function become(room, rec) {
    const av = new Map(room.seats.map((x) => [x.id, x.av]));
    const keys = new Map(room.seats.map((x) => [x.id, { token: x.token, watch: x.watch }]));
    Object.keys(room).forEach((k) => { if (!OURS.includes(k)) delete room[k]; });
    Object.keys(rec).forEach((k) => { if (!OURS.includes(k)) room[k] = rec[k]; });
    room.seats.forEach((x) => {
      if (av.get(x.id)) x.av = av.get(x.id);
      const had = keys.get(x.id);
      if (had) { x.token = had.token; x.watch = had.watch; }
    });
    syncCfg(room);
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
     phones this is also where they are dealt.

     `why` is the one thing this cannot work out for itself, and the four
     callers each know it. It is a plain argument rather than a flag left on the
     room, and every caller is in this file, so it is a private word between
     them and not a widening of anything. */
  function openRound(room, why) {
    const r = curRound(room);
    if (!r) return;
    r.bids = Array(room.seats.length).fill(null);
    r.tricks = null;
    room.phase = 'bid';
    room.vote = null;
    room.play = null;
    if (G.virtual(room)) Deck.dealHands(room);
    // The deal is shuffled and will never come round the same way twice, so
    // this is the one point that has to carry a picture of the table.
    T.point(room, { k: 'R', w: why || 'next', i: room.idx, d: r.redeals || 0, f: T.frame(room) });
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
    room.paused = false;         // a new game is not somebody else's stopped one
    unfinish(room);
    // A fresh set of rounds is a fresh game: the trail starts over here.
    T.point(room, { k: 'G', c: room.code, at: Date.now() });
    openRound(room, 'game');
  }

  // The same players, no scorecard.
  function toLobby(room) {
    room.phase = 'lobby';
    room.vote = null;
    room.rounds = [];
    room.idx = 0;
    room.play = null;
    room.paused = false;
    unfinish(room);
    syncCfg(room);
  }

  /* The table stops playing the hands it plays for itself -- the bots', and any
     seat handed over to it. Nothing else changes: whoever is still at the table
     bids and plays exactly as before, and the game waits where it stands. */
  function setPaused(room, on) {
    room.paused = !!on;
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
    // A seat may bid again while it still may change its mind, and that is two
    // points, not one: what happened is that it said two things.
    T.point(room, { k: 'b', p, v });
    if (G.turnSeat(r, room.seats.length) === null) closeBidding(room);
  }

  /* With real cards the table counts the tricks as they are taken: one tap a
     trick, on any phone or on the TV screen, and the last one scores the
     round. The count lives where the virtual deck's play does, so every
     screen reads won-against-bid the same way in both modes. */
  function countStart(room) {
    return { round: room.idx, real: true, won: Array(room.seats.length).fill(0), log: [], last: null };
  }
  function countTrick(room, p) {
    const r = curRound(room), play = room.play;
    if (!r || !play || !play.real) return 'not counting tricks now';
    // The bids are still up to be read. Nothing is played over that beat on
    // either deck; with real cards a tap this early is a misfire anyway.
    if (play.held) return 'the bids are still up';
    play.won[p] += 1;
    play.log.push(p);
    play.last = { trick: [], winner: p };
    T.point(room, { k: 'w', p });
    if (play.log.length >= r.cards) scoreRound(room, play.won.slice());
    return null;
  }
  function uncountTrick(room) {
    const play = room.play;
    if (!play || !play.real) return 'not counting tricks now';
    if (!play.log.length) return 'no trick to take back';
    T.point(room, { k: 'W' });
    play.won[play.log.pop()] -= 1;
    const w = play.log[play.log.length - 1];
    play.last = w === undefined ? null : { trick: [], winner: w };
    return null;
  }
  // What every screen may see of the count: the same shape the deck sends.
  function countPublic(room) {
    const r = curRound(room), p = room.play;
    const left = r ? r.cards - p.log.length : 0;
    return { turn: null, held: !!p.held, trick: [], won: p.won, last: p.last, upcard: null,
             counts: room.seats.map(() => left), log: p.log };
  }

  /* How long the bids stand before the hand is played. The last bid landing
     and the first card becoming playable were one moment, which read as the
     table jumping; this is the beat in between, in which the bids are what
     the table is looking at. */
  const BID_HOLD = Number(process.env.BID_HOLD) || 2300;

  /* The bids are in -- but the table does not play off the last one. The
     round goes to tricks with nobody on play, so no phone and no bot can put
     a card down over the moment, and every screen has the same still table to
     say it on. What ends the hold is a timer in server.js, where the trick
     hold lives; both decks hold the same way. */
  function closeBidding(room) {
    const before = room.play;
    room.phase = 'tricks';
    if (G.virtual(room)) Deck.startPlay(room);
    else room.play = countStart(room);
    room.play.turn = null;
    room.play.held = true;
    /* startPlay deals too, where the hands it was going to use are missing or
       belong to another round -- a phase forced, a table read back off the
       disk. Those cards are as unrepeatable as any other deal, so a picture is
       taken where they were dealt here rather than at the round opening. */
    if (room.play !== before && room.play.hands) T.point(room, { k: 'F', f: T.frame(room) });
  }

  /* The bids have been read. With the cards on the phones the player left of
     the dealer leads; with real cards the table plays them and counts as it
     goes, so opening is only letting the taps in. */
  function openPlay(room) {
    const play = room.play;
    if (!play || !play.held) return false;
    delete play.held;
    if (G.virtual(room)) play.turn = G.firstLeader(curRound(room), room.seats.length);
    return true;
  }

  // A bum deal: the cards were dealt wrong, so throw the hand in and deal it
  // again. Same dealer, same hand size, bids and tricks cleared.
  function bumDeal(room) {
    const r = curRound(room);
    if (!r) return false;
    r.redeals = (r.redeals || 0) + 1;     // before the round reopens: the screens key the deal on it
    r.trump = null;
    openRound(room, 'bum');
    return true;
  }

  // The round is over, however the tricks were counted.
  function scoreRound(room, values) {
    curRound(room).tricks = values;
    // Before the round moves on: which round it was, and what it paid.
    T.point(room, { k: 'e', i: room.idx, v: values.slice() });
    room.vote = null;
    room.play = null;
    room.idx += 1;
    if (room.idx >= room.rounds.length) finishGame(room);
    else openRound(room, 'next');
  }

  // The last round is in. A few of the accolades the table earned are drawn at
  // random and paid, and only then is the winner known.
  function finishGame(room) {
    const n = room.seats.length;
    room.phase = 'done';
    room.idx = room.rounds.length;
    const earned = A.only(A.list(room.rounds, n, (b, w) => G.roundScore(b, w, room.cfg)),
                          room.cfg.accolades);
    room.awards = A.pick(earned, room.cfg.accoladeCount);
    room.bonus = A.bonus(room.awards, n, room.cfg.accoladePay);
    if (!room.gameId) room.gameId = token().slice(0, 12);
    // The accolades are drawn, not worked out, so the finish carries a picture:
    // the same game played again would not award the same three.
    T.point(room, { k: 'E', g: room.gameId, f: T.frame(room) });
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
    // A step back that was taken, not one that was refused. The round it lands
    // on takes its own picture on the way, which is the deal that counts.
    T.point(room, { k: 'z' });
    // With the cards dealt on the phones those cards are gone, so whichever
    // step was taken back, the round it landed on is dealt again from its bids.
    // With real cards the tricks landed on are counted again from nothing.
    if (G.virtual(room)) openRound(room, 'undo');
    else room.play = room.phase === 'tricks' ? countStart(room) : null;
    return null;
  }

  /* Is the table stopped, waiting on this one seat? Nobody may bid or play out
     of turn, so a seat that is on turn holds up everybody else. It is the one
     moment where a player who has lost their seat can be let back in on nothing
     but their name: the table has gone nowhere without them, and everybody at it
     can see who is missing. */
  function waitingOn(room, p) {
    return p >= 0 && G.onTurn(room) === p;
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
      // the cards on the table, never the hands; or the count, with real cards
      play: room.play && room.play.real ? countPublic(room) : Deck.playPublic(room),
      chat: room.chat,                // what has been said at this table
      dev: DEV,                       // the host screen offers the dev page when it is on
      // A TV screen that runs this table is at it. The table host's phone
      // then knows the code is already up on a wall, and says so.
      tv: Array.from(room.sockets).some((w) => w.ctx && w.ctx.role === 'host'),
      // Somebody is watching, so the table plays a hand nobody is behind.
      // Every screen gets it, so `Game.tablePlaysOn` answers the same here.
      seen: !!room.seen,
      paused: !!room.paused,          // and it has been told to stop playing them
    };
  }

  return { curRound, seatIndex, Deck, BID_HOLD, create, seat, syncCfg, become, addBot, openRound, startGame, toLobby,
           seatBid, seatReady, closeBidding, openPlay, countTrick, uncountTrick, bumDeal, scoreRound, finishGame, unfinish, undo, setPaused,
           waitingOn, publicState };
};
