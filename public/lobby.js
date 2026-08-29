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

  /* The seats, in the order of play. Whoever runs the table gets the controls
     on each row: ★ hands the table over (never to a bot, which cannot run
     it), 🂠 says who deals first, ↑ ↓ reorder, × removes (never yourself). */
  function seats(root, ST, view) {
    if (!root) return;
    root.innerHTML = '';
    ST.seats.forEach((s, i) => {
      const isFirst = ST.firstDealerId ? ST.firstDealerId === s.id : i === 0;
      const isCap = s.id === ST.captainId;
      const mine = i === view.me;
      const row = document.createElement('div');
      row.className = 'seat-item' + (mine ? ' me' : '') + (s.online ? '' : ' off') +
        (isFirst ? ' first-dealer' : '') + (s.bot ? ' bot' : '');
      row.innerHTML = `<span class="seat">${i + 1}</span><span class="nm"></span>` +
        (isCap ? '<span class="badge">table host</span>' : '') +
        (s.bot ? '<span class="badge soft">bot</span>' : '') +
        (isFirst ? '<span class="badge soft">deals first</span>' : '') +
        `<span class="dotstat" title="${s.online ? 'connected' : 'not connected'}"></span>` +
        (view.boss
          ? (s.bot ? '' : `<button class="mini" data-a="cap" title="Make this player the table host" aria-pressed="${isCap}">★</button>`) +
            `<button class="mini d" data-a="deal" title="This player deals the first round" aria-pressed="${isFirst}">🂠</button>` +
            '<button class="mini" data-a="up" title="Move up">↑</button>' +
            '<button class="mini" data-a="down" title="Move down">↓</button>' +
            (mine ? '' : '<button class="mini x" data-a="kick" title="Remove">×</button>')
          : '');
      row.querySelector('.nm').textContent = s.name + (mine ? ' (you)' : '');
      row.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        const a = b.dataset.a;
        if (a === 'kick') view.send({ t: 'kick', id: s.id });
        else if (a === 'cap') view.send({ t: 'captain', id: s.id });
        else if (a === 'deal') view.send({ t: 'config', patch: { firstDealer: isFirst ? null : s.id } });
        else view.send({ t: 'seatMove', id: s.id, dir: a });
      }));
      root.appendChild(row);
    });
  }

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
    text(root, '#bot-hint', full ? 'The table is full.'
      : count ? `${count} of the ${ST.seats.length} seats play themselves.`
      : Game.virtual(ST) ? 'It plays its own hand. Remove it with ×.'
      : 'It plays its own hand, so the cards move to the phones.');
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
    miss: [['atleast', 'must make the bid: over pays tricks won, short pays 0'],
           ['atleastdiff', 'must make the bid: over pays tricks won, short pays minus 1 each'],
           ['zero', '0 points'], ['diff', 'minus 1 per trick off'], ['tricks', 'tricks won only']],
    deck: [['physical', 'Real cards on the table'], ['virtual', 'Deal on the phones']],
    accoladeCount: [[0, 'none'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']],
    accoladePay: [[20, '20 points'], [10, '10 points'], [5, '5 points'], [0, 'nothing']],
  };
  // The field's id, the rule it holds, what kind of field, its label, and a
  // fixed line under it. The lines that depend on the rules are written in
  // rulesForm, into `<id>-hint`.
  const RULES = [
    { id: 'cfg-max', key: 'max', kind: 'number', label: 'Biggest hand (cards)', min: 1 },
    { id: 'cfg-ones', key: 'ones', kind: 'number', label: 'Rounds of 1 card', min: 1, max: 8,
      hint: 'One per player, so everybody deals it.' },
    { id: 'cfg-pattern', key: 'pattern', kind: 'select', label: 'Round pattern' },
    { id: 'cfg-bonus', key: 'bonus', kind: 'select', label: 'Exact bid pays' },
    { id: 'cfg-miss', key: 'miss', kind: 'select', label: 'Missed bid pays' },
    { id: 'cfg-screw', key: 'screw', kind: 'check', label: 'Screw the dealer (bids must not total the tricks)' },
    { id: 'cfg-trump', key: 'trump', kind: 'check', label: 'Turn a card for trumps' },
    { id: 'cfg-deck', key: 'deck', kind: 'select', label: 'Cards' },
    { id: 'cfg-accolade-count', key: 'accoladeCount', kind: 'select', label: 'Accolades drawn',
      hint: 'Drawn at random when the game ends.' },
    { id: 'cfg-accolade-pay', key: 'accoladePay', kind: 'select', label: 'Each one pays',
      hint: 'Added before the winner is known.' },
  ];
  // How the fields sit: two abreast where they read as a pair.
  const LAYOUT = [['cfg-max', 'cfg-ones'], 'cfg-pattern', ['cfg-bonus', 'cfg-miss'],
                  { toggles: ['cfg-screw', 'cfg-trump'] }, 'cfg-deck', ['cfg-accolade-count', 'cfg-accolade-pay']];
  const DEFAULTS = { accoladePay: 10, accoladeCount: 3, deck: 'physical' };
  const byId = (id) => RULES.find((r) => r.id === id);

  const make = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  };

  function field(r) {
    if (r.kind === 'check') {
      const lab = make('label', 'switch');
      lab.id = r.id + '-row';
      const el = make('input');
      el.type = 'checkbox';
      el.id = r.id;
      lab.append(el, make('span', '', r.label));
      return lab;
    }
    const lab = make('label', 'field');
    lab.appendChild(make('span', '', r.label));
    let el;
    if (r.kind === 'select') {
      el = make('select');
      OPTIONS[r.key].forEach(([v, t]) => {
        const o = make('option', '', t);
        o.value = String(v);
        el.appendChild(o);
      });
    } else {
      el = make('input');
      el.type = 'number';
      if (r.min !== undefined) el.min = String(r.min);
      if (r.max !== undefined) el.max = String(r.max);
    }
    el.id = r.id;
    const small = make('small', '', r.hint || '');
    small.id = r.id + '-hint';
    lab.append(el, small);
    return lab;
  }

  function buildRules(root) {
    LAYOUT.forEach((row) => {
      if (typeof row === 'string') { root.appendChild(field(byId(row))); return; }
      const box = make('div', Array.isArray(row) ? 'grid2' : 'toggles');
      (Array.isArray(row) ? row : row.toggles).forEach((id) => box.appendChild(field(byId(id))));
      root.appendChild(box);
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
    text(root, '#cfg-deck-hint', Game.virtual(ST)
      ? 'The server deals to each phone, turns the trump, and counts the tricks.'
      : 'You deal real cards. The dealer types in the tricks at the end of a round.');
    text(root, '#cfg-max-hint', `Up to ${cap} cards each with ${n} players.`);
    const cards = Game.schedule(c.max, c.pattern, c.ones);
    text(root, '#cfg-pattern-hint', `${cards.length} rounds: ${cards.join(' ')}`);
    const ex = (w) => Game.roundScore(2, w, c);
    text(root, '#cfg-miss-hint', `Bid 2: win 3 = ${ex(3)} · win 2 = ${ex(2)} · win 1 = ${ex(1)}`);
  }

  return { seats, bots, startButton, rulesForm };
})();
