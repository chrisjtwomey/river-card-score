'use strict';
/* Dev controls. Makes a real table of stand-in players, forces it into any
   state, and shows every screen at once. The server only answers this with
   DEV=1. */

const $ = (s) => document.querySelector(s);

let ws = null, ST = null, CODE = null, HOST_TOKEN = null, SEATS = [];
let topKey = '', seatKey = '';   // rebuild a preview only when it has to change
let editRound = 0;

(function theme() {
  let t = null; try { t = localStorage.getItem('river-card-score:theme:v1'); } catch (e) {}
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
})();

/* ---------- socket ---------- */

function connect() {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  ws = new WebSocket(proto + location.host + '/ws');
  ws.onopen = () => send({ t: 'dev', action: 'setup', players: Number($('#players').value) || 4 });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'hello') {
      CODE = m.code; HOST_TOKEN = m.token; SEATS = m.seats || [];
      err('');
    } else if (m.t === 'state') {
      ST = m; render();
    } else if (m.t === 'error') {
      err(m.msg);
    }
  };
  ws.onclose = () => setTimeout(connect, 1000);
}
const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const act = (action, extra) => send(Object.assign({ t: 'dev', action }, extra || {}));
const err = (msg) => { $('#dev-err').textContent = msg; $('#dev-err').hidden = !msg; };

/* ---------- previews ---------- */

const SIZES = { host: [1180, 820], seat: [400, 800], captain: [400, 900] };

function frame(box, label, page, token, kind, seatId) {
  const scale = Number($('#scale').value) || 0.65;
  const [w, h] = SIZES[kind];
  const url = `${page}#c=${CODE}&t=${token}`;
  const el = document.createElement('div');
  el.className = 'frame' + (kind === 'captain' ? ' captain' : '');
  if (seatId) el.dataset.seat = seatId;
  el.innerHTML =
    `<header><span class="lbl"></span><a href="${url}" target="_blank" rel="noopener">open</a></header>` +
    `<div class="shell" style="width:${Math.round(w * scale)}px;height:${Math.round(h * scale)}px">` +
    `<iframe src="${url}" width="${w}" height="${h}" style="transform:scale(${scale})"></iframe></div>`;
  el.querySelector('.lbl').textContent = label;
  box.appendChild(el);
}

const seatOf = (id) => SEATS.find((s) => s.id === id) || null;

function renderFrames() {
  if (!CODE) return;
  const scale = $('#scale').value;
  const cap = ST ? seatOf(ST.captainId) : null;

  // top row: the big screen, and the phone of whoever runs the table
  const top = `${CODE}:${HOST_TOKEN}:${cap ? cap.token : ''}:${scale}`;
  if (top !== topKey) {
    topKey = top;
    const box = $('#host-frame');
    box.innerHTML = '';
    frame(box, `host screen · table ${CODE}`, 'host.html', HOST_TOKEN, 'host');
    if (cap) frame(box, `table host · ${cap.name}`, 'play.html', cap.token, 'captain');
  }

  // bottom row: the other seats. The table host is already up top, so it is
  // not shown twice. The key changes with them, so it follows the badge.
  const others = SEATS.filter((s) => !cap || s.id !== cap.id);
  const seats = `${CODE}:${others.map((s) => s.token).join(',')}:${scale}`;
  if (seats !== seatKey) {
    seatKey = seats;
    const box = $('#seat-frames');
    box.innerHTML = '';
    others.forEach((s) => frame(box, s.name, 'play.html', s.token, 'seat', s.id));
  }
}

/* ---------- controls ---------- */

function fillSelect(sel, items, value) {
  const want = items.map((i) => i.v).join(',');
  if (sel.dataset.items !== want) {
    sel.dataset.items = want;
    sel.innerHTML = '';
    items.forEach((i) => {
      const o = document.createElement('option');
      o.value = i.v; o.textContent = i.t;
      sel.appendChild(o);
    });
  }
  if (document.activeElement !== sel) sel.value = value == null ? '' : String(value);
}

function render() {
  renderFrames();
  const n = ST.seats.length;
  const r = ST.rounds[ST.idx] || null;

  $('#code').textContent = ST.code;
  $('#phase').textContent = ST.phase + (ST.rounds.length ? ` · round ${Math.min(ST.idx + 1, ST.rounds.length)}/${ST.rounds.length}` : '');
  $('#subtitle').textContent = `table ${ST.code} · ${n} players · ${ST.phase}`;
  if (document.activeElement !== $('#players')) $('#players').value = String(n);

  // force
  const idxEl = $('#f-idx');
  idxEl.max = String(Math.max(1, ST.rounds.length));
  if (document.activeElement !== idxEl) idxEl.value = String(Math.min(ST.idx + 1, Math.max(1, ST.rounds.length)));
  if (document.activeElement !== $('#f-phase')) $('#f-phase').value = ST.phase;
  const seatOpts = ST.seats.map((s) => ({ v: s.id, t: s.name }));
  fillSelect($('#f-captain'), seatOpts, ST.captainId);
  fillSelect($('#f-dealer'), [{ v: '', t: 'seat 1' }].concat(seatOpts), ST.firstDealerId || '');
  fillSelect($('#f-trump'), [{ v: '', t: 'none' }].concat(Game.SUITS.map((s) => ({ v: s.k, t: s.name }))),
    (r && r.trump) || '');
  if (document.activeElement !== $('#f-redeals')) $('#f-redeals').value = String((r && r.redeals) || 0);

  // rules
  const c = ST.cfg;
  const set = (sel, v) => { const el = $(sel); if (document.activeElement !== el) el.value = String(v); };
  set('#cfg-max', c.max); set('#cfg-ones', c.ones); set('#cfg-pattern', c.pattern);
  set('#cfg-bonus', c.bonus); set('#cfg-miss', c.miss);
  $('#cfg-screw').checked = !!c.screw;
  $('#cfg-trump').checked = !!c.trump;

  // round editor
  const rounds = ST.rounds.map((rr, i) => ({ v: i, t: `${i + 1} · ${rr.cards} cards` }));
  if (editRound >= ST.rounds.length) editRound = Math.max(0, ST.rounds.length - 1);
  fillSelect($('#r-pick'), rounds.length ? rounds : [{ v: 0, t: 'no rounds' }], editRound);
  renderSeatGrid();

  $('#state-json').textContent = JSON.stringify(ST, null, 1);
}

