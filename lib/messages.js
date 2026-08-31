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

module.exports = ({ DEV, CHAT_KEEP, G, A, send, fail, broadcast, Room, addBot, playCard, bidValue,
                    markPresence }) => {
  const { curRound, seatIndex, syncCfg, seatBid, bumDeal, Deck } = Room;

  /* Every window this player has open is out of the table now, and none of
     them counts as that seat being present. */
  function tellGone(room, seat) {
    room.sockets.forEach((w) => {
      if (w.ctx && w.ctx.seatId === seat.id && w.ctx.role !== 'watch') {
        send(w, { t: 'left', code: room.code });
        w.ctx.seatId = null;
      }
    });
    markPresence(room);
  }

  /* The seat stays -- the scorecard is a column for every seat and the rounds
     already played are that player's -- but nobody is behind it, so the table
     plays its hand from here on. */
  function standDown(room, seat) {
    seat.left = true;
    seat.online = false;
    syncCfg(room);
    tellGone(room, seat);
  }

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
        if ('deck' in p && ['physical', 'virtual'].includes(p.deck)) {
          // A bot has nothing to hold at a table with real cards, so the two
          // settings cannot be had at once.
          if (p.deck === 'physical' && room.seats.some((s) => s.bot)) {
            return 'take the bots off the table first: they play with cards on the phones';
          }
          cfg.deck = p.deck;
        }
        if ('accoladePay' in p) {
          cfg.accoladePay = [0, 5, 10, 20].includes(Number(p.accoladePay)) ? Number(p.accoladePay) : cfg.accoladePay;
        }
        /* Which of them this table hands out. Kept in the game's own order
           and only the ones it knows: a screen sends the whole list, so what
           is not on it is what was unticked. */
        if ('accolades' in p && Array.isArray(p.accolades)) {
          const want = p.accolades.map(String);
          cfg.accolades = A.ALL.map((a) => a.key).filter((k) => want.indexOf(k) >= 0);
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

    /* A seat dragged to a new place in the order of play. `to` is the index
       it lands on, and the seats between shift one place. */
    seatMove: {
      who: 'boss', denied: 'not allowed now',
      phase: 'lobby', stage: 'not allowed now',
      run(c, m) {
        const { room, n } = c;
        const i = seatIndex(room, m.id);
        const j = Number(m.to);
        if (i < 0 || !Number.isInteger(j) || j < 0 || j >= n || j === i) return QUIET;
        const seat = room.seats.splice(i, 1)[0];
        room.seats.splice(j, 0, seat);
      },
    },

    /* A player the table provides, for a hand short of people. It needs cards of
       its own to hold, so asking for one asks for the deck to be dealt on the
       phones: at a table with real cards there is nothing for a bot to hold, and
       nothing it could do. The switch back is refused while any are seated. */
    addbot: {
      who: 'boss', denied: 'only the table host can add a player',
      phase: 'lobby', stage: 'the game has started',
      when: (c) => c.n < 8 || 'the table is full',
      run(c) {
        c.room.cfg.deck = 'virtual';
        addBot(c.room);
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
        room.sockets.forEach((w) => { if (w.ctx && w.ctx.seatId === m.id) send(w, { t: 'kicked', code: room.code }); });
      },
    },

    /* Leaving on purpose, which is not the same as a phone going quiet. The
       table has to be able to tell them apart: a quiet phone is waited for and
       can be let back in, a player who has left is played out and cannot.

       Before the cards go out the seat simply goes. After that it cannot: the
       scorecard is a column for every seat and the rounds already played are
       that player's. So the seat stays, marked as gone, and the table plays
       its hand from there on. The token still works, so a tap by mistake is
       undone by coming back to the table. */
    /* A player's name, changed from the settings page. Set before the game
       starts, like the picture: the scorecard is a column under each name,
       and a game in play keeps them. A name is one seat's: the join refuses a
       name already at the table, and so does this. */
    rename: {
      who: 'player', denied: 'only a player has a name to change',
      phase: 'lobby', stage: 'the names are set before the game starts',
      run(c, m) {
        const { room, mySeat } = c;
        const name = String(m.name || '').trim().slice(0, 16);
        if (!name) return 'type a name';
        const seat = room.seats[mySeat];
        if (seat.name === name) return QUIET;
        const held = room.seats.find((s) => s !== seat && s.name.toLowerCase() === name.toLowerCase());
        if (held) return 'that name is taken';
        seat.name = name;
      },
    },

    leave: {
      who: 'player', denied: 'only a player can leave a seat',
      run(c) {
        const { room, mySeat } = c;
        if (room.phase === 'lobby') {
          const seat = room.seats[mySeat];
          room.seats.splice(mySeat, 1);
          syncCfg(room);
          tellGone(room, seat);
          return;
        }
        standDown(room, room.seats[mySeat]);
      },
    },

    /* A phone that is not coming back. Whoever runs the table hands that seat
       to the table itself: it is marked gone, exactly as if that player had
       pressed Leave, and the table plays its hand from there on instead of
       waiting a turn at a time. Only a seat that is already away can be handed
       over, and the seat's token still works, so the player it belongs to
       takes it back by coming to the table. */
    playout: {
      who: 'boss', denied: 'only the table host can hand a seat to auto-play',
      deck: 'virtual', wrongDeck: 'auto-play has no cards to hold at a table with real cards',
      phase: ['bid', 'tricks'], stage: 'no hand in play',
      run(c) {
        const { room, n, r } = c;
        if (!r) return 'no hand in play';
        const p = G.onTurn(room);
        if (p === null || p === undefined) return 'nobody is on play';
        const seat = room.seats[p];
        if (seat.bot) return `${seat.name} is a bot`;
        if (seat.online) return `${seat.name} is at the table`;
        if (seat.left) return `auto-play already has ${seat.name}'s hand`;
        standDown(room, seat);
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
      run(c) { Room.startGame(c.room); },
    },

    /* A phone whose table is up for this round. The table bids no hand for a
       bot until every phone has said so: the cards are still in the air until
       then, and a bid landing before them is a bid nobody saw made.

       No phase guard: this is the phone talking about itself, not a player
       acting, and it arrives late whenever the bidding closed while the deal
       was still being watched -- a seat the table bid for, a phone coming back
       to a round that has moved on. Refused, it put "Not bidding now" in front
       of a player who had done nothing at all. Late is simply nothing to
       record. */
    dealt: {
      who: 'player', denied: 'only players are dealt a hand',
      deck: 'virtual', wrongDeck: 'this table plays with real cards',
      run(c) {
        if (c.room.phase !== 'bid') return QUIET;
        Room.seatReady(c.room, c.mySeat);
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
        // One place decides what a bid does, whoever made it -- a phone, or a
        // bot the table is playing for.
        seatBid(room, mySeat, v);
      },
    },

    /* A phone has gone at the bidding, and the table cannot move: nobody may
       bid out of turn, so one empty seat stops the whole game. Whoever runs
       the table bids for it. On a table dealt on the phones the number is read
       off that seat's own hand -- the same arithmetic the bots use -- so no
       player picks another player's bid. With real cards there is no hand to
       read, so the host sends the number the player at the table says. */
    bidfor: {
      who: 'boss', denied: 'only the table host can bid for a seat',
      phase: 'bid', stage: 'not bidding now',
      run(c, m) {
        const { room, n, r } = c;
        if (!r) return 'not bidding now';
        const p = G.turnSeat(r, n);
        if (p === null) return 'all the bids are in';
        if (room.seats[p].online) return `${room.seats[p].name} is here and can bid`;
        const forbidden = G.forbiddenBid(r, p, room.cfg, n);
        const hand = room.play && room.play.hands[p];
        const asked = (m.v === null || m.v === undefined || m.v === '');
        let v = asked ? null : Number(m.v);
        if (v === null) {
          if (!hand) return `there are no cards to read, so type the bid ${room.seats[p].name} wants`;
          v = bidValue(hand, r.cards, r.trump, forbidden);
        }
        if (!Number.isInteger(v) || v < 0 || v > r.cards) return 'bid out of range';
        if (forbidden !== null && v === forbidden) return `the bids must not total ${r.cards}`;
        seatBid(room, p, v);
      },
    },

    /* With real cards the table counts the tricks as they are taken: whoever
       saw one taken taps who took it, on any phone at the table or on the
       screen that runs it, and the last one scores the round. A tap that was
       wrong is taken back. */
    trick: {
      deck: 'physical', wrongDeck: 'the cards count themselves on this table',
      phase: 'tricks', stage: 'not counting tricks now',
      when: (c) => (c.boss || c.mySeat === G.countingSeat(c.room)) || 'the dealer counts the tricks',
      run(c, m) {
        const p = Number(m.p);
        if (!Number.isInteger(p) || p < 0 || p >= c.n) return 'no such seat';
        return Room.countTrick(c.room, p);
      },
    },

    trickback: {
      deck: 'physical', wrongDeck: 'the cards count themselves on this table',
      phase: 'tricks', stage: 'not counting tricks now',
      when: (c) => (c.boss || c.mySeat === G.countingSeat(c.room)) || 'the dealer counts the tricks',
      run(c) { return Room.uncountTrick(c.room); },
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
        const can = G.legalPlays(room.play.hands[p], Deck.ledSuit(room.play));
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
      run(c) { return Room.undo(c.room); },
    },

    /* Stop the table playing its own hands, and let it go again. Only where
       there are hands it plays for itself: a bot's, or a seat handed over. It
       is said outright rather than toggled, so two screens pressing at once
       agree on where it ends up. */
    pause: {
      who: 'boss', denied: 'only the table host can stop the table',
      deck: 'virtual', wrongDeck: 'a table with real cards plays no hand by itself',
      phase: G.PLAY_PHASES, stage: 'there is no hand in play to stop',
      when: (c) => G.tableSelfPlays(c.room) || 'the table is playing no hand of its own',
      run(c, m) { Room.setPaused(c.room, m.on); },
    },

    reset: {
      who: 'boss', denied: 'only the table host can reset',
      run(c) { Room.toLobby(c.room); },
    },

    /* Table talk. It belongs to the table and not to a game, so it lasts as
       long as the table does and carries over into the next game on it. A watch
       window never reaches this table of messages at all, so who is left is a
       seat or the host screen -- and the host screen speaks as the table.

       It rides with the table to disk, like everything else on the room that
       is not the server's own, and comes back with it. */
    chat: {
      run(c, m) {
        const { room, ws, mySeat } = c;
        // One line, however it was typed, and no longer than a line.
        const text = String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (!text) return QUIET;
        const now = Date.now();
        if (ws.ctx.saidAt && now - ws.ctx.saidAt < 500) return 'one line at a time';
        ws.ctx.saidAt = now;
        const seat = mySeat >= 0 ? room.seats[mySeat] : null;
        room.chat.push({
          n: ++room.chatSeq,
          who: seat ? seat.id : 'host',
          name: seat ? seat.name : 'Table',
          text,
        });
        // The oldest go, so a long table does not carry a long history in every
        // state it sends.
        if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
      },
    },
  };

  const phaseAllows = (want, phase) => (Array.isArray(want) ? want.includes(phase) : want === phase);

  /* One message from a socket that already has a seat or a screen at a table.
     The context is worked out once by the caller and handed in. */
  function handleTable(ws, m, c) {
    const spec = MESSAGES[m.t];
    if (!spec) return fail(ws, 'unknown message');

    if (spec.deck && (spec.deck === 'virtual') !== G.virtual(c.room)) return fail(ws, spec.wrongDeck);
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
