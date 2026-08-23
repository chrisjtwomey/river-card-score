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
           measureSticky: measureTopbar, serverAddresses, rememberAddress, isLocalUrl };
})();
