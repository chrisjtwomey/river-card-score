'use strict';
/* A finished game on disk: build the record, keep it, read it back.

   The record is the scorecard and nothing else -- no tokens, no pictures, no
   hands -- and the same shape goes to the phones, so one reader draws either.

   Games are one file each, newest last by name. Past the cap the oldest go. A
   table that finishes twice -- a score put right, say -- writes over its own
   file. */
const fs = require('fs');
const path = require('path');

module.exports = ({ DATA, KEEP_GAMES, G }) => {
  /* A finished game, as it is kept. It is the scorecard and nothing else: no
     tokens, no pictures, no hands. The same shape goes to the phones, so one
     reader draws either. */
  function gameRecord(room) {
    const n = room.seats.length;
    const bonus = room.bonus || Array(n).fill(0);
    const totals = n ? G.totalsWithBonus(room.cfg, room.rounds, n, bonus) : [];
    const best = totals.length ? Math.max.apply(null, totals) : 0;
    return {
      id: room.gameId,
      code: room.code,
      at: room.finishedAt || (room.finishedAt = Date.now()),
      cfg: room.cfg,
      seats: room.seats.map((s) => ({ id: s.id, name: s.name })),
      rounds: room.rounds,
      totals,
      bonus,
      awards: room.awards || [],
      winners: totals.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0),
    };
  }

  /* Games are kept as one file each, newest last by name. Past the cap the
     oldest go. A table that finishes twice -- a score put right, say -- writes
     over its own file. */
  function saveGame(room) {
    /* A table that never dealt is not a past game. The only way to a `done`
       with nothing behind it is the phase forced from the dev page, which is a
       screen to look at rather than a game to keep -- and it was filing an
       empty record every time, on the table and on every screen at it. */
    if (!G.played(room)) return;
    let rec;
    try { rec = gameRecord(room); } catch (e) { console.warn('[games] could not build the record:', e.message); return; }
    try {
      fs.mkdirSync(DATA, { recursive: true });
      fs.writeFileSync(path.join(DATA, `${rec.at}-${rec.id}.json`), JSON.stringify(rec));
      const kept = fs.readdirSync(DATA).filter((f) => f.endsWith('.json')).sort();
      kept.slice(0, Math.max(0, kept.length - KEEP_GAMES))
        .forEach((f) => { try { fs.unlinkSync(path.join(DATA, f)); } catch (e) {} });
    } catch (e) {
      console.warn('[games] could not write the record:', e.message);
    }
  }

  // One game off the disk, by its id, or null.
  function readGame(id) {
    if (!/^[0-9a-f]{12}$/.test(String(id || ''))) return null;
    try {
      const f = fs.readdirSync(DATA).find((x) => x.endsWith(`-${id}.json`));
      return f ? JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')) : null;
    } catch (e) { return null; }
  }

  // What the table has on file for one code: newest first, the headline only.
  function listGames(code) {
    const want = String(code || '').toUpperCase();
    try {
      return fs.readdirSync(DATA).filter((f) => f.endsWith('.json')).sort().reverse()
        .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return null; } })
        .filter((r) => r && (!want || r.code === want))
        .slice(0, KEEP_GAMES)
        .map((r) => ({ id: r.id, code: r.code, at: r.at,
                       names: r.seats.map((s) => s.name), totals: r.totals, winners: r.winners }));
    } catch (e) { return []; }
  }

  return { gameRecord, saveGame, readGame, listGames };
};
