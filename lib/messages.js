'use strict';
/* Every message a socket at a table may send, as a table.

   Each entry says who may send it, when, and what it does. The guards are
   read here, once, instead of being written out again in every branch:

     deck    'virtual' | 'physical'        -- which kind of table it belongs to
     wrongDeck  what to say on the other kind
     who     'boss' | 'player' | 'anyone'   -- 'anyone' if left out
     denied  what to say when `who` refuses
     phase   the phase, or phases, this message belongs to
     stage   what to say when the phase is wrong
     when    a last look at the table: true, or the line to say instead
     run     does the work

   What run returns decides what the table hears:

     nothing   the new state goes to every screen
     QUIET     nothing is sent
     a string  that line goes back to the sender alone, and nothing changes

   So a new message is an entry here. It cannot forget a guard, because the
   guards are not its to write.
*/
const QUIET = Symbol('nothing to send');

module.exports = ({ DEV, G, send, fail, broadcast, seatIndex, curRound, syncCfg,
                    newGame, unfinish, virtual, dealHands, startPlay, playCard,
                    scoreRound, bumDeal }) => {

  const MESSAGES = {

    ping: {
      run(c) { send(c.ws, { t: 'pong' }); return QUIET; },
    },

    config: {
      who: 'boss', denied: 'only the table host changes the rules',
      // With DEV=1 the rules may be forced mid-game, to put a table right.
      when: (c) => (c.room.phase === 'lobby' || DEV) || 'the game has started',
      run(c, m) {
        const { room, n } = c;
        const cfg = room.cfg, p = m.patch || {};
        if ('max' in p) cfg.max = Math.max(1, Math.min(Number(p.max) || 1, G.maxCardsFor(Math.max(2, n))));
        if ('ones' in p) { cfg.ones = Math.max(1, Math.min(8, Number(p.ones) || 1)); room.onesLocked = true; }
        if ('pattern' in p && ['downup', 'updown', 'down', 'up'].includes(p.pattern)) cfg.pattern = p.pattern;
        if ('bonus' in p) cfg.bonus = [0, 1, 5, 10].includes(Number(p.bonus)) ? Number(p.bonus) : cfg.bonus;
        if ('miss' in p && p.miss in G.MISS_RULES) cfg.miss = p.miss;
        if ('screw' in p) cfg.screw = !!p.screw;
        if ('trump' in p) cfg.trump = !!p.trump;
        if ('deck' in p && ['physical', 'virtual'].includes(p.deck)) cfg.deck = p.deck;
        if ('accoladePay' in p) {
          cfg.accoladePay = [0, 5, 10, 20].includes(Number(p.accoladePay)) ? Number(p.accoladePay) : cfg.accoladePay;
        }
        if ('accoladeCount' in p) {
          const k = Math.round(Number(p.accoladeCount));
          if (Number.isFinite(k) && k >= 0 && k <= 6) cfg.accoladeCount = k;
        }
        if ('firstDealer' in p) {
          room.firstDealerId = (p.firstDealer && seatIndex(room, p.firstDealer) >= 0) ? p.firstDealer : null;
        }
      },
    },

    seatMove: {
      who: 'boss', denied: 'not allowed now',
      phase: 'lobby', stage: 'not allowed now',
      run(c, m) {
        const { room, n } = c;
        const i = seatIndex(room, m.id);
        const j = i + (m.dir === 'up' ? -1 : 1);
        if (i < 0 || j < 0 || j >= n) return QUIET;
        const tmp = room.seats[i]; room.seats[i] = room.seats[j]; room.seats[j] = tmp;
      },
    },

    kick: {
      who: 'boss', denied: 'not allowed now',
      phase: 'lobby', stage: 'not allowed now',
      run(c, m) {
        const { room } = c;
        const i = seatIndex(room, m.id);
        if (i < 0) return QUIET;
        room.seats.splice(i, 1);
        syncCfg(room);
        room.sockets.forEach((w) => { if (w.ctx && w.ctx.seatId === m.id) send(w, { t: 'kicked' }); });
      },
    },

    captain: {
      who: 'boss', denied: 'only the table host can pass it on',
      run(c, m) {
        if (seatIndex(c.room, m.id) < 0) return 'no such seat';
        c.room.captainId = m.id;
      },
    },

    start: {
      who: 'boss', denied: 'only the table host starts the game',
      phase: 'lobby', stage: 'already started',
      when: (c) => c.n >= 2 || 'you need at least 2 players',
      run(c) {
        const { room, n } = c;
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
      },
    },

    trump: {
      run(c, m) {
        const { room, r, mySeat, boss } = c;
        if (!r) return QUIET;
        if (virtual(room)) return 'the deck turns the trump on this table';
        if (!boss && mySeat !== r.dealer) return 'the table host or the dealer sets the trump';
        const ok = G.SUITS.some((s) => s.k === m.k);
        r.trump = (m.k === null || r.trump === m.k) ? null : (ok ? m.k : r.trump);
      },
    },

    bid: {
      who: 'player', denied: 'only players bid',
      phase: 'bid', stage: 'not bidding now',
      run(c, m) {
        const { room, n, r, mySeat } = c;
        if (!r) return 'not bidding now';
        const turn = G.turnSeat(r, n);
        // The last bidder may still change, until the player after them bids.
        const amender = G.changeableSeat(r, n);
        if (mySeat !== turn && mySeat !== amender) {
          return r.bids[mySeat] !== null
            ? 'too late to change your bid'
            : `it is ${room.seats[turn].name}'s turn to bid`;
        }
        const v = Number(m.v);
        if (!Number.isInteger(v) || v < 0 || v > r.cards) return 'bid out of range';
        const forbidden = G.forbiddenBid(r, mySeat, room.cfg, n);
        if (forbidden !== null && v === forbidden) return `the bids must not total ${r.cards}`;
        r.bids[mySeat] = v;
        if (G.turnSeat(r, n) === null) {
          room.phase = 'tricks';
          if (virtual(room)) startPlay(room);
        }
      },
    },

    tricks: {
      deck: 'physical', wrongDeck: 'the cards count themselves on this table',
      phase: 'tricks', stage: 'not counting tricks now',
      run(c, m) {
        const { room, n, r, mySeat, boss } = c;
        if (!r) return 'not counting tricks now';
        if (!boss && mySeat !== r.dealer) return 'the dealer enters the tricks';
        const v = Array.isArray(m.values) ? m.values.map(Number) : [];
        if (v.length !== n || v.some((x) => !Number.isInteger(x) || x < 0 || x > r.cards)) return 'bad trick counts';
        const sum = v.reduce((a, b) => a + b, 0);
        if (sum !== r.cards) return `the tricks must total ${r.cards}, not ${sum}`;
        scoreRound(room, v);
      },
    },

    // A card. Everything about whether it may be played is decided in the deck.
    play: {
      who: 'player', denied: 'only the players hold cards',
      deck: 'virtual', wrongDeck: 'this table plays with real cards',
      phase: 'tricks', stage: 'no hand in play',
      run(c, m) {
        if (!c.r || !c.room.play) return 'no hand in play';
        playCard(c.ws, c.room, c.mySeat, String(m.card || ''));
        return QUIET;                       // the deck answers, whichever way
      },
    },

    // A phone has gone: the table would sit there for ever, so whoever runs
    // the table can make that seat play. The server picks, and only from the
    // cards the rules allow, so nobody chooses another player's card.
    playfor: {
      who: 'boss', denied: 'only the table host can play for a seat',
      deck: 'virtual', wrongDeck: 'this table plays with real cards',
      phase: 'tricks', stage: 'no hand in play',
      run(c) {
        const { room } = c;
        if (!room.play) return 'no hand in play';
        const p = room.play.turn;
        if (p === null) return 'nobody is on play';
        if (room.seats[p].online) return `${room.seats[p].name} is here and can play`;
        const led = room.play.trick.length ? G.suitOf(room.play.trick[0].card) : null;
        const can = G.legalPlays(room.play.hands[p], led);
        playCard(c.ws, room, p, can[Math.floor(Math.random() * can.length)]);
        return QUIET;
      },
    },

    bumdeal: {
      phase: ['bid', 'tricks'], stage: 'no hand to throw in',
      run(c) {
        const { room, n, r, mySeat, boss } = c;
        const isDealer = mySeat >= 0 && r && mySeat === r.dealer;
        if (boss || isDealer) { bumDeal(room); return; }
        if (mySeat < 0) return 'only the table can call a bum deal';
        if (room.vote && room.vote.round === room.idx) {        // already asked: count as a yes
          if (!room.vote.yes.includes(mySeat)) room.vote.yes.push(mySeat);
        } else {
          room.vote = { kind: 'bumdeal', by: mySeat, round: room.idx, yes: [mySeat], no: [] };
        }
        if (room.vote.yes.length >= n) bumDeal(room);
      },
    },

    vote: {
      who: 'player', denied: 'only players vote',
      run(c, m) {
        const { room, n, mySeat } = c;
        if (!room.vote || room.vote.round !== room.idx) return QUIET;   // nothing to answer
        const v = room.vote;
        v.yes = v.yes.filter((i) => i !== mySeat);
        v.no = v.no.filter((i) => i !== mySeat);
        if (m.agree) v.yes.push(mySeat); else v.no.push(mySeat);
        if (v.no.length > 0) room.vote = null;                          // one no ends it
        else if (v.yes.length >= n) bumDeal(room);
      },
    },

    votecancel: {
      run(c) {
        const { room, mySeat, boss } = c;
        if (!room.vote) return QUIET;
        if (!boss && mySeat !== room.vote.by) return 'only the table host or the player who asked can cancel';
        room.vote = null;
      },
    },

    undo: {
      who: 'boss', denied: 'only the table host can go back',
      run(c) {
        const { room, n } = c;
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
        if (virtual(room)) {            // those cards are gone: deal that hand again
          room.rounds[room.idx].tricks = null;
          room.rounds[room.idx].bids = Array(n).fill(null);
          room.phase = 'bid';
          dealHands(room);
        }
      },
    },

    reset: {
      who: 'boss', denied: 'only the table host can reset',
      run(c) {
        const { room } = c;
        room.phase = 'lobby';
        room.vote = null;
        room.rounds = [];
        room.idx = 0;
        room.play = null;
        unfinish(room);
        syncCfg(room);
      },
    },
  };

  const phaseAllows = (want, phase) => (Array.isArray(want) ? want.includes(phase) : want === phase);

  /* One message from a socket that already has a seat or a screen at a table.
     The context is worked out once by the caller and handed in. */
  function handleTable(ws, m, c) {
    const spec = MESSAGES[m.t];
    if (!spec) return fail(ws, 'unknown message');

    if (spec.deck && (spec.deck === 'virtual') !== virtual(c.room)) return fail(ws, spec.wrongDeck);
    if (spec.who === 'boss' && !c.boss) return fail(ws, spec.denied);
    if (spec.who === 'player' && c.mySeat < 0) return fail(ws, spec.denied);
    if (spec.phase && !phaseAllows(spec.phase, c.room.phase)) return fail(ws, spec.stage || spec.denied);
    if (spec.when) {
      const say = spec.when(c);
      if (say !== true) return fail(ws, say);
    }

    const out = spec.run(c, m);
    if (out === QUIET) return;
    if (typeof out === 'string') return fail(ws, out);
    return broadcast(c.room);
  }

  return { handleTable, MESSAGES };
};
