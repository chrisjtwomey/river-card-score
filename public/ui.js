'use strict';
/* Small bits every page shares. */
const UI = (function () {
  const root = document.documentElement;
  const canFull = !!(root.requestFullscreen || root.webkitRequestFullscreen);
  const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

  /* Read in the Android app's WebView, which marks itself. A page that has a
     way back into the app -- the front page -- shows it only here; a browser
     never sees it. */
  const inApp = () => /UpTheRiverApp/.test(((window.navigator || {}).userAgent) || '');

  /* Whether this page is being read on the machine that serves it. That
     machine runs the tables, so it is offered what no other browser is: the
     list of them, and the way to take one away. */
  const servedHere = () => /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(window.location.hostname || '');

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

  /* ---------- which set of colours ---------- */

  /* A swatch is the whole palette; the theme above only says which half of it
     is showing. River is what :root already is, so a saved choice has to be
     stamped only when it is the other one, and a page with nothing saved opens
     as the game does. Nothing here knows a colour: which block of the
     stylesheet wins is the whole of it. */
  const SWATCH_KEY = 'river-card-score:swatch:v1';
  const SWATCHES = ['river', 'table'];

  function swatch() {
    try {
      const v = localStorage.getItem(SWATCH_KEY);
      return SWATCHES.indexOf(v) >= 0 ? v : SWATCHES[0];
    } catch (e) { return SWATCHES[0]; }
  }

  function setSwatch(v) {
    const s = SWATCHES.indexOf(v) >= 0 ? v : SWATCHES[0];
    if (s === SWATCHES[0]) root.removeAttribute('data-swatch');
    else root.setAttribute('data-swatch', s);
    try {
      if (s === SWATCHES[0]) localStorage.removeItem(SWATCH_KEY);
      else localStorage.setItem(SWATCH_KEY, s);
    } catch (e) {}
  }

  // As early as startTheme, and for the same reason: no page should flash one
  // set of colours and settle on the other.
  function startSwatch() {
    const s = swatch();
    if (s !== SWATCHES[0]) root.setAttribute('data-swatch', s);
    return s;
  }

  /* One colour out of the swatch, by the name the stylesheet gives it. For the
     few things that are drawn rather than styled -- paper thrown on the table,
     the ground behind a photo -- which cannot ask a stylesheet for themselves.
     The fallback is what it was before there were swatches, so a screen that
     will not answer still draws something right. */
  function colour(name, fallback) {
    try {
      const v = window.getComputedStyle(root).getPropertyValue(name);
      return (v || '').trim() || fallback;
    } catch (e) { return fallback; }
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

  // Hides itself on browsers without full screen, such as Safari on iDevice.
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

  // navigator.wakeLock only exists in a secure context, so a device on
  // http://192.168.x.x does not have it. Fall back to a silent looping video,
  // which holds the screen on some devices but not on an iDevice.
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

  /* ---------- the way back ---------- */

  /* Every page but the front one says where its back goes, as `data-back` on
     its top bar, and the control itself is drawn here: the same mark in the
     same corner on all of them, and one rule that takes it away where it does
     not belong. That rule is the frame. A page inside one is a window onto a
     table -- the dev page's panes, the screen a replay is watched on -- and
     nobody navigates a window: the back would put the front page where the
     game was. It is a link and not a button, so a window that may not touch
     the game can still be left. */
  function backLink() {
    const bar = document.querySelector('.topbar');
    const to = bar && bar.dataset && bar.dataset.back;
    if (!to || (window.top && window.top !== window.self)) return null;
    const a = document.createElement('a');
    a.className = 'backlink';
    a.href = to;
    a.textContent = '\u2039';
    a.title = bar.dataset.backName || 'Back';
    a.setAttribute('aria-label', a.title);
    // Inside the brand, not beside it: the bar holds its two ends apart, and a
    // third child would push the name of the page into the middle.
    const brand = bar.querySelector('.brand') || bar;
    brand.insertBefore(a, brand.firstChild);
    return a;
  }
  document.addEventListener('DOMContentLoaded', backLink);

  /* ---------- the settings menu ---------- */

  /* The settings every screen has, as rows for the settings page
     (Settings.wire draws them). A page adds its own to the end: a row with no
     group before it joins the last one.
     opts: { motion: true } for a page that plays the deal, { zoom: true } for
     one read from across a room. The way back is not here: it is the mark in
     the corner of the top bar, and a menu is not where navigation goes. */
  function commonSettings(opts) {
    const o = opts || {};
    const list = [
      { kind: 'group', label: 'Look' },
      { kind: 'choice',
        label: 'Theme',
        options: [{ v: '', label: 'System' }, { v: 'light', label: 'Light' }, { v: 'dark', label: 'Dark' }],
        get: () => themeSaved() || '',
        set: (v) => setTheme(v || null) },
      { kind: 'choice',
        label: 'Colours',
        options: [{ v: 'river', label: 'River' }, { v: 'table', label: 'Table' }],
        get: swatch,
        set: setSwatch },
    ];
    if (o.zoom) {
      list.push({ kind: 'choice',
        label: 'Text size',
        options: [{ v: 1, label: '100%' }, { v: 1.3, label: '130%' }, { v: 1.6, label: '160%' }, { v: 2, label: '200%' }],
        get: zoomNow,
        set: setZoom });
    }
    if (o.motion) {
      list.push({ kind: 'choice',
        label: 'Animations',
        options: [{ v: 'full', label: 'Full' }, { v: 'reduced', label: 'Short' }, { v: 'off', label: 'Off' }],
        get: motion,
        set: setMotion });
    }
    /* A section of its own, under the look of the page and over what belongs
       to this screen alone. It is not a look -- it changes how long the game
       takes to watch -- and it is not this screen's hardware either. */
    if (o.motion) {
      list.push({ kind: 'group', label: 'Play' });
      list.push({ kind: 'choice',
        label: 'Game speed',
        options: [{ v: 0.5, label: '0.5\u00d7' }, { v: 1, label: '1\u00d7' }, { v: 2, label: '2\u00d7' }],
        get: ownSpeed,
        set: setSpeed });
    }
    list.push({ kind: 'group', label: 'This screen' });
    // Safari on an iDevice has no full screen at all, so the row is not offered.
    list.push({ kind: 'toggle', label: 'Full screen', hidden: () => !canFull,
                get: isFull, set: () => { try { toggleFullscreen(); } catch (e) {} } });
    return list;
  }

  /* ---------- where devices should connect ---------- */

  const ADDR_KEY = 'rcs:hostaddr:v1';
  const isLocalUrl = (u) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(u);

  // A device cannot reach "localhost", so prefer a network address.
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
  // device's Wi-Fi details is an address, not a URL.
  function fullAddress(typed) {
    let u = String(typed || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = location.protocol + '//' + u;
    if (!/:\d+$/.test(u.replace(/^https?:\/\//i, ''))) u += ':' + (location.port || '80');
    return u;
  }

  /* The address that goes in the QR code, and the ways to put it right.

     A table normally knows where it is. A device that is sharing its own hotspot
     -- on a plane, with no mobile data -- may not: Android hides the interface
     list, and there is nowhere off the link to ask the routing table about. Then
     the only address the page can offer is its own, which is no use to anybody
     else, and somebody has to be told, and given a way to type the right one.

     mount: the element to build in. onPick: called with the address, now and on
     every change. */
  function addressPicker(mount, onPick, opts) {
    const el = typeof mount === 'string' ? document.querySelector(mount) : mount;
    if (!el) return;
    // quiet: take the best address and say nothing, unless there is no address
    // worth having, which is the one thing only a person can put right.
    const quiet = !!(opts && opts.quiet);
    el.innerHTML =
      '<p class="err addr-warn" hidden></p>' +
      '<label class="field addr-field" hidden><span>Address in the QR code</span>' +
      '<select class="addr-pick"></select></label>' +
      '<label class="field addr-other" hidden><span>The address of this device</span>' +
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
      // One address and nothing to say: no picker at all. Nor on a screen that
      // asked to be quiet, which takes the best of them.
      field.hidden = quiet || (found.urls.length < 2 && !found.onlyLocal);
      if (found.onlyLocal) {
        warn.hidden = false;
        warn.textContent = 'This device cannot see its own address, so the code below only works '
          + 'here. Ask somebody who has joined for the address their device shows, or read it '
          + 'from this device\u2019s hotspot settings, and type it in.';
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
  // `danger` paints the OK red: only for a thing that cannot be got back.
  function ask(title, body, okLabel, danger) {
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
    const yes = d.querySelector('[value="yes"]');
    yes.textContent = okLabel || 'Yes';
    yes.className = 'btn primary' + (danger ? ' danger' : '');
    d.returnValue = '';
    return new Promise((res) => {
      d.addEventListener('close', () => res(d.returnValue === 'yes'), { once: true });
      d.showModal();
    });
  }

  /* The table taken away by the machine that runs it: not a game ending --
     nothing is scored and nothing is filed -- the table itself goes, and every
     screen at it is told so. Two screens offer it, the host screen and the
     table controls, and it must be worded the same on both, so the asking and
     the doing live here and each page says only what to do afterwards.

     `before` runs once the answer is yes and before the table goes: the page
     is about to be told its own table is gone, and it has to know that is
     because it asked. Resolves to whether it went ahead. */
  function endTable(code, before) {
    return ask(`End table ${code}?`,
      'Every device at it is put off, and the game is not kept: nothing is scored and '
      + 'nothing goes to Past games. The table cannot be started again.',
      'End the table', true).then((yes) => {
        if (!yes) return false;
        if (before) before();
        return fetch('/table/end?c=' + encodeURIComponent(code), { method: 'POST' })
          .catch(() => {})
          .then(() => true);
      });
  }

  /* One button, and nothing to decide: the table has said something the player
     has to see. It is the tap that matters -- whoever taps is at the table --
     so there is nothing to answer and no answer to read. */
  function tell(title, body, okLabel) {
    let d = document.getElementById('ui-tell');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'ui-tell';
      d.innerHTML = '<h2></h2><p class="hint"></p>' +
        '<form method="dialog" class="confirm-actions">' +
        '<button class="btn primary" value="ok">OK</button></form>';
      document.body.appendChild(d);
    }
    if (!d.showModal) { window.alert(title + (body ? '\n\n' + body : '')); return Promise.resolve(); }
    d.querySelector('h2').textContent = title;
    d.querySelector('p').textContent = body || '';
    d.querySelector('[value="ok"]').textContent = okLabel || 'OK';
    if (d.open) return Promise.resolve();          // it is already up, and already answered
    return new Promise((res) => {
      d.addEventListener('close', () => res(), { once: true });
      d.showModal();
    });
  }

  /* ---------- motion ---------- */

  const KEY_MOTION = 'river-card-score:motion:v1';

  // The reader's choice: 'full' | 'reduced' | 'off'. ?motion= in the address
  // wins and is remembered; with no choice made, the system's reduce-motion
  // setting decides. The scenes and the small movements all ask this one.
  function motion() {
    let saved = null;
    try { saved = localStorage.getItem(KEY_MOTION); } catch (e) {}
    const q = new URLSearchParams(window.location.search).get('motion');
    if (q === 'full' || q === 'reduced' || q === 'off') {
      saved = q;
      try { localStorage.setItem(KEY_MOTION, q); } catch (e) {}
    }
    if (saved) return saved;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return reduce ? 'reduced' : 'full';
  }

  // From the settings menu. 'off' still shows the result of a deal: it is the
  // flourish that goes, never the game.
  function setMotion(m) {
    if (m !== 'full' && m !== 'reduced' && m !== 'off') return;
    try { localStorage.setItem(KEY_MOTION, m); } catch (e) {}
  }

  /* ---------- game speed ---------- */

  const KEY_SPEED = 'river-card-score:speed:v1';
  const SPEEDS = [0.5, 1, 2];

  /* How fast the game plays on this screen. It is written the way a speed is
     written on anything that plays -- bigger is quicker -- so a duration is
     divided by it: 2 draws every movement in half the time, 0.5 takes twice
     as long over it, and 1 is the game as it is drawn.

     It belongs to the screen and not to the table. Everybody at a table may
     have a different one, and none of them changes the game for anybody
     else: what it moves is how this screen draws what happened, never what
     happened or when the table let it. */
  function ownSpeed() {
    let saved = null;
    try { saved = localStorage.getItem(KEY_SPEED); } catch (e) {}
    const q = new URLSearchParams(window.location.search).get('speed');
    if (q !== null && SPEEDS.indexOf(Number(q)) >= 0) {
      saved = q;
      try { localStorage.setItem(KEY_SPEED, q); } catch (e) {}
    }
    const v = Number(saved);
    return SPEEDS.indexOf(v) >= 0 ? v : 1;
  }

  /* And how fast the table itself is going, which is not this screen's to
     choose. A real table goes at one: what happened, happened when it did. A
     game watched again goes at whatever the replay is being played back at, so
     a hand played out at half speed is drawn at half speed as well -- the
     cards would otherwise fly about at full pelt between beats twice as long,
     which reads as a fault rather than as slow motion.

     It multiplies rather than replaces: a screen set to 0.5x watching a replay
     at 2x draws at 1x, which is what both of those asked for. */
  let PLAYED = 1;
  const setPlayed = (v) => {
    const was = PLAYED;
    PLAYED = Math.max(0.25, Math.min(8, Number(v) || 1));
    if (PLAYED !== was) stampSpeed();
  };

  const speed = () => ownSpeed() * PLAYED;

  // From the settings menu, which offers this screen's own and nothing else.
  function setSpeed(v) {
    if (SPEEDS.indexOf(Number(v)) < 0) return;
    try { localStorage.setItem(KEY_SPEED, String(Number(v))); } catch (e) {}
    stampSpeed();
  }

  /* The stylesheet is told as well. A transition is a duration like any other,
     and the ones the table moves on are written as a division by this, so a
     card placed by a style and a card drawn by an arc keep the same pace. */
  function stampSpeed() {
    try {
      document.documentElement.style.setProperty('--speed', String(speed()));
    } catch (e) {}
  }

  /* A duration this screen owns: how long it takes to draw something. */
  const ms = (n) => Math.max(1, Math.round(n / speed()));

  /* A beat this screen holds on to while the table waits for it -- the moment
     a trick is left up to be read, what a round paid, the places at the end of
     one. The table grants the window, not the screen: a trick sits for
     TRICK_HOLD before the winner may lead, and the bots wait DEAL_WAIT for the
     devices to say their tables are up. So a beat may be cut short, which is
     this screen's business, and may not be drawn out, which is not: past the
     window the table moves on and cuts the beat anyway, which reads worse than
     never having asked for it. */
  const hold = (n) => Math.min(n, ms(n));

  /* A movement, at the speed this screen is playing at. Everything that starts
     one puts it through here rather than dividing its own numbers: playbackRate
     scales a delay and a duration together, and a scene whose delays are a
     running total of the ones before them cannot be scaled a number at a
     time. */
  function paced(a) {
    if (a) { try { a.playbackRate = speed(); } catch (e) {} }
    return a;
  }

  /* ---------- a strip with more in it than fits ---------- */

  /* A row of things too wide for the space it has says so by fading out on the
     side there is more on. It replaces the scrollbar, which was a bar of its
     own across the page saying the same thing louder and taking a row's height
     to say it. The strip listens to itself once, and is asked again whenever
     what is in it is redrawn or the window changes shape. */
  function fadeStrip(el) {
    if (!el) return;
    if (!el._faded) {
      el._faded = true;
      el.addEventListener('scroll', () => fadeStrip(el));
    }
    const over = el.scrollWidth - el.clientWidth;
    const x = el.scrollLeft || 0;
    el.classList.toggle('more-l', over > 1 && x > 1);
    el.classList.toggle('more-r', over > 1 && x < over - 1);
  }

  /* Bring the cell a strip is on into view, and a couple either side of it.

     `scrollIntoView` moves the least it can, which lands the cell hard against
     the edge it came in from -- and a cell on the edge of a strip says nothing
     about whether there is anything after it. Two cells of room says there is,
     and the fade at that edge says there is more still. */
  const LOOK = 2;
  function showCell(box, on) {
    if (!box || !on || !Number.isFinite(on.offsetLeft) || !box.clientWidth) return;
    const w = box.clientWidth;
    const pad = (on.offsetWidth || 0) * LOOK;
    const end = on.offsetLeft + (on.offsetWidth || 0);
    let x = box.scrollLeft || 0;
    if (end + pad > x + w) x = end + pad - w;
    if (on.offsetLeft - pad < x) x = on.offsetLeft - pad;
    x = Math.max(0, Math.min(x, Math.max(0, (box.scrollWidth || w) - w)));
    if (box.scrollTo) box.scrollTo({ left: x, behavior: motionOK() ? 'smooth' : 'auto' });
    else box.scrollLeft = x;
    fadeStrip(box);
  }

  /* ---------- small movements ---------- */

  // The flourishes play with motion on in full. 'reduced' keeps the scenes,
  // shortened, and takes the small movements out.
  const motionOK = () => motion() === 'full';
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
    el.className = 'toast' + (o.err ? ' err' : '');   // red: the table refused something
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
  /* The pages ask for this on every state, because a seat arriving makes the
     standings taller and the answer would otherwise be stale. Asking means
     reading two offsetHeights, which makes the browser lay the page out then
     and there, and it was the most expensive thing left on the host screen:
     2.7 seconds of a six-minute game, for an answer that changes when a seat
     joins and at no other time.

     So the two boxes are watched instead. A ResizeObserver says when one of
     them actually changes size, which is the only moment the answer is
     different, and the asking becomes free. Where there is no observer to be
     had, the pages go on asking as they did. */
  let watched = false;
  function watchTheStickyBoxes() {
    const RO = typeof window !== 'undefined' && window.ResizeObserver;
    if (watched || !RO) return;
    const bar = document.querySelector('.topbar');
    const st = document.querySelector('.standings-panel');
    if (!bar && !st) return;                   // a page with neither: nothing to watch
    const eye = new RO(() => measureTopbar());
    if (bar) eye.observe(bar);
    if (st) eye.observe(st);
    watched = true;
  }

  /* What the pages call, on every state. The first ask sets the watching up
     and measures once; after that there is nothing to ask, and the layout is
     left alone. A page with neither box, or a browser with no observer, keeps
     measuring the way it always did. */
  function measureSticky() {
    if (watched) return;
    watchTheStickyBoxes();
    measureTopbar();
  }

  window.addEventListener('resize', measureTopbar);
  window.addEventListener('load', measureTopbar);
  startTheme();                       // before the first paint, so there is no flash
  document.addEventListener('DOMContentLoaded', measureTopbar);

  // Every page wants the saved theme and the saved colours, and none of them
  // should have to ask: this runs as the file loads, which is as early as any
  // of them could.
  startTheme();
  startSwatch();
  // The same, and for the same reason: the stylesheet cannot read a setting.
  stampSpeed();

  return { motion, setMotion, speed, ownSpeed, setSpeed, setPlayed, ms, hold, paced,
           fadeStrip, showCell, wireFullscreen, isFull, canFull, toggleFullscreen, inApp, servedHere,
           keepAwake, measureTopbar, backLink,
           measureSticky, serverAddresses, rememberAddress, isLocalUrl,
           addressPicker, fullAddress, fx, ask, tell, endTable,
           commonSettings, startZoom, zoomNow, setZoom,
           wireTheme, startTheme, themeShown, setTheme, THEME_KEY,
           swatch, setSwatch, startSwatch, SWATCHES, SWATCH_KEY, colour };
})();
