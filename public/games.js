'use strict';
/* Games that are over. The table keeps one file each, and the device keeps its
   own copy of every game it sat at, so a player can look back with no table
   open and no server to ask. */
const Games = (function () {
  const KEY = 'river-card-score:games:v1';
  const CAP = 60;                          // how many a device holds, newest first

  function all() {
    try {
      const list = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, CAP))); return true; }
    catch (e) { return false; }            // a full store is not worth a broken screen
  }

  // Newest first, one entry an id. A game saved twice -- a score put right --
  // replaces the one already held and keeps its place.
  function save(rec) {
    if (!rec || !rec.id) return false;
    const list = all().filter((g) => g.id !== rec.id);
    list.unshift(rec);
    list.sort((a, b) => (b.at || 0) - (a.at || 0));
    return write(list);
  }

  function remove(id) { return write(all().filter((g) => g.id !== id)); }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }
  function get(id) { return all().find((g) => g.id === id) || null; }

  /* The state, as a game to keep. `me` is the seat this device held, or -1 for
     a screen with no seat. It is the same shape the table writes, with the
     seat added, so one reader draws either. */
  function record(ST, me) {
    // Over, named, and actually played: a table whose phase was forced to
    // `done` with nothing behind it is a screen to look at, not a game to keep.
    if (!ST || ST.phase !== 'done' || !ST.gameId || !Game.played(ST)) return null;
    const best = ST.totals.length ? Math.max.apply(null, ST.totals) : 0;
    return {
      id: ST.gameId,
      code: ST.code,
      at: Date.now(),
      cfg: ST.cfg,
      seats: ST.seats.map((s) => ({ id: s.id, name: s.name })),
      rounds: ST.rounds,
      totals: ST.totals,
      bonus: ST.bonus || [],
      awards: ST.awards || [],
      winners: ST.totals.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0),
      mine: typeof me === 'number' ? me : -1,
    };
  }

  // Keeps the game on screen, if it is over and not already held as it stands.
  function keep(ST, me) {
    const rec = record(ST, me);
    if (!rec) return false;
    const had = get(rec.id);
    if (had && JSON.stringify(had.totals) === JSON.stringify(rec.totals)
            && JSON.stringify(had.rounds) === JSON.stringify(rec.rounds)) return false;
    if (had) rec.at = had.at;              // the day it was played, not the day it was fixed
    return save(rec);
  }

  return { all, get, save, keep, record, remove, clear, CAP, KEY };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Games;
