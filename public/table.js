'use strict';
/* The scorecard table, shared by the host screen and the player phones. */
const Table = (function () {

  /* A movement on this screen, at the speed the screen is playing at. Every
     one of them is started through here rather than by dividing its own
     numbers: playbackRate scales a delay and a duration together. */
  const move = (el, frames, opts) => UI.paced(el.animate(frames, opts));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ST is the state from the server. `me` marks one column, or -1 for none.
     `edit` makes a scored round's own cell a button: whoever runs the table
     taps it to put that round's numbers right. Every other screen, and the
     history page, passes nothing and gets the card it always had. */
  function scorecardHTML(ST, me, edit) {
    const run = ST.seats.map(() => 0);
    let html = '<thead><tr><th>Round</th>';
    ST.seats.forEach((s, i) => {
      /* The name at the head of a column is the name on the scorecard, so for
         whoever runs the table it is also where the name is changed. Not a
         bot's: that name is the table's own, not a person's. */
      const name = (edit && !s.bot)
        ? `<button type="button" class="nameedit" data-seat="${i}" ` +
          `title="Change this name">${esc(s.name)}</button>`
        : esc(s.name);
      html += `<th class="${i === me ? 'mecol' : ''}">${name}</th>`;
    });
    html += '</tr></thead><tbody>';

    ST.rounds.forEach((r, i) => {
      const suit = ST.cfg.trump && r.trump ? ' ' + Game.SUITS.find((s) => s.k === r.trump).g : '';
      const done = Game.roundDone(r);
      const cls = done ? '' : (i === ST.idx ? 'current' : '');
      const label = `${i + 1} · ${r.cards}${esc(suit)}`;
      html += `<tr class="${cls}"><td>` + ((edit && done)
        ? `<button type="button" class="roundedit" data-round="${i}" ` +
          `title="Put this round's numbers right">${label}</button>`
        : label) + '</td>';
      ST.seats.forEach((_, p) => {
        const mecol = p === me ? ' mecol' : '';
        if (Game.roundDone(r)) {
          const pts = Game.roundScore(r.bids[p], r.tricks[p], ST.cfg);
          run[p] += pts;
          const hit = r.bids[p] === r.tricks[p];
          /* One figure, and the way to put it right: the cell a wrong number
             is read in is the cell it is retyped in. The sheet it opens is
             still the whole round -- the tricks have to total the hand, and a
             trick taken off one seat has to land on another -- but it opens
             on the seat that was tapped. */
          const cell = `<span class="cell"><span class="bidwon ${hit ? 'hit' : 'miss'}">` +
            `${r.bids[p]}→${r.tricks[p]} (${pts >= 0 ? '+' : ''}${pts})</span>` +
            `<span class="run">${run[p]}</span></span>`;
          html += `<td class="${mecol.trim()}">` + (edit
            ? `<button type="button" class="celledit" data-round="${i}" data-seat="${p}" ` +
              `title="Put this round's numbers right">${cell}</button>`
            : cell) + '</td>';
        } else if (i === ST.idx && r.bids && r.bids[p] !== null) {
          html += `<td class="${mecol.trim()}"><span class="cell"><span class="bidwon">bid ${r.bids[p]}</span>` +
            `<span class="run">${run[p]}</span></span></td>`;
        } else html += `<td class="${mecol.trim()}">·</td>`;
      });
      html += '</tr>';
    });

    html += '</tbody><tfoot>';
    const bonus = ST.bonus || [];
    if (bonus.some((b) => b)) {                       // what the accolades paid
      html += '<tr class="bonusrow"><td>Accolades</td>';
      bonus.forEach((b, i) => {
        html += `<td class="${i === me ? 'mecol' : ''}">${b ? '+' + b : '·'}</td>`;
      });
      html += '</tr>';
    }
    html += '<tr><td>Total</td>';
    ST.totals.forEach((t, i) => { html += `<td class="${i === me ? 'mecol' : ''}">${t}</td>`; });
    html += '</tr></tfoot>';
    return html;
  }

  /* The card on screen, drawn only when it has something new to say.

     It is built from the state, and a state arrives for everything: a card
     played, a line of talk, a phone coming back. Drawing it parses a table of
     HTML, lays it out, and then reads it back to keep the round in play in
     view -- and most states do not change a single figure on it. So the HTML
     is compared with what is already there, and an unchanged card is left
     exactly as it is. */
  function scorecard(sel, ST, me, view) {
    const box = document.querySelector(sel);
    if (!box) return;
    const edit = !!(view && view.boss);
    /* What the tap will act on, kept fresh whether the card is redrawn or not:
       the listener below is wired once and must never read a stale table. */
    box._state = ST;
    box._view = view || null;
    const html = scorecardHTML(ST, me, edit);
    /* The card is redrawn only when it has something new to say -- and never
       while a round of it is being retyped, which would throw the typing away
       on the next bid anybody makes. */
    if (box._html === html || box._editing) return;
    box._html = html;
    box.innerHTML = html;
    if (edit) wireEdit(box);
    followCurrent(sel);
  }

  /* Tapping a scored round opens it to be put right. The card is rebuilt from
     scratch whenever a figure on it changes, so the listener is the table's
     and not the button's: one, wired once, that reads the round off the tap. */
  function wireEdit(box) {
    if (box._wiredEdit) return;
    box._wiredEdit = true;
    box.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.closest || !box._view || !box._view.boss) return;
      const ST = box._state;
      // A name at the head of its column.
      const named = t.closest('.nameedit');
      if (named) return askName(ST, ST.seats[Number(named.dataset.seat)], box._view);
      // One figure in a round, or the round itself: the same sheet either way,
      // opened on the seat that was tapped where there was one.
      const cell = t.closest('.celledit');
      if (cell) return editRound(box, ST, Number(cell.dataset.round), box._view, Number(cell.dataset.seat));
      const row = t.closest('.roundedit');
      if (row) editRound(box, ST, Number(row.dataset.round), box._view);
    });
  }

  /* One round of the card, retyped. It is a sheet rather than an edit in the
     table itself: the row is four figures wide on a phone before it carries
     any boxes, and the thing being checked -- that the tricks total the hand --
     belongs under them where it can be read as it changes.

     The whole row goes at once, because the check is a row's. A trick taken
     off one seat has to land on another, and a cell sent on its own could
     never satisfy that. */
  function editRound(box, ST, i, view, seat) {
    const r = ST.rounds[i];
    if (!r || !Game.roundDone(r)) return;
    let d = document.getElementById('round-edit');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'round-edit';
      document.body.appendChild(d);
    }
    while (d.firstChild) d.firstChild.remove();          // built afresh each time

    const el = (tag, cls, txt) => {
      const x = document.createElement(tag);
      if (cls) x.className = cls;
      if (txt !== undefined) x.textContent = txt;
      return x;
    };
    d.appendChild(el('h2', '', `Round ${i + 1} · ${r.cards} card${r.cards === 1 ? '' : 's'}`));
    const rows = el('div', 'edit-rows');
    const bidBox = [], wonBox = [];
    const head = el('div', 'edit-row edit-head');
    head.append(el('span', 'nm', ''), el('span', '', 'bid'), el('span', '', 'won'));
    rows.appendChild(head);
    ST.seats.forEach((s, p) => {
      // The seat that was tapped is marked, so a sheet opened from one cell
      // says which figure the tap was about.
      const row = el('div', 'edit-row' + (p === seat ? ' asked' : ''));
      const num = (v) => {
        const x = document.createElement('input');
        x.type = 'number';
        x.min = '0';
        x.max = String(r.cards);
        x.value = String(v);
        return x;
      };
      const b = num(r.bids[p]), w = num(r.tricks[p]);
      bidBox.push(b); wonBox.push(w);
      b.setAttribute('aria-label', `${s.name} bid`);
      w.setAttribute('aria-label', `${s.name} won`);
      row.append(el('span', 'nm', s.name), b, w);
      rows.appendChild(row);
    });
    d.appendChild(rows);

    /* The tally, live. It is the one thing a person cannot hold in their head
       while they retype a row, and the one thing the table will refuse. */
    const tally = el('p', 'hint edit-tally');
    d.appendChild(tally);
    const read = (list) => list.map((x) => Math.round(Number(x.value)));
    const bad = (list) => list.some((v) => !Number.isFinite(v) || v < 0 || v > r.cards);
    const save = el('button', 'btn primary', 'Save');
    save.type = 'button';
    function retally() {
      const w = read(wonBox);
      const sum = w.reduce((a, x) => a + (Number.isFinite(x) ? x : 0), 0);
      const right = !bad(w) && !bad(read(bidBox)) && sum === r.cards;
      tally.textContent = `Tricks total ${sum} of ${r.cards}`;
      tally.className = 'hint edit-tally' + (right ? ' ok' : ' off');
      save.disabled = !right;
    }
    bidBox.concat(wonBox).forEach((x) => x.addEventListener('input', retally));
    retally();

    const acts = el('div', 'confirm-actions');
    const cancel = el('button', 'btn ghost', 'Cancel');
    cancel.type = 'button';
    const shut = () => {
      box._editing = false;
      box._html = null;                 // the card was left as it was: draw it afresh
      if (d.close) d.close();
      else d.hidden = true;
    };
    cancel.addEventListener('click', shut);
    save.addEventListener('click', () => {
      view.send({ t: 'score', round: i, bids: read(bidBox), tricks: read(wonBox) });
      shut();
    });
    acts.append(cancel, save);
    d.appendChild(acts);

    box._editing = true;
    if (d.showModal) d.showModal(); else d.hidden = false;
    /* Tapped on one figure, the sheet opens ready to retype it. Tapped on the
       round itself there is no one figure, so nothing is taken. */
    const first = seat >= 0 ? bidBox[seat] : null;
    if (first && first.focus) { first.focus(); if (first.select) first.select(); }
    d.addEventListener('close', () => { box._editing = false; box._html = null; }, { once: true });
  }

  // Scrolls the scorecard box so the round in play stays in view. It moves the
  // box only, never the page.
  function followCurrent(tableSel) {
    const table = document.querySelector(tableSel);
    if (!table) return;
    const box = table.closest('.table-wrap');
    if (!box) return;
    const row = table.querySelector('tbody tr.current') || table.querySelector('tbody tr:last-child');
    if (!row) return;
    const head = table.querySelector('thead');
    const headH = head ? head.getBoundingClientRect().height : 0;
    const target = row.offsetTop - headH - (box.clientHeight - row.offsetHeight - headH) / 2;
    const top = Math.max(0, Math.min(target, box.scrollHeight - box.clientHeight));
    if (Math.abs(box.scrollTop - top) < 2) return;
    if (box.scrollTo) box.scrollTo({ top, behavior: 'smooth' });
    else box.scrollTop = top;
  }

  /* ---------- a ⋯ on a row, and the little menu it opens ---------- */

  /* Two lists of people use one: the seats in the lobby before the game, and
     the standings once it is on. A menu that opened, closed and read
     differently in each would be two behaviours to learn for one gesture, so
     the gesture is written here and each list says only what its rows offer.

     `items` is [{ label, danger, run() }]. A row with nothing to offer gets no
     button at all: a ⋯ that opens an empty menu is worse than no ⋯. */
  function rowMenu(row, items, who) {
    if (!row || !items || !items.length) return null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mini more';
    btn.title = 'Options';
    btn.textContent = '⋯';
    btn.setAttribute('aria-label', who ? `Options for ${who}` : 'Options');
    btn.setAttribute('aria-haspopup', 'true');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = row.querySelector('.seatmenu');
      closeRowMenus();
      if (open) return;                        // the same button shuts it
      const menu = document.createElement('div');
      menu.className = 'menu seatmenu';
      menu.setAttribute('role', 'menu');
      items.forEach((it) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'menu-row menu-tap' + (it.danger ? ' danger' : '');
        const name = document.createElement('span');
        name.className = 'menu-label';
        name.textContent = it.label;
        b.appendChild(name);
        b.addEventListener('click', (e2) => { e2.stopPropagation(); menu.remove(); it.run(); });
        menu.appendChild(b);
      });
      row.appendChild(menu);
    });
    return btn;
  }

  function closeRowMenus() {
    document.querySelectorAll('.seatmenu').forEach((m) => m.remove());
  }

  // A tap anywhere else is the way out that needs no button.
  document.addEventListener('pointerdown', (e) => {
    if (e.target && e.target.closest && e.target.closest('.seatmenu, .mini.more')) return;
    closeRowMenus();
  });

  /* ---------- a card on screen ---------- */

  // tag 'button' makes it playable, anything else just shows it.
  function cardEl(card, tag) {
    const el = document.createElement(tag || 'span');
    el.className = 'pcard' + (Game.cardRed(card) ? ' red' : '');
    el.dataset.card = card;
    const face = document.createElement('b');
    face.textContent = Game.cardFace(card);
    const pip = document.createElement('i');
    pip.textContent = Game.cardGlyph(card);
    el.append(face, pip);
    return el;
  }

  // The cards on the table: the trick being played, or the one just won, and
  // a card back where the next one will land, for the seat the table waits
  // on. Only the slots are cleared, never the whole box: a pile on its way
  // out lives in there too, and it has to see itself off.
  function trickEl(box, ST, me) {
    const p = ST.play;
    Array.prototype.slice.call(box.children).forEach((s) => {
      if (s.classList.contains('slot') && !s.classList.contains('next')) s.remove();
    });
    const held = !!p && !p.trick.length && !!p.last;
    const cards = !p ? [] : held ? (p.last.trick || []) : p.trick;
    cards.forEach((x) => {
      const slot = document.createElement('div');
      slot.className = 'slot' + (held && p.last.winner === x.p ? ' won' : '');
      slot.appendChild(cardEl(x.card));
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = ST.seats[x.p].name + (x.p === me ? ' (you)' : '');
      slot.appendChild(who);
      box.appendChild(slot);
    });
    nextSlot(box, ST, me, p && !held && typeof p.turn === 'number' ? p.turn : null);
  }

  /* The seat the table waits on: a card back stands where their card will
     land, and it peeks (Stage.peek) the way that seat's pile peeks on the
     deal and on the felt -- the one way a screen says who it is waiting on.
     The slot stays across renders while it is the same seat's, so the peek
     is not started over on every state that comes in; it goes with the
     turn, and when nobody is on play. */
  function nextSlot(box, ST, me, q) {
    let slot = box.querySelector('.slot.next');
    if (slot && (q === null || slot._q !== q)) {
      if (slot._peek) slot._peek.cancel();
      slot.remove();
      slot = null;
    }
    if (q === null) return;
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'slot next';
      slot._q = q;
      const back = document.createElement('span');
      back.className = 'pcard back';
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = ST.seats[q].name + (q === me ? ' (you)' : '');
      slot.append(back, who);
      slot._peek = (typeof Stage !== 'undefined' && UI.fx.on()) ? Stage.peek(back, '') : null;
    }
    box.appendChild(slot);       // after the cards played, wherever it stood
  }

  // The trick goes to whoever won it: the cards gather onto the winner's card
  // and the pile settles a little toward them -- down if it is yours, up if it
  // is not. `me` is the seat watching, or -1. Call it on the render that first
  // shows a finished trick.
  function sweepTrick(box, ST, me) {
    const p = ST.play;
    const won = box.querySelector('.slot.won');
    const slots = Array.prototype.slice.call(box.querySelectorAll('.slot'));
    if (!p || !p.last || !won || slots.length < 2 || !UI.fx.on()) return;
    const to = won.getBoundingClientRect();
    const drift = p.last.winner === me ? 26 : -22;
    slots.forEach((slot, i) => {
      if (!slot.animate) return;
      // Only the winner is named once the cards are stacked: four names on one
      // spot is a smear.
      const who = slot !== won && slot.querySelector('.who');
      if (who) {
        move(who, [{ opacity: 1 }, { opacity: 0 }],
          { duration: 200, easing: 'ease-out', fill: 'forwards' });
      }
      const r = slot.getBoundingClientRect();
      const dx = Math.round(to.left - r.left), dy = Math.round(to.top - r.top);
      const tilt = (i - (slots.length - 1) / 2) * 3.5;
      move(slot, 
        [{ transform: 'translate(0,0) rotate(0deg)', offset: 0 },
         { transform: `translate(${dx}px,${dy}px) rotate(${tilt}deg)`, offset: .42,
           easing: 'cubic-bezier(.25,.85,.3,1.05)' },
         { transform: `translate(${dx}px,${dy + drift * 0.45}px) rotate(${tilt}deg)`, offset: .68 },
         { transform: `translate(${dx}px,${dy + drift}px) rotate(${tilt}deg)`, offset: 1 }],
        { duration: 620, easing: 'ease-out', fill: 'forwards' });
    });
    UI.fx.pop(won.querySelector('.pcard'), 1.16);
  }

  // The pile a trick was gathered into is swept away as the next card lands:
  // it carries on the way it was already leaning, so the two read as one move.
  // `drift` is how far and which way. Returns true if anything left.
  function sweepOut(box, drift) {
    const slots = Array.prototype.slice.call(box.querySelectorAll(':scope > .slot'));
    if (!slots.length || !UI.fx.on() || !box.animate) return false;
    const br = box.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'trickghost';
    slots.forEach((s) => {
      // Read where it actually sits -- the gather left a transform on it --
      // then drop the transform and pin it there, so the pile can leave as
      // one piece without the new card having to wait for it.
      const r = s.getBoundingClientRect();
      s.getAnimations().forEach((a) => { try { a.cancel(); } catch (e) {} });
      s.style.position = 'absolute';
      s.style.left = `${Math.round(r.left - br.left)}px`;
      s.style.top = `${Math.round(r.top - br.top)}px`;
      ghost.appendChild(s);
    });
    box.appendChild(ghost);
    const out = move(ghost, 
      [{ transform: 'translateY(0) scale(1)', opacity: 1 },
       { transform: `translateY(${drift}px) scale(.86)`, opacity: 0 }],
      { duration: 220, easing: 'cubic-bezier(.4,0,.7,.4)', fill: 'forwards' });
    out.onfinish = () => ghost.remove();
    return true;
  }

  // The cards that replace it come up as it goes.
  function trickIn(box) {
    if (!UI.fx.on()) return;
    Array.prototype.forEach.call(box.querySelectorAll(':scope > .slot'), (s) => {
      if (!s.animate) return;
      move(s, [{ opacity: 0, transform: 'translateY(10px) scale(.96)' },
                 { opacity: 1, transform: 'none' }],
        { duration: 200, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
    });
  }

  /* ---------- the round on screen ---------- */

  // The deal on screen belongs to one round and one re-deal of it. Every
  // screen keys its deal on this, so the felt, the host and the phone agree.
  const roundKey = (ST) => {
    const r = ST.rounds[ST.idx];
    return r ? `${ST.idx}:${r.redeals || 0}` : null;
  };

  // What the deal scene needs of round i: who sits where, who deals, the hand
  // size, and what the deck turned. Each screen adds its own -- whether the
  // scene holds, the hand it was dealt, how long it lingers.
  function dealOpts(ST, i) {
    const r = ST.rounds[i];
    return { names: ST.seats.map((s) => s.name), dealer: r.dealer, cards: r.cards, round: i + 1,
             deck: ST.cfg.deck, upcard: ST.play ? ST.play.upcard : null, trump: r.trump || null };
  }

  // What the finish needs: the places, and the accolades that were paid into them.
  function finaleOpts(ST) {
    return { names: ST.seats.map((s) => s.name), totals: ST.totals, awards: ST.awards || [],
             points: ST.cfg.accoladePay, bonus: ST.bonus || [] };
  }

  /* ---------- the bids, as they land ---------- */

  // Pops the pill of a bid that has just arrived, and rings the seat that has
  // to act now. `last` is { key, bids, turn } from the render before.
  function bidsAfter(strip, ST, r, last) {
    const key = roundKey(ST);
    const bids = (r.bids || []).slice();
    const mark = { key, bids, turn: ST.turn, landed: [] };
    if (!last || last.key !== key) return mark;         // a new round: nothing landed
    bids.forEach((b, p) => {
      const had = last.bids[p];
      if (b === null || b === undefined) return;
      if (had !== null && had !== undefined) return;    // it was already in
      mark.landed.push(p);
      UI.fx.pop(strip.querySelector(`.bidpill[data-k="${p}"]`));
    });
    if (ST.turn !== null && ST.turn !== last.turn) {
      UI.fx.ring(strip.querySelector(`.bidpill[data-k="${ST.turn}"]`));
    }
    return mark;
  }

  /* A pill says what somebody did while you were looking away. A bot is never
     looked away from: it answers the moment it is asked, so a table with three
     of them kept three lines stacked up through the whole of the bidding, and
     none of them was news. What a bot does is still shown -- its chip pops in
     the strip, its number slams onto its pile on the felt and on the TV -- it
     is only not said.

     A trick is the exception, and stays: the thing that happened there is a
     person tapping who took it, whoever the winner was. */
  const worthSaying = (ST, p) => p >= 0 && !!ST.seats[p] && !ST.seats[p].bot;

  // "Hugh bid 2 · Joe to bid", for the seats that have just bid. `me` is the
  // seat reading it, or -1 for a screen that belongs to nobody. Your own bid
  // is not announced: your own pad already says it.
  function sayBids(ST, r, landed, me) {
    if (!landed || !landed.length) return;
    const others = landed.filter((p) => p !== me && worthSaying(ST, p));
    if (!others.length) return;
    const next = ST.turn === null ? 'all bids in'
      : ST.turn === me ? 'your turn' : `${ST.seats[ST.turn].name} to bid`;
    if (others.length > 2) {                           // a catch-up, not one at a time
      UI.fx.toast(`${others.length} more bids in`, { note: next });
      return;
    }
    others.forEach((p, i) => {
      UI.fx.toast(`${ST.seats[p].name} bid ${r.bids[p]}`,
        { note: i === others.length - 1 ? next : null });
    });
  }

  /* ---------- the standings, the winner, the vote ----------
     The host screen and a player's phone drew these apart, and they drifted:
     the same list, one with "(you)" on it, written twice. They are drawn here
     once, and each page says what is different about its own. */

  /* The running order, tallest bar first. `me` marks one row, or -1 for none.
     Returns what the scores are now, which the caller keeps to see the next
     round's change. */
  /* Who is at the table, and who is not. A bid is announced the moment it
     lands; a phone going quiet is just as much a part of the game, and it is
     the thing that stops it, so it is said the same way.

     `last` is what presence looked like on the state before. The first state a
     page ever sees announces nothing: it is not news that somebody was already
     away when you arrived. */
  function sayPresence(ST, me, last) {
    const now = {};
    ST.seats.forEach((s, p) => { now[s.id] = s.left ? 'left' : (s.online ? 'here' : 'away'); });
    if (!last) return now;
    const waiting = (p) => (ST.phase === 'bid' && ST.turn === p)
      || !!(ST.play && ST.play.turn === p);
    ST.seats.forEach((s, p) => {
      const was = last[s.id];
      if (!was || was === now[s.id] || p === me || !worthSaying(ST, p)) return;
      if (now[s.id] === 'left') {
        UI.fx.toast(`${s.name} left the game`, { note: 'auto-play has that hand now' });
      } else if (now[s.id] === 'away') {
        UI.fx.toast(`${s.name} dropped out`,
          { note: waiting(p) ? 'the table is waiting on them' : 'they can come back to their seat' });
      } else if (was === 'away' || was === 'left') {
        UI.fx.toast(`${s.name} is back`, { note: waiting(p) ? 'their turn' : null });
      }
    });
    return now;
  }

  /* What the round just scored paid, said once, as it lands. The felt holds
     the same words up over the last trick; a phone at a table with real cards
     and the TV screen had nothing but the figures moving. `last` is how many
     rounds were scored on the state before -- the first state a page sees
     says nothing, and a step back says nothing either. `me` is the seat
     reading it, or -1 for a screen that belongs to nobody, which is told what
     everybody got. `quiet` counts without saying: the felt is already saying it. */
  function sayRound(ST, me, last, quiet) {
    const done = ST.rounds.filter(Game.roundDone).length;
    if (last === null || last === undefined || done !== last + 1 || quiet) return done;
    const r = ST.rounds[done - 1];
    const pts = (p) => Game.roundScore(r.bids[p], r.tricks[p], ST.cfg);
    const signed = (v) => `${v > 0 ? '+' : ''}${v}`;
    if (me >= 0) {
      const v = pts(me);
      UI.fx.toast(`${r.bids[me] === r.tricks[me] ? 'You made it' : 'You went down'} · ${signed(v)} point${Math.abs(v) === 1 ? '' : 's'}`,
        { note: `bid ${r.bids[me]} · won ${r.tricks[me]}`, ms: 4000 });
    } else {
      UI.fx.toast(ST.seats.map((s, p) => `${s.name} ${signed(pts(p))}`).join(' · '), { note: `round ${done}`, ms: 4000 });
    }
    return done;
  }

  /* A trick counted at a table with real cards, said as it lands: the phone
     that tapped it knows, the rest do not. `last` is how many were counted
     on the state before. A table dealt on the phones has no count to say. */
  function sayTrick(ST, last) {
    const p = ST.play;
    const k = (p && p.log) ? p.log.length : 0;
    if (last === null || last === undefined || !p || !p.log) return k;
    const r = ST.rounds[ST.idx];
    if (!r) return k;
    if (k === last + 1) UI.fx.toast(`${ST.seats[p.last.winner].name} took the trick`, { note: `trick ${k} of ${r.cards}` });
    else if (k === last - 1) UI.fx.toast('A trick was taken back', { note: `trick ${k + 1} of ${r.cards} again` });
    return k;
  }

  function standings(box, ST, opts) {
    const o = opts || {};
    const me = o.me === undefined ? -1 : o.me;
    const t = ST.totals;
    const order = t.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
    const hi = Math.max(...t), lo = Math.min(0, ...t), span = hi - lo;
    const before = UI.fx.barsBefore(box);

    /* Sliding the rows to their new places means reading where every one of
       them is, before and after. Only a change of places is worth that: a
       score that went up without overtaking anybody leaves the list in the
       order it was already in, and the figures alone change. */
    const places = order.map((row) => ST.seats[row.i].id).join(',');
    const moved = box._places !== undefined && box._places !== places;
    box._places = places;

    const redraw = () => {
      box.innerHTML = '';
      order.forEach((row, rank) => {
        const el = document.createElement('div');
        el.className = 'stand-row' + (row.v === hi && hi !== lo ? ' lead' : '')
          + (row.i === me ? ' me' : '');
        el.dataset.k = ST.seats[row.i].id;
        const w = span > 0 ? Math.round(((row.v - lo) / span) * 100) : 0;
        el.innerHTML = `<span class="rank">${rank + 1}</span><span class="name"></span>` +
          `<span class="pts">${row.v}</span><span class="bar"><i style="width:${w}%"></i></span>`;
        const who = ST.seats[row.i];
        el.querySelector('.name').textContent = who.name + (row.i === me ? ' (you)' : '');
        /* One cell for everything that is not the name or the score: where the
           seat is, and what may be done about it. It is its own cell so the
           name still gives before anything else does. */
        const marks = document.createElement('span');
        marks.className = 'marks';
        el.insertBefore(marks, el.querySelector('.pts'));
        /* Where the seat is, said on the row rather than inside the name: a
           name with a word after it in brackets is still the name on a
           scorecard, and "(left)" said nothing about how long ago. */
        seatMarks(marks, ST, row.i, o.quietAt);
        /* And what may be done about that person, for whoever runs the table.
           This is the one list of everybody that a game in play has, so it is
           where the seat controls live once the lobby is gone. */
        if (o.view && o.view.boss) {
          const more = rowMenu(el, seatItems(ST, row.i, o), who.name);
          if (more) marks.appendChild(more);
        }
        box.appendChild(el);
      });
    };
    if (moved) UI.fx.flip(box, redraw); else redraw();

    const now = {};
    ST.seats.forEach((seat, i) => { now[seat.id] = t[i]; });
    return UI.fx.scores(box, now, o.lastTotals, before);
  }

  /* Where a seat is, in a word: the table has its hand, or nobody is behind it
     and for how long. The clock is the room's -- `quiet` is how long it had
     been running when the state left the server -- and `quietAt` is when that
     state landed here, so a screen that ticks counts on from it and one that
     does not still says the right minute. */
  function seatMarks(box, ST, p, quietAt) {
    const s = ST.seats[p];
    const mark = (cls, txt, title) => {
      const b = document.createElement('span');
      b.className = 'badge soft ' + cls;
      b.textContent = txt;
      b.title = title;
      box.appendChild(b);
    };
    if (s.id === ST.captainId) mark('is-host', 'host', 'runs the table');
    if (s.bot) mark('is-bot', 'bot', 'a player the table provides');
    if (Game.handedOver(s)) return mark('is-auto', 'auto-play', 'the table has this hand');
    if (s.online || s.bot) return;
    const ms = (s.quiet || 0) + (quietAt ? Math.max(0, Date.now() - quietAt) : 0);
    const mins = Math.floor(ms / 60000);
    mark('is-away', mins >= 1 ? `away ${mins}m` : 'away',
      mins >= 1 ? `no window on this seat for ${mins} minute${mins === 1 ? '' : 's'}`
        : 'no window on this seat');
  }

  /* What whoever runs the table may do about one person, mid-game. Each row is
     offered only where it would do something: a seat is never handed what it
     already is, and a seat with nothing left to offer gets no ⋯ at all. */
  function seatItems(ST, p, o) {
    const s = ST.seats[p], view = o.view, out = [];
    const r = ST.rounds[ST.idx] || null;
    if (s.id !== ST.captainId && !s.bot && !s.left) {
      out.push({ label: 'Make table host', run: () => view.send({ t: 'captain', id: s.id }) });
    }
    /* A seat the table was given, given back. The player is not there to press
       anything -- that is why the table has their hand -- and their phone may
       have forgotten the table, so they come back by the name they played
       under, which needs the seat opened first. */
    if (Game.handedOver(s)) {
      out.push({ label: 'Let back in', run: () => view.send({ t: 'letback', id: s.id }) });
    } else if (!s.bot && !s.online && Game.virtual(ST) && ST.phase !== 'done') {
      // A player who has gone home. Only a table that deals the cards has a
      // hand of theirs the table could hold.
      out.push({ label: 'Auto-play their hand', danger: true,
                 run: () => handOver(view, s.name, s.id) });
    }
    /* A player put out of the game, whether they are at the table or not: one
       who has to stop and cannot press it themselves, or one the table wants
       rid of. The seat stays -- it is a column -- and the key goes with them,
       which is what makes it different from a seat that went quiet. Not a
       bot's, which is the table's own, and not on a game already over. */
    if (!s.bot && !s.left && Game.PLAY_PHASES.indexOf(ST.phase) >= 0) {
      out.push({ label: 'Remove from the game', danger: true,
                 run: () => putOut(view, s.name, s.id) });
    }
    /* Who dealt. With real cards a person did the dealing and can have been the
       wrong one -- and only while nobody has bid, because the order of bidding
       is the dealer's. */
    if (ST.phase === 'bid' && !Game.virtual(ST) && r && r.dealer !== p
        && (r.bids || []).every((b) => b === null)) {
      out.push({ label: 'They dealt this hand', run: () => view.send({ t: 'dealer', id: s.id }) });
    }
    /* Not the name. It is the column on the scorecard, and the head of that
       column is where it is changed -- one place, where the thing being
       renamed is what you are looking at. */
    return out;
  }

  /* A name typed into the little sheet the seat menu opens. One name to a
     table -- the scorecard is a column under it -- and the table says so if
     the one typed is taken. */
  function askName(ST, seat, view) {
    let d = document.getElementById('seat-name');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'seat-name';
      document.body.appendChild(d);
    }
    while (d.firstChild) d.firstChild.remove();          // built afresh each time
    const h = document.createElement('h2');
    h.textContent = `Rename ${seat.name}`;
    const box = document.createElement('input');
    box.type = 'text';
    box.className = 'namebox';
    box.value = seat.name;
    box.maxLength = 16;
    box.setAttribute('aria-label', 'Name');
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = 'The scorecard is a column under this name, so it changes with it.';
    const acts = document.createElement('div');
    acts.className = 'confirm-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn ghost';
    cancel.textContent = 'Cancel';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn primary';
    save.textContent = 'Save';
    const shut = () => { if (d.close) d.close(); else d.hidden = true; };
    cancel.addEventListener('click', shut);
    save.addEventListener('click', () => {
      const want = String(box.value || '').trim();
      if (want && want !== seat.name) view.send({ t: 'renameseat', id: seat.id, name: want });
      shut();
    });
    acts.append(cancel, save);
    d.append(h, box, note, acts);
    if (d.showModal) d.showModal(); else d.hidden = false;
  }

  /* A seat handed to the table for good, asked for first and told what it
     means. The screen the table has stopped offers it for the seat it is
     stopped on (Round.playout); this offers it for anybody who has gone home.
     Both say the same thing, because it is the same thing. */
  function handOver(view, who, id) {
    return UI.ask(`Auto-play ${who}'s hand?`,
      `The seat keeps its name and its place on the scorecard, and auto-play takes the hand `
      + `from here on. ${who} takes it back by coming to the table on the phone that holds the seat.`,
      'Auto-play', true).then((yes) => {
        if (yes) view.send(id ? { t: 'playout', id } : { t: 'playout' });
      });
  }

  /* Putting a player out of a game in play. Asked about first: it is the one
     thing on this list that the person it is about cannot undo. */
  function putOut(view, who, id) {
    const gone = `${who} cannot come back to the seat on their own \u2014 you let them back in `
      + `by name, from this same menu.`;
    return UI.ask(`Remove ${who} from the game?`,
      `The seat keeps its name and its place on the scorecard, and the table takes its hand `
      + `from here on. ${gone}`,
      'Remove', true).then((yes) => { if (yes) view.send({ t: 'remove', id }); });
  }

  /* Who won, and by how much. The places come back with it, because the host
     screen lists them and a phone does not. */
  function winner(ST) {
    const t = ST.totals;
    const order = t.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
    const top = order.length ? order[0].v : 0;
    const champs = order.filter((x) => x.v === top).map((x) => ST.seats[x.i].name);
    const title = champs.length > 1
      ? `Tie: ${champs.join(' and ')} — ${top} points`
      : `${champs[0]} wins with ${top} points`;
    return { title, order, top, champs };
  }

  // The bum-deal sentence. `me` is this phone's seat, or -1 on a host screen.
  function voteText(ST, me) {
    const v = ST.vote;
    if (!v) return '';
    const n = ST.seats.length;
    if (v.by === me) return `You called a bum deal. ${v.yes.length} of ${n} agree.`;
    const named = v.yes.map((i) => ST.seats[i].name).join(', ');
    return `${ST.seats[v.by].name} says it is a bum deal. ${v.yes.length} of ${n} agree`
      + (named && me < 0 ? ` (${named}).` : '.');
  }

  // True on the one state where the game has just ended, not on every state
  // after it: the finish plays once.
  const justFinished = (ST, was) => ST.phase === 'done' && !!was && was !== 'done';

  return { scorecardHTML, scorecard, editRound, rowMenu, closeRowMenus, handOver,
           followCurrent, esc, roundKey, dealOpts, finaleOpts,
           bidsAfter, sayBids, sayPresence, sayRound, sayTrick, cardEl, trickEl,
           sweepTrick, sweepOut, trickIn,
           standings, winner, voteText, justFinished };
})();
