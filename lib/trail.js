'use strict';
/* What happened to a table, written down as it happened.

   A game is a sequence of small things -- a round opened, a bid, a card, a
   trick taken -- and the scorecard keeps only what they added up to. The trail
   keeps the sequence, so a game can be walked back through afterwards instead
   of watched in the hope of catching the moment.

   Two halves, the way lib/tables.js has two. The pure half is `point` and
   `frame`: a Room verb pushes one small object onto `room.trail` and returns,
   knowing nothing about the disk. The disk half is `flush`, which the server
   calls at the one moment something has changed, and which appends those
   objects to a file of their own.

   A file of their own, and appended, because a point must cost a point. The
   table's own record is rewritten whole after every broadcast, so a trail
   living on the room would be written again for every card -- some hundreds of
   megabytes over one game, on a machine that may be a phone. Appending a line
   costs the line.

   A point is an event, not a picture of the table: twenty-odd bytes against
   three kilobytes. The picture is taken only where a game cannot be worked out
   again without one -- a round opening, because the deal is shuffled and will
   never come round the same way twice.

   One game at a time. A table lives six hours and plays several games; the
   game starting is where the file starts again. */
const fs = require('fs');
const path = require('path');

module.exports = ({ DATA, KEEP_HOURS, KEEP_GAMES, TRAIL_MAX, record }) => {
  const DIR = path.join(DATA, 'trail');
  const file = (code) => path.join(DIR, `${code}.jsonl`);
  // A table still in play is named by its code; a game that finished is named
  // the way its scorecard is, so the two are told apart by their names alone.
  const kept = (at, id) => path.join(DIR, `${at}-${id}.jsonl`);
  const isLive = (f) => /^[A-Z0-9]{4}\.jsonl$/.test(f);
  const isKept = (f) => /^\d+-[0-9a-f]{12}\.jsonl$/.test(f);

  /* ---------- the pure half: what a Room verb calls ---------- */

  /* One thing that happened, held on the room until the server writes it down.

     A copy of a table writes nothing: it is a game being put back, not one
     being played, and its verbs run exactly as the real ones did. */
  function point(room, ev) {
    if (!room || room.replay) return;
    if (!room.trail) room.trail = [];
    room.trail.push(ev);
  }

  /* The table as it stands, small enough to keep beside the points.

     Without the talk, which is three quarters of a record's bytes and has
     nothing to do with how a game was played. Without the keys, which a copy
     of the table must mint for itself and must never take from the real one.
     Without the buffer, which is the points themselves.

     A copy, and it has to be one. `record` hands over the room's own arrays --
     it is built to be written down at once -- and this is held until the next
     broadcast. Without the copy the hands dealt here would be read back empty,
     because they are the hands the round is about to be played out of. */
  function frame(room) {
    const rec = JSON.parse(JSON.stringify(record(room)));
    delete rec.chat;
    delete rec.chatSeq;
    delete rec.trail;
    delete rec.hostToken;
    rec.seats = rec.seats.map((s) => {
      const one = Object.assign({}, s);
      delete one.token;
      delete one.watch;
      return one;
    });
    return rec;
  }

  /* ---------- the disk half: what the server calls ---------- */

  let dirMade = false;
  const stopped = new Set();        // tables told once that their trail is full

  /* Everything the room has piled up since the last time, in one append.

     A game starting writes the file instead of adding to it: the trail is the
     game being played, and the one before it has had its turn. Anything piled
     up before that point belonged to that older game and goes with it. */
  function flush(room) {
    const buf = room.trail;
    if (!buf || !buf.length) return;
    room.trail = [];
    const fresh = buf.map((e) => e.k).lastIndexOf('G');
    const lines = (fresh >= 0 ? buf.slice(fresh) : buf)
      .map((e) => JSON.stringify(e)).join('\n') + '\n';
    try {
      if (!dirMade) { fs.mkdirSync(DIR, { recursive: true }); dirMade = true; }
      const f = file(room.code);
      if (fresh >= 0) { stopped.delete(room.code); fs.writeFileSync(f, lines); return; }
      /* A trail that has run away with itself stops rather than filling the
         disk. A game is about ninety kilobytes; past the cap something is
         wrong, and the table matters more than the note of it. */
      let size = 0;
      try { size = fs.statSync(f).size; } catch (e) {}
      if (size > TRAIL_MAX) {
        if (!stopped.has(room.code)) {
          stopped.add(room.code);
          console.warn(`[trail] ${room.code} is past ${TRAIL_MAX} bytes: no more is written down`);
        }
        return;
      }
      fs.appendFileSync(f, lines);
    } catch (e) {
      dirMade = false;
      console.warn(`[trail] could not write ${room.code}:`, e.message);
    }
  }

  // What a table has written down, oldest first, or nothing.
  function read(code) {
    try {
      return fs.readFileSync(file(code), 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
        .filter(Boolean);
    } catch (e) { return []; }
  }

  /* The game just filed keeps the trail of how it was played, beside its
     scorecard and under the same name. The table plays on and starts a fresh
     trail at its next game, so this is the only copy that outlives it. */
  function keep(room) {
    if (!room.gameId || !room.finishedAt) return;
    flush(room);                    // the finish itself is still in the buffer
    try {
      const from = file(room.code);
      if (!fs.existsSync(from)) return;
      fs.copyFileSync(from, kept(room.finishedAt, room.gameId));
      // As many as there are scorecards, and no more: one rule for both.
      const have = fs.readdirSync(DIR).filter(isKept).sort();
      have.slice(0, Math.max(0, have.length - KEEP_GAMES))
        .forEach((f) => { try { fs.unlinkSync(path.join(DIR, f)); } catch (e) {} });
    } catch (e) {
      console.warn(`[trail] could not keep ${room.code}:`, e.message);
    }
  }

  // How one finished game was played, oldest first, or nothing.
  function readGame(id) {
    if (!/^[0-9a-f]{12}$/.test(String(id || ''))) return [];
    try {
      const f = fs.readdirSync(DIR).find((x) => x.endsWith(`-${id}.jsonl`));
      return f ? read(path.basename(f, '.jsonl')) : [];
    } catch (e) { return []; }
  }

  // This table is over: what was written down about it goes with it.
  function forget(code) {
    stopped.delete(code);
    try { fs.unlinkSync(file(code)); } catch (e) {}
  }

  /* A trail nobody could still be reading. Each half by the rule of the thing
     it belongs to: a table still in play by how long a table is held, a game
     that finished by how many scorecards are kept. Neither can outlive what it
     is a trail of. */
  function sweep() {
    const cutoff = Date.now() - KEEP_HOURS * 3600e3;
    let names = [];
    try { names = fs.readdirSync(DIR); } catch (e) { return; }
    names.filter(isLive).forEach((f) => {
      const p = path.join(DIR, f);
      try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch (e) {}
    });
    const have = names.filter(isKept).sort();
    have.slice(0, Math.max(0, have.length - KEEP_GAMES))
      .forEach((f) => { try { fs.unlinkSync(path.join(DIR, f)); } catch (e) {} });
  }

  return { point, frame, flush, keep, read, readGame, forget, sweep };
};
