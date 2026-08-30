'use strict';
/* Dev controls. Opens on any table this server is running, or makes one of
   stand-in players, and shows every screen at once. What it may do follows
   the server: with DEV=1 every table takes every control; a normal server
   answers the state forcer alone, over the table's own host token. */

const $ = (s) => document.querySelector(s);

let ws = null, ST = null, CODE = null, HOST_TOKEN = null, SEATS = [];
let topKey = '', seatKey = '', tableKey = '';  // re-draw only when it has to change
let LIVE = false;                // looking at a real table, not one of stand-ins
let polling = false;             // the list of tables, on a dev server only
let onTable = false;             // this socket got onto a table

/* dev.html#c=CODE&t=TOKEN opens the page on that table, so the TV screen's ⚙
   lands on the game it was pressed from. The page writes the same hash for
   whatever table it is on, so a reload comes back to it. With no hash it makes
   a table of stand-in players, which the server allows only with DEV=1. */
(function readHash() {
  const q = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  const c = (q.get('c') || '').toUpperCase();
  const t = q.get('t') || '';
  if (c && t) { CODE = c; HOST_TOKEN = t; }
})();

/* ---------- socket ---------- */

function connect() {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  ws = new WebSocket(proto + location.host + '/ws');
  onTable = false;
  // The table it was on, or a new one. A socket that drops and comes back
  // re-opens the same table rather than making another.
  ws.onopen = () => ((CODE && HOST_TOKEN)
    ? act('open', { code: CODE, token: HOST_TOKEN })
    : act('setup', { players: Number($('#players').value) || 4 }));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'hello') {
      CODE = m.code; HOST_TOKEN = m.token; SEATS = m.seats || [];
      LIVE = m.stand === false;              // the table says which it is, not the address
      history.replaceState(null, '', `#c=${CODE}&t=${HOST_TOKEN}`);
      topKey = seatKey = tableKey = '';      // another table, so every pane is stale
      applyMode();
      if (polling) askTables();
      onTable = true;
      err('');
    } else if (m.t === 'tables') {
      renderTables(m.tables || []);
    } else if (m.t === 'state') {
      ST = m; render();
    } else if (m.t === 'error') {
      /* The table it was on would not open: a server that restarted, a game
         that ended. Let it go and do what a page with no table does. */
      if (!onTable && CODE) {
        CODE = HOST_TOKEN = null;
        history.replaceState(null, '', location.pathname);
        return act('setup', { players: Number($('#players').value) || 4 });
      }
      // No table yet means the stand-in table was refused. Say the other way in.
      err(!CODE
        ? `${m.msg} To put a real game right, start the server with DEV=1 and open Dev controls under ⚙ on the TV screen.`
        : m.msg);
    }
  };
  ws.onclose = () => setTimeout(connect, 1000);
}
const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const act = (action, extra) => send(Object.assign({ t: 'dev', action }, extra || {}));
const err = (msg) => { $('#dev-err').textContent = msg; $('#dev-err').hidden = !msg; };

/* ---------- previews ---------- */

const SIZES = { host: [1180, 820], seat: [400, 800] };

// A seat frame opens the seat itself on a table of stand-ins, and only watches
// on a real one. The hash says which: t= is the seat, w= just shows it.
const seatHash = (s) => (s.watch ? `#c=${CODE}&w=${s.watch}` : `#c=${CODE}&t=${s.token}`);

