'use strict';
/* Dev controls. Three ways in, asked before anything else is drawn: a new
   table of stand-ins, a table already in play, or a game watched again. A code
   in the address is the second of those, already answered; #g=ID is the third.

   Whichever it is, what follows is the same page: one band of controls over
   the screens. On a table the band is the tables this server is running, the
   scorecard as a strip of rounds, and the one-shots. On a game watched again
   it is the games on file, the rounds of that game, and the transport -- the
   same rows in the same places, with the verbs of a replay.

   What may be done follows the server: with DEV=1 every table takes every
   control; a normal server answers the state forcer over the table's own host
   token, and a replay, which invents nothing. */

const $ = (s) => document.querySelector(s);

let ws = null, ST = null, CODE = null, HOST_TOKEN = null, SEATS = [];
let topKey = '', seatKey = '';  // re-draw the panes only when they have to change
let LIVE = false;                // real players may be behind this table
let DEVSRV = false;              // this server takes the controls that invent data
let polling = false;             // the list of tables, on a dev server only
let onTable = false;             // this socket got onto a table
let stateBusy = false;           // a record is out, and its answer is the panel's
let stateLoaded = false;         // a record is in the box, read at some moment
let stateReading = false;        // and one was asked for, so a change is not news
let REPLAY = null;               // the copy being watched, and where it stands
let WAYS = null;                 // what this server will take, and what to open with it
/* The question, while it is on the wire, and what its answer does to the line
   under the card: 'clear' for a line earned before it was asked, 'keep' for one
   that is the reason it is being asked again. */
let waysOut = false;
let WANT = null;                 // a game named in the address, to open on arrival

// A copy is only being watched once one has been made. Until then the games
// are a list to pick from, and the panes are still the table's.
const replaying = () => !!(REPLAY && REPLAY.code);
// Nothing picked yet: no table and no copy. The way in is the whole page.
const choosing = () => !CODE && !replaying();
/* The one state the band and the panels are drawn off. On a table it is the
   table's; on a copy it is the copy's, which arrives with every replay
   message because this page is not at the copy's table -- the panes are. */
const stateNow = () => (replaying() ? (REPLAY.state || null) : ST);

// The size of the last table made here, so the band can make another like it.
const N_KEY = 'rcs:dev:players';
let NEW_N = Math.max(2, Math.min(8, Number(localStorage.getItem(N_KEY)) || 4));

/* dev.html#c=CODE&t=TOKEN opens the page on that table, so the TV screen's ⚙
   lands on the game it was pressed from; #g=ID opens it on a game watched
   again. The page writes back whichever it lands on, so a reload comes to the
   same place. With neither, it asks what you are here for. */
(function readHash() {
  const q = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  const c = (q.get('c') || '').toUpperCase();
  // A dev server opens a table on its code alone, so the key is not required.
  if (c) { CODE = c; HOST_TOKEN = q.get('t') || ''; }
  else if (q.get('g')) WANT = q.get('g');
})();

function writeHash() {
  const at = replaying() ? (REPLAY.game ? `#g=${REPLAY.game}` : '')
    : (CODE ? `#c=${CODE}&t=${HOST_TOKEN}` : '');
  history.replaceState(null, '', at || location.pathname);
}

/* ---------- socket ---------- */

