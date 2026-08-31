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
module.exports = ({ Room, G, token, Trail }) => {
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
      /* A round put back by hand. Trails written before that verb was named
         `resetRound` call it 'z' and carry no picture, so the copy is put back
         the same way the table was: the round it is standing in, to its bids. */
      case 'z': Room.resetRound(sandbox); break;
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

  /* How fast it plays itself, against the pace the table played it. It divides
     every beat, the game's own ones included, so a replay at half speed is the
     whole game slowed down rather than the gaps between the cards stretched. */
  function rate(sandbox, v) {
    sandbox.replay.rate = Math.max(0.25, Math.min(8, Number(v) || 1));
    return sandbox.replay.rate;
  }

  /* A copy changed by hand.

     Up to here a copy is derived and nothing else: every state it shows is the
     nearest picture plus the points after it, worked out again on every move.
     So a change made to one would be thrown away by the next step -- there is
     nowhere in a derivation for it to live.

     This is where it goes. The change becomes the copy's last point: a picture,
     marked forced, which is exactly what the dev page already writes when it
     forces a live table. Everything the trail said happened after here is
     dropped, because it no longer describes this copy -- the bids it was about
     have been changed, and the cards played against them would not reconcile.
     Nothing has to refuse a fast-forward past the change: there is nothing past
     it to go to.

     Stepping back over it and forward again finds it, because it is a point
     like any other. Changing it again from further back cuts back to there. */
  function fork(sandbox) {
    const r = sandbox.replay;
    if (!r) return -1;
    r.points = r.points.slice(0, Math.max(0, r.at) + 1)
      .concat([{ k: 'F', w: 'edit', f: Trail.frame(sandbox) }]);
    r.at = r.points.length - 1;
    r.n = r.points.length;
    r.says = lines(r.points);
    r.faces = r.points.map(faceOf);
    r.forked = true;          // and it says so: what is on show is no longer the game
    return r.at;
  }

  /* A table of its own, holding the game the trail is of. It is marked a replay
     from here on, which is what every other part of the server reads to leave
     it alone: it is never written down, never listed as a table to join, never
     played at, and it goes when the page that opened it does. */
  function open(sandbox, of, points) {
    sandbox.replay = { of, at: 0, n: points.length, playing: false, rate: 1, points,
                       says: lines(points), faces: points.map(faceOf) };
    seek(sandbox, 0);
    return sandbox;
  }

  // What the page is told: where it is, and what there is to move about in.
  function say(sandbox) {
    const r = sandbox.replay;
    return {
      t: 'replay', code: sandbox.code, of: r.of, at: r.at, n: r.n, playing: !!r.playing,
      rate: r.rate || 1,
      // Whether it is still the game that was played, or a copy changed by hand.
      forked: !!r.forked,
      /* The copy as every screen sees it. The page watching a replay is not at
         the copy's table -- the panes are -- so this is the only way its band
         and its panels can be drawn off the same state a table draws off. */
      state: Room.publicState(sandbox),
      seats: sandbox.seats.map((s) => ({ id: s.id, name: s.name, watch: s.watch })),
      marks: marks(r.points),
      /* Every point as one letter, in order. A game is a few hundred of them,
         so this is a few hundred bytes -- and it lets the page draw the steps
         inside a round without asking again for each one. */
      kinds: r.points.map((e) => e.k).join(''),
      // And every one of them in words, for the timeline to say on the way past,
      says: r.says || [],
      // and what each has to show for itself, for the mark it wears there.
      faces: r.faces || [],
      game: r.game || null,
      where: where(sandbox),
    };
  }

  /* Where it has got to, and nothing else. A replay playing itself moves with
     nobody asking it to, so the page that set it going has to be told -- but
     only this much of it moves. The rounds and the points of a round are what
     the trail is, and the trail does not change while it is being read. */
  const at = (sandbox) => ({
    t: 'replayAt', code: sandbox.code, at: sandbox.replay.at,
    playing: !!sandbox.replay.playing, rate: sandbox.replay.rate || 1,
    forked: !!sandbox.replay.forked,
    where: where(sandbox), state: Room.publicState(sandbox),
  });

  // One line saying what the table is showing, for the panel to put up.
  function where(sandbox) {
    const r = sandbox.replay, ev = r.points[r.at] || {};
    const round = sandbox.rounds[sandbox.idx];
    const at = round ? `Round ${sandbox.idx + 1} of ${sandbox.rounds.length} · ${round.cards} cards` : 'The finish';
    if (ev.k === 'E') return 'The game ends';
    const said = did(ev, (p) => ((sandbox.seats[p] || {}).name || 'somebody'));
    return said ? `${at} · ${said}` : at;
  }

  /* One point, in words. The line under the band and the word on each bubble
     of the stepper are the same sentence about the same thing, so it is said
     once here and read from both. `who` is asked rather than looked up: the
     line has the table in front of it, and the stepper has only the trail. */
  function did(ev, who) {
    switch (ev.k) {
      case 'b': return `${who(ev.p)} bids ${ev.v}`;
      case 'c': return `${who(ev.p)} plays ${G.cardName(ev.x)}`;
      case 'w': return `${who(ev.p)} takes the trick`;
      case 'W': return 'a trick taken back';
      case 'e': return 'the round is scored';
      case 'z': return 'the round is put back';
      case 's': return 'a trick opens';
      case 'F': return ev.w === 'edit' ? 'changed by hand' : 'the table was forced';
      case 'G': return 'the game starts';
      case 'E': return 'the game ends';
      case 'R': return ev.w === 'bum' ? 'thrown in and dealt again' : 'the round is dealt';
      default: return '';
    }
  }

  /* Every point in words, in order, worked out once when the copy is made.
     The names come from the pictures as they go by, so a seat renamed part way
     through is called what it was called at each point.

     This is not worked out again as the copy is moved about in: the trail does
     not change while it is being read. */
  function lines(points) {
    let names = [];
    return points.map((ev) => {
      if (ev.f && ev.f.seats) names = ev.f.seats.map((x) => x.name);
      return did(ev, (p) => (names[p] || 'somebody'));
    });
  }

  /* What a point has to show for itself on a timeline: a bid is its number and
     a card is the card. Everything else is a kind of thing rather than a value,
     and the page draws the icon for its kind. This is the value, not the
     drawing of it -- what a mark looks like is the page's business. */
  const faceOf = (ev) => (ev.k === 'b' ? String(ev.v)
    : (ev.k === 'c' ? G.cardName(ev.x) : ''));

  return { open, seek, step, rate, fork, say, at, marks, ready, did, lines };
};
