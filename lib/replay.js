'use strict';
/* A game watched again, on a table of its own.

   The trail says what happened; this puts it back. Never onto the table it
   happened at -- a real game has people at it, and taking their screens over to
   look at the past would be its own kind of bug. A copy is made instead, seeded
   from the trail, and the dev page points its screens at that. The game carries
   on beside it, untouched.

   What a point is put back through is the game's own verbs: a bid through
   seatBid, a card through putCard, a round scored through scoreRound. So a
   replayed table is one the rules could have reached, and a replay that could
   not happen is a replay that stops rather than one that lies. The only points
   set outright are the ones carrying a picture, and they carry one exactly
   because the game could not be worked out again without it -- the deal.

   Seeking is that same thing from the nearest picture: go back to the round,
   then put the rest back one at a time. */
module.exports = ({ Room, G, token }) => {
  const { Deck } = Room;
  const framed = (ev) => !!(ev && ev.f);
  /* A picture is put on the table as a copy of itself. `become` takes the
     record's own arrays, so a copy seeded straight from a point would play its
     round out of the trail's rounds -- and the next seek would start from a
     picture that had had a game played on it. Reading a trail must not change
     it. */
  const copyOf = (f) => JSON.parse(JSON.stringify(f));

  // Where the rounds start, for a scrubber to offer: a mark a round attempt.
  function marks(points) {
    const out = [];
    points.forEach((ev, at) => {
      if (ev.k === 'R') out.push({ at, i: ev.i, d: ev.d, w: ev.w, cards: (ev.f.rounds[ev.i] || {}).cards });
      if (ev.k === 'E') out.push({ at, i: null, w: 'end' });
    });
    return out;
  }

  /* The table put where a point leaves it. Anything the verbs would refuse is
     the trail and the table having come apart, so it is left alone rather than
     forced: a replay is allowed to stop, never to invent. */
  function apply(sandbox, ev) {
    if (framed(ev)) { Room.become(sandbox, copyOf(ev.f)); mintKeys(sandbox); return; }
    const play = sandbox.play;
    switch (ev.k) {
      case 'b': Room.seatBid(sandbox, ev.p, ev.v); break;
      case 'c': {
        if (!play || !play.hands) return;
        ready(sandbox);
        const hand = sandbox.play.hands[ev.p];
        if (!hand || hand.indexOf(ev.x) < 0) return;   // the trail and the table have parted
        Deck.putCard(sandbox, ev.p, ev.x);
        break;
      }
      /* With cards on the phones the card took the trick as it landed, so this
         is a marker. With real cards it is the tap itself -- and a tap is
         refused while the bids are still up, so the beat is stepped over here
         the same way it is for a card. */
      case 'w':
        if (play && play.real) { ready(sandbox); Room.countTrick(sandbox, ev.p); }
        break;
      case 'W': Room.uncountTrick(sandbox); break;
      // The last card of a round scores it on the way in, so this only lands
      // where it has not already happened.
      case 'e': if (sandbox.idx === ev.i) Room.scoreRound(sandbox, ev.v.slice()); break;
      case 'z': Room.undo(sandbox); break;
      default: break;                                   // 'G' and 's' are markers
    }
  }

  /* The beats a real table takes are timers on the server, and a replay has no
     use for them: the card that comes next is already known. So the hold on the
     bids and the hold on a finished trick are stepped over here, and the pacer
     puts the time back where the table would have taken it. */
  function ready(sandbox) {
    const play = sandbox.play;
    if (!play) return null;
    if (play.held) { Room.openPlay(sandbox); return 'bids'; }
    // Only a table dealing the cards has a trick to gather. With real cards the
    // tap is the whole of it, and there are no hands to look at.
    if (!play.real && play.turn === null && play.last && play.last.winner !== undefined) {
      Deck.settleTrick(sandbox, play.last.winner);
      return 'trick';
    }
    return null;
  }

  /* A copy is watched, never played, so its seats get a watching key and never
     a seat's own -- and never the ones belonging to the table it is a copy of,
     which the trail does not carry in the first place. */
  function mintKeys(sandbox) {
    sandbox.seats.forEach((s) => { s.watch = s.watch || token(); s.token = null; s.online = false; });
    sandbox.stand = false;
    sandbox.paused = true;       // nothing here plays itself: the pacer has the clock
  }

  /* The table as it stood after `at` points. Back to the nearest picture, then
     forward through the points between: the only way that is honest, because
     the pictures are the only states the trail actually holds. */
  function seek(sandbox, at) {
    const points = sandbox.replay.points;
    const want = Math.max(0, Math.min(Math.round(at) || 0, points.length - 1));
    let j = -1;
    for (let i = want; i >= 0; i--) if (framed(points[i])) { j = i; break; }
    if (j < 0) j = points.findIndex(framed);            // nothing before it: the first there is
    if (j < 0) return;                                   // a trail with no picture is no replay
    Room.become(sandbox, copyOf(points[j].f));
    mintKeys(sandbox);
    for (let i = j + 1; i <= want; i++) apply(sandbox, points[i]);
    sandbox.replay.at = Math.max(want, j);
  }

  // One point on, or one back. Forward is the next point; back always re-seeds.
  function step(sandbox, by) {
    seek(sandbox, sandbox.replay.at + (by < 0 ? -1 : 1));
  }

  /* A table of its own, holding the game the trail is of. It is marked a replay
     from here on, which is what every other part of the server reads to leave
     it alone: it is never written down, never listed as a table to join, never
     played at, and it goes when the page that opened it does. */
  function open(sandbox, of, points) {
    sandbox.replay = { of, at: 0, n: points.length, playing: false, points };
    seek(sandbox, 0);
    return sandbox;
  }

  // What the page is told: where it is, and what there is to move about in.
  function say(sandbox) {
    const r = sandbox.replay;
    return {
      t: 'replay', code: sandbox.code, of: r.of, at: r.at, n: r.n, playing: !!r.playing,
      seats: sandbox.seats.map((s) => ({ id: s.id, name: s.name, watch: s.watch })),
      marks: marks(r.points),
      where: where(sandbox),
    };
  }

  // One line saying what the table is showing, for the panel to put up.
  function where(sandbox) {
    const r = sandbox.replay, ev = r.points[r.at] || {};
    const round = sandbox.rounds[sandbox.idx];
    const at = round ? `Round ${sandbox.idx + 1} of ${sandbox.rounds.length} · ${round.cards} cards` : 'The finish';
    const seatName = (p) => ((sandbox.seats[p] || {}).name || 'somebody');
    if (ev.k === 'b') return `${at} · ${seatName(ev.p)} bids ${ev.v}`;
    if (ev.k === 'c') return `${at} · ${seatName(ev.p)} plays ${ev.x}`;
    if (ev.k === 'w') return `${at} · ${seatName(ev.p)} takes the trick`;
    if (ev.k === 'W') return `${at} · a trick taken back`;
    if (ev.k === 'e') return `${at} · the round is scored`;
    if (ev.k === 'z') return `${at} · a step back`;
    if (ev.k === 'E') return 'The game ends';
    if (ev.k === 'R') return `${at} · ${ev.w === 'bum' ? 'thrown in and dealt again' : 'dealt'}`;
    return at;
  }

  return { open, seek, step, say, marks, ready };
};
