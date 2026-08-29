'use strict';

const $ = (s) => document.querySelector(s);

/* The ⚙ settings page, the same one every page has. Here it also holds who
   you are: the name and the photo go with whichever table you do next. */
document.addEventListener('DOMContentLoaded', () => {
  const settings = Settings.wire('#btn-settings', { items: UI.commonSettings(), who: {
    name: () => Net.name(),
    photo: () => Avatar.saved(),
    onName: (n) => { Net.setName(n); showWho(); },
    /* The picture is picked here but sent from the player page: this page
       walks away the moment the seat exists, and a socket closing mid-send
       would lose it. The phone keeps the copy, and the player page hands it
       over. */
    onPhoto: (d) => { Avatar.remember(d); showWho(); },
  } });
  // The line that says who this phone plays as.
  function showWho() {
    $('#who-name').textContent = Net.name() || '…';
    const pic = Avatar.saved();
    const shot = $('#who-shot');
    shot.style.backgroundImage = pic ? `url("${pic}")` : '';
    shot.classList.toggle('has', !!pic);
  }
  showWho();
  $('#btn-who').addEventListener('click', () => settings.open());
  /* The phone that runs the server reads this page from 127.0.0.1. That phone
     already chose to host, so it wants a table of its own first. Every other
     browser came to join one that exists. Same page, two orders. */
  if (UI.servedHere()) {
    const mine = $('#new-panel');
    mine.parentNode.insertBefore(mine, $('#join-panel'));
    $('.brand .sub').textContent = 'Your table';
    // and the one green button is the one this phone came for
    $('#btn-new-table').classList.add('primary');
    $('#btn-join').classList.remove('primary');
  }

  /* In the Android app this page is what Host opens, so it is also the way to
     put the table down again. Only on the phone that runs it: another phone's
     table is not this one's to stop. The app is asked by following a link
     only it knows, and it comes back to its Host-or-Join screen. */
  if (UI.inApp() && UI.servedHere()) {
    $('#app-row').hidden = false;
    $('#btn-stop-host').addEventListener('click', () => {
      UI.ask('Stop hosting the table?',
        'The server on this phone stops and every phone at the table is put off it. '
        + 'The table itself is kept, and comes back the next time you host.',
        'Stop the table', true).then((yes) => {
          if (yes) location.href = 'uptheriver://stop';
        });
    });
  }

  const code = new URLSearchParams(location.search).get('code');
  if (code) $('#in-code').value = code.toUpperCase().slice(0, 4);

  /* The name this phone plays under is asked for once, before anything else:
     a phone that has not said who it is sees the ask and nothing behind it.
     Coming back to join another table, the name is already there. */
  if (!Net.name()) settings.open({ first: true });

  /* Every table this browser holds a seat at, newest first. There used to be
     room for one, so a second table wrote over the first and the seat at it
     was gone with no way back. */
  const held = Net.tables();
  const panel = $('#rejoin-panel');
  if (held.length) {
    panel.hidden = false;
    $('#rejoin-title').textContent = held.length > 1 ? 'Tables you are at' : 'You are in a game';
    const list = $('#rejoin-list');
    held.forEach((t) => {
      const screen = t.role === 'host' || t.role === 'screen';
      const row = document.createElement('div');
      row.className = 'seat-item';
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = `Table ${t.code}`;
      const badge = document.createElement('span');
      badge.className = 'badge soft';
      badge.textContent = t.role === 'host' ? 'TV screen' : t.role === 'screen' ? 'TV screen, show only' : 'your seat';
      const go = document.createElement('button');
      go.className = 'btn primary';
      go.type = 'button';
      go.textContent = screen ? 'Show this table' : 'Rejoin';
      go.addEventListener('click', () => {
        location.href = (screen ? 'host.html?c=' : 'play.html?c=') + encodeURIComponent(t.code);
      });
      const drop = document.createElement('button');
      drop.className = 'mini x';
      drop.type = 'button';
      drop.title = `Forget table ${t.code}`;
      drop.textContent = '×';
      drop.addEventListener('click', () => {
        Net.forget(t.code);
        row.remove();
        if (!list.children.length) panel.hidden = true;
      });
      row.append(nm, badge, go, drop);
      list.appendChild(row);
    });
  }

  /* A code typed here reaches this server and no other, and every table on it
     is listed above with a way in -- so on the machine that runs the server
     there is nothing for this panel to do. Joining somebody else's table from
     here would mean running a server for a game played on another phone; the
     app's own chooser opens their address without starting one. */
  const runsIt = UI.servedHere();
  if (runsIt) $('#join-panel').hidden = true;

  /* Every table this phone is running, asked of the server itself. The list
     above is what this browser remembers; this is what is actually there, and
     the two are not the same: a table started from a TV screen on this server,
     or one whose seat this browser has forgotten, is on the server and in no
     browser. Answered to this machine alone -- a table code is a door key.

     A seat this browser holds is offered above, under Rejoin. What is left is
     watched: the same screen a TV shows, which changes nothing at the table. */
  if (UI.servedHere()) {
    const held = new Set(Net.tables().map((t) => String(t.code || '').toUpperCase()));
    fetch('/tables.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { tables: [] }))
      .then((j) => {
        const others = (j.tables || []).filter((t) => t.code && !held.has(t.code));
        if (!others.length) return;
        const box = $('#server-list');
        others.forEach((t) => box.appendChild(tableRow(t)));
        $('#server-panel').hidden = false;
        fitEveryRow();                        // on the page now, so it can be measured
      })
      .catch(() => {});                       // no listing, no panel: the code box is still there
  }

  // One table the server is running, and the way in to it.
  function tableRow(t) {
    const row = document.createElement('div');
    row.className = 'seat-item';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = `Table ${t.code}`;
    /* What the table is doing, at a glance: a game in play turns, a table
       waiting for people breathes, a game that is over is still. */
    const mark = document.createElement('span');
    const state = t.phase === 'lobby' ? 'open' : t.phase === 'done' ? 'over' : 'play';
    mark.className = 'tmark ' + state;
    mark.title = state === 'play' ? 'a game in play' : state === 'open' ? 'waiting for players' : 'the game is over';
    const badge = document.createElement('span');
    badge.className = 'badge soft';
    badge.textContent = t.phase === 'lobby' ? 'in the lobby'
      : t.phase === 'done' ? 'over'
      : t.round ? `round ${t.round} of ${t.rounds}` : 'in play';
    const who = document.createElement('small');
    who.className = 'hint';
    who._names = t.seats.map((s) => s.name);
    who.textContent = who._names.length ? who._names.join(', ') : 'nobody has sat down';
    const go = document.createElement('button');
    go.className = 'btn';
    go.type = 'button';
    go.textContent = 'Watch';
    go.addEventListener('click', () => {
      location.href = 'host.html?c=' + encodeURIComponent(t.code);
    });
    /* The way in, when there is one. A table still in the lobby has a seat for
       anybody; a game already going has one only for the player it belongs to,
       and this phone knows the name it plays under. Neither is a code to type:
       the table is right here. */
    const mine = t.seats.find((s) => !s.bot && !s.left && !s.online
      && s.name.toLowerCase() === (Net.name() || '\u0000').toLowerCase());
    const room = t.phase === 'lobby' && t.seats.length < 8;
    let sit = null;
    if (room || mine) {
      sit = document.createElement('button');
      sit.className = 'btn primary';
      sit.type = 'button';
      sit.textContent = room ? 'Take a seat' : 'Take my seat';
      sit.addEventListener('click', () => { sit.disabled = true; takeSeat(t.code, sit); });
    }
    /* The table is this phone's to take away: it runs it. Nothing else can --
       a table has no other end but the hours running out. */
    const drop = document.createElement('button');
    drop.className = 'mini x';
    drop.type = 'button';
    drop.title = `End table ${t.code}`;
    drop.textContent = '×';
    drop.addEventListener('click', () => {
      UI.ask(`End table ${t.code}?`,
        'Every phone at it is put off, and the game is not kept: nothing is scored and '
        + 'nothing goes to Past games. The table cannot be started again.',
        'End the table', true).then((yes) => {
          if (!yes) return;
          endTable(t.code).then(() => {
            row.remove();
            if (!$('#server-list').children.length) $('#server-panel').hidden = true;
          });
        });
    });
    /* Two lines, always the same two: what the table is on the first, what
       can be done with it on the second. One line that wrapped when it ran out
       of room put the buttons in a different place on every row. */
    const head = document.createElement('div');
    head.className = 'trow-head';
    head.append(nm, mark, badge);            // the badge is the end of the line
    const acts = document.createElement('div');
    acts.className = 'trow-acts';
    if (sit) acts.appendChild(sit);
    acts.append(go, drop);
    row.append(head, acts, who);
    return row;
  }

  /* The names, on one line. A table of eight ran onto a second line and
     pushed everything under it down the page, so what will not fit is counted
     instead: the names that do, then "and 3 more". Measured rather than
     guessed at -- a name is as long as it is and a phone is as wide as it is --
     which is why it is done once the row is on the page and again when the
     page changes width. */
  function fitNames(el) {
    const names = el._names || [];
    if (names.length < 2) return;
    el.textContent = names.join(', ');
    for (let keep = names.length - 1; keep >= 1 && el.scrollWidth > el.clientWidth; keep--) {
      el.textContent = names.slice(0, keep).join(', ') + ' and ' + (names.length - keep) + ' more';
    }
  }
  function fitEveryRow() {
    const box = $('#server-list');
    if (box) box.querySelectorAll('small').forEach(fitNames);
  }
  window.addEventListener('resize', fitEveryRow);

  /* Sitting down at a table this phone is running. The same message the code
     box sends -- the table is named instead of typed, and the name is the one
     this phone plays under, which is also how a seat in a game already going
     is given back to the phone that holds it. */
  function takeSeat(code, btn) {
    const name = Net.name();
    if (!name) { btn.disabled = false; settings.open({ first: true }); return; }
    Net.connect({
      onOpen: () => Net.send({ t: 'join', code, name }),
      onHello: (m) => { location.href = 'play.html?c=' + encodeURIComponent(m.code); },
      onError: (msg) => { btn.disabled = false; UI.fx.toast(msg, { err: true, ms: 4000 }); },
    });
  }

  // Asked of the server, which is this phone. POST: never a link to wander into.
  function endTable(code) {
    return fetch('/table/end?c=' + encodeURIComponent(code), { method: 'POST' })
      .catch(() => {});
  }

  /* The camera reads the QR code the table shows. The button is here only if
     this browser has both a camera and a reader for the code. */
  if (!runsIt && Scan.can()) {
    const scan = $('#btn-scan');
    scan.hidden = false;
    scan.addEventListener('click', () => {
      err('');
      Scan.read().then((text) => {
        if (text === null) return;                 // closed without a read
        const found = Scan.readAddress(text);
        if (!found) return err('That code is not a table.');
        // A table on another machine: go to it, with the code already filled.
        if (found.url) { location.href = found.url; return; }
        $('#in-code').value = found.code;
      });
    });
  }

  $('#in-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  });

  const err = (msg) => { $('#join-err').textContent = msg; $('#join-err').hidden = !msg; };
  // News, not a fault: it is not written in red.
  const note = (msg) => { $('#join-note').textContent = msg; $('#join-note').hidden = !msg; };

  /* Sent back here by a table that is not there any more. Without this the
     player taps Rejoin and lands on this page with nothing said. */
  const gone = new URLSearchParams(location.search).get('gone');
  if (gone) {
    Net.forget(gone);
    note(`Table ${gone.toUpperCase().slice(0, 4)} is over. Join another, or start one.`);
  }

  $('#btn-join').addEventListener('click', () => {
    const c = $('#in-code').value.trim();
    const name = Net.name();
    if (c.length !== 4) return err('Type the 4-character table code.');
    if (!name) return settings.open({ first: true });
    err('');
    $('#btn-join').disabled = true;
    Net.connect({
      onOpen: () => Net.send({ t: 'join', code: c, name }),
      onHello: (m) => { location.href = 'play.html?c=' + encodeURIComponent(m.code); },
      onError: (m) => { err(m); $('#btn-join').disabled = false; },
    });
  });

  $('#in-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-join').click(); });

  /* Start a table and take the first seat, in one tap. The socket makes the
     room, then joins it, so this phone ends up as a player who runs the table. */
  const newErr = (msg) => { $('#new-err').textContent = msg; $('#new-err').hidden = !msg; };

  $('#btn-new-table').addEventListener('click', () => {
    const name = Net.name();
    if (!name) return settings.open({ first: true });
    newErr('');
    $('#btn-new-table').disabled = true;
    $('#btn-join').disabled = true;
    let stage = 'create';
    Net.connect({
      onOpen: () => Net.send({ t: 'create' }),
      onHello: (m) => {
        if (stage === 'create') { stage = 'join'; Net.send({ t: 'join', code: m.code, name }); }
        else location.href = 'play.html?c=' + encodeURIComponent(m.code);
      },
      onError: (msg) => {
        newErr(msg);
        $('#btn-new-table').disabled = false;
        $('#btn-join').disabled = false;
      },
    });
  });

});
