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

  return { scorecardHTML, followCurrent, esc };
})();
