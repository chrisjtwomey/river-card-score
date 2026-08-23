'use strict';

/* ============================================================
   Up the River, Down the River — local score tracker
   State lives in localStorage. No network calls.
   ============================================================ */

const KEY_GAME = 'river-card-score:game:v1';
const KEY_SEATS = 'river-card-score:seats:v1';
const KEY_THEME = 'river-card-score:theme:v1';
const KEY_MOTION = 'river-card-score:motion:v1';

const SUITS = [
  { k: 'S',  g: '♠',  name: 'Spades',    red: false },
  { k: 'H',  g: '♥',  name: 'Hearts',    red: true  },
  { k: 'D',  g: '♦',  name: 'Diamonds',  red: true  },
  { k: 'C',  g: '♣',  name: 'Clubs',     red: false },
  { k: 'NT', g: 'NT', name: 'No trumps', red: false },
];

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------- state ---------- */

let S = null;              // the running game, or null on the setup screen
let names = ['', '', ''];  // setup screen player names

/* ---------- storage ---------- */

function save() {
  try {
    if (S) localStorage.setItem(KEY_GAME, JSON.stringify(S));
    else localStorage.removeItem(KEY_GAME);
  } catch (e) { /* private mode: keep playing without a save */ }
}
function loadGame() {
  try {
    const raw = localStorage.getItem(KEY_GAME);
    if (!raw) return null;
    const g = JSON.parse(raw);
    return (g && g.cfg && Array.isArray(g.rounds)) ? g : null;
  } catch (e) { return null; }
}
function saveSeats() {
  try { localStorage.setItem(KEY_SEATS, JSON.stringify(names)); } catch (e) {}
}
function loadSeats() {
  try {
    const raw = localStorage.getItem(KEY_SEATS);
    const a = raw ? JSON.parse(raw) : null;
    if (Array.isArray(a) && a.length >= 2) return a.slice(0, 8).map(String);
  } catch (e) {}
  return null;
}

/* ---------- theme ---------- */

function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
}
function initTheme() {
  let t = null;
  try { t = localStorage.getItem(KEY_THEME); } catch (e) {}
  applyTheme(t);
  $('#btn-theme').addEventListener('click', () => {
    const now = document.documentElement.getAttribute('data-theme');
    const next = now === 'dark' ? 'light' : now === 'light' ? null : 'dark';
    applyTheme(next);
    try { next ? localStorage.setItem(KEY_THEME, next) : localStorage.removeItem(KEY_THEME); } catch (e) {}
  });
}

/* ---------- rules helpers ---------- */

function maxCardsFor(n) { return Math.max(1, Math.floor(52 / Math.max(2, n))); }

// The 1-card hand repeats `ones` times, so every player deals it once.
function schedule(max, pattern, ones) {
  const k = Math.max(1, Number(ones) || 1);
  const flat = Array(k).fill(1);
  const down = [], up = [];
  for (let i = max; i >= 2; i--) down.push(i);   // max…2
  for (let i = 2; i <= max; i++) up.push(i);     // 2…max
  if (pattern === 'down') return down.concat(flat);
  if (pattern === 'up') return flat.concat(up);
  if (pattern === 'updown') return flat.concat(up, down.slice(1), flat);
  return down.concat(flat, up); // downup
}

function roundScore(bid, won, cfg) {
  if (bid === won) return Number(cfg.bonus) + won;
  switch (cfg.miss) {
    // House rule: you must win at least your bid to score anything.
    case 'atleast':     return won > bid ? won : 0;
    case 'atleastdiff': return won > bid ? won : -(bid - won);
    case 'diff':        return -Math.abs(bid - won);
    case 'tricks':      return won;
    default:            return 0; // 'zero'
  }
}

const isDone = (r) => Array.isArray(r.bids) && Array.isArray(r.tricks);

function totals() {
  const t = S.cfg.names.map(() => 0);
  S.rounds.forEach((r) => {
    if (!isDone(r)) return;
    r.bids.forEach((b, i) => { t[i] += roundScore(b, r.tricks[i], S.cfg); });
  });
  return t;
}

/* ============================================================
   SETUP SCREEN
   ============================================================ */

