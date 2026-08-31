'use strict';
/* THE REPLAY VIEWER. A game watched again, drawn off the one message the
   server sends about a copy of it.

   Four widgets, in the shape every widget here has -- `(root, R, view)`:

     Viewer.games(root, R, view)    what there is to watch, as a list to press
     Viewer.rounds(root, R, view)   the rounds of the game being watched
     Viewer.run(root, R, view)      the transport, and how fast it plays itself
     Viewer.points(root, R, view)   the points of the round on show, and where

   `R` is that message: `{ code, of, at, n, playing, rate, marks, kinds, says,
   faces, where, here, games, game }`. `view = { send }` is how a word gets back
   to the copy -- `{do:'seek', at}`, `{do:'step', by}`, `{do:'play'}`,
   `{do:'pause'}`, `{do:'rate', v}`, `{do:'open', game}`. How that word is
   addressed is the page's business; this knows only what to ask for.

   Each widget builds what it needs inside the root it is handed, wires its own
   buttons once, and is null-tolerant. Nothing here reads the page it is on. */
const Viewer = (function () {
  /* Every kind of point: the icon it wears on the timeline, the plain word it
     is called where an older server sends no sentence for it, and how big a
     mark it makes. A round is mostly cards, so a card is a dot in the colour of
     its suit and a trick opening is a divider; what shapes the round wears an
     icon, and a bid wears the number that was said. */
  const STEPS = {
    G: ['\u{1F3AC}', 'the game starts'],
    R: ['\u{1F0CF}', 'the round is dealt'],
    b: ['', 'a bid'],                     // a bid wears its own number
    s: ['', 'a trick opens', 'bar'],
    c: ['', 'a card', 'wee'],             // a card wears itself
    w: ['✔', 'a trick taken'],
    W: ['↩', 'a trick taken back'],
    e: ['\u{1F4DD}', 'the round is scored'],
    z: ['⟲', 'the round is put back'],
    F: ['⚠️', 'the table was forced'],
    E: ['\u{1F3C1}', 'the game ends'],
  };
  // A hand thrown in is a round dealt again, and it says so rather than
  // looking like the first go at it.
  const BUM = '♻️';

  /* How fast it plays itself, against the pace the table played it. It is
     remembered, because whoever slows a game down to read it wants the next one
     slow too: a copy is made at the table's own pace and told this once. */
  const RATE_KEY = 'rcs:replay:rate';
  const RATES = [[0.5, '½×', 'Half the pace the table played it'],
                 [1, '1×', 'The pace the table played it'],
                 [2, '2×', 'Twice the pace'],
                 [4, '4×', 'Four times the pace']];
  function rate() {
    let v = 1;
    try { v = Number(localStorage.getItem(RATE_KEY)) || 1; } catch (e) { /* no store */ }
    return RATES.some(([x]) => x === v) ? v : 1;
  }
  function setRate(v) {
    try { localStorage.setItem(RATE_KEY, String(v)); } catch (e) { /* no store */ }
  }

  /* How big a hand a round is, in words. A round of one card is not "1 cards",
     and neither this nor a live scorecard's own strip is going to abbreviate
     it, so it is said here and read from both. */
  const cardsSaid = (n) => `${n} card${Number(n) === 1 ? '' : 's'}`;

  // The part of a root that holds one thing, built the first time it is wanted.
  function part(root, cls, tag) {
    let el = root.querySelector('.' + String(cls).split(' ')[0]);
    if (!el) {
      el = document.createElement(tag || 'div');
      el.className = cls;
      root.appendChild(el);
    }
    return el;
  }

  const btn = (box, cls, text, why, go) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    b.title = why;
    b.addEventListener('click', go);
    box.appendChild(b);
    return b;
  };

  /* ---------- what there is to watch ---------- */

  // Who took a game, and with what. A draw is named as one, as the finish does.
  function wonBy(g) {
    const names = g.names || [], won = g.winners || [];
    if (!won.length) return '';
    const who = won.map((i) => names[i] || 'somebody').join(' & ');
    const score = g.totals ? g.totals[won[0]] : null;
    return `\u{1F3C6} ${who}` + (score === null || score === undefined ? '' : ` · ${score}`);
  }

  // When it was played, short enough to sit at the end of a row.
  function gameWhen(at) {
    const d = new Date(Number(at) || 0);
    if (!at || isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) +
      ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  /* The game a table is playing now, and every game on file. A game's own table
     may be long gone -- its trail is kept beside its scorecard -- so this is
     not only one table's. */
  function games(root, R, view) {
    if (!root || !R) return;
    const box = part(root, 'gamelist');
    const list = R.games || [];
    const key = (R.here || '-') + ':' + list.map((g) => g.id).join(',');
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.innerHTML = '';
    const row = (code, said, when, who, why, go) => {
      const b = document.createElement('div');
      b.className = 'btn grow';
      b.title = why;
      const top = document.createElement('div');
      top.className = 'gtop';
      const c = document.createElement('span');
      c.className = 'gcode';
      c.textContent = code;
      const s = document.createElement('span');
      s.className = 'gwon';
      s.textContent = said;
      top.append(c, s);
      if (when) {
        const t = document.createElement('span');
        t.className = 'gwhen';
        t.textContent = when;
        top.appendChild(t);
      }
      b.appendChild(top);
      if (who) {
        const p = document.createElement('div');
        p.className = 'gwho';
        p.textContent = who;
        b.appendChild(p);
      }
      b.addEventListener('click', go);
      box.appendChild(b);
    };
    if (R.here) {
      row(R.here, 'playing now', '', '', 'The game this table is playing now',
          () => view.send({ do: 'open' }));
    }
    list.forEach((g) => {
      const names = g.names || [];
      row(g.code, wonBy(g), gameWhen(g.at),
          `${names.length} players · ${names.join(', ')}`,
          'Watch this game again', () => view.send({ do: 'open', game: g.id }));
    });
    if (!R.here && !list.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'No game has been written down yet.';
      box.appendChild(p);
    }
  }

  /* ---------- which round ---------- */

  /* Which round's stretch of the trail the head is in, and where that stretch
     starts. The first round takes everything before it with it: the game
     starting is the run-up to round one, not a stretch of its own with one
     point in it. Asked in one place, because the rounds, the timeline and the
     two round buttons all have to agree about it. */
  function roundNow(R) {
    let cur = 0;
    (R.marks || []).forEach((m, i) => { if (m.at <= R.at) cur = i; });
    return cur;
  }
  const topOf = (R, i) => (i === 0 ? 0 : R.marks[i].at);

  /* A round back, and a round on. Back part way through a round goes to the top
     of it first, the way a track does: it is the same press for "this one
     again" and "the one before", and which you meant is where you are. On from
     the last round is the end of the game, which is the only thing left. */
  function stepRound(R, view, by) {
    const marks = R.marks || [];
    if (!marks.length) return;
    const cur = roundNow(R);
    if (by > 0) {
      return view.send({ do: 'seek', at: marks[cur + 1] ? marks[cur + 1].at : R.n - 1 });
    }
    const top = topOf(R, cur);
    view.send({ do: 'seek', at: R.at > top ? top : topOf(R, Math.max(0, cur - 1)) });
  }

  /* The rounds of the game being watched, in the strip a scorecard's rounds
     use: they are the same thing. A hand thrown in is a cell of its own,
     because it was a second go at the same round and looked different. */
  function rounds(root, R, view) {
    if (!root || !R || !R.marks) return;
    const box = part(root, 'scrub strip');
    const key = R.marks.map((m) => `${m.at}/${m.w}`).join(',') + '@' + R.at;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.innerHTML = '';
    const cur = roundNow(R);
    R.marks.forEach((m, i) => {
      const again = m.w === 'bum' || m.w === 'reset' || m.w === 'undo';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'scell' + (i === cur ? ' on' : '') + (again ? ' bum' : '')
        + (m.at < R.at ? ' played' : '');
      b.appendChild(document.createTextNode(m.w === 'end' ? '\u{1F3C1}' : String(m.i + 1)));
      const sm = document.createElement('small');
      sm.textContent = m.w === 'end' ? 'end'
        : (m.w === 'bum' ? 'again'
          // 'undo' is what older trails on disk call a round put back by hand.
          : (m.w === 'reset' || m.w === 'undo' ? 'back' : cardsSaid(m.cards)));
      b.appendChild(sm);
      b.title = m.w === 'bum' ? 'The hand was thrown in and dealt again'
        : (m.w === 'reset' || m.w === 'undo'
          ? 'The round was put back to here' : 'Take the replay to here');
      b.addEventListener('click', () => view.send({ do: 'seek', at: m.at }));
      box.appendChild(b);
    });
    UI.fadeStrip(box);
    UI.showCell(box, box.querySelector('.scell.on'));
  }

  /* ---------- the transport ---------- */

  /* A round back or on at the outside, a point back or on inside those, Play
     between them, and how fast it plays itself. */
  function run(root, R, view) {
    if (!root || !R) return;
    const box = part(root, 'viewer-run');
    box._R = R;
    box._view = view;                     // read at the tap, not at the draw
    const now = () => box._R;
    const ask = (o) => box._view.send(o);
    if (!box._wired) {
      box._wired = true;
      btn(box, 'btn vw-prev', '⏮', 'The top of this round, then the round before',
          () => stepRound(now(), box._view, -1));
      btn(box, 'btn vw-back', '◀', 'One point back', () => ask({ do: 'step', by: -1 }));
      btn(box, 'btn primary vw-play', '', '',
          () => ask({ do: now().playing ? 'pause' : 'play' }));
      btn(box, 'btn vw-fwd', '▶', 'One point on', () => ask({ do: 'step', by: 1 }));
      btn(box, 'btn vw-next', '⏭', 'The round after',
          () => stepRound(now(), box._view, 1));
      const seg = document.createElement('div');
      seg.className = 'seg vw-rate';
      RATES.forEach(([v, label, why]) => {
        const b = btn(seg, 'btn', label, why, () => { setRate(v); ask({ do: 'rate', v }); });
        b.dataset.rate = String(v);
      });
      box.appendChild(seg);
      box._rates = seg;
      const at = document.createElement('span');
      at.className = 'viewer-at';
      box.appendChild(at);
    }
    /* A copy is made at the table's own pace. Whoever slowed the last one down
       to read it meant this one too, so it is told once, as it opens. */
    if (box._code !== R.code) {
      box._code = R.code;
      if (rate() !== (R.rate || 1)) ask({ do: 'rate', v: rate() });
    }
    const marks = R.marks || [];
    const cur = roundNow(R);
    box.querySelector('.vw-prev').disabled = R.at === 0;
    box.querySelector('.vw-next').disabled = !marks[cur + 1] && R.at >= R.n - 1;
    const play = box.querySelector('.vw-play');
    play.textContent = R.playing ? '❚❚ Pause' : '▶ Play';
    play.title = R.playing ? 'Stop where it is'
      : 'Play it back at the pace the table played it';
    box._rates.querySelectorAll('.btn').forEach((b) =>
      b.classList.toggle('on', Number(b.dataset.rate) === (R.rate || 1)));
    box.querySelector('.viewer-at').textContent = `${R.at + 1} of ${R.n}`;
  }

  /* ---------- the points of the round on show ---------- */

  /* A rail, the points marked along it in the order they happened, and a head
     that can be dragged along.

     A game is some hundreds of points, which is why this is two levels and not
     one: the rounds pick the round, and this picks the moment inside it. It is
     a rail rather than a row of cells because a round runs from one end to the
     other, and the marks on it are not a slider -- each point either happened
     or has not, and each is a place to go.

     What a mark wears is what it is: a bid its number, a card itself in the
     colour of its suit, a trick opening a divider through the rail, and the
     beats that shape a round an icon. Passing over one says what happened
     there, in the sentence the server made for it -- the same one the line
     beside the rail says for the point the copy is standing on. */
  function points(root, R, view) {
    if (!root || !R || !R.kinds) return;
    const box = part(root, 'steps');
    const line = part(root, 'viewer-where', 'p');
    line.textContent = R.where || '';
    const marks = R.marks || [];
    const cur = roundNow(R);
    const from = topOf(R, cur);
    const to = marks[cur + 1] ? marks[cur + 1].at - 1 : R.kinds.length - 1;
    const key = `${from}-${to}@${R.at}:${R.kinds.length}`;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.innerHTML = '';
    const bums = {};
    marks.forEach((m) => { if (m.w) bums[m.at] = m.w; });

    const body = document.createElement('div');
    body.className = 'tlbody';
    body._R = R;
    body._view = view;
    body._span = [from, to];
    body._line = line;
    const rail = document.createElement('div');
    rail.className = 'rail';
    const fill = document.createElement('div');
    fill.className = 'fill';
    rail.appendChild(fill);
    body.appendChild(rail);
    box.appendChild(body);

    // Where a point sits along the rail: the first at one end, the last at the
    // other. A round of one point has nowhere to go, so it sits in the middle.
    const span = to - from;
    const at = (i) => (span > 0 ? ((i - from) / span) * 100 : 50);

    for (let i = from; i <= to; i++) {
      const k = R.kinds[i];
      const [icon, , size] = STEPS[k] || ['?', 'something'];
      const worn = (R.faces && R.faces[i]) || (k === 'R' && bums[i] === 'bum' ? BUM : icon);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tick' + (size ? ' ' + size : '')
        + (i < R.at ? ' done' : '') + (/[♥♦]/.test(worn) ? ' red' : '');
      b.style.left = `${at(i)}%`;
      b.title = saidAt(R, i);
      const face = document.createElement('span');
      face.className = 'face';
      face.textContent = worn;
      b.appendChild(face);
      b.addEventListener('click', () => view.send({ do: 'seek', at: i }));
      b.addEventListener('mouseenter', () => showTip(body, i));
      b.addEventListener('mouseleave', () => showTip(body, null));
      body.appendChild(b);
    }

    const head = document.createElement('div');
    head.className = 'head';
    const knob = document.createElement('span');
    knob.className = 'knob';
    head.appendChild(knob);
    body.appendChild(head);
    body._head = head;
    body._knob = knob;
    putHead(body, R.at);
    wireDrag(body);
  }

  // The head, and the fill behind it, at a point. Read from the drag while one
  // is going on, and from the copy the rest of the time.
  function putHead(body, i) {
    const R = body._R;
    const [from, to] = body._span;
    const span = to - from;
    const x = span > 0 ? ((i - from) / span) * 100 : 50;
    body._head.style.left = `${x}%`;
    const fill = body.querySelector('.fill');
    if (fill) fill.style.width = `${x}%`;
    const [icon] = STEPS[R.kinds[i]] || ['?'];
    body._knob.textContent = (R.faces && R.faces[i]) || icon || '·';
  }

  // What happened at a point, in words. An older server sends no sentence, so
  // the kind of thing it was stands in for one.
  function saidAt(R, i) {
    const kind = (STEPS[R.kinds[i]] || ['', 'something'])[1];
    return `${(R.says && R.says[i]) || kind} — point ${i + 1} of ${R.n}`;
  }

  /* The tip over the rail. It is the one that follows the pointer; the line
     beside the rail stays on the point the copy is standing on, so the two
     answer different questions and never fight over one place. */
  function showTip(body, i) {
    const had = body.querySelector('.tip');
    if (had) had.remove();
    if (i === null || i === undefined) return;
    const [from, to] = body._span;
    const span = to - from;
    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.textContent = saidAt(body._R, i);
    tip.style.left = `${span > 0 ? ((i - from) / span) * 100 : 50}%`;
    body.appendChild(tip);
    /* Half of it hangs to the left of the mark it belongs to, so at the first
       point on the rail it hangs off the side of the screen -- and at the last,
       off the other side. Slide it back on once it is up, which is the only
       moment it can be done: how far it hangs depends on what it says. */
    const r = tip.getBoundingClientRect();
    const wide = window.innerWidth || 0;
    if (!r.width || !wide) return;
    const edge = 8;
    const back = Math.max(0, edge - r.left) - Math.max(0, r.right - (wide - edge));
    if (back) tip.style.marginLeft = `${Math.round(back)}px`;
  }

  /* Dragging the head. The rail is a picker, so a press anywhere on it takes
     the head there and a drag moves it; only letting go asks the copy to
     follow. Nothing is asked of the server until then: a seek re-seeds the copy
     and plays it forward, and doing that for every pixel of a drag would make
     the drag the slowest part of it. */
  function wireDrag(body) {
    const point = (e) => {
      const [from, to] = body._span;
      const r = body.getBoundingClientRect();
      if (!r.width) return null;                 // nothing laid out to measure
      const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      return from + Math.round(f * (to - from));
    };
    body.addEventListener('pointerdown', (e) => {
      const i = point(e);
      if (i === null) return;
      // Two clocks on one copy would fight over where it is, so a hand on the
      // rail stops it playing itself before it moves anything.
      if (body._R.playing) body._view.send({ do: 'pause' });
      body._drag = i;
      if (body.setPointerCapture && e.pointerId !== undefined) body.setPointerCapture(e.pointerId);
      putHead(body, i);
      showTip(body, i);
    });
    body.addEventListener('pointermove', (e) => {
      const i = point(e);
      if (i === null) return;
      if (body._drag !== null && body._drag !== undefined) { body._drag = i; putHead(body, i); }
      showTip(body, i);
    });
    const drop = () => {
      const i = body._drag;
      if (i === null || i === undefined) return;
      body._drag = null;
      showTip(body, null);
      body._view.send({ do: 'seek', at: i });
    };
    body.addEventListener('pointerup', drop);
    body.addEventListener('pointercancel', drop);
    body.addEventListener('mouseleave', () => {
      if (body._drag === null || body._drag === undefined) showTip(body, null);
    });
  }

  return { games, rounds, run, points, cardsSaid, rate, roundNow };
})();
