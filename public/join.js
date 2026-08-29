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
  // This page is being read on the phone that serves it.
  const mineToRun = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname);

  /* The phone that runs the server reads this page from 127.0.0.1. That phone
     already chose to host, so it wants a table of its own first. Every other
     browser came to join one that exists. Same page, two orders. */
  if (mineToRun) {
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
  if (UI.inApp() && mineToRun) {
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

  /* Every table this phone is running, asked of the server itself. The list
     above is what this browser remembers; this is what is actually there, and
     the two are not the same: a table started from a TV screen on this server,
     or one whose seat this browser has forgotten, is on the server and in no
     browser. Answered to this machine alone -- a table code is a door key.

     A seat this browser holds is offered above, under Rejoin. What is left is
     watched: the same screen a TV shows, which changes nothing at the table. */
  if (mineToRun) {
    const held = new Set(Net.tables().map((t) => String(t.code || '').toUpperCase()));
    fetch('/tables.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { tables: [] }))
      .then((j) => {
        const others = (j.tables || []).filter((t) => t.code && !held.has(t.code));
        if (!others.length) return;
        const box = $('#server-list');
        others.forEach((t) => box.appendChild(tableRow(t)));
        $('#server-panel').hidden = false;
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
    const badge = document.createElement('span');
    badge.className = 'badge soft';
    badge.textContent = t.phase === 'lobby' ? 'in the lobby'
      : t.phase === 'done' ? 'over'
      : t.round ? `round ${t.round} of ${t.rounds}` : 'in play';
    const who = document.createElement('small');
    who.className = 'hint';
    who.textContent = t.seats.length
      ? t.seats.map((s) => s.name).join(', ')
      : 'nobody has sat down';
    const go = document.createElement('button');
    go.className = 'btn';
    go.type = 'button';
    go.textContent = 'Watch';
    go.addEventListener('click', () => {
      location.href = 'host.html?c=' + encodeURIComponent(t.code);
    });
    row.append(nm, badge, who, go);
    return row;
  }

  /* The camera reads the QR code the table shows. The button is here only if
     this browser has both a camera and a reader for the code. */
  if (Scan.can()) {
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