function renderPlayers() {
  const box = $('#player-list');
  box.innerHTML = '';
  names.forEach((nm, i) => {
    const row = document.createElement('div');
    row.className = 'player-row';
    row.innerHTML =
      `<span class="seat">${i + 1}</span>` +
      `<input type="text" maxlength="16" placeholder="Player ${i + 1}" value="">` +
      `<button type="button" title="Remove" ${names.length <= 2 ? 'disabled style="opacity:.25"' : ''}>×</button>`;
    const input = row.querySelector('input');
    input.value = nm;
    input.addEventListener('input', () => { names[i] = input.value; saveSeats(); });
    row.querySelector('button').addEventListener('click', () => {
      if (names.length <= 2) return;
      names.splice(i, 1);
      renderPlayers(); syncSetupHints(); saveSeats();
    });
    box.appendChild(row);
  });
  $('#btn-add-player').disabled = names.length >= 8;
}

let onesEdited = false;

function syncSetupHints() {
  const cap = maxCardsFor(names.length);
  const input = $('#cfg-max');
  input.max = String(cap);
  if (Number(input.value) > cap) input.value = String(cap);
  if (Number(input.value) < 1) input.value = '1';
  $('#max-hint').textContent = `Up to ${cap} cards each with ${names.length} players.`;

  const onesInput = $('#cfg-ones');
  if (!onesEdited) onesInput.value = String(names.length);
  let k = Math.max(1, Math.min(8, Number(onesInput.value) || 1));
  $('#ones-hint').textContent = k === names.length
    ? 'One 1-card round per player, so everybody deals it.'
    : `${k} round${k === 1 ? '' : 's'} of 1 card. ${names.length} players.`;

  const m = Number(input.value) || 1;
  const pattern = $('#cfg-pattern').value;
  const cards = schedule(m, pattern, k);
  $('#rounds-hint').textContent = `${cards.length} rounds: ${cards.join(' ')}`;

  const cfg = { bonus: Number($('#cfg-bonus').value), miss: $('#cfg-miss').value };
  const ex = (won) => roundScore(2, won, cfg);
  $('#miss-hint').textContent = `Bid 2: win 3 = ${ex(3)} · win 2 = ${ex(2)} · win 1 = ${ex(1)}`;

  const ones = k > 1 ? `1×${k}` : '1';
  const opts = $('#cfg-pattern').options;
  opts[0].textContent = `Down then up (${m}…${ones}…${m})`;
  opts[1].textContent = `Up then down (${ones}…${m}…${ones})`;
  opts[2].textContent = `Down only (${m}…${ones})`;
  opts[3].textContent = `Up only (${ones}…${m})`;
}

function startGame() {
  lastTotals = null;                      // a new game starts everybody at 0
  const clean = names.map((n, i) => (n.trim() || `Player ${i + 1}`));
  if (new Set(clean.map((s) => s.toLowerCase())).size !== clean.length) {
    $('#setup-err').textContent = 'Two players have the same name. Make each name different.';
    $('#setup-err').hidden = false;
    return;
  }
  $('#setup-err').hidden = true;

  const cfg = {
    names: clean,
    max: Math.min(Number($('#cfg-max').value) || 1, maxCardsFor(clean.length)),
    pattern: $('#cfg-pattern').value,
    ones: Math.max(1, Math.min(8, Number($('#cfg-ones').value) || 1)),
    bonus: Number($('#cfg-bonus').value),
    miss: $('#cfg-miss').value,
    screw: $('#cfg-screw').checked,
    trump: $('#cfg-trump').checked,
  };
  S = newGame(cfg);
  save();
  showGame();
  dealAnimation();
}

function newGame(cfg) {
  if (!cfg.ones) cfg.ones = 1; // games saved before the repeat rule existed
  const cards = schedule(cfg.max, cfg.pattern, cfg.ones);
  const rounds = cards.map((c, i) => ({
    cards: c,
    dealer: i % cfg.names.length,
    trump: null,
    bids: null,
    tricks: null,
  }));
  return { cfg, rounds, idx: 0, phase: 'bid', draft: cfg.names.map(() => null), editReturn: null };
}

/* ============================================================
   DEAL ANIMATION — see deal.js, shared with the host screen
   ============================================================ */

