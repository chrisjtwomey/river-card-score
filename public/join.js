'use strict';

const $ = (s) => document.querySelector(s);

/* The ⚙ menu, the same one every page has. */
document.addEventListener('DOMContentLoaded', () => {
  UI.settingsMenu('#btn-settings', UI.commonSettings());
  /* The phone that runs the server reads this page from 127.0.0.1. That phone
     already chose to host, so it wants a table of its own first. Every other
     browser came to join one that exists. Same page, two orders. */
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname)) {
    const mine = $('#new-panel');
    mine.parentNode.insertBefore(mine, $('#join-panel'));
    $('.brand .sub').textContent = 'Your table';
  }

  const code = new URLSearchParams(location.search).get('code');
  if (code) $('#in-code').value = code.toUpperCase().slice(0, 4);

  /* The name this phone plays under is asked for once. Coming back to join
     another table, it is already there. */
  const knownName = Net.name();
  if (knownName) { $('#in-name').value = knownName; $('#new-name').value = knownName; }

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
      go.textContent = screen ? 'Show it' : 'Rejoin';
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
        $('#in-name').focus();
      });
    });
  }

  $('#in-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  });

  /* The picture is picked here but sent from the player page: this page walks
     away the moment the seat exists, and a socket closing mid-send would lose
     it. The phone keeps the copy, and the player page hands it over. */
  let av = Avatar.saved();
  const pickers = ['#join-av', '#new-av'].map((sel) => {
    const pk = Avatar.picker((d) => {
      av = d;
      Avatar.remember(d);
      pickers.forEach((o) => { if (o !== pk) o.show(d); });
    });
    $(sel).appendChild(pk.el);
    pk.show(av);
    return pk;
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
    const name = $('#in-name').value.trim();
    if (c.length !== 4) return err('Type the 4-character table code.');
    if (!name) return err('Type your name.');
    err('');
    Net.setName(name);
    $('#btn-join').disabled = true;
    Net.connect({
      onOpen: () => Net.send({ t: 'join', code: c, name }),
      onHello: (m) => { location.href = 'play.html?c=' + encodeURIComponent(m.code); },
      onError: (m) => { err(m); $('#btn-join').disabled = false; },
    });
  });

  $('#in-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-join').click(); });

  /* Start a table and take the first seat, in one tap. The socket makes the
     room, then joins it, so this phone ends up as a player who runs the table. */
  const newErr = (msg) => { $('#new-err').textContent = msg; $('#new-err').hidden = !msg; };

  $('#btn-new-table').addEventListener('click', () => {
    const name = $('#new-name').value.trim();
    if (!name) return newErr('Type your name.');
    newErr('');
    Net.setName(name);
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

  $('#new-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-new-table').click(); });
});
