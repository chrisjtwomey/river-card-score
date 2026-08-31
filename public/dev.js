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
let TOOLS = true;                // the two tables beside the screens are on show
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
      // The record landed, so read back what the table became. Otherwise this
      // is a table arriving, and the box beside it starts empty.
      if (stateBusy) { stateBusy = false; askState(); }
      else if (!stateLoaded) askState();
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
      if ((REPLAY && REPLAY.code) !== was) { seatKey = topKey = ''; stateLoaded = false; }
      writeHash();
      paint();
      // A record applied to a copy is answered by the copy, not by a hello,
      // so this is where the panel reads back what the copy became. Otherwise
      // this is a copy arriving, and the box beside it starts empty.
      if (stateBusy) { stateBusy = false; askState(); }
      else if (replaying() && !stateLoaded) askState();
    } else if (m.t === 'replayAt') {
      /* A copy playing itself, saying where it has got to. Only the place and
         the table move: the rounds and the points of the round are the trail,
         and it is being read, not written. A word about a copy this page has
         let go is not this page's business. */
      if (REPLAY && REPLAY.code === m.code) {
        REPLAY.at = m.at;
        REPLAY.playing = m.playing;
        REPLAY.rate = m.rate;
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
/* The two forcing controls, which are the only dev actions a copy takes: the
   record, and the players panel. On a copy they act on the copy -- the page
   has no table when it is watching one -- so the flag goes on here rather than
   at each of the fifteen places a control sends. Every other action is asked
   before there is a copy, or is not a copy's at all. */
const FORCES = ['patch', 'state'];
const act = (action, extra) => send(Object.assign(
  { t: 'dev', action },
  (replaying() && FORCES.includes(action)) ? { replay: true } : null,
  extra || {}));
const err = (msg) => { $('#dev-err').textContent = msg; $('#dev-err').hidden = !msg; };
// The panel's own line, beside the button that earned it.
const stateErr = (msg) => { $('#state-err').textContent = msg; $('#state-err').hidden = !msg; };
const stateStale = (on) => { if ($('#state-stale')) $('#state-stale').hidden = !on; };
// Reading is asked for in one place, so a change arriving in the meantime is
// the answer coming, not the table moving under the text.
const askState = () => {
  if (!CODE && !replaying()) return;      // nothing open to read a record off
  stateReading = true;
  act('state');
};

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

/* Seats whose phone the page has shut. Presence is not a flag on the table --
   `markPresence` works it out again from the live sockets on every broadcast,
   so a forced one would be wiped by the next thing that happened. A phone goes
   quiet by its socket going away, which here means its pane not being drawn.
   Then the table decides on its own that nobody is behind that seat, and every
   away path lights up: bidding for them, playing for them, the peek, the
   toasts, and the clock that gives up on a seat. */
const PHONE_OFF = new Set();
const phoneOff = (id) => PHONE_OFF.has(id);
function setPhone(id, on) {
  if (on) PHONE_OFF.delete(id); else PHONE_OFF.add(id);
  seatKey = '';                      // the panes are a different set now
  renderFrames();
  renderPlayers();                   // and the row says which way the switch is
}

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
  /* The phones with a socket to hold. One whose phone has been shut is not
     drawn -- that is the whole of how a seat goes quiet here -- and the table
     host is no exception: it is a seat like any other with the pane in a fixed
     place, not a pane that must always be there. */
  const list = (replaying() ? REPLAY.seats : SEATS).filter((s) => !phoneOff(s.id));
  const first = (!replaying() && cap && !phoneOff(cap.id)) ? cap : null;
  const phones = first ? [first].concat(list.filter((s) => s.id !== first.id)) : list;
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
  UI.fadeStrip(box);
}

/* ---------- the scrubber ---------- */

const fadeStrips = () => { UI.fadeStrip($('#scrub')); UI.fadeStrip($('#tablelist')); };

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
    cell(String(i + 1), Viewer.cardsSaid(r.cards), (here ? 'on ' : '') + (i < played ? 'played' : ''),
         () => act('goto', { round: i + 1, phase: gotoPhase() }));
  });
  cell('🏁', 'end', ST.phase === 'done' ? 'on' : '', () => act('endGame'));
  UI.fadeStrip(box);
  UI.showCell(box, box.querySelector('.scell.on'));
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