function dealAnimation(force) {
  const r0 = S.rounds[0];
  return Deal.play({ names: S.cfg.names, dealer: r0.dealer, cards: r0.cards, round: 1 }, force);
}

// The finish plays once, when the last round is scored. A page that opens on a
// game already over does not replay it.
let wasDone = null;

function finaleAnimation(force) {
  return Deal.finale({ names: S.cfg.names, totals: totals() }, force);
}

function finaleWatch() {
  const done = finished();
  if (done && wasDone === false) finaleAnimation();
  wasDone = done;
}

/* ============================================================
   GAME SCREEN
   ============================================================ */

function showSetup() {
  $('#setup').hidden = false;
  $('#game').hidden = true;
  $('#btn-new').hidden = true;
  $('#subtitle').textContent = 'Score tracker';
  renderPlayers();
  syncSetupHints();
}

function showGame() {
  $('#setup').hidden = true;
  $('#game').hidden = false;
  $('#btn-new').hidden = false;
  render();
}

const finished = () => S.idx >= S.rounds.length;

function render() {
  const cfg = S.cfg;
  const done = S.rounds.filter(isDone).length;
  $('#subtitle').textContent = `${cfg.names.length} players · ${done}/${S.rounds.length} rounds played`;

  renderRoundBar();
  renderStandings();
  renderEntry();
  renderScorecard();
  renderWinner();
  finaleWatch();
}

function renderRoundBar() {
  const bar = $('.round-bar');
  const dots = $('#round-dots');
  dots.innerHTML = '';
  S.rounds.forEach((r, i) => {
    const d = document.createElement('span');
    d.className = 'dot' + (isDone(r) ? ' done' : (i === S.idx ? ' now' : ''));
    d.title = `Round ${i + 1} · ${r.cards} cards`;
    dots.appendChild(d);
  });

  if (finished()) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const r = S.rounds[S.idx];
  const n = S.cfg.names.length;
  $('#round-label').textContent = `Round ${S.idx + 1} of ${S.rounds.length}`;
  $('#round-cards').textContent = r.cards;
  $('#round-dealer').textContent = S.cfg.names[r.dealer];
  $('#round-first').textContent = S.cfg.names[(r.dealer + 1) % n];
}

// Big trump picker at the top of the bids panel.
function renderTrump() {
  const bar = $('#trump-row');
  if (!S.cfg.trump || finished()) { bar.hidden = true; return; }
  bar.hidden = false;

  const r = S.rounds[S.idx];
  const cur = SUITS.find((s) => s.k === r.trump) || null;
  bar.classList.toggle('set', !!cur);

  const now = $('#trump-now');
  now.textContent = cur ? cur.name : 'Turn the top card';
  now.className = 'trump-now' + (cur ? (cur.red ? ' red' : '') : ' unset');

  const pick = $('#trump-picker');
  pick.innerHTML = '';
  SUITS.forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = s.g;
    b.title = s.name;
    b.className = (s.red ? 'red' : '') + (s.k === 'NT' ? ' nt' : '');
    b.setAttribute('aria-pressed', String(r.trump === s.k));
    b.addEventListener('click', () => {
      r.trump = (r.trump === s.k) ? null : s.k;
      save(); renderTrump(); renderScorecard();
    });
    pick.appendChild(b);
  });
}

// The rows slide to their new places, the scores run to their new values, and
// what the round paid floats up out of them.
let lastTotals = null;

function renderStandings() {
  const t = totals();
  const box = $('#standings');
  const order = t.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const hi = Math.max(...t), lo = Math.min(0, ...t);
  const span = hi - lo;
  const before = UI.fx.barsBefore(box);

  UI.fx.flip(box, () => {
    box.innerHTML = '';
    order.forEach((o, rank) => {
      const lead = o.v === hi && hi !== lo;
      const row = document.createElement('div');
      row.className = 'stand-row' + (lead ? ' lead' : '');
      row.dataset.k = String(o.i);
      const w = span > 0 ? Math.round(((o.v - lo) / span) * 100) : 0;
      row.innerHTML =
        `<span class="rank">${rank + 1}</span>` +
        `<span class="name"></span>` +
        `<span class="pts">${o.v}</span>` +
        `<span class="bar"><i style="width:${w}%"></i></span>`;
      row.querySelector('.name').textContent = S.cfg.names[o.i];
      box.appendChild(row);
    });
  });

  const now = {};
  t.forEach((v, i) => { now[String(i)] = v; });
  lastTotals = UI.fx.scores(box, now, lastTotals, before);
}

