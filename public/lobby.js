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
        (isCap ? '<span class="badge">host</span>' : '') +
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
  // holds it. The same list writes the form and reads it back.
  const RULES = [
    ['#cfg-max', 'max', 'value'], ['#cfg-ones', 'ones', 'value'], ['#cfg-pattern', 'pattern', 'value'],
    ['#cfg-bonus', 'bonus', 'value'], ['#cfg-miss', 'miss', 'value'],
    ['#cfg-screw', 'screw', 'checked'], ['#cfg-trump', 'trump', 'checked'],
    ['#cfg-deck', 'deck', 'value'],
    ['#cfg-accolade-pay', 'accoladePay', 'value'], ['#cfg-accolade-count', 'accoladeCount', 'value'],
  ];
  const DEFAULTS = { accoladePay: 10, accoladeCount: 3, deck: 'physical' };

  /* The rules form: the fields filled from the rules in force, without
     fighting the one the host is typing in, and the hints under them. A
     change goes to the table as a patch of that one rule. A screen that does
     not run the table can read the rules and not touch them. */
  function rulesForm(root, ST, view) {
    if (!root) return;
    const c = ST.cfg, n = Math.max(2, ST.seats.length), cap = Game.maxCardsFor(n);
    const max = q(root, '#cfg-max');
    if (max) max.max = String(cap);
    RULES.forEach(([sel, key, prop]) => {
      const el = q(root, sel);
      if (!el) return;
      const v = c[key] === undefined ? DEFAULTS[key] : c[key];
      if (prop === 'checked') el.checked = !!v;
      else if (document.activeElement !== el) el.value = String(v);
      el.disabled = !view.boss;
      if (!el._wired) {
        el._wired = true;
        el.addEventListener('change', () => view.send({ t: 'config', patch: { [key]: el[prop] } }));
      }
    });
    // With real cards the deck on the table decides everything about trumps.
    const trumpRow = q(root, '#cfg-trump-row');
    if (trumpRow) trumpRow.hidden = !Game.virtual(ST);
    text(root, '#deck-hint', Game.virtual(ST)
      ? 'The server deals to each phone, turns the trump, and counts the tricks.'
      : 'You deal real cards. The dealer types in the tricks at the end of a round.');
    text(root, '#max-hint', `Up to ${cap} cards each with ${n} players.`);
    const cards = Game.schedule(c.max, c.pattern, c.ones);
    text(root, '#rounds-hint', `${cards.length} rounds: ${cards.join(' ')}`);
    const ex = (w) => Game.roundScore(2, w, c);
    text(root, '#miss-hint', `Bid 2: win 3 = ${ex(3)} · win 2 = ${ex(2)} · win 1 = ${ex(1)}`);
  }

  return { seats, bots, startButton, rulesForm };
})();
