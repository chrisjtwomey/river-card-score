'use strict';
/* A table in play, on disk, so that it outlives the server it is on.

   The phone that hosts a game is a phone. It is stopped from its own
   notification, or put away, or Android takes the memory back -- and the room
   is in memory, so the game goes with it. Every other phone still holds its
   seat and comes back to a table that is not there any more.

   So a table is written down after every change and read back when the server
   comes up. What is written is the room and not the server's own things: the
   sockets belong to the server that had them, and the pictures are 48K apiece
   and every phone keeps its own and hands it over again when it comes back.

   A table nobody has touched for KEEP_HOURS is not read back, and its file
   goes: the same rule the server uses for a room it is still holding.
*/
const fs = require('fs');
const path = require('path');

module.exports = ({ DATA, KEEP_HOURS }) => {
  const DIR = path.join(DATA, 'tables');
  /* The server's own, not the game's: a socket set and a timer do not survive
     the process that made them, and are made again when it comes up. `seen` is
     read off those sockets, so it goes the same way -- a table read back from
     the disk has nobody watching it until somebody opens it.

     `trail` is what has happened since the last write and has a file of its
     own. It must be named here or `record` would take it, and this record is
     rewritten whole after every broadcast: a trail in it would be written
     again for every card. */
  const SERVERS_OWN = ['sockets', 'seen', 'trail', 'botTimer', 'bidTimer'];
  const file = (code) => path.join(DIR, `${code}.json`);
  const named = (f) => /^[A-Z0-9]{4}\.json$/.test(f);

  function record(room) {
    const out = {};
    Object.keys(room).forEach((k) => { if (SERVERS_OWN.indexOf(k) < 0) out[k] = room[k]; });
    out.seats = room.seats.map((s) => {
      const seat = Object.assign({}, s);
      delete seat.av;                    // the phone that owns it brings it back
      return seat;
    });
    return out;
  }

  let dirMade = false;              // the folder is made once, not on every write

  function write(room) {
    try {
      if (!dirMade) { fs.mkdirSync(DIR, { recursive: true }); dirMade = true; }
      fs.writeFileSync(file(room.code), JSON.stringify(record(room)));
    } catch (e) {
      dirMade = false;              // whatever went wrong, do not assume the folder
      console.warn(`[tables] could not write ${room.code}:`, e.message);
    }
  }

  /* A change is written down at once, and then not again for a moment.

     Every change to a table is one broadcast and one write, which is what
     makes a table outlive its server. A burst -- three bots playing out a
     trick, the dev page filling a scorecard -- is a dozen writes of the whole
     table in a few milliseconds, and only the last of them is worth having.
     So the first write of a burst still goes immediately, and the rest are
     held until the gap is up and written once, newest state only. A table
     changing every few seconds, which is what a game does, is written exactly
     as it was before. */
  const GAP = 250;
  const waiting = new Map();        // code -> the newest room not yet written
  const wroteAt = new Map();        // code -> when it last went to disk

  function save(room) {
    const code = room.code;
    if (waiting.has(code)) { waiting.set(code, room); return; }   // a burst, already timed
    const since = Date.now() - (wroteAt.get(code) || 0);
    if (since >= GAP) { wroteAt.set(code, Date.now()); write(room); return; }
    waiting.set(code, room);
    setTimeout(() => {
      const newest = waiting.get(code);
      waiting.delete(code);
      if (!newest) return;                       // the table was let go meanwhile
      wroteAt.set(code, Date.now());
      write(newest);
    }, GAP - since).unref();
  }

  // This table is over, or has been let go. Whatever was still to be written
  // for it is not written: the file it would go in is the one being removed.
  function forget(code) {
    waiting.delete(code);
    wroteAt.delete(code);
    try { fs.unlinkSync(file(code)); } catch (e) {}
  }

  /* Every table worth reading back. One too old to be held in memory is too
     old to be read off the disk either, and its file goes with it. */
  function all() {
    let names = [];
    try { names = fs.readdirSync(DIR).filter(named); } catch (e) { return []; }
    const cutoff = Date.now() - KEEP_HOURS * 3600e3;
    const out = [];
    names.forEach((f) => {
      let rec = null;
      try { rec = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (e) {}
      if (!rec || !rec.code || !(rec.lastSeen > cutoff) || !Array.isArray(rec.seats)) {
        try { fs.unlinkSync(path.join(DIR, f)); } catch (e) {}
        return;
      }
      out.push(rec);
    });
    return out;
  }

  return { record, save, forget, all };
};
