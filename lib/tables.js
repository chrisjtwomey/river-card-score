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
  // The server's own, not the game's: a socket set and a timer do not survive
  // the process that made them, and are made again when it comes up.
  const SERVERS_OWN = ['sockets', 'botTimer'];
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

  function save(room) {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(file(room.code), JSON.stringify(record(room)));
    } catch (e) {
      console.warn(`[tables] could not write ${room.code}:`, e.message);
    }
  }

  // This table is over, or has been let go.
  function forget(code) {
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

  return { save, forget, all };
};