function renderEntry() {
  const panel = $('#entry-panel');
  if (finished()) { panel.hidden = true; return; }
  panel.hidden = false;
  renderTrump();

  const r = S.rounds[S.idx];
  const cfg = S.cfg;
  const n = cfg.names.length;
  const bidding = S.phase === 'bid';
  const sum = S.draft.reduce((a, v) => a + (v || 0), 0);
  const allIn = S.draft.every((v) => v !== null);

  $('#entry-title').textContent = bidding ? `Bids · round ${S.idx + 1}` : `Tricks won · round ${S.idx + 1}`;
  $('#entry-hint').textContent = bidding
    ? `${cfg.names[(r.dealer + 1) % n]} bids first. ${cfg.names[r.dealer]} deals and bids last.`
      + (cfg.screw ? ` The bids must not total ${r.cards}.` : '')
    : `Everybody starts on 0. Tap only the players who won tricks. They must total ${r.cards}.`;

  // tally pill
  const pill = $('#entry-tally');
  const blocked = bidding && cfg.screw && allIn && sum === r.cards;
  if (bidding) {
    const diff = sum - r.cards;
    let txt = `Bids ${sum} of ${r.cards}`;
    if (allIn) txt += diff === 0 ? ' — not allowed' : (diff > 0 ? ` — ${diff} over` : ` — ${-diff} under`);
    pill.textContent = txt;
    pill.className = 'tally' + (blocked ? ' bad' : (allIn ? ' ok' : ''));
  } else {
    pill.textContent = sum === r.cards ? `Tricks ${sum} of ${r.cards}` : `${r.cards - sum} of ${r.cards} tricks still to give`;
    pill.className = 'tally' + (allIn && sum === r.cards ? ' ok' : (sum > r.cards ? ' bad' : ''));
  }

  // one row per player, in bidding order
  const rows = $('#entry-rows');
  rows.innerHTML = '';
  for (let step = 1; step <= n; step++) {
    const p = (r.dealer + step) % n;
    const isDealer = p === r.dealer;
    const row = document.createElement('div');
    row.className = 'entry-row' + (isDealer ? ' dealer' : '');

    const who = document.createElement('div');
    who.className = 'who';
    const nm = document.createElement('span');
    nm.textContent = cfg.names[p];
    who.appendChild(nm);
    if (isDealer) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = 'dealer'; who.appendChild(b); }
    if (!bidding && r.bids) { const b = document.createElement('span'); b.className = 'badge soft'; b.textContent = `bid ${r.bids[p]}`; who.appendChild(b); }
    row.appendChild(who);

    // forbidden value for the dealer under the screw rule
    let forbidden = null;
    if (bidding && cfg.screw && isDealer) {
      const others = S.draft.reduce((a, v, i) => (i === p ? a : a + (v === null ? NaN : v)), 0);
      if (!Number.isNaN(others)) {
        const f = r.cards - others;
        if (f >= 0 && f <= r.cards) forbidden = f;
      }
    }

    const chips = document.createElement('div');
    chips.className = 'chips';
    const others = S.draft.reduce((a, v, i) => a + (i === p ? 0 : (v || 0)), 0);
    for (let v = 0; v <= r.cards; v++) {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'chip';
      c.textContent = v;
      c.setAttribute('aria-pressed', String(S.draft[p] === v));
      if (v === forbidden) { c.disabled = true; c.title = 'Screw the dealer: this bid is not allowed'; }
      if (!bidding && others + v > r.cards) { c.disabled = true; c.title = `Only ${r.cards - others} tricks are left`; }
      c.addEventListener('click', () => {
        S.draft[p] = (S.draft[p] === v) ? (bidding ? null : 0) : v;
        save(); renderEntry();
      });
      chips.appendChild(c);
    }
    row.appendChild(chips);
    rows.appendChild(row);
  }

  const okTricks = !bidding && allIn && sum === r.cards;
  const okBids = bidding && allIn && !blocked;
  const commit = $('#btn-commit');
  commit.textContent = bidding ? 'Lock in bids' : (S.editReturn !== null ? 'Save round' : 'Score the round');
  commit.disabled = !(okBids || okTricks);

  const back = $('#btn-back');
  back.textContent = bidding ? (S.idx === 0 ? 'Back' : 'Fix last round') : 'Change bids';
  back.disabled = bidding && S.idx === 0 && S.editReturn === null;
}

