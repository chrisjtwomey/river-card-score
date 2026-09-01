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
      stalled: null,              // the seat the table has stopped on, for the host to answer
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
    return Object.assign({ id: token().slice(0, 8), name, token: token(), watch: token(),
                           online: true, idleAt: Date.now() }, extra);
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
    /* The card is built and no round is open: that is what the instant a game
       starts looks like, and a game started over from a finished one is not
       finished any more. `openRound` sets the phase again a line below, so the
       table never stands here -- but the picture taken here does. */
    room.phase = 'lobby';
    unfinish(room);
    /* A fresh set of rounds is a fresh game: the trail starts over here. It
       carries a picture because it is the one point with nothing behind it to
       be worked out from; without one, a replay could not stand on its own
       first point and opened on its second. */
    T.point(room, { k: 'G', c: room.code, at: Date.now(), f: T.frame(room) });
    openRound(room, 'game');
  }

  // The same players, no scorecard.
  function toLobby(room) {
    room.phase = 'lobby';
    room.vote = null;
    room.stalled = null;
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

  /* A round already scored, put right where it is read. It is the answer to a
     number that went in wrong -- a trick counted onto the wrong seat three
     rounds back -- and it is the only way back into a round the game has moved
     past. The round is not played again: what is being put right is the record
     of it, which is what the scorecard is.

     A row has to add up. At a table the tricks taken always total the hand, so
     a column that does not is refused rather than filed; it is also the check
     that catches a slip, because a trick moved off one seat has to land on
     another. The bids are bounded by the hand and nothing else: a bid that
     broke the screw-the-dealer rule was still the bid that was made.

     Returns the line to say, or null. */
  function setScore(room, i, bids, tricks) {
    const r = room.rounds[i];
    if (!r) return 'no such round';
    if (!G.roundDone(r)) return 'that round has not been scored yet';
    const n = room.seats.length;
    const nums = (v) => {
      if (!Array.isArray(v) || v.length !== n) return null;
      const out = [];
      for (let p = 0; p < n; p++) {
        const k = Math.round(Number(v[p]));
        if (!Number.isFinite(k) || k < 0 || k > r.cards) return null;
        out.push(k);
      }
      return out;
    };
    const b = nums(bids), w = nums(tricks);
    if (!b || !w) return `every seat needs a whole number, and none of them over ${r.cards}`;
    if (w.reduce((a, x) => a + x, 0) !== r.cards) {
      return `the tricks have to total ${r.cards}: that is how many were played`;
    }
    r.bids = b;
    r.tricks = w;
    /* Nothing here is a move a game makes, so the trail carries a picture
       rather than an event: what happened is that the card was put right. */
    T.point(room, { k: 'F', f: T.frame(room) });
    /* A game already filed is filed again, under the same name, so the card in
       Past games is the card on the screen. The accolades stay as they were
       drawn: they were drawn once, and drawing them again would be a different
       game's worth of luck. */
    if (room.phase === 'done') saveGame(room);
    return null;
  }

  /* The round in play, put back to the start of its bidding: the bids and the
     tricks go, and on a table that deals the cards it is dealt again. Where the
     game is over it is the last round that comes back, so a game that ended on
     a round nobody agreed with is played again rather than argued about.

     Not from the bidding itself. There is nothing there to put back, and a hand
     dealt wrong is thrown in with a bum deal -- the button beside this one --
     which counts the re-deal, as a table does. And not for a round already
     scored: that one is put right on the scorecard, where its number is read.

     Returns the line to say, or null. */
  function resetRound(room) {
    if (room.phase === 'done') {
      room.idx = room.rounds.length - 1;
      unfinish(room);
    } else if (room.phase !== 'tricks') return 'the round has not been bid yet';
    if (!curRound(room)) return 'there is no round to put back';
    room.stalled = null;
    openRound(room, 'reset');
    return null;
  }

  /* ---------------- a seat nobody is behind ---------------- */

  /* The seat goes, and with it every trace of that player: this is only ever
     the lobby, where nothing has been played and no column is theirs yet.
     Returns the seat that went, so whoever asked can tell its phone. */
  /* A seat off the table altogether. Only in the lobby: once a game has
     started the rounds already played are that player's and the scorecard is a
     column for it, so a seat that goes mid-game is a hole in the card. The
     mid-game answer is `standDown`, which keeps the seat and hands the table
     its hand.

     The rule is here rather than only on the message row that says it, because
     three doors reach this: a phone leaving, the table host putting a seat
     out, and the dev page doing either from outside. Every one of them was
     already lobby-only; this is where that stops being three agreements. */
  function kickSeat(room, id) {
    if (room.phase !== 'lobby') return null;
    const p = seatIndex(room, id);
    if (p < 0) return null;
    const seat = room.seats.splice(p, 1)[0];
    syncCfg(room);
    return seat;
  }

  /* The seat stays -- the scorecard is a column for every seat and the rounds
     already played are that player's -- but nobody is behind it, so the table
     plays its hand from here on. */
  function standDown(room, p) {
    const seat = room.seats[p];
    if (!seat) return null;
    seat.left = true;
    seat.online = false;
    syncCfg(room);
    return seat;
  }

  /* A seat the table was given, handed back. The player it belongs to is not
     here to press anything -- that is why the table has their hand -- so the
     seat is opened and they come back to it by name, exactly as a phone that
     lost its seat does. Nothing else moves: the column and the rounds already
     played were always theirs.

     The clock starts again from now, so a seat opened and not taken up is
     handed over again in its own time rather than at once. */
  function letBack(room, id) {
    const seat = room.seats[seatIndex(room, id)];
    if (!seat || !seat.left) return null;
    seat.left = false;
    seat.online = false;                 // nobody is behind it yet; a window says so
    seat.idleAt = Date.now();
    seat.warned = false;
    seat.excused = false;
    syncCfg(room);
    if (room.rounds.length) T.point(room, { k: 'F', f: T.frame(room) });
    return seat;
  }

  /* The table is standing on a beat that nothing is left to end: a finished
     trick held up to be read, or the bids. Both beats are ended by a timer,
     and a timer belongs to the server that armed it -- so a table read back
     off the disk, or one whose server was stopped over the moment, sits there
     for ever with every phone waiting on it.

     Ending the beat by hand is the move the timer was going to make and
     nothing else, so nothing is invented. Returns whether anything moved. */
  function unstick(room) {
    const play = room.play;
    if (play && !play.held && play.turn === null && play.last && play.hands) {
      Deck.settleTrick(room, play.last.winner);
      return true;
    }
    return openPlay(room);
  }

  /* Who deals. Before a game it is the seat that deals round one; during the
     bidding it is this round's dealer, and the order of bidding moves with
     it. Only ever that: a hand already dealt went to the seats it went to,
     so a table that deals on the phones throws the hand in instead. Which
     tables may ask is the message row's; this is what happens when they do. */
  function setDealer(room, id) {
    const p = seatIndex(room, id);
    if (p < 0) return 'no such seat';
    const r = curRound(room);
    if (!r || room.phase === 'lobby') { room.firstDealerId = id; return null; }
    r.dealer = p;
    T.point(room, { k: 'F', f: T.frame(room) });
    return null;
  }

  /* A seat's name. One name to a table -- the scorecard is a column under it
     -- so a name already at the table is refused whoever is typing it. The
     rule lives here because two doors reach it: a player changing their own
     in the lobby, and whoever runs the table putting one right mid-game.
     Returns the line to say, or null. */
  function renameSeat(room, id, want) {
    const seat = room.seats[seatIndex(room, id)];
    if (!seat) return 'no such seat';
    const name = String(want || '').trim().slice(0, 16);
    if (!name) return 'type a name';
    if (seat.name === name) return null;
    if (room.seats.some((s) => s !== seat && s.name.toLowerCase() === name.toLowerCase())) {
      return 'that name is taken';
    }
    seat.name = name;
    if (room.rounds.length) T.point(room, { k: 'F', f: T.frame(room) });
    return null;
  }

  /* Whether this seat's idle clock is running. A phone that is open with
     nothing to do is not idle, whatever it has not done: the clock runs while
     nobody holds the seat, and while the table is stopped on it and can go no
     further. So a player watching the hand go round is never dropped, and a
     player who has fallen asleep on their turn is.

     A bot is never away. A seat already handed over cannot be handed over
     twice. A table of stand-ins is nobody's game, and a copy of a table is not
     being played at all. Nothing is taken from anybody once the game is done. */
  function idleSeat(room, p) {
    const s = room.seats[p];
    if (!s || s.bot || s.left || room.stand || room.replay) return false;
    if (room.phase === 'lobby') return !s.online;
    if (room.phase === 'done') return false;
    return !s.online || waitingOn(room, p);
  }

  /* One seat's answer to a bum-deal vote. One no ends it -- a hand is thrown
     in by everybody or not at all -- and the last yes throws it in.

     Its own verb because two doors reach it: a phone answering the vote, and
     the dev page answering it for a seat, so a vote can be set up half done
     without either writing the counting out again. */
  function seatVote(room, p, agree) {
    const v = room.vote;
    if (!v || v.round !== room.idx) return null;
    v.yes = v.yes.filter((i) => i !== p);
    v.no = v.no.filter((i) => i !== p);
    if (agree) v.yes.push(p); else v.no.push(p);
    if (v.no.length > 0) { room.vote = null; return 'no'; }
    if (v.yes.length >= room.seats.length) { bumDeal(room); return 'dealt'; }
    return 'yes';
  }

  /* A line in the talk, from a seat or from the table itself. The trimming,
     the shape of an entry and the cap are here because two doors reach it: a
     phone's own chat, and the dev page saying something as somebody. `keep` is
     the server's, which owns how much of a table is carried about. */
  function say(room, p, text, keep) {
    const line = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!line) return null;
    const seat = p >= 0 ? room.seats[p] : null;
    const entry = { n: ++room.chatSeq, who: seat ? seat.id : 'host',
                    name: seat ? seat.name : 'Table', text: line };
    room.chat.push(entry);
    const cap = Math.max(1, Number(keep) || 100);
    if (room.chat.length > cap) room.chat.splice(0, room.chat.length - cap);
    return entry;
  }

  /* A seat whose clock has run out, and what the table does about it. In the
     lobby the seat itself goes; in a game the hand is handed to auto-play,
     exactly as if the player had left. With real cards the table can hold no
     hand, so nothing is taken from anybody: it stops on that seat and waits on
     whoever runs it.

     Its own function because two things reach it -- the clock in `sweep`, and
     the dev page, which winds the clock on rather than write the same three
     branches again. A dev table of stand-ins is never idle (`idleSeat` says
     so), so the page could not have got here through the clock at all. */
  function giveUp(room, p) {
    const s = room.seats[p];
    if (!s) return null;
    if (room.phase === 'lobby') return kickSeat(room, s.id) ? 'kicked' : null;
    if (G.virtual(room)) { standDown(room, p); return 'left'; }
    if (room.stalled) return null;
    room.stalled = { id: s.id, ms: 0 };
    return 'stalled';
  }

  /* What the clocks on a table say now. The server owns the time and the
     telling; this owns what the time means, so the whole rule is one function
     over a room and a number, and test-rules.js can wind it on by hand.

     `ms` is how long a seat may be idle, how long before that it is warned, and
     how long a table nobody is at is kept -- one clock for a lobby or a game
     that is over, a longer one for a game in play, which people mean to come
     back to. Any of them at nought turns that clock off.

     A seat whose clock runs out goes: in the lobby the seat itself, and in a
     game the hand, handed to auto-play exactly as if the player had left. With
     real cards the table can hold no hand, so nothing is taken from anybody.

     A table is idle when nobody is playing at it and nobody is watching it:
     not one player online, and no screen on it. Bots are nobody, and so are
     the stand-ins on a dev table. Saying so is all this does -- taking the
     table away is the server's, which is what holds it.

     Returns what happened, for the server to tell: the seats to warn, the
     seats that went and how, and whether the table itself is done with. */
  function sweep(room, now, ms) {
    const out = { warn: [], gone: [], changed: false, end: false };
    if (room.replay) return out;
    // Whatever is not idle keeps its clock at now, so what is left on a seat is
    // how long it has been gone, or has held the table up.
    room.seats.forEach((s, p) => {
      if (idleSeat(room, p)) return;
      s.idleAt = now;
      s.warned = false;
      s.excused = false;            // somebody is behind it again, so the host is asked afresh
    });
    // The seat the table stopped on is back, or the table has gone on past it.
    if (room.stalled && !idleSeat(room, seatIndex(room, room.stalled.id))) {
      room.stalled = null;
      out.changed = true;
    }
    const warnAt = ms.idle - (ms.warn || 0);
    if (ms.idle) room.seats.slice().forEach((s) => {
      const p = seatIndex(room, s.id);
      if (p < 0 || !idleSeat(room, p)) return;
      if (s.excused) return;          // the host has looked at this seat and said carry on
      const gone = now - s.idleAt;
      if (gone >= ms.idle) {
        const how = giveUp(room, p);
        if (!how) return;                          // already stalled on somebody
        if (how !== 'stalled') out.gone.push({ seat: s, how });
        else room.stalled.ms = ms.idle;            // how long it waited, for the telling
        out.changed = true;
      } else if (gone >= warnAt && s.online && !s.warned) {
        // Only a phone that is here can be asked, and only once.
        s.warned = true;
        out.warn.push(p);
      }
    });
    out.end = idleTable(room, now, ms);
    return out;
  }

  /* Nobody is at this table and nobody is watching it, and neither has been
     for long enough. A game in play is given longer than a lobby or a game
     that is over: a hand people are in the middle of is one they mean to come
     back to, and a lobby nobody returns to is only a row in a list. */
  function idleTable(room, now, ms) {
    if (room.replay) return false;
    const clock = (room.phase === 'lobby' || room.phase === 'done') ? ms.table : ms.game;
    if (!clock) return false;
    if (room.seats.some((s) => s.online && !s.bot) || room.seen) return false;
    return now - room.lastSeen >= clock;
  }

  /* The host has looked at the seat the table stopped on. Nothing is taken
     from that player -- with real cards their hand is on the table in front of
     them, and only the people there can decide what happens to it. The table
     goes on, and does not stop on that seat again until somebody is behind it. */
  function carryOn(room) {
    if (!room.stalled) return;
    const seat = room.seats[seatIndex(room, room.stalled.id)];
    if (seat) seat.excused = true;
    room.stalled = null;
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
    const now = Date.now();
    const bonus = room.bonus || Array(n).fill(0);
    return {
      t: 'state',
      code: room.code,
      phase: room.phase,
      cfg: room.cfg,
      seats: room.seats.map((s, p) => ({ id: s.id, name: s.name, online: s.online,
                                        bot: !!s.bot, left: !!s.left,
                                        av: s.av ? s.av.ver : null,
                                        /* How long this seat's clock has been running, or 0
                                           where it is not. Whether it runs at all is the rule
                                           above; counting on from here is the page's, off the
                                           moment this state landed. A stamp would need the two
                                           clocks to agree, and a phone's does not. */
                                        quiet: idleSeat(room, p)
                                          ? Math.max(0, now - (s.idleAt || now)) : 0 })),
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
      // The seat the table has stopped on, with real cards nobody else can
      // play: every screen says so, and whoever runs the table answers it.
      stalled: room.stalled || null,
      /* How fast this table is going. A real one goes at one -- what happened,
         happened when it did. A copy of a game being watched again goes at
         whatever it is being played back at, and the screens on it draw at that
         speed too, or the cards fly about at full pelt between beats twice as
         long. Left out where there is nothing to say, which is every real
         table there has ever been. */
      ...(room.replay ? { rate: room.replay.rate || 1 } : {}),
    };
  }

  return { curRound, seatIndex, Deck, BID_HOLD, create, seat, syncCfg, become, addBot, openRound, startGame, toLobby,
           kickSeat, standDown, letBack, giveUp, unstick, setDealer, renameSeat, resetRound, setScore, idleSeat, idleTable, sweep, carryOn,
           seatBid, seatVote, say, seatReady, closeBidding, openPlay, countTrick, uncountTrick, bumDeal, scoreRound, finishGame, unfinish, setPaused,
           waitingOn, publicState };
};