function frame(box, label, page, hash, kind, seatId, boss) {
  const scale = Number($('#scale').value) || 0.65;
  const [w, h] = SIZES[kind];
  const url = page + hash;
  const el = document.createElement('div');
  el.className = 'frame' + (boss ? ' captain' : '');
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

  // top row: the big screen, on its own
  const top = `${CODE}:${HOST_TOKEN}:${scale}`;
  if (top !== topKey) {
    topKey = top;
    const box = $('#host-frame');
    box.innerHTML = '';
    frame(box, `TV screen · table ${CODE}`, 'host.html', `#c=${CODE}&t=${HOST_TOKEN}`, 'host');
  }

  // bottom row: the phones, the one that runs the table always first. Whoever
  // that is, that pane stands in the same place, so the eye is not sent
  // hunting for it. The key follows the order, so a new table host re-draws.
  const phones = cap ? [cap].concat(SEATS.filter((s) => s.id !== cap.id)) : SEATS;
  const seats = `${CODE}:${phones.map(seatHash).join(',')}:${scale}`;
  if (seats !== seatKey) {
    seatKey = seats;
    const box = $('#seat-frames');
    box.innerHTML = '';
    phones.forEach((s) => frame(box, s === cap ? `${s.name} · table host` : s.name,
                                'play.html', seatHash(s), 'seat', s.id, s === cap));
  }
}

// Live reload for the previews. The frames do not each hold a stream open --
// a browser allows only six connections to one address, and a wall of frames
// would use them all up. This page keeps the one stream and rebuilds the
// frames itself, which reloads them with their table and seat still in the
// link. A change to this page reloads this page.
function watchFiles() {
  if (typeof EventSource === 'undefined') return;
  let es;
  try { es = new EventSource('/live'); } catch (e) { return; }
  es.onopen = () => console.info('[dev] live reload is on');
  es.addEventListener('reload', (e) => {
    let what = '';
    try { what = JSON.parse(e.data); } catch (err) {}
    if (/^dev\./.test(String(what))) { location.reload(); return; }
    topKey = seatKey = '';
    renderFrames();
  });
  es.onerror = () => { if (es.readyState === 2) es.close(); };   // 2 is CLOSED
}

/* ---------- the tables this server is running ---------- */

const askTables = () => act('tables');

/* A row a table: its code, what it is doing, and whether it is a game or a
   set of stand-ins. Pressing one opens this page on it. A dev server hands
   over any table it holds, so no token is typed here. */
function renderTables(list) {
  const key = list.map((t) => `${t.code}/${t.phase}/${t.round}/${t.seats.length}/${t.stand}`)
    .join('|') + '@' + CODE;
  if (key === tableKey) return;
  tableKey = key;
  const box = $('#tablelist');
  box.innerHTML = '';
  list.forEach((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn trow' + (t.code === CODE ? ' on' : '');
    b.dataset.code = t.code;
    const code = document.createElement('span');
    code.className = 'tcode';
    code.textContent = t.code;
    const what = document.createElement('span');
    what.className = 'twhat';
    what.textContent = `${t.seats.length} player${t.seats.length === 1 ? '' : 's'} · ${t.phase}`
      + (t.round ? ` · round ${t.round}/${t.rounds}` : '');
    const kind = document.createElement('span');
    kind.className = 'tkind';
    kind.textContent = t.stand ? 'stand-ins' : 'real';
    b.append(code, what, kind);
    box.appendChild(b);
  });
  $('#tables-hint').textContent = list.length
    ? 'Press one to take this page onto it.'
    : 'No table is running on this server yet.';
}

/* ---------- controls ---------- */

function render() {
  renderFrames();
  const n = ST.seats.length;

  $('#code').textContent = ST.code;
  $('#phase').textContent = ST.phase + (ST.rounds.length ? ` · round ${Math.min(ST.idx + 1, ST.rounds.length)}/${ST.rounds.length}` : '');
  $('#subtitle').textContent = `${LIVE ? 'live ' : ''}table ${ST.code} · ${n} players · ${ST.phase}`;
  // The box is the size the next new table gets, so it holds a number that
  // could make one: a real table with no seats yet must not leave a 0 in it.
  if (document.activeElement !== $('#players')) {
    $('#players').value = String(Math.max(2, Math.min(8, n)));
  }

  // Only a dev server has tables to hand out, so only a dev server is asked.
  if (ST.dev && !polling) { polling = true; askTables(); setInterval(askTables, 5000); }

  // scorecard filler. Before the game starts the card is not built yet, so the
  // length comes from the rules.
  const cardLen = ST.rounds.length || Game.schedule(ST.cfg.max, ST.cfg.pattern, ST.cfg.ones).length;
  $('#fill-rounds').max = String(cardLen);
  $('#fill-hint').textContent =
    `The card holds ${cardLen} rounds. Leave it empty for a random number.`;
}

