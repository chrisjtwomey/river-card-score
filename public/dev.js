'use strict';
/* Dev controls. Opens on any table this server is running, or makes one of
   stand-in players, and shows every screen at once. What it may do follows
   the server: with DEV=1 every table takes every control; a normal server
   answers the state forcer alone, over the table's own host token.

   The page is one band of controls over the screens: which table, where in
   the game (the scrubber is the whole scorecard, clickable), and the
   one-shots. */

const $ = (s) => document.querySelector(s);

let ws = null, ST = null, CODE = null, HOST_TOKEN = null, SEATS = [];
let topKey = '', seatKey = '', tableKey = '';  // re-draw only when it has to change
let LIVE = false;                // real players may be behind this table
let DEVSRV = false;              // this server takes the controls that invent data
let polling = false;             // the list of tables, on a dev server only
let onTable = false;             // this socket got onto a table
let stateBusy = false;           // a record is out, and its answer is the panel's
let stateLoaded = false;         // a record is in the box, read at some moment
let stateReading = false;        // and one was asked for, so a change is not news

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
      /* Every dev action answers with a hello, and its seat list arrives
         without the seats this page has taken over -- a real table never
         volunteers them. Carry those tokens across, or pressing any control
         would quietly put every acting pane back to watching. */
      const held = new Map(CODE === m.code
        ? SEATS.filter((x) => x.watch && x.token).map((x) => [x.id, x.token]) : []);
      CODE = m.code; HOST_TOKEN = m.token; SEATS = m.seats || [];
      SEATS.forEach((x) => { if (held.has(x.id)) x.token = held.get(x.id); });
      LIVE = m.stand === false;              // the table says which it is, not the address
      DEVSRV = m.srv !== false;              // an older server said nothing, and took it all
      history.replaceState(null, '', `#c=${CODE}&t=${HOST_TOKEN}`);
      topKey = seatKey = tableKey = '';      // another table, so every pane is stale
      repairTouched = false;                 // and the form is aimed at nothing yet
      applyMode();
      if (polling) askTables();
      onTable = true;
      err('');
      // The record landed, so read back what the table became.
      if (stateBusy) { stateBusy = false; askState(); }
    } else if (m.t === 'tables') {
      renderTables(m.tables || []);
    } else if (m.t === 'stateRaw') {
      // The record to edit. Never over what is being typed: Reload asks again.
      stateReading = false;
      const box = $('#state-text');
      if (box && document.activeElement !== box) {
        box.value = JSON.stringify(m.record, null, 1);
        stateLoaded = true;
        stateErr('');
        stateStale(false);          // this text is the table, as of now
      }
    } else if (m.t === 'seat') {
      // The seat asked for: put it in the pane, which then acts as the player.
      const one = seatOf(m.id);
      if (one) { one.token = m.token; seatKey = ''; renderFrames(); }
    } else if (m.t === 'state') {
      /* The table moved while a record sits in the box. Applying it now would
         put that move back the way it was, so say so rather than let it
         happen quietly. A read already asked for is not the table moving. */
      if (stateLoaded && !stateReading && !$('#state-panel').hidden) stateStale(true);
      ST = m; render();
    } else if (m.t === 'error') {
      /* The table it was on would not open: a server that restarted, a game
         that ended. Let it go and do what a page with no table does. */
      if (!onTable && CODE) {
        stateBusy = false;
        CODE = HOST_TOKEN = null;
        history.replaceState(null, '', location.pathname);
        return act('setup', { players: Number($('#players').value) || 4 });
      }
      if (/table is gone/i.test(m.msg)) {
        stateBusy = false;
        CODE = HOST_TOKEN = null;
        history.replaceState(null, '', location.pathname);
        tableKey = '';
        return act('setup', { players: Number($('#players').value) || 4 });
      }
      /* A refused record is the panel's business, not the page's: the line
         belongs beside the button that earned it, and the edit stays in the
         box to be put right. */
      if (stateBusy) { stateBusy = false; return stateErr(m.msg); }
      // No table yet means the stand-in table was refused. Say the other way in.
      err(!CODE
        ? `${m.msg} To put a real game right, open Dev controls under ⚙ on the TV screen showing it.`
        : m.msg);
    }
  };
  ws.onclose = () => setTimeout(connect, 1000);
}
const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const act = (action, extra) => send(Object.assign({ t: 'dev', action }, extra || {}));
const err = (msg) => { $('#dev-err').textContent = msg; $('#dev-err').hidden = !msg; };
// The panel's own line, beside the button that earned it.
const stateErr = (msg) => { $('#state-err').textContent = msg; $('#state-err').hidden = !msg; };
const stateStale = (on) => { if ($('#state-stale')) $('#state-stale').hidden = !on; };
// Reading is asked for in one place, so a change arriving in the meantime is
// the answer coming, not the table moving under the text.
const askState = () => { stateReading = true; act('state'); };

