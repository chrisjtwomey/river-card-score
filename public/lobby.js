'use strict';
/* The lobby, drawn the same on the host screen, the table host's phone and
   the dev page: the seats in the order of play, the bots, the rules, and the
   start button.

   Every widget takes the element it draws into, the state, and a view:
     me     this screen's seat, or -1 for a screen that belongs to nobody
     boss   whether this screen may run the table
     send   how a message reaches the table
   A widget wires its own buttons, once, the first time it draws them, so a
   page only ever calls it on every state and adds nothing. Nothing here reads
   the page: a part a page does not have is simply not drawn. */
const Lobby = (function () {
  const q = (root, sel) => (root ? root.querySelector(sel) : null);
  const text = (root, sel, v) => { const el = q(root, sel); if (el) el.textContent = v; };
  // A button is wired the first time it is drawn, and never twice.
  const onClick = (el, fn) => { if (el && !el._wired) { el._wired = true; el.addEventListener('click', fn); } };

  /* The seats, in the order of play. Whoever runs the table drags a seat by
     its handle to change the order, and gets a ⋯ menu on each row: hand the
     table over (never to a bot), say who deals first, remove it (never their
     own). */
  function seats(root, ST, view) {
    if (!root) return;
    root._last = { ST, view };
    if (root._drag) return;              // a row is held: it is redrawn on the drop
    root.innerHTML = '';
    ST.seats.forEach((s, i) => {
      const isFirst = ST.firstDealerId ? ST.firstDealerId === s.id : i === 0;
      const isCap = s.id === ST.captainId;
      const mine = i === view.me;
      const row = document.createElement('div');
      row.className = 'seat-item' + (mine ? ' me' : '') + (s.online ? '' : ' off') +
        (isFirst ? ' first-dealer' : '') + (s.bot ? ' bot' : '');
      row.innerHTML = `<span class="seat">${i + 1}</span><span class="nm"></span>` +
        // One word each: the row is one line, and the name takes what is left.
        (isCap ? '<span class="badge" title="runs the table">host</span>' : '') +
        (s.bot ? '<span class="badge soft" title="a player the table provides">bot</span>' : '') +
        (isFirst ? '<span class="badge soft" title="deals the first round">dealer</span>' : '') +
        `<span class="dotstat" title="${s.online ? 'connected' : 'not connected'}"></span>`;
      row.querySelector('.nm').textContent = s.name + (mine ? ' (you)' : '');
      if (view.boss) {
        row.insertBefore(grip(root, row, s, view), row.firstChild);
        const more = seatMenu(row, s, i, { isFirst, isCap, mine, n: ST.seats.length }, view);
        if (more) row.appendChild(more);
      }
      root.appendChild(row);
    });
  }

  const GRIP = '<svg viewBox="0 0 20 20" aria-hidden="true">'
    + '<circle cx="7" cy="4.5" r="1.7"/><circle cx="13" cy="4.5" r="1.7"/>'
    + '<circle cx="7" cy="10" r="1.7"/><circle cx="13" cy="10" r="1.7"/>'
    + '<circle cx="7" cy="15.5" r="1.7"/><circle cx="13" cy="15.5" r="1.7"/></svg>';

  /* The order of play is changed by dragging a seat by its handle. Pointer
     events, so a finger and a mouse are the same, and the handle takes the
     touches so the page does not scroll under it. The held row follows the
     pointer and the rows it passes step aside; the drop sends where it
     landed, once, and the state that comes back draws the new order. While
     a row is held the list is not redrawn: a state landing mid-drag would
     pull the row out from under the finger. */
  function grip(root, row, s, view) {
    const h = document.createElement('button');
    h.type = 'button';
    h.className = 'grip';
    h.title = 'Drag to change the order of play';
    h.setAttribute('aria-label', `Drag ${s.name} to a new place`);
    h.innerHTML = GRIP;
    h.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      closeSeatMenus();
      const rows = Array.prototype.slice.call(root.querySelectorAll('.seat-item'));
      const from = rows.indexOf(row);
      if (from < 0) return;
      // One place is the distance between two rows; a list of one is a row tall.
      const r0 = rows[0].getBoundingClientRect();
      const step = rows.length > 1 ? rows[1].getBoundingClientRect().top - r0.top : 0;
      const d = { from, to: from, y: e.clientY, pitch: step > 0 ? step : (r0.height || 1) };
      root._drag = d;
      row.classList.add('dragging');
      if (h.setPointerCapture) { try { h.setPointerCapture(e.pointerId); } catch (x) { /* a mouse, or an old browser */ } }
      const move = (ev) => {
        const dy = ev.clientY - d.y;
        d.to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / d.pitch)));
        row.style.transform = `translateY(${dy}px)`;
        rows.forEach((el, i) => {
          if (el === row) return;
          let shift = 0;
          if (from < d.to && i > from && i <= d.to) shift = -d.pitch;
          else if (from > d.to && i >= d.to && i < from) shift = d.pitch;
          el.style.transform = shift ? `translateY(${shift}px)` : '';
        });
      };
      const done = () => {
        h.removeEventListener('pointermove', move);
        h.removeEventListener('pointerup', done);
        h.removeEventListener('pointercancel', done);
        root._drag = null;
        rows.forEach((el) => { el.style.transform = ''; el.classList.remove('dragging'); });
        if (d.to !== from) view.send({ t: 'seatMove', id: s.id, to: d.to });
        else if (root._last) seats(root, root._last.ST, root._last.view);   // a state may have landed meanwhile
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', done);
      h.addEventListener('pointercancel', done);
    });
    return h;
  }

  /* The controls on a seat, behind one ⋯ button and named. A row of glyphs
     (★ 🂠 ↑ ↓ ×) told a first-time host nothing -- a title does not show on a
     touch screen -- and the card back is a box on many Android fonts. The
     order is changed by dragging, so the menu has no Move rows. Every row
     does something: a seat is not offered what it already is, and a seat
     with nothing left to offer has no ⋯ at all. */
  function seatMenu(row, s, i, is, view) {
    const items = [];
    // Not on the seat that already runs the table: a row that does nothing.
    if (!s.bot && !is.isCap) {
      items.push({ label: 'Make table host', run: () => view.send({ t: 'captain', id: s.id }) });
    }
    if (!is.isFirst) {
      items.push({ label: 'Make dealer', run: () => view.send({ t: 'dealer', id: s.id }) });
    }
    if (!is.mine) {
      items.push({ label: 'Kick', danger: true, run: () => view.send({ t: 'kick', id: s.id }) });
    }
    // The ⋯ itself, how it opens and how it shuts, is every list's alike.
    return Table.rowMenu(row, items, s.name);
  }
  const closeSeatMenus = Table.closeRowMenus;

  /* Players the table provides, for a hand short of people. They hold cards,
     so they belong to a table that deals them. `root` is the row: the button
     and its hint. Only whoever runs the table sees it. */
  function bots(root, ST, view) {
    if (!root) return;
    root.hidden = !view.boss;
    if (!view.boss) return;
    const count = ST.seats.filter((s) => s.bot).length;
    const full = ST.seats.length >= 8;
    const btn = q(root, '#btn-addbot');
    if (btn) {
      btn.disabled = full;
      btn.textContent = count ? '+ Add another bot' : '+ Add a bot';
      onClick(btn, () => view.send({ t: 'addbot' }));
    }
    /* Nothing at all before the first one is added: what a bot is, is plain
       from the button, and the rules above say what the cards are doing. Only
       once there are bots is there something the button does not say -- how
       many of the seats are playing themselves. */
    text(root, '#bot-hint', full ? 'The table is full.'
      : count ? `${count} of the ${ST.seats.length} seats play themselves.`
      : '');
  }

  // Start needs two players, and somebody who may press it.
  function startButton(btn, ST, view) {
    if (!btn) return;
    const n = ST.seats.length;
    btn.disabled = n < 2 || !view.boss;
    btn.textContent = n < 2 ? 'Waiting for players…' : `Start game with ${n} players`;
    onClick(btn, () => view.send({ t: 'start' }));
  }

  // Every rule, the field it is typed in, and which property of the field
  /* ---------- the rules ----------
     Every rule once: the field it is typed in, the words on it, and the line
     under it. One list builds the form on every screen that has one, fills it
     from the rules in force, and reads a change back. The pages carry an
     empty mount and nothing else, so the wording cannot drift between them
     -- which it had: three copies, three sets of words. */
  const OPTIONS = {
    pattern: [['downup', 'Down then up'], ['updown', 'Up then down'], ['down', 'Down only'], ['up', 'Up only']],
    bonus: [[10, '10 + tricks won'], [5, '5 + tricks won'], [1, '1 + tricks won'], [0, 'tricks won only']],
    // Short enough for a phone's select; the line under the field says it in full.
    miss: [['atleast', 'Must make it · short pays 0'], ['atleastdiff', 'Must make it · short pays −1 each'],
           ['zero', '0 points'], ['diff', '−1 per trick off'], ['tricks', 'Tricks won only']],
    accoladeCount: [[0, 'none'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']],
    accoladePay: [[20, '20 points'], [10, '10 points'], [5, '5 points'], [0, 'nothing']],
  };
  /* A rule answered by two regions rather than by a list. What kind of cards
     are on the table decides what everybody will be doing for the whole game
     -- dealing a real deck between them, or watching their own phone -- so
     both answers stand on the page at once, each saying what it means. The
     words are here and nowhere else: there is no line under the rule to keep
     in step with it. */
  const MODES = {
    deck: [
      { v: 'physical', icon: '\uD83C\uDCCF', label: 'Real cards',
        says: 'You deal a real deck. The dealer types in the tricks at the end of a round.',
        // The table refuses this one while a bot is seated, so the region says
        // why instead of how, and cannot be pressed.
        shut: (ST) => Game.mustDeal(ST),
        why: 'Not while a player the table provides is sitting there: a bot has no cards to hold.' },
      { v: 'virtual', icon: '\uD83D\uDCF1', label: 'Virtual cards',
        says: 'The server deals to each phone, turns the trump, and counts the tricks.' },
    ],
  };
  // The field's id, the rule it holds, what kind of field, its label, and a
  // fixed line under it. The lines that depend on the rules are written in
  // rulesForm, into `<id>-hint`.
  const RULES = [
    { id: 'cfg-deck', key: 'deck', kind: 'mode', label: 'Cards' },
    { id: 'cfg-max', key: 'max', kind: 'number', label: 'Biggest hand', min: 1 },
    { id: 'cfg-ones', key: 'ones', kind: 'number', label: 'Rounds of 1 card', min: 1, max: 8,
      hint: 'One per player, so everybody deals it.' },
    { id: 'cfg-pattern', key: 'pattern', kind: 'select', label: 'Round pattern' },
    { id: 'cfg-bonus', key: 'bonus', kind: 'select', label: 'Exact bid pays' },
    { id: 'cfg-miss', key: 'miss', kind: 'select', label: 'Missed bid pays' },
    { id: 'cfg-screw', key: 'screw', kind: 'check', label: 'Screw the dealer',
      hint: 'The dealer may not bid the number that would make the bids total the tricks.' },
    { id: 'cfg-trump', key: 'trump', kind: 'check', label: 'Turn a card for trumps' },
    { id: 'cfg-accolade-which', key: 'accolades', kind: 'picks', label: 'Accolades' },
    { id: 'cfg-accolade-count', key: 'accoladeCount', kind: 'select', label: 'How many are drawn',
      hint: 'Prizes for how you played, drawn at random when the game ends.' },
    { id: 'cfg-accolade-pay', key: 'accoladePay', kind: 'select', label: 'Each one pays' },
  ];
  /* How the fields sit: groups, a hairline between one and the next, and two
     abreast inside a group where they read as a pair. What kind of cards are
     being played comes first -- it decides what everybody at the table will
     be doing -- then the shape of the game, what a bid pays, the two
     variants, and last the prizes at the end, which change no play at all. */
  const LAYOUT = [
    ['cfg-deck'],
    [['cfg-max', 'cfg-ones'], 'cfg-pattern'],
    [['cfg-bonus', 'cfg-miss']],
    [{ toggles: ['cfg-screw', 'cfg-trump'] }],
    ['cfg-accolade-which', ['cfg-accolade-count', 'cfg-accolade-pay']],
  ];
  const MISS_SAID = {
    atleast: 'Over the bid pays the tricks won; short of it pays 0.',
    atleastdiff: 'Over the bid pays the tricks won; short of it pays minus 1 a trick.',
    zero: 'A missed bid pays 0.',
    diff: 'A missed bid pays minus 1 a trick, over or short.',
    tricks: 'A missed bid pays the tricks won.',
  };
  const DEFAULTS = { accoladePay: 10, accoladeCount: 3, deck: 'physical' };
  const byId = (id) => RULES.find((r) => r.id === id);

  // The accolades a game can hand out, named where they are worked out.
  const ACC = () => (typeof Accolades === 'undefined' ? [] : Accolades.ALL);

  const make = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  };

  function field(r) {
    /* A rule that is a list to tick through: which accolades this table hands
       out. Folded away, because eleven switches would be the longest thing in
       the rules by far and most tables never touch them. */
    if (r.kind === 'picks') {
      const box = make('details', 'capset accset');
      box.id = r.id;
      const sum = make('summary');
      sum.append(make('span', 'capset-name', r.label), make('small', 'capset-sum'));
      const list = make('div', 'toggles');
      ACC().forEach((a) => {
        const row = make('div', 'switchrow');
        const lab = make('label', 'switch');
        const el = make('input');
        el.type = 'checkbox';
        el.id = 'acc-' + a.key;
        lab.append(el, make('span', '', a.title));
        row.appendChild(lab);
        // What it takes to be given it, under the name of it.
        if (a.how) row.appendChild(make('small', '', a.how));
        list.appendChild(row);
      });
      box.append(sum, list);
      return box;
    }
    /* Two regions side by side, each an outline with the mark of the mode at
       its left and what the mode means beside it. The radio inside is what a
       keyboard and a reader use; the outline is what an eye uses. */
    if (r.kind === 'mode') {
      const wrap = make('div', 'field');
      wrap.appendChild(make('span', '', r.label));
      const pick = make('div', 'modepick');
      pick.id = r.id;
      MODES[r.key].forEach((m) => {
        const box = make('label', 'mode');
        const el = make('input');
        el.type = 'radio';
        el.name = r.id;
        el.value = String(m.v);
        el.id = r.id + '-' + m.v;
        const said = make('div', 'mode-said');
        const words = make('small', '', m.says);
        words.id = el.id + '-says';
        said.append(make('b', '', m.label), words);
        box.append(el, make('span', 'mode-icon', m.icon), said);
        pick.appendChild(box);
      });
      wrap.appendChild(pick);
      return wrap;
    }
    if (r.kind === 'check') {
      const row = make('div', 'switchrow');
      row.id = r.id + '-row';               // the row is what a rule hides itself by
      const lab = make('label', 'switch');
      const el = make('input');
      el.type = 'checkbox';
      el.id = r.id;
      lab.append(el, make('span', '', r.label));
      row.appendChild(lab);
      if (r.hint) row.appendChild(make('small', '', r.hint));
      return row;
    }
    const lab = make('label', 'field');
    lab.appendChild(make('span', '', r.label));
    let el, box = null;
    if (r.kind === 'select') {
      el = make('select');
      OPTIONS[r.key].forEach(([v, t]) => {
        const o = make('option', '', t);
        o.value = String(v);
        el.appendChild(o);
      });
      // The caret is drawn on this, not by the browser: one shape for every
      // thing on the page that opens, and room of its own on the right.
      box = make('div', 'selbox');
      box.appendChild(el);
    } else {
      el = make('input');
      el.type = 'number';
      if (r.min !== undefined) el.min = String(r.min);
      if (r.max !== undefined) el.max = String(r.max);
    }
    el.id = r.id;
    const small = make('small', '', r.hint || '');
    small.id = r.id + '-hint';
    lab.append(box || el, small);
    return lab;
  }

  function buildRules(root) {
    root.classList.add('rules-form');
    LAYOUT.forEach((rows) => {
      const group = make('div', 'rules-group');
      rows.forEach((row) => {
        if (typeof row === 'string') { group.appendChild(field(byId(row))); return; }
        const box = make('div', Array.isArray(row) ? 'grid2' : 'toggles');
        (Array.isArray(row) ? row : row.toggles).forEach((id) => box.appendChild(field(byId(id))));
        group.appendChild(box);
      });
      root.appendChild(group);
    });
  }

  /* The rules form, built into `root` the first time and kept: the fields
     filled from the rules in force, without fighting the one the host is
     typing in, and the hints under them. A change goes to the table as a
     patch of that one rule. A screen that does not run the table can read
     the rules and not touch them. */
  function rulesForm(root, ST, view) {
    if (!root) return;
    if (!root._built) { root._built = true; buildRules(root); }
    const c = ST.cfg, n = Math.max(2, ST.seats.length), cap = Game.maxCardsFor(n);
    const max = q(root, '#cfg-max');
    if (max) max.max = String(cap);
    RULES.forEach((r) => {
      if (r.kind === 'picks' || r.kind === 'mode') return;   // each has a filler of its own, below
      const el = q(root, '#' + r.id);
      if (!el) return;
      const v = c[r.key] === undefined ? DEFAULTS[r.key] : c[r.key];
      if (r.kind === 'check') el.checked = !!v;
      else if (document.activeElement !== el) el.value = String(v);
      el.disabled = !view.boss;
      if (!el._wired) {
        el._wired = true;
        el.addEventListener('change', () => view.send({ t: 'config',
          patch: { [r.key]: r.kind === 'check' ? el.checked : el.value } }));
      }
    });
    // With real cards the deck on the table decides everything about trumps.
    const trumpRow = q(root, '#cfg-trump-row');
    if (trumpRow) trumpRow.hidden = !Game.virtual(ST);
    text(root, '#cfg-max-hint', `Up to ${cap} cards each with ${n} players.`);
    const cards = Game.schedule(c.max, c.pattern, c.ones);
    text(root, '#cfg-pattern-hint', `${cards.length} rounds: ${cards.join(' ')}`);
    const ex = (w) => Game.roundScore(2, w, c);
    modePicks(root, ST, view);
    accoladePicks(root, ST, view);
    // The rule, then the same rule counted out: two lines, not one long one.
    text(root, '#cfg-miss-hint',
      `${MISS_SAID[c.miss] || ''}\nBid 2: win 3 = ${ex(3)} · win 2 = ${ex(2)} · win 1 = ${ex(1)}`);
  }

  /* A rule answered by regions. The one in force wears the outline, and a
     screen that may not run the table wears them both grey: a region that
     cannot be pressed should not look as though it can. */
  function modePicks(root, ST, view) {
    RULES.filter((r) => r.kind === 'mode').forEach((r) => {
      const pick = q(root, '#' + r.id);
      if (!pick) return;
      const now = String(ST.cfg[r.key] === undefined ? DEFAULTS[r.key] : ST.cfg[r.key]);
      MODES[r.key].forEach((m) => {
        const el = q(pick, '#' + r.id + '-' + m.v);
        if (!el) return;
        const on = String(m.v) === now;
        // Shut is the table's own answer, not this screen's: what it would
        // refuse is not offered. A screen that may not act greys them both.
        const shut = !!(m.shut && m.shut(ST)) && !on;
        el.checked = on;
        el.disabled = !view.boss || shut;
        if (el.parentNode) {
          el.parentNode.classList.toggle('on', on);
          el.parentNode.classList.toggle('shut', shut);
        }
        text(pick, '#' + el.id + '-says', shut ? m.why : m.says);
        if (!el._wired) {
          el._wired = true;
          el.addEventListener('change', () => view.send({ t: 'config', patch: { [r.key]: m.v } }));
        }
      });
      pick.classList.toggle('off', !view.boss);
    });
  }

  /* Which accolades this table hands out. Nothing chosen is all of them, so
     a table that has never been asked plays with the lot. Every change sends
     the whole list: what is not on it is what was unticked. */
  function accoladePicks(root, ST, view) {
    const box = q(root, '#cfg-accolade-which');
    if (!box) return;
    const all = ACC();
    // None drawn at all, nothing to choose between.
    box.hidden = Number(ST.cfg.accoladeCount) === 0;
    const chosen = Array.isArray(ST.cfg.accolades) ? ST.cfg.accolades : all.map((a) => a.key);
    all.forEach((a) => {
      const el = q(box, '#acc-' + a.key);
      if (!el) return;
      el.checked = chosen.indexOf(a.key) >= 0;
      el.disabled = !view.boss;
      if (!el._wired) {
        el._wired = true;
        el.addEventListener('change', () => view.send({ t: 'config',
          patch: { accolades: all.map((x) => x.key).filter((k) => (q(box, '#acc-' + k) || {}).checked) } }));
      }
    });
    text(box, '.capset-sum', all.length ? `${chosen.length} of ${all.length}` : '');
  }

  /* The rules in force, in a line: what a screen shows where the form itself
     is folded away. The three that change how a hand is played, in the order
     a table asks about them. */
  function rulesLine(ST) {
    const c = ST.cfg;
    const n = Game.schedule(c.max, c.pattern, c.ones).length;
    const bits = [`${n} round${n === 1 ? '' : 's'}`,
                  Game.virtual(ST) ? 'dealt on the phones' : 'real cards'];
    if (c.screw) bits.push('screw the dealer');
    return bits.join(' · ');
  }

  return { seats, bots, startButton, rulesForm, rulesLine };
})();