/* ---------- wiring ---------- */

// A real table takes the same controls; the page only says to tread with
// care, because the clicks land on somebody's game.
function applyMode() {
  document.body.classList.toggle('livemode', LIVE);
  $('#live-note').hidden = !LIVE;
  if (LIVE) {
    $('#code').textContent = CODE;
    $('#subtitle').textContent = `fixing table ${CODE}`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  applyMode();
  UI.wireTheme('#btn-theme');

  document.querySelectorAll('[data-act]').forEach((b) =>
    b.addEventListener('click', () => act(b.dataset.act)));

  /* Stand-in photos, so the picture on a card can be tested without anybody
     uploading anything. Each seat gets its own colour and its own initial. */
  const AV_INK = ['#c0271d', '#1c6b48', '#2b5f9e', '#8a4bb5', '#b8862b', '#0f8a8a',
                  '#b5426f', '#4a6b1c'];
  function standInAvatar(name, i) {
    const cv = document.createElement('canvas');
    cv.width = Avatar.W; cv.height = Avatar.H;
    const cx = cv.getContext('2d');
    const ink = AV_INK[i % AV_INK.length];
    const g = cx.createLinearGradient(0, 0, cv.width, cv.height);
    g.addColorStop(0, ink);
    g.addColorStop(1, '#101512');
    cx.fillStyle = g;
    cx.fillRect(0, 0, cv.width, cv.height);
    cx.strokeStyle = 'rgba(255,255,255,.22)';
    cx.lineWidth = 6;
    for (let k = -cv.height; k < cv.width; k += 22) {     // a hint of a pattern
      cx.beginPath(); cx.moveTo(k, 0); cx.lineTo(k + cv.height, cv.height); cx.stroke();
    }
    // The initial sits high, so the eye can tell the seats apart in a fan.
    cx.fillStyle = '#fff';
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.font = `700 ${Math.round(cv.width * .58)}px system-ui, sans-serif`;
    cx.shadowColor = 'rgba(0,0,0,.6)';
    cx.shadowBlur = 16;
    cx.fillText((name || '?').trim().charAt(0).toUpperCase(), cv.width / 2, cv.height * .38);
    cx.shadowBlur = 0;
    cx.font = `600 ${Math.round(cv.width * .13)}px system-ui, sans-serif`;
    cx.fillStyle = 'rgba(255,255,255,.8)';
    cx.fillText(String(name || '').slice(0, 9), cv.width / 2, cv.height * .78);
    return cv.toDataURL('image/webp', .8);
  }

  $('#btn-avatars').addEventListener('click', () => {
    if (!ST || !ST.seats) return;
    ST.seats.forEach((s, i) => act('avatar', { seat: i, data: standInAvatar(s.name, i) }));
  });
  $('#btn-no-avatars').addEventListener('click', () => {
    if (!ST || !ST.seats) return;
    ST.seats.forEach((s, i) => act('avatar', { seat: i, data: null }));
  });

  $('#btn-rebuild').addEventListener('click', () =>
    act('setup', { players: Number($('#players').value) || 4 }));
  $('#btn-tables').addEventListener('click', askTables);
  $('#tablelist').addEventListener('click', (e) => {
    const row = e.target.closest('.trow');
    if (row && row.dataset.code !== CODE) act('open', { code: row.dataset.code });
  });

  $('#btn-fillcard').addEventListener('click', () => {
    const v = $('#fill-rounds').value.trim();
    act('fillCard', v === '' ? {} : { rounds: Number(v) });
  });
  $('#fill-rounds').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btn-fillcard').click();
  });

  $('#scale').addEventListener('change', () => { topKey = seatKey = ''; renderFrames(); });

  connect();
  watchFiles();
});
