'use strict';
/* What each player is remembered for. Worked out from the scorecard alone --
   the bids, the tricks and the hand sizes -- so every screen can do it, and
   the offline tracker can too. Shared by host.js, play.js and app.js. */
const Accolades = (function () {

  const done = (r) => !!r && Array.isArray(r.bids) && r.bids.every((b) => b !== null) && Array.isArray(r.tricks);
  const plural = (v, one, many) => `${v} ${v === 1 ? one : (many || one + 's')}`;

  /* rounds: the scorecard. n: how many seats. score(bid, won): what a round
     paid, which each screen knows its own way.
     Returns [{ key, title, who: [seat], note }], the warm ones first. */
  function list(rounds, n, score) {
    const played = (rounds || []).filter(done);
    if (n < 2 || played.length < 3) return [];        // too short to say anything

    const st = [];
    for (let p = 0; p < n; p++) {
      st.push({ bid: 0, tricks: 0, made: 0, over: 0, under: 0, off: 0,
                zeros: 0, allin: 0, blank: 0, best: -Infinity, bestAt: 0 });
    }
    played.forEach((r, i) => {
      for (let p = 0; p < n; p++) {
        const b = r.bids[p], w = r.tricks[p], pts = score(b, w);
        const s = st[p];
        s.bid += b; s.tricks += w; s.off += Math.abs(b - w);
        if (b === w) s.made += 1;
        if (b > w) s.over += b - w;
        if (w > b) s.under += w - b;
        if (b === 0 && w === 0) s.zeros += 1;
        if (b === r.cards && b === w) s.allin += 1;
        if (pts <= 0) s.blank += 1;
        if (pts > s.best) { s.best = pts; s.bestAt = i + 1; }
      }
    });

    // Where everybody stood half way through, against where they finished.
    const place = (upto) => {
      const run = Array(n).fill(0);
      played.slice(0, upto).forEach((r) => {
        for (let p = 0; p < n; p++) run[p] += score(r.bids[p], r.tricks[p]);
      });
      const order = run.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
      const out = Array(n).fill(0);
      order.forEach((o) => { out[o.i] = order.findIndex((x) => x.v === o.v) + 1; });
      return out;
    };
    const half = place(Math.floor(played.length / 2));
    const end = place(played.length);
    const climb = half.map((v, i) => v - end[i]);

    const out = [];
    // dir 1 takes the biggest, dir -1 the smallest. `least` is the bar it must
    // clear, the other way round for dir -1. A tie shares the accolade, but
    // nothing is awarded when every seat is level: that says nothing.
    const award = (key, title, values, dir, least, note) => {
      const best = dir > 0 ? Math.max.apply(null, values) : Math.min.apply(null, values);
      const who = [];
      values.forEach((v, i) => { if (v === best) who.push(i); });
      // An accolade half the table shares is not an accolade.
      if (who.length > Math.max(1, Math.floor(n / 2))) return;
      if (dir > 0 ? best < least : best > least) return;
      out.push({ key, title, who, note: note(best, who) });
    };
    const by = (k) => st.map((s) => s[k]);

    award('made', 'Bang on', by('made'), 1, 2,
      (v) => `made ${v} of ${played.length} bids`);
    award('fearless', 'Most fearless', by('bid'), 1, 1,
      (v) => `bid ${plural(v, 'trick')} in all`);
    award('tricks', 'Most tricks won', by('tricks'), 1, 1,
      (v) => `took ${plural(v, 'trick')}`);
    award('best', 'Best round', st.map((s) => s.best), 1, 1,
      (v, who) => `${plural(v, 'point')} in round ${st[who[0]].bestAt}`);
    award('steady', 'Steadiest hand', by('off'), -1, Infinity,
      (v) => (v === 0 ? 'never missed a bid' : `only ${plural(v, 'trick')} out all game`));
    award('climb', 'Best comeback', climb, 1, 2,
      (v) => `climbed ${plural(v, 'place')} in the second half`);
    award('zeros', 'Zero hero', by('zeros'), 1, 2,
      (v) => `took nothing ${plural(v, 'time')}, on purpose`);
    award('allin', 'All in', by('allin'), 1, 1,
      (v) => (v === 1 ? 'bid a whole hand and made it' : `bid the whole hand ${v} times, and made it`));
    award('under', 'Quiet achiever', by('under'), 1, 2,
      (v) => `won ${plural(v, 'trick')} more than bid`);
    award('careful', 'Most careful', by('bid'), -1, Infinity,
      (v) => `bid only ${plural(v, 'trick')} all game`);
    award('over', 'Biggest eyes', by('over'), 1, 2,
      (v) => `bid ${plural(v, 'trick')} more than won`);
    award('blank', 'Hardest luck', by('blank'), 1, 2,
      (v) => `${plural(v, 'round')} with nothing to show`);

    // Nobody is both the boldest and the most careful.
    const fear = out.find((a) => a.key === 'fearless');
    const care = out.find((a) => a.key === 'careful');
    if (fear && care && care.who.every((i) => fear.who.indexOf(i) >= 0)) {
      out.splice(out.indexOf(care), 1);
    }
    return out;
  }

  // Draws the list into a box. `names` is the seat names, in seat order.
  function render(box, items, names) {
    if (!box) return;
    box.innerHTML = '';
    box.hidden = !items.length;
    items.forEach((a) => {
      const row = document.createElement('div');
      row.className = 'acc';
      const title = document.createElement('span');
      title.className = 'acc-title';
      title.textContent = a.title;
      const who = document.createElement('span');
      who.className = 'acc-who';
      who.textContent = a.who.map((i) => names[i]).join(' & ');
      const note = document.createElement('span');
      note.className = 'acc-note';
      note.textContent = a.note;
      row.append(title, who, note);
      box.appendChild(row);
    });
  }

  return { list, render };
})();
