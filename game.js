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

  const api = { SUITS, MISS_RULES, maxCardsFor, schedule, defaultCfg, buildRounds,
                roundScore, roundDone, totals, bidOrder, turnSeat, changeableSeat, forbiddenBid };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Game = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
