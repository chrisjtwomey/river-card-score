'use strict';
/* Past games, one to a screen. Everything here is read off this phone, so it
   works with no table open and no server to ask. The one thing that does ask
   is the rescue for a phone that lost its copies: a table code, and the games
   that table still has on file. */

const $ = (s) => document.querySelector(s);

let GAMES = [];

const when = (ms) => {
  const d = new Date(Number(ms) || 0);
  if (!ms || isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

// A finished game reads like the end of one: who won, what the accolades paid,
// and the scorecard. The standings are left out: the scorecard has them.
function gameEl(g) {
  const card = document.createElement('article');
  card.className = 'gamecard';
  card.dataset.game = g.id || '';
  const names = g.seats.map((s) => s.name);
  const best = g.totals.length ? Math.max.apply(null, g.totals) : 0;
  const winners = (g.winners && g.winners.length ? g.winners : g.totals.map((v, i) => (v === best ? i : -1))
    .filter((i) => i >= 0));

  const head = document.createElement('div');
  head.className = 'panel game-head';
  const eyebrow = document.createElement('div');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Game over';
  const won = document.createElement('h2');
  won.className = 'game-win';
  won.textContent = winners.length > 1
    ? `${winners.map((i) => names[i]).join(' & ')} tie on ${best}`
    : `${names[winners[0]] || '—'} wins with ${best}`;
  const line = document.createElement('p');
  line.className = 'hint game-when';
  line.textContent =
    [when(g.at), `table ${g.code}`, `${names.length} players`].filter(Boolean).join(' · ');
  head.append(eyebrow, won, line);
  /* What can be done with this game, in a row of its own under the headline:
     watch it again, and the ⋯ of everything else. The ⋯ is the same one the
     standings use -- one list of what may be done about the thing the row is
     about -- so a game grows a verb without the headline growing a button. */
  const acts = document.createElement('div');
  acts.className = 'game-acts';
  head.appendChild(acts);
  const more = Table.rowMenu(acts, [
    { label: 'Delete this game', danger: true, run: () => askDelete(g) },
  ], `the game on ${when(g.at)}`);
  if (more) acts.appendChild(more);
  card.appendChild(head);
  offerReplay(card);

  if (g.awards && g.awards.length) {
    const box = document.createElement('div');
    box.className = 'panel';
    const h = document.createElement('h2');
    h.textContent = 'Accolades';
    const list = document.createElement('div');
    list.className = 'accolades';
    box.append(h, list);
    Accolades.render(list, g.awards, names, g.cfg && g.cfg.accoladePay);
    card.appendChild(box);
  }

  const sheet = document.createElement('div');
  sheet.className = 'panel';
  const sh = document.createElement('h2');
  sh.textContent = 'Scorecard';
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const grid = document.createElement('table');
  wrap.appendChild(grid);
  sheet.append(sh, wrap);
  // The scorecard reader wants a state. A finished game is one, with the round
  // marker past the end so every row reads as played.
  grid.innerHTML = Table.scorecardHTML({
    seats: g.seats, rounds: g.rounds, cfg: g.cfg, totals: g.totals,
    bonus: g.bonus || [], idx: g.rounds.length,
  }, typeof g.mine === 'number' ? g.mine : -1);
  card.appendChild(sheet);
  return card;
}

/* ---------- watching one again ---------- */

/* This phone keeps its own copy of every game it sat at, and the table keeps a
   trail beside each one it still holds -- the same cap, but a shorter memory
   for the table, which never had the game this phone was at unless it was that
   table. So the offer is only made where the table says it can be met: the
   listing says which games it can still put back, and a card with no answer
   yet, or none at all, simply does not offer it.

   Asked once, for the whole page. A phone with no table to ask gets nothing,
   which is the same page it has always had. */
let CAN = null;

function askWhatCanBeWatched() {
  fetch('/games.json')
    .then((r) => r.json())
    .then((d) => {
      CAN = new Set(((d && d.games) || []).filter((g) => g.trail).map((g) => g.id));
      $('#deck').querySelectorAll('.gamecard').forEach(offerReplay);
    }, () => {});
}

function offerReplay(card) {
  const id = card.dataset.game;
  if (!id || !CAN || !CAN.has(id)) return;
  const acts = card.querySelector('.game-acts');
  if (!acts || acts.querySelector('.watch-again')) return;
  const go = document.createElement('a');
  go.className = 'btn primary watch-again';
  go.href = `replay.html?g=${encodeURIComponent(id)}`;
  go.textContent = '▶ Replay';
  go.title = 'Play this game back, a point at a time or at the pace it was played';
  acts.insertBefore(go, acts.firstChild);      // the ⋯ stays at the end of the row
}

/* ---------- letting one go ---------- */

/* This phone's copy, and only this phone's. Each phone keeps its own and the
   table keeps its own, so the table's is still there to be taken back with the
   code -- which is said outright, because "delete" on a game everybody played
   sounds like more than it is. */
function askDelete(g) {
  const names = (g.seats || []).map((s) => s.name).join(', ');
  UI.ask('Delete this game?',
    `${when(g.at)}${names ? ' · ' + names : ''}. It goes from Past games on this phone. `
    + 'The table keeps its own copy, so you can take it back with the table code.',
    'Delete', true).then((yes) => {
      if (!yes) return;
      Games.remove(g.id);
      // Where the eye was: the card that took its place, or the last one left.
      show(Games.all(), at);
    });
}

/* ---------- the swipe ---------- */

let at = 0;

function show(list, land) {
  GAMES = list;
  const deck = $('#deck');
  deck.innerHTML = '';
  $('#empty').hidden = !!list.length;
  $('#deck').hidden = !list.length;
  $('#nav').hidden = list.length < 2;
  if (!list.length) { at = 0; return; }
  list.forEach((g) => deck.appendChild(gameEl(g)));
  // Where the eye was, not the top: one game let go should not send the swipe
  // back to the newest.
  at = Math.max(0, Math.min(list.length - 1, Number(land) || 0));
  deck.scrollLeft = at * (deck.clientWidth || 0);
  mark();
}

// Which card the swipe has landed on, from where the deck is scrolled.
function mark() {
  const deck = $('#deck');
  const w = deck.clientWidth || 1;
  at = Math.max(0, Math.min(GAMES.length - 1, Math.round(deck.scrollLeft / w)));
  $('#count').textContent = `${at + 1} of ${GAMES.length}`;
  $('#btn-prev').disabled = at === 0;
  $('#btn-next').disabled = at === GAMES.length - 1;
}

function goTo(i) {
  const deck = $('#deck');
  const k = Math.max(0, Math.min(GAMES.length - 1, i));
  const x = k * deck.clientWidth;
  if (deck.scrollTo) deck.scrollTo({ left: x, behavior: 'smooth' });
  else deck.scrollLeft = x;
}

/* ---------- a phone that lost its copies ---------- */

function findOnTable() {
  const code = $('#in-code').value.trim().toUpperCase();
  const err = (m) => { $('#fetch-err').textContent = m || ''; $('#fetch-err').hidden = !m; };
  const found = $('#found');
  found.innerHTML = '';
  if (code.length !== 4) return err('Type the 4-character table code.');
  err('');
  $('#btn-fetch').disabled = true;
  fetch(`/games.json?code=${encodeURIComponent(code)}`)
    .then((r) => r.json())
    .then((d) => {
      const list = (d && d.games) || [];
      if (!list.length) return err(`The table has nothing on file for ${code}.`);
      list.forEach((g) => {
        const row = document.createElement('div');
        row.className = 'seat-item';
        row.innerHTML = '<span class="nm"></span><button class="mini" type="button">keep</button>';
        row.querySelector('.nm').textContent =
          `${when(g.at)} · ${(g.names || []).join(', ')}`;
        row.querySelector('button').addEventListener('click', () => {
          fetch(`/game/${encodeURIComponent(g.id)}`).then((r) => r.json()).then((rec) => {
            Games.save(Object.assign({ mine: -1 }, rec));
            show(Games.all());
          }, () => err('That game could not be read.'));
        });
        found.appendChild(row);
      });
    }, () => err('The table could not be reached.'))
    .then(() => { $('#btn-fetch').disabled = false; });
}

document.addEventListener('DOMContentLoaded', () => {
  Settings.wire('#btn-settings', { items: UI.commonSettings() });

  show(Games.all());
  askWhatCanBeWatched();

  let idle = 0;
  $('#deck').addEventListener('scroll', () => {
    clearTimeout(idle);
    idle = setTimeout(mark, 90);
  }, { passive: true });
  $('#btn-prev').addEventListener('click', () => goTo(at - 1));
  $('#btn-next').addEventListener('click', () => goTo(at + 1));
  $('#deck').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { goTo(at - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { goTo(at + 1); e.preventDefault(); }
  });
  window.addEventListener('resize', () => goTo(at));

  $('#in-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  });
  $('#in-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') findOnTable(); });
  $('#btn-fetch').addEventListener('click', findOnTable);
});
