'use strict';

const $ = (s) => document.querySelector(s);

/* theme, shared with the offline app */
document.addEventListener('DOMContentLoaded', () => {
  UI.wireFullscreen('#btn-full');
  UI.wireTheme('#btn-theme');
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

  const s = Net.session();
  if (s && s.code) {
    $('#rejoin-panel').hidden = false;
    $('#rejoin-text').textContent = s.role === 'host'
      ? `You are the host of table ${s.code}.`
      : `You have a seat at table ${s.code}.`;
    $('#btn-rejoin').addEventListener('click', () => {
      location.href = s.role === 'host' ? 'host.html' : 'play.html';
    });
    $('#btn-forget').addEventListener('click', () => {
      Net.setSession(null);
      $('#rejoin-panel').hidden = true;
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

  $('#btn-join').addEventListener('click', () => {
    const c = $('#in-code').value.trim();
    const name = $('#in-name').value.trim();
    if (c.length !== 4) return err('Type the 4-character table code.');
    if (!name) return err('Type your name.');
    err('');
    $('#btn-join').disabled = true;
    Net.connect({
      onOpen: () => Net.send({ t: 'join', code: c, name }),
      onHello: () => { location.href = 'play.html'; },
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
    $('#btn-new-table').disabled = true;
    $('#btn-join').disabled = true;
    let stage = 'create';
    Net.connect({
      onOpen: () => Net.send({ t: 'create' }),
      onHello: (m) => {
        if (stage === 'create') { stage = 'join'; Net.send({ t: 'join', code: m.code, name }); }
        else location.href = 'play.html';
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
