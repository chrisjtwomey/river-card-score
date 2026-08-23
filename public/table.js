'use strict';
/* The scorecard table, shared by the host screen and the player phones. */
const Table = (function () {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ST is the state from the server. `me` marks one column, or -1 for none.
  function scorecardHTML(ST, me) {
    const run = ST.seats.map(() => 0);
    let html = '<thead><tr><th>Round</th>';
    ST.seats.forEach((s, i) => {
      html += `<th class="${i === me ? 'mecol' : ''}">${esc(s.name)}</th>`;
    });
    html += '</tr></thead><tbody>';

    ST.rounds.forEach((r, i) => {
      const suit = ST.cfg.trump && r.trump ? ' ' + Game.SUITS.find((s) => s.k === r.trump).g : '';
      const cls = Game.roundDone(r) ? '' : (i === ST.idx ? 'current' : '');
      html += `<tr class="${cls}"><td>${i + 1} · ${r.cards}${esc(suit)}</td>`;
      ST.seats.forEach((_, p) => {
        const mecol = p === me ? ' mecol' : '';
        if (Game.roundDone(r)) {
          const pts = Game.roundScore(r.bids[p], r.tricks[p], ST.cfg);
          run[p] += pts;
          const hit = r.bids[p] === r.tricks[p];
          html += `<td class="${mecol.trim()}"><span class="cell"><span class="bidwon ${hit ? 'hit' : 'miss'}">` +
            `${r.bids[p]}→${r.tricks[p]} (${pts >= 0 ? '+' : ''}${pts})</span>` +
            `<span class="run">${run[p]}</span></span></td>`;
        } else if (i === ST.idx && r.bids && r.bids[p] !== null) {
          html += `<td class="${mecol.trim()}"><span class="cell"><span class="bidwon">bid ${r.bids[p]}</span>` +
            `<span class="run">${run[p]}</span></span></td>`;
        } else html += `<td class="${mecol.trim()}">·</td>`;
      });
      html += '</tr>';
    });

    html += '</tbody><tfoot><tr><td>Total</td>';
    ST.totals.forEach((t, i) => { html += `<td class="${i === me ? 'mecol' : ''}">${t}</td>`; });
    html += '</tr></tfoot>';
    return html;
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

  // The cards on the table: the trick being played, or the one just won.
  function trickEl(box, ST, me) {
    const p = ST.play;
    box.innerHTML = '';
    if (!p) return;
    const held = !p.trick.length && p.last;
    const cards = held ? p.last.trick : p.trick;
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
  }

  /* ---------- the bids, as they land ---------- */

  // Pops the pill of a bid that has just arrived, and rings the seat that has
  // to act now. `last` is { key, bids, turn } from the render before.
  function bidsAfter(strip, ST, r, last) {
    const key = `${ST.idx}:${r.redeals || 0}`;
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

  // "Hugh bid 2 · Joe to bid", for the seats that have just bid. `me` is the
  // seat reading it, or -1 for a screen that belongs to nobody. Your own bid
  // is not announced: your own pad already says it.
  function sayBids(ST, r, landed, me) {
    if (!landed || !landed.length) return;
    const others = landed.filter((p) => p !== me);
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

  return { scorecardHTML, followCurrent, esc, bidsAfter, sayBids, cardEl, trickEl };
})();