/* All of it is the replay viewer's: the list of what there is to watch, the
   rounds of the one being watched, the transport and the points of the round on
   show. This page only says where each of those goes and how a word gets back
   to the copy. */
const replayAsk = (o) => send(Object.assign({ t: 'replay' }, o));
const watching = { send: replayAsk };

function renderReplay() {
  if (!replaying()) return;
  Viewer.rounds($('#replay-rounds'), REPLAY, watching);
  Viewer.run($('#replay-transport'), REPLAY, watching);
  Viewer.points($('#replay-points'), REPLAY, watching);
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
  Viewer.games(list, WAYS, watching);
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

/* What the round is, above the seats: the things that belong to the hand
   rather than to any one player. Built once; which rows are on show follows
   the table, because a rule that does not apply should not be offered. */
const SUITS = [['S', '\u2660'], ['H', '\u2665'], ['D', '\u2666'], ['C', '\u2663'], ['NT', 'NT']];

function buildPhaseRow() {
  const box = $('#phase-row');
  if (!box || box._wired) return;
  box._wired = true;
  const line = (cls, label) => {
    const row = document.createElement('div');
    row.className = 'pline ' + cls;
    const lbl = document.createElement('span');
    lbl.className = 'bandlbl';
    lbl.textContent = label;
    row.appendChild(lbl);
    box.appendChild(row);
    return row;
  };
  const seg = (row, items, fire, title) => {
    const s = document.createElement('div');
    s.className = 'seg';
    items.forEach(([v, text]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.dataset.v = String(v);
      b.textContent = text;
      if (title) b.title = title(v);
      b.addEventListener('click', () => fire(v));
      s.appendChild(b);
    });
    row.appendChild(s);
    return s;
  };

  const at = document.createElement('span');
  at.className = 'pround';
  box.appendChild(at);

  // The phase, forced. The one thing a round's own numbers cannot unstick.
  seg(line('pphase', 'Phase'), PHASES.map((p) => [p, p]),
      (p) => act('patch', { patch: { phase: p } }),
      (p) => `Force the game to ${p}. Nothing is played or invented.`);

  /* The trump for this round. Only where the table turns one: with real cards
     the deck on the table decides everything about trumps, and the page has no
     business pretending otherwise. */
  const tr = line('ptrump', 'Trump');
  seg(tr, SUITS.concat([['', 'none']]),
      (v) => act('patch', { patch: { round: { i: roundIdx(), trump: v || null } } }),
      (v) => (v ? `The round is played in ${v}` : 'The round is played at no trumps'));

  /* How many times this round has been thrown in. Every screen keys its deal
     on `idx:redeals`, so winding it on is how a fresh deal is made to land. */
  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'btn tiny';
  again.textContent = 'Deal again';
  again.title = 'Wind the redeal count on. Every screen keys its deal scene on '
    + 'round:redeals, so this is what makes a fresh deal land without a bum deal vote.';
  again.addEventListener('click', () => act('patch',
    { patch: { round: { i: roundIdx(), redeals: (curRound() ? curRound().redeals || 0 : 0) + 1 } } }));
  tr.appendChild(again);

  /* Who took the trick on the table. Real cards only -- where the cards are
     dealt they count themselves, and the tool for a hand there is Play for. */
  const tk = line('ptrick', 'Trick');
  tk._seats = document.createElement('div');
  tk._seats.className = 'seg';
  tk.appendChild(tk._seats);
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'btn tiny';
  undo.textContent = '\u21a9 Take back';
  undo.title = 'The last trick counted, taken back off whoever got it';
  undo.addEventListener('click', () => send({ t: 'trickback' }));
  tk.appendChild(undo);

  // A bum-deal vote, opened and cancelled: the two halves a table has.
  const vt = line('pvote', 'Vote');
  const ask = document.createElement('button');
  ask.type = 'button';
  ask.className = 'btn tiny';
  ask.textContent = 'Bum deal vote';
  ask.title = 'Open a bum-deal vote, asked by somebody who is neither dealer nor host';
  ask.addEventListener('click', () => act('bumVote'));
  const drop = document.createElement('button');
  drop.type = 'button';
  drop.className = 'btn tiny';
  drop.textContent = 'Cancel';
  drop.title = 'Take the vote away, as the table host may';
  drop.addEventListener('click', () => send({ t: 'votecancel' }));
  vt.append(ask, drop);
  vt._said = document.createElement('span');
  vt._said.className = 'pstate';
  vt.appendChild(vt._said);
}

// The round the panel is editing, whichever table is on show.
const roundIdx = () => { const S = stateNow(); return S ? S.idx : 0; };
const curRound = () => {
  const S = stateNow();
  return S && S.rounds ? S.rounds[Math.min(S.idx, S.rounds.length - 1)] || null : null;
};

function renderPhaseRow() {
  const box = $('#phase-row');
  const S = stateNow();
  if (!box || !S) return;
  const r = curRound();
  const at = box.querySelector('.pround');
  if (at) {
    at.textContent = r
      ? `Round ${Math.min(S.idx + 1, S.rounds.length)} of ${S.rounds.length} · ${r.cards} cards`
      : 'No round in play';
  }
  const line = (cls) => box.querySelector('.' + cls);
  const mark = (row, v) => {
    if (!row) return;
    const seg = row.querySelector('.seg');
    if (seg) seg.querySelectorAll('.btn').forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
  };
  mark(line('pphase'), S.phase);

  /* The trump is the table's to turn, and only where it turns one. With real
     cards the deck on the table decides everything about trumps, so there is
     nothing here to set and nothing that would mean anything if there were. */
  const tr = line('ptrump');
  if (tr) {
    tr.hidden = !r || !Game.virtual(S);
    mark(tr, r && r.trump ? r.trump : '');
  }

  /* Who took the trick. Where the cards are dealt they count themselves, so
     this is a real-cards row: the tool for a hand on the phones is Play for. */
  const tk = line('ptrick');
  if (tk) {
    tk.hidden = !r || Game.virtual(S) || S.phase !== 'tricks';
    if (!tk.hidden && tk._seats && tk._seats.dataset.key !== S.seats.map((x) => x.name).join('|')) {
      tk._seats.dataset.key = S.seats.map((x) => x.name).join('|');
      tk._seats.innerHTML = '';
      S.seats.forEach((x, p) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn';
        b.textContent = x.name;
        b.title = `Count this trick to ${x.name}`;
        b.addEventListener('click', () => send({ t: 'trick', p }));
        tk._seats.appendChild(b);
      });
    }
  }

  // A vote is the round's, so it goes where the round's things are.
  const vt = line('pvote');
  if (vt) {
    vt.hidden = !r;
    const v = S.vote;
    if (vt._said) {
      vt._said.textContent = !v ? 'none open'
        : `${(S.seats[v.by] || {}).name || 'somebody'} asked · `
          + `${(v.yes || []).length} yes, ${(v.no || []).length} no`;
    }
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
  const S = stateNow();
  if (!box || !S) return;
  const cells = Array.from(box.querySelectorAll('input.won'));
  const vals = cells.map((el) => String(el.value).trim());
  cells.forEach((el, i) => el.classList.toggle('part', wonBad(vals[i])));
  if (vals.length !== S.seats.length || vals.some(wonBad)) return;
  act('patch', { patch: { round: { i: S.idx, tricks: vals.map(Number) } } });
}

/* One row a seat. Every control sends the moment it is used, and the rows
   are rebuilt only while nothing in them is being typed in. */
function renderPlayers() {
  const box = $('#prows');
  const S = stateNow();
  if (!box || !S || !TOOLS || $('#players-panel').hidden) return;
  renderPhaseRow();
  /* A copy is written to as a table is. What the trail says happened stops
     being what the copy is the moment it is changed, and the copy says so --
     the change becomes its last point, and the rest of the trail goes.
     A stand-in photo is invented data and stays a table's alone. */
  const invent = DEVSRV && !replaying();
  const r = S.rounds[Math.min(S.idx, S.rounds.length - 1)] || null;
  const key = S.seats.map((s, p) =>
    `${s.name}/${s.bot}/${s.left}/${s.id === S.captainId}/${r ? r.dealer : S.firstDealerId}` +
    `/${r && r.bids ? r.bids[p] : ''}/${r && r.tricks ? r.tricks[p] : ''}` +
    `/${s.online}/${phoneOff(s.id)}`).join('|') +
    `@${S.idx}:${S.phase}:${invent}:${Game.awaySeat(S)}:${S.play ? S.play.turn : ''}:${!!S.vote}` +
    `:${HAND_OPEN}:${S.play && S.play.hands ? S.play.hands.map((h) => (h || []).join('')).join('/') : ''}`;
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
    name.addEventListener('change', () => act('patch', { patch: { seat: { i: p, name: name.value } } }));

    const radio = (group, on, fire) => {
      const el = document.createElement('input');
      el.type = 'radio'; el.name = group; el.checked = on; el.className = 'mid';
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
    if (invent) {
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

    // What the seat is, in a word. The verbs are the row under this one.
    const how = document.createElement('span');
    how.className = 'pstate';
    const hand = (S.play && S.play.hands && S.play.hands[p]) || null;
    how.textContent = s.left ? 'the table has this hand'
      : s.bot ? 'a bot'
      : phoneOff(s.id) ? 'phone off'
      : s.online ? 'at the table' : 'quiet';
    if (hand) how.textContent += ` \u00b7 ${hand.length} cards`;

    row.append(name, host, dealer, check(!!s.bot, 'bot'),
               num('bids', r && r.bids ? r.bids[p] : null),
               num('tricks', r && r.tricks ? r.tricks[p] : null),
               pbtns, how);

    const seat = document.createElement('div');
    seat.className = 'pseat';
    seat.append(row, seatTools(s, p, S));
    if (HAND_OPEN === s.id && S.play && S.play.hands) seat.appendChild(handEditor(s, p, S));
    box.appendChild(seat);
  });
}

/* The seat whose hand is open for editing, or null. One at a time, because a
   picker is fifty-two buttons and every seat carrying one would be four
   hundred elements redrawn on every state. */
let HAND_OPEN = null;

/* The hand a seat holds, dealt by hand. A deck is fifty-two cards and no card
   is in two places, so the picker is the deck itself: this seat's cards are
   marked, another seat's are shut with a line saying whose, and the rest are
   there to be taken. What is sent is every hand, because moving a card means
   two of them change. */
function handEditor(s, p, S) {
  const box = document.createElement('div');
  box.className = 'phand';
  const hands = (S.play && S.play.hands) || [];
  const mine = new Set(hands[p] || []);
  const whose = new Map();
  hands.forEach((h, q) => (h || []).forEach((c) => { if (q !== p) whose.set(c, q); }));

  Game.SUITS.filter((x) => x.k !== 'NT').forEach((suit) => {
    const line = document.createElement('div');
    line.className = 'phand-row';
    const tag = document.createElement('span');
    tag.className = 'phand-suit' + (suit.red ? ' red' : '');
    tag.textContent = suit.g;
    line.appendChild(tag);
    Game.RANKS.slice().reverse().forEach((rank) => {
      const card = rank + suit.k;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn tiny card' + (mine.has(card) ? ' primary' : '');
      b.textContent = Game.cardFace(card);
      const held = whose.get(card);
      if (held !== undefined) {
        b.disabled = true;
        b.title = `${(S.seats[held] || {}).name || 'another seat'} holds it`;
      } else {
        b.title = mine.has(card) ? `Take ${Game.cardName(card)} off ${s.name}`
                                 : `Give ${Game.cardName(card)} to ${s.name}`;
      }
      b.addEventListener('click', () => {
        const next = new Set(mine);
        if (next.has(card)) next.delete(card); else next.add(card);
        act('patch', { patch: { hands: S.seats.map((x, q) =>
          (q === p ? Game.sortHand(Array.from(next)) : (hands[q] || []).slice())) } });
      });
      line.appendChild(b);
    });
    box.appendChild(line);
  });
  return box;
}

/* What can be done to one seat, as a row of verbs under its values. Each is a
   state a real table reaches on its own; the page only reaches it sooner.

   `phone` is the page's own and nothing is sent: a phone goes quiet by its
   socket going, which here is its pane not being drawn. The rest are the
   table's, and are refused where the table would refuse them. */
function seatTools(s, p, S) {
  const box = document.createElement('div');
  box.className = 'ptools';
  const lobby = S.phase === 'lobby';
  const doing = (what) => act('seatDo', { id: s.id, do: what });
  const add = (label, title, fire, o) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn tiny' + ((o && o.on) ? ' primary' : '');
    b.textContent = label;
    b.title = title;
    b.disabled = !!(o && o.off);
    b.addEventListener('click', fire);
    box.appendChild(b);
    return b;
  };

  /* A copy has nobody behind any of its seats -- its panes are watching
     windows -- so a phone to shut is a table's alone. */
  if (!replaying() && !s.bot) {
    const off = phoneOff(s.id);
    add(off ? 'Phone on' : 'Phone off',
        off ? 'Draw this seat\'s pane again. Its socket comes back and the table sees it.'
            : 'Close this seat\'s pane. Its socket goes, so the table sees nobody behind it.',
        () => setPhone(s.id, off), { on: off });
  }
  add('Leave', lobby
        ? 'What the phone\'s own Leave does in the lobby: the seat goes.'
        : 'What the phone\'s own Leave does mid-game: the seat stays and the table plays its hand.',
      () => doing('leave'));
  // The table's own two, said the way the host screen says them: their guards
  // and their words come with them.
  add('Kick', lobby
        ? 'The seat put out. Only in the lobby: mid-game the scorecard is a column for it.'
        : 'A seat only leaves the table in the lobby.',
      () => send({ t: 'kick', id: s.id }), { off: !lobby });
  add('Time out', 'The idle clock run out on this seat, and whatever the table then does '
      + 'about it. A table of stand-ins is never idle, so this is the only way to it.',
      () => doing('out'));
  add('Rejoin', 'A seat the table took over, given back by name.',
      () => send({ t: 'letback', id: s.id }), { off: !s.left });

  /* Acting for a seat. The table's own two, said the way the host screen says
     them -- so they are offered on exactly the seat the table would take them
     for: the one it is waiting on that nobody is behind. Anywhere else they
     would be a button that earns a refusal. */
  if (!replaying()) {
    const away = Game.awaySeat(S) === p;
    if (S.phase === 'bid' && away) {
      add('Bid for', 'The table bids this hand, reading the cards where it has them.',
          () => send({ t: 'bidfor' }));
    }
    if (S.play && S.play.turn === p && away && Game.virtual(S)) {
      add('Play for', 'The table plays a card for this seat, from the ones the rules allow.',
          () => send({ t: 'playfor' }));
    }
    // This seat's answer to a vote, which no host-side message can say: a vote
    // is answered by the phone it is put to.
    if (S.vote) {
      add('\u2713', `${s.name} agrees to the bum deal`, () => doing('yes'));
      add('\u2717', `${s.name} refuses it, which ends the vote`, () => doing('no'));
    }
    add('\uD83D\uDCAC', `Say something in the talk as ${s.name}`, () => {
      const text = window.prompt(`Say something as ${s.name}`);
      if (text) act('seatDo', { id: s.id, do: 'say', text });
    });
  }
  /* The hand, where there is one to hold and a server that will take it. With
     real cards the hand is on the table, and nothing here knows what is in
     it. */
  if (DEVSRV && !replaying() && Game.virtual(S) && S.play && S.play.hands) {
    const open = HAND_OPEN === s.id;
    add(open ? 'Hand \u25b4' : 'Hand \u25be',
        `The cards ${s.name} holds, dealt by hand`,
        () => { HAND_OPEN = open ? null : s.id; delete $('#prows').dataset.key; renderPlayers(); },
        { on: open });
  }
  return box;
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
    /* A copy that has been changed is no longer the game that was played, and
       saying "watching table X again" over one would be a lie. What is on show
       is a copy that went its own way at the point it is standing on. */
    $('#subtitle').textContent = REPLAY.forked
      ? `table ${REPLAY.of}, changed by hand · point ${REPLAY.at + 1} of ${REPLAY.n}`
      : `watching table ${REPLAY.of} again · point ${REPLAY.at + 1} of ${REPLAY.n}`;
    return;
  }
  if (!S) return;
  const n = S.seats.length;
  $('#code').textContent = S.code;
  $('#phase').textContent = S.phase +
    (S.rounds.length ? ` · round ${Math.min(S.idx + 1, S.rounds.length)}/${S.rounds.length}` : '');
  $('#subtitle').textContent = `${LIVE ? 'live ' : ''}table ${S.code} · ${n} players · ${S.phase}`;
}

