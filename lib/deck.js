'use strict';
/* The virtual deck: the server is the dealer.

   A hand is a secret, so the hands live here and only the table -- the cards
   played, how many are left, who won the last trick -- ever leaves. The rules
   are held here too, so a phone cannot renege, play out of turn, or play a
   card it does not hold.

   It is arithmetic over the room and nothing else. It says whether a card may
   go and moves it; telling the table, and the pause a finished trick is held
   up for, belong to the server.
*/
module.exports = ({ G, curRound, scoreRound }) => {
  /* How long a finished trick stays up before the winner leads. It is longer
     than the phones take to name who took it and gather it in (TOOK_HOLD in
     public/felt.js): a lead landing while that is still on screen would cut it
     short. */
  const TRICK_HOLD = Number(process.env.TRICK_HOLD) || 2300;

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
                  won: Array(n).fill(0), last: null,
                  // A deal is watched before it is bid: when the cards went
                  // out, and which phones have said their table is up.
                  dealtAt: Date.now(), ready: [] };
  }

  // The bids are in: the player left of the dealer leads the first trick.
  function startPlay(room) {
    const r = curRound(room), n = room.seats.length;
    if (!room.play || room.play.round !== room.idx) dealHands(room);
    room.play.trick = [];
    room.play.last = null;
    room.play.turn = G.firstLeader(r, n);
  }

  // What everybody may see: the cards on the table, how many are left in each
  // hand, and who won the last trick. Never a hand.
  function playPublic(room) {
    const p = room.play;
    if (!p) return null;
    return { turn: p.turn, trick: p.trick, won: p.won, last: p.last,
             upcard: p.upcard, counts: p.hands.map((h) => h.length) };
  }

  // The suit led in the trick on the table, or null when nothing is down.
  const ledSuit = (play) => (play.trick.length ? G.suitOf(play.trick[0].card) : null);

  // Why seat p may not play `card` now, or null when it may.
  function refusal(room, p, card) {
    const play = room.play;
    if (!play || play.turn !== p) return 'not your turn';
    const hand = play.hands[p];
    if (hand.indexOf(card) < 0) return 'you do not hold that card';
    const led = ledSuit(play);
    if (G.legalPlays(hand, led).indexOf(card) < 0) {
      const suit = G.SUITS.find((x) => x.k === led);
      return `you must follow ${suit ? suit.name.toLowerCase() : 'the suit led'}`;
    }
    return null;
  }

  // The card leaves the hand and lands on the table. Returns null while the
  // trick is still open, or the seat that took it once it is full: the trick
  // is then held up with nobody on turn, until settleTrick moves the table on.
  function putCard(room, p, card) {
    const play = room.play, r = curRound(room), n = room.seats.length;
    if (!play.trick.length) play.last = null;        // the last trick has had its moment
    const hand = play.hands[p];
    hand.splice(hand.indexOf(card), 1);
    play.trick.push({ p, card });
    if (play.trick.length < n) { play.turn = (p + 1) % n; return null; }
    const winner = G.trickWinner(play.trick, r.trump);
    play.won[winner] += 1;
    play.last = { trick: play.trick.slice(), winner };
    play.trick = [];
    play.turn = null;
    return winner;
  }

  // The held trick is over: the winner leads the next one, or the last one
  // scores the round.
  function settleTrick(room, winner) {
    const play = room.play;
    if (play.hands.every((h) => !h.length)) scoreRound(room, play.won.slice());
    else play.turn = winner;
  }

  return { TRICK_HOLD, dealHands, startPlay, playPublic, ledSuit, refusal, putCard, settleTrick };
};
