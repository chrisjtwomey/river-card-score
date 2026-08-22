'use strict';
/* Tiny WebSocket client: one connection, auto-reconnect, saved session. */
const Net = (function () {
  const KEY = 'rcs:session:v1';
  let ws = null, handlers = {}, backoff = 700, queue = [];

  function session() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function setSession(s) {
    try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch (e) {}
  }

  function connect(h) {
    if (h) handlers = h;
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    ws = new WebSocket(proto + location.host + '/ws');

    ws.onopen = () => {
      backoff = 700;
      if (handlers.onUp) handlers.onUp();
      if (handlers.onOpen) handlers.onOpen();       // sends create / join / resume
      queue.splice(0).forEach((o) => ws.send(JSON.stringify(o)));
    };

    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.t === 'hello') {
        setSession({ code: m.code, token: m.token, role: m.role, seatId: m.seatId || null });
        handlers.onHello && handlers.onHello(m);
      } else if (m.t === 'state') { handlers.onState && handlers.onState(m); }
      else if (m.t === 'error') { handlers.onError && handlers.onError(m.msg); }
      else if (m.t === 'kicked') { setSession(null); handlers.onKicked && handlers.onKicked(); }
    };

    ws.onclose = () => {
      if (handlers.onDown) handlers.onDown();
      backoff = Math.min(Math.round(backoff * 1.6), 5000);
      setTimeout(() => connect(), backoff);
    };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }

  function send(o) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
    else queue.push(o);
  }

  return { connect, send, session, setSession };
})();