function renderScorecard() {
  const cfg = S.cfg;
  const tbl = $('#scorecard');
  const run = cfg.names.map(() => 0);

  let html = '<thead><tr><th>Round</th>';
  cfg.names.forEach((n) => { html += `<th>${esc(n)}</th>`; });
  html += '</tr></thead><tbody>';

  S.rounds.forEach((r, i) => {
    const trump = cfg.trump && r.trump ? ` ${SUITS.find((s) => s.k === r.trump).g}` : '';
    const cls = isDone(r) ? 'editable' : (i === S.idx ? 'current' : '');
    html += `<tr class="${cls}" data-round="${i}"><td>${i + 1} · ${r.cards}${esc(trump)}</td>`;
    cfg.names.forEach((_, p) => {
      if (isDone(r)) {
        const pts = roundScore(r.bids[p], r.tricks[p], cfg);
        run[p] += pts;
        const hit = r.bids[p] === r.tricks[p];
        html += `<td><span class="cell"><span class="bidwon ${hit ? 'hit' : 'miss'}">${r.bids[p]}→${r.tricks[p]}` +
                ` (${pts >= 0 ? '+' : ''}${pts})</span><span class="run">${run[p]}</span></span></td>`;
      } else if (i === S.idx && r.bids) {
        html += `<td><span class="cell"><span class="bidwon">bid ${r.bids[p]}</span><span class="run">${run[p]}</span></span></td>`;
      } else {
        html += '<td>·</td>';
      }
    });
    html += '</tr>';
  });

  html += '</tbody><tfoot><tr><td>Total</td>';
  totals().forEach((t) => { html += `<td>${t}</td>`; });
  html += '</tr></tfoot>';
  tbl.innerHTML = html;

  followCurrentRow();
  tbl.querySelectorAll('tr.editable').forEach((tr) => {
    tr.addEventListener('click', () => editRound(Number(tr.dataset.round)));
  });
}

// Keeps the round in play in view inside the scorecard box.
function followCurrentRow() {
  const table = $('#scorecard');
  const box = table && table.closest('.table-wrap');
  const row = table && (table.querySelector('tbody tr.current') || table.querySelector('tbody tr:last-child'));
  if (!box || !row) return;
  const head = table.querySelector('thead');
  const headH = head ? head.getBoundingClientRect().height : 0;
  const target = row.offsetTop - headH - (box.clientHeight - row.offsetHeight - headH) / 2;
  const top = Math.max(0, Math.min(target, box.scrollHeight - box.clientHeight));
  if (Math.abs(box.scrollTop - top) < 2) return;
  if (box.scrollTo) box.scrollTo({ top, behavior: 'smooth' });
  else box.scrollTop = top;
}

