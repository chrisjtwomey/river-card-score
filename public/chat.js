'use strict';
/* Table talk: a sheet that slides up over the game.

   The talk is the table's, and it arrives the way everything else does -- in
   the state, on the same socket as the bids. Nothing leaves the table: no
   service, no account, no internet. A phone sharing its own hotspot on a plane
   runs this exactly as a laptop on a home network does.

   The page owns the button in its top bar; everything below the button is
   built here, once, on the first state that carries a table. */
const Chat = (function () {
  // The last line this reader has actually seen, kept per table so a reload in
  // the middle of a game does not mark the whole game unread.
  const SEEN_KEY = 'rcs:chatseen:v1';

  // The page's top bar has one of these, and the felt -- which covers the top
  // bar -- has another. Both open the same sheet and both carry the same count.
  let btns = [], badges = [], sheet = null, list = null, input = null, form = null;
  let sendLine = null;                  // null for a window that may only read
  let code = '', mine = null;           // this table, and my seat in it
  let lines = [], seen = 0, open = false, started = false;

  function readSeen(forCode) {
    try {
      const raw = localStorage.getItem(SEEN_KEY) || '';
      const [c, n] = raw.split(':');
      return c === forCode ? Number(n) || 0 : 0;
    } catch (e) { return 0; }
  }
  function writeSeen() {
    try { localStorage.setItem(SEEN_KEY, code + ':' + seen); } catch (e) {}
  }

  /* button: the one already in the page's top bar.
     send:   what to do with a line, or nothing for a watching window. */
  function wire(button, send) {
    sendLine = send || null;
    if (!also(button)) return;
    document.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') shut(); });
  }

  const ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.6 3h10.8A2.6 2.6 0'
    + ' 0 1 18 5.6v6.3a2.6 2.6 0 0 1-2.6 2.6H9.1l-3.5 3.1a.7.7 0 0 1-1.2-.52v-2.58H4.6A2.6 2.6 0'
    + ' 0 1 2 11.9V5.6A2.6 2.6 0 0 1 4.6 3z"/></svg>';

  /* A button of this sheet's own, for a place the page's top bar cannot be
     reached from -- the felt covers it. Same icon, same unread count. */
  function button(cls) {
    const el = document.createElement('button');
    el.className = cls || '';
    el.type = 'button';
    el.title = 'Table talk';
    el.setAttribute('aria-label', 'Table talk');
    el.innerHTML = ICON + '<span class="chat-badge" hidden></span>';
    also(el);
    return el;
  }

  /* Another button for the same sheet, already on the page. It carries the
     same unread count. */
  function also(button) {
    const el = typeof button === 'string' ? document.querySelector(button) : button;
    if (!el || btns.indexOf(el) >= 0) return null;
    btns.push(el);
    const b = el.querySelector('.chat-badge');
    if (b) badges.push(b);
    el.addEventListener('click', (e) => { e.stopPropagation(); if (open) shut(); else show(); });
    countUnread();
    return el;
  }

  function build() {
    if (sheet) return;
    sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.hidden = true;
    sheet.innerHTML =
      '<div class="sheet-card" role="dialog" aria-label="Table talk">'
      + '<header class="sheet-head"><h2>Table talk</h2>'
      + '<button class="btn ghost sheet-x" type="button" aria-label="Close">✕</button></header>'
      + '<div class="chat-list"></div>'
      + '<form class="chat-say"><input class="chat-text" type="text" maxlength="200"'
      + ' autocomplete="off" placeholder="Say something…">'
      + '<button class="btn primary" type="submit">Send</button></form>'
      + '<p class="hint chat-read" hidden>This window is only watching.</p>'
      + '</div>';
    document.body.appendChild(sheet);
    list = sheet.querySelector('.chat-list');
    form = sheet.querySelector('.chat-say');
    input = sheet.querySelector('.chat-text');

    sheet.querySelector('.sheet-x').addEventListener('click', shut);
    // The card is the sheet's own child, so a tap that misses it is a tap
    // outside: the way out that needs no button.
    sheet.addEventListener('click', (e) => { if (e.target === sheet) shut(); });

    if (!sendLine) {
      form.hidden = true;
      sheet.querySelector('.chat-read').hidden = false;
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || !sendLine) return;
      sendLine(text);
      input.value = '';
      input.focus();                    // the next line usually follows
    });
  }

  function show() {
    build();
    open = true;
    sheet.hidden = false;
    draw();
    markRead();
    // After the sheet is on screen, or the keyboard opens over nothing.
    if (sendLine) setTimeout(() => input.focus(), 60);
  }

  function shut() {
    open = false;
    if (sheet) sheet.hidden = true;
    if (input) input.blur();
  }

  function markRead() {
    if (!lines.length) return;
    seen = lines[lines.length - 1].n;
    writeSeen();
    countUnread();
  }

  function countUnread() {
    const n = lines.filter((l) => l.n > seen).length;
    badges.forEach((b) => {
      b.textContent = n > 9 ? '9+' : String(n);
      b.hidden = n === 0;
    });
  }

  function draw() {
    if (!list) return;
    list.innerHTML = '';
    if (!lines.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Nothing said yet.';
      list.appendChild(p);
      return;
    }
    lines.forEach((l) => {
      const p = document.createElement('p');
      p.className = 'chat-line'
        + (l.who === mine ? ' mine' : '')
        + (l.who === 'host' ? ' fromtable' : '');
      const who = document.createElement('b');
      who.textContent = l.who === mine ? 'You' : l.name;
      p.appendChild(who);
      // textContent, never innerHTML: a line is a player's own words.
      p.appendChild(document.createTextNode(' ' + l.text));
      list.appendChild(p);
    });
    list.scrollTop = list.scrollHeight;         // the newest is what matters
  }

  /* Every state the page gets. The talk is in it, so this is where new lines
     turn up -- as a badge on the button, or a toast if the reader is deep in a
     hand and would otherwise miss them. */
  function update(ST, mySeatId) {
    if (!ST || !btns.length) return;
    const fresh = Array.isArray(ST.chat) ? ST.chat : [];
    mine = mySeatId || null;

    if (ST.code && ST.code !== code) {          // a table of its own has its own talk
      code = ST.code;
      seen = readSeen(code);
      started = false;
    }
    const before = lines;
    lines = fresh;

    // The first state is not news: it is the backlog. Only what arrives after
    // the page is up gets a toast.
    const newest = lines.length ? lines[lines.length - 1] : null;
    const had = before.length ? before[before.length - 1].n : 0;
    if (started && newest && newest.n > had && newest.who !== mine && !open) {
      const say = lines.filter((l) => l.n > had && l.who !== mine);
      const one = say[say.length - 1];
      // UI is a top-level const, so it is not a property of window: ask for the
      // name itself.
      if (one && typeof UI !== 'undefined' && UI.fx) UI.fx.toast(one.name + ': ' + one.text);
    }
    started = true;

    if (open) { draw(); markRead(); } else countUnread();
  }

  return { wire, also, button, update, show, shut, isOpen: () => open };
})();
