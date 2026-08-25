'use strict';
/* The virtual deck: the server is the dealer.

   A hand is a secret, so the hands live here and only the table -- the cards
   played, how many are left, who won the last trick -- ever leaves. The rules
   are held here too, so a phone cannot renege, play out of turn, or play a
   card it does not hold.
*/
module.exports = ({ G, curRound, broadcast, fail, scoreRound }) => {
  /* ---------------- the virtual deck ---------------- */

  const TRICK_HOLD = Number(process.env.TRICK_HOLD) || 1500;   // how long a finished trick stays up
  const virtual = (room) => room.cfg.deck === 'virtual';

  // Shuffle, deal, and turn the next card for trump. With no card left over --
  // four players at thirteen cards -- the hand is played at no trumps.
  function dealHands(room) {
    const r = curRound(room), n = room.seats.length;
    if (!r) return;
    const d = G.shuffle(G.deck());
    const hands = [];
    for (let p = 0; p < n; p++) hands.push(G.sortHand(d.splice(0, r.cards)));
    const up = (room.cfg.trump && d.length) ? d.shift() : null;
    r.trump = room.cfg.trump ? (up ? G.suitOf(up) : 'NT') : null;
    room.play = { round: room.idx, hands, upcard: up, trick: [], turn: null,
                  won: Array(n).fill(0), last: null };
  }

  // The bids are in: the player left of the dealer leads the first trick.
  function startPlay(room) {
    const r = curRound(room), n = room.seats.length;
    if (!room.play || room.play.round !== room.idx) dealHands(room);
    room.play.trick = [];
    room.play.last = null;
    room.play.turn = (r.dealer + 1) % n;
  }

  // What everybody may see: the cards on the table, how many are left in each
  // hand, and who won the last trick. Never a hand.
  function playPublic(room) {
    const p = room.play;
    if (!p) return null;
    return { turn: p.turn, trick: p.trick, won: p.won, last: p.last,
             upcard: p.upcard, counts: p.hands.map((h) => h.length) };
  }

  // One card. The server holds the rules, so a phone cannot renege.
  function playCard(ws, room, p, card) {
    const play = room.play, r = curRound(room), n = room.seats.length;
    if (play.turn !== p) return fail(ws, 'not your turn');
    const hand = play.hands[p];
    if (hand.indexOf(card) < 0) return fail(ws, 'you do not hold that card');
    const led = play.trick.length ? G.suitOf(play.trick[0].card) : null;
    if (G.legalPlays(hand, led).indexOf(card) < 0) {
      const suit = G.SUITS.find((x) => x.k === led);
      return fail(ws, `you must follow ${suit ? suit.name.toLowerCase() : 'the suit led'}`);
    }

    if (!play.trick.length) play.last = null;        // the last trick has had its moment
    hand.splice(hand.indexOf(card), 1);
    play.trick.push({ p, card });
    if (play.trick.length < n) {
      play.turn = (p + 1) % n;
      return broadcast(room);
    }

    // the trick is full: name the winner and hold it up for the table
    const winner = G.trickWinner(play.trick, r.trump);
    play.won[winner] += 1;
    play.last = { trick: play.trick.slice(), winner };
    play.trick = [];
    play.turn = null;
    const tag = play, at = room.idx;
    setTimeout(() => {
      if (room.play !== tag || room.idx !== at) return;      // the game moved on
      if (tag.hands.every((h) => !h.length)) scoreRound(room, tag.won.slice());
      else tag.turn = winner;
      broadcast(room);
    }, TRICK_HOLD);
    return broadcast(room);
  }

  return { TRICK_HOLD, virtual, dealHands, startPlay, playPublic, playCard };
};
