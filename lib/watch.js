'use strict';
/* Watching a game again: the messages that open a copy of one and move about
   in it.

   lib/replay.js is what a copy *is* -- the trail put back through the game's
   own verbs. This is the door to it: one message, `{ t: 'replay', do: ... }`,
   which any socket may send. It needs no table and no key, because a game on
   file is finished and its scorecard is already served to anybody who asks;
   putting it back adds only the order it happened in. The one thing that is
   not public is a table still in play -- its trail holds the cards in every
   hand -- so watching *that* one back is the host's, and server.js says so
   before it gets here.

   The copy belongs to the socket that asked for one: that socket knows its
   code, the copy knows the socket to tell while it plays itself on, and the
   socket closing is the copy going. */
module.exports = ({ createRoom, roomOf, listGames, send, fail, broadcast,
                   Replay, Trail, dropRoom, paceReplay }) => {

  /* What there is to watch: the game this table is playing now, and every
     game on file. A game's own table may be long gone -- the trail outlives it,
     kept beside the scorecard -- so the list is not this table's alone. */
  const GAMES_OFFERED = 20;
  /* A page that has picked nothing yet asks this same question, so `room` may
     be nothing: the games on file belong to the server, and only "this table"
     needs a table to be on. */
  function games(room) {
    const live = room ? Trail.read(room.code).length : 0;
    // The headline of each: enough for a row that says what the game was.
    const played = (listGames(null) || [])
      .map((g) => ({ id: g.id, code: g.code, at: g.at, names: g.names,
                     totals: g.totals, winners: g.winners }));
    /* And the games that never finished, which have no scorecard to read a
       headline off and carry their own. They are the ones most worth watching
       again: a game that could not go on is a game with something wrong in it. */
    const broke = (Trail.listKept() || [])
      .map((g) => ({ id: g.id, code: g.code, at: g.at, names: g.names,
                     unfinished: true, round: g.round, rounds: g.rounds }));
    const list = played.concat(broke)
      .sort((a, b) => (b.at || 0) - (a.at || 0))
      .slice(0, GAMES_OFFERED);
    return { here: live ? room.code : null, games: list };
  }
  // Whatever the page is told, it is told what there is to watch with it.
  const sayReplay = (ws, room, copy) => send(ws, Object.assign(
    copy ? Replay.say(copy) : { t: 'replay', code: null, of: room ? room.code : null },
    games(room)));

  /* The copy this socket opened, or nothing. Only the socket that asked for a
     copy knows its code, which is the whole of the authority over one. */
  const copyOf = (ws) => (ws.ctx && ws.ctx.replay && roomOf(ws.ctx.replay)) || null;

  /* A copy the dev controls have changed. A replay is read until it is written
     to; the moment it is, it stops being what the trail says and becomes its
     own -- the change is its last point, and the rest of the trail goes. It
     stops playing itself too: a copy that is no longer the game should not go
     on running through a game it is no longer. Told the same way every other
     move about a copy is told, because it is one. */
  function forked(ws, copy) {
    paceReplay(copy, false);
    Replay.fork(copy);
    broadcast(copy);
    return said(ws, copy);
  }

  /* The copy, said, with nothing forked. A control pressed that lands on the
     value already there changed nothing, and cutting a game's tape for nothing
     is the worst thing this page could do quietly. */
  function said(ws, copy) {
    broadcast(copy);
    return sayReplay(ws, ws.ctx && ws.ctx.room, copy);
  }

  function handleWatch(ws, m, room) {
    // A page watching a game and nothing else never joined a table, so the
    // place to remember the copy has to be made rather than found.
    const ctx = ws.ctx || (ws.ctx = {});
    const shut = () => {
      const had = ctx.replay && roomOf(ctx.replay);
      ctx.replay = null;
      if (had) dropRoom(had.code);
    };
    // Closing is the panel going, so it is said plainly: everything else the
    // page is told is a panel that should stay up.
    if (m.do === 'close') { shut(); return send(ws, { t: 'replay', code: null, shut: true }); }
    if (m.do === 'games') {
      return sayReplay(ws, room, ctx.replay ? roomOf(ctx.replay) : null);
    }

    if (m.do === 'open') {
      /* A game on file, or the one this table is playing. A game names the
         table it was played at in its own first point, so a copy of one knows
         what it is a copy of even where that table has long gone. */
      const points = m.game ? Trail.readGame(String(m.game))
                            : (room ? Trail.read(room.code) : []);
      if (!points.length) {
        return fail(ws, m.game ? 'nothing was written down about that game'
                    : (room ? 'nothing has been written down about this table yet'
                            : 'pick a game to watch'));
      }
      shut();
      const copy = createRoom();
      Replay.open(copy, (points[0] && points[0].c) || (room && room.code) || '????', points);
      if (m.game) copy.replay.game = String(m.game);
      /* Both ways round: this socket knows the copy it opened, and the copy
         knows the socket to tell while it plays itself on. Nothing else is on
         the copy that could ask it where it is. */
      copy.replay.to = ws;
      ctx.replay = copy.code;
      broadcast(copy);
      return sayReplay(ws, room, copy);
    }

    const copy = ctx.replay && roomOf(ctx.replay);
    if (!copy || !copy.replay) return fail(ws, 'open a replay first');
    /* Moving about in it by hand stops it playing itself: two clocks on one
       copy would fight over where it is. */
    if (m.do === 'seek') { paceReplay(copy, false); Replay.seek(copy, Number(m.at)); }
    else if (m.do === 'step') { paceReplay(copy, false); Replay.step(copy, Number(m.by) || 1); }
    else if (m.do === 'play') paceReplay(copy, true);
    else if (m.do === 'pause') paceReplay(copy, false);
    /* How fast it plays itself. The beat already waited out is left to run: it
       is one beat, and clearing the timer to shorten it would step a point. */
    else if (m.do === 'rate') Replay.rate(copy, m.v);
    /* A fork carried on, or stopped. A copy is stopped the moment it is made,
       and a fork stays that way: forking is setting a game up, not starting
       one. This is what starts it -- the panes can play the hand, the bots
       take their turns, and everything that lands goes onto the copy's own
       tape. A copy that is still the game it is a copy of takes nothing: what
       happened at it has already happened. */
    else if (m.do === 'run') {
      if (!copy.replay.forked) return fail(ws, 'nothing is played at a copy until it is changed');
      paceReplay(copy, false);        // the pacer and the table are two clocks
      copy.paused = !m.on;
    }
    /* A fork put back to where it left the game. What the copy became goes:
       the change, and whatever was played on it after. The game itself was
       never touched, so what is left is what was opened. */
    else if (m.do === 'reset') {
      paceReplay(copy, false);
      if (!Replay.unfork(copy)) return fail(ws, 'this copy is still the game it is a copy of');
    } else return fail(ws, 'unknown replay');
    broadcast(copy);
    return sayReplay(ws, room, copy);
  }
  return { handleWatch, games, copyOf, forked, said };
};