function renderWinner() {
  const panel = $('#winner-panel');
  if (!finished()) { panel.hidden = true; return; }
  panel.hidden = false;
  Accolades.render($('#accolades'),
    Accolades.list(S.rounds, S.cfg.names.length, (b, w) => roundScore(b, w, S.cfg)),
    S.cfg.names);
  const t = totals();
  const order = t.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const top = order[0].v;
  const champs = order.filter((o) => o.v === top).map((o) => S.cfg.names[o.i]);
  $('#winner-title').textContent = champs.length > 1
    ? `Tie: ${champs.join(' and ')} — ${top} points`
    : `${champs[0]} wins with ${top} points`;
  const list = $('#winner-list');
  list.innerHTML = '';
  order.forEach((o, i) => {
    const d = document.createElement('div');
    d.className = 'w' + (o.v === top ? ' first' : '');
    const a = document.createElement('span'); a.textContent = `${i + 1}. ${S.cfg.names[o.i]}`;
    const b = document.createElement('span'); b.textContent = String(o.v);
    d.append(a, b);
    list.appendChild(d);
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- flow ---------- */

function commit() {
  const r = S.rounds[S.idx];
  if (S.phase === 'bid') {
    r.bids = S.draft.slice();
    S.phase = 'play';
    // Tricks start at 0, so only the winners need a tap.
    S.draft = r.tricks ? r.tricks.slice() : S.cfg.names.map(() => 0);
  } else {
    r.tricks = S.draft.slice();
    if (S.editReturn !== null) {
      S.idx = Math.min(S.editReturn, S.rounds.length);
      S.editReturn = null;
    } else {
      S.idx += 1;
    }
    enterRound();
  }
  save(); render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function enterRound() {
  if (finished()) { S.phase = 'bid'; S.draft = S.cfg.names.map(() => null); return; }
  const r = S.rounds[S.idx];
  S.phase = 'bid';
  S.draft = r.bids ? r.bids.slice() : S.cfg.names.map(() => null);
}

function back() {
  if (S.phase === 'play') {
    S.phase = 'bid';
    S.draft = S.rounds[S.idx].bids.slice();
  } else if (S.editReturn !== null) {
    S.idx = Math.min(S.editReturn, S.rounds.length);
    S.editReturn = null;
    enterRound();
  } else if (S.idx > 0) {
    S.idx -= 1;
    S.phase = 'play';
    S.draft = S.rounds[S.idx].tricks ? S.rounds[S.idx].tricks.slice() : S.cfg.names.map(() => 0);
  }
  save(); render();
}

function editRound(i) {
  if (S.editReturn === null) S.editReturn = S.idx;
  S.idx = i;
  S.phase = 'bid';
  S.draft = S.rounds[i].bids.slice();
  save(); render();
  $('#entry-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function confirmAsk(title, body) {
  return new Promise((res) => {
    $('#confirm-title').textContent = title;
    $('#confirm-body').textContent = body;
    const d = $('#confirm-dlg');
    d.returnValue = '';
    d.addEventListener('close', () => res(d.returnValue === 'yes'), { once: true });
    d.showModal();
  });
}

/* ---------- wiring ---------- */

function init() {
  UI.wireFullscreen('#btn-full');
  initTheme();

  const seats = loadSeats();
  if (seats) names = seats;

  $('#btn-add-player').addEventListener('click', () => {
    if (names.length >= 8) return;
    names.push('');
    renderPlayers(); syncSetupHints(); saveSeats();
  });
  $('#cfg-max').addEventListener('input', syncSetupHints);
  $('#cfg-ones').addEventListener('input', () => { onesEdited = true; syncSetupHints(); });
  $('#cfg-pattern').addEventListener('change', syncSetupHints);
  $('#cfg-miss').addEventListener('change', syncSetupHints);
  $('#cfg-bonus').addEventListener('change', syncSetupHints);
  $('#btn-start').addEventListener('click', startGame);

  $('#btn-commit').addEventListener('click', commit);
  $('#btn-back').addEventListener('click', back);

  $('#btn-rules').addEventListener('click', () => $('#rules-dlg').showModal());

  $('#btn-new').addEventListener('click', async () => {
    const ok = await confirmAsk('Start a new game?', 'This deletes the current scorecard.');
    if (!ok) return;
    names = S.cfg.names.slice();
    S = null; save(); saveSeats();
    showSetup();
    window.scrollTo({ top: 0 });
  });

  $('#btn-rematch').addEventListener('click', () => {
    S = newGame(S.cfg);
    save(); render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    dealAnimation();
  });

  const saved = loadGame();
  if (saved) { S = saved; showGame(); }
  else { showSetup(); }
}

// Debug handle: playDeal() forces the full deal, playDeal('reduced') the short one.
window.playDeal = (mode) => (S ? dealAnimation(mode || 'full') : Promise.resolve(console.warn('[deal] start a game first')));
window.playFinale = (mode) => (S ? finaleAnimation(mode || 'full')
                                 : Promise.resolve(console.warn('[finale] start a game first')));
window.motionMode = Deal.mode;

document.addEventListener('DOMContentLoaded', init);
