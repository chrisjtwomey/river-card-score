'use strict';
/* The settings page: one for every screen, behind the ⚙ in the top bar.

   It is laid over the page you are on, not a page at another address:
   leaving a game page drops the socket and re-deals the felt on the way back,
   and full screen does not survive the trip. So it covers the page with a top
   bar and a way back of its own, and the game underneath keeps its place.

   The page hands it the rows -- the list UI.commonSettings gives, plus its
   own -- and, on a screen with a player behind it, who that player is: the
   name and the photo. A row is one of

     { kind: 'group',  label }                      -- a heading: a panel of its own
     { kind: 'choice', label, options: [{ v, label }], get(), set(v) }
     { kind: 'toggle', label, get(), set() }        -- a tick, or nothing
     { kind: 'pick',   label, v, get(), set(v) }    -- one row of several, ticked
     { kind: 'rule' }                               -- a line across the panel
     { kind: 'action', label, run(), danger }       -- does it and shuts the page
     { kind: 'link',   label, href }

   Any row may carry hidden() to leave itself out. A label may be a function,
   for a row whose name changes with the game, and so may an href: the rows are
   handed over once, when the page is still starting up, so an address built
   out of the table has nothing to be built from yet. */
const Settings = (function () {
  const words = (it) => (typeof it.label === 'function' ? it.label() : it.label);
  const addr = (it) => (typeof it.href === 'function' ? it.href() : it.href);
  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

  /* wire(button, opts)
       items  the rows, in order; rows before the first group share one panel
       who    { name(), photo(), onName(name), onPhoto(data), note() } for a
              screen with a player behind it, left out on a TV screen. name()
              and photo() are read when the page opens; onName runs when the
              page shuts with a new name, onPhoto on every pick; note() is a
              line under the name for what the change means right now.
     Returns { open(o), close(), refresh(), el }. open({ first: true }) is the
     first ask: the name alone, and Done is the only way out. */
  function wire(button, opts) {
    const btn = typeof button === 'string' ? document.querySelector(button) : button;
    const o = opts || {};
    const items = o.items || [];
    const who = o.who || null;

    const page = el('section', 'settings');
    page.hidden = true;
    page.setAttribute('role', 'dialog');
    page.setAttribute('aria-modal', 'true');
    page.setAttribute('aria-label', 'Settings');
    const bar = el('header', 'topbar settings-bar');
    const back = el('button', 'btn ghost icon settings-back');
    back.type = 'button';
    back.textContent = '←';
    back.setAttribute('aria-label', 'Back');
    const title = el('h1');
    bar.append(back, title);
    const main = el('div', 'settings-main');
    page.append(bar, main);
    document.body.appendChild(page);

    /* The player: built once and kept, because the picker holds a pick in
       flight, and rebuilding it on every redraw would throw that away. */
    let you = null, nameIn = null, note = null, picker = null, done = null;
    let wasName = '';
    if (who) {
      you = el('div', 'panel settings-you');
      const h = el('h2');
      h.textContent = 'You';
      const field = el('label', 'field');
      const cap = el('span');
      cap.textContent = 'Your name';
      nameIn = el('input', 'settings-name');
      nameIn.type = 'text';
      nameIn.maxLength = 16;
      nameIn.autocomplete = 'nickname';
      nameIn.placeholder = 'Type your name';
      field.append(cap, nameIn);
      note = el('p', 'hint settings-note');
      you.append(h, field, note);
      if (typeof Avatar !== 'undefined' && Avatar.picker) {
        picker = Avatar.picker((d) => who.onPhoto && who.onPhoto(d));
        you.appendChild(picker.el);
      }
      done = el('button', 'btn primary big settings-done');
      done.type = 'button';
      done.textContent = 'Done';
      nameIn.addEventListener('input', () => { done.disabled = !typed(); });
      nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && typed()) close(); });
    }
    const typed = () => !!String((nameIn && nameIn.value) || '').trim();

    let open = false, first = false;

    function panel(label) {
      const p = el('div', 'panel');
      if (label) {
        const h = el('h2');
        h.textContent = label;
        p.appendChild(h);
      }
      main.appendChild(p);
      return p;
    }

    function row(it, into) {
      // A line inside a panel, for two sorts of thing that belong under one
      // heading without being the same sort of thing.
      if (it.kind === 'rule') { into.appendChild(el('div', 'menu-rule')); return; }
      if (it.kind === 'choice') {
        const r = el('div', 'menu-row');
        const name = el('span', 'menu-label');
        name.textContent = words(it);
        const seg = el('span', 'seg');
        const now = String(it.get());
        it.options.forEach((opt) => {
          const b = el('button', String(opt.v) === now ? 'on' : '');
          b.type = 'button';
          b.textContent = opt.label;
          b.addEventListener('click', () => { it.set(opt.v); draw(); });
          seg.appendChild(b);
        });
        r.append(name, seg);
        into.appendChild(r);
        return;
      }
      if (it.kind === 'link') {
        const a = el('a', 'menu-row menu-tap');
        a.href = addr(it);
        if (it.blank) { a.target = '_blank'; a.rel = 'noopener'; }
        a.textContent = words(it);
        // The page is left for another: what was typed goes with it.
        a.addEventListener('click', () => { commit(); if (!it.blank) shut(); });
        into.appendChild(a);
        return;
      }
      const b = el('button', 'menu-row menu-tap' + (it.danger ? ' danger' : ''));
      b.type = 'button';
      const name = el('span', 'menu-label');
      name.textContent = words(it);
      b.appendChild(name);
      /* A switch is on or off; a pick is one row of several and is on when the
         setting is standing on it. They are drawn the same way, because to a
         thumb they are the same thing: a row with a tick or without one. */
      if (it.kind === 'toggle' || it.kind === 'pick') {
        const on = it.kind === 'pick' ? String(it.get()) === String(it.v) : !!it.get();
        b.setAttribute('role', it.kind === 'pick' ? 'radio' : 'switch');
        b.setAttribute('aria-checked', String(on));
        const tick = el('span', 'menu-tick');
        tick.textContent = on ? '✓' : '';
        b.appendChild(tick);
      }
      b.addEventListener('click', () => {
        if (it.kind === 'toggle') { it.set(!it.get()); draw(); return; }
        if (it.kind === 'pick') { it.set(it.v); draw(); return; }
        it.run();
        close();
      });
      into.appendChild(b);
    }

    function draw() {
      main.innerHTML = '';
      title.textContent = first ? 'Who are you?' : 'Settings';
      back.hidden = first;
      if (you) {
        note.textContent = first
          ? 'Before you play, say who you are. The name is what the table calls you.'
          : ((who.note && who.note()) || '');
        note.hidden = !note.textContent;
        main.appendChild(you);
        if (first) {
          done.disabled = !typed();
          main.appendChild(done);
          return;
        }
      }
      let into = null;
      items.filter((it) => !(it.hidden && it.hidden())).forEach((it) => {
        if (it.kind === 'group') { into = panel(words(it)); return; }
        row(it, into || (into = panel('')));
      });
    }

    // The name typed goes to the page, once, when it is new.
    function commit() {
      if (!who) return;
      const n = String(nameIn.value || '').trim().slice(0, 16);
      if (!n || n === wasName) return;
      wasName = n;
      if (who.onName) who.onName(n);
    }

    function show(o) {
      first = !!(o && o.first);
      if (who) {
        wasName = String(who.name() || '');
        nameIn.value = wasName;
        if (picker) picker.show(who.photo ? who.photo() : null);
      }
      open = true;
      draw();
      page.hidden = false;
      document.body.classList.add('settings-open');
      if (btn) btn.setAttribute('aria-expanded', 'true');
      if (nameIn && (first || !wasName) && nameIn.focus) nameIn.focus();
    }
    function shut() {
      open = false;
      first = false;
      page.hidden = true;
      document.body.classList.remove('settings-open');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
    // The way back. On the first ask there is none until a name is typed.
    function close() {
      if (first && !typed()) return;
      commit();
      shut();
    }

    back.addEventListener('click', close);
    if (done) done.addEventListener('click', close);
    if (btn) {
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', (e) => { e.stopPropagation(); if (open) close(); else show(); });
    }
    document.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') close(); });

    return { open: show, close, refresh: () => { if (open) draw(); }, isOpen: () => open, el: page };
  }

  return { wire };
})();