function connect() {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  ws = new WebSocket(proto + location.host + '/ws');
  onTable = false;
  /* Where the page already is, or the question. A socket that drops and comes
     back opens the same table, or the same game again -- a copy belongs to the
     socket that asked for one, so it went when this one did. */
  ws.onopen = () => {
    if (CODE) return act('open', { code: CODE, token: HOST_TOKEN });
    if (WANT) return replayAsk({ do: 'open', game: WANT });
    askWays();
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'ways') {
      /* What this server will take, and what there is to open with it. It
         comes before anything is drawn, because the way in is what it offers. */
      WAYS = m;
      if (waysOut === 'clear') err('');   // what was refused before this is answered
      waysOut = false;
      DEVSRV = m.srv !== false;
      paint();
    } else if (m.t === 'hello') {
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
      writeHash();
      topKey = seatKey = '';                 // another table, so every pane is stale
      onTable = true;
      err('');
      paint();
      if (polling) askTables();
      // The record landed, so read back what the table became.
      if (stateBusy) { stateBusy = false; askState(); }
    } else if (m.t === 'tables') {
      if (WAYS) WAYS.tables = m.tables || [];
      renderTables($('#tablelist'), m.tables || []);
      if (choosing()) renderWays();
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
    } else if (m.t === 'replay') {
      /* A copy opened, moved about in, or let go. Letting go is said plainly;
         anything else is a copy to draw the band off. */
      const was = REPLAY && REPLAY.code;
      REPLAY = m.shut ? null : m;
      WANT = (REPLAY && REPLAY.game) || null;
      if (REPLAY) err('');            // a copy that opened is not a line to keep
      /* Only a different copy is a different pane. Each pane holds a socket on
         the copy, so a step reaches it on its own; tearing them down every step
         reloaded every frame at every press, and made the panel feel dead. */
      if ((REPLAY && REPLAY.code) !== was) seatKey = topKey = '';
      writeHash();
      paint();
    } else if (m.t === 'replayAt') {
      /* A copy playing itself, saying where it has got to. Only the place and
         the table move: the rounds and the points of the round are the trail,
         and it is being read, not written. A word about a copy this page has
         let go is not this page's business. */
      if (REPLAY && REPLAY.code === m.code) {
        REPLAY.at = m.at;
        REPLAY.playing = m.playing;
        REPLAY.where = m.where;
        REPLAY.state = m.state;
        paint();
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
      ST = m;
      // Only a dev server has tables to hand out, so only a dev server is asked.
      if (ST.dev && !polling) { polling = true; askTables(); setInterval(askTables, 5000); }
      paint();
    } else if (m.t === 'error') {
      /* The question itself refused. A server older than this page does not
         know it, so nothing will answer: draw the card off what the page knows
         on its own rather than leave a panel with a line and no doors. The one
         door that still works there is a code and a host key, typed in. */
      if (waysOut) {
        waysOut = false;
        WAYS = WAYS || { srv: false, tables: [], here: null, games: [] };
        paint();
        return err(m.msg);
      }
      /* The way in did not work out: a server that restarted, a game that
         ended, a code that was never here. Let it go and ask again. */
      if ((!onTable && CODE) || /table is gone/i.test(m.msg)) {
        stateBusy = false;
        toWays(m.msg);
        return;
      }
      if (WANT && !replaying()) { WANT = null; toWays(m.msg); return; }
      /* A refused record is the panel's business, not the page's: the line
         belongs beside the button that earned it, and the edit stays in the
         box to be put right. */
      if (stateBusy) { stateBusy = false; return stateErr(m.msg); }
      err(m.msg);
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
const askState = () => { stateReading = true; act('state', replaying() ? { replay: true } : null); };

/* Back to the question. The table is let go here and the copy on the server,
   so what the page offers next is what is actually there. */
function toWays(msg) {
  if (replaying()) replayAsk({ do: 'close' });
  CODE = HOST_TOKEN = null;
  WANT = null;
  REPLAY = null;
  ST = null;
  SEATS = [];
  onTable = false;
  stateLoaded = false;
  topKey = seatKey = '';
  writeHash();
  err(msg || '');
  askWays(!!msg);
  paint();
}

// The question, and the note that it is out: whatever comes back is its answer.
function askWays(keep) { waysOut = keep ? 'keep' : 'clear'; act('ways'); }

/* ---------- previews ---------- */

const SIZES = { host: [1180, 820], seat: [400, 800] };

// A seat frame opens the seat itself when the page holds it -- always on a
// table of stand-ins, and on a real table once that seat is taken over. It
// only watches otherwise: t= is the seat, w= just shows it.
const seatHash = (s, at) => (s.token ? `#c=${at}&t=${s.token}` : `#c=${at}&w=${s.watch}`);

// `addr` is whatever the page reads itself by: a hash for a seat and for a
// screen that runs a table, a query for one that is only shown a table.
function frame(box, label, page, addr, kind, entry, boss) {
  const scale = Number($('#scale').value) || 0.65;
  const [w, h] = SIZES[kind];
  const url = page + addr;
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
  if (entry && entry.watch && DEVSRV && !replaying()) {
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
  if (!CODE && !replaying()) return;
  const scale = $('#scale').value;
  const cap = ST ? seatOf(ST.captainId) : null;
  /* While a game is being watched again the panes are the copy's, not the
     table's: the whole point of a copy is that it is the thing you look at. */
  const at = replaying() ? REPLAY.code : CODE;
  const label = replaying() ? `TV screen · replay of ${REPLAY.of}` : `TV screen · table ${CODE}`;

  // top row: the big screen, on its own
  const top = `${at}:${HOST_TOKEN}:${scale}`;
  if (top !== topKey) {
    topKey = top;
    const box = $('#host-frame');
    box.innerHTML = '';
    /* A copy is watched, so the screen on it is one that is only shown a
       table -- which the host page reads off a query, not a hash. */
    frame(box, label, 'host.html',
          replaying() ? `?c=${at}` : `#c=${CODE}&t=${HOST_TOKEN}`, 'host');
  }

  // bottom row: the phones, the one that runs the table always first. Whoever
  // that is, that pane stands in the same place, so the eye is not sent
  // hunting for it. The key follows the order, so a new table host re-draws.
  const list = replaying() ? REPLAY.seats : SEATS;
  const phones = (!replaying() && cap) ? [cap].concat(list.filter((s) => s.id !== cap.id)) : list;
  const seats = `${at}:${phones.map((s) => seatHash(s, at)).join(',')}:${scale}:${DEVSRV}`;
  if (seats !== seatKey) {
    seatKey = seats;
    const box = $('#seat-frames');
    box.innerHTML = '';
    phones.forEach((s) => frame(box, s === cap ? `${s.name} · table host` : s.name,
                                'play.html', seatHash(s, at), 'seat', s, s === cap));
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
   over any table it holds, so no token is typed here.

   The strip in the band and the list on the way-in card are the same rows, so
   the box is handed in and each keeps its own reason to redraw. */
function renderTables(box, list) {
  if (!box) return;
  const key = list.map((t) => `${t.code}/${t.phase}/${t.round}/${t.seats.length}/${t.stand}`)
    .join('|') + '@' + CODE;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
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
    b.addEventListener('click', () => {
      if (t.code !== CODE) act('open', { code: t.code });
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

/* Stopping the table, and walking it on. A stopped table is stopped for
   everybody -- no bid, no card, no trick, and none of the hands it plays for
   itself -- so it is offered wherever a hand is out, a table of people with
   real cards included. `Game.canPause` is the same question the host screen's
   button asks, and the same one the message that carries it is guarded on.

   Step is the other half, and a different question: it is about the hands
   nobody is behind, and it is the dev page's alone, because reading a hand a
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
    ? 'Start the table again. Bids and cards land as before.'
    : 'Stop the table. No bid, no card and no trick lands until you start it.';
  btn.classList.toggle('primary', btn._now);
  // Pause is the table's own, so it works anywhere. Stepping is a dev server's,
  // and only where the table has a hand of its own to take a move of.
  $('#btn-step').hidden = !DEVSRV || !Game.tableSelfPlays(ST);
  $('#btn-step').disabled = !btn._now;       // stepping a running table is a race
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

/* ---------- watching the game again ---------- */

/* The copy, and the way about it. It takes the band the table has: the games
   on file where the tables are, the rounds of the game where the scorecard is,
   and the transport where Pause and Step are. Nothing here invents anything --
   a replay puts back what happened, on a copy of its own -- so the one-shots
   are away and the panels only read.

   The rounds of a replay are drawn into the scrubber the card uses, because
   they are the same thing: a strip of rounds, one of them where you are. */
const replayAsk = (o) => send(Object.assign({ t: 'dev', action: 'replay' }, o));

/* Every kind of point, as one mark and one plain word. A game is a sequence of
   these, and the stepper is that sequence made pressable. */
const STEPS = {
  R: ['\u25b8', 'the round is dealt'],
  b: ['b', 'a bid'],
  s: ['\u00b7', 'a trick opens'],
  c: ['c', 'a card'],
  w: ['\u25c6', 'a trick taken'],
  W: ['\u21ba', 'a trick taken back'],
  e: ['\u03a3', 'the round is scored'],
  z: ['\u21a9', 'a step back'],
  F: ['!', 'the table was forced'],
  G: ['\u25b8', 'the game starts'],
  E: ['\ud83c\udfc1', 'the game ends'],
};

/* The points of the round the copy is standing in, one cell each.

   A game is some hundreds of points, which is why this is two levels and not
   one: the rounds above pick the round, and this picks the moment inside it.
   Nothing here is a slider, because nothing here is continuous -- a game is a
   sequence of things that happened, and each of them either has or has not. */
function renderSteps() {
  const box = $('#replay-steps');
  if (!box || !REPLAY.kinds) return;
  const marks = REPLAY.marks;
  let from = 0, to = REPLAY.kinds.length - 1;
  marks.forEach((m, i) => {
    if (m.at <= REPLAY.at) { from = m.at; to = marks[i + 1] ? marks[i + 1].at - 1 : REPLAY.kinds.length - 1; }
  });
  const key = `${from}-${to}@${REPLAY.at}:${REPLAY.kinds.length}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = '';
  for (let i = from; i <= to; i++) {
    const k = REPLAY.kinds[i];
    const [mark, said] = STEPS[k] || ['?', 'something'];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'scell' + (i === REPLAY.at ? ' on' : '') + (i < REPLAY.at ? ' done' : '');
    b.textContent = mark;
    b.title = `${said} — point ${i + 1} of ${REPLAY.kinds.length}`;
    b.addEventListener('click', () => replayAsk({ do: 'seek', at: i }));
    box.appendChild(b);
  }
  const on = box.querySelector('.scell.on');
  if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* The rounds of the game being watched, in the strip a scorecard uses. A hand
   thrown in is a cell of its own, because it is a second go at the same round
   and looked different. */
function renderMarks() {
  const box = $('#scrub');
  if (!box) return;
  const key = 'r:' + REPLAY.marks.map((m) => `${m.at}/${m.w}`).join(',') + '@' + REPLAY.at;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = '';
  // The mark the copy is standing in: the last one it has reached, and the
  // first one before it has reached any.
  let cur = 0;
  REPLAY.marks.forEach((m, i) => { if (m.at <= REPLAY.at) cur = i; });
  REPLAY.marks.forEach((m, i) => {
    const again = m.w === 'bum' || m.w === 'reset' || m.w === 'undo';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'scell' + (i === cur ? ' on' : '') + (again ? ' bum' : '')
      + (m.at < REPLAY.at ? ' played' : '');
    b.appendChild(document.createTextNode(m.w === 'end' ? '🏁' : String(m.i + 1)));
    const sm = document.createElement('small');
    sm.textContent = m.w === 'end' ? 'end'
      : (m.w === 'bum' ? 'again'
        // 'undo' is what older trails on disk call a round put back by hand.
        : (m.w === 'reset' || m.w === 'undo' ? 'back' : `${m.cards}c`));
    b.appendChild(sm);
    b.title = m.w === 'bum' ? 'The hand was thrown in and dealt again'
      : (m.w === 'reset' || m.w === 'undo'
        ? 'The round was put back to here' : 'Take the replay to here');
    b.addEventListener('click', () => replayAsk({ do: 'seek', at: m.at }));
    box.appendChild(b);
  });
  const on = box.querySelector('.scell.on');
  if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* What there is to watch: the game a table is playing now, and every game on
   file. A game's own table may be long gone -- its trail is kept beside its
   scorecard -- so this is not only one table's.

   `info` is whatever knows: the way-in card asks the server for it before
   anything is open, and the band reads it off the copy it is already on. */
function renderGames(box, info) {
  if (!box || !info) return;
  const games = info.games || [];
  const key = (info.here || '-') + ':' + games.map((g) => g.id).join(',')
    + '@' + (info.game || info.code || '');
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = '';
  const row = (code, said, when, who, why, on, go) => {
    const b = document.createElement('div');
    b.className = 'btn grow' + (on ? ' on' : '');
    b.title = why;
    const top = document.createElement('div');
    top.className = 'gtop';
    const c = document.createElement('span');
    c.className = 'gcode';
    c.textContent = code;
    const s = document.createElement('span');
    s.className = 'gwon';
    s.textContent = said;
    top.append(c, s);
    if (when) {
      const t = document.createElement('span');
      t.className = 'gwhen';
      t.textContent = when;
      top.appendChild(t);
    }
    b.appendChild(top);
    if (who) {
      const p = document.createElement('div');
      p.className = 'gwho';
      p.textContent = who;
      b.appendChild(p);
    }
    b.addEventListener('click', go);
    box.appendChild(b);
  };
  if (info.here) {
    row(info.here, 'playing now', '', '', 'The game this table is playing now',
        !!info.code && !info.game, () => replayAsk({ do: 'open' }));
  }
  games.forEach((g) => {
    const names = g.names || [];
    row(g.code, wonBy(g), gameWhen(g.at),
        `${names.length} players · ${names.join(', ')}`,
        'Watch this game again', info.game === g.id,
        () => replayAsk({ do: 'open', game: g.id }));
  });
  if (!info.here && !games.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'No game has been written down yet.';
    box.appendChild(p);
  }
}

// Who took it, and with what. A draw is named as one, the way the finish does.
function wonBy(g) {
  const names = g.names || [], won = g.winners || [];
  if (!won.length) return '';
  const who = won.map((i) => names[i] || 'somebody').join(' & ');
  const score = g.totals ? g.totals[won[0]] : null;
  return `🏆 ${who}` + (score === null || score === undefined ? '' : ` · ${score}`);
}

// When it was played, short enough to sit at the end of a row.
function gameWhen(at) {
  const d = new Date(Number(at) || 0);
  if (!at || isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// The band, on a game that has already happened.
function renderReplay() {
  if (!replaying()) return;
  renderGames($('#gamelist'), REPLAY);
  renderMarks();
  renderSteps();
  const play = $('#btn-play');
  play._now = !!REPLAY.playing;             // read at the tap, not at the draw
  play.textContent = play._now ? '❚❚ Pause' : '▶ Play';
  play.title = play._now ? 'Stop where it is'
    : 'Play it back at the pace the table played it';
  $('#replay-at').textContent = `${REPLAY.at + 1} of ${REPLAY.n}`;
  $('#replay-where').textContent = REPLAY.where || '';
}

/* ---------- the way in ---------- */

/* Three doors, and what each of them needs. What this server will take decides
   which of them are open: a table of stand-ins is a dev server's alone, a
   table in play needs its code, and a game on file needs nothing at all. */
function renderWays() {
  const box = $('#ways');
  if (!box) return;
  const on = choosing();
  box.hidden = !on;
  if ($('#band')) $('#band').hidden = on;
  if (!on || !WAYS) return;
  const tables = WAYS.tables || [], games = WAYS.games || [];
  const key = `${DEVSRV}:${tables.map((t) => t.code + t.phase).join(',')}` +
              `:${games.map((g) => g.id).join(',')}:${WAYS.here || ''}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  while (box.firstChild) box.firstChild.remove();

  const door = (title, said, shut) => {
    const d = document.createElement('div');
    d.className = 'way' + (shut ? ' shut' : '');
    const h = document.createElement('h2');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = said;
    d.append(h, p);
    box.appendChild(d);
    return d;
  };
  const line = (d) => {
    const l = document.createElement('div');
    l.className = 'line';
    d.appendChild(l);
    return l;
  };
  const label = (l, txt) => {
    const s = document.createElement('span');
    s.className = 'bandlbl';
    s.textContent = txt;
    l.appendChild(s);
  };
  const field = (l, cls, opts) => {
    const i = document.createElement('input');
    i.type = opts.type || 'text';
    i.className = cls;
    Object.keys(opts).forEach((k) => { if (k !== 'type') i[k] = opts[k]; });
    l.appendChild(i);
    return i;
  };
  const go = (l, txt, why, run) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn primary';
    b.textContent = txt;
    b.title = why;
    b.addEventListener('click', run);
    l.appendChild(b);
    return b;
  };

  // A table of stand-ins. It invents players, so only a dev server makes one.
  const made = door('A new table',
    DEVSRV ? 'Stand-ins in every seat, ready to play. Nobody real is at it.'
           : 'A table of stand-ins needs the server started with DEV=1.', !DEVSRV);
  if (DEVSRV) {
    const l = line(made);
    label(l, 'players');
    const n = field(l, 'count', { type: 'number', id: 'players', min: '2', max: '8',
                                  value: String(NEW_N) });
    go(l, 'Make the table', 'A table of stand-ins, in the lobby',
       () => newTable(Number(n.value) || 4));
  }

  /* A table already in play. A dev server hands over any table it is running,
     so it lists them; any other server wants the key the TV screen holds. */
  const open = door('A table already in play',
    DEVSRV ? 'Every table this server is running. Its screens keep playing, and every control here lands on that game.'
           : 'Its code and its host key. The screen showing it has both, under ⚙ — or press Dev controls there.');
  if (tables.length) {
    const list = document.createElement('div');
    list.className = 'waylist';
    open.appendChild(list);
    renderTables(list, tables);
  }
  {
    const l = line(open);
    label(l, 'code');
    const c = field(l, 'code', { id: 'way-code', maxLength: 4, placeholder: 'ABCD' });
    const t = DEVSRV ? null
      : field(l, 'tok', { id: 'way-token', placeholder: 'host key' });
    go(l, 'Manage it', 'Take this page onto that table', () => {
      const code = String(c.value || '').trim().toUpperCase();
      if (!code) return err('a table needs its code');
      err('');
      CODE = code;
      HOST_TOKEN = t ? String(t.value || '').trim() : '';
      act('open', { code: CODE, token: HOST_TOKEN });
    });
  }

  // A game watched again. It reads what is already written down, so it needs
  // no table and no key: the copy is its own table, and goes when this page does.
  const watch = door('Replays',
    'Play a past game back, a point at a time or at the pace it was played. It runs on a copy, so the game it came from is not touched. No table and no key needed.');
  const list = document.createElement('div');
  list.className = 'waylist tall';       // the longest of the lists, and the most read
  watch.appendChild(list);
  renderGames(list, WAYS);
}

// Another table of stand-ins, and the size it was, for the band to repeat.
function newTable(n) {
  NEW_N = Math.max(2, Math.min(8, Math.round(n) || 4));
  try { localStorage.setItem(N_KEY, String(NEW_N)); } catch (e) { /* a browser that will not */ }
  act('setup', { players: NEW_N });
}

/* ---------- the players panel ---------- */

/* What the panel is editing, over the seats it edits it on.

   The bid and won columns act on the round the game is standing in, so that
   round has to be named: there is no other way to know which one you are
   typing into. And forcing the phase is the one thing that unsticks a flow the
   round's own numbers cannot -- every bid in and the phase never turned. A
   phase lands the moment it is pressed; the one the game is in is marked, so
   the row says where the game is as well as where to send it. */
const PHASES = ['lobby', 'bid', 'tricks', 'done'];

function buildPhaseRow() {
  const box = $('#phase-row');
  if (!box || box._wired) return;
  box._wired = true;
  const at = document.createElement('span');
  at.className = 'pround';
  const lbl = document.createElement('span');
  lbl.className = 'bandlbl';
  lbl.textContent = 'Phase';
  const seg = document.createElement('div');
  seg.className = 'seg';
  PHASES.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.dataset.phase = p;
    b.textContent = p;
    b.title = `Force the game to ${p}. Nothing is played or invented.`;
    b.addEventListener('click', () => act('patch', { patch: { phase: p } }));
    seg.appendChild(b);
  });
  box.append(at, lbl, seg);
}

function renderPhaseRow() {
  const box = $('#phase-row');
  const S = stateNow();
  if (!box || !S) return;
  const r = S.rounds[Math.min(S.idx, S.rounds.length - 1)] || null;
  const at = box.querySelector('.pround');
  if (at) {
    at.textContent = r
      ? `Round ${Math.min(S.idx + 1, S.rounds.length)} of ${S.rounds.length} · ${r.cards} cards`
      : 'No round in play';
  }
  const seg = box.querySelector('.seg');
  if (seg) {
    // A game already played is where it is. The phase is shown, never forced.
    seg.hidden = replaying();
    seg.querySelectorAll('.btn').forEach((b) =>
      b.classList.toggle('on', b.dataset.phase === S.phase));
  }
}

/* The tricks a round paid are one column, not seven cells: the table keeps
   them only when every seat has a number, and a half-filled column sent cell
   by cell was thrown away each time and the typing with it. So the column
   goes together, off the row of boxes as they stand, and until it is whole
   the empty cells say which ones are wanted. */
const wonBad = (v) => v === '' || !Number.isFinite(Number(v));

function sendWon() {
  const box = $('#prows');
  if (!box || !ST || replaying()) return;
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
  const S = stateNow();
  if (!box || !S || $('#players-panel').hidden) return;
  renderPhaseRow();
  /* A game already played is read here, never written: what happened is what
     the trail says, and typing over it would make the panel lie about it. */
  const set = !replaying();
  const r = S.rounds[Math.min(S.idx, S.rounds.length - 1)] || null;
  const key = S.seats.map((s, p) =>
    `${s.name}/${s.bot}/${s.left}/${s.id === S.captainId}/${r ? r.dealer : S.firstDealerId}` +
    `/${r && r.bids ? r.bids[p] : ''}/${r && r.tricks ? r.tricks[p] : ''}`).join('|') +
    `@${S.idx}:${S.phase}:${set}`;
  if (box.dataset.key === key || box.contains(document.activeElement)) return;
  box.dataset.key = key;
  box.innerHTML = '';

  // An edited number lands beside the others, not instead of them.
  const numbers = (k, p, v) => {
    const out = S.seats.map((x, q) => {
      const have = r && r[k] ? r[k][q] : null;
      return q === p ? v : (have === undefined ? null : have);
    });
    act('patch', { patch: { round: { i: S.idx, [k]: out } } });
  };

  S.seats.forEach((s, p) => {
    const row = document.createElement('div');
    row.className = 'prow';

    const name = document.createElement('input');
    name.type = 'text';
    name.value = s.name;
    name.disabled = !set;
    name.addEventListener('change', () => act('patch', { patch: { seat: { i: p, name: name.value } } }));

    const radio = (group, on, fire) => {
      const el = document.createElement('input');
      el.type = 'radio'; el.name = group; el.checked = on; el.className = 'mid';
      el.disabled = !set;
      el.addEventListener('change', fire);
      return el;
    };
    const host = radio('cap', s.id === S.captainId,
      () => act('patch', { patch: { captainId: s.id } }));
    // Mid-game the dealer belongs to the round on show; before one, to the game.
    const dealer = radio('deal', r ? r.dealer === p : S.firstDealerId === s.id,
      () => act('patch', { patch: r ? { round: { i: S.idx, dealer: p } } : { firstDealerId: s.id } }));

    const check = (on, k) => {
      const el = document.createElement('input');
      el.type = 'checkbox'; el.checked = on; el.className = 'mid';
      el.disabled = !set;
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
      el.disabled = !r || !set;
      el.addEventListener('change', k === 'tricks' ? sendWon
        : () => numbers(k, p, el.value.trim() === '' ? null : Number(el.value)));
      return el;
    };

    // A stand-in photo is invented data, so only a dev server takes it. The
    // cell stays, empty, or every row after it would slide up a column.
    const pbtns = document.createElement('span');
    pbtns.className = 'pbtns';
    if (DEVSRV && set) {
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

    /* Taking a player out of a live game. Mid-game the seat cannot simply go:
       the rounds already played are that player's, and the scorecard is a
       column for it. So the seat stays and is marked gone, the table plays its
       hand from there on, and the phone that holds it can be given it back --
       which is why this is a pair and not a one-way kick. Removing a seat
       outright is the lobby's business, and the table host's. */
    const gone = document.createElement(set ? 'button' : 'span');
    if (set) {
      gone.type = 'button';
      gone.className = 'btn tiny' + (s.left ? ' primary' : '');
      gone.title = s.left
        ? 'Give the seat back to whoever holds its phone'
        : 'Mark the seat gone. The table plays its hand, and the scorecard keeps its column.';
      gone.addEventListener('click', () =>
        act('patch', { patch: { seat: { i: p, left: !s.left } } }));
      gone.textContent = s.left ? 'Take back' : 'Hand over';
    } else {
      gone.textContent = s.left ? 'the table played this hand' : '';
    }

    row.append(name, host, dealer, check(!!s.bot, 'bot'),
               num('bids', r && r.bids ? r.bids[p] : null),
               num('tricks', r && r.tricks ? r.tricks[p] : null),
               pbtns, gone);
    box.appendChild(row);
  });
}

/* ---------- render ---------- */

/* The whole page, for whichever of the three it is on. One place decides what
   is on show, so no message has to remember the mode it arrived in. */
function paint() {
  applyGates();
  renderWays();
  if (choosing()) return;
  if (replaying()) renderReplay();
  else {
    if (stateNow() && DEVSRV) renderScrub();   // a card only a dev server can fill
    renderRun();
  }
  renderFrames();
  renderPlayers();
  renderHead();
}

// Where the page is, at the head of it.
function renderHead() {
  const S = stateNow();
  if (replaying()) {
    $('#code').textContent = REPLAY.of || '····';
    $('#phase').textContent = S && S.rounds.length
      ? `${S.phase} · round ${Math.min(S.idx + 1, S.rounds.length)}/${S.rounds.length}`
      : 'replay';
    $('#subtitle').textContent =
      `watching table ${REPLAY.of} again · point ${REPLAY.at + 1} of ${REPLAY.n}`;
    return;
  }
  if (!S) return;
  const n = S.seats.length;
  $('#code').textContent = S.code;
  $('#phase').textContent = S.phase +
    (S.rounds.length ? ` · round ${Math.min(S.idx + 1, S.rounds.length)}/${S.rounds.length}` : '');
  $('#subtitle').textContent = `${LIVE ? 'live ' : ''}table ${S.code} · ${n} players · ${S.phase}`;
}

/* ---------- wiring ---------- */

/* What is on show follows two things: which of the three the page is on, and
   what the server will take at all.

   A control that draws itself and then answers a refusal teaches the limits
   one click at a time; the page knows them from the hello, so it shows what
   works and nothing else. On a normal server that leaves the two that put a
   game right -- the players panel, and the record. */
function applyGates() {
  const el = (s) => $(s);
  const ways = choosing(), going = replaying();
  const live = LIVE && !ways && !going;
  document.body.classList.toggle('livemode', live);
  if (el('#live-note')) el('#live-note').hidden = !live;
  if (el('#band')) el('#band').hidden = ways;
  /* One way back to the question, whatever is open. On a copy it is the only
     way to stop watching, so it says so rather than leaving it to a symbol. */
  if (el('#btn-ways')) {
    el('#btn-ways').textContent = going ? '⌂ Stop watching' : '⌂';
    el('#btn-ways').title = going
      ? 'Let the copy go, and ask again' : 'Leave this table, and ask again';
  }
  if (el('#ways')) el('#ways').hidden = !ways;
  // The three panels below the band have nothing to say until something is on.
  if (ways) {
    ['#players-panel', '#state-panel', '#host-frame', '#seat-frames'].forEach((sel) => {
      if (el(sel)) el(sel).hidden = true;
    });
  } else if (el('#host-frame')) {
    el('#host-frame').hidden = false;
    el('#seat-frames').hidden = false;
  }
  // A table's controls, and a replay's, in the same places.
  ['#tables-tools', '#shots-dev', '#shots-sep'].forEach((sel) => {
    if (el(sel)) el(sel).hidden = !DEVSRV || going;
  });
  ['#games-tools', '#replay-run', '#steps-row'].forEach((sel) => {
    if (el(sel)) el(sel).hidden = !going;
  });
  // The scrubber is the rounds either way; only a table is sent to one.
  if (el('#scrub-tools')) el('#scrub-tools').hidden = !going && !DEVSRV;
  if (el('#goto-phase')) el('#goto-phase').hidden = going;
  if (el('#run-tools') && going) el('#run-tools').hidden = true;
  // A copy is read, never written, so there is nothing to apply to it.
  if (el('#btn-state-apply')) el('#btn-state-apply').hidden = going;
  if (el('#ph-photo')) el('#ph-photo').textContent = DEVSRV && !going ? 'photo' : '';
}

document.addEventListener('DOMContentLoaded', () => {
  buildPhaseRow();
  paint();
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
    if (!panel.hidden) renderPlayers();
  });

  /* Pause is the table's own message, not a dev action: this page holds the
     host token, so it says it the way the host screen does. Step is the dev
     page's own, and a dev server's alone. */
  $('#btn-pause').addEventListener('click', () =>
    send({ t: 'pause', on: !$('#btn-pause')._now }));
  $('#btn-step').addEventListener('click', () => act('step'));

  /* The transport, where Pause and Step are on a table. A copy is moved about
     in by hand or played back at the pace the table played it; either way it
     is the trail being read, so nothing here can change what happened. */
  $('#btn-back').addEventListener('click', () => replayAsk({ do: 'step', by: -1 }));
  $('#btn-fwd').addEventListener('click', () => replayAsk({ do: 'step', by: 1 }));
  $('#btn-play').addEventListener('click', () =>
    replayAsk({ do: $('#btn-play')._now ? 'pause' : 'play' }));
  // Back to the question. Whatever is open here is let go on the way.
  $('#btn-ways').addEventListener('click', () => toWays(''));

  // Another table the size of the one on show, so the count is asked for once.
  $('#btn-rebuild').addEventListener('click', () =>
    newTable(ST && ST.seats.length ? ST.seats.length : NEW_N));
  $('#btn-tables').addEventListener('click', askTables);

  $('#scale').addEventListener('change', () => { topKey = seatKey = ''; renderFrames(); });

  connect();
  watchFiles();
});
