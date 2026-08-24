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
  const names = g.seats.map((s) => s.name);
  const best = g.totals.length ? Math.max.apply(null, g.totals) : 0;
  const winners = (g.winners && g.winners.length ? g.winners : g.totals.map((v, i) => (v === best ? i : -1))
    .filter((i) => i >= 0));

  const head = document.createElement('div');
  head.className = 'panel game-head';
  head.innerHTML = '<div class="eyebrow">Game over</div><h2 class="game-win"></h2>' +
    '<p class="hint game-when"></p>';
  head.querySelector('.game-win').textContent = winners.length > 1
    ? `${winners.map((i) => names[i]).join(' & ')} tie on ${best}`
    : `${names[winners[0]] || '—'} wins with ${best}`;
  head.querySelector('.game-when').textContent =
    [when(g.at), `table ${g.code}`, `${names.length} players`].filter(Boolean).join(' · ');
  card.appendChild(head);

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
  sheet.innerHTML = '<h2>Scorecard</h2><div class="table-wrap"><table></table></div>';
  // The scorecard reader wants a state. A finished game is one, with the round
  // marker past the end so every row reads as played.
  sheet.querySelector('table').innerHTML = Table.scorecardHTML({
    seats: g.seats, rounds: g.rounds, cfg: g.cfg, totals: g.totals,
    bonus: g.bonus || [], idx: g.rounds.length,
  }, typeof g.mine === 'number' ? g.mine : -1);
  card.appendChild(sheet);
  return card;
}

/* ---------- the swipe ---------- */

let at = 0;

function show(list) {
  GAMES = list;
  const deck = $('#deck');
  deck.innerHTML = '';
  $('#empty').hidden = !!list.length;
  $('#deck').hidden = !list.length;
  $('#nav').hidden = list.length < 2;
  if (!list.length) return;
  list.forEach((g) => deck.appendChild(gameEl(g)));
  at = 0;
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
  UI.wireFullscreen('#btn-full');
  UI.wireTheme('#btn-theme');

  show(Games.all());

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
