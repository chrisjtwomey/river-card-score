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

  /* ---------- light and dark ---------- */

  /* The button is a switch, not a cycle. It reads what the page is actually
     showing -- the choice if one was made, the system otherwise -- and sets
     the other one. So one press always changes what you see. Before a first
     press the page follows the system, as it always did. */
  const THEME_KEY = 'river-card-score:theme:v1';

  function themeSaved() {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return t === 'light' || t === 'dark' ? t : null;
    } catch (e) { return null; }
  }

  // What the eye sees right now.
  function themeShown() {
    const set = root.getAttribute('data-theme');
    if (set === 'light' || set === 'dark') return set;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark' : 'light';
  }

  function setTheme(t) {
    if (t) root.setAttribute('data-theme', t);
    else root.removeAttribute('data-theme');
    try { t ? localStorage.setItem(THEME_KEY, t) : localStorage.removeItem(THEME_KEY); } catch (e) {}
  }

  // Puts the saved choice on the page. Call it as early as the script runs.
  function startTheme() {
    const t = themeSaved();
    if (t) root.setAttribute('data-theme', t);
    return t;
  }

  function wireTheme(sel) {
    startTheme();
    const btn = document.querySelector(sel);
    if (!btn) return;
    const label = () => {
      const to = themeShown() === 'dark' ? 'light' : 'dark';
      btn.title = `Switch to ${to}`;
      btn.setAttribute('aria-label', btn.title);
    };
    btn.addEventListener('click', () => { setTheme(themeShown() === 'dark' ? 'light' : 'dark'); label(); });
    // Until a choice is made the page follows the system, so the button has to
    // keep up with it.
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', label);
      else if (mq.addListener) mq.addListener(label);
    }
    label();
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

  let zoom = 1;
  try { zoom = clamp(Number(localStorage.getItem(ZKEY)) || 1); } catch (e) {}

  // Puts the remembered size on the page. Call it once, as the page starts.
  function startZoom() { applyZoom(zoom); }
  function zoomNow() { return zoom; }
  function setZoom(z) { zoom = clamp(Number(z) || 1); applyZoom(zoom); }

  /* ---------- the settings menu ---------- */

  /* One button in the top bar, and everything that is a setting behind it. The
     bar had a button for each, which on a phone left no room for anything else
     and told a first-time player nothing: a glyph is not a label.

     items: what the menu holds, in order. Each is one of

       { kind: 'choice', label, options: [{ v, label }], get(), set(v) }
       { kind: 'toggle', label, get(), set() }        -- a tick, or nothing
       { kind: 'action', label, run(), danger }       -- does it and shuts
       { kind: 'link',   label, href }
       { kind: 'group',  label }                      -- a line and a heading

     Any item may carry hidden() to leave itself out. A choice stays open, so
     two of them can be compared; everything else shuts the menu.

     Returns { refresh } for a page whose items change as the game moves on. */
  function settingsMenu(button, items) {
    const btn = typeof button === 'string' ? document.querySelector(button) : button;
    if (!btn) return { refresh() {} };
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    (btn.parentNode || document.body).appendChild(menu);

    const shown = () => items.filter((it) => !(it.hidden && it.hidden()));
    // A label may be a function, for a row whose name changes with the game.
    const words = (it) => (typeof it.label === 'function' ? it.label() : it.label);

    function draw() {
      menu.innerHTML = '';
      shown().forEach((it) => {
        if (it.kind === 'group') {
          if (menu.children.length) menu.appendChild(document.createElement('hr'));
          const h = document.createElement('p');
          h.className = 'menu-group';
          h.textContent = words(it);
          menu.appendChild(h);
          return;
        }
        if (it.kind === 'choice') {
          const row = document.createElement('div');
          row.className = 'menu-row';
          const name = document.createElement('span');
          name.className = 'menu-label';
          name.textContent = words(it);
          const seg = document.createElement('span');
          seg.className = 'seg';
          const now = String(it.get());
          it.options.forEach((o) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = o.label;
            b.className = String(o.v) === now ? 'on' : '';
            b.addEventListener('click', () => { it.set(o.v); draw(); });
            seg.appendChild(b);
          });
          row.append(name, seg);
          menu.appendChild(row);
          return;
        }
        if (it.kind === 'link') {
          const a = document.createElement('a');
          a.className = 'menu-row menu-tap';
          a.href = it.href;
          if (it.blank) { a.target = '_blank'; a.rel = 'noopener'; }
          a.textContent = words(it);
          a.addEventListener('click', shut);
          menu.appendChild(a);
          return;
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'menu-row menu-tap' + (it.danger ? ' danger' : '');
        const name = document.createElement('span');
        name.className = 'menu-label';
        name.textContent = words(it);
        b.appendChild(name);
        if (it.kind === 'toggle') {
          b.setAttribute('role', 'menuitemcheckbox');
          const on = !!it.get();
          b.setAttribute('aria-checked', String(on));
          const tick = document.createElement('span');
          tick.className = 'menu-tick';
          tick.textContent = on ? '✓' : '';
          b.appendChild(tick);
        }
        b.addEventListener('click', () => {
          if (it.kind === 'toggle') it.set(!it.get()); else it.run();
          shut();
        });
        menu.appendChild(b);
      });
    }

    let open = false;
    function show() { open = true; draw(); menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
    function shut() { open = false; menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }

    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', (e) => { e.stopPropagation(); if (open) shut(); else show(); });
    // A tap anywhere else is the way out that needs no button.
    document.addEventListener('pointerdown', (e) => {
      if (open && !menu.contains(e.target) && e.target !== btn) shut();
    });
    document.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') shut(); });
    return { refresh: () => { if (open) draw(); } };
  }

  /* The settings every screen has. A page adds its own to the end.
     opts: { motion: true } for a page that plays the deal, { zoom: true } for
     one read from across a room. */
  function commonSettings(opts) {
    const o = opts || {};
    const list = [
      { kind: 'choice',
        label: 'Theme',
        options: [{ v: '', label: 'System' }, { v: 'light', label: 'Light' }, { v: 'dark', label: 'Dark' }],
        get: () => themeSaved() || '',
        set: (v) => setTheme(v || null) },
    ];
    if (o.zoom) {
      list.push({ kind: 'choice',
        label: 'Text size',
        options: [{ v: 1, label: '100%' }, { v: 1.3, label: '130%' }, { v: 1.6, label: '160%' }, { v: 2, label: '200%' }],
        get: zoomNow,
        set: setZoom });
    }
    if (o.motion && typeof Stage !== 'undefined') {
      list.push({ kind: 'choice',
        label: 'Animations',
        options: [{ v: 'full', label: 'Full' }, { v: 'reduced', label: 'Short' }, { v: 'off', label: 'Off' }],
        get: Stage.mode,
        set: Stage.setMode });
    }
    // Safari on an iPhone has no full screen at all, so the row is not offered.
    list.push({ kind: 'toggle', label: 'Full screen', hidden: () => !canFull,
                get: isFull, set: () => { try { toggleFullscreen(); } catch (e) {} } });
    return list;
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
    // An address somebody typed is one the server did not know it had -- that
    // is why it was typed -- so it belongs in the list, and it is the choice.
    if (saved && !urls.includes(saved)) urls.push(saved);
    const best = (saved && urls.includes(saved)) ? saved
      : (!isLocalUrl(location.origin) && urls.includes(location.origin)) ? location.origin
      : (urls.find((u) => !isLocalUrl(u)) || urls[0]);
    return { urls, best, ok, onlyLocal: !urls.some((u) => !isLocalUrl(u)) };
  }

  function rememberAddress(u) {
    try { localStorage.setItem(ADDR_KEY, u); } catch (e) {}
  }

  // '192.168.1.5' -> 'http://192.168.1.5:8787'. What a person reads off a
  // phone's Wi-Fi details is an address, not a URL.
  function fullAddress(typed) {
    let u = String(typed || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = location.protocol + '//' + u;
    if (!/:\d+$/.test(u.replace(/^https?:\/\//i, ''))) u += ':' + (location.port || '80');
    return u;
  }

  /* The address that goes in the QR code, and the ways to put it right.

     A table normally knows where it is. A phone that is sharing its own hotspot
     -- on a plane, with no mobile data -- may not: Android hides the interface
     list, and there is nowhere off the link to ask the routing table about. Then
     the only address the page can offer is its own, which is no use to anybody
     else, and somebody has to be told, and given a way to type the right one.

     mount: the element to build in. onPick: called with the address, now and on
     every change. */
  function addressPicker(mount, onPick) {
    const el = typeof mount === 'string' ? document.querySelector(mount) : mount;
    if (!el) return;
    el.innerHTML =
      '<p class="err addr-warn" hidden></p>' +
      '<label class="field addr-field" hidden><span>Address in the QR code</span>' +
      '<select class="addr-pick"></select></label>' +
      '<label class="field addr-other" hidden><span>The address of this phone</span>' +
      '<input class="addr-typed" type="text" inputmode="url" autocapitalize="off"' +
      ' autocomplete="off" spellcheck="false" placeholder="192.168.1.5"></label>';
    const warn = el.querySelector('.addr-warn');
    const field = el.querySelector('.addr-field');
    const pick = el.querySelector('.addr-pick');
    const other = el.querySelector('.addr-other');
    const typed = el.querySelector('.addr-typed');
    const OTHER = '\u0000other';

    serverAddresses().then((found) => {
      pick.innerHTML = '';
      found.urls.forEach((u) => {
        const o = document.createElement('option');
        o.value = u;
        o.textContent = u.replace(/^https?:\/\//, '') + (isLocalUrl(u) ? '  (this machine only)' : '');
        pick.appendChild(o);
      });
      const o = document.createElement('option');
      o.value = OTHER; o.textContent = 'Another address…';
      pick.appendChild(o);
      pick.value = found.best;
      // One address and nothing to say: no picker at all.
      field.hidden = found.urls.length < 2 && !found.onlyLocal;
      if (found.onlyLocal) {
        warn.hidden = false;
        warn.textContent = 'This phone cannot see its own address, so the code below only works '
          + 'here. Ask somebody who has joined for the address their phone shows, or read it '
          + 'from this phone\u2019s hotspot settings, and type it in.';
        other.hidden = false;
        field.hidden = false;
      }
      onPick(found.best);

      pick.addEventListener('change', () => {
        if (pick.value === OTHER) { other.hidden = false; typed.focus(); return; }
        rememberAddress(pick.value);
        onPick(pick.value);
      });
      const takeTyped = () => {
        const u = fullAddress(typed.value);
        if (!u) return;
        rememberAddress(u);
        if (!Array.prototype.some.call(pick.options, (op) => op.value === u)) {
          const add = document.createElement('option');
          add.value = u; add.textContent = u.replace(/^https?:\/\//, '') + '  (typed)';
          pick.insertBefore(add, pick.lastChild);
        }
        pick.value = u;
        warn.hidden = true;
        onPick(u);
      };
      typed.addEventListener('change', takeTyped);
      typed.addEventListener('keydown', (e) => { if (e.key === 'Enter') takeTyped(); });
    });
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

  /* ---------- a question, before something that cannot be undone ---------- */

  // Builds its own dialog, so any page can ask without markup of its own.
  // Falls back to the browser's own box where <dialog> is not supported.
  function ask(title, body, okLabel) {
    let d = document.getElementById('ui-confirm');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'ui-confirm';
      d.innerHTML = '<h2></h2><p class="hint"></p>' +
        '<form method="dialog" class="confirm-actions">' +
        '<button class="btn ghost" value="no">Cancel</button>' +
        '<button class="btn primary danger" value="yes">Yes</button></form>';
      document.body.appendChild(d);
    }
    if (!d.showModal) return Promise.resolve(window.confirm(title + (body ? '\n\n' + body : '')));
    d.querySelector('h2').textContent = title;
    d.querySelector('p').textContent = body || '';
    d.querySelector('[value="yes"]').textContent = okLabel || 'Yes';
    d.returnValue = '';
    return new Promise((res) => {
      d.addEventListener('close', () => res(d.returnValue === 'yes'), { once: true });
      d.showModal();
    });
  }

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
  startTheme();                       // before the first paint, so there is no flash
  document.addEventListener('DOMContentLoaded', measureTopbar);

  // Every page wants the saved theme, and none of them should have to ask: this
  // runs as the file loads, which is as early as any of them could.
  startTheme();

  return { wireFullscreen, isFull, canFull, toggleFullscreen, keepAwake, measureTopbar,
           measureSticky: measureTopbar, serverAddresses, rememberAddress, isLocalUrl,
           addressPicker, fullAddress, fx, ask,
           settingsMenu, commonSettings, startZoom, zoomNow, setZoom,
           wireTheme, startTheme, themeShown, setTheme, THEME_KEY };
})();
