/* Shared game rules. Runs in Node (require) and in the browser (script tag). */
(function (root) {
  'use strict';

  const SUITS = [
    { k: 'S',  g: '♠',  name: 'Spades',    red: false },
    { k: 'H',  g: '♥',  name: 'Hearts',    red: true  },
    { k: 'D',  g: '♦',  name: 'Diamonds',  red: true  },
    { k: 'C',  g: '♣',  name: 'Clubs',     red: false },
    { k: 'NT', g: 'NT', name: 'No trumps', red: false },
  ];

  const MISS_RULES = {
    atleast:     'must make the bid: over pays tricks won, short pays 0',
    atleastdiff: 'must make the bid: over pays tricks won, short pays minus 1 each',
    zero:        '0 points',
    diff:        'minus 1 per trick off',
    tricks:      'tricks won only',
  };

  const maxCardsFor = (n) => Math.max(1, Math.floor(52 / Math.max(2, n)));

  // The 1-card hand repeats `ones` times, so every player deals it once.
  function schedule(max, pattern, ones) {
    const k = Math.max(1, Number(ones) || 1);
    const flat = Array(k).fill(1);
    const down = [], up = [];
    for (let i = max; i >= 2; i--) down.push(i);
    for (let i = 2; i <= max; i++) up.push(i);
    if (pattern === 'down') return down.concat(flat);
    if (pattern === 'up') return flat.concat(up);
    if (pattern === 'updown') return flat.concat(up, down.slice(1), flat);
    return down.concat(flat, up); // downup
  }

  function defaultCfg(playerCount) {
    const n = Math.max(2, playerCount || 2);
    return {
      max: Math.min(7, maxCardsFor(n)),
      pattern: 'downup',
      ones: n,
      bonus: 10,
      miss: 'atleast',
      screw: true,
      trump: true,
      deck: 'physical',        // 'virtual' deals the cards on the phones
      accoladePay: 10,         // what each accolade pays at the end
      accoladeCount: 3,        // how many are drawn
    };
  }

  // `start` is the seat that deals the first round. The deal moves on one seat
  // each round from there.
  function buildRounds(cfg, playerCount, start) {
    const first = ((Number(start) || 0) % playerCount + playerCount) % playerCount;
    return schedule(cfg.max, cfg.pattern, cfg.ones).map((c, i) => ({
      cards: c,
      dealer: (first + i) % playerCount,
      trump: null,
      bids: null,
      tricks: null,
    }));
  }

  function roundScore(bid, won, cfg) {
    if (bid === won) return Number(cfg.bonus) + won;
    switch (cfg.miss) {
      case 'atleast':     return won > bid ? won : 0;
      case 'atleastdiff': return won > bid ? won : -(bid - won);
      case 'diff':        return -Math.abs(bid - won);
      case 'tricks':      return won;
      default:            return 0; // 'zero'
    }
  }

  const roundDone = (r) => Array.isArray(r.bids) && r.bids.every((b) => b !== null) && Array.isArray(r.tricks);

  function totals(cfg, rounds, playerCount) {
    const t = Array(playerCount).fill(0);
    rounds.forEach((r) => {
      if (!roundDone(r)) return;
      r.bids.forEach((b, i) => { t[i] += roundScore(b, r.tricks[i], cfg); });
    });
    return t;
  }

  // Bidding starts left of the dealer. The dealer bids last.
  function bidOrder(dealer, n) {
    const out = [];
    for (let step = 1; step <= n; step++) out.push((dealer + step) % n);
    return out;
  }

  // The seat that must bid now, or null when every bid is in.
  function turnSeat(round, n) {
    if (!round.bids) return null;
    const order = bidOrder(round.dealer, n);
    for (const p of order) if (round.bids[p] === null) return p;
    return null;
  }

  // The last player to bid may still change it, until the player after them
  // bids. Returns that seat, or null when nobody may change.
  function changeableSeat(round, n) {
    if (!round || !round.bids) return null;
    const order = bidOrder(round.dealer, n);
    const i = order.findIndex((p) => round.bids[p] === null);
    if (i <= 0) return null;            // nobody has bid yet, or the bidding is over
    return order[i - 1];
  }

  // "Screw the dealer": the bids must not total the tricks, so the dealer's
  // last bid has one forbidden value. Returns null when nothing is forbidden.
  function forbiddenBid(round, seat, cfg, n) {
    if (!cfg.screw || seat !== round.dealer || !round.bids) return null;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      if (i === seat) continue;
      if (round.bids[i] === null) return null; // others still to bid
      sum += round.bids[i];
    }
    const f = round.cards - sum;
    return (f >= 0 && f <= round.cards) ? f : null;
  }

  /* ---------- a deck of cards, for a table that has none ---------- */

  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const suitOf = (c) => String(c).slice(-1);
  const rankOf = (c) => String(c).slice(0, -1);
  const rankValue = (c) => RANKS.indexOf(rankOf(c));
  const cardFace = (c) => (rankOf(c) === 'T' ? '10' : rankOf(c));
  const cardRed = (c) => suitOf(c) === 'H' || suitOf(c) === 'D';
  const cardGlyph = (c) => (SUITS.find((s) => s.k === suitOf(c)) || { g: '?' }).g;
  const cardName = (c) => cardFace(c) + cardGlyph(c);

  function deck() {
    const out = [];
    SUITS.forEach((s) => { if (s.k !== 'NT') RANKS.forEach((r) => out.push(r + s.k)); });
    return out;
  }

  function shuffle(cards) {
    const a = cards.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // A hand reads best in suits, high card first.
  function sortHand(cards) {
    const order = ['S', 'H', 'C', 'D'];
    return cards.slice().sort((a, b) => {
      const d = order.indexOf(suitOf(a)) - order.indexOf(suitOf(b));
      return d || rankValue(b) - rankValue(a);
    });
  }

  // Follow the suit that was led, if you hold it. Otherwise anything goes.
  function legalPlays(hand, led) {
    if (!led) return hand.slice();
    const same = hand.filter((c) => suitOf(c) === led);
    return same.length ? same : hand.slice();
  }

  // plays: [{ p, card }] in the order they were played. The highest trump wins,
  // or the highest card of the suit that was led.
  function trickWinner(plays, trump) {
    if (!plays || !plays.length) return null;
    const t = (trump && trump !== 'NT') ? trump : null;
    let best = plays[0];
    for (let i = 1; i < plays.length; i++) {
      const x = plays[i];
      const bs = suitOf(best.card), xs = suitOf(x.card);
      if (t && xs === t && bs !== t) best = x;
      else if (xs === bs && rankValue(x.card) > rankValue(best.card)) best = x;
    }
    return best.p;
  }

  /* ---------- the table, as the server and every screen ask about it ---------- */

  // A table that deals the cards on the phones. `state` is a room on the
  // server or the state a screen holds: both carry the rules as cfg.
  const virtual = (state) => !!(state && state.cfg && state.cfg.deck === 'virtual');

  /* A table that has no choice about it. A bot has nothing to hold at a table
     with real cards and nothing it could do, so a seat filled by one puts the
     deck on the phones and holds it there. Asking for a bot asks for that; the
     switch back is refused while any are seated, and a screen greys the answer
     it would be refused. */
  const mustDeal = (state) => !!(state && (state.seats || []).some((s) => s.bot));

  // The seat the table is stopped on, or null. Bidding: the next bidder.
  // Playing: the seat on play. Never the dealer at a table with real cards --
  // typing the tricks in is not a turn, and nobody is waited for.
  function onTurn(state) {
    const r = state.rounds && state.rounds[state.idx];
    if (!r) return null;
    if (state.phase === 'bid') return turnSeat(r, state.seats.length);
    if (state.phase === 'tricks' && state.play) return state.play.turn;
    return null;
  }

  // A seat the table plays itself: a bot, or a player who left a table that
  // deals on the phones. With real cards a left seat has no hand the table
  // could hold, so somebody at the table has to play it.
  const tablePlays = (seat, cfg) =>
    !!seat && (!!seat.bot || (!!seat.left && !!cfg && cfg.deck === 'virtual'));

  /* Whether the table plays those hands at all. It plays a seat with nobody
     behind it -- but only while somebody is there to see it done.

     Somebody is a player still in the game, or, with none of those left, a
     screen watching: a TV screen, a screen showing the table, a watching
     window. A table of bots alone plays on while it is looked at, and stops
     when the last window on it goes.

     Both halves earn their keep. A player alone with bots who leaves used to
     come back to a game that had played itself out without them: the bots bid
     the hand that was left, the bidding closed, and the tricks ran to the last
     one with nobody watching. And a table of bots with nobody at it is a table
     nobody asked to be played. `seen` is put on the room by the server, which
     is the only thing that knows what is attached to it. */
  const tablePlaysOn = (state) =>
    !!state && !!state.seats && !state.paused
    && (state.seats.some((s) => !s.bot && !s.left) || !!state.seen);

  /* Whether the table has a hand of its own to play at all: a bot's, or one
     handed over to it. This is what a pause is about, so being paused does not
     make it untrue -- it is the question a screen asks to know whether the
     control is worth offering, and `tablePlaysOn` is whether it is running. */
  const tableSelfPlays = (state) =>
    !!state && !!state.seats && state.seats.some((s) => tablePlays(s, state.cfg));

  // A hand is out and being played: the two phases a game is live in.
  const PLAY_PHASES = ['bid', 'tricks'];

  /* Whether stopping the table is something this table can be asked for.

     A stopped table is stopped for everybody: it plays none of its own hands,
     and nobody may bid, play a card or count a trick until it is let go. So
     the question is only whether a hand is out -- both decks have one, and a
     table of people with real cards is exactly the table most likely to want
     to stop for a moment. The host screen, the phone that runs the table, the
     dev page and the message that carries it all ask this one question. */
  const canPause = (state) =>
    !!state && PLAY_PHASES.indexOf(state.phase) >= 0;

  /* A seat the table was handed: a player who left, or one the clock gave up
     on. Never a bot, which was nobody's to begin with. This is the seat that
     can be given back, whichever deck the table plays with -- `tablePlays`
     is the narrower question of whether the table holds a hand for it. */
  const handedOver = (seat) => !!seat && !!seat.left && !seat.bot;

  // The seat on turn with nobody behind it, or -1: the one seat the table is
  // stopped on and can do nothing about by itself.
  function awaySeat(state) {
    const p = onTurn(state);
    if (p === null || p === undefined) return -1;
    const s = state.seats[p];
    return (s && !s.online && !tablePlays(s, state.cfg)) ? p : -1;
  }

  // The seat left of the dealer bids first and leads the first trick.
  const firstLeader = (round, n) => (round.dealer + 1) % n;

  /* Who says who took a trick, at a table with real cards, or -1 where
     nobody does. The dealer keeps the round, as at a kitchen table: one pair
     of hands on the tally, so two phones cannot count the same trick twice.
     A screen that runs the table and holds no seat counts for the table --
     it is the one everybody can see, and it is nobody's hand. */
  function countingSeat(state) {
    const r = state && state.rounds && state.rounds[state.idx];
    return (r && !virtual(state)) ? r.dealer : -1;
  }

  /* The bids are in and the table is reading them: the round is on tricks,
     but nobody is on play yet. Both decks hold the same way, so a screen asks
     this rather than working it out from a turn that is null for two
     different reasons -- a trick being read is the other one. */
  const bidsHeld = (state) =>
    !!state && state.phase === 'tricks' && !!state.play && !!state.play.held;

  // The scores with the accolades paid in, once they are.
  function totalsWithBonus(cfg, rounds, n, bonus) {
    return totals(cfg, rounds, n).map((v, i) => v + ((bonus && bonus[i]) || 0));
  }

  const api = { SUITS, MISS_RULES, maxCardsFor, schedule, defaultCfg, buildRounds,
                roundScore, roundDone, totals, bidOrder, turnSeat, changeableSeat, forbiddenBid,
                virtual, mustDeal, onTurn, tablePlays, tablePlaysOn, tableSelfPlays, canPause, handedOver, PLAY_PHASES,
                awaySeat, firstLeader, bidsHeld, countingSeat, totalsWithBonus,
                RANKS, deck, shuffle, sortHand, legalPlays, trickWinner,
                suitOf, rankOf, rankValue, cardFace, cardRed, cardGlyph, cardName };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Game = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
