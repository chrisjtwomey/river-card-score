'use strict';

const $ = (s) => document.querySelector(s);

/* theme, shared with the offline app */
const KEY_THEME = 'river-card-score:theme:v1';
(function initTheme() {
  let t = null;
  try { t = localStorage.getItem(KEY_THEME); } catch (e) {}
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  document.addEventListener('DOMContentLoaded', () => {
    $('#btn-theme').addEventListener('click', () => {
      const now = document.documentElement.getAttribute('data-theme');
      const next = now === 'dark' ? 'light' : now === 'light' ? null : 'dark';
      if (next) document.documentElement.setAttribute('data-theme', next);
      else document.documentElement.removeAttribute('data-theme');
      try { next ? localStorage.setItem(KEY_THEME, next) : localStorage.removeItem(KEY_THEME); } catch (e) {}
    });
  });
})();

document.addEventListener('DOMContentLoaded', () => {
  UI.wireFullscreen('#btn-full');
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

  $('#in-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
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
});
