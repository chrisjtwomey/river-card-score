'use strict';
/* Small bits every page shares. */
const UI = (function () {
  const root = document.documentElement;
  const canFull = !!(root.requestFullscreen || root.webkitRequestFullscreen);
  const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

  function toggleFullscreen() {
    if (isFull()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
    }
  }

  // Hides itself on browsers without full screen, such as Safari on iPhone.
  function wireFullscreen(sel) {
    const btn = document.querySelector(sel);
    if (!btn) return;
    if (!canFull) { btn.hidden = true; return; }
    const sync = () => {
      const on = isFull();
      btn.setAttribute('aria-pressed', String(on));
      btn.title = on ? 'Leave full screen' : 'Full screen';
      btn.textContent = on ? '⤡' : '⛶';
    };
    btn.addEventListener('click', () => { try { toggleFullscreen(); } catch (e) {} });
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    sync();
  }

  /* ---------- keep the display awake ---------- */

  let lock = null, wanted = false, vid = null, paint = null, retryHooked = false;

  // navigator.wakeLock only exists in a secure context, so a phone on
  // http://192.168.x.x does not have it. Fall back to a silent looping video,
  // which holds the screen on some phones but not on an iPhone.
  function videoFallback() {
    if (vid) return Promise.resolve('video');
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    if (!c.captureStream) return Promise.resolve('unsupported');
    const ctx = c.getContext('2d');
    let flip = false;
    paint = setInterval(() => {
      flip = !flip;
      ctx.fillStyle = flip ? '#000' : '#010101';
      ctx.fillRect(0, 0, 2, 2);
    }, 1000);
    vid = document.createElement('video');
    vid.muted = true; vid.loop = true; vid.defaultMuted = true;
    vid.setAttribute('muted', ''); vid.setAttribute('playsinline', '');
    vid.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:.01;pointer-events:none';
    vid.srcObject = c.captureStream(1);
    document.body.appendChild(vid);
    return vid.play().then(() => 'video').catch(() => {
      if (!retryHooked) {                        // some browsers need a tap first
        retryHooked = true;
        document.addEventListener('pointerdown', () => { if (wanted && vid) vid.play().catch(() => {}); }, { once: true });
      }
      return 'needs-tap';
    });
  }

  async function grab() {
    if ('wakeLock' in navigator) {
      try {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => { lock = null; });
        return 'on';
      } catch (e) { /* denied or not allowed here: try the video */ }
    }
    return videoFallback();
  }

  function dropVideo() {
    if (paint) { clearInterval(paint); paint = null; }
    if (vid) { try { vid.pause(); } catch (e) {} vid.remove(); vid = null; }
  }

  // The browser drops the lock when the tab hides, so take it again on return.
  document.addEventListener('visibilitychange', () => {
    if (wanted && document.visibilityState === 'visible' && !lock) grab();
  });

  function keepAwake(on) {
    wanted = !!on;
    if (wanted) return lock ? Promise.resolve('on') : grab();
    if (lock) { try { lock.release(); } catch (e) {} lock = null; }
    dropVideo();
    return Promise.resolve('off');
  }

  /* ---------- page size, for reading from across the room ---------- */

  const ZKEY = 'rcs:zoom:v1';
  const clamp = (z) => Math.max(0.8, Math.min(2, Math.round(z * 10) / 10));

  function applyZoom(z) {
    document.body.style.zoom = String(z);
    setTimeout(measureTopbar, 0);
    try { localStorage.setItem(ZKEY, String(z)); } catch (e) {}
    const label = document.getElementById('zoom-label');
    if (label) label.textContent = Math.round(z * 100) + '%';
  }

  function wireZoom(outSel, inSel) {
    let z = 1;
    try { z = clamp(Number(localStorage.getItem(ZKEY)) || 1); } catch (e) {}
    applyZoom(z);
    const step = (d) => { z = clamp(z + d); applyZoom(z); };
    const out = document.querySelector(outSel), inn = document.querySelector(inSel);
    if (out) out.addEventListener('click', () => step(-0.1));
    if (inn) inn.addEventListener('click', () => step(0.1));
  }

  /* ---------- where phones should connect ---------- */

  const ADDR_KEY = 'rcs:hostaddr:v1';
  const isLocalUrl = (u) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(u);

  // A phone cannot reach "localhost", so prefer a network address.
  async function serverAddresses() {
    let urls = [], ok = true;
    try {
      const r = await fetch('/net.json', { cache: 'no-store' });
      if (!r.ok) throw new Error('net.json ' + r.status);
      const j = await r.json();
      urls = Array.isArray(j.urls) ? j.urls.slice() : [];
    } catch (e) {
      ok = false;
      console.warn('[join] cannot read the server addresses:', e.message);
    }
    if (!urls.includes(location.origin)) urls.push(location.origin);
    let saved = null;
    try { saved = localStorage.getItem(ADDR_KEY); } catch (e) {}
    const best = (saved && urls.includes(saved)) ? saved
      : (!isLocalUrl(location.origin) && urls.includes(location.origin)) ? location.origin
      : (urls.find((u) => !isLocalUrl(u)) || urls[0]);
    return { urls, best, ok };
  }

  function rememberAddress(u) {
    try { localStorage.setItem(ADDR_KEY, u); } catch (e) {}
  }

  /* ---------- live reload, when the server runs with DEV=1 ---------- */

  function liveReload() {
    if (!/^https?:$/.test(location.protocol)) return;      // file:// has no server
    if (typeof EventSource === 'undefined') return;
    // Not inside a frame. The stream never closes, and a browser allows only
    // six connections to one address, so a wall of dev previews would use them
    // all up and later requests -- the QR code, /net.json -- would hang for
    // ever. The dev page keeps one stream and reloads its own frames.
    if (window.top !== window) return;
    let es;
    try { es = new EventSource('/live'); } catch (e) { return; }
    es.onopen = () => console.info('[dev] live reload is on');
    es.addEventListener('reload', () => location.reload());
    es.onerror = () => {
      // 2 is CLOSED: the route is off or gone, so stop asking. A dropped
      // connection leaves it CONNECTING, and the browser retries on its own.
      if (es.readyState === 2) es.close();
    };
  }
  document.addEventListener('DOMContentLoaded', liveReload);

  /* ---------- small movements ---------- */

  // The same switch the deal animation uses: the system setting, unless a
  // ?motion= flag was saved for this browser.
  function motionOK() {
    let saved = null;
    try { saved = localStorage.getItem('river-card-score:motion:v1'); } catch (e) {}
    if (saved === 'off' || saved === 'reduced') return false;
    if (saved === 'full') return true;
    return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  const movable = (el) => !!(el && el.animate) && motionOK();

  // Rebuild a list, then slide each row from where it was to where it is now.
  // The rows carry a data-k, so they may be brand new elements: only the place
  // on screen has to match up.
  function flip(box, redraw) {
    const was = new Map();
    if (motionOK()) {
      Array.from(box.children).forEach((el) => {
        if (el.dataset.k) was.set(el.dataset.k, el.getBoundingClientRect().top);
      });
    }
    redraw();
    if (!was.size) return;
    Array.from(box.children).forEach((el) => {
      const from = was.get(el.dataset.k);
      if (from === undefined || !el.animate) return;
      const dy = from - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
        { duration: 260, easing: 'cubic-bezier(.2,.85,.3,1)' });
    });
  }

  // A quick squeeze, for something that has just arrived.
  function pop(el, scale) {
    if (!movable(el)) return;
    el.animate(
      [{ transform: 'scale(1)' }, { transform: `scale(${scale || 1.12})`, offset: .35 },
       { transform: 'scale(1)' }],
      { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1.4)' });
  }

  // A ring spreading out of something, for "this one now".
  function ring(el) {
    if (!movable(el)) return;
    el.animate(
      [{ boxShadow: '0 0 0 0 rgba(184,134,43,.55)' }, { boxShadow: '0 0 0 10px rgba(184,134,43,0)' }],
      { duration: 620, easing: 'ease-out' });
  }

  // Runs a number to its new value. opts: { ms, fmt }.
  function count(el, from, to, opts) {
    const o = opts || {};
    const fmt = o.fmt || String;
    if (!el) return;
    if (from === to || !motionOK() || typeof requestAnimationFrame !== 'function') {
      el.textContent = fmt(to);
      return;
    }
    const ms = o.ms || 460;
    const at = (window.performance ? performance.now() : Date.now());
    el.textContent = fmt(from);
    const step = (now) => {
      if (!el.isConnected) return;                 // the list was rebuilt under it
      const k = Math.min(1, (now - at) / ms);
      el.textContent = fmt(k < 1 ? Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))) : to);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // A "+12" that floats up and fades, to say what just changed. The element it
  // is given must be positioned.
  function rise(host, text, good) {
    if (!movable(host)) return;
    const el = document.createElement('span');
    el.className = 'fxrise' + (good ? ' up' : ' down');
    el.textContent = text;
    host.appendChild(el);
    const a = el.animate(
      [{ opacity: 0, transform: 'translateY(3px)' },
       { opacity: 1, transform: 'translateY(-7px)', offset: .25 },
       { opacity: 1, transform: 'translateY(-13px)', offset: .7 },
       { opacity: 0, transform: 'translateY(-21px)' }],
      { duration: 900, easing: 'ease-out' });
    a.onfinish = () => el.remove();
  }

  // The standings: rows keyed by data-k, each with a .pts and a .bar i.
  // Read the bars before the rebuild, so they can glide to their new widths.
  function barsBefore(box) {
    const bars = {};
    box.querySelectorAll('[data-k]').forEach((el) => {
      const i = el.querySelector('.bar i');
      if (i) bars[el.dataset.k] = i.style.width || '0%';
    });
    return bars;
  }

  // After the rebuild: glide each bar, run each score to its new value, and
  // float up what the round paid. `last` is the {key: score} from the render
  // before, and the new one is returned to keep for the next.
  function scores(box, values, last, bars) {
    Object.keys(values).forEach((k) => {
      const row = box.querySelector(`[data-k="${k}"]`);
      if (!row) return;
      const bar = row.querySelector('.bar i');
      const from = bars && bars[k];
      if (bar && from && from !== bar.style.width && bar.animate && motionOK()) {
        bar.animate([{ width: from }, { width: bar.style.width }],
          { duration: 420, easing: 'cubic-bezier(.2,.85,.3,1)' });
      }
      if (!last || last[k] === undefined || last[k] === values[k]) return;
      const d = values[k] - last[k];
      count(row.querySelector('.pts'), last[k], values[k]);
      rise(row, (d > 0 ? '+' : '') + d, d > 0);
    });
    return values;
  }

  // A line that slides in under the top bar, waits, and goes. It says what
  // just happened at another seat, for a player who was looking away.
  function toast(text, opts) {
    const o = opts || {};
    let box = document.getElementById('toaster');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toaster';
      box.className = 'toaster';
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    const what = document.createElement('span');
    what.className = 'what';
    what.textContent = text;
    el.appendChild(what);
    if (o.note) {
      const n = document.createElement('span');
      n.className = 'note';
      n.textContent = o.note;
      el.appendChild(n);
    }
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);

    const ms = o.ms || 2600;
    if (!el.animate || !motionOK()) {          // the words still matter: only the movement goes
      setTimeout(() => el.remove(), ms);
      return;
    }
    const a = el.animate(
      [{ opacity: 0, transform: 'translateY(-10px)' },
       { opacity: 1, transform: 'none', offset: .12 },
       { opacity: 1, transform: 'none', offset: .86 },
       { opacity: 0, transform: 'translateY(-6px)' }],
      { duration: ms, easing: 'ease-out' });
    a.onfinish = () => el.remove();
  }

  const fx = { on: motionOK, flip, pop, ring, count, rise, barsBefore, scores, toast };

  /* ---------- sticky offset ---------- */

  // The top bar and the standings both stick, so anything below them needs to
  // know how tall they are.
  function measureTopbar() {
    const root = document.documentElement;
    const bar = document.querySelector('.topbar');
    // offsetHeight, not getBoundingClientRect: it stays in the page's own units
    // when the host screen is zoomed.
    root.style.setProperty('--topbar-h', (bar ? bar.offsetHeight : 0) + 'px');
    const st = document.querySelector('.standings-panel');
    const stuck = st && st.offsetParent !== null;
    root.style.setProperty('--standings-h', (stuck ? st.offsetHeight + 14 : 0) + 'px');
  }
  window.addEventListener('resize', measureTopbar);
  window.addEventListener('load', measureTopbar);
  document.addEventListener('DOMContentLoaded', measureTopbar);

  return { wireFullscreen, isFull, keepAwake, wireZoom, measureTopbar,
           measureSticky: measureTopbar, serverAddresses, rememberAddress, isLocalUrl, fx };
})();
