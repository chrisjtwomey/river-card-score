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
  // Only the slots are cleared, never the whole box: a pile on its way out
  // lives in there too, and it has to see itself off.
  function trickEl(box, ST, me) {
    const p = ST.play;
    Array.prototype.forEach.call(box.querySelectorAll(':scope > .slot'), (s) => s.remove());
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
        who.animate([{ opacity: 1 }, { opacity: 0 }],
          { duration: 200, easing: 'ease-out', fill: 'forwards' });
      }
      const r = slot.getBoundingClientRect();
      const dx = Math.round(to.left - r.left), dy = Math.round(to.top - r.top);
      const tilt = (i - (slots.length - 1) / 2) * 3.5;
      slot.animate(
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
    const out = ghost.animate(
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
      s.animate([{ opacity: 0, transform: 'translateY(10px) scale(.96)' },
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
      if (!was || was === now[s.id] || p === me) return;
      if (now[s.id] === 'left') {
        UI.fx.toast(`${s.name} left the game`, { note: 'the table plays that hand now' });
      } else if (now[s.id] === 'away') {
        UI.fx.toast(`${s.name} dropped out`,
          { note: waiting(p) ? 'the table is waiting on them' : 'they can come back to their seat' });
      } else if (was === 'away' || was === 'left') {
        UI.fx.toast(`${s.name} is back`, { note: waiting(p) ? 'their turn' : null });
      }
    });
    return now;
  }

  function standings(box, ST, opts) {
    const o = opts || {};
    const me = o.me === undefined ? -1 : o.me;
    const t = ST.totals;
    const order = t.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
    const hi = Math.max(...t), lo = Math.min(0, ...t), span = hi - lo;
    const before = UI.fx.barsBefore(box);

    UI.fx.flip(box, () => {
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
        el.querySelector('.name').textContent = who.name
          + (row.i === me ? ' (you)' : (who.left ? ' (left)' : ''));
        box.appendChild(el);
      });
    });

    const now = {};
    ST.seats.forEach((seat, i) => { now[seat.id] = t[i]; });
    return UI.fx.scores(box, now, o.lastTotals, before);
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

  return { scorecardHTML, followCurrent, esc, roundKey, dealOpts, finaleOpts,
           bidsAfter, sayBids, sayPresence, cardEl, trickEl,
           sweepTrick, sweepOut, trickIn,
           standings, winner, voteText, justFinished };
})();