function renderSeatGrid() {
  const box = $('#seatgrid');
  const r = ST.rounds[editRound] || null;
  box.innerHTML = '<span class="head" style="text-align:left">seat</span><span class="head">bid</span><span class="head">won</span>';
  ST.seats.forEach((s, p) => {
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = `${s.name}  ${ST.totals[p]}`;
    const bid = document.createElement('input');
    bid.type = 'number'; bid.min = '0'; bid.dataset.k = 'bid'; bid.dataset.p = String(p);
    bid.value = r && r.bids && r.bids[p] !== null && r.bids[p] !== undefined ? r.bids[p] : '';
    const won = document.createElement('input');
    won.type = 'number'; won.min = '0'; won.dataset.k = 'tricks'; won.dataset.p = String(p);
    won.value = r && r.tricks ? r.tricks[p] : '';
    box.append(who, bid, won);
  });
}

function applyRound() {
  const r = ST.rounds[editRound];
  if (!r) return;
  const grab = (k) => {
    const out = [];
    let any = false;
    ST.seats.forEach((s, p) => {
      const el = document.querySelector(`#seatgrid input[data-k="${k}"][data-p="${p}"]`);
      const v = el.value.trim();
      if (v === '') { out.push(null); } else { out.push(Number(v)); any = true; }
    });
    return any ? out : null;
  };
  const bids = grab('bid');
  const tricks = grab('tricks');
  act('patch', {
    patch: {
      round: {
        i: editRound,
        bids,
        tricks: tricks && tricks.every((v) => v !== null) ? tricks : null,
        redeals: Number($('#f-redeals').value) || 0,
        trump: $('#f-trump').value || null,
      },
    },
  });
}

/* ---------- wiring ---------- */

document.addEventListener('DOMContentLoaded', () => {
  $('#btn-theme').addEventListener('click', () => {
    const now = document.documentElement.getAttribute('data-theme');
    const next = now === 'dark' ? 'light' : now === 'light' ? null : 'dark';
    if (next) document.documentElement.setAttribute('data-theme', next);
    else document.documentElement.removeAttribute('data-theme');
    try { next ? localStorage.setItem('river-card-score:theme:v1', next)
               : localStorage.removeItem('river-card-score:theme:v1'); } catch (e) {}
  });

  document.querySelectorAll('[data-act]').forEach((b) =>
    b.addEventListener('click', () => act(b.dataset.act)));

  $('#btn-rebuild').addEventListener('click', () =>
    act('setup', { players: Number($('#players').value) || 4 }));
  $('#players').addEventListener('change', () =>
    act('players', { players: Number($('#players').value) || 4 }));

  $('#scale').addEventListener('change', () => { topKey = seatKey = ''; renderFrames(); });

  $('#f-idx').addEventListener('change', (e) => act('patch', { patch: { idx: Number(e.target.value) - 1 } }));
  $('#f-phase').addEventListener('change', (e) => act('patch', { patch: { phase: e.target.value } }));
  $('#f-captain').addEventListener('change', (e) => act('patch', { patch: { captainId: e.target.value } }));
  $('#f-dealer').addEventListener('change', (e) => act('patch', { patch: { firstDealerId: e.target.value || null } }));
  $('#f-trump').addEventListener('change', (e) =>
    act('patch', { patch: { round: { i: ST.idx, trump: e.target.value || null } } }));
  $('#f-redeals').addEventListener('change', (e) =>
    act('patch', { patch: { round: { i: ST.idx, redeals: Number(e.target.value) || 0 } } }));

  $('#r-pick').addEventListener('change', (e) => { editRound = Number(e.target.value); renderSeatGrid(); });
  $('#btn-apply').addEventListener('click', applyRound);
  $('#btn-clear').addEventListener('click', () =>
    act('patch', { patch: { round: { i: editRound, bids: null, tricks: null, trump: null, redeals: 0 } } }));

  const patch = (p) => send({ t: 'config', patch: p });
  $('#cfg-max').addEventListener('change', (e) => patch({ max: e.target.value }));
  $('#cfg-ones').addEventListener('change', (e) => patch({ ones: e.target.value }));
  $('#cfg-pattern').addEventListener('change', (e) => patch({ pattern: e.target.value }));
  $('#cfg-bonus').addEventListener('change', (e) => patch({ bonus: e.target.value }));
  $('#cfg-miss').addEventListener('change', (e) => patch({ miss: e.target.value }));
  $('#cfg-screw').addEventListener('change', (e) => patch({ screw: e.target.checked }));
  $('#cfg-trump').addEventListener('change', (e) => patch({ trump: e.target.checked }));

  connect();
});
