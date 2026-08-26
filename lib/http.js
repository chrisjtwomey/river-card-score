'use strict';
/* Everything a browser asks for over plain HTTP: the pages, the QR code, the
   addresses this machine answers on, a finished game, a player's picture, and
   the live-reload stream when the server runs with DEV=1.

   It knows nothing about a game in play. What it needs of the rooms -- one
   seat's picture -- it asks for through the handle it is given.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const dgram = require('dgram');
const qrcode = require('qrcode-generator');

module.exports = ({ PORT, SCHEME, DEV, ROOT, PUB, pictureOf, readGame, listGames }) => {
  const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  };

  /* ---------------- addresses and QR ---------------- */

  // Every address a phone can use to reach the table. PUBLIC_URL replaces the
  // detected addresses, it does not add to them: behind a proxy or in a
  // container the detected ones are private and no phone can reach them.
  let hiddenNets = false;                    // the OS would not say what they are
  let probed = '';                           // the address the routing table gave
  let given = [];                            // addresses the platform handed us
  const learned = new Set();                 // addresses players arrived on
  const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

  // When the interface list cannot be had -- Termux is refused it -- the kernel
  // still answers one question: "which of my addresses would you use to reach
  // that host?" A UDP socket is connected -- which sends nothing -- and its
  // local address is the answer. It costs nothing, needs no permission, and is
  // right on any machine that has a route to what it is asked about.
  function probeTo(target) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (addr) => { if (!done) { done = true; try { sock.close(); } catch (e) {} resolve(addr); } };
      let sock;
      try { sock = dgram.createSocket('udp4'); } catch (e) { resolve(''); return; }
      sock.on('error', () => finish(''));
      setTimeout(() => finish(''), 500).unref();
      try {
        sock.connect(9, target, () => {
          let a = '';
          try { a = sock.address().address; } catch (e) {}
          finish(a && a !== '0.0.0.0' ? a : '');
        });
      } catch (e) { finish(''); }
    });
  }

  /* A target off this network answers best: the address the machine would use to
     reach the world is the one a phone on the same Wi-Fi should be told. But a
     phone that IS the hotspot, with no mobile data -- on a plane, say -- has no
     route off the link at all, and nothing out there can be asked. The
     all-hosts group is on this link and needs no route off it. */
  async function probeLanAddress() {
    return (await probeTo('203.0.113.1'))     // TEST-NET-3, never routed
        || (await probeTo('224.0.0.1'));      // all hosts on this link
  }

  /* What the platform says, for when os.networkInterfaces() cannot answer or
     cannot be trusted -- in Termux it throws, and Android has taken away less
     direct ways of asking before now. The app reads its own interfaces in Java,
     tethering included, and leaves them in a file for us; anywhere else,
     LAN_ADDRS says the same thing. Neither replaces what we can see ourselves:
     lanUrls() merges them. */
  function readGivenAddrs() {
    const out = [];
    const add = (s) => { const a = String(s).trim(); if (IPV4.test(a)) out.push(a); };
    (process.env.LAN_ADDRS || '').split(',').forEach(add);
    if (process.env.LAN_ADDRS_FILE) {
      try { fs.readFileSync(process.env.LAN_ADDRS_FILE, 'utf8').split('\n').forEach(add); } catch (e) {}
    }
    given = Array.from(new Set(out));
  }
  readGivenAddrs();

  // Keep it fresh: the address changes when the phone joins another network, or
  // starts sharing one of its own.
  async function refreshLanAddress() {
    readGivenAddrs();
    const a = await probeLanAddress();
    if (a) probed = a;
  }

  /* A player who is here typed or scanned an address that works, and it comes
     in with every request they make. That is worth keeping: on a phone that
     cannot see its own address, it is the only true answer the table will get.

     Only a private address, and only this port. The header is written by the
     client, and anything looser would let a player put an address of their own
     choosing into the host's QR code. */
  const PRIVATE = /^(?:10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
  function learnFrom(header) {
    if (learned.size >= 8) return;                 // a table has few players
    const m = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d+))?$/.exec(String(header || '').trim());
    if (!m) return;
    const port = m[2] ? Number(m[2]) : (SCHEME === 'https' ? 443 : 80);
    if (port !== Number(PORT) || !PRIVATE.test(m[1])) return;
    learned.add(m[1]);
  }

  function lanUrls() {
    const named = (process.env.PUBLIC_URL || '').split(',')
      .map((u) => u.trim().replace(/\/$/, '')).filter(Boolean);
    if (named.length) return Array.from(new Set(named));

    const out = [];
    const push = (a) => { if (a) out.push(`${SCHEME}://${a}:${PORT}`); };
    // Usually the whole answer, and on a phone too. But Termux is refused this
    // outright, so it must not take the server down: an empty list is an
    // answer, and the three other ways of knowing are why it rarely stays one.
    let nets = {};
    try { nets = os.networkInterfaces(); } catch (e) { hiddenNets = true; }
    Object.values(nets).forEach((list) => (list || []).forEach((ni) => {
      if (ni.family === 'IPv4' && !ni.internal) push(ni.address);
    }));
    given.forEach(push);
    push(probed);
    learned.forEach(push);
    return Array.from(new Set(out));
  }

  // White background and black modules whatever the page theme is, or a phone
  // camera will not read it.
  function qrSvg(text, cell, margin) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const size = (n + margin * 2) * cell;
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        d += `M${(c + margin) * cell} ${(r + margin) * cell}h${cell}v${cell}h-${cell}z`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
      `viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="Join code">` +
      `<rect width="100%" height="100%" fill="#ffffff"/><path d="${d}" fill="#000000"/></svg>`;
  }

  /* ---------------- live reload (dev only) ---------------- */

  const liveClients = new Set();

  if (DEV) {
    let timer = null;
    const bump = (what) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        console.log(`[dev] ${what} changed: reloading ${liveClients.size} page(s)`);
        liveClients.forEach((res) => res.write(`event: reload\ndata: ${JSON.stringify(what)}\n\n`));
      }, 150);                                 // editors write more than once
    };
    // A tree can only be watched on some platforms: Linux before Node 20 -- the
    // runtime inside the Android app -- refuses. public/ is flat, so watching it
    // plainly sees every page anyway.
    const watchPages = () => {
      try {
        return fs.watch(PUB, { recursive: true }, (e, f) => { if (f) bump(String(f)); });
      } catch (e) {
        return fs.watch(PUB, (e2, f) => { if (f) bump(String(f)); });
      }
    };
    try {
      watchPages();
      fs.watch(path.join(ROOT, 'game.js'), () => bump('game.js'));
    } catch (e) {
      console.warn('[dev] cannot watch the files:', e.message);
    }
    setInterval(() => liveClients.forEach((res) => res.write(': ping\n\n')), 25000);
  }

  /* ---------------- static files ---------------- */

  function handler(req, res) {
    learnFrom(req.headers && req.headers.host);
    const [rawPath, rawQuery] = (req.url || '/').split('?');
    let url = decodeURIComponent(rawPath);
    const query = new URLSearchParams(rawQuery || '');

    if (url === '/live') {                           // page reload stream, dev only
      if (!DEV) { res.writeHead(404, { 'content-type': 'text/plain' }).end('live reload is off'); return; }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',                   // nginx must not hold it back
      });
      res.write('retry: 1000\n\n');
      liveClients.add(res);
      req.on('close', () => liveClients.delete(res));
      return;
    }

    if (url === '/net.json') {                       // addresses for the host screen
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
      res.end(JSON.stringify({ port: PORT, urls: lanUrls() }));
      return;
    }

    if (url === '/qr.svg') {                         // QR for the join address
      const text = String(query.get('d') || '').slice(0, 300);
      if (!text) { res.writeHead(400).end('missing d'); return; }
      const cell = Math.max(2, Math.min(20, Number(query.get('cell')) || 8));
      try {
        res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-cache' });
        res.end(qrSvg(text, cell, 4));
      } catch (e) {
        res.writeHead(500).end('qr failed');
      }
      return;
    }

    if (url === '/games.json') {                     // what the table has on file
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
      res.end(JSON.stringify({ games: listGames(query.get('code')) }));
      return;
    }

    if (url.startsWith('/game/')) {                  // one finished game, whole
      const rec = readGame(url.slice('/game/'.length).replace(/\.json$/, ''));
      if (!rec) { res.writeHead(404, { 'content-type': 'text/plain' }).end('no such game'); return; }
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=31536000, immutable',   // a finished game never changes
      });
      res.end(JSON.stringify(rec));
      return;
    }

    if (url.startsWith('/avatar/')) {                // a player's picture, by seat
      const part = url.split('/');                   // '', 'avatar', code, seat
      const av = pictureOf(part[2], part[3]);
      if (!av) { res.writeHead(404, { 'content-type': 'text/plain' }).end('no picture'); return; }
      // The version is in the address, so a hit on the right one can be held for
      // good. A guess at the address must not be.
      res.writeHead(200, {
        'content-type': av.type,
        'cache-control': query.get('v') === av.ver
          ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      res.end(av.buf);
      return;
    }

    if (url === '/') url = '/index.html';
    const file = url === '/game.js' ? path.join(ROOT, 'game.js') : path.join(PUB, url);
    const safe = path.normalize(file);
    if (!safe.startsWith(PUB) && safe !== path.join(ROOT, 'game.js')) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(safe, (err, buf) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(safe)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(buf);
    });
  }

  return { handler, lanUrls, qrSvg, refreshLanAddress, hiddenNets: () => hiddenNets };
};
