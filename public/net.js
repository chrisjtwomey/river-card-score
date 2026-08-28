'use strict';
/* Tiny WebSocket client: one connection, auto-reconnect, saved session. */
const Net = (function () {
  const KEY = 'rcs:session:v1';       // the seat this browser used last
  const NAME = 'rcs:name:v1';         // and the name it plays under
  const LIST = 'rcs:tables:v1';       // every table this browser holds a seat at
  const CAP = 8;
  let ws = null, handlers = {}, backoff = 700, queue = [];
  let mem = null, ephemeral = false;   // a preview keeps its seat in memory only
  let everOpen = false, fails = 0, probing = false;

  const wsUrl = () => (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';

  function banner(html) {
    let el = document.getElementById('netbanner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'netbanner';
      el.className = 'netbanner';
      document.body.appendChild(el);
    }
    el.innerHTML = html;
    el.hidden = false;
  }
  function clearBanner() {
    const el = document.getElementById('netbanner');
    if (el) el.hidden = true;
  }

  // The socket never opened. Say why, instead of retrying in silence.
  async function diagnose() {
    if (probing) return;
    probing = true;
    const url = wsUrl();
    let reachable = false;
    try {
      const r = await fetch('/net.json', { cache: 'no-store' });
      reachable = r.ok;
    } catch (e) { reachable = false; }
    probing = false;

    if (!reachable) {
      banner(`<b>No answer from ${location.host}.</b> The table server is not running there, ` +
        'or something is blocking it. Start it with <code>npm start</code> and reload.');
      return;
    }
    const tips = [
      'A proxy in front of the server must pass the <code>Upgrade</code> and <code>Connection</code> headers, ' +
      'or the WebSocket never gets through.',
    ];
    if (location.protocol === 'https:') {
      tips.push(`If the certificate is self-signed, open <a href="/net.json" target="_blank" rel="noopener">` +
        `${location.origin}/net.json</a> in a tab and accept the warning. Firefox will not ask for a WebSocket, ` +
        'so it fails without a word until the certificate is trusted.');
    }
    banner(`<b>The page loads, but ${url} will not connect.</b><ul><li>` + tips.join('</li><li>') + '</li></ul>');
  }

  /* A browser can hold a seat at more than one table -- a game that ran on,
     a table on the television, a second table started while the first was
     still going. They used to share one slot, so whichever page reconnected
     last wrote its own table over the others and the rest were lost with no
     way back. They are a list now, newest first, and every page names the
     table it belongs to. */
  function tables() {
    if (ephemeral) return mem ? [mem] : [];
    let list = [];
    try { list = JSON.parse(localStorage.getItem(LIST) || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    list = list.filter((x) => x && x.code);
    if (!list.length) {                       // a browser that knew only the one
      const one = current();
      if (one && one.code) list = [one];
    }
    return list;
  }

  /* The name this phone plays under. It is asked for once and kept, so coming
     back to start another table does not mean typing it again. */
  function name() {
    try { return localStorage.getItem(NAME) || ''; } catch (e) { return ''; }
  }
  function setName(v) {
    const n = String(v || '').trim().slice(0, 16);
    try { n ? localStorage.setItem(NAME, n) : localStorage.removeItem(NAME); } catch (e) {}
  }

  function current() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }

  function writeList(list) {
    try { localStorage.setItem(LIST, JSON.stringify(list.slice(0, CAP))); } catch (e) {}
  }

  // The seat at one named table, or the one this browser used last.
  function session(code) {
    if (ephemeral) return mem;
    if (code) {
      const want = String(code).toUpperCase();
      return tables().find((x) => x.code === want) || null;
    }
    return current();
  }

  // memoryOnly keeps the seat in this page only. Several previews of the same
  // table can then run side by side without overwriting each other.
  function setSession(s, memoryOnly) {
    if (memoryOnly) ephemeral = true;
    if (ephemeral) { mem = s; return; }
    if (!s) { const was = current(); if (was && was.code) forget(was.code); return; }
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
    const rest = tables().filter((x) => x.code !== s.code);
    writeList([Object.assign({ at: Date.now() }, s)].concat(rest));
  }

  // This browser is done with that table.
  function forget(code) {
    if (ephemeral) { mem = null; return; }
    const want = String(code || '').toUpperCase();
    writeList(tables().filter((x) => x.code !== want));
    const one = current();
    if (one && one.code === want) { try { localStorage.removeItem(KEY); } catch (e) {} }
  }

  /* The address says which table this page is at, so a second page at a second
     table cannot answer for it. It survives a reload; the shared list does not
     have to be asked. */
  function pin(code) {
    if (ephemeral || !code) return;
    try { history.replaceState(null, '', location.pathname + '?c=' + encodeURIComponent(code)); } catch (e) {}
  }

  function connect(h) {
    if (h) handlers = h;
    ws = new WebSocket(wsUrl());

    ws.onopen = () => {
      backoff = 700;
      everOpen = true; fails = 0;
      clearBanner();
      if (handlers.onUp) handlers.onUp();
      if (handlers.onOpen) handlers.onOpen();       // sends create / join / resume
      queue.splice(0).forEach((o) => ws.send(JSON.stringify(o)));
    };

    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.t === 'hello') {
        setSession({ code: m.code, token: m.token, role: m.role, seatId: m.seatId || null }, ephemeral);
        handlers.onHello && handlers.onHello(m);
      } else if (m.t === 'state') { handlers.onState && handlers.onState(m); }
      else if (m.t === 'error') { handlers.onError && handlers.onError(m.msg); }
      // Left on purpose. The seat is still this browser's to come back to, so
      // the table is remembered; the page just walks away from it.
      else if (m.t === 'left') { handlers.onLeft && handlers.onLeft(m); }
      else if (m.t === 'kicked') { forget(m.code || (current() || {}).code); handlers.onKicked && handlers.onKicked(); }
    };

    ws.onclose = () => {
      if (handlers.onDown) handlers.onDown();
      fails += 1;
      if (!everOpen && fails >= 2) diagnose();
      backoff = Math.min(Math.round(backoff * 1.6), 5000);
      setTimeout(() => connect(), backoff);
    };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }

  function send(o) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
    else queue.push(o);
  }

  /* A link like play.html#c=CODE&t=TOKEN drops a seat into this browser, and
     #w=TOKEN opens the same screen to watch only. It is how the dev page hands
     out seats and how a seat moves to another device: the token is the seat.

     `role` is what a t= token means on this page -- 'player' on a phone,
     'host' on the host screen. A w= token is always watching.

     Inside a frame, and for any watcher, the session is kept in memory only:
     a wall of dev previews must not evict the seat you are playing. */
  function claimFromHash(role) {
    const q = new URLSearchParams((location.hash || '').replace(/^#/, ''));
    const code = (q.get('c') || '').toUpperCase();
    const token = q.get('t') || '';
    const eye = q.get('w') || '';
    if (!code || (!token && !eye)) return false;
    const framed = window.top !== window.self;
    setSession({ code, token: eye || token, role: eye ? 'watch' : (role || 'player'), seatId: null },
      !!eye || framed);
    // The link stays in the address bar for anything held in memory, so the
    // page still knows its seat if it reloads. A seat claimed for keeps drops it.
    if (!eye && !framed) history.replaceState(null, '', location.pathname + location.search);
    return true;
  }

  return { connect, send, session, tables, setSession, forget, pin, claimFromHash, name, setName };
})();
