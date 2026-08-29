'use strict';
/* Players the table provides, for a hand short of people.

   A bot is a seat with nobody behind it. It has a name, it holds cards the way
   everybody else does, and the server plays them for it. It knows nothing the
   table does not: it is dealt its hand by the same dealer, it is shown the same
   trick, and every card it plays goes through the same rules as a card played
   from a phone. There is no cheating available to it -- not because it is
   trusted, but because it asks the same questions as everybody else.

   Two halves. The first works out what to do with a hand and answers with a
   number or a card; it is arithmetic over a hand and nothing else, so it can be
   asked directly. The second is the driver: it watches whose turn it is and,
   after a pause long enough to look like thinking, does it.
*/
module.exports = ({ G, curRound, broadcast, seatBid, playCard, bumDeal }) => {

  // Long enough that a bot does not answer before the table has read the last
  // card, short enough that three of them are not a wait.
  const DELAY = Math.max(120, Number(process.env.BOT_DELAY) || 1250);

  /* A round is dealt on the phones before it is bid: the deck is shuffled, the
     cards fly out one at a time and the trump is turned, and that is seconds of
     watching. A bot that bids while that is playing has bid before anybody saw
     a card, and the bids are simply there when the table appears.

     So the first hand a bot bids in a round waits for the phones. Each says
     when its table is up -- the deal played out, or was tapped away, or was
     never played at all -- and that is what is waited for, not a guess at how
     long the scene runs. A phone that says nothing is waited on only so long. */
  const DEAL_WAIT = Math.max(0, Number(process.env.BOT_DEAL_WAIT) || 9000);

  const NAMES = ['Otter', 'Heron', 'Pike', 'Reed', 'Willow', 'Bream', 'Perch', 'Vole'];

  /* ---------------- what a hand is worth ---------------- */

  /* The bid: what this hand should win, near enough.

     A trump is worth more than the same rank in another suit, and the low
     trumps are worth something too -- they win late, once the suit is out. A
     side suit is only worth its top two cards. A void is worth a little when
     there are trumps to ruff with, and nothing when there are not.

     `forbidden` is the number screw-the-dealer will not allow. */
  function bidFor(hand, cards, trump, forbidden) {
    const t = (trump && trump !== 'NT') ? trump : null;
    let expect = 0;
    hand.forEach((c) => {
      const v = G.rankValue(c);                   // 2 is 0, ace is 12
      if (t && G.suitOf(c) === t) {
        expect += v >= 12 ? 1 : v >= 11 ? 0.85 : v >= 10 ? 0.65 : v >= 9 ? 0.45 : v >= 8 ? 0.3 : 0.15;
      } else {
        expect += v >= 12 ? 0.85 : v >= 11 ? 0.55 : v >= 10 ? 0.25 : v >= 9 ? 0.1 : 0;
      }
    });
    if (t && hand.some((c) => G.suitOf(c) === t) && cards >= 4) {
      const suits = ['S', 'H', 'D', 'C'].filter((s) => s !== t);
      const voids = suits.filter((s) => !hand.some((c) => G.suitOf(c) === s)).length;
      expect += Math.min(1.5, voids * 0.5);
    }
    let bid = Math.max(0, Math.min(cards, Math.round(expect)));
    if (forbidden !== null && forbidden !== undefined && bid === forbidden) {
      bid = bid > 0 ? bid - 1 : Math.min(cards, bid + 1);
    }
    return bid;
  }

  /* The card. `want` is how many more tricks this seat still needs: over its
     bid there is nothing to gain and a trick taken is a trick wasted, so the
     bot ducks. Whether a card would win is not guessed at -- the shared rule
     that decides a trick is asked. */
  function cardFor(hand, trick, trump, want) {
    const led = trick.length ? G.suitOf(trick[0].card) : null;
    const legal = G.legalPlays(hand, led);
    if (legal.length < 2) return legal[0];
    const t = (trump && trump !== 'NT') ? trump : null;
    const isT = (c) => !!t && G.suitOf(c) === t;
    /* Three ways to pick a card, and the difference between them is what makes
       the bot play like a player rather than a sorting order.

       `low`  the cheapest card to part with: side suits before trumps, then the
              lowest rank. A trump is worth more than the same rank elsewhere,
              so it is the last thing given up.
       `dump` the best card to throw away when the trick is not wanted: the
              highest card that is not a trump. It is the one least likely to
              win a trick later, and the trumps stay in the hand.
       `best` the card most likely to take a trick, for a lead: the highest
              rank, and a trump ahead of a side card of the same rank. Not
              trumps first -- leading the two of trumps because it is a trump
              throws it away, because everybody else follows with a higher one. */
    const low = (list) => list.slice().sort((a, b) =>
      (isT(a) - isT(b)) || (G.rankValue(a) - G.rankValue(b)))[0];
    const dump = (list) => list.slice().sort((a, b) =>
      (isT(a) - isT(b)) || (G.rankValue(b) - G.rankValue(a)))[0];
    const best = (list) => list.slice().sort((a, b) =>
      (G.rankValue(b) - G.rankValue(a)) || (isT(b) - isT(a)))[0];

    if (!trick.length) {
      // Leading. Wanting tricks, lead the best thing in the hand; wanting none,
      // lead the cheapest.
      return want > 0 ? best(legal) : low(legal);
    }

    // Following. The rule that decides the trick answers for every candidate.
    const wins = legal.filter((c) => G.trickWinner(trick.concat([{ p: -1, card: c }]), trump) === -1);
    if (want > 0 && wins.length) return low(wins);      // the cheapest that does it
    const loses = legal.filter((c) => wins.indexOf(c) < 0);
    // Ducking, the card to throw is the highest one that is not a trump: it is
    // the one least likely to win a trick later.
    if (loses.length) return want > 0 ? low(loses) : dump(loses);
    return low(wins);                                   // everything wins: waste the least
  }

  /* ---------------- the driver ---------------- */

  // A name no seat at this table has yet.
  function botName(room) {
    const taken = new Set(room.seats.map((s) => s.name.toLowerCase()));
    return NAMES.find((n) => !taken.has(n.toLowerCase())) || `Bot ${room.seats.length + 1}`;
  }

  /* A seat the table plays. A bot is one from the moment it sits down. A
     player who has left the game is one from the moment they go: the hand is
     still theirs on the scorecard, but nobody is behind it, so the table
     plays it out rather than waiting for a phone that is not coming back.
     The rule itself is the shared one, so every screen agrees with it. */
  const auto = (room, s) => G.tablePlays(s, room.cfg);
  /* Anything for the driver to do: a seat the table plays, and somebody still
     in the game to see it played. The second half is the one gate -- a table
     the last player has left stands still rather than playing itself out. */
  const anyAuto = (room) => G.tablePlaysOn(room) && room.seats.some((s) => auto(room, s));

  // Whether every phone that is being dealt to has its table up. Nothing to
  // wait for at a table with real cards, or once the bidding is under way.
  function dealt(room) {
    if (!G.virtual(room) || room.phase !== 'bid' || !room.play) return true;
    const ready = room.play.ready || [];
    return !room.seats.some((s, i) => s.online && !auto(room, s) && !ready[i]);
  }

  // A bum deal is nothing to a bot: it holds no opinion, so it agrees and lets
  // the table have what it asked for.
  function voteOwed(room) {
    const v = room.vote;
    if (!v || v.round !== room.idx) return false;
    return room.seats.some((s, i) => auto(room, s) && !v.yes.includes(i) && !v.no.includes(i));
  }

  /* Called after every state that goes out. If a bot is on play -- or owes an
     answer to a vote -- it is given one thing to do, once, after a pause. */
  function nudge(room) {
    if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
    if (!anyAuto(room)) return;
    const p = G.onTurn(room);
    const onPlay = p !== null && p !== undefined && auto(room, room.seats[p]);
    if (!onPlay && !voteOwed(room)) return;
    // What the table looked like when this was scheduled. If any of it has
    // moved on, the turn is worked out again rather than acted on stale.
    const at = room.idx, phase = room.phase, tag = room.play;
    const wait = dealt(room) ? DELAY
      : Math.max(DELAY, (room.play.dealtAt || 0) + DEAL_WAIT - Date.now());
    room.botTimer = setTimeout(() => {
      room.botTimer = null;
      if (room.idx !== at || room.phase !== phase || room.play !== tag) { nudge(room); return; }
      act(room);
    }, wait);
  }

  function stop(room) {
    if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
  }

  function act(room) {
    if (voteOwed(room)) {
      const v = room.vote;
      room.seats.forEach((s, i) => {
        if (auto(room, s) && !v.yes.includes(i) && !v.no.includes(i)) v.yes.push(i);
      });
      if (v.yes.length >= room.seats.length) bumDeal(room);
      return broadcast(room);
    }

    const p = G.onTurn(room);
    if (p === null || p === undefined || !auto(room, room.seats[p])) return;
    const r = curRound(room);
    if (!r) return;

    if (room.phase === 'bid') {
      const hand = (room.play && room.play.hands[p]) || [];
      const forbidden = G.forbiddenBid(r, p, room.cfg, room.seats.length);
      seatBid(room, p, bidFor(hand, r.cards, r.trump, forbidden));
      return broadcast(room);
    }
    if (room.phase === 'tricks' && room.play && G.virtual(room)) {
      const want = r.bids[p] - room.play.won[p];
      const card = cardFor(room.play.hands[p], room.play.trick, r.trump, want);
      // Through the same door a phone's card goes through: the rules are the
      // deck's, and a bot gets no say in them.
      playCard(null, room, p, card);
    }
  }

  return { NAMES, DELAY, DEAL_WAIT, bidFor, cardFor, botName, nudge, stop, anyAuto, dealt };
};
