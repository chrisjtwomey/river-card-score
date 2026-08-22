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

  // Fills a pill with what actually happened, so a sleeping screen is not a mystery.
  function showAwake(sel, status) {
    const el = document.querySelector(sel);
    if (!el) return;
    const secure = window.isSecureContext;
    if (status === 'on') { el.hidden = false; el.textContent = '☀ screen on'; el.className = 'netpill awake'; el.title = 'The browser is holding the screen awake.'; }
    else if (status === 'video') { el.hidden = false; el.textContent = '☀ screen on*'; el.className = 'netpill awake dim'; el.title = 'Best effort: a silent video is holding the screen. An iPhone may still sleep.'; }
    else if (status === 'off') { el.hidden = true; }
    else {
      el.hidden = false; el.textContent = '☾ may sleep'; el.className = 'netpill dim';
      el.title = secure ? 'This browser will not hold the screen awake.'
        : 'The screen lock needs https. Open the table over https to keep the screen on.';
    }
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

  return { wireFullscreen, isFull, keepAwake, showAwake, wireZoom, measureTopbar, measureSticky: measureTopbar };
})();