/* The half of the page beside the screens. Both tables go with it: they are
   one job -- setting a table up -- and folding one and not the other left the
   column half empty with the screens no wider for it. */
function setTools(on) {
  TOOLS = !!on;
  const wrap = document.querySelector('.devwrap');
  if (wrap) wrap.classList.toggle('notools', !TOOLS);
  const btn = $('#btn-tools');
  if (btn) {
    btn.textContent = TOOLS ? 'Tools ▴' : 'Tools ▾';
    btn.setAttribute('aria-expanded', String(TOOLS));
  }
  if (!TOOLS) return;
  delete $('#prows').dataset.key;
  renderPlayers();
  askState();
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
  /* The two tables are the right half of the page, not panels that are opened
     one at a time: they are up whenever there is something to be up about. */
  ['#players-panel', '#state-panel', '#host-frame', '#seat-frames'].forEach((sel) => {
    if (el(sel)) el(sel).hidden = ways;
  });
  if (el('#panel-toggles')) el('#panel-toggles').hidden = ways;
  // A table's controls, and a replay's, in the same places.
  ['#tables-tools', '#shots-dev', '#shots-sep'].forEach((sel) => {
    if (el(sel)) el(sel).hidden = !DEVSRV || going;
  });
  ['#rounds-tools', '#replay-run', '#steps-row'].forEach((sel) => {
    if (el(sel)) el(sel).hidden = !going;
  });
  // The rounds are a strip either way; a table's is the one you can send to.
  if (el('#scrub-tools')) el('#scrub-tools').hidden = going || !DEVSRV;
  if (el('#run-tools') && going) el('#run-tools').hidden = true;
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

  // The two tables go together: they are one half of the page, not two panels.
  $('#btn-tools').addEventListener('click', () => setTools(!TOOLS));

  /* Pause is the table's own message, not a dev action: this page holds the
     host token, so it says it the way the host screen does. Step is the dev
     page's own, and a dev server's alone. */
  $('#btn-pause').addEventListener('click', () =>
    send({ t: 'pause', on: !$('#btn-pause')._now }));
  $('#btn-step').addEventListener('click', () => act('step'));

  // Back to the question. Whatever is open here is let go on the way.
  $('#btn-ways').addEventListener('click', () => toWays(''));

  // Another table the size of the one on show, so the count is asked for once.
  $('#btn-rebuild').addEventListener('click', () =>
    newTable(ST && ST.seats.length ? ST.seats.length : NEW_N));
  $('#btn-tables').addEventListener('click', askTables);

  $('#scale').addEventListener('change', () => { topKey = seatKey = ''; renderFrames(); });
  // A strip that fits at one width does not at another.
  window.addEventListener('resize', fadeStrips);

  connect();
  watchFiles();
});
