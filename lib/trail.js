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

module.exports = ({ DATA, KEEP_HOURS, TRAIL_MAX, record }) => {
  const DIR = path.join(DATA, 'trail');
  const file = (code) => path.join(DIR, `${code}.jsonl`);

  /* ---------- the pure half: what a Room verb calls ---------- */

  // One thing that happened, held on the room until the server writes it down.
  function point(room, ev) {
    if (!room) return;
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

  // This table is over: what was written down about it goes with it.
  function forget(code) {
    stopped.delete(code);
    try { fs.unlinkSync(file(code)); } catch (e) {}
  }

  /* A trail nobody could still be reading. The rule is the table's own -- one
     too old to be held is too old to be looked back through -- so a trail
     cannot outlive the game it belongs to. */
  function sweep() {
    const cutoff = Date.now() - KEEP_HOURS * 3600e3;
    let names = [];
    try { names = fs.readdirSync(DIR); } catch (e) { return; }
    names.forEach((f) => {
      const p = path.join(DIR, f);
      try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch (e) {}
    });
  }

  return { point, frame, flush, read, forget, sweep };
};