/* ---------- previews ---------- */

const SIZES = { host: [1180, 820], seat: [400, 800] };

// A seat frame opens the seat itself when the page holds it -- always on a
// table of stand-ins, and on a real table once that seat is taken over. It
// only watches otherwise: t= is the seat, w= just shows it.
const seatHash = (s) => (s.token ? `#c=${CODE}&t=${s.token}` : `#c=${CODE}&w=${s.watch}`);

function frame(box, label, page, hash, kind, entry, boss) {
  const scale = Number($('#scale').value) || 0.65;
  const [w, h] = SIZES[kind];
  const url = page + hash;
  const el = document.createElement('div');
  el.className = 'frame' + (boss ? ' captain' : '');
  if (entry) el.dataset.seat = entry.id;
  el.innerHTML =
    `<header><span class="lbl"></span><a href="${url}" target="_blank" rel="noopener">open</a></header>` +
    `<div class="shell" style="width:${Math.round(w * scale)}px;height:${Math.round(h * scale)}px">` +
    `<iframe src="${url}" width="${w}" height="${h}" style="transform:scale(${scale})"></iframe></div>`;
  el.querySelector('.lbl').textContent = label;
  // On a real table a pane only watches until it is told to act. The button
  // swaps the pane between the watch link and the seat itself, and only a dev
  // server ever hands a seat over, so on any other there is no button.
  if (entry && entry.watch && DEVSRV) {
    const tk = document.createElement('button');
    tk.type = 'button';
    tk.className = 'btn tiny';
    tk.textContent = entry.token ? 'stop acting' : 'act as';
    tk.title = entry.token
      ? 'Back to only watching this seat'
      : 'Put this seat in the pane, so it can bid and play from here';
    tk.addEventListener('click', () => {
      if (entry.token) { delete entry.token; seatKey = ''; renderFrames(); }
      else act('seat', { id: entry.id });
    });
    el.querySelector('header').insertBefore(tk, el.querySelector('header a'));
  }
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
  const seats = `${CODE}:${phones.map(seatHash).join(',')}:${scale}:${DEVSRV}`;
  if (seats !== seatKey) {
    seatKey = seats;
    const box = $('#seat-frames');
    box.innerHTML = '';
    phones.forEach((s) => frame(box, s === cap ? `${s.name} · table host` : s.name,
                                'play.html', seatHash(s), 'seat', s, s === cap));
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
    const b = document.createElement('div');
    b.className = 'btn trow' + (t.code === CODE ? ' on' : '');
    b.dataset.code = t.code;
    b.title = 'Take this page onto this table';
    const code = document.createElement('span');
    code.className = 'tcode';
    code.textContent = t.code;
    const what = document.createElement('span');
    what.className = 'twhat';
    what.textContent = `${t.seats.length}p · ${t.phase}` + (t.round ? ` ${t.round}/${t.rounds}` : '');
    const kind = document.createElement('span');
    kind.className = 'tkind';
    kind.textContent = t.stand ? 'stand' : 'real';
    const end = document.createElement('button');
    end.type = 'button';
    end.className = 'tend';
    end.textContent = '✕';
    end.title = 'Destroy this table: every screen at it is told it is gone';
    end.addEventListener('click', (e) => {
      e.stopPropagation();               // destroying is not opening
      UI.ask(`Destroy table ${t.code}?`,
             t.stand ? 'A table of stand-ins; nobody loses anything.'
                     : 'A real table. Every screen at it is thrown off, and its game is not saved.',
             'Destroy', true)
        .then((yes) => { if (yes) act('end', { code: t.code }); });
    });
    b.append(code, what, kind, end);
    box.appendChild(b);
  });
}

/* ---------- the scrubber ---------- */

// The phase a clicked round lands at: 'bid' or 'tricks'.
const gotoPhase = () => {
  const on = document.querySelector('#goto-phase .btn.on');
  return (on && on.dataset.phase) || 'bid';
};

/* The whole card as cells: the lobby, every round, the finish. The cell the
   game is at is marked; the rounds already played are tinted. Click anywhere
   and the game is taken there. */
function renderScrub() {
  const box = $('#scrub');
  const rounds = ST.rounds.length ? ST.rounds
    : Game.schedule(ST.cfg.max, ST.cfg.pattern, ST.cfg.ones).map((c) => ({ cards: c }));
  const played = ST.rounds.length ? Math.min(ST.idx, rounds.length) : 0;
  const key = `${ST.code}:${rounds.map((r) => r.cards).join(',')}:${played}:${ST.phase}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = '';
  const cell = (label, sub, cls, jump) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'scell' + (cls ? ' ' + cls : '');
    b.appendChild(document.createTextNode(label));
    if (sub) { const s = document.createElement('small'); s.textContent = sub; b.appendChild(s); }
    b.addEventListener('click', jump);
    box.appendChild(b);
    return b;
  };
  cell('⌂', 'lobby', ST.phase === 'lobby' ? 'on' : '', () => act('lobby'));
  rounds.forEach((r, i) => {
    const here = ST.rounds.length && ST.idx === i && ST.phase !== 'done' && ST.phase !== 'lobby';
    cell(String(i + 1), `${r.cards}c`, (here ? 'on ' : '') + (i < played ? 'played' : ''),
         () => act('goto', { round: i + 1, phase: gotoPhase() }));
  });
  cell('🏁', 'end', ST.phase === 'done' ? 'on' : '', () => act('endGame'));
  const on = box.querySelector('.scell.on');
  if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* ---------- the repair form ---------- */

/* Where the scrubber is refused, this is how a game is moved on. It forces a
   phase and a round and nothing else: no rounds are invented, no bids are made
   up, so it is the one control a normal server takes. A game stuck in the
   wrong phase -- bidding that will not close, a finish that came too early --
   is put right here.

   The four phases are the four the server will hold. The round only travels
   with a phase a round exists in. */
const REPAIR_PHASES = ['lobby', 'bid', 'tricks', 'done'];
let repairTouched = false;      // once it is aimed, stop following the table

function buildRepair() {
  const box = $('#repair');
  if (!box || box._wired) return;
  box._wired = true;

  const lbl = document.createElement('span');
  lbl.className = 'bandlbl';
  lbl.textContent = 'Put to';

  const seg = document.createElement('div');
  seg.className = 'seg';
  REPAIR_PHASES.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn' + (p === 'bid' ? ' on' : '');
    b.dataset.phase = p;
    b.textContent = p;
    b.addEventListener('click', () => {
      seg.querySelectorAll('.btn').forEach((x) => x.classList.toggle('on', x === b));
      repairTouched = true;
    });
    seg.appendChild(b);
  });

  const round = document.createElement('input');
  round.type = 'number';
  round.min = '1';
  round.title = 'The round to put the game at';
  round.addEventListener('input', () => { repairTouched = true; });

  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'btn primary';
  go.textContent = 'Put';
  go.title = 'Force the game to this phase and round. Nothing is played or invented.';
  go.addEventListener('click', sendRepair);

  box.append(lbl, seg, round, go);
}

// What the form is aimed at, read off the form itself at the tap.
function sendRepair() {
  const box = $('#repair');
  const seg = box && box.querySelector('.seg');
  const on = seg && seg.querySelector('.btn.on');
  const phase = (on && on.dataset.phase) || 'bid';
  const patch = { phase };
  const el = box && box.querySelector('input');
  const n = Math.round(Number(el && el.value));
  // A round means nothing in the lobby, and the finish picks its own.
  if ((phase === 'bid' || phase === 'tricks') && Number.isFinite(n) && n >= 1) patch.idx = n - 1;
  act('patch', { patch });
  repairTouched = false;              // it has landed: follow the table again
}

/* Stopping the table, and walking it on. Both are about the hands nobody is
   behind, so they come and go with them -- `Game.canPause` is the same
   question the host screen's button asks, and the same one the message that
   carries it is guarded on. Step is the dev page's alone: reading a hand a
   move at a time is nothing a table in a living room wants. */
function renderRun() {
  const box = $('#run-tools');
  if (!box) return;
  const on = !!ST && Game.canPause(ST);
  box.hidden = !on;
  if (!on) return;
  const btn = $('#btn-pause');
  btn._now = !!ST.paused;                    // read at the tap, not at the draw
  btn.textContent = btn._now ? '▶ Play' : '❚❚ Pause';
  btn.title = btn._now
    ? 'Let the table play the hands nobody is behind again'
    : 'Stop the table playing the hands nobody is behind';
  btn.classList.toggle('primary', btn._now);
  // Pause is the table's own, so it works anywhere. Stepping is a dev server's.
  $('#btn-step').hidden = !DEVSRV;
  $('#btn-step').disabled = !btn._now;       // stepping a running table is a race
}

// Until it is aimed, the form says where the game is, so a tap on Put with
// one thing changed changes only that thing.
function fillRepair() {
  const box = $('#repair');
  if (!box || box.hidden || repairTouched || !ST) return;
  const seg = box.querySelector('.seg');
  if (seg) {
    seg.querySelectorAll('.btn').forEach((b) =>
      b.classList.toggle('on', b.dataset.phase === ST.phase));
  }
  const el = box.querySelector('input');
  if (el && document.activeElement !== el) {
    const total = ST.rounds.length;
    el.max = String(total || 1);
    el.value = String(total ? Math.min(ST.idx + 1, total) : 1);
  }
}

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

/* ---------- the players panel ---------- */

/* The tricks a round paid are one column, not seven cells: the table keeps
   them only when every seat has a number, and a half-filled column sent cell
   by cell was thrown away each time and the typing with it. So the column
   goes together, off the row of boxes as they stand, and until it is whole
   the empty cells say which ones are wanted. */
const wonBad = (v) => v === '' || !Number.isFinite(Number(v));

function sendWon() {
  const box = $('#prows');
  if (!box || !ST) return;
  const cells = Array.from(box.querySelectorAll('input.won'));
  const vals = cells.map((el) => String(el.value).trim());
  cells.forEach((el, i) => el.classList.toggle('part', wonBad(vals[i])));
  if (vals.length !== ST.seats.length || vals.some(wonBad)) return;
  act('patch', { patch: { round: { i: ST.idx, tricks: vals.map(Number) } } });
}

/* One row a seat. Every control sends the moment it is used, and the rows
   are rebuilt only while nothing in them is being typed in. */
function renderPlayers() {
  const box = $('#prows');
  if (!box || $('#players-panel').hidden) return;
  const r = ST.rounds[Math.min(ST.idx, ST.rounds.length - 1)] || null;
  const key = ST.seats.map((s, p) =>
    `${s.name}/${s.bot}/${s.left}/${s.id === ST.captainId}/${r ? r.dealer : ST.firstDealerId}` +
    `/${r && r.bids ? r.bids[p] : ''}/${r && r.tricks ? r.tricks[p] : ''}`).join('|') + `@${ST.idx}:${ST.phase}`;
  if (box.dataset.key === key || box.contains(document.activeElement)) return;
  box.dataset.key = key;
  box.innerHTML = '';

  // An edited number lands beside the others, not instead of them.
  const numbers = (k, p, v) => {
    const out = ST.seats.map((x, q) => {
      const have = r && r[k] ? r[k][q] : null;
      return q === p ? v : (have === undefined ? null : have);
    });
    act('patch', { patch: { round: { i: ST.idx, [k]: out } } });
  };

  ST.seats.forEach((s, p) => {
    const row = document.createElement('div');
    row.className = 'prow';

    const name = document.createElement('input');
    name.type = 'text';
    name.value = s.name;
    name.addEventListener('change', () => act('patch', { patch: { seat: { i: p, name: name.value } } }));

    const radio = (group, on, fire) => {
      const el = document.createElement('input');
      el.type = 'radio'; el.name = group; el.checked = on; el.className = 'mid';
      el.addEventListener('change', fire);
      return el;
    };
    const host = radio('cap', s.id === ST.captainId,
      () => act('patch', { patch: { captainId: s.id } }));
    // Mid-game the dealer belongs to the round on show; before one, to the game.
    const dealer = radio('deal', r ? r.dealer === p : ST.firstDealerId === s.id,
      () => act('patch', { patch: r ? { round: { i: ST.idx, dealer: p } } : { firstDealerId: s.id } }));

    const check = (on, k) => {
      const el = document.createElement('input');
      el.type = 'checkbox'; el.checked = on; el.className = 'mid';
      el.addEventListener('change', () => act('patch', { patch: { seat: { i: p, [k]: el.checked } } }));
      return el;
    };

    // A bid stands on its own -- the table keeps a column with gaps in it.
    // The tricks do not, so they go as one.
    const num = (k, v) => {
      const el = document.createElement('input');
      el.type = 'number'; el.min = '0';
      if (k === 'tricks') el.className = 'won';
      el.value = v === null || v === undefined ? '' : v;
      el.disabled = !r;
      el.addEventListener('change', k === 'tricks' ? sendWon
        : () => numbers(k, p, el.value.trim() === '' ? null : Number(el.value)));
      return el;
    };

    // A stand-in photo is invented data, so only a dev server takes it. The
    // cell stays, empty, or every row after it would slide up a column.
    const pbtns = document.createElement('span');
    pbtns.className = 'pbtns';
    if (DEVSRV) {
      const photo = document.createElement('button');
      photo.type = 'button'; photo.className = 'btn tiny'; photo.textContent = '📷';
      photo.title = 'A stand-in photo on this seat';
      photo.addEventListener('click', () => act('avatar', { seat: p, data: standInAvatar(s.name, p) }));
      const clear = document.createElement('button');
      clear.type = 'button'; clear.className = 'btn tiny'; clear.textContent = '✕';
      clear.title = 'No photo on this seat';
      clear.addEventListener('click', () => act('avatar', { seat: p, data: null }));
      pbtns.append(photo, clear);
    }

    row.append(name, host, dealer, check(!!s.bot, 'bot'), check(!!s.left, 'left'),
               num('bids', r && r.bids ? r.bids[p] : null),
               num('tricks', r && r.tricks ? r.tricks[p] : null),
               pbtns, document.createElement('span'));
    box.appendChild(row);
  });
}

/* ---------- render ---------- */

function render() {
  renderFrames();
  if (DEVSRV) renderScrub();       // the card it draws is a card only a dev server can fill
  else fillRepair();
  renderRun();
  renderPlayers();
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
}

/* ---------- wiring ---------- */

// A real table takes the same controls; the page only says to tread with
// care, because the clicks land on somebody's game.
function applyMode() {
  document.body.classList.toggle('livemode', LIVE);
  $('#live-note').hidden = !LIVE;
  if (LIVE) {
    $('#code').textContent = CODE;
    $('#subtitle').textContent = `live table ${CODE}`;
  }
  applyGates();
}

/* What the server will not take is not shown. A control that draws itself and
   then answers a refusal teaches the limits one click at a time; the page
   knows them from the hello, so it shows what works and nothing else.

   On a normal server that leaves the two that put a game right -- the players
   panel and the record -- with the repair form in place of the scrubber. */
function applyGates() {
  const el = (s) => $(s);
  ['#tables-tools', '#scrub-tools', '#shots-dev', '#shots-sep'].forEach((s) => {
    if (el(s)) el(s).hidden = !DEVSRV;
  });
  if (el('#repair')) el('#repair').hidden = DEVSRV || !CODE;
  if (el('#ph-photo')) el('#ph-photo').textContent = DEVSRV ? 'photo' : '';
}

document.addEventListener('DOMContentLoaded', () => {
  buildRepair();
  applyMode();
  UI.wireTheme('#btn-theme');

  document.querySelectorAll('[data-act]').forEach((b) =>
    b.addEventListener('click', () => act(b.dataset.act)));

  document.querySelectorAll('#goto-phase .btn').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('#goto-phase .btn').forEach((x) => x.classList.toggle('on', x === b));
    }));

  $('#btn-avatars').addEventListener('click', () => {
    if (!ST || !ST.seats) return;
    ST.seats.forEach((s, i) => act('avatar', { seat: i, data: standInAvatar(s.name, i) }));
  });
  $('#btn-no-avatars').addEventListener('click', () => {
    if (!ST || !ST.seats) return;
    ST.seats.forEach((s, i) => act('avatar', { seat: i, data: null }));
  });

  // The state panel: fetch on open and after every apply; never mid-edit.
  $('#btn-state').addEventListener('click', () => {
    const panel = $('#state-panel');
    panel.hidden = !panel.hidden;
    $('#btn-state').textContent = panel.hidden ? 'State ▾' : 'State ▴';
    $('#btn-state').setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) askState();
  });
  $('#btn-state-reload').addEventListener('click', () => {
    $('#state-text').blur();
    askState();
  });
  /* A broken table is worth keeping a copy of before it is put right: it is
     what the bug looked like. The clipboard is read off `window` by name --
     there is none on a page served over plain http from another machine, and
     saying so is better than a button that does nothing. */
  $('#btn-state-copy').addEventListener('click', () => {
    const cb = window.navigator && window.navigator.clipboard;
    if (!cb) return UI.fx.toast('This browser will not let the page copy', { err: true });
    cb.writeText($('#state-text').value || '').then(
      () => UI.fx.toast('The record is on the clipboard'),
      () => UI.fx.toast('Nothing was copied', { err: true }));
  });
  $('#btn-state-apply').addEventListener('click', () => {
    let rec;
    try { rec = JSON.parse($('#state-text').value); }
    catch (e) { return stateErr(`Not JSON: ${e.message}`); }
    stateErr('');
    stateStale(false);              // it is the text's turn now, whatever moved
    $('#state-text').blur();
    /* Nothing is read back here. The table answers an apply either way, and a
       read sent now would land on a refusal and put the unchanged table over
       the edit that was refused. The answer decides: the hello reads back, the
       error stays in the panel. */
    stateBusy = true;
    act('state', { record: rec });
  });

  $('#btn-players').addEventListener('click', () => {
    const panel = $('#players-panel');
    panel.hidden = !panel.hidden;
    $('#btn-players').textContent = panel.hidden ? 'Players ▾' : 'Players ▴';
    $('#btn-players').setAttribute('aria-expanded', String(!panel.hidden));
    delete $('#prows').dataset.key;
    if (!panel.hidden && ST) renderPlayers();
  });

  /* Pause is the table's own message, not a dev action: this page holds the
     host token, so it says it the way the host screen does. Step is the dev
     page's own, and a dev server's alone. */
  $('#btn-pause').addEventListener('click', () =>
    send({ t: 'pause', on: !$('#btn-pause')._now }));
  $('#btn-step').addEventListener('click', () => act('step'));

  $('#btn-rebuild').addEventListener('click', () =>
    act('setup', { players: Number($('#players').value) || 4 }));
  $('#btn-tables').addEventListener('click', askTables);
  $('#tablelist').addEventListener('click', (e) => {
    if (e.target.closest('.tend')) return;
    const row = e.target.closest('.trow');
    if (row && row.dataset.code !== CODE) act('open', { code: row.dataset.code });
  });

  $('#scale').addEventListener('change', () => { topKey = seatKey = ''; renderFrames(); });

  connect();
  watchFiles();
});
