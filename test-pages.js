'use strict';
/* The pages, checked without a browser.

   Most of what a page does needs neither: the felt is geometry and gestures --
   where a card lies, which card the thumb is on, what a push up out of the fan
   does, and what a card that may not be played does instead -- and the menus are
   a handful of listeners. None of that can be seen from the integration tests,
   which never open a page, so it is checked here against a document just big
   enough to draw into.

   Run it with `node test-pages.js`, or with `npm test`, which runs both.
*/
const fs = require('fs');
const path = require('path');
const Game = require('./game.js');
// The names of the accolades, which the rules form lists to be chosen from.
const Accolades = require('./public/accolades.js');

function makeDom(W, H) {
  const listeners = [];
  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = []; this.parentNode = null;
      // A custom property is set and read back the way a browser does, so a
      // check can ask what the page told the stylesheet.
      this.style = {
        setProperty(k, v) { this[k] = String(v); },
        removeProperty(k) { delete this[k]; },
        getPropertyValue(k) { return this[k] === undefined ? '' : this[k]; },
      };
      this._cls = new Set(); this._text = '';
      this.hidden = false; this.dataset = {};
      this.offsetTop = 0;
      const self = this;
      this.classList = {
        add: (...c) => c.forEach((x) => self._cls.add(x)),
        remove: (...c) => c.forEach((x) => self._cls.delete(x)),
        toggle: (c, on) => { if (on === undefined) { self._cls.has(c) ? self._cls.delete(c) : self._cls.add(c); } else if (on) self._cls.add(c); else self._cls.delete(c); },
        contains: (c) => self._cls.has(c),
      };
    }
    get className() { return Array.from(this._cls).join(' '); }
    set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get id() { return this._id || ''; }
    set id(v) { this._id = v; }
    get textContent() { return this._text; }
    set textContent(v) { this._text = String(v); this.children = []; }
    set innerHTML(v) {
      this.children = [];
      // only the shapes the felt actually writes
      const re = /<(div|span|p)\s+class="([^"]+)"[^>]*>/g;
      let m;
      while ((m = re.exec(String(v)))) { const e = new El(m[1]); e.className = m[2]; this.appendChild(e); }
    }
    // a node has one place: appending one already in the tree moves it, as the DOM does
    appendChild(c) { if (c.parentNode) c.remove(); c.parentNode = this; this.children.push(c); return c; }
    insertBefore(c, ref) {
      if (c.parentNode) c.remove();
      c.parentNode = this;
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      return c;
    }
    get firstChild() { return this.children[0] || null; }
    append(...cs) { cs.forEach((c) => this.appendChild(c)); }
    remove() { if (!this.parentNode) return; const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null; }
    addEventListener(t, f) { (this._on || (this._on = {}))[t] = ((this._on || {})[t] || []).concat([f]); }
    removeEventListener(t, f) { if (this._on && this._on[t]) this._on[t] = this._on[t].filter((g) => g !== f); }
    fire(t, evt) { ((this._on || {})[t] || []).slice().forEach((f) => f(Object.assign({ type: t, preventDefault() {}, stopPropagation() {} }, evt))); }
    setPointerCapture() {}
    releasePointerCapture() {}
    scrollIntoView() {}
    setAttribute(k, v) { if (k === 'id') this.id = v; this['attr_' + k] = v; }
    getAttribute(k) { return this['attr_' + k] === undefined ? null : this['attr_' + k]; }
    removeAttribute(k) { delete this['attr_' + k]; }
    contains(el) { let e = el; while (e) { if (e === this) return true; e = e.parentNode; } return false; }
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 20, right: 0, bottom: 20 }; }
    get clientWidth() { return W; }
    get clientHeight() { return H; }
    all() { const out = []; const walk = (e) => e.children.forEach((c) => { out.push(c); walk(c); }); walk(this); return out; }
    matches(sel) {
      return sel.split(',').some((s) => {
        s = s.trim();
        if (s.startsWith('#')) return this.id === s.slice(1);
        const parts = s.split('.').filter(Boolean);
        if (s.startsWith('.')) return parts.every((c) => this._cls.has(c));
        const [tag, ...cls] = parts;
        return this.tagName === tag.toUpperCase() && cls.every((c) => this._cls.has(c));
      });
    }
    closest(sel) { let e = this; while (e) { if (e.matches && e.matches(sel)) return e; e = e.parentNode; } return null; }
    querySelector(sel) { return this.all().find((e) => e.matches(sel)) || null; }
    querySelectorAll(sel) { const r = this.all().filter((e) => e.matches(sel)); r.forEach = Array.prototype.forEach.bind(r); return r; }
  }
  const body = new El('body');
  const root = new El('html');
  const docOn = {};
  const document = {
    body,
    documentElement: root,
    createElement: (t) => {
      const e = new El(t);
      /* A canvas is drawn on and read back as a data: URI. Nothing here draws,
         so every call is taken and the picture is a stand-in for a stand-in:
         what a check can see is that one was made and where it was sent. */
      if (String(t).toLowerCase() === 'canvas') {
        e.getContext = () => new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
        e.toDataURL = () => 'data:image/webp;base64,STANDIN';
      }
      return e;
    },
    // Text put beside elements, which is how the scrubber writes a cell.
    createTextNode: (t) => { const e = new El('#text'); e.textContent = String(t); return e; },
    getElementById: (id) => body.all().find((e) => e.id === id) || null,
    querySelector: (sel) => {
      const m = /^#([\w-]+)\s+\.([\w-]+)$/.exec(sel);
      if (m) { const host = document.getElementById(m[1]); return host ? host.querySelector('.' + m[2]) : null; }
      return body.querySelector(sel);
    },
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    addEventListener: (t, f) => { (docOn[t] || (docOn[t] = [])).push(f); },
    // A tap on the page itself, which is how a menu is closed from outside it.
    fire: (t, evt) => (docOn[t] || []).slice().forEach((f) =>
      f(Object.assign({ type: t, preventDefault() {}, stopPropagation() {} }, evt))),
  };
  const window = {
    innerWidth: W, innerHeight: H,
    addEventListener: (t, f) => listeners.push([t, f]),
    removeEventListener: (t, f) => { const i = listeners.findIndex((l) => l[0] === t && l[1] === f); if (i >= 0) listeners.splice(i, 1); },
    matchMedia: () => ({ matches: false }),
    location: { search: '' },
    fire: (t) => listeners.filter((l) => l[0] === t).forEach((l) => l[1]()),
  };
  window.top = window;    // a page under test is the top window, unless a check says otherwise
  window.self = window;   // and both names for it agree, as in a browser
  const store = {};
  const localStorage = { getItem: (k) => (k in store ? store[k] : null),
                        setItem: (k, v) => { store[k] = String(v); },
                        removeItem: (k) => { delete store[k]; } };
  return { document, window, localStorage, El };
}


const ROOT = __dirname;

/* `fin` loads the finish for real instead of stubbing it, in the page's own
   script order. It is a scene of its own and most checks want it out of the
   way, so it is asked for. */
function load(W, H, motion, fin) {
  const dom = makeDom(W, H);
  dom.localStorage.setItem('river-card-score:motion:v1', motion || 'off');
  const files = ['public/ui.js', 'public/stage.js', 'public/deal.js',
                 'public/felt.js', 'public/table.js', 'public/round.js'];
  if (fin) files.splice(3, 0, 'public/finale.js');
  const src = files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
  const Avatar = { url: () => null };
  const Finale = { play: () => Promise.resolve() };
  const talk = [];
  const Chat = {
    also: (el) => { talk.push(el); return el; },
    button: (cls) => {
      const el = dom.document.createElement('button');
      el.className = cls; el.innerHTML = '<span class="chat-badge" hidden></span>';
      talk.push(el); return el;
    },
    wire() {}, update() {},
  };
  const args = ['window', 'document', 'localStorage', 'Game', 'Avatar', 'Chat', 'console'];
  const vals = [dom.window, dom.document, dom.localStorage, Game, Avatar, Chat,
    { log() {}, info() {}, warn() {}, error(...a) { throw new Error('console.error: ' + a.join(' ')); } }];
  if (!fin) { args.splice(5, 0, 'Finale'); vals.splice(5, 0, Finale); }
  const fn = new Function(...args, src + '\n; return { UI, Stage, Deal, Felt, Table, Round };');
  return Object.assign({ dom, talk }, fn(...vals));
}

/* Drive the timers a scene arms, and the ones those arm in turn, until it
   stops arming any -- or until `stop` says the next scene has taken over,
   whose own timers belong to the clock and not to this file. A step between
   two rounds is four of these deep: what the round paid, the putting away,
   the places, and the fade off them. */
function runTimers(go, stop) {
  const armed = [];
  const realSet = setTimeout;
  for (let guard = 0; guard < 8 && go.length; guard++) {
    armed.length = 0;
    global.setTimeout = (f, ms) => { armed.push({ fn: f, ms }); return realSet(() => {}, 0); };
    try { go.slice().sort((a, b) => a.ms - b.ms).forEach((t) => t.fn()); }
    finally { global.setTimeout = realSet; }
    if (stop && stop()) return;
    go = armed.slice();
  }
}

/* A box the stage placed with left/top/width/height rather than a transform --
   the dealer's ring, and the names -- read back out of what it wrote. */
const pxOf = (v) => { const m = /(-?[\d.]+)px/.exec(String(v || '')); return m ? Number(m[1]) : NaN; };
const boxOf = (el) => ({ x: pxOf(el && el.style.left), y: pxOf(el && el.style.top),
                         w: pxOf(el && el.style.width), h: pxOf(el && el.style.height) });

// the place a keyframe asks for, read the way a style is read
function spotOfKf(kf) { return kf && kf.transform ? spotOf({ style: { transform: kf.transform } }) : null; }

// where a card actually sits, read back out of the transform the felt wrote
function spotOf(el) {
  const N = '(-?[\\d.]+(?:e[-+]?\\d+)?)';
  const m = new RegExp('translate3d\\(' + N + 'px,' + N + 'px,0\\) rotate\\(' + N
    + 'deg\\) rotateY\\(' + N + 'deg\\) scale\\(' + N + '\\)').exec(el.style.transform || '');
  if (!m) return null;
  return { x: +m[1], y: +m[2], tilt: +m[3], face: +m[4], scale: +m[5] };
}

/* The felt tells the table when it is up, so that nothing is bid for a bot
   while the cards are still in the air. That is not a move, so the checks that
   watch for moves do not count it; it is checked on its own below. */
const moves = (list) => (m) => { if (m.t !== 'dealt') list.push(m); };

function stateFor(n, cards, me, o) {
  o = o || {};
  const D = Game.shuffle(Game.deck());
  const hands = [];
  for (let p = 0; p < n; p++) hands.push(Game.sortHand(D.splice(0, cards)));
  const up = D.shift();
  const r = { cards, dealer: 0, trump: Game.suitOf(up),
              bids: o.bids || Array(n).fill(null), tricks: null };
  return { hands, up, ST: {
    code: 'TEST', phase: o.phase || 'bid',
    cfg: { deck: 'virtual', trump: true, screw: true, bonus: 10, miss: 'atleast' },
    seats: Array.from({ length: n }, (_, i) => ({ id: 's' + i, name: 'PLR'[0] + (i + 1), online: true, av: null })),
    rounds: [r], idx: 0, turn: 'turn' in o ? o.turn : 1,
    totals: Array(n).fill(0), bonus: Array(n).fill(0),
    play: { turn: 'pturn' in o ? o.pturn : null, held: !!o.held,
            trick: o.trick || [], won: o.won || Array(n).fill(0),
            last: o.last || null, upcard: up, counts: o.counts || hands.map((h) => h.length) },
    hand: o.hand || hands[me],
  } };
}

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; } else { fail++; console.log('  FAIL ' + what); } };
const part = (name) => console.log('\n-- ' + name + ' --');

part('the table, drawn at every size');

const CARD = { w: 64, h: 90, narrow: { w: 52, h: 74 } };

for (const [W, H] of [[360, 640], [412, 860], [412, 740], [500, 860], [760, 1000]]) {
  for (const n of [2, 3, 4, 5, 6, 8]) {
    for (const cards of [1, 2, 5, 7, 13]) {
      if (cards > Game.maxCardsFor(n)) continue;      // no deck deals that many
      const me = Math.min(1, n - 1);
      const { hands, ST } = stateFor(n, cards, me);
      const L = load(W, H, 'off');
      L.Felt.sync(ST, me, { send: () => {}, watch: false, onView: () => {} });
      const stage = L.dom.document.querySelector('.deal-stage');
      const mine = stage.querySelectorAll('.dcard.mine');
      const hero = stage.querySelectorAll('.dcard.hero');
      const others = stage.querySelectorAll('.dcard').filter((e) =>
        !e.classList.contains('mine') && !e.classList.contains('hero'));
      const tag = `${W}x${H} n=${n} c=${cards}`;
      ok(!L.dom.document.getElementById('deal').hidden, `${tag}: the table is on screen`);
      ok(mine.length === cards, `${tag}: hand drawn (${mine.length} of ${cards})`);
      ok(hero.length === 1, `${tag}: one turned card`);
      ok(others.length === (n - 1) * cards, `${tag}: piles ${others.length} of ${(n - 1) * cards}`);
      ok(stage.querySelectorAll('.dname').length === n, `${tag}: a name per seat`);

      // the fan must stay on screen, and stay the right way up
      const cw = W <= 420 ? CARD.narrow.w : CARD.w;
      const ch = W <= 420 ? CARD.narrow.h : CARD.h;
      const spots = mine.map(spotOf);
      ok(spots.every((s) => s), `${tag}: every card placed`);
      const lo = Math.min(...spots.map((s) => W / 2 + s.x - cw / 2));
      const hi = Math.max(...spots.map((s) => W / 2 + s.x + cw / 2));
      ok(lo >= -2 && hi <= W + 2, `${tag}: fan inside the screen (${Math.round(lo)}..${Math.round(hi)} of ${W})`);
      const bot = Math.max(...spots.map((s) => H / 2 + s.y + ch / 2));
      ok(bot <= H + 2, `${tag}: fan above the bottom (${Math.round(bot)} of ${H})`);
      ok(spots.every((s) => s.face === 0), `${tag}: your cards face up`);
      ok(others.every((e) => spotOf(e).face === 180), `${tag}: everybody else face down`);
      // and clear of the head line at the top
      const ringTop = H / 2 + Math.min(-1, 0);
      const pileTop = others.length ? Math.min(...others.map((e) => H / 2 + spotOf(e).y - ch / 2)) : H;
      ok(pileTop > 40, `${tag}: piles clear of the top (${Math.round(pileTop)})`);
    }
  }
}

part('a hand being played');

// playing cards away: the fan closes up, the piles thin, nothing is left behind
{
  const n = 4, cards = 7, me = 1;
  const { hands, ST } = stateFor(n, cards, me);
  const L = load(412, 860, 'off');
  L.Felt.sync(ST, me, {});
  const stage = L.dom.document.querySelector('.deal-stage');
  const width = () => {
    const s = stage.querySelectorAll('.dcard.mine').map(spotOf);
    return Math.max(...s.map((x) => x.x)) - Math.min(...s.map((x) => x.x));
  };
  let last = width();
  for (let k = 1; k < cards; k++) {
    const left = hands[me].slice(k);
    const st = stateFor(n, cards, me).ST;
    st.phase = 'tricks'; st.turn = null; st.play.turn = me; st.hand = left;
    st.rounds[0].bids = Array(n).fill(1);
    st.play.counts = hands.map((h, i) => (i === me ? left.length : h.length - k));
    st.play.won = Array(n).fill(0);
    L.Felt.sync(st, me, {});
    const mine = stage.querySelectorAll('.dcard.mine');
    ok(mine.length === left.length, `after ${k} played: ${mine.length} cards left, want ${left.length}`);
    const others = stage.querySelectorAll('.dcard').filter((e) =>
      !e.classList.contains('mine') && !e.classList.contains('hero'));
    ok(others.length === (n - 1) * (cards - k), `after ${k} played: piles ${others.length} of ${(n - 1) * (cards - k)}`);
    const w = width();
    ok(w <= last + 0.001, `after ${k} played: the fan closed up (${w.toFixed(1)} <= ${last.toFixed(1)})`);
    last = w;
    ok(stage.querySelectorAll('.dcard').length === mine.length + others.length + 1,
      `after ${k} played: nothing left behind`);
  }
}

part('coming and going');

/* A phone that joins after the bidding has started gets no deal -- there is
   nothing to replay -- so the table has to stand itself up, and show itself. */
{
  const n = 4, cards = 5, me = 3;
  const made = stateFor(n, cards, me, { phase: 'bid', turn: me, bids: [null, 1, 1, null] });
  const L = load(412, 860, 'full');
  L.Felt.sync(made.ST, me, { send: () => {} });
  const overlay = L.dom.document.getElementById('deal');
  ok(!overlay.hidden, 'a phone joining part way through sees the table');
  ok(overlay.querySelector('.deal-stage').querySelectorAll('.dcard.mine').length === cards,
    'with its hand on it');
  ok(overlay.querySelectorAll('.bidchip').length === cards + 1, 'and its bid to make');
}

// the felt goes when the round does
{
  const n = 4, cards = 5, me = 1;
  const { ST } = stateFor(n, cards, me);
  const L = load(412, 860, 'off');
  L.Felt.sync(ST, me, {});
  ok(L.Felt.isOpen(), 'the felt is up while a hand is in play');
  const done = stateFor(n, cards, me).ST;
  done.phase = 'done';
  L.Felt.sync(done, me, {});
  ok(!L.Felt.isOpen(), 'and gone when the game is over');
  const lobby = stateFor(n, cards, me).ST;
  lobby.phase = 'lobby';
  L.Felt.sync(lobby, me, {});
  ok(!L.Felt.isOpen(), 'and gone in the lobby');
}

// a real-cards table never gets one
{
  const n = 4, cards = 5, me = 1;
  const { ST } = stateFor(n, cards, me);
  ST.cfg.deck = 'physical';
  const L = load(412, 860, 'off');
  L.Felt.sync(ST, me, {});
  ok(!L.Felt.isOpen(), 'a table with real cards has no felt');
}

// the button drops it and brings it back
{
  const n = 4, cards = 5, me = 1;
  const { ST } = stateFor(n, cards, me);
  const L = load(412, 860, 'off');
  const seen = [];
  L.Felt.sync(ST, me, { onView: (v) => seen.push(v) });
  L.Felt.hide();
  ok(!L.Felt.shown() && L.dom.document.getElementById('deal').hidden, 'the scorecard button drops the felt');
  L.Felt.sync(ST, me, {});
  ok(!L.Felt.shown(), 'and a state arriving does not put it back');
  L.Felt.show();
  ok(L.Felt.shown() && !L.dom.document.getElementById('deal').hidden, 'and the page puts it back');
  ok(L.dom.document.querySelector('.deal-stage').querySelectorAll('.dcard.mine').length === cards,
    'with the hand still on it');
  ok(seen[seen.length - 1] === true, 'and the page is told');
}


part('the hand, in your fingers');
function table(o) {
  const n = 4, cards = 5, me = 1, W = 412, H = 860;
  const made = stateFor(n, cards, me, Object.assign({ phase: 'tricks', turn: null, pturn: me,
    bids: Array(n).fill(1) }, o || {}));
  const L = load(W, H, 'off');
  const sends = [];
  L.Felt.sync(made.ST, me, { send: moves(sends), watch: false, onView: () => {} });
  const overlay = L.dom.document.getElementById('deal');
  const stage = overlay.querySelector('.deal-stage');
  const F = L.Stage.fan(made.ST.hand.length, W, H);
  const R = L.Stage.ring(n, me, W, H);
  const seat = R.at(me);
  const pt = (i) => ({ clientX: W / 2 + seat.x + F.at(i).x, clientY: H / 2 + F.at(i).y, pointerId: 1, button: 0 });
  const up = () => stage.querySelectorAll('.dcard.up');
  const hint = () => (overlay.querySelector('.felt-hint') || {}).textContent;
  return { L, made, overlay, stage, sends, pt, up, hint, me, n, cards, W, H, F, seat };
}

// touching a card picks it up; a thumb along the fan picks up each in turn
{
  const t = table();
  const hand = t.made.ST.hand;
  t.overlay.fire('pointerdown', t.pt(2));
  ok(t.up().length === 1 && t.up()[0].querySelector('.big') !== null, 'touching a card lifts it');
  const first = t.up()[0];
  t.overlay.fire('pointermove', Object.assign(t.pt(0), { pointerId: 1 }));
  ok(t.up().length === 1 && t.up()[0] !== first, 'a thumb along the fan lifts the next card');
  t.overlay.fire('pointerup', { pointerId: 1 });
  ok(t.up().length === 1, 'and it stays up when the thumb comes off');
  ok(t.sends.length === 0, 'and nothing has been played');
}

// a second tap on a card that is already up plays it
{
  const t = table();
  const card = t.made.ST.hand[3];
  t.overlay.fire('pointerdown', t.pt(3));
  t.overlay.fire('pointerup', { pointerId: 1 });
  t.overlay.fire('pointerdown', t.pt(3));
  t.overlay.fire('pointerup', { pointerId: 1 });
  ok(t.sends.length === 1 && t.sends[0].t === 'play' && t.sends[0].card === card,
    'a card tapped twice is played (' + JSON.stringify(t.sends) + ')');
  ok(t.stage.querySelectorAll('.dcard.mine').length === t.cards, 'and it is on the table, not gone');
}

/* A paused table is paused for everybody, and the felt says so rather than
   letting a card leave the hand for a refusal. The card used to go out, the
   table answered "the table is stopped" on the socket, and nothing here ever
   heard it: the card sat on the table, held out of the hand it never left,
   and could be neither played nor picked up again. */
{
  const t = table();
  const card = t.made.ST.hand[3];
  t.L.Felt.sync(Object.assign({}, t.made.ST, { paused: true }), t.me, {});
  ok(t.L.Felt.refused() === false, 'with no card in the air, a refusal answers nothing');
  t.overlay.fire('pointerdown', t.pt(3));
  t.overlay.fire('pointerup', { pointerId: 1 });
  t.overlay.fire('pointerdown', t.pt(3));
  t.overlay.fire('pointerup', { pointerId: 1 });
  ok(t.sends.length === 0, 'a paused table is offered no card  got ' + JSON.stringify(t.sends));
  ok(/paused/.test(t.hint()), 'and the line under the hand says why  got ' + t.hint());
  ok(t.stage.querySelectorAll('.dcard.mine').length === t.cards,
     'with every card still in the hand');

  // Let go, and the same card goes.
  t.L.Felt.sync(Object.assign({}, t.made.ST, { paused: false }), t.me, {});
  t.overlay.fire('pointerdown', t.pt(3));
  t.overlay.fire('pointerup', { pointerId: 1 });
  t.overlay.fire('pointerdown', t.pt(3));
  t.overlay.fire('pointerup', { pointerId: 1 });
  ok(t.sends.length === 1 && t.sends[0].card === card,
     'and it goes once the table starts again  got ' + JSON.stringify(t.sends));
}

/* And a card the table would not take comes back. A refusal arrives on the
   socket rather than in a state, so the felt is told: without it the latch
   that holds a card out of the hand while it is in the air never comes off,
   and the card is gone for the rest of the round. */
{
  const t = table();
  const card = t.made.ST.hand[3];
  t.overlay.fire('pointerdown', t.pt(3));
  t.overlay.fire('pointerup', { pointerId: 1 });
  t.overlay.fire('pointerdown', t.pt(3));
  t.overlay.fire('pointerup', { pointerId: 1 });
  ok(t.sends.length === 1, 'the card goes to the table');
  ok(t.L.Felt.refused('The table is paused.') === true,
     'a refusal is an answer, and the felt takes it as one');
  ok(/paused/i.test(t.hint()), 'which is said under the hand  got ' + t.hint());
  // And it is a card again: it plays, rather than sitting out of reach.
  t.overlay.fire('pointerdown', t.pt(3));
  t.overlay.fire('pointerup', { pointerId: 1 });
  t.overlay.fire('pointerdown', t.pt(3));
  t.overlay.fire('pointerup', { pointerId: 1 });
  ok(t.sends.length === 2 && t.sends[1].card === card,
     'and the same card can be played again  got ' + JSON.stringify(t.sends));
}

// pushing a card up out of the fan plays it
{
  const t = table();
  const card = t.made.ST.hand[1];
  const a = t.pt(1);
  t.overlay.fire('pointerdown', a);
  t.overlay.fire('pointermove', { pointerId: 1, clientX: a.clientX, clientY: a.clientY - 40 });
  ok(t.overlay.classList.contains('dragging'), 'a push up shows the line');
  t.overlay.fire('pointermove', { pointerId: 1, clientX: a.clientX, clientY: a.clientY - 260 });
  ok(t.overlay.classList.contains('armed'), 'and arms it above the line');
  t.overlay.fire('pointerup', { pointerId: 1, clientX: a.clientX, clientY: a.clientY - 260 });
  ok(t.sends.length === 1 && t.sends[0].card === card, 'released clear of the fan, it is played');
  ok(!t.overlay.classList.contains('dragging'), 'and the line goes');
}

/* The line a card is dragged over and the ring round the heading are both gold
   and dashed. A line running near the box rather than into it read as two marks
   that had missed each other, so the line lies along the ring's top edge and the
   word cuts them both in one place. */
{
  const t = table();
  t.made.ST.rounds[0].dealer = t.me;                 // the deal is your own
  t.L.Felt.sync(t.made.ST, t.me, { send: () => {} });
  const a = t.pt(1);
  t.overlay.fire('pointerdown', a);
  t.overlay.fire('pointermove', { pointerId: 1, clientX: a.clientX, clientY: a.clientY - 40 });
  const line = t.overlay.querySelector('.felt-line');
  const ring = t.stage.querySelector('.dring');
  ok(pxOf(line.style.top) === pxOf(ring.style.top),
     'the line lies along the top of your own ring  got ' + line.style.top + ' for ' + ring.style.top);
  ok(pxOf(line.style.top) === Math.round(t.L.Stage.playLine(t.W, t.H)),
     'and both are the stage\'s one answer');
  const gap = t.overlay.style.getPropertyValue('--dring-gap');
  ok(/^[\d.]+px$/.test(gap) && Number(gap.replace('px', '')) > 20,
     'the line is broken for the word, the way the ring\'s own border is  got ' + JSON.stringify(gap));
  t.overlay.fire('pointerup', { pointerId: 1, clientX: a.clientX, clientY: a.clientY - 40 });
}
{
  // Somebody else's ring is nowhere near the line, so the line stays whole.
  const t = table();
  const a = t.pt(1);
  t.overlay.fire('pointerdown', a);
  t.overlay.fire('pointermove', { pointerId: 1, clientX: a.clientX, clientY: a.clientY - 40 });
  ok(t.overlay.style.getPropertyValue('--dring-gap') === '0px',
     'a ring at another seat leaves the line unbroken  got '
     + JSON.stringify(t.overlay.style.getPropertyValue('--dring-gap')));
  t.overlay.fire('pointerup', { pointerId: 1, clientX: a.clientX, clientY: a.clientY - 40 });
}

// a push that stops short does not play
{
  const t = table();
  const a = t.pt(1);
  t.overlay.fire('pointerdown', a);
  t.overlay.fire('pointermove', { pointerId: 1, clientX: a.clientX, clientY: a.clientY - 40 });
  t.overlay.fire('pointerup', { pointerId: 1, clientX: a.clientX, clientY: a.clientY - 40 });
  ok(t.sends.length === 0, 'a push that stops short of the line plays nothing');
  ok(t.stage.querySelectorAll('.dcard.up').length === 1, 'and the card is still in the hand, up');
}

// a card that must follow will not go, and says why
{
  const n = 4, cards = 5, me = 1, W = 412, H = 860;
  // a hand with at least two suits in it, and a led suit it holds
  let made, led, offSuit = null;
  for (let tries = 0; tries < 200 && offSuit === null; tries++) {
    made = stateFor(n, cards, me, { phase: 'tricks', turn: null, pturn: me, bids: Array(n).fill(1) });
    const hand = made.ST.hand;
    const suits = new Set(hand.map(Game.suitOf));
    if (suits.size < 2) continue;
    led = Game.suitOf(hand[0]);
    const other = hand.find((c) => Game.suitOf(c) !== led);
    if (!other) continue;
    offSuit = hand.indexOf(other);
    made.ST.play.trick = [{ p: (me + 3) % n, card: led === 'S' ? 'AS' : 'A' + led }];
    // the led card must not be one of ours
    if (hand.indexOf(made.ST.play.trick[0].card) >= 0) { offSuit = null; continue; }
  }
  const L = load(W, H, 'off');
  const sends = [];
  L.Felt.sync(made.ST, me, { send: moves(sends) });
  const overlay = L.dom.document.getElementById('deal');
  const stage = overlay.querySelector('.deal-stage');
  const duds = stage.querySelectorAll('.dcard.dud').length;
  const legal = Game.legalPlays(made.ST.hand, led).length;
  ok(duds === made.ST.hand.length - legal, `the cards you may not play are dimmed (${duds})`);
  const F = L.Stage.fan(made.ST.hand.length, W, H);
  const seat = L.Stage.ring(n, me, W, H).at(me);
  const a = { clientX: W / 2 + seat.x + F.at(offSuit).x, clientY: H / 2 + F.at(offSuit).y, pointerId: 1, button: 0 };
  overlay.fire('pointerdown', a);
  overlay.fire('pointermove', { pointerId: 1, clientX: a.clientX, clientY: a.clientY - 300 });
  ok(sends.length === 0, 'a card that must follow does not leave the hand');
  ok(!overlay.classList.contains('dragging'), 'and no line is offered for it');
  ok(/must follow/.test((overlay.querySelector('.felt-hint') || {}).textContent || ''),
    'and it says why: ' + JSON.stringify((overlay.querySelector('.felt-hint') || {}).textContent));
  overlay.fire('pointerup', { pointerId: 1, clientX: a.clientX, clientY: a.clientY - 300 });
  ok(sends.length === 0, 'and releasing it plays nothing');
}

// not your turn: a card may still be read, but not played
{
  const t = table({ pturn: 0 });
  const a = t.pt(2);
  t.overlay.fire('pointerdown', a);
  ok(t.up().length === 1, 'a card can be read when it is not your turn');
  t.overlay.fire('pointermove', { pointerId: 1, clientX: a.clientX, clientY: a.clientY - 300 });
  t.overlay.fire('pointerup', { pointerId: 1, clientX: a.clientX, clientY: a.clientY - 300 });
  ok(t.sends.length === 0, 'but not played');
  ok(/turn/.test(t.hint()), 'and it says whose turn it is: ' + JSON.stringify(t.hint()));
}

// a watching window touches nothing
{
  const n = 4, cards = 5, me = 1, W = 412, H = 860;
  const made = stateFor(n, cards, me, { phase: 'tricks', turn: null, pturn: me, bids: Array(n).fill(1) });
  const L = load(W, H, 'off');
  const sends = [];
  L.Felt.sync(made.ST, me, { send: moves(sends), watch: true });
  const overlay = L.dom.document.getElementById('deal');
  const F = L.Stage.fan(cards, W, H);
  const seat = L.Stage.ring(n, me, W, H).at(me);
  const a = { clientX: W / 2 + seat.x + F.at(1).x, clientY: H / 2 + F.at(1).y, pointerId: 1, button: 0 };
  overlay.fire('pointerdown', a);
  overlay.fire('pointermove', { pointerId: 1, clientX: a.clientX, clientY: a.clientY - 300 });
  overlay.fire('pointerup', { pointerId: 1, clientX: a.clientX, clientY: a.clientY - 300 });
  ok(sends.length === 0, 'a watching window plays nothing');
  ok(/watching/.test((overlay.querySelector('.felt-hint') || {}).textContent || ''), 'and says so');
}

// the cards on the table, and who took the trick
{
  const n = 4, cards = 5, me = 1, W = 412, H = 860;
  const made = stateFor(n, cards, me, { phase: 'tricks', turn: null, pturn: me, bids: Array(n).fill(1) });
  const L = load(W, H, 'off');
  L.Felt.sync(made.ST, me, {});
  const stage = L.dom.document.querySelector('.deal-stage');
  const before = stage.querySelectorAll('.dcard').length;
  const trick = [{ p: 0, card: made.hands[0][0] }, { p: 2, card: made.hands[2][0] }];
  const st2 = stateFor(n, cards, me, { phase: 'tricks', turn: null, pturn: me, bids: Array(n).fill(1) }).ST;
  st2.hand = made.ST.hand;
  st2.play.upcard = made.ST.play.upcard;
  st2.play.trick = trick;
  st2.play.counts = made.hands.map((h, i) => (i === 0 || i === 2 ? h.length - 1 : h.length));
  L.Felt.sync(st2, me, {});
  ok(stage.querySelectorAll('.dcard').length === before, 'a card played comes off its pile, not out of thin air');
  const faces = trick.map((x) => stage.querySelectorAll('.dcard').find((e) => {
    const b = e.querySelector('.big');
    return b && b.textContent === Game.cardGlyph(x.card);
  }));
  ok(faces.every(Boolean), 'and lands face up');
  // then the trick is held up, won by seat 2
  const st3 = stateFor(n, cards, me, { phase: 'tricks', turn: null, pturn: null, bids: Array(n).fill(1) }).ST;
  st3.hand = made.ST.hand;
  st3.play.upcard = made.ST.play.upcard;
  st3.play.trick = [];
  st3.play.last = { trick, winner: 2 };
  st3.play.counts = st2.play.counts;
  L.Felt.sync(st3, me, {});
  ok(stage.querySelectorAll('.dcard.took').length === 1, 'the card that took it is marked');
  // and then it is gathered away
  const st4 = stateFor(n, cards, me, { phase: 'tricks', turn: null, pturn: 2, bids: Array(n).fill(1) }).ST;
  st4.hand = made.ST.hand;
  st4.play.upcard = made.ST.play.upcard;
  st4.play.counts = st2.play.counts;
  L.Felt.sync(st4, me, {});
  ok(stage.querySelectorAll('.dcard.took').length === 0, 'and gone when the next lead comes');
  ok(stage.querySelectorAll('.dcard').length === before - 2, 'with the trick off the table');
}

part('the pile in the middle');

/* One round, played out card by card against the server's own shape of state:
   a card lands, the trick fills, it is held up, it is gathered, the next lead
   comes. The felt has to keep the same cards all the way through. */
{
  const n = 4, cards = 5, me = 1, W = 412, H = 860;
  const base = stateFor(n, cards, me, { phase: 'tricks', turn: null, pturn: 0, bids: Array(n).fill(1) });
  const L = load(W, H, 'off');
  const upcard = base.ST.play.upcard;
  const hand = base.ST.hand;
  const count = () => stage.querySelectorAll('.dcard').length;
  const step = (o) => {
    const st = stateFor(n, cards, me, Object.assign({ phase: 'tricks', bids: Array(n).fill(1) }, o)).ST;
    st.hand = o.hand || hand;
    st.play.upcard = upcard;
    st.play.trick = o.trick || [];
    st.play.last = o.last || null;
    st.play.won = o.won || Array(n).fill(0);
    st.play.counts = o.counts || base.hands.map((h) => h.length);
    L.Felt.sync(st, me, { send: () => {} });
    return st;
  };
  L.Felt.sync(base.ST, me, { send: () => {} });
  const stage = L.dom.document.querySelector('.deal-stage');
  const overlay = L.dom.document.getElementById('deal');
  const all = count();
  ok(all === n * cards + 1, `the table starts with every card and the turned one (${all})`);

  const trick = [{ p: 0, card: base.hands[0][0] }, { p: 1, card: hand[0] },
                 { p: 2, card: base.hands[2][0] }, { p: 3, card: base.hands[3][0] }];
  const played = base.hands.map((h) => h.length - 1);
  step({ turn: null, pturn: 1, trick: trick.slice(0, 1), counts: [played[0], cards, cards, cards],
         hand });
  ok(count() === all, 'a card played keeps the count');
  ok(stage.querySelectorAll('.dcard.mine').length === cards + 1, 'and lands face up in the middle');

  // the trick fills, then is held up, won by seat 2
  const won = [0, 0, 1, 0];
  step({ turn: null, pturn: null, last: { trick, winner: 2 }, won,
         counts: played, hand: hand.slice(1) });
  ok(stage.querySelectorAll('.dcard.took').length === 1, 'the card that took the trick is ringed');
  ok(count() === all, 'and the trick is still all there while it is held');
  ok(!stage.querySelectorAll('.dcard.gone').length, 'nothing is on a won stack yet');

  /* A tap on the middle of the table does nothing: every card played is on
     show where its own player put it, so there is nothing to open. */
  const cy = L.Stage.ring(n, me, W, H).cy;
  const before = stage.querySelectorAll('.dcard').map((e) => e.style.transform).join('|');
  overlay.fire('pointerdown', { clientX: W / 2, clientY: H / 2 + cy, pointerId: 1, button: 0 });
  ok(stage.querySelectorAll('.dcard').map((e) => e.style.transform).join('|') === before,
    'a tap on the middle of the table moves nothing');

  // the winner leads: the trick is gathered onto their own stack
  step({ turn: null, pturn: 2, trick: [{ p: 2, card: base.hands[2][1] }], won,
         counts: [played[0], played[1], played[2] - 1, played[3]], hand: hand.slice(1) });
  const stacks = stage.querySelectorAll('.dcard.gone');
  /* The whole trick goes to whoever took it, not one card standing for it:
     they are the cards that were played, and they are what comes back out
     when the round is put away. */
  ok(stacks.length === n, `a trick gathered goes to the winner's stack whole (${stacks.length})`);
  ok(stacks.every((el) => spotOf(el).scale < 0.6), 'drawn small, out of the way');
  ok(stacks.every((el) => spotOf(el).face === 180), 'and face down');
  const spread = stacks.map((el) => spotOf(el).x);
  ok(new Set(spread).size === n, 'fanned, so it reads as the several cards it is');
  ok(count() === all, 'and none of the trick is thrown away');
}

/* The stacks of won tricks have to stay on the screen, off the fan, and out of
   the middle -- at every table size, with every trick won. */
{
  for (const [W, H] of [[360, 640], [412, 860], [500, 860], [760, 1000]]) {
    for (const n of [2, 4, 6, 8]) {
      const cards = 7, me = 1;
      if (cards > Game.maxCardsFor(n)) continue;
      const made = stateFor(n, cards, me, { phase: 'tricks', turn: null, pturn: me, bids: Array(n).fill(1) });
      // every trick so far to one seat, which is the worst case for its stack
      made.ST.play.won = made.ST.seats.map((_, i) => (i === 0 ? cards - 1 : 0));
      made.ST.play.counts = made.hands.map(() => 1);
      made.ST.hand = made.ST.hand.slice(0, 1);
      const L = load(W, H, 'off');
      L.Felt.sync(made.ST, me, { send: () => {} });
      const stage = L.dom.document.querySelector('.deal-stage');
      const stack = stage.querySelectorAll('.dcard.gone').map(spotOf);
      ok(stack.length === cards - 1, `${W}x${H} n=${n}: the stack is as tall as the tricks won`);
      const cw = (W <= 420 ? 52 : 64), ch = (W <= 420 ? 74 : 90);
      stack.forEach((sp) => {
        const hw = cw * sp.scale / 2, hh = ch * sp.scale / 2;
        ok(Math.abs(sp.x) + hw <= W / 2 && Math.abs(sp.y) + hh <= H / 2,
          `${W}x${H} n=${n}: a won card stays on the screen`);
        // clear of the turned card in the middle
        ok(Math.abs(sp.x) - hw > cw * 1.15 / 2 || Math.abs(sp.y) - hh > ch * 1.15 / 2,
          `${W}x${H} n=${n}: and out of the middle`);
      });
    }
  }
}

/* A phone that arrives in the middle of a round has no cards to gather, so the
   stacks are stood up from the count alone. */
{
  const n = 4, cards = 5, me = 1, W = 412, H = 860;
  const made = stateFor(n, cards, me, { phase: 'tricks', turn: null, pturn: me, bids: Array(n).fill(1) });
  made.ST.play.won = [2, 1, 0, 0];
  made.ST.play.counts = made.hands.map((h) => h.length - 3);
  made.ST.hand = made.ST.hand.slice(3);
  const L = load(W, H, 'off');
  L.Felt.sync(made.ST, me, { send: () => {} });
  const stage = L.dom.document.querySelector('.deal-stage');
  ok(stage.querySelectorAll('.dcard.gone').length === 3, 'the tricks already won are stood up from the count');
}

part('bidding, while you hold your cards');

function bidding(o) {
  const n = 4, cards = 5, me = 1, W = 412, H = 860;
  const made = stateFor(n, cards, me, Object.assign({ phase: 'bid' }, o || {}));
  const L = load(W, H, 'off');
  const sends = [];
  L.Felt.sync(made.ST, me, Object.assign({ send: moves(sends) }, o && o.hooks));
  const overlay = L.dom.document.getElementById('deal');
  const F = L.Stage.fan(cards, W, H);
  const B = L.Stage.bidRow(W);
  const size = B.size;
  const count = cards + 1;
  const room = Math.min(W - 20, 400);
  const step = count > 1 ? Math.min(size + 6, (room - size) / (count - 1)) : 0;
  const arc = L.Stage.fan(count, W, H);
  return { L, made, overlay, sends, n, cards, me, W, H,
           rail: () => overlay.querySelector('.felt-bids'),
           chips: () => overlay.querySelectorAll('.bidchip'),
           // where a thumb has to land to be on that number
           spot: (v) => ({ pointerId: 1, button: 0,
                           clientX: W / 2 + arc.off(v) * step,
                           clientY: H / 2 + F.y - B.foot - size / 2 }),
           head: () => (overlay.querySelector('.bidname') || null),
           hint: () => (overlay.querySelector('.felt-hint') || {}).textContent || '' };
}

// your turn: one number for every tricks you could win, and none for the rest
{
  const t = bidding({ turn: 1 });
  ok(!t.rail().hidden, 'the numbers are there when it is your turn');
  ok(t.chips().length === t.cards + 1, `one for every possible bid (${t.chips().length})`);
  ok(t.chips().map((c) => c.textContent).join(',') === '0,1,2,3,4,5', 'nought to the hand size');
  ok(/How many of the 5 tricks/.test(t.hint()), 'and it asks: ' + JSON.stringify(t.hint()));
  ok(!!t.head() && t.head().textContent === 'Your bid', 'the row is named, the way the hand is');
  const headUp = Number(/([\d]+)px/.exec(t.head().style.bottom)[1]);
  ok(headUp + 4 >= t.L.Stage.bidRow(t.W).up,
    'and a number lifted under a thumb reaches its letters and no further  got '
    + headUp + ' against ' + t.L.Stage.bidRow(t.W).up);
  // the numbers are picked up like the cards: a touch lifts one, a tap on the
  // one already up calls it
  const at3 = t.spot(3);
  t.overlay.fire('pointerdown', at3);
  ok(t.chips()[3].classList.contains('up'), 'touching a number lifts it');
  ok(t.sends.length === 0, 'and does not bid it');
  t.overlay.fire('pointerup', { pointerId: 1 });
  ok(t.chips()[3].classList.contains('up'), 'it stays up when the thumb comes off');
  t.overlay.fire('pointerdown', t.spot(1));
  ok(t.chips()[1].classList.contains('up') && !t.chips()[3].classList.contains('up'),
    'and a thumb along them lifts each in turn');
  t.overlay.fire('pointerup', { pointerId: 1 });
  t.overlay.fire('pointerdown', t.spot(1));
  t.overlay.fire('pointerup', { pointerId: 1 });
  ok(t.sends.length === 1 && t.sends[0].t === 'bid' && t.sends[0].v === 1,
    'a second tap bids it (' + JSON.stringify(t.sends) + ')');
  ok(t.chips().every((c) => c.disabled), 'and the numbers go dead until the table answers');
  // a keyboard needs no thumb
  const t2 = bidding({ turn: 1 });
  t2.chips()[2].fire('keydown', { key: 'Enter' });
  ok(t2.sends.length === 1 && t2.sends[0].v === 2, 'and Enter on a number bids it');
}

// somebody else's turn: nothing to tap
{
  const t = bidding({ turn: 2 });
  ok(t.rail().hidden && t.chips().length === 0, 'no numbers when it is not your turn');
  ok(!t.head(), 'and no heading over them');
  ok(/Waiting for/.test(t.hint()), 'and it says who is bidding: ' + JSON.stringify(t.hint()));
}

// the last bidder may still change, until the player after them bids
{
  const bids = [null, 2, null, null];
  const t = bidding({ turn: 2, bids });
  ok(!t.rail().hidden, 'the numbers come back while your bid can still be changed');
  ok(t.chips()[2].getAttribute('aria-pressed') === 'true', 'with the one you called lit');
  ok(/change it until/.test(t.hint()), 'and it says so: ' + JSON.stringify(t.hint()));
}

// screw the dealer: the number that would make the bids total the hand is out
{
  const n = 4, cards = 5, me = 1, W = 412, H = 860;
  const made = stateFor(n, cards, me, { phase: 'bid', turn: me, bids: [1, null, 1, 1] });
  made.ST.rounds[0].dealer = me;                  // you deal, so you bid last
  made.ST.cfg.screw = true;
  const L = load(W, H, 'off');
  const sends = [];
  L.Felt.sync(made.ST, me, { send: moves(sends) });
  const overlay = L.dom.document.getElementById('deal');
  const chips = overlay.querySelectorAll('.bidchip');
  const out = chips.filter((c) => c.classList.contains('nope'));
  ok(out.length === 1 && out[0].textContent === '2',
    `the forbidden bid is struck out (${out.map((c) => c.textContent).join(',')})`);
  ok(out[0].disabled, 'and cannot be tapped');
  ok(/must not total 5/.test((overlay.querySelector('.felt-hint') || {}).textContent || ''),
    'and the reason is given');
  // and the same number the shared rules forbid
  ok(Game.forbiddenBid(made.ST.rounds[0], me, made.ST.cfg, n) === 2,
    'which is the number the rules forbid');
}

/* The numbers must not sit on the heading above the fan -- nor on the ring
   round it, nor on the word cutting the top of that ring, when the reader is
   the one dealing. The row used to hang off the lowest card of the fan, which
   sinks as the hand grows: by seven cards it stood on the word. */
{
  for (const [W, H] of [[360, 640], [412, 860], [500, 860], [760, 1000]]) {
    for (const cards of [1, 5, 7, 13]) {
      const n = 4, me = 1;
      if (cards > Game.maxCardsFor(n)) continue;
      const made = stateFor(n, cards, me, { phase: 'bid', turn: me });
      made.ST.rounds[0].dealer = me;              // so the ring is round your own heading
      const L = load(W, H, 'off');
      L.Felt.sync(made.ST, me, { send: () => {} });
      const overlay = L.dom.document.getElementById('deal');
      const F = L.Stage.fan(cards, W, H);
      const B = L.Stage.bidRow(W);
      const size = B.size;
      // Where the felt actually put the row, not where the stage says it goes.
      const foot = pxOf(overlay.querySelector('.felt-bids').style.bottom);
      ok(Math.abs(foot - (F.y - B.foot)) <= 1,
         `${W}x${H} c=${cards}: the row stands over the middle of the fan, where `
         + `the room for it is kept  got ${Math.round(foot)} for ${Math.round(F.y - B.foot)}`);
      const label = F.y - 66;                      // and the heading starts here
      ok(foot + 4 < label, `${W}x${H} c=${cards}: the numbers clear "Your hand"`);
      /* The word on the ring is centred on the ring's top line and stands about
         six either side of it, so the row has that and some air to clear. */
      const ringTop = pxOf(overlay.querySelector('.dring').style.top);
      ok(foot + 12 <= ringTop,
         `${W}x${H} c=${cards}: and clear the ring on the dealer's heading `
         + `(${Math.round(foot)} against ${Math.round(ringTop)})`);
      const top = foot - B.up;
      // The turned card lies in the middle, come down to the size of a card
      // played, so the numbers have that to clear.
      const ch = L.Stage.cardSize(W).h;
      ok(top > L.Stage.ring(n, me, W, H).cy + ch / 2,
         `${W}x${H} c=${cards}: and clear the turned card (${Math.round(top)})`);
      const chips = overlay.querySelectorAll('.bidchip');
      const xs = chips.map((c) => Number(/([-\d]+)px/.exec(c.style.left)[1]));
      ok(Math.min(...xs) - size / 2 >= -W / 2, `${W}x${H} c=${cards}: and stay on the screen`);
      ok(Math.max(...xs) + size / 2 <= W / 2, `${W}x${H} c=${cards}: on the other side too`);
    }
  }
}

/* A table of many: the piles, the cards played and the turned card all have to
   lie somewhere without lying on each other. Eight seats at full size did not
   go round a phone -- the piles ran into their neighbours, the names under
   them, and the row of bid numbers. */
{
  // where a card actually covers, turned as it is
  const box = (sp, w, h) => {
    const r = Math.abs(sp.tilt) * Math.PI / 180;
    const hw = ((w * Math.abs(Math.cos(r)) + h * Math.abs(Math.sin(r))) / 2) * sp.scale;
    const hh = ((w * Math.abs(Math.sin(r)) + h * Math.abs(Math.cos(r))) / 2) * sp.scale;
    return { l: sp.x - hw, r: sp.x + hw, t: sp.y - hh, b: sp.y + hh };
  };
  const over = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l))
                       * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));

  for (const [W, H] of [[360, 640], [412, 860], [412, 915], [500, 860], [760, 1000]]) {
    for (const n of [2, 4, 6, 8]) {
      const cards = Math.min(6, Game.maxCardsFor(n));
      const me = 0;
      const made = stateFor(n, cards, me, { phase: 'tricks', turn: null, pturn: null, bids: Array(n).fill(1) });
      made.ST.play.trick = made.hands.map((h, p) => ({ p, card: h[0] }));
      made.ST.hand = made.ST.hand.slice(1);
      made.ST.play.counts = made.hands.map((h) => h.length - 1);
      const L = load(W, H, 'off');
      L.Felt.sync(made.ST, me, { send: () => {} });
      const stage = L.dom.document.getElementById('deal').querySelector('.deal-stage');
      const cs = L.Stage.cardSize(W), cw = cs.w, ch = cs.h;
      const R = L.Stage.ring(n, me, W, H);
      const mid = R.cy;                       // the middle of the table
      const tag = `${W}x${H} n=${n}`;

      const all = stage.querySelectorAll('.dcard').map((e) => ({ e, sp: spotOf(e) })).filter((v) => v.sp);
      const hero = all.find((v) => v.e.classList.contains('hero'));
      // face down and standing: a seat's pile. Face up in the middle: the trick.
      const piles = all.filter((v) => v.sp.face === 180 && !v.e.classList.contains('gone'));
      const played = all.filter((v) => v.sp.face === 0 && !v.e.classList.contains('hero')
                                    && Math.abs(v.sp.y - mid) < ch * 1.4 && Math.abs(v.sp.x) < W / 2 - 10
                                    && Math.hypot(v.sp.x, v.sp.y - mid) > 1);
      ok(!!hero && played.length === n, `${tag}: the turned card and one card a seat are on the table (${played.length})`);

      // the trick rings the turned card rather than piling onto it
      // the turned card is drawn at a played card's size, square on
      const hbox = { l: hero.sp.x - cw / 2, r: hero.sp.x + cw / 2,
                     t: hero.sp.y - ch / 2, b: hero.sp.y + ch / 2 };
      const worst = Math.max(...played.map((v) => over(box(v.sp, cw, ch), hbox)));
      ok(worst === 0, `${tag}: no card played covers the turned card (${Math.round(worst)}px²)`);

      // nor each other
      let pair = 0;
      for (let i = 0; i < played.length; i++) {
        for (let j = i + 1; j < played.length; j++) pair = Math.max(pair, over(box(played[i].sp, cw, ch), box(played[j].sp, cw, ch)));
      }
      ok(pair === 0, `${tag}: nor one another (${Math.round(pair)}px²)`);

      // a seat's pile keeps off its neighbours', and stays on the screen
      const mine2 = (v) => { let best = 0, at = 0; for (let q = 0; q < n; q++) { const s = R.at(q); const d = Math.hypot(v.sp.x - s.x, v.sp.y - s.y); if (q === 0 || d < best) { best = d; at = q; } } return at; };
      const bySeat = {};
      piles.forEach((v) => { const q = mine2(v); (bySeat[q] || (bySeat[q] = [])).push(box(v.sp, cw, ch)); });
      let clash = 0;
      Object.keys(bySeat).forEach((q) => Object.keys(bySeat).forEach((w) => {
        if (Number(q) >= Number(w)) return;
        bySeat[q].forEach((a) => bySeat[w].forEach((b) => { clash = Math.max(clash, over(a, b)); }));
      }));
      ok(clash === 0, `${tag}: no seat's pile lies on another's (${Math.round(clash)}px²)`);
      const off = piles.map((v) => box(v.sp, cw, ch)).filter((b) => b.l < -W / 2 || b.r > W / 2);
      ok(!off.length, `${tag}: and every pile is on the screen (${off.length} off)`);

      /* The row of bid numbers arcs above the reader's own hand, and takes
         the width of the screen however many seats there are. */
      const size = W <= 420 ? 40 : 44;
      const foot = L.Stage.fan(cards, W, H).at(0).y - 88;
      const cnt = cards + 1;
      const step = cnt > 1 ? Math.min(size + 6, (Math.min(W - 20, 400) - size) / (cnt - 1)) : 0;
      const half = ((cnt - 1) / 2) * step + size / 2;
      ok(half <= W / 2, `${tag}: the row of bid numbers is on the screen (${Math.round(half * 2)})`);
      const rail = { l: -half, r: half, t: foot - size * 1.34, b: foot };
      ok(over({ l: -cw / 2, r: cw / 2, t: mid - ch / 2, b: mid + ch / 2 }, rail) === 0,
         `${tag}: and clear of the turned card`);
      /* And clear of the seats either side of the reader, whose piles hang at
         exactly the height the row wants. The fan carries the row down with
         it, and both are put in the middle of the band under the piles -- on a
         screen with the room for it. A short one has none: the block is bigger
         than the band, and the fan can go no lower without reaching the line
         along the bottom. */
      const room = !L.Stage.fan(cards, W, H).pressed;
      let onRail = 0;
      Object.keys(bySeat).forEach((q) => {
        if (Number(q) === me) return;
        bySeat[q].forEach((a) => { onRail = Math.max(onRail, over(a, rail)); });
      });
      ok(!room || onRail === 0, `${tag}: and off the piles either side (${Math.round(onRail)}px²)`);
    }
  }
}

/* Your hand, the heading that names it, the row of numbers and the heading over
   that are one block, and the block goes in the band between the piles either
   side of the reader and the line along the bottom of the screen. */
{
  const W = 412, H = 915, n = 8, cards = 6, me = 0;
  const made = stateFor(n, cards, me, { phase: 'bid', turn: me });
  const L = load(W, H, 'off');
  L.Felt.sync(made.ST, me, { send: () => {} });
  const stage = L.dom.document.getElementById('deal').querySelector('.deal-stage');
  const F = L.Stage.fan(cards, W, H), B = L.Stage.bidRow(W), c = L.Stage.cardSize(W);
  const topOf = (el) => Number(/([-\d]+)px/.exec(el.style.top)[1]);
  const names = stage.querySelectorAll('.dname').filter((e) => !e.classList.contains('mine'));
  const lowest = Math.max(...names.map(topOf)) + 15;   // a name stands about this tall
  const head = F.y - B.foot - B.head - 15;             // the top of the block
  const foot = F.at(0).y + c.h / 2;                    // and its lowest card
  const line = H / 2 - 76;                             // the line along the bottom
  ok(head > lowest, `the block starts below the piles either side (${Math.round(head)} > ${Math.round(lowest)})`);
  ok(foot < line, `and ends above the line along the bottom (${Math.round(foot)} < ${Math.round(line)})`);
  ok(Math.abs((head - lowest) - (line - foot)) < 24,
    `with what is left over shared between its two ends (${Math.round(head - lowest)} / ${Math.round(line - foot)})`);
}

// a watching window has no numbers
{
  const t = bidding({ turn: 1, hooks: { watch: true } });
  ok(t.rail().hidden && t.chips().length === 0, 'a watching window is offered no bid');
}

/* A hand played out to nothing left a hole in the table. The last card of a
   hand lies on a dashed outline of itself, and the outline stays when the card
   goes -- so the place a hand had is still a place, and nothing has to appear
   out of nowhere at the moment it empties. */
{
  const n = 4, cards = 5, me = 1, W = 412, H = 860;
  const draw = (left) => {
    const made = stateFor(n, cards, me, { phase: 'tricks', turn: null, pturn: 0, bids: Array(n).fill(1) });
    made.ST.hand = made.hands[me].slice(0, left);
    made.ST.play.counts = Array(n).fill(left);
    const L = load(W, H, 'off');
    L.Felt.sync(made.ST, me, { send: () => {} });
    const stage = L.dom.document.querySelector('.deal-stage');
    return { on: stage.querySelectorAll('.dplace').filter((e) => !e.hidden).map(spotOf),
             cards: stage.querySelectorAll('.dcard') };
  };

  const spare = draw(3);
  ok(spare.on.length === 0, `no outline while a hand has cards to spare (${spare.on.length})`);
  const last = draw(1);
  ok(last.on.length === n, `every seat's last card lies on an outline (${last.on.length})`);
  ok(last.on.every((s) => last.cards.some((e) => {
    const c = spotOf(e);
    return c && Math.abs(c.x - s.x) < 0.5 && Math.abs(c.y - s.y) < 0.5;
  })), 'each one exactly under the card standing on it, so it is not seen yet');
  const empty = draw(0);
  ok(empty.on.length === n, `and they stay when the hands are played out (${empty.on.length})`);
  ok(empty.on.every((s, i) => Math.abs(s.x - last.on[i].x) < 0.5 && Math.abs(s.y - last.on[i].y) < 0.5),
    'in the same places, so nothing moves as the last cards go');
}

/* The felt tells the table when it is up -- the deal played out, or was tapped
   away, or was never played at all. The table waits to hear it before it bids a
   hand for a bot, so that nothing is bid while the cards are still in the air. */
{
  const n = 4, cards = 5, me = 1, W = 412, H = 860;
  const made = stateFor(n, cards, me, { phase: 'bid', turn: 0 });
  const L = load(W, H, 'off');
  const sent = [];
  const say = (m) => sent.push(m);
  const said = () => sent.filter((m) => m.t === 'dealt').length;
  L.Felt.sync(made.ST, me, { send: say });
  ok(said() === 1, `the felt says when its table is up (${said()})`);
  L.Felt.sync(made.ST, me, { send: say });
  ok(said() === 1, 'once for the round, however often it is drawn');
  made.ST.rounds[0].redeals = 1;                 // a bum deal: the hand is dealt again
  L.Felt.sync(made.ST, me, { send: say });
  ok(said() === 2, `and again when the hand is dealt again (${said()})`);

  const seen = [];
  load(W, H, 'off').Felt.sync(made.ST, me, { send: (m) => seen.push(m), watch: true });
  ok(!seen.some((m) => m.t === 'dealt'), 'a window that only watches is dealt nothing, and says nothing');
}

part('off the table, and on to the next round');

// the talk stays reachable: the table covers the page's own button
{
  const n = 4, cards = 5, me = 1;
  const made = stateFor(n, cards, me, { phase: 'bid', turn: me });
  const L = load(412, 860, 'off');
  L.Felt.sync(made.ST, me, { send: () => {} });
  const overlay = L.dom.document.getElementById('deal');
  ok(!!overlay.querySelector('.felt-talk'), 'the table carries a talk button of its own');
  ok(L.talk.length === 1, 'wired to the same sheet as the page\'s');
  ok(!!overlay.querySelector('.felt-talk').querySelector('.chat-badge'), 'with the same unread count');
  ok(!!overlay.querySelector('.felt-out'), 'and the way out to the scorecard');
}

// the page knows the felt is up, so what it says in passing keeps off the round line
{
  const n = 4, cards = 5, me = 1;
  const made = stateFor(n, cards, me, { phase: 'bid', turn: me });
  const L = load(412, 860, 'off');
  const body = L.dom.document.body;
  L.Felt.sync(made.ST, me, { send: () => {} });
  ok(body.classList.contains('felt-up'), 'the page is marked while the felt is up');
  L.Felt.hide();
  ok(!body.classList.contains('felt-up'), 'and not once it is dropped');
  L.Felt.show();
  ok(body.classList.contains('felt-up'), 'and again when it comes back');
  L.Felt.sync(Object.assign({}, made.ST, { phase: 'lobby', rounds: [], play: null }), me, { send: () => {} });
  ok(!body.classList.contains('felt-up'), 'nor when the round is over and the felt goes');
}

// the foot line is cleared while the next hand is in the air
{
  const n = 4, cards = 5, me = 1;
  // a round with a bid already in is built as it stands, with no deal
  const made = stateFor(n, cards, me, { phase: 'bid', turn: 2, bids: [1, 1, null, null] });
  const L = load(412, 860, 'full');
  L.Felt.sync(made.ST, me, { send: () => {} });
  const overlay = L.dom.document.getElementById('deal');
  const hint = () => (overlay.querySelector('.felt-hint') || {}).textContent || '';
  ok(hint().length > 0, 'the felt has a line at its foot  got ' + hint());
  made.ST.rounds[0].redeals = 1;                 // a bum deal: the hand is dealt again, untouched
  made.ST.rounds[0].bids = [null, null, null, null]; made.ST.turn = 0;
  L.Felt.sync(made.ST, me, { send: () => {} });
  ok(hint() === '', 'and says nothing while the cards are in the air again  got ' + JSON.stringify(hint()));
}

// a vote on a bum deal reaches a player on the felt, and is answered there
{
  const n = 4, cards = 5, me = 1;
  const made = stateFor(n, cards, me, { phase: 'bid', turn: me });
  const L = load(412, 860, 'off');
  const sent = [];
  L.Felt.sync(made.ST, me, { send: (m) => sent.push(m) });
  const overlay = L.dom.document.getElementById('deal');
  const box = () => overlay.querySelector('.felt-vote');
  ok(box() && box().hidden === true, 'with no vote on, the felt shows none');
  made.ST.vote = { kind: 'bumdeal', by: 2, round: 0, yes: [2], no: [] };
  L.Felt.sync(made.ST, me, { send: (m) => sent.push(m) });
  ok(box().hidden === false, 'a vote called shows on the felt');
  ok(/bum deal/.test((box().querySelector('.vote-text') || {}).textContent || ''),
     'with the sentence  got ' + ((box().querySelector('.vote-text') || {}).textContent));
  const btns = box().querySelectorAll('button');
  ok(btns.length === 2 && btns[0].textContent === 'Agree, deal again',
     'and the answers  got ' + btns.map((b) => b.textContent).join('|'));
  sent.length = 0;
  btns[0].fire('click');
  ok(JSON.stringify(sent[0]) === '{"t":"vote","agree":true}',
     'an answer goes to the table  got ' + JSON.stringify(sent[0]));
  made.ST.vote = null;
  L.Felt.sync(made.ST, me, { send: (m) => sent.push(m) });
  ok(box().hidden === true, 'and the box goes when the vote does');
  const seen = [];
  const W = load(412, 860, 'off');
  made.ST.vote = { kind: 'bumdeal', by: 2, round: 0, yes: [2], no: [] };
  W.Felt.sync(made.ST, me, { send: (m) => seen.push(m), watch: true });
  const wb = W.dom.document.getElementById('deal').querySelector('.felt-vote');
  ok(wb && wb.hidden === false && wb.querySelectorAll('button').length === 0,
     'a window that only watches reads the vote and cannot answer it');
}

/* A round is scored and the next dealt in the same breath, so what the round
   paid is held up over the trick that ended it. */
/* The moment a scored round is held up for is a real second and a bit on a
   phone. Waiting it out here would be the whole of this file's running time
   spent asleep, so the timer the felt arms is caught instead and let off by
   hand -- which is what the clock would have done. */
function scored(motion) {
  const n = 4, cards = 5, me = 1;
  const first = stateFor(n, cards, me, { phase: 'tricks', turn: null, pturn: me, bids: [1, 2, 1, 1] });
  const L = load(412, 860, motion);
  L.Felt.sync(first.ST, me, { send: () => {} });
  const next = stateFor(n, 4, me, { phase: 'bid', turn: 2 }).ST;
  next.idx = 1;
  next.rounds = [{ cards, dealer: 0, trump: 'H', bids: [1, 2, 1, 1], tricks: [1, 0, 2, 2] },
                 next.rounds[0]];
  const armed = [];
  const realSet = setTimeout;
  const catching = (fn) => {
    global.setTimeout = (f, ms) => { armed.push({ fn: f, ms }); return realSet(() => {}, 0); };
    try { fn(); } finally { global.setTimeout = realSet; }
  };
  catching(() => L.Felt.sync(next, me, { send: () => {} }));
  const overlay = L.dom.document.getElementById('deal');
  /* Let the moment pass, however long the felt asked for, and then the putting
     away it sets going -- the tricks round the ring, the turned card face
     down. Those are all armed in one go, so one more pass runs the lot; what
     the deal arms after them is left to the clock, as it was. */
  const passes = () => runTimers(armed.filter((t) => t.ms > 1000),
    () => !!overlay.querySelector('.dcard.deck'));
  return { L, overlay, armed, passes, beat: () => overlay.querySelector('.felt-beat') };
}
{
  const t = scored('off');
  ok(!t.beat() || t.beat().hidden, 'with animations off the round is not held up');
}
{
  /* The table puts itself away rather than being replaced: every trick won
     comes off the seat that took it, goes round the ring the other way, and
     squares up in the middle under the card the deck turned -- which then
     goes face down on top of them, leaving a deck. */
  const n = 4, cards = 5, me = 1;
  const first = stateFor(n, cards, me, { phase: 'tricks', turn: null, pturn: me,
                                         bids: [1, 2, 1, 1], won: [1, 0, 2, 2] });
  const L = load(412, 860, 'full');
  L.Felt.sync(first.ST, me, { send: () => {} });
  const stage = L.dom.document.getElementById('deal').querySelector('.deal-stage');
  const tricks = () => stage.querySelectorAll('.dcard.gone');
  const hero = () => stage.querySelector('.dcard.hero');
  /* The middle of the table, where the deck squares up. Both halves are
     asked: the seats at the top and the foot play onto a spot with no sideways
     offset either, and those are not the middle. */
  const cy = L.Stage.ring(n, me, 412, 860).cy;
  const middle = (el) => {
    const s = spotOf(el);
    return !!s && Math.abs(s.x) < 1 && Math.abs(s.y - cy) < 8;
  };
  ok(tricks().length === 5, 'a card a trick stands beside the seat that took it  got ' + tricks().length);
  ok(tricks().filter(middle).length === 0, 'and none of them is in the middle');
  ok(spotOf(hero()).face === 0, 'the card the deck turned lies face up  got ' + spotOf(hero()).face);

  const next = stateFor(n, 4, me, { phase: 'bid', turn: 2 }).ST;
  next.idx = 1;
  next.rounds = [{ cards, dealer: 0, trump: 'H', bids: [1, 2, 1, 1], tricks: [1, 0, 2, 2] },
                 next.rounds[0]];
  next.totals = [11, -2, 12, 12];
  const armed = [];
  const realSet = setTimeout;
  const catching = (fn) => {
    global.setTimeout = (f, ms) => { armed.push({ fn: f, ms }); return realSet(() => {}, 0); };
    try { fn(); } finally { global.setTimeout = realSet; }
  };
  // What the cards are asked to do, rather than where they are afterwards: the
  // way in is one movement now, and a movement is not read off a style.
  const onPile = tricks().map((el) => el.style.transform);
  const arcs = [];
  L.dom.El.prototype.animate = function (kf, opts) {
    const a = { el: this, kf, opts: opts || {}, cancel() {}, commitStyles() {}, pause() {},
                play() {}, finish() {}, finished: Promise.resolve(), onfinish: null };
    arcs.push(a);
    return a;
  };
  L.dom.El.prototype.getAnimations = () => [];
  catching(() => L.Felt.sync(next, me, { send: () => {} }));
  ok(tricks().length === 5, 'the round is scored and the table is still standing');
  const paid = armed.filter((t) => t.ms >= 2000);
  armed.length = 0;
  catching(() => paid.forEach((t) => t.fn()));
  const steps = armed.slice().sort((a, b) => a.ms - b.ms);
  armed.length = 0;
  const stack = tricks();
  const R = L.Stage.ring(n, me, 412, 860);
  const ang = (kf) => {
    const m = spotOfKf(kf);
    return m ? Math.atan2((m.y - R.cy) / (R.ry || 1), m.x / (R.rx || 1)) : null;
  };
  /* Each trick is drawn one whole movement -- a run of places along an arc --
     rather than set down at each seat in turn, which reads as hopping. */
  const runs = arcs.filter((a) => stack.indexOf(a.el) >= 0);
  ok(runs.length === 5, 'every trick is given a way in  got ' + runs.length);
  ok(runs.every((a) => a.kf.length > 8),
     'and it is an arc, not a hop from seat to seat  got '
     + runs.map((a) => a.kf.length).join(','));

  // One after another: every card takes the same time and starts later.
  const offs = runs.map((a) => a.opts.delay || 0).sort((x, y) => x - y);
  ok(new Set(offs).size === offs.length && offs[0] === 0,
     'they set off one at a time  got ' + offs.join(','));
  ok(runs.every((a) => a.opts.duration === runs[0].opts.duration),
     'each taking as long as the last');

  /* The movement begins on the pile the card is lying on, so the lift is part
     of it: an arc that begins anywhere else is a jump into position first. */
  ok(runs.every((a) => a.kf[0].transform === onPile[stack.indexOf(a.el)]),
     'each one starts off the pile it is lying on');
  /* One stream: every card sets off after the one before it, evenly, so what
     leaves the table is a run of cards rather than a block of them landing
     every so often. */
  const when = runs.map((a) => a.opts.delay || 0).sort((x, y) => x - y);
  ok(new Set(when).size === when.length && when[0] === 0,
     'every card has a place of its own in the stream  got ' + when.join(','));
  const gaps = when.slice(1).map((v, i) => v - when[i]);
  ok(new Set(gaps).size === 1 && gaps[0] >= 42,
     'evenly spaced, and far enough apart to read as cards  got ' + gaps.join(','));
  // And it lies there until its turn: filling an animation backwards would
  // stand every card up the moment the first one set off.
  ok(runs.every((a) => (a.opts.fill || '') === 'forwards'),
     'it holds its place until then  got ' + runs.map((a) => a.opts.fill).join(','));
  ok(stack.every((el, i) => el.style.transform === onPile[i]),
     'so the table is still showing them on their piles');
  // Out to where the seat is as it lifts, and in to the middle at the end.
  const lift = runs.map((a) => spotOfKf(a.kf[1]));
  ok(lift.every((h) => h && Math.abs(Math.hypot(h.x / R.rx, (h.y - R.cy) / R.ry) - 1) < 0.02),
     'it comes up over its own seat  got '
     + lift.map((h) => Math.round(Math.hypot(h.x / R.rx, (h.y - R.cy) / R.ry) * 100) / 100).join(','));
  ok(runs.every((a) => {
    const e = spotOfKf(a.kf[a.kf.length - 1]);
    return e && Math.abs(e.x) < 1 && Math.abs(e.y - R.cy) < 8;
  }), 'and ends under the card the deck turned');

  /* Anticlockwise, the way round opposite to the way a trick is gathered. The
     ring runs clockwise as the angle grows, so the angle has to fall. */
  const turned = runs.map((a) => {
    // Only over the outer part of the arc: a card closing on the middle has
    // barely any distance left to take an angle from, and the answer there is
    // noise rather than a direction. The pile it lifts off is skipped too --
    // it sits beside the seat, not on the ring.
    let d = 0;
    const upto = Math.ceil((a.kf.length - 1) / 3);
    for (let i = 2; i <= upto; i++) {
      let step = ang(a.kf[i]) - ang(a.kf[i - 1]);
      while (step > Math.PI) step -= 2 * Math.PI;
      while (step < -Math.PI) step += 2 * Math.PI;
      d += step;
    }
    return d;
  });
  ok(turned.every((d) => d < -0.5),
     'and it goes round anticlockwise  got ' + turned.map((d) => Math.round(d * 100) / 100).join(','));

  // It closes on the middle as it goes, rather than crossing and coming back.
  const closes = runs.every((a) => {
    const r = a.kf.slice(1, -1).map((f) => {
      const m = spotOfKf(f);
      return Math.hypot(m.x / R.rx, (m.y - R.cy) / R.ry);
    });
    return r.every((v, i) => i === 0 || v <= r[i - 1] + 1e-9);
  });
  ok(closes, 'closing on the middle the whole way, never opening out again');

  const top = Number(hero().style.zIndex || 0);
  ok(stack.every((el) => Number(el.style.zIndex || 0) < top),
     'the turned card stands over them all the way in  got ' + top);
  const done = steps[steps.length - 1];
  steps.slice(0, -1).forEach((t) => t.fn());
  ok(tricks().filter(middle).length === 5, 'and they all end in the middle  got ' + tricks().filter(middle).length);
  ok(middle(hero()) && spotOf(hero()).face === 180,
     'the card the deck turned goes face down on top of them  got ' + JSON.stringify(spotOf(hero())));
  /* These stand for tricks this phone never saw taken, so they have no face to
     show and come in face down. A trick with a face travels face up. */
  ok(stack.every((el) => spotOf(el).face === 180),
     'a stand-in for a trick with no face is never turned over to a blank front');

  /* And the shuffle carries on from the deck the round left: the stage is not
     wiped and the overlay is not faded up -- that fade was the page behind
     showing through between two rounds. */
  const asked = [];
  L.dom.El.prototype.animate = function (kf, opts) {
    const a = { el: this, kf, opts: opts || {}, cancel() {}, commitStyles() {}, pause() {}, play() {},
                finish() {}, finished: Promise.resolve(), onfinish: null };
    asked.push(a);
    return a;
  };
  L.dom.El.prototype.getAnimations = () => [];
  const overlay = L.dom.document.getElementById('deal');

  /* Then where the round leaves everybody stands over the deck it just made,
     in the scorecard's own rows, before the next round is shuffled from it. */
  const after = [];
  const realAgain = setTimeout;
  /* The list moves off what it was last time -- the widths the bars had, the
     order the names were in -- so it has to be drawn into the same box, and
     that box has to be standing when it is drawn. Both are asked at the
     moment it is drawn, because neither can be read back afterwards. */
  const drawn = [];
  const realStandings = L.Table.standings;
  L.Table.standings = function (box, st, o) {
    drawn.push({ box, up: !box.parentNode.hidden, totals: (st.totals || []).slice() });
    return realStandings.call(this, box, st, o);
  };
  global.setTimeout = (f, ms) => { after.push({ fn: f, ms }); return realAgain(() => {}, 0); };
  try { done.fn(); } finally { global.setTimeout = realAgain; L.Table.standings = realStandings; }
  const panel = overlay.querySelector('.felt-stands');
  ok(drawn.length === 1 && drawn[0].up,
     'the list is standing before its rows are drawn, so it has places to slide from');
  ok(drawn[0].box === panel.querySelector('.standings'),
     'and it is drawn into the box the panel keeps between rounds');
  ok(typeof drawn[0].box._places === 'string' && drawn[0].box._places.length > 0,
     'which now remembers the order, for the next round to move off  got '
     + JSON.stringify(drawn[0].box._places));
  ok(!!panel && !panel.hidden, 'the places stand up over the deck the round left');
  const rows = panel.querySelectorAll('.stand-row');
  ok(rows.length === 4, 'one row a seat  got ' + rows.length);
  // The figures are written into the rows' markup, which the fake DOM keeps
  // the shape of and not the words; the order is the thing to ask about here.
  ok(rows.map((el) => el.dataset.k).join(',') === 's2,s3,s0,s1',
     'best first, worst last  got ' + rows.map((el) => el.dataset.k).join(','));
  ok(rows[3].classList.contains('me'), 'and your own row is marked');
  ok(!stage.querySelector('.dcard.deck'), 'nothing is shuffled while they are up');
  /* It comes up showing where things stood and holds there, and only then says
     what the round did: a list already moving as it arrives has moved before
     anybody has found their own row. */
  ok(drawn[0].totals.join() !== next.totals.join(),
     'it comes up as the round found it  got ' + drawn[0].totals.join());
  ok(after.some((t) => t.ms === 500),
     'and is armed to move a moment later  got ' + after.map((t) => t.ms).join(','));
  ok(after.some((t) => t.ms === 3000),
     'and to go by itself after that  got ' + after.map((t) => t.ms).join(','));
  L.Table.standings = function (box, st, o) {
    drawn.push({ box, up: !box.parentNode.hidden, totals: (st.totals || []).slice() });
    return realStandings.call(this, box, st, o);
  };
  after.filter((t) => t.ms === 500).forEach((t) => t.fn());
  L.Table.standings = realStandings;
  ok(drawn.length === 2 && drawn[1].totals.join() === next.totals.join(),
     'what it moves to is where the round leaves everybody  got '
     + drawn.map((d) => d.totals.join()).join(' | '));
  runTimers(after, () => !!stage.querySelector('.dcard.deck'));
  ok(panel.hidden, 'then they go, and the deal has the table');

  /* And again a round later, which is the round that has somewhere to move
     from: the list has been put away since, and it has to come back standing
     and into the box it was drawn in before, or the places jump. */
  const third = stateFor(n, 3, me, { phase: 'bid', turn: 2 }).ST;
  third.idx = 2;
  third.rounds = [next.rounds[0],
                  { cards: 4, dealer: 1, trump: 'S', bids: [1, 1, 1, 1], tricks: [2, 1, 1, 0] },
                  third.rounds[0]];
  third.totals = [23, 10, 24, 1];
  const wasBox = drawn[0].box;
  drawn.length = 0;
  const again = [];
  L.Table.standings = function (box, st, o) {
    drawn.push({ box, up: !box.parentNode.hidden, totals: (st.totals || []).slice() });
    return realStandings.call(this, box, st, o);
  };
  global.setTimeout = (f, ms) => { again.push({ fn: f, ms }); return realAgain(() => {}, 0); };
  try { L.Felt.sync(third, me, { send: () => {} }); } finally { global.setTimeout = realAgain; }
  runTimers(again, () => drawn.length > 0);
  L.Table.standings = realStandings;
  ok(drawn.length === 1, 'the places are stood up again  got ' + drawn.length);
  ok(drawn[0].up, 'standing before its rows are drawn, with the last round\'s still in it');
  ok(drawn[0].box === wasBox,
     'and it is the box the round before was drawn in, so the rows and the bars '
     + 'have somewhere to move from');
  ok(stage.querySelectorAll('.dcard.deck').length === 9,
     'the deck is taken over where it lies  got ' + stage.querySelectorAll('.dcard.deck').length);
  ok(tricks().length === 0, 'and what the round left is cleared away under it  got ' + tricks().length);
  ok(!overlay.hidden, 'the table never goes');
  const up = asked.filter((a) => a.el === overlay && a.kf[0] && a.kf[0].opacity === 0);
  ok(up.length === 0, 'and it is never faded up over the page behind  got ' + up.length);
  /* Taking the stage over closes the scene that had it, and a scene going out
     fades the overlay away with the fill kept. Something of ours has to lie
     over that, or the table is left invisible on a page with no way back. */
  const held = asked.filter((a) => a.el === overlay && a.kf[a.kf.length - 1]
    && a.kf[a.kf.length - 1].opacity === 1);
  ok(held.length > 0, 'the table is held at full against the fade the last scene left  got ' + held.length);
  /* The deck is riffled, of course -- what it is not is landed card by card
     first. A pop fades a card up from nothing; a shuffle never does. */
  const pops = asked.filter((a) => /\bdeck\b/.test(a.el.className || '')
    && a.kf[0] && a.kf[0].opacity === 0);
  ok(pops.length === 0, 'and it is not landed card by card first: it is already there  got ' + pops.length);
  const riffled = asked.filter((a) => /\bdeck\b/.test(a.el.className || ''));
  ok(riffled.length > 0, 'it goes straight into the shuffle  got ' + riffled.length);
}
{
  const t = scored('full');
  const b = t.beat();
  ok(b && !b.hidden, 'the round just scored is held up');
  ok(!b.classList.contains('hit'), 'and says you went down when you did');
  ok(/bid 2/.test(b.querySelectorAll('span')[0].textContent), 'with what you bid');
  ok(/won 0/.test(b.querySelectorAll('span')[0].textContent), 'and what you won');
  const pts = Game.roundScore(2, 0, { bonus: 10, miss: 'atleast' });
  ok(b.querySelectorAll('i')[0].textContent === `${pts >= 0 ? '+' : ''}${pts} points`,
    'and what it paid, by the same rule the scorecard uses');
  // the table waits: a state arriving now must not sweep it away
  const stage = t.overlay.querySelector('.deal-stage');
  const cards0 = stage.querySelectorAll('.dcard').length;
  const again = stateFor(4, 4, 1, { phase: 'bid', turn: 2 }).ST;
  again.idx = 1;
  again.rounds = [{ cards: 5, dealer: 0, trump: 'H', bids: [1, 2, 1, 1], tricks: [1, 0, 2, 2] },
                  again.rounds[0]];
  t.L.Felt.sync(again, 1, {});
  ok(!t.beat().hidden && stage.querySelectorAll('.dcard').length === cards0,
    'and the table it was played on stays until the moment is over');
  // and it comes to an end
  ok(t.armed.some((x) => x.ms > 1000), 'the moment is armed to end by itself  got '
    + t.armed.map((x) => x.ms).join(','));
  t.passes();
  ok(t.beat().hidden, 'then the moment passes');
  // The felt then deals the next round, and the cards land when the scene says
  // so rather than in this turn, so the hand is looked for in the next one.
  setImmediate(() => {
    ok(t.overlay.querySelector('.deal-stage').querySelectorAll('.dcard.mine').length === 4,
      'and the next hand is on the table');
  });
}

// a made bid says so
{
  const n = 4, cards = 5, me = 1;
  const first = stateFor(n, cards, me, { phase: 'tricks', turn: null, pturn: me, bids: [1, 2, 1, 1] });
  const L = load(412, 860, 'full');
  L.Felt.sync(first.ST, me, { send: () => {} });
  const next = stateFor(n, 4, me, { phase: 'bid', turn: 2 }).ST;
  next.idx = 1;
  next.rounds = [{ cards, dealer: 0, trump: 'H', bids: [1, 2, 1, 1], tricks: [1, 2, 1, 1] },
                 next.rounds[0]];
  L.Felt.sync(next, me, { send: () => {} });
  const b = L.dom.document.getElementById('deal').querySelector('.felt-beat');
  ok(b.classList.contains('hit'), 'a bid made is marked as made');
  ok(/made it/.test(b.querySelectorAll('b')[0].textContent), 'and said out loud');
}

/* A trick taken is a moment of its own: the table says who took it, and only
   when that has been read are the cards gathered in. */
function tookTrick(motion) {
  const n = 4, cards = 5, me = 1;
  // every seat has played, and the seat across the table took it
  const made = stateFor(n, cards, me, { phase: 'tricks', turn: null, pturn: me, bids: [1, 2, 1, 1] });
  const L = load(412, 860, motion);
  L.Felt.sync(made.ST, me, { send: () => {} });
  const cardsPlayed = made.hands.map((h, p) => ({ p, card: h[0] }));
  const held = JSON.parse(JSON.stringify(made.ST));
  held.hand = made.ST.hand.slice(1);
  held.play.trick = [];
  held.play.last = { trick: cardsPlayed, winner: 3 };
  held.play.won = [0, 0, 0, 1];
  held.play.turn = null;
  held.play.counts = made.hands.map((h) => h.length - 1);
  L.Felt.sync(held, me, { send: () => {} });
  const overlay = L.dom.document.getElementById('deal');
  const stage = overlay.querySelector('.deal-stage');
  return { L, held, overlay, stage, beat: () => overlay.querySelector('.felt-beat') };
}
{
  const t = tookTrick('full');
  const b = t.beat();
  ok(b && !b.hidden && b.classList.contains('trick'), 'a trick taken is named');
  ok(/won that trick/.test(b.querySelectorAll('b')[0].textContent),
     'and says so  got ' + b.querySelectorAll('b')[0].textContent);
  ok(!b.classList.contains('hit'), 'somebody else took this one, so it is not marked as yours');
  ok(/trick 1 of 5/.test(b.querySelectorAll('span')[0].textContent),
     'with the trick it was  got ' + b.querySelectorAll('span')[0].textContent);
  ok(t.stage.querySelectorAll('.dcard.took').length === 1, 'the card that took it is still on the table');
  ok(t.stage.querySelectorAll('.dcard.gone').length === 0, 'and nothing has been gathered yet');
}
{
  // the same trick, taken by the reader
  const n = 4, cards = 5, me = 1;
  const made = stateFor(n, cards, me, { phase: 'tricks', turn: null, pturn: me, bids: [1, 2, 1, 1] });
  const L = load(412, 860, 'full');
  L.Felt.sync(made.ST, me, { send: () => {} });
  const held = JSON.parse(JSON.stringify(made.ST));
  held.hand = made.ST.hand.slice(1);
  held.play.trick = [];
  held.play.last = { trick: made.hands.map((h, p) => ({ p, card: h[0] })), winner: me };
  held.play.won = [0, 1, 0, 0];
  held.play.turn = null;
  L.Felt.sync(held, me, { send: () => {} });
  const b = L.dom.document.getElementById('deal').querySelector('.felt-beat');
  ok(b.classList.contains('hit'), 'a trick you took is marked as yours');
  ok(/^You won/.test(b.querySelectorAll('b')[0].textContent), 'and named as yours');
  ok(!b.querySelectorAll('i').length,
     'and no tally: every seat carries its own under its pile');
}
{
  /* The beat after the last bid. The bids are what the table is looking at
     through it, so the piles keep saying what was bid and nothing is
     playable; the felt reads it off the state, and holds no clock of its own. */
  const n = 4, cards = 5, me = 1;
  const made = stateFor(n, cards, me, { phase: 'bid', turn: null, bids: [1, 2, 1, 1] });
  const L = load(412, 860, 'full');
  L.Felt.sync(made.ST, me, { send: () => {} });
  const reading = JSON.parse(JSON.stringify(made.ST));
  reading.phase = 'tricks';
  reading.play.turn = null;
  reading.play.held = true;
  L.Felt.sync(reading, me, { send: () => {} });
  const overlay = L.dom.document.getElementById('deal');
  const b = overlay.querySelector('.felt-beat');
  ok(b && !b.hidden && b.classList.contains('bids'), 'the felt names the moment the bids are in');
  ok(b.querySelectorAll('b')[0].textContent === 'Bids are in',
     'and says what it is  got ' + b.querySelectorAll('b')[0].textContent);
  ok(/bids total 5 · 5 tricks/.test(b.querySelectorAll('span')[0].textContent),
     'with what they come to against the hand  got ' + b.querySelectorAll('span')[0].textContent);
  ok(b.querySelectorAll('i')[0].textContent === 'You lead',
     'and who leads  got ' + b.querySelectorAll('i')[0].textContent);
  ok(/^Bids are in\. You lead the first trick\.$/.test(overlay.querySelector('.felt-hint').textContent),
     'the line under the table says the same  got ' + overlay.querySelector('.felt-hint').textContent);
  const names = overlay.querySelectorAll('.dname');
  ok(names[me].textContent === 'Your hand · 2',
     'your own bid moves to your label, where the rail was  got ' + names[me].textContent);
  ok(!/\//.test(names[(me + 1) % n].textContent),
     'and no seat is showing tricks won against a hand nobody has played  got ' + names[(me + 1) % n].textContent);
  ok(overlay.querySelectorAll('.dcard.dud').length === 0, 'no card is refused, because none may be played yet');

  const open = JSON.parse(JSON.stringify(reading));
  open.play.held = false;
  open.play.turn = me;
  L.Felt.sync(open, me, { send: () => {} });
  ok(overlay.querySelector('.felt-beat').hidden === true, 'the moment passes when the table says so');
  ok(/^You · 0\/2$/.test(overlay.querySelectorAll('.dname')[me].textContent),
     'and the labels turn to won against bid  got ' + overlay.querySelectorAll('.dname')[me].textContent);
}
{
  /* Who deals is a mark on the seat, not words in the round line. A name in a
     line has to be read and then matched to a seat; the ring is the answer
     where the question is asked, and it goes round what that seat has on the
     table -- its cards and the name under them. */
  const n = 4, cards = 5, me = 1;
  // A bid is in, so the felt draws the table itself rather than dealing it.
  const made = stateFor(n, cards, me, { bids: [1, null, null, null], turn: 1 });
  const L = load(412, 860, 'full');
  L.Felt.sync(made.ST, me, { send: () => {} });
  const overlay = L.dom.document.getElementById('deal');
  const cap = overlay.querySelector('.deal-cap');
  ok(cap.textContent === 'Round 1 · 5 cards',
     'the round line is the round and the count, and no more  got ' + cap.textContent);
  const ring = overlay.querySelector('.dring');
  ok(!!ring, 'the seat that deals is ringed');
  ok(!!ring && ring.querySelector('.dring-tag').textContent === 'dealer',
     'and the word says which mark it is');
  ok(!!ring && ring.parentNode.children.indexOf(ring) === 0,
     'the ring is first on the stage, so every card lies over it');
  const b = boxOf(ring);
  const R = L.Stage.ring(n, me, 412, 860), F = L.Stage.fan(cards, 412, 860);
  const first = L.Stage.pile(R, F, 0, 0, n), last = L.Stage.pile(R, F, 0, cards - 1, n);
  const c = L.Stage.cardSize(412), z = L.Stage.seatScale(n);
  ok(b.x - b.w / 2 <= Math.min(first.x, last.x) - c.w * z / 2
     && b.x + b.w / 2 >= Math.max(first.x, last.x) + c.w * z / 2,
     'it goes round the whole pile, not the top card of it');
  ok(b.y < Math.min(first.y, last.y) - c.h * z / 2, 'it starts above the cards');
  const name = overlay.querySelectorAll('.dname')[0];
  ok(b.y + b.h > pxOf(name.style.top), 'and takes the name under them in with it');
  // The other three seats have no mark of their own: one ring, one dealer.
  ok(overlay.querySelectorAll('.dring').length === 1, 'and nobody else is ringed');
}
{
  /* The box is what it holds. Each card in a pile is turned a little more than
     the one under it, so the two ends of a pile are not turned the same, and one
     allowance taken at the worse of them left up to nine pixels of dead air at
     the straighter end. The word is centred on the box, so it read as pushed off
     the cards it stands over -- worst at the seats up the sides of the table,
     where the pile is turned most, and not there at all at the seat opposite. */
  const W = 412, H = 860;
  for (const n of [3, 4, 6]) {
    for (const cards of [1, 5, 7, 13]) {
      if (cards > Game.maxCardsFor(n)) continue;
      const me = 1;
      const made = stateFor(n, cards, me, { bids: [1, null, null, null], turn: 1 });
      const L = load(W, H, 'full');
      const R = L.Stage.ring(n, me, W, H), F = L.Stage.fan(cards, W, H);
      const c = L.Stage.cardSize(W), z = L.Stage.seatScale(n);
      const wide = (d) => ((c.w * Math.cos(Math.abs(d) * Math.PI / 180)
                          + c.h * Math.sin(Math.abs(d) * Math.PI / 180)) * z) / 2;
      for (let q = 0; q < n; q++) {
        if (q === me) continue;                     // your own seat is the heading
        made.ST.rounds[0].dealer = q;
        L.Felt.sync(made.ST, me, { send: () => {} });
        const box = boxOf(L.dom.document.getElementById('deal').querySelector('.dring'));
        const a = L.Stage.pile(R, F, q, 0, n), b = L.Stage.pile(R, F, q, cards - 1, n);
        const lo = Math.min(a.x - wide(a.tilt), b.x - wide(b.tilt));
        const hi = Math.max(a.x + wide(a.tilt), b.x + wide(b.tilt));
        const tag = `n=${n} c=${cards} seat ${q}`;
        ok(Math.abs(box.x - (lo + hi) / 2) <= 1,
           `${tag}: the word stands over the middle of the pile  `
           + `got ${Math.round(box.x)} for ${Math.round((lo + hi) / 2)}`);
        ok(Math.abs((lo - (box.x - box.w / 2)) - ((box.x + box.w / 2) - hi)) <= 1,
           `${tag}: with the same air either side of it`);
      }
    }
  }
}
{
  /* Your own seat is a fan across the bottom of the screen with a heading over
     it. A box round the fan would be most of the screen wide, would shrink with
     every card played, and would lie over the line a card is dragged across; a
     box round the heading alone crowded the hand. So your own mark is the word
     with no outline, standing where the box's top line would have run. */
  const n = 4, cards = 5, me = 1;
  const made = stateFor(n, cards, me, { bids: [1, null, null, null], turn: 1 });
  made.ST.rounds[0].dealer = me;
  const L = load(412, 860, 'full');
  L.Felt.sync(made.ST, me, { send: () => {} });
  const overlay = L.dom.document.getElementById('deal');
  const b = boxOf(overlay.querySelector('.dring'));
  const fanY = L.Stage.fan(1, 412, 860).y, ch = L.Stage.cardSize(412).h;
  ok(Math.abs(b.x) <= 1, 'your own ring stands over the middle, where the heading does');
  ok(b.y < fanY - 66 && b.y + b.h > fanY - 66, 'the heading is inside it');
  ok(b.y + b.h < fanY - ch / 2, 'and the fan is left outside it');
  ok(b.w < 412 * 0.6, 'so it is a badge over a heading, not a box round the hand  got ' + b.w);
  const own = overlay.querySelector('.dring');
  ok(own.classList.contains('own'), 'your own seat is marked as your own');
  ok(own.querySelector('.dring-tag').textContent === 'dealer', 'and still carries the word');
}
{
  // The stylesheet is what takes the outline off it, and only off your own.
  const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');
  ok(/\.dring\.own \.dring-box\{[^}]*display:\s*none/.test(css),
     'no box is drawn round your own mark');
  ok(/\n\.dring-box\{[^}]*border:[^;]*dashed/.test(css),
     'and every other seat still gets one');
}
{
  /* A card another seat plays comes off the top of their pile: it lifts, turns
     over, and bows onto the spot it lands on. A card that slides straight out
     of a pile was never picked up -- it appears rather than being played. */
  const n = 4, cards = 5, me = 1, them = 3;
  const made = stateFor(n, cards, me, { phase: 'tricks', turn: null, pturn: them });
  const L = load(412, 860, 'full');
  L.Felt.sync(made.ST, me, { send: () => {} });
  const stage = L.dom.document.getElementById('deal').querySelector('.deal-stage');
  const all = () => stage.querySelectorAll('.dcard');
  // A pile card is face down and is nobody's: your own hand is already .mine.
  const onPile = all().filter((el) => !el._cls.has('mine') && !el._cls.has('hero'))
    .map((el) => ({ el, tf: el.style.transform }));

  const arcs = [];
  L.dom.El.prototype.animate = function (kf, opts) {
    const a = { el: this, kf, opts: opts || {}, cancel() {}, commitStyles() {}, pause() {},
                play() {}, finish() {}, finished: Promise.resolve(), onfinish: null };
    arcs.push(a);
    return a;
  };
  L.dom.El.prototype.getAnimations = () => [];

  const next = JSON.parse(JSON.stringify(made.ST));
  next.play.trick = [{ p: them, card: made.hands[them][0] }];
  next.play.turn = (them + 1) % n;
  next.play.counts = made.hands.map((h, q) => h.length - (q === them ? 1 : 0));
  const armed = [];
  const realSet = setTimeout;
  global.setTimeout = (f, ms) => { armed.push({ f, ms }); return realSet(() => {}, 0); };
  try { L.Felt.sync(next, me, { send: () => {} }); } finally { global.setTimeout = realSet; }

  const was = onPile.find((b) => b.el._cls.has('mine'));
  ok(!!was, 'the card played is the one that was lying on top of their pile');
  const played = was && was.el;
  const runs = arcs.filter((a) => a.el === played);
  ok(runs.length === 1, 'and it is given one way onto the table  got ' + runs.length);
  const kf = runs.length ? runs[0].kf : [];
  ok(kf.length > 5, 'a bow, not a slide  got ' + kf.length);
  ok(kf.length > 0 && kf[0].transform === was.tf,
     'it sets off from where it was lying on the pile');
  ok(kf.length > 0 && kf[kf.length - 1].transform === played.style.transform,
     'and ends where the table already says it belongs');
  ok(runs.length > 0 && !runs[0].opts.fill,
     'nothing fills forwards on a card with a round still to play');
  ok(runs.length > 0 && runs[0].opts.duration === 140,
     'and it takes exactly a card\'s own pace, which is what carries it without an arc  got '
     + (runs.length ? runs[0].opts.duration : '-'));

  // Off the pile face down, and over well before it lands.
  const faces = kf.map((f) => spotOfKf(f).face);
  ok(faces[0] === 180, 'it comes off the pile face down  got ' + faces[0]);
  ok(faces[faces.length - 1] === 0, 'and lands face up');
  ok(faces.indexOf(0) > 1, 'not on the pile  got ' + faces.join(','));
  /* And it takes its time over it. The turn used to be squeezed into the fast
     middle of an eased curve and read as no turn at all, so what is checked is
     that most of the places named on the way have the card part-turned. */
  const turning = faces.filter((v) => v > 0 && v < 180).length;
  ok(turning >= Math.floor(faces.length * 0.5),
     'turning over across most of the way, not in one step  got ' + turning
     + ' of ' + faces.length + ' places  ' + faces.map(Math.round).join(','));
  ok(runs.length > 0 && runs[0].opts.easing === 'linear',
     'the shaping is in the keyframes, so the turn is not bent by an easing');

  /* The bow is across the way it is going, turned the way the table turns:
     clockwise, the same way the trick that gathers it comes round. */
  const R = L.Stage.ring(n, me, 412, 860);
  const p0 = spotOfKf(kf[0]), p2 = spotOfKf(kf[kf.length - 1]);
  const vx = p2.x - p0.x, vy = p2.y - p0.y, vl = Math.hypot(vx, vy);
  const across = kf.map((f) => {
    const m = spotOfKf(f);
    return ((m.x - p0.x) * vy - (m.y - p0.y) * vx) / vl;   // + is clockwise of the line
  });
  ok(across.every((v) => v > -0.01), 'it never crosses to the other side of the line  got '
     + across.map((v) => Math.round(v)).join(','));
  ok(Math.max(...across) > vl * 0.1,
     'and bows a real way across it  got ' + Math.round(Math.max(...across)) + ' of ' + Math.round(vl));

  // It comes up a little as it lifts, and lands the size it was.
  const scale = kf.map((f) => spotOfKf(f).scale);
  ok(Math.max(...scale) > scale[0] * 1.02 && Math.abs(scale[scale.length - 1] - scale[0]) < 1e-9,
     'it lifts off the stack and lands the size it was  got '
     + scale.map((v) => Math.round(v * 100) / 100).join(','));
}
{
  /* A phone that arrives in the middle of a round has cards already played and
     piles it has never placed. Those belong where they belong: nothing is
     thrown across the table on the first paint of a round. */
  const n = 4, cards = 5, me = 1, them = 3;
  const made = stateFor(n, cards, me, { phase: 'tricks', turn: null, pturn: 0 });
  made.ST.play.trick = [{ p: them, card: made.hands[them][0] }];
  made.ST.play.counts = made.hands.map((h, q) => h.length - (q === them ? 1 : 0));
  const L = load(412, 860, 'full');
  const arcs = [];
  L.dom.El.prototype.animate = function (kf, opts) {
    const a = { el: this, kf, opts: opts || {}, cancel() {}, commitStyles() {}, pause() {},
                play() {}, finish() {}, finished: Promise.resolve(), onfinish: null };
    arcs.push(a);
    return a;
  };
  L.dom.El.prototype.getAnimations = () => [];
  L.Felt.sync(made.ST, me, { send: () => {} });
  const stage = L.dom.document.getElementById('deal').querySelector('.deal-stage');
  const on = stage.querySelectorAll('.dcard');
  // The peek shivers a pile all the while; what must not be here is a way onto
  // the table, which is the one movement that long.
  const bows = arcs.filter((a) => on.indexOf(a.el) >= 0 && a.opts.duration === 140);
  ok(bows.length === 0, 'a table stood up mid-round throws nothing across it  got ' + bows.length);
}
{
  /* The trick comes in the way it went out: each card goes round the ring
     clockwise, on a drawn arc, and they meet on the winner's spot before the
     stack goes to the pile. A card that crossed the middle would say nothing
     about who won it. */
  const n = 4, cards = 5, me = 1;
  const made = stateFor(n, cards, me, { phase: 'tricks', turn: null, pturn: me, bids: [1, 2, 1, 1] });
  const L = load(412, 860, 'full');
  L.Felt.sync(made.ST, me, { send: () => {} });
  const held = JSON.parse(JSON.stringify(made.ST));
  held.hand = made.ST.hand.slice(1);
  held.play.trick = [];
  held.play.last = { trick: made.hands.map((h, p) => ({ p, card: h[0] })), winner: 3 };
  held.play.won = [0, 0, 0, 1];
  held.play.turn = null;
  held.play.counts = made.hands.map((h) => h.length - 1);
  const timers = [];
  const realSet = setTimeout;
  global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return realSet(() => {}, 0); };
  try { L.Felt.sync(held, me, { send: () => {} }); } finally { global.setTimeout = realSet; }

  const stage = L.dom.document.getElementById('deal').querySelector('.deal-stage');
  const won = stage.querySelector('.dcard.took');
  const spot = (el) => spotOf(el) || { x: NaN, y: NaN };
  const home = spot(won);
  const near = (el) => Math.abs(spot(el).x - home.x) < 1 && Math.abs(spot(el).y - home.y) < 1;
  const onWinner = () => stage.querySelectorAll('.dcard').filter(near).length;
  ok(!!won, 'the card that took the trick is marked');
  ok(onWinner() === 1, 'and it is the only card on its spot while the trick lies there  got ' + onWinner());

  // The cards set off inside the moment the trick is named, not after it.
  const off = timers.filter((t) => t.ms > 0 && t.ms < 2000);
  ok(off.length >= 1, 'they set off while the news is still up  got ' + timers.map((t) => t.ms).join(','));

  /* What the cards are asked to do, rather than where they are afterwards:
     the way in is one movement, and a movement is not read off a style. */
  const lying = stage.querySelectorAll('.dcard').map((el) => el.style.transform);
  const arcs = [];
  L.dom.El.prototype.animate = function (kf, opts) {
    const a = { el: this, kf, opts: opts || {}, cancel() {}, commitStyles() {}, pause() {},
                play() {}, finish() {}, finished: Promise.resolve(), onfinish: null };
    arcs.push(a);
    return a;
  };
  L.dom.El.prototype.getAnimations = () => [];
  const later = [];
  timers.filter((t) => t.ms < 2000).forEach((t) => {
    global.setTimeout = (f, ms) => { later.push({ fn: f, ms }); return realSet(() => {}, 0); };
    try { t.fn(); } finally { global.setTimeout = realSet; }
  });
  const onTable = stage.querySelectorAll('.dcard');
  const runs = arcs.filter((a) => onTable.indexOf(a.el) >= 0);
  /* Three cards to bring in, each in one movement -- and nothing set down at
     a seat on the way, which is what would read as hopping. */
  ok(runs.length === 3, 'each card is given one way in  got ' + runs.length);
  ok(later.length === 0, 'and no card is set down at a seat on the way  got ' + later.length);
  ok(runs.every((a) => a.kf.length > 5),
     'it is an arc, not a hop from seat to seat  got ' + runs.map((a) => a.kf.length).join(','));
  ok(runs.every((a) => !a.opts.fill),
     'and nothing fills forwards on a card with a round still to play  got '
     + runs.map((a) => String(a.opts.fill)).join(','));

  /* It sets off from where the card is lying and ends on the spot the table
     says it belongs, so there is no jump into the movement or out of it. */
  ok(runs.every((a) => a.kf[0].transform === lying[onTable.indexOf(a.el)]),
     'each one starts from where its card is lying');
  ok(runs.every((a) => a.kf[a.kf.length - 1].transform === won.style.transform),
     'and ends on the winner\'s spot');
  ok(onWinner() === 4, 'which is where the table already says the whole trick is  got ' + onWinner());

  /* Round the table, not across it: every place named on the way is the same
     distance out from the middle as a card played, and the angle only ever
     grows -- which is clockwise, the way the seats and the play run. */
  const R = L.Stage.ring(n, me, 412, 860);
  const out = (kf) => { const m = spotOfKf(kf); return Math.hypot(m.x, m.y - R.cy); };
  ok(runs.every((a) => {
    const rs = a.kf.map(out);
    return rs.every((v) => Math.abs(v - rs[0]) < 1);
  }), 'every place on the way is out where a played card lies, never across the middle');
  const turned = runs.map((a) => {
    const ang = (kf) => { const m = spotOfKf(kf); return Math.atan2(m.y - R.cy, m.x); };
    let d = 0;
    for (let i = 1; i < a.kf.length; i++) {
      let step = ang(a.kf[i]) - ang(a.kf[i - 1]);
      while (step > Math.PI) step -= 2 * Math.PI;
      while (step < -Math.PI) step += 2 * Math.PI;
      d += step;
    }
    return d;
  }).sort((x, y) => x - y);
  ok(turned.every((d) => d > 0.5), 'and it goes round clockwise  got '
     + turned.map((d) => Math.round(d * 100) / 100).join(','));
  /* The ways round are one, two and three seats long, and each is that far:
     a quarter of the table, a half, three quarters. */
  ok(turned.every((d, i) => Math.abs(d - (i + 1) * 2 * Math.PI / n) < 0.05),
     'each going as far round as its card has seats to pass  got '
     + turned.map((d) => Math.round(d * 100) / 100).join(','));

  /* The longest way round takes the whole sweep and the nearer seats
     proportionally less, so they set off together and come in in the order
     they sit. */
  const spans = runs.map((a) => a.opts.duration).sort((x, y) => x - y);
  ok(spans.join(',') === '140,280,420',
     'the longest way round takes the whole sweep, the rest proportionally less  got ' + spans.join(','));
  ok(runs.every((a) => !a.opts.delay), 'and they all set off together');
}
{
  const t = tookTrick('off');
  ok(!t.beat() || t.beat().hidden, 'with animations off nothing is said');
  ok(t.stage.querySelectorAll('.dcard.took').length === 1, 'and the trick lies there as it always did');
}

part('game speed');

/* How fast the game plays on this screen. It is a speed, so bigger is quicker
   and a duration is divided by it -- and it belongs to the screen, never to
   the table: nobody else's game changes because of it. */
{
  const dom = makeDom(412, 860);
  const quiet = { log() {}, info() {}, warn() {}, error() {} };
  const load1 = () => new Function('window', 'document', 'localStorage', 'console',
    fs.readFileSync(path.join(ROOT, 'public/ui.js'), 'utf8') + '\n; return UI;')(
    dom.window, dom.document, dom.localStorage, quiet);
  let UI = load1();

  ok(UI.speed() === 1, 'with nothing chosen the game plays as it is drawn  got ' + UI.speed());
  ok(UI.ms(400) === 400 && UI.hold(2000) === 2000, 'and nothing is scaled at 1x');

  UI.setSpeed(2);
  ok(UI.speed() === 2, 'twice is twice  got ' + UI.speed());
  ok(UI.ms(400) === 200, 'a movement takes half as long  got ' + UI.ms(400));
  ok(UI.hold(2000) === 1000, 'and a beat is cut in half too  got ' + UI.hold(2000));

  UI.setSpeed(0.5);
  ok(UI.speed() === 0.5, 'half is half  got ' + UI.speed());
  ok(UI.ms(400) === 800, 'a movement takes twice as long  got ' + UI.ms(400));
  /* A beat is a window the table grants, not one this screen may lengthen: a
     trick sits for TRICK_HOLD before the winner may lead, and the bots wait
     DEAL_WAIT for the phones. Past that the table moves on and cuts the beat
     anyway, which reads worse than never having asked. */
  ok(UI.hold(2000) === 2000, 'but a beat the table is waiting through is not drawn out  got '
     + UI.hold(2000));

  // It is remembered, and a speed that is not one of the three is not taken.
  ok(load1().speed() === 0.5, 'the choice is remembered');
  UI.setSpeed(3);
  ok(UI.speed() === 0.5, 'a speed that is not offered is refused  got ' + UI.speed());
  UI.setSpeed(1);

  // The stylesheet is told, because a transition cannot read a setting.
  UI.setSpeed(2);
  ok(dom.document.documentElement.style.getPropertyValue('--speed') === '2',
     'the stylesheet is told  got ' + dom.document.documentElement.style.getPropertyValue('--speed'));

  // A movement is scaled by its rate, so a delay and a duration go together.
  const a = { playbackRate: 1 };
  UI.paced(a);
  ok(a.playbackRate === 2, 'a movement is paced by its rate, delay and all  got ' + a.playbackRate);

  // And the row is on the settings page, in a section of its own.
  const rows = UI.commonSettings({ motion: true });
  const i = rows.findIndex((r) => r.label === 'Game speed');
  ok(i > 0, 'the settings page offers it');
  ok(rows[i - 1].kind === 'group' && rows[i - 1].label === 'Play',
     'in a section of its own  got ' + JSON.stringify(rows[i - 1]));
  ok(rows[i].options.map((o) => o.v).join(',') === '0.5,1,2',
     'half, as it is, and twice  got ' + rows[i].options.map((o) => o.v).join(','));
  ok(UI.commonSettings({}).every((r) => r.label !== 'Game speed'),
     'and not on a page that never animates anything');
  UI.setSpeed(1);
}

/* The stylesheet divides by it too: a card placed by a style has to keep pace
   with a card drawn by an arc, or the two disagree at every speed but one. */
{
  const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');
  const scaled = css.match(/calc\([.\d]+s \/ var\(--speed, 1\)\)/g) || [];
  ok(scaled.length >= 4, 'the transitions the table moves on are divided by it  got ' + scaled.length);
  ok(/\.deal\.table \.dcard\{transition:transform calc\(\.14s \/ var\(--speed, 1\)\)/.test(css),
     'a card among them');
}

/* Every timed thing on the felt is asked for at the speed the screen is
   playing at, and the two kinds are told apart: what it draws, and what it
   waits through while the table waits for it. */
{
  const n = 4, cards = 5, me = 1, them = 3;
  const made = stateFor(n, cards, me, { phase: 'tricks', turn: null, pturn: them });
  const L = load(412, 860, 'full');
  L.dom.localStorage.setItem('river-card-score:speed:v1', '2');
  L.Felt.sync(made.ST, me, { send: () => {} });
  const arcs = [];
  L.dom.El.prototype.animate = function (kf, opts) {
    const a = { el: this, kf, opts: opts || {}, playbackRate: 1, cancel() {}, commitStyles() {},
                pause() {}, play() {}, finish() {}, finished: Promise.resolve(), onfinish: null };
    arcs.push(a);
    return a;
  };
  L.dom.El.prototype.getAnimations = () => [];
  // One card played: the way in is still asked for at 1x and paced by its
  // rate, so the numbers in the file stay the game as it is drawn.
  const one = JSON.parse(JSON.stringify(made.ST));
  one.play.trick = [{ p: them, card: made.hands[them][0] }];
  one.play.turn = (them + 1) % n;
  one.play.counts = made.hands.map((h, q) => h.length - (q === them ? 1 : 0));
  L.Felt.sync(one, me, { send: () => {} });
  const way = arcs.filter((a) => a.opts.duration === 140 && a.kf.length > 5);
  ok(way.length === 1, 'the card is still given its way in  got ' + way.length);
  ok(way.length > 0 && way[0].playbackRate === 2,
     'drawn at twice the rate  got ' + (way.length ? way[0].playbackRate : '-'));

  // A trick taken: the beat it is left up for is halved, because it may be cut.
  const held = JSON.parse(JSON.stringify(made.ST));
  held.hand = made.ST.hand.slice(1);
  held.play.trick = [];
  held.play.last = { trick: made.hands.map((h, q) => ({ p: q, card: h[0] })), winner: them };
  held.play.won = [0, 0, 0, 0];
  held.play.won[them] = 1;
  held.play.turn = null;
  held.play.counts = made.hands.map((h) => h.length - 1);
  const armed = [];
  const realSet = setTimeout;
  global.setTimeout = (f, ms) => { armed.push({ f, ms }); return realSet(() => {}, 0); };
  try { L.Felt.sync(held, me, { send: () => {} }); } finally { global.setTimeout = realSet; }
  const beats = armed.map((t) => t.ms).sort((a, b) => a - b);
  ok(beats.indexOf(1000) >= 0, 'a trick is left up for half as long  got ' + beats.join(','));
  ok(beats.indexOf(790) >= 0,
     'and the cards set off inside it, the gather scaled with it  got ' + beats.join(','));
  L.dom.localStorage.setItem('river-card-score:speed:v1', '1');
}

part('the settings page');

/* The ⚙ opens a page laid over this one. The button holds a drawn icon, so a
   tap on it lands on the icon and not on the button; the page is a dialog
   with a back arrow, and Escape is the same way out. */
{
  const dom = makeDom(412, 860);
  dom.localStorage.setItem('river-card-score:motion:v1', 'off');
  const src = ['public/ui.js', 'public/settings.js']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
  const quiet = { log() {}, info() {}, warn() {}, error() {} };
  let shown = 'unset';
  const Avatar = { picker: (onPick) => {
    const el = dom.document.createElement('div');
    el.className = 'avrow';
    el.pick = onPick;
    return { el, show: (src) => { shown = src; }, say() {} };
  } };
  const { UI, Settings } = new Function('window', 'document', 'localStorage', 'console', 'Avatar',
    src + '\n; return { UI, Settings };')(dom.window, dom.document, dom.localStorage, quiet, Avatar);

  const bar = dom.document.createElement('div');
  dom.document.body.appendChild(bar);
  const btn = dom.document.createElement('button');
  const icon = dom.document.createElement('span');     // stands for the drawn icon
  btn.appendChild(icon);
  bar.appendChild(btn);

  let ran = 0, tog = false, pick = 'a', late = 'a.html';
  const page = Settings.wire(btn, { items: [
    { kind: 'group', label: 'Look' },
    { kind: 'choice', label: 'Pick', options: [{ v: 'a', label: 'A' }, { v: 'b', label: 'B' }],
      get: () => pick, set: (v) => { pick = v; } },
    { kind: 'toggle', label: 'Switch', get: () => tog, set: (v) => { tog = v; } },
    { kind: 'group', label: 'This screen' },
    { kind: 'action', label: 'Do the thing', run: () => { ran += 1; } },
    { kind: 'link', label: 'Front page', href: 'index.html' },
    // An address built out of the game: there is none when the rows are handed
    // over, so it has to be read when the row is drawn.
    { kind: 'link', label: 'Later', href: () => late },
    { kind: 'action', label: 'Never', hidden: () => true, run: () => { ran += 100; } },
  ] });
  const box = page.el;
  ok(dom.document.body.querySelector('.settings') === box && box.hidden, 'the page is there, shut');

  btn.fire('click');
  ok(!box.hidden, 'the button opens it');
  ok(btn.getAttribute('aria-expanded') === 'true', 'and says so');
  ok(box.querySelector('h1').textContent === 'Settings', 'it is the settings page');
  const panels = box.querySelector('.settings-main').children;
  ok(panels.length === 2, 'a group is a panel of its own  got ' + panels.length);
  ok(panels[0].querySelector('h2').textContent === 'Look'
     && panels[1].querySelector('h2').textContent === 'This screen', 'each with its heading');
  ok(panels[1].querySelectorAll('.menu-row').length === 3, 'a hidden row leaves itself out  got '
     + panels[1].querySelectorAll('.menu-row').length);

  /* A link's address is read when the row is drawn, not when the rows are
     handed over. The host screen's way to the dev page is built out of the
     table it is showing, and at wiring time there is no table yet. */
  const linkTo = (t) => (box.querySelectorAll('a').find((a) => a.textContent === t) || {}).href;
  ok(linkTo('Front page') === 'index.html', 'a link row carries its address');
  ok(linkTo('Later') === 'a.html', 'and an address that is a function is read as it draws');
  late = 'b.html';
  page.refresh();
  ok(linkTo('Later') === 'b.html',
     'so a row whose address needs the game gets it once there is one  got ' + linkTo('Later'));

  btn.fire('click');
  ok(box.hidden && btn.getAttribute('aria-expanded') === 'false', 'the same button shuts it');

  btn.fire('click');
  box.querySelector('.settings-back').fire('click');
  ok(box.hidden, 'so does the back arrow');
  btn.fire('click');
  dom.document.fire('keydown', { key: 'Escape' });
  ok(box.hidden, 'and Escape');

  btn.fire('click');
  const seg = box.querySelector('.seg');
  ok(seg.children[0].classList.contains('on') && !seg.children[1].classList.contains('on'), 'a choice shows what is set');
  seg.children[1].fire('click');
  ok(pick === 'b' && !box.hidden, 'a tap sets it and the page stays open');
  ok(box.querySelector('.seg').children[1].classList.contains('on'), 'redrawn with the new choice');
  const sw = box.querySelectorAll('.menu-tap')[0];
  ok(sw.getAttribute('role') === 'switch' && sw.querySelector('.menu-tick').textContent === '', 'a toggle is a switch, off');
  sw.fire('click');
  ok(tog === true && !box.hidden, 'a tap turns it on and the page stays open');
  ok(box.querySelectorAll('.menu-tap')[0].querySelector('.menu-tick').textContent === '✓', 'and it shows the tick');
  box.querySelectorAll('.menu-tap')[1].fire('click');
  ok(ran === 1 && box.hidden, 'an action does its thing and shuts the page');
  ok(typeof page.refresh === 'function', 'the page can ask it to redraw');

  // A screen with a player behind it: the name and the photo are at the top.
  let name = 'Ann', named = [], photos = [];
  const phone = Settings.wire(null, { items: [{ kind: 'group', label: 'Look' }],
    who: { name: () => name, photo: () => 'pic:' + name, note: () => 'A line about now',
           onName: (n) => { name = n; named.push(n); }, onPhoto: (d) => photos.push(d) } });
  const you = () => phone.el.querySelector('.settings-you');
  phone.open();
  ok(!!you() && phone.el.querySelector('.settings-main').children[0] === you(), 'the player comes first');
  ok(you().querySelector('.settings-name').value === 'Ann', 'with the name this phone plays under');
  ok(shown === 'pic:Ann', 'and the photo it has');
  ok(you().querySelector('.settings-note').textContent === 'A line about now', 'and the page\'s line about it');
  ok(!phone.el.querySelector('.settings-done'), 'no Done: the back arrow is the way out');
  you().querySelector('.avrow').pick('data:new');
  ok(photos[0] === 'data:new', 'a photo picked goes to the page at once');
  phone.close();
  ok(named.length === 0, 'a name left as it was is not sent again');
  phone.open();
  you().querySelector('.settings-name').value = '  Bea ';
  phone.close();
  ok(named[0] === 'Bea' && name === 'Bea', 'a new name goes to the page when the page shuts  got ' + named[0]);
  phone.open();
  you().querySelector('.settings-name').value = '';
  phone.close();
  ok(named.length === 1 && name === 'Bea', 'a name rubbed out is not a name: the old one stays');

  // The first time: the name alone, and no way out without one.
  name = '';
  phone.open({ first: true });
  ok(!phone.el.hidden && phone.el.querySelector('h1').textContent === 'Who are you?', 'the first ask says what it is');
  ok(phone.el.querySelector('.settings-back').hidden, 'with no back arrow');
  ok(phone.el.querySelector('.settings-main').children.length === 2, 'the player and Done, nothing else');
  const done = phone.el.querySelector('.settings-done');
  ok(done.disabled === true, 'Done waits for a name');
  dom.document.fire('keydown', { key: 'Escape' });
  ok(!phone.el.hidden, 'Escape is no way out');
  phone.close();
  ok(!phone.el.hidden, 'nor is closing it');
  const inp = phone.el.querySelector('.settings-name');
  inp.value = 'Cal';
  inp.fire('input');
  ok(done.disabled === false, 'a name typed frees Done');
  done.fire('click');
  ok(phone.el.hidden && named[1] === 'Cal', 'and Done keeps it and shuts the page  got ' + named[1]);
}

function done() {
  console.log(`\n${pass} checks passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

/* ---- the sticky boxes are watched, not measured ----

   The top bar and the standings both stick, and everything below them is
   pushed down by their height, so the pages asked for that height on every
   state. Asking reads two offsetHeights, which makes the browser lay the page
   out on the spot, and it was the most expensive thing left on the host
   screen -- 2.7 seconds of a six-minute game -- for an answer that only
   changes when a seat joins. The boxes are watched now, and the asking is
   free. */
part('the sticky boxes are watched, not measured');
{
  const dom = makeDom(412, 860);
  const seen = [];
  dom.window.ResizeObserver = function () {
    this.observe = (el) => seen.push(el);
    this.disconnect = () => {};
  };
  const bar = dom.document.createElement('div');
  bar.className = 'topbar';
  const stand = dom.document.createElement('div');
  stand.className = 'standings-panel';
  dom.document.body.appendChild(bar);
  dom.document.body.appendChild(stand);

  // Reading this is what costs: it is the browser laying the page out.
  let reads = 0;
  Object.defineProperty(dom.El.prototype, 'offsetHeight',
    { configurable: true, get() { reads += 1; return 20; } });

  const src = fs.readFileSync(path.join(ROOT, 'public/ui.js'), 'utf8');
  const UI = new Function('window', 'document', 'localStorage', 'console',
    src + '\n; return UI;')(dom.window, dom.document, dom.localStorage,
    { log() {}, info() {}, warn() {}, error() {} });

  UI.measureSticky();                 // the first ask sets the watching up
  ok(seen.length === 2, 'the top bar and the standings are both watched  got ' + seen.length);
  reads = 0;
  UI.measureSticky();
  UI.measureSticky();
  ok(reads === 0, 'and a page asking for the offset lays nothing out  got ' + reads + ' reads');
  UI.measureTopbar();
  ok(reads > 0, 'the measuring itself still measures, for whoever has no watcher  got ' + reads + ' reads');
}

/* ---- the way back ----

   The mark went round the houses. It was the ♠ in the corner, and with a photo
   set the ♠ was the player's own face: tapping yourself left the game. Then it
   was a named row in the settings menu, which is not where navigation goes
   either. It is a mark of its own now, at the left of the bar, on every page
   but the front one -- and the pages say only where their back goes. */
part('the way back');
{
  const loadBar = (o) => {
    const dom = makeDom(412, 860);
    const bar = new dom.El('header');
    bar.className = 'topbar';
    if (o.to) bar.dataset.back = o.to;
    if (o.name) bar.dataset.backName = o.name;
    const brand = new dom.El('div');
    brand.className = 'brand';
    const pip = new dom.El('span');
    pip.className = 'pip';
    brand.appendChild(pip);
    bar.appendChild(brand);
    dom.document.body.appendChild(bar);
    if (o.framed) dom.window.top = { notThisOne: true };
    const src = fs.readFileSync(path.join(ROOT, 'public/ui.js'), 'utf8');
    const UI = new Function('window', 'document', 'localStorage', 'location', 'console',
      src + '\n; return UI;')(dom.window, dom.document, dom.localStorage,
      { protocol: 'file:' }, { log() {}, info() {}, warn() {}, error() {} });
    dom.document.fire('DOMContentLoaded');
    return { UI, dom, bar, brand, pip, back: () => brand.querySelector('.backlink') };
  };

  {
    const t = loadBar({ to: 'index.html', name: 'Front page' });
    const back = t.back();
    ok(!!back, 'a bar that says where its back goes gets the mark');
    ok(back && back.href === 'index.html',
       'and the mark goes there  got ' + (back || {}).href);
    ok(t.brand.children[0] === back, 'at the left of the bar, before the pip');
    ok(back && back.tagName === 'A',
       'a link and not a button, so a screen that may not touch the game can still be left');
    ok(back && back.title === 'Front page' && back.getAttribute('aria-label') === 'Front page',
       'named by where it goes, for a reader who cannot see a chevron  got ' + (back || {}).title);
  }

  {   // The front page is what back means: it says nothing, and gets nothing.
    const t = loadBar({});
    ok(!t.back(), 'a bar that says nothing gets nothing');
  }

  {   /* A page inside a frame is a window onto a table -- the dev page's panes,
         the screen a replay is watched on -- and nobody navigates a window.
         The back would put the front page where the game was. */
    const t = loadBar({ to: 'index.html', name: 'Front page', framed: true });
    ok(!t.back(), 'and a window onto a table is never navigated');
  }

  {   // It is not in the menu any more, whatever the page asks for.
    const t = loadBar({});
    [{}, { motion: true }, { zoom: true }, { motion: true, zoom: true }].forEach((o) => {
      ok(t.UI.commonSettings(o).every((r) => r.label !== 'Front page'),
         'no page keeps the way back in its settings  got ' + JSON.stringify(o));
    });
  }

  {   // Every page but the front one says where its back goes.
    const wants = { 'history.html': 'index.html', 'host.html': 'index.html',
                    'play.html': 'index.html', 'dev.html': 'index.html',
                    'replay.html': 'history.html' };
    Object.keys(wants).forEach((f) => {
      const html = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
      const m = /<header class="topbar" data-back="([^"]+)" data-back-name="([^"]+)"/.exec(html);
      ok(!!m && m[1] === wants[f],
         f + ' goes back to ' + wants[f] + '  got ' + (m ? m[1] : 'no way back'));
    });
    const front = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
    ok(!/data-back/.test(front), 'and the front page has nowhere to go back to');
  }
}

/* ---- the tables this browser holds ----

   The bug: there was one slot for a seat, written by every page on every
   reconnect. A second table wrote over the first, and the seat at the first
   was then unreachable -- the token was in the slot that had just been
   overwritten, and a name is not accepted at a game that has started. */
part('the tables this browser holds');
{
  const loadNet = (seed) => {
    const dom = makeDom(412, 860);
    Object.keys(seed || {}).forEach((k) => dom.localStorage.setItem(k, seed[k]));
    const src = fs.readFileSync(path.join(ROOT, 'public/net.js'), 'utf8');
    const location = { protocol: 'http:', host: 'table', pathname: '/play.html', search: '', hash: '' };
    const seen = {};
    const history = { replaceState: (a, b, u) => { seen.url = u; } };
    const fn = new Function('window', 'document', 'localStorage', 'location', 'history', 'WebSocket',
      src + '\n; return Net;');
    return { Net: fn(dom.window, dom.document, dom.localStorage, location, history, function () {}), seen, dom };
  };

  const A = { code: 'AAAA', token: 'ta', role: 'player', seatId: 'sa' };
  const B = { code: 'BBBB', token: 'tb', role: 'player', seatId: 'sb' };

  {
    const { Net } = loadNet();
    Net.setSession(A);
    Net.setSession(B);
    ok(Net.tables().length === 2, 'a second table does not evict the first  got ' + Net.tables().length);
    ok(Net.tables()[0].code === 'BBBB', 'the newest is offered first');
    ok(Net.session('AAAA').token === 'ta', 'and the seat at the older one is still there');

    // this is the clobber: the page still open at the first table reconnects
    Net.setSession(A);
    ok(Net.session('BBBB') && Net.session('BBBB').token === 'tb',
       'a page reconnecting at one table cannot lose the seat at another');
    ok(Net.session().code === 'AAAA', 'the last page to speak is the one this browser used last');
  }

  {
    const { Net } = loadNet();
    Net.setSession(A);
    Net.setSession(B);
    Net.forget('AAAA');
    ok(Net.tables().length === 1 && Net.tables()[0].code === 'BBBB', 'a table is forgotten one at a time');
    ok(Net.session('AAAA') === null, 'and it is gone');
    Net.forget('BBBB');
    ok(Net.tables().length === 0 && Net.session() === null, 'and the last one with it');
  }

  {   // a browser that knew only the one, from before there was a list
    const { Net } = loadNet({ 'rcs:session:v1': JSON.stringify(A) });
    ok(Net.tables().length === 1 && Net.tables()[0].code === 'AAAA',
       'a seat saved before there was a list is still offered');
  }

  {   // eight is enough to hold, and the oldest goes
    const { Net } = loadNet();
    for (let i = 0; i < 10; i++) Net.setSession({ code: 'T' + i, token: 't', role: 'player' });
    ok(Net.tables().length === 8, 'no more than eight tables are kept  got ' + Net.tables().length);
    ok(!Net.tables().some((t) => t.code === 'T0'), 'and the oldest is the one dropped');
  }

  {   // the address says which table a page belongs to
    const { Net, seen } = loadNet();
    Net.pin('BBBB');
    ok(seen.url === '/play.html?c=BBBB', 'a page pins its own table to its address  got ' + seen.url);
  }

  {   // a preview keeps its seat to itself, and touches no list
    const { Net } = loadNet();
    Net.setSession(A);
    Net.setSession(B, true);
    ok(Net.session().code === 'BBBB', 'a seat held in memory answers this page');
    ok(Net.tables().length === 1 && Net.tables()[0].code === 'BBBB',
       'and it is not written into the list');
  }
}

/* ---- who came, and who went ---- */
part('who came, and who went');
{
  const said = [];
  const UI = { fx: { toast: (t, o) => said.push(t + ((o && o.note) ? ' · ' + o.note : '')) } };
  const src = fs.readFileSync(path.join(ROOT, 'public/table.js'), 'utf8');
  const Table = new Function('UI', 'Game', 'document', src + '\n; return Table;')(UI, Game, makeDom(412, 860).document);

  const seats = (o) => [
    { id: 's0', name: 'Ann', online: true },
    { id: 's1', name: 'Ben', online: o.benOn !== false, left: !!o.benLeft },
    { id: 's2', name: 'Cal', online: true },
  ];
  const st = (o) => ({ phase: 'bid', turn: 1, seats: seats(o), play: null });

  const first = Table.sayPresence(st({}), 0, null);
  ok(said.length === 0, 'the first state a page sees announces nothing');

  const away = Table.sayPresence(st({ benOn: false }), 0, first);
  ok(said.length === 1 && /^Ben dropped out/.test(said[0]), 'a phone going quiet is said  got ' + said[0]);
  ok(/waiting on them/.test(said[0]), 'and it says the table is stopped  got ' + said[0]);

  said.length = 0;
  Table.sayPresence(st({ benOn: false }), 0, away);
  ok(said.length === 0, 'and it is said once, not on every state after it');

  said.length = 0;
  const back = Table.sayPresence(st({}), 0, away);
  ok(said.length === 1 && /^Ben is back/.test(said[0]), 'coming back is said too  got ' + said[0]);

  said.length = 0;
  Table.sayPresence(st({ benOn: false, benLeft: true }), 0, back);
  ok(said.length === 1 && /^Ben left the game/.test(said[0]), 'leaving is a different line  got ' + said[0]);
  ok(/auto-play has that hand/.test(said[0]), 'and it says who has the hand now  got ' + said[0]);

  said.length = 0;
  Table.sayPresence(st({ benOn: false }), 1, first);
  ok(said.length === 0, 'your own phone is not announced to you');

  // a seat that is not on turn: nothing is held up
  said.length = 0;
  const other = { phase: 'bid', turn: 0, seats: seats({}), play: null };
  const two = Table.sayPresence(other, 0, null);
  Table.sayPresence({ phase: 'bid', turn: 0, seats: seats({ benOn: false }), play: null }, 0, two);
  ok(/come back to their seat/.test(said[0]), 'and a seat nobody waits on says so  got ' + said[0]);
}

/* ---- what a round paid ---- */
part('what a round paid');
{
  const said = [];
  const UI = { fx: { toast: (t, o) => said.push(t + ((o && o.note) ? ' · ' + o.note : '')) } };
  const src = fs.readFileSync(path.join(ROOT, 'public/table.js'), 'utf8');
  const Table = new Function('UI', 'Game', 'document', src + '\n; return Table;')(UI, Game, makeDom(412, 860).document);
  const cfg = { bonus: 10, miss: 'atleast' };
  const st = (rounds) => ({ cfg, rounds,
    seats: [{ id: 's0', name: 'Ann' }, { id: 's1', name: 'Ben' }, { id: 's2', name: 'Cal' }] });
  const played = { cards: 2, dealer: 0, bids: [1, 1, 0], tricks: [1, 0, 1] };
  const open = { cards: 1, dealer: 1, bids: [null, null, null], tricks: null };

  let k = Table.sayRound(st([Object.assign({}, played, { tricks: null }), open]), 0, null);
  ok(said.length === 0 && k === 0, 'the first state a page sees says nothing');
  k = Table.sayRound(st([played, open]), 0, k);
  ok(k === 1 && said[0] === 'You made it · +11 points · bid 1 · won 1', 'a bid made is said with what it paid  got ' + said[0]);
  said.length = 0;
  Table.sayRound(st([played, open]), 1, 0);
  ok(said[0] === 'You went down · 0 points · bid 1 · won 0', 'and a bid missed  got ' + said[0]);
  said.length = 0;
  Table.sayRound(st([played, open]), -1, 0);
  ok(said[0] === 'Ann +11 · Ben 0 · Cal +1 · round 1', 'a screen that belongs to nobody is told what everybody got  got ' + said[0]);
  said.length = 0;
  Table.sayRound(st([played, open]), 0, 1);
  ok(said.length === 0, 'and it is said once, not on every state after it');
  Table.sayRound(st([Object.assign({}, played, { tricks: null }), open]), 0, 1);
  ok(said.length === 0, 'a step back says nothing');
  Table.sayRound(st([played, open]), 0, 0, true);
  ok(said.length === 0, 'and nothing is said over the felt, which says it itself');
}

/* ---- the two pages that lost the game ----

   The front page offered one table and one only; the host screen made a new
   table whenever the browser did not already hold a host token, which is how a
   television came to invent a table nobody was sitting at. Both are checked
   here against a document that answers any selector, which is enough to see
   what the page builds and what it puts on the wire. */
part('a bot is not announced');

/* A pill says what somebody did while you were looking away. A bot answers the
   moment it is asked, so a table with three of them kept three lines stacked up
   through the whole of the bidding, saying nothing anybody could act on. */
{
  const n = 4, cards = 5, me = 1;
  const made = stateFor(n, cards, me, { bids: [2, null, 1, 3], turn: null });
  const ST = made.ST, r = ST.rounds[0];
  const L = load(412, 860, 'off');
  const box = () => L.dom.document.getElementById('toaster');
  const lines = () => (box() ? box().children.map((el) =>
    el.querySelector('.what').textContent) : []);
  const clear = () => { if (box()) box().children.slice().forEach((el) => el.remove()); };

  [0, 2, 3].forEach((p) => { ST.seats[p].bot = true; });
  L.Table.sayBids(ST, r, [0, 2, 3], me);
  ok(lines().length === 0, 'three bots bidding say nothing  got ' + JSON.stringify(lines()));

  clear();
  ST.seats[0].bot = false;                       // one of them is a person
  L.Table.sayBids(ST, r, [0, 2, 3], me);
  ok(lines().length === 1 && lines()[0] === 'P1 bid 2',
     'and the one person among them is the only line  got ' + JSON.stringify(lines()));
  ok(box().children[0].querySelector('.note').textContent === 'all bids in',
     'which still carries who the table waits on next');

  clear();
  L.Table.sayBids(ST, r, [me], me);
  ok(lines().length === 0, 'your own bid is still not announced, bot or not');

  // Four people bidding at once is a catch-up, and collapses; three bots and
  // one person is not a catch-up.
  clear();
  [0, 2, 3].forEach((p) => { ST.seats[p].bot = false; });
  L.Table.sayBids(ST, r, [0, 2, 3], me);
  ok(lines().length === 1 && /^3 more bids in$/.test(lines()[0]),
     'three people at once collapse to one line  got ' + JSON.stringify(lines()));
  clear();
  [2, 3].forEach((p) => { ST.seats[p].bot = true; });
  L.Table.sayBids(ST, r, [0, 2, 3], me);
  ok(lines().length === 1 && lines()[0] === 'P1 bid 2',
     'but two bots and a person do not  got ' + JSON.stringify(lines()));
}

{
  // A bot never drops out or comes back, and if one ever did it would not be said.
  const n = 3, cards = 3, me = 0;
  const made = stateFor(n, cards, me);
  const ST = made.ST;
  ST.seats[1].bot = true;
  const L = load(412, 860, 'off');
  const box = () => L.dom.document.getElementById('toaster');
  const seen = L.Table.sayPresence(ST, me, null);
  ST.seats[1].online = false;
  ST.seats[2].online = false;
  L.Table.sayPresence(ST, me, seen);
  const said = box().children.map((el) => el.querySelector('.what').textContent);
  ok(said.length === 1 && said[0] === 'P3 dropped out',
     'a seat going quiet is said for a person and not for a bot  got ' + JSON.stringify(said));
}

part('the front page, and the screen');
{
  const anything = new Proxy(function () {}, {
    get: (t, k) => (k === 'then' ? undefined : anything),
    apply: () => anything,
    construct: () => anything,
  });

  /* o.real lists modules loaded for real beside the page; o.given hands in a
     stub of your own for a name the page reads a value off. */
  function loadPage(file, seed, search, o) {
    o = o || {};
    const dom = makeDom(412, 860);
    Object.keys(seed || {}).forEach((k) => dom.localStorage.setItem(k, seed[k]));
    const els = {};
    const pick = (sel) => (els[sel] || (els[sel] = new dom.El('div')));
    dom.document.querySelector = pick;
    dom.document.getElementById = (id) => pick('#' + id);
    const gone = [];
    const location = { protocol: 'http:', host: 'table', hostname: o.hostname || 'table', pathname: '/' + file,
                       search: search || '', hash: o.hash || '',
                       get href() { return this._h; }, set href(v) { this._h = v; gone.push(v); } };
    const history = { replaceState: (a, b, u) => { history.url = u; } };
    dom.window.location = location;              // as in a browser: one address, two names
    const socks = [];
    function WebSocket(url) { this.url = url; this.readyState = 1; this.sent = []; socks.push(this); }
    WebSocket.prototype.send = function (raw) { this.sent.push(JSON.parse(raw)); };
    WebSocket.prototype.close = function () { this.readyState = 3; };
    const src = ['public/net.js'].concat(o.real || []).concat(['public/' + file])
      .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
    const names = ['UI', 'Settings', 'Scan', 'Avatar', 'Chat', 'Deal', 'Games', 'Table', 'Accolades', 'Finale', 'Stage', 'Felt', 'Lobby', 'Round', 'Viewer']
      .filter((n) => !(o.real || []).some((f) => f.toLowerCase().indexOf(n.toLowerCase() + '.js') >= 0));
    /* Two stand-ins that cannot simply answer everything. A page reads the
       photo off Avatar as a string, so this one answers "no photo"; and it
       asks UI where it is being read, where yes-to-everything would have every
       page believe it was the machine serving it. Those two answer off the
       fake page's own address; the rest of UI is the usual stand-in. */
    const where = {
      servedHere: () => /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname || ''),
      inApp: () => /UpTheRiverApp/.test(((dom.window.navigator || {}).userAgent) || ''),
    };
    const UIstub = new Proxy(function () {}, {
      get: (t, k) => (k === 'then' ? undefined : (k in where ? where[k] : anything)),
      apply: () => anything,
      construct: () => anything,
    });
    const given = Object.assign({ UI: UIstub,
      Avatar: { saved: () => null, remember() {}, url: () => null,
                picker: () => ({ el: new dom.El('div'), show() {}, say() {} }) } }, o.given || {});
    const fetch = o.fetch || (() => Promise.reject(new Error('the fake DOM reaches no server')));
    /* A page that arms a repeating timer would hold the whole suite open long
       after its checks are done, so a check that loads one hands in its own. */
    const timer = o.setInterval || (() => 0);
    const fn = new Function('window', 'document', 'localStorage', 'location', 'history', 'WebSocket',
      'Game', 'console', 'fetch', 'setInterval', ...names, src + '\n; return { Net };');
    const out = fn(dom.window, dom.document, dom.localStorage, location, history, WebSocket, Game,
      { log() {}, info() {}, warn() {}, error() {} }, fetch, timer,
      ...names.map((n) => (n in given ? given[n] : anything)));
    return Object.assign(out, { dom, pick, gone, socks, loc: location,
      start: () => dom.document.fire('DOMContentLoaded') });
  }

  const two = JSON.stringify([
    { code: 'BBBB', token: 'tb', role: 'player', seatId: 'sb' },
    { code: 'AAAA', token: 'ta', role: 'player', seatId: 'sa' },
  ]);

  {   /* A copy of a game being watched again is not a table this browser is at:
         there is no seat to come back to and no game going on. The hello says
         so, and the browser drops it rather than offering it to be rejoined. */
    /* What the browser holds, read off the store rather than through a page:
       a page told it is on a copy keeps its own session in memory, and answers
       for that alone. What is being checked is what it left behind. */
    const kept = (X) => JSON.parse(X.dom.localStorage.getItem('rcs:tables:v1') || '[]')
      .map((t) => t.code).join(',');
    const onCopy = (code) => {
      const X = loadPage('join.js', { 'rcs:tables:v1': two });
      X.Net.connect({});                    // the socket, without the page on it
      X.socks[0].onopen();
      X.socks[0].onmessage({ data: JSON.stringify({
        t: 'hello', role: 'screen', code, token: null, replay: true }) });
      return X;
    };
    ok(kept(onCopy('ZZZZ')) === 'BBBB,AAAA',
       'a copy is not written down, and the tables this browser is at stay  got '
       + kept(onCopy('ZZZZ')));
    ok(kept(onCopy('AAAA')) === 'BBBB',
       'and one written down before the browser knew is dropped  got '
       + kept(onCopy('AAAA')));
  }

  {   // the front page lists every table this browser is at
    const P = loadPage('join.js', { 'rcs:tables:v1': two });
    P.pick('#rejoin-panel').hidden = true;
    P.start();
    ok(P.pick('#rejoin-panel').hidden === false, 'the front page offers the tables it holds');
    const rows = P.pick('#rejoin-list').children;
    ok(rows.length === 2, 'both of them, not just the last one  got ' + rows.length);
    ok(P.pick('#rejoin-title').textContent === 'Tables you are at', 'and says so');
    ok(rows[0].children[0].textContent === 'Table BBBB', 'newest first  got ' + rows[0].children[0].textContent);

    rows[1].children[2].fire('click');            // rejoin the older table
    ok(P.gone[0] === 'play.html?c=AAAA', 'and each one goes to its own table  got ' + P.gone[0]);

    rows[0].children[3].fire('click');            // forget the newer one
    ok(P.pick('#rejoin-list').children.length === 1, 'a table can be forgotten on its own');
    ok(P.Net.tables().length === 1 && P.Net.tables()[0].code === 'AAAA', 'and it is the one that goes');
  }

  {   // the name this phone plays under is asked for once, before anything else
    const who = { real: ['public/ui.js', 'public/settings.js'] };
    const P = loadPage('join.js', { 'rcs:name:v1': 'Chris' }, '', who);
    P.start();
    const pageOf = (X) => X.dom.document.body.querySelector('.settings');
    ok(P.pick('#who-name').textContent === 'Chris',
       'the front page says who this phone plays as  got ' + P.pick('#who-name').textContent);
    ok(pageOf(P).hidden, 'and asks nothing');
    P.pick('#btn-who').fire('click');
    ok(!pageOf(P).hidden && pageOf(P).querySelector('h1').textContent === 'Settings',
       'Change opens the settings page, where the name lives');

    const Q = loadPage('join.js', {}, '?code=ab2k', who);
    Q.start();
    ok(!pageOf(Q).hidden && pageOf(Q).querySelector('h1').textContent === 'Who are you?',
       'a phone that has not said who it is is asked first');
    const inp = pageOf(Q).querySelector('.settings-name');
    inp.value = 'Ann';
    inp.fire('input');
    pageOf(Q).querySelector('.settings-done').fire('click');
    ok(pageOf(Q).hidden && Q.Net.name() === 'Ann', 'the name is kept  got ' + Q.Net.name());
    ok(Q.pick('#who-name').textContent === 'Ann', 'and the front page says so');
    ok(Q.pick('#in-code').value === 'AB2K', 'with the code from the QR still there');
    Q.pick('#btn-join').fire('click');
    Q.socks[0].onopen();
    ok(JSON.stringify(Q.socks[0].sent[0]) === '{"t":"join","code":"AB2K","name":"Ann"}',
       'and a seat is taken under it  got ' + JSON.stringify(Q.socks[0].sent[0]));
  }

  {   // a table that is not there any more says so
    const P = loadPage('join.js',
      { 'rcs:tables:v1': JSON.stringify([{ code: 'AAAA', token: 'ta', role: 'player', seatId: 'sa' }]) },
      '?gone=AAAA');
    P.start();
    ok(/AAAA is over/.test(P.pick('#join-note').textContent),
       'a table that has ended says so, instead of a silent bounce  got '
       + JSON.stringify(P.pick('#join-note').textContent));
    ok(!P.Net.tables().some((t) => t.code === 'AAAA'), 'and it is not offered again');
  }

  {   /* The tables this phone is running, asked of the server. A seat this
         browser holds is offered above as Rejoin; what is left is watched. */
    const running = { tables: [
      { code: 'AAAA', phase: 'bid', round: 2, rounds: 16, seats: [{ id: 'sa', name: 'Ann' }, { id: 'sb', name: 'Otter' }] },
      { code: 'CCCC', phase: 'lobby', round: null, rounds: null, seats: [{ id: 'sc', name: 'Cal' }] },
    ] };
    const seedOne = { 'rcs:tables:v1': JSON.stringify([{ code: 'AAAA', token: 'ta', role: 'player', seatId: 'sa' }]),
                      'rcs:name:v1': 'Chris' };
    const asked = [], sent = [];
    const answer = (u, o) => { asked.push(u); sent.push((o || {}).method || 'GET');
      return Promise.resolve({ ok: true, json: () => Promise.resolve(running) }); };
    const P = loadPage('join.js', seedOne, '',
      { hostname: '127.0.0.1', fetch: answer, real: ['public/ui.js'] });
    P.pick('#server-panel').hidden = true;
    const box = P.dom.document.createElement('div');       // Start goes above Join, on this phone
    box.append(P.pick('#join-panel'), P.pick('#new-panel'));
    P.start();
    ok(asked[0] === '/tables.json', 'the phone that runs the server asks it what it is running  got ' + asked[0]);
    // the answer arrives in a microtask, and the list is built in the one after it
    Promise.resolve().then(() => Promise.resolve()).then(() => {
      ok(P.pick('#server-panel').hidden === false, 'and offers what it finds');
      const rows = P.pick('#server-list').children;
      ok(rows.length === 1, 'a table this browser holds a seat at is not repeated  got ' + rows.length);
      ok(rows[0].querySelector('.nm').textContent === 'Table CCCC', 'the other one is there');
      ok(rows[0].querySelector('.tmark').classList.contains('open'),
         'a table waiting for players is marked as waiting');
      running.tables[1].phase = 'bid';                      // and one in play turns
      const R = loadPage('join.js', { 'rcs:name:v1': 'Chris' }, '',
        { hostname: '127.0.0.1', fetch: answer, real: ['public/ui.js'] });
      const rbox = R.dom.document.createElement('div');
      rbox.append(R.pick('#join-panel'), R.pick('#new-panel'));
      R.start();
      Promise.resolve().then(() => Promise.resolve()).then(() => {
        const marks = R.pick('#server-list').querySelectorAll('.tmark');
        ok(marks.length === 2 && marks[0].classList.contains('play') && marks[1].classList.contains('play'),
           'a game in play is marked as turning  got ' + marks.map((m) => m.className).join(' | '));
      });
      const head = rows[0].querySelector('.trow-head');
      ok(!!head && head.children.length === 3
         && head.children[0].classList.contains('nm')
         && head.children[1].classList.contains('tmark')
         && head.children[2].classList.contains('badge'),
         'the first line is the table, its mark and its badge, in that order  got '
         + (head ? head.children.map((c) => c.className).join(' | ') : 'no line'));
      ok(rows[0].children.length === 3 && rows[0].children[1].classList.contains('trow-acts'),
         'the buttons are a line of their own, under it');
      const btns = rows[0].querySelectorAll('.btn').map((b) => b.textContent);
      ok(btns.join(' | ') === 'Take a seat | Watch',
         'a table in the lobby is sat down at, or watched  got ' + btns.join(' | '));
      const watch = rows[0].querySelectorAll('.btn').find((b) => b.textContent === 'Watch');
      watch.fire('click');
      ok(P.gone[P.gone.length - 1] === 'host.html?c=CCCC',
         'watching is the screen a TV would show  got ' + P.gone[P.gone.length - 1]);

      // and sitting down is the message the code box used to send
      rows[0].querySelectorAll('.btn').find((b) => b.textContent === 'Take a seat').fire('click');
      P.socks[P.socks.length - 1].onopen();
      ok(JSON.stringify(P.socks[P.socks.length - 1].sent[0]) === '{"t":"join","code":"CCCC","name":"Chris"}',
         'under the name this phone plays  got ' + JSON.stringify(P.socks[P.socks.length - 1].sent[0]));

      ok(P.pick('#join-panel').hidden === true,
         'and the phone that runs the server is not asked for a code at all');

      // the table is this phone's to take away: it runs it
      P.dom.window.confirm = () => true;               // the fake DOM has no <dialog>
      rows[0].querySelector('.x').fire('click');
      Promise.resolve().then(() => {
        const post = asked[asked.length - 1];
        ok(post === '/table/end?c=CCCC', 'the × ends the table on the server  got ' + post);
        ok(sent[sent.length - 1] === 'POST', 'asked for, never a link to wander into');
      });
    });

    {   /* A game already going has a seat only for the player it belongs to.
           The phone knows the name it plays under, so the row offers that seat
           back instead of asking for a code and a name again. */
      const started = { tables: [{ code: 'DDDD', phase: 'bid', round: 1, rounds: 16, seats: [
        { id: 'd0', name: 'Chris', bot: false, left: false, online: false },
        { id: 'd1', name: 'Otter', bot: true, left: false, online: true },
      ] }] };
      const S = loadPage('join.js', { 'rcs:name:v1': 'Chris' }, '',
        { hostname: '127.0.0.1', real: ['public/ui.js'],
          fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(started) }) });
      const sbox = S.dom.document.createElement('div');
      sbox.append(S.pick('#join-panel'), S.pick('#new-panel'));
      S.start();
      Promise.resolve().then(() => Promise.resolve()).then(() => {
        const b = S.pick('#server-list').querySelectorAll('.btn').map((x) => x.textContent);
        ok(b.join(' | ') === 'Take my seat | Watch',
           'the seat that is waiting for this phone is offered back  got ' + b.join(' | '));
        ok(S.pick('#server-list').querySelector('.tmark').classList.contains('play'),
           'and the table is marked as a game in play');
      });

      // once somebody is sitting in it, there is nothing to take
      const taken = JSON.parse(JSON.stringify(started));
      taken.tables[0].seats[0].online = true;
      const T = loadPage('join.js', { 'rcs:name:v1': 'Chris' }, '',
        { hostname: '127.0.0.1', real: ['public/ui.js'],
          fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(taken) }) });
      const tbox = T.dom.document.createElement('div');
      tbox.append(T.pick('#join-panel'), T.pick('#new-panel'));
      T.start();
      Promise.resolve().then(() => Promise.resolve()).then(() => {
        const b = T.pick('#server-list').querySelectorAll('.btn').map((x) => x.textContent);
        ok(b.join(' | ') === 'Watch', 'a seat somebody is sitting in is watched, not taken  got ' + b.join(' | '));
      });
    }

    {   /* A table of eight ran the names onto a second line and pushed
           everything under it down the page. What will not fit is counted. */
      const full = { tables: [{ code: 'EEEE', phase: 'bid', round: 1, rounds: 16,
        seats: ['Ann', 'Otter', 'Heron', 'Pike', 'Reed', 'Willow', 'Bream', 'Perch']
          .map((name, i) => ({ id: 'e' + i, name, bot: i > 0, left: false, online: true })) }] };
      const F = loadPage('join.js', { 'rcs:name:v1': 'Chris' }, '',
        { hostname: '127.0.0.1', real: ['public/ui.js'],
          fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(full) }) });
      // A line as wide as its text, and a row as wide as the phone: the fake
      // DOM measures nothing by itself, so this is what a browser would say.
      Object.defineProperty(F.dom.El.prototype, 'scrollWidth',
        { configurable: true, get() { return (this._text || '').length * 12; } });
      const fbox = F.dom.document.createElement('div');
      fbox.append(F.pick('#join-panel'), F.pick('#new-panel'));
      F.start();
      Promise.resolve().then(() => Promise.resolve()).then(() => {
        const line = F.pick('#server-list').querySelector('small').textContent;
        ok(/ and \d+ more$/.test(line), 'a list too long for the line is counted  got ' + line);
        ok(line.length * 12 <= 412, 'and what is left fits it  got ' + line);
        ok(line.indexOf('Ann, Otter') === 0, 'the names kept are the first of them  got ' + line);
        const said = Number((/ and (\d+) more$/.exec(line) || [])[1]);
        ok(said === 8 - line.split(' and ')[0].split(', ').length,
           'and the count is what was dropped  got ' + said);
      });
    }

    // a browser that is not the phone running the server asks nothing
    const none = [];
    const Q = loadPage('join.js', seedOne, '',
      { fetch: (u) => { none.push(u); return answer(u); } });
    Q.pick('#server-panel').hidden = true;
    Q.start();
    ok(none.length === 0, 'a player\'s phone does not ask: the listing is not its to read');
    ok(Q.pick('#server-panel').hidden === true, 'and is offered no such list');
    ok(Q.pick('#join-panel').hidden !== true, 'a code is how it finds a table, so it is still asked for one');
  }

  {   /* In the Android app the front page carries the way back to the app's
         own screen. The app marks its WebView; a browser has no such mark and
         no such button. */
    const app = { real: ['public/ui.js', 'public/settings.js'] };
    const APP_UA = 'Mozilla/5.0 (Linux; Android 15) UpTheRiverApp/1';
    /* The app marks its WebView; the hostname says whether the phone reading
       the page is the one serving it. The fake DOM has no <dialog>, so the
       question falls back to window.confirm, which is answered here. */
    const inApp = (ua, hostname) => {
      const X = loadPage('join.js', { 'rcs:name:v1': 'Chris' },
                         '', Object.assign({ hostname }, app));
      X.pick('#app-row').hidden = true;
      // on the phone that serves it, the page puts Start above Join: the two
      // need a parent between them for that
      const box = X.dom.document.createElement('div');
      box.append(X.pick('#join-panel'), X.pick('#new-panel'));
      X.dom.window.navigator = { userAgent: ua };
      X.dom.window.confirm = () => { X.asked = true; return true; };
      X.start();
      return X;
    };

    const P = inApp(APP_UA, '127.0.0.1');
    ok(P.pick('#app-row').hidden === false, 'the phone that hosts is offered the way to stop');
    P.pick('#btn-stop-host').fire('click');
    ok(P.asked === true, 'which asks first: every phone at the table is put off it');
    // the answer arrives in a microtask, so the check waits one behind it
    Promise.resolve().then(() => {
      ok(P.gone[P.gone.length - 1] === 'uptheriver://stop',
         'and then the app is asked to stop the table  got ' + P.gone[P.gone.length - 1]);
    });

    const R = inApp(APP_UA, '192.168.1.5');
    ok(R.pick('#app-row').hidden === true, "another phone's table is not this one's to stop");

    const Q = inApp('Mozilla/5.0 (iPhone) Safari/605', '127.0.0.1');
    ok(Q.pick('#app-row').hidden === true, 'and a browser is offered nothing of the sort');
  }

  {   // a browser at no table is offered nothing
    const P = loadPage('join.js', {});
    P.pick('#rejoin-panel').hidden = true;
    P.start();
    ok(P.pick('#rejoin-panel').hidden === true, 'a browser at no table is offered nothing');
  }

  {   // the host screen asks, instead of inventing a table
    const P = loadPage('host.js', {});
    P.pick('#pick-panel').hidden = true;
    P.start();
    ok(P.pick('#pick-panel').hidden === false, 'with no table of its own, the screen asks');
    ok(P.socks.length === 0, 'and makes nothing until it is told to');

    P.pick('#in-show').value = 'ab2k';
    P.pick('#btn-show').fire('click');
    ok(P.socks.length === 1, 'showing a table opens a socket');
    P.socks[0].onopen();
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"screen","code":"AB2K"}',
       'and asks to be shown that table, not to make one  got ' + JSON.stringify(P.socks[0].sent[0]));

    P.socks[0].onmessage({ data: JSON.stringify({ t: 'hello', role: 'screen', code: 'AB2K', token: null }) });
    ok(P.dom.document.body.classList.contains('showing'), 'the screen knows it is only showing');
    ok(P.pick('#btn-chat').hidden === true, 'and it has nothing to say at the table');
    ok(P.pick('#pick-panel').hidden === true, 'the question is over');
    ok(P.Net.session('AB2K') && P.Net.session('AB2K').role === 'screen',
       'and the table is remembered, so a reload comes back to it');
  }

  {   // a code that is not a table stays on the question
    const P = loadPage('host.js', {});
    P.start();
    P.pick('#in-show').value = 'ZZ';
    P.pick('#btn-show').fire('click');
    ok(P.socks.length === 0, 'half a code asks for nothing');
    ok(/4-character/.test(P.pick('#pick-err').textContent), 'and says what is wrong');
  }

  {   // a screen that has been here before goes straight back
    const P = loadPage('host.js',
      { 'rcs:tables:v1': JSON.stringify([{ code: 'AB2K', token: null, role: 'screen' }]) }, '?c=AB2K');
    P.pick('#pick-panel').hidden = false;
    P.start();
    ok(P.socks.length === 1, 'a screen that has been here before does not ask again');
    P.socks[0].onopen();
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"screen","code":"AB2K"}',
       'it asks for the table it was showing  got ' + JSON.stringify(P.socks[0].sent[0]));
  }

  {   // a screen makes no new table when the one it held has gone
    const P = loadPage('host.js',
      { 'rcs:tables:v1': JSON.stringify([{ code: 'AB2K', token: null, role: 'screen' }]) }, '?c=AB2K');
    P.start();
    P.socks[0].onopen();
    P.socks[0].onmessage({ data: JSON.stringify({ t: 'hello', role: 'screen', code: 'AB2K', token: null }) });
    P.socks[0].sent.length = 0;
    P.socks[0].onmessage({ data: JSON.stringify({ t: 'error', msg: 'that table is gone' }) });
    ok(!P.socks[0].sent.some((m) => m.t === 'create'), 'a screen whose table has gone invents nothing');
    ok(P.gone[0] === 'host.html', 'it asks again  got ' + P.gone[0]);
    ok(P.Net.tables().length === 0, 'and the table it was showing is forgotten');
  }

  {   // a host screen puts up a fresh table when its own has gone -- on a wall
    const seed = { 'rcs:tables:v1': JSON.stringify([{ code: 'AB2K', token: 'th', role: 'host' }]) };
    const P = loadPage('host.js', seed, '?c=AB2K');
    P.start();
    P.socks[0].onopen();
    P.socks[0].onmessage({ data: JSON.stringify({ t: 'hello', role: 'host', code: 'AB2K', token: 'th' }) });
    P.socks[0].sent.length = 0;
    P.socks[0].onmessage({ data: JSON.stringify({ t: 'error', msg: 'that table is gone' }) });
    ok(P.socks[0].sent.some((m) => m.t === 'create'),
       'a host screen on a wall makes a fresh table when its own has gone');

    // -- but not in a pane: the parent heard the same line and is already
    // moving on, so a table made here would be a second one.
    const F = loadPage('host.js', seed, '?c=AB2K');
    F.dom.window.top = {};                     // inside a frame now
    F.start();
    F.socks[0].onopen();
    F.socks[0].onmessage({ data: JSON.stringify({ t: 'hello', role: 'host', code: 'AB2K', token: 'th' }) });
    F.socks[0].sent.length = 0;
    F.socks[0].onmessage({ data: JSON.stringify({ t: 'error', msg: 'that table is gone' }) });
    ok(!F.socks[0].sent.some((m) => m.t === 'create'),
       'the same screen in a pane of the dev page invents nothing');
  }

  /* ---- the dev page, and what each server lets it do ----

     The page is opened on a table the way the TV screen's ⚙ opens it, and
     then told what kind of server it reached. What must not happen is a
     control that draws itself and answers a refusal: on a normal server the
     page shows the two things that put a game right and nothing that invents
     data. */
    /* ---- stopping a table that plays its own hands ----
     The widget both the host screen and the dev page put a button on. It is
     offered only where the table has a hand of its own to play, and only to a
     screen that runs the table. */
  /* ---- the table has hung, and is moved on by hand ----
     Both beats a hand is built around are ended by a timer, and a timer belongs
     to the server that armed it. A table whose server was stopped over the
     moment sits there with every phone waiting on it. */
  part('a table that has hung');
  {
    const R = load(900, 800);
    const mk = (tag) => R.dom.document.createElement(tag);
    const sent = [];
    const boss = { me: -1, boss: true, send: (m) => sent.push(m) };
    const held = (over) => Object.assign({
      phase: 'tricks', idx: 0, cfg: { deck: 'virtual' },
      seats: [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Ben' }],
      rounds: [{ cards: 3, dealer: 0, bids: [1, 1], tricks: null }],
      play: { turn: null, held: true, trick: [], won: [0, 0], last: null, counts: [3, 3] },
    }, over || {});

    const row = mk('span');
    /* The widget keeps one clock, and this is where it is caught: a hung table
       sends nothing, so the moment the beat outstays itself cannot arrive on a
       state and has to be waited for. */
    const armed = [];
    const realSet = global.setTimeout;
    global.setTimeout = (f, ms) => { armed.push({ f, ms }); return realSet(() => {}, 0); };
    try { R.Round.unstick(row, held(), boss); } finally { global.setTimeout = realSet; }
    ok(row.hidden === true, 'bids standing to be read are not a table that has hung');
    ok(armed.length === 1, 'but the widget waits to see  got ' + armed.length);
    ok(armed[0].ms > 1000, 'a beat and then some  got ' + armed[0].ms);

    // The wait is out, and the beat is still standing.
    const back = Date.now;
    Date.now = () => back() + 9000;
    try { armed[0].f(); } finally { Date.now = back; }
    ok(row.hidden === false, 'one still standing a beat later is');
    ok(row.querySelector('.btn').textContent === 'Start the hand',
       'and says which beat  got ' + row.querySelector('.btn').textContent);
    row.querySelector('.btn').fire('click');
    ok(JSON.stringify(sent[0]) === '{"t":"unstick"}',
       'moved on with the move it was going to make  got ' + JSON.stringify(sent[0]));

    // A trick sitting on the table is the other beat.
    const trick = held({ play: { turn: null, held: false, trick: [], won: [1, 0],
                                 last: { trick: [], winner: 0 }, counts: [2, 2] } });
    row._stuckAt = 0;
    Date.now = () => back() + 20000;
    try { R.Round.unstick(row, trick, boss); Date.now = () => back() + 40000;
          R.Round.unstick(row, trick, boss); } finally { Date.now = back; }
    ok(row.hidden === false && row.querySelector('.btn').textContent === 'Take the trick in',
       'a trick held up too long is the other one  got ' + row.querySelector('.btn').textContent);

    // With real cards a counted trick always looks like that, and is not it.
    const real = held({ cfg: { deck: 'physical' },
      play: { turn: null, held: false, trick: [], won: [1, 0],
              last: { trick: [], winner: 0 }, counts: [2, 2], log: [0] } });
    row._stuckAt = 0;
    R.Round.unstick(row, real, boss);
    ok(row.hidden === true, 'a table with real cards counts like that all round: only its bids can hang');

    // And the table moving on takes the offer away with it.
    row._stuckAt = 0;
    R.Round.unstick(row, held({ play: { turn: 1, held: false, trick: [], won: [0, 0],
                                        last: null, counts: [3, 3] } }), boss);
    ok(row.hidden === true, 'a table that is moving has nothing to be moved on');
    ok(!row._timer, 'and no clock left running on it');

    R.Round.unstick(row, held(), { me: 1, boss: false, send: () => {} });
    ok(row.hidden === true, 'a screen that runs nothing is offered none of it');
  }

  /* ---- who is at the table, on the standings ----
     Once the lobby is gone the standings are the only list of everybody a game
     has, so that is where the seat controls live: where the seat is, and what
     whoever runs the table may do about it. */
  part('who is at the table, on the standings');
  {
    const R = load(900, 800);
    const sent = [];
    /* Handing a seat over is asked about first. The real dialog wants a browser
       to open it in, so the answer here is yes, at once, the way it is
       everywhere else in this file. */
    const asked = [];
    R.UI.ask = (t, b, l) => { asked.push({ t, b, l }); return { then: (f) => f(true) }; };
    const boss = { me: -1, boss: true, send: (m) => sent.push(m) };
    const seat = (id, name, over) => Object.assign({ id, name, online: true, quiet: 0 }, over || {});
    const ST = (over) => Object.assign({
      code: 'TEST', phase: 'bid', idx: 0,
      cfg: { deck: 'virtual', trump: false },
      captainId: 'a',
      seats: [seat('a', 'Ann'), seat('b', 'Ben'), seat('c', 'Cal')],
      rounds: [{ cards: 3, dealer: 0, bids: [null, null, null], tricks: null }],
      totals: [10, 5, 0],
    }, over || {});
    const box = R.dom.document.createElement('div');
    const rowFor = (nm) => Array.prototype.slice.call(box.children)
      .find((r) => r.querySelector('.name').textContent.indexOf(nm) === 0);
    const marks = (nm) => rowFor(nm).querySelectorAll('.badge').map((b) => b.textContent);
    const label = (b) => b.querySelector('.menu-label').textContent;
    const openMenu = (nm) => {
      const row = rowFor(nm);
      row.querySelector('.more').fire('click');
      return row.querySelector('.seatmenu').querySelectorAll('.menu-tap');
    };

    R.Table.standings(box, ST(), { view: boss });
    ok(box.children.length === 3, 'a row a player  got ' + box.children.length);
    ok(marks('Ann').indexOf('host') >= 0, 'the seat that runs the table says so  got ' + marks('Ann').join('|'));
    ok(marks('Ben').length === 0, 'a seat with nothing to say says nothing  got ' + marks('Ben').join('|'));

    // A phone that has gone, and how long for: the clock is the room's.
    const away = ST();
    away.seats[1].online = false;
    away.seats[1].quiet = 4 * 60000 + 3000;
    R.Table.standings(box, away, { view: boss, quietAt: Date.now() });
    ok(marks('Ben').indexOf('away 4m') >= 0,
       'a seat nobody is behind says how long for  got ' + marks('Ben').join('|'));

    // And one the table was given.
    const given = ST();
    given.seats[1].left = true;
    given.seats[1].online = false;
    R.Table.standings(box, given, { view: boss });
    ok(marks('Ben').indexOf('auto-play') >= 0,
       'a seat the table is playing says so instead  got ' + marks('Ben').join('|'));

    // What may be done about each of them.
    sent.length = 0;
    let rows = openMenu('Ben').map(label);
    ok(rows.indexOf('Let back in') >= 0, 'a seat the table was given can be given back  got ' + rows.join(' | '));
    ok(rows.indexOf('Make table host') < 0,
       'and is never handed the table itself: somebody has to be able to move the game on');
    openMenu('Ben').find((b) => label(b) === 'Let back in').fire('click');
    ok(JSON.stringify(sent[0]) === '{"t":"letback","id":"b"}',
       'and one tap opens it  got ' + JSON.stringify(sent[0]));

    // A phone that has gone home, on a table that deals the cards.
    R.Table.standings(box, away, { view: boss });
    rows = openMenu('Ben').map(label);
    ok(rows.indexOf('Auto-play their hand') >= 0,
       'a seat nobody is behind can be handed over  got ' + rows.join(' | '));
    sent.length = 0; asked.length = 0;
    openMenu('Ben').find((b) => label(b) === 'Auto-play their hand').fire('click');
    ok(asked.length === 1 && /^Auto-play Ben/.test(asked[0].t),
       'and is asked about first, by name  got ' + JSON.stringify(asked[0]));
    ok(JSON.stringify(sent[0]) === '{"t":"playout","id":"b"}',
       'then handed over by name, not by whose turn it is  got ' + JSON.stringify(sent[0]));

    /* A player put out of the game, whether they are at the table or not: one
       who has to stop and cannot press it themselves, or one the table wants
       rid of. Auto-play only ever reaches a phone that has already gone
       quiet -- the table refuses it for a seat somebody is sitting at -- so
       there was nothing the host could do about a player who was there. */
    R.Table.standings(box, ST(), { view: boss });
    rows = openMenu('Ben').map(label);
    ok(rows.indexOf('Remove from the game') >= 0,
       'a player at the table can be put out of it  got ' + rows.join(' | '));
    ok(rows.indexOf('Auto-play their hand') < 0,
       'which is the only thing there is for a seat somebody is behind');
    sent.length = 0; asked.length = 0;
    openMenu('Ben').find((b) => label(b) === 'Remove from the game').fire('click');
    ok(asked.length === 1 && /^Remove Ben from the game\?$/.test(asked[0].t),
       'asked about first, by name  got ' + JSON.stringify(asked[0]));
    ok(/let them back in/.test(asked[0].b || ''),
       'and told the way back, which is the host\'s  got ' + (asked[0].b || ''));
    ok(JSON.stringify(sent[0]) === '{"t":"remove","id":"b"}',
       'then put out by name  got ' + JSON.stringify(sent[0]));

    // A seat the table already has, and a bot, are not put out of anything.
    R.Table.standings(box, given, { view: boss });
    ok(openMenu('Ben').map(label).indexOf('Remove from the game') < 0,
       'a seat the table already holds is already out');
    const overNow = ST({ phase: 'done' });
    R.Table.standings(box, overNow, { view: boss });
    ok(openMenu('Ben').map(label).indexOf('Remove from the game') < 0,
       'and a game that is over has nobody left to put out of it');

    // With real cards the table holds no hand of anybody's.
    const real = ST({ cfg: { deck: 'physical', trump: false } });
    real.seats[1].online = false;
    R.Table.standings(box, real, { view: boss });
    rows = openMenu('Ben').map(label);
    ok(rows.indexOf('Auto-play their hand') < 0,
       'a table with real cards has no hand of theirs to take  got ' + rows.join(' | '));
    ok(rows.indexOf('They dealt this hand') >= 0,
       'but it has a deal that can have gone to the wrong person  got ' + rows.join(' | '));
    sent.length = 0;
    openMenu('Ben').find((b) => label(b) === 'They dealt this hand').fire('click');
    ok(JSON.stringify(sent[0]) === '{"t":"dealer","id":"b"}',
       'and the seat that really dealt can be said  got ' + JSON.stringify(sent[0]));

    // Once a bid is in, the order of bidding is the dealer's and stands.
    const bidding = ST({ cfg: { deck: 'physical', trump: false } });
    bidding.rounds[0].bids = [null, 1, null];
    R.Table.standings(box, bidding, { view: boss });
    ok(openMenu('Ben').map(label).indexOf('They dealt this hand') < 0,
       'a hand already being bid keeps its dealer');

    // The table passed on, and a name put right.
    R.Table.standings(box, ST(), { view: boss });
    sent.length = 0;
    openMenu('Ben').find((b) => label(b) === 'Make table host').fire('click');
    ok(JSON.stringify(sent[0]) === '{"t":"captain","id":"b"}',
       'the table is passed on by name  got ' + JSON.stringify(sent[0]));
    /* Not the name. That is the column on the scorecard, and the head of that
       column is where it is changed: one place, where the thing being renamed
       is the thing being looked at. */
    ok(openMenu('Ben').map(label).indexOf('Rename') < 0,
       'and never the name: the head of its own column is where that is changed');

    // A screen that runs nothing draws none of it.
    R.Table.standings(box, ST(), { view: { me: 1, boss: false, send: () => {} } });
    ok(!rowFor('Ben').querySelector('.more'), 'a screen that runs nothing offers no ⋯');
    ok(marks('Ann').indexOf('host') >= 0, 'but it still says who runs the table');
    R.Table.standings(box, ST(), {});
    ok(!rowFor('Ben').querySelector('.more'), 'and neither does one that was handed no view at all');
  }

  /* ---- the scorecard, put right ----
     A round already scored is the one thing the buttons cannot reach: the game
     has moved past it. So the number is retyped where it is read. */
  part('the scorecard, put right');
  {
    const R = load(900, 800);
    const sent = [];
    const boss = { me: -1, boss: true, send: (m) => sent.push(m) };
    const ST = {
      code: 'TEST', phase: 'bid', idx: 1,
      cfg: { deck: 'physical', trump: false, bonus: 10, miss: 'atleast' },
      seats: [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Ben' }, { id: 'c', name: 'Cal' }],
      rounds: [{ cards: 2, dealer: 0, bids: [1, 1, 0], tricks: [1, 1, 0] },
               { cards: 1, dealer: 1, bids: [null, null, null], tricks: null }],
      totals: [11, 11, 0],
    };
    const plain = R.Table.scorecardHTML(ST, -1);
    ok(plain.indexOf('roundedit') < 0 && plain.indexOf('celledit') < 0
       && plain.indexOf('nameedit') < 0,
       'a screen that runs nothing gets the card it always had');
    const card = R.Table.scorecardHTML(ST, -1, true);
    ok(/class="roundedit" data-round="0"/.test(card),
       'a scored round is a way into itself for whoever runs the table');
    ok((card.match(/roundedit/g) || []).length === 1,
       'and only a scored one: the round in play is played, not retyped');
    // Every figure on it is its own way in, and so is every name.
    ok(/class="celledit" data-round="0" data-seat="1"/.test(card),
       'so is each figure in it, by seat');
    ok((card.match(/celledit/g) || []).length === 3,
       'one a seat, and only in the round that has one  got ' + (card.match(/celledit/g) || []).length);
    ok(/class="nameedit" data-seat="2"/.test(card), 'and the name at the head of each column');
    ok((card.match(/nameedit/g) || []).length === 3,
       'one a seat  got ' + (card.match(/nameedit/g) || []).length);
    const withBot = JSON.parse(JSON.stringify(ST));
    withBot.seats[2].bot = true;
    ok((R.Table.scorecardHTML(withBot, -1, true).match(/nameedit/g) || []).length === 2,
       'never a bot\'s: that name is the table\'s own, not a person\'s');

    const box = R.dom.document.createElement('div');
    R.Table.editRound(box, ST, 0, boss);
    const d = R.dom.document.getElementById('round-edit');
    ok(!!d, 'tapping it opens the round to be retyped');
    ok(d.querySelector('h2').textContent === 'Round 1 · 2 cards',
       'named, so nobody retypes the wrong one  got ' + d.querySelector('h2').textContent);
    ok(box._editing === true, 'and the card holds still while it is open');
    const rows = d.querySelectorAll('.edit-row');
    ok(rows.length === 4, 'a row a seat, under a heading  got ' + rows.length);
    const boxes = d.querySelectorAll('input');
    ok(boxes.length === 6, 'a bid and a won for each  got ' + boxes.length);
    ok(boxes.map((x) => x.value).join(',') === '1,1,1,1,0,0',
       'filled with what the round says  got ' + boxes.map((x) => x.value).join(','));
    const tally = d.querySelector('.edit-tally');
    ok(tally.textContent === 'Tricks total 2 of 2', 'with the check under them  got ' + tally.textContent);
    const save = d.querySelectorAll('.btn').find((b) => b.textContent === 'Save');
    ok(save.disabled === false, 'and a row that adds up can be saved');

    // A row that does not add up cannot be sent: the table would refuse it.
    boxes[3].value = '0';                        // Ben won 0 as well
    boxes[3].fire('input');
    ok(tally.textContent === 'Tricks total 1 of 2', 'a column that does not add up says so  got ' + tally.textContent);
    ok(save.disabled === true, 'and cannot be saved');
    boxes[5].value = '1';                        // the trick lands on Cal instead
    boxes[5].fire('input');
    ok(tally.textContent === 'Tricks total 2 of 2', 'the trick has to land somewhere  got ' + tally.textContent);
    ok(save.disabled === false, 'and once it has, it can');

    sent.length = 0;
    save.fire('click');
    ok(JSON.stringify(sent[0]) === '{"t":"score","round":0,"bids":[1,1,0],"tricks":[1,0,1]}',
       'the whole row goes at once, because the check is a row\'s  got ' + JSON.stringify(sent[0]));
    ok(box._editing === false, 'and the card is let go again');

    // Cancel changes nothing.
    R.Table.editRound(box, ST, 0, boss);
    sent.length = 0;
    d.querySelectorAll('.btn').find((b) => b.textContent === 'Cancel').fire('click');
    ok(sent.length === 0, 'Cancel says nothing to the table');
    ok(box._editing === false, 'and lets the card go');

    // A round that has not been scored has no record to correct.
    R.Table.editRound(box, ST, 1, boss);
    ok(box._editing === false, 'a round still being played does not open at all');

    /* Tapped on one figure rather than on the round, the same sheet opens --
       the check is a row's, and a trick taken off one seat has to land on
       another -- but it opens on the seat that was tapped. */
    R.Table.editRound(box, ST, 0, boss, 2);
    const asked = d.querySelectorAll('.edit-row').filter((x) => x.classList.contains('asked'));
    ok(asked.length === 1, 'the seat that was tapped is marked, and only that one');
    ok(asked[0].querySelector('.nm').textContent === 'Cal',
       'and it is the seat whose figure it was  got ' + asked[0].querySelector('.nm').textContent);
    ok(d.querySelectorAll('.edit-row').length === 4,
       'the whole round is still there to be balanced against');
    d.querySelectorAll('.btn').find((b) => b.textContent === 'Cancel').fire('click');

    /* And the tap itself. The card is a table of HTML the fake DOM does not
       parse, so what is proved here is the one listener that reads it: the card
       is rebuilt whenever a figure on it changes, so the listener is the
       table's and not each button's. */
    const mk = (cls, data) => {
      const b = R.dom.document.createElement('button');
      b.className = cls;
      Object.keys(data).forEach((k) => { b.dataset[k] = data[k]; });
      return b;
    };
    const sc = R.dom.document.createElement('div');
    R.dom.document.querySelector = (q) => (q === '#card' ? sc : null);
    R.Table.scorecard('#card', ST, -1, boss);
    const tapped = (cls, data) => {
      const b = mk(cls, data);
      sc.appendChild(b);
      sc.fire('click', { target: b });
      b.remove();
    };
    tapped('celledit', { round: '0', seat: '1' });
    const asked2 = R.dom.document.getElementById('round-edit')
      .querySelectorAll('.edit-row').filter((x) => x.classList.contains('asked'));
    ok(asked2.length === 1 && asked2[0].querySelector('.nm').textContent === 'Ben',
       'a tap on one figure opens its own round, on its own seat');
    R.dom.document.getElementById('round-edit')
      .querySelectorAll('.btn').find((b) => b.textContent === 'Cancel').fire('click');

    tapped('nameedit', { seat: '2' });
    const sheet = R.dom.document.getElementById('seat-name');
    ok(sheet.querySelector('h2').textContent === 'Rename Cal',
       'and a tap on a name opens that name  got ' + sheet.querySelector('h2').textContent);
    sent.length = 0;
    sheet.querySelector('.namebox').value = 'Callum';
    sheet.querySelectorAll('.btn').find((b) => b.textContent === 'Save').fire('click');
    ok(JSON.stringify(sent[0]) === '{"t":"renameseat","id":"c","name":"Callum"}',
       'which the table hears as the seat\'s  got ' + JSON.stringify(sent[0]));

    // A screen that runs nothing has no listener to reach.
    sent.length = 0;
    sc._view = { me: -1, boss: false, send: (m) => sent.push(m) };
    tapped('nameedit', { seat: '2' });
    ok(sent.length === 0, 'and none of it answers a screen that runs nothing');
  }

  part('stopping a table that plays itself');
  {
    const R = load(1200, 800);
    const mk = (tag) => R.dom.document.createElement(tag);
    const sent = [];
    const boss = { me: -1, boss: true, send: (m) => sent.push(m) };
    const shows = { me: -1, boss: false, send: (m) => sent.push(m) };
    const withBot = [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Otter', bot: true }];
    const ST = (over) => Object.assign({
      phase: 'bid', idx: 0, paused: false, cfg: { deck: 'virtual' }, seats: withBot,
      rounds: [{ cards: 3, dealer: 0, bids: [null, null], tricks: null }],
    }, over || {});

    const btn = mk('button');
    R.Round.pause(btn, ST(), boss);
    ok(btn.hidden === false, 'a screen running a table with a bot in it may stop it');
    ok(btn.textContent === '❚❚ Pause', 'and is offered the stop  got ' + btn.textContent);
    btn.fire('click');
    ok(JSON.stringify(sent[0]) === '{"t":"pause","on":true}',
       'which says so outright  got ' + JSON.stringify(sent[0]));

    R.Round.pause(btn, ST({ paused: true }), boss);
    ok(btn.textContent === '▶ Play', 'a stopped table is offered the way on');
    ok(btn.getAttribute('aria-pressed') === 'true', 'and says which it is');
    btn.fire('click');
    ok(JSON.stringify(sent[1]) === '{"t":"pause","on":false}',
       'and the same button lets it go  got ' + JSON.stringify(sent[1]));

    R.Round.pause(btn, ST(), shows);
    ok(btn.hidden === true, 'a screen that only shows a table cannot stop it');
    /* A stopped table is stopped for everybody, so a table of people is a
       table to stop: it is the one most likely to want a moment. */
    R.Round.pause(btn, ST({ seats: [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bob' }] }), boss);
    ok(btn.hidden === false, 'a table of people is offered it too');
    R.Round.pause(btn, ST({ cfg: { deck: 'physical' },
                            seats: [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bob' }] }), boss);
    ok(btn.hidden === false, 'and so is one playing with real cards');
    R.Round.pause(btn, ST({ phase: 'lobby' }), boss);
    ok(btn.hidden === true, 'nor is there one before the cards go out');

    // And every screen is told, on the round line it already has.
    const bar = mk('div');
    const mark = mk('div'); mark.id = 'round-paused'; bar.appendChild(mark);
    R.Round.header(bar, ST(), boss);
    ok(mark.hidden === true, 'a table that is running says nothing');
    R.Round.header(bar, ST({ paused: true }), boss);
    ok(mark.hidden === false,
       'a stopped one is marked, so nobody takes a stopped table for a hung one');
    R.Round.header(bar, ST({ paused: true, rounds: [] }), boss);
    ok(mark.hidden === false, 'and it is marked before the round line has anything to say');
  }

part('past games, and the ones the table can still put back');
{
  const one = (id, code) => ({ id, code, at: 1787000000000,
                               seats: [{ name: 'Ann' }, { name: 'Bob' }],
                               rounds: [{ cards: 2, dealer: 0, bids: [1, 0], tricks: [2, 0] }],
                               cfg: { max: 2, pattern: 'down', ones: 1 },
                               totals: [12, 3], bonus: [0, 0], winners: [0], mine: 0 });
  const held = JSON.stringify([one('a1b2c3d4e5f6', 'BBBB'), one('f6e5d4c3b2a1', 'QRST')]);

  /* The phone keeps its own copy of every game it sat at; the table keeps a
     trail beside the ones it still holds, and by a shorter memory. So the
     offer is made only where the table says it can be met. */
  const page = (answer) => {
    const P = loadPage('history.js', { 'river-card-score:games:v1': held }, '',
                       /* table.js is real here -- the card's ⋯ is its row menu --
                          and so is ui.js, because letting a game go is asked
                          about first and UI.ask is what asks. */
                       { real: ['public/ui.js', 'public/games.js', 'public/table.js'],
                         fetch: answer });
    P.start();
    return P;
  };
  const watchers = (P) => P.pick('#deck').querySelectorAll('.watch-again');

  {   /* What a phone will keep. Every screen files the game it is shown the
         moment the table says `done`, so a phase forced to `done` over an
         empty card put a nought-round game in Past games on every phone in the
         room -- and on the table too. A game reached by playing it always has
         a scored round behind it. */
    const P = page(() => Promise.resolve({ json: () => Promise.resolve({ games: [] }) }));
    const G2 = P.dom.window.Games || null;
    const Games = G2 || (new Function('Game', 'localStorage',
      fs.readFileSync(path.join(ROOT, 'public/games.js'), 'utf8') + '\n; return Games;')
      (Game, P.dom.localStorage));
    const over = (o) => Object.assign({
      phase: 'done', gameId: 'aaaabbbbcccc', code: 'G4JQ', cfg: {},
      seats: [{ id: 's0', name: 'Ann' }, { id: 's1', name: 'Ben' }],
      rounds: [{ cards: 2, bids: [1, 0], tricks: [1, 1] }], totals: [11, 1],
    }, o || {});
    ok(!!Games.record(over(), 0), 'a game that was played is one to keep');
    ok(Games.record(over({ seats: [], rounds: [], totals: [] }), -1) === null,
       'a table that never dealt is not');
    ok(Games.record(over({ rounds: [{ cards: 2, bids: null, tricks: null }] }), 0) === null,
       'nor is a card that was dealt and never scored');
    ok(Games.keep(over({ seats: [], rounds: [], totals: [] }), -1) === false,
       'so nothing of it is kept');
  }

  {   /* Letting one go. Each phone keeps its own copy and the table keeps its
         own, so this is this phone's and says so: the table's is still there
         to be taken back with the code. It is asked about first, because
         nothing here can be undone from the page. */
    const P = page(() => Promise.resolve({ json: () => Promise.resolve({ games: [] }) }));
    const cards = () => P.pick('#deck').querySelectorAll('.gamecard');
    ok(cards().length === 2, 'two games on the phone to begin with');
    const more = cards()[0].querySelector('.mini.more');
    ok(!!more, 'each carries the ⋯ of what may be done with it');
    more.fire('click');
    // The name is a span inside the row, as every menu row is built.
    const named = (card) => card.querySelector('.seatmenu').querySelectorAll('.menu-row')
      .find((b) => /Delete/.test(b.querySelector('.menu-label').textContent));
    const item = named(cards()[0]);
    ok(!!item && item.classList.contains('danger'),
       'with Delete in it, marked as the one that cannot be taken back');

    let asked = null;
    P.dom.window.confirm = () => { asked = true; return false; };
    item.fire('click');
    ok(asked === true && cards().length === 2,
       'which asks first, and keeps the game when the answer is no');

    P.dom.window.confirm = () => true;
    cards()[0].querySelector('.mini.more').fire('click');
    named(cards()[0]).fire('click');
    Promise.resolve().then(() => Promise.resolve()).then(() => {
      ok(cards().length === 1, 'and lets it go when the answer is yes  got ' + cards().length);
      ok(cards()[0].dataset.game === 'f6e5d4c3b2a1',
         'the other one is the one left  got ' + cards()[0].dataset.game);
      ok(JSON.parse(P.dom.localStorage.getItem('river-card-score:games:v1')).length === 1,
         'and it is gone from the phone, not just off the screen');
      ok(P.pick('#nav').hidden === true, 'with nothing to swipe between any more');
    });
  }

  {
    const asked = [];
    const P = page((u) => {
      asked.push(u);
      return Promise.resolve({ json: () => Promise.resolve({ games: [
        { id: 'a1b2c3d4e5f6', trail: true }, { id: 'f6e5d4c3b2a1', trail: false }] }) });
    });
    ok(asked[0] === '/games.json',
       'the page asks the table what it can still put back  got ' + asked[0]);
    ok(P.pick('#deck').querySelectorAll('.gamecard').length === 2,
       'both games this phone kept are on the page  got '
       + P.pick('#deck').querySelectorAll('.gamecard').length);
    ok(watchers(P).length === 0, 'and nothing is offered before the table answers');

    // the answer arrives in a microtask, and the buttons go on in the one after
    Promise.resolve().then(() => Promise.resolve()).then(() => {
      const go = watchers(P);
      ok(go.length === 1, 'the one with a trail beside it is offered  got ' + go.length);
      ok(go[0].href === 'replay.html?g=a1b2c3d4e5f6',
         'and the button goes to the replay of that game  got ' + go[0].href);
      ok(go[0].parentNode.classList.contains('game-acts'),
         'in the row of what can be done with it, under the line saying which game it is');
      ok(go[0].parentNode.parentNode.classList.contains('game-head'),
         'which is under the headline itself');
      // The ⋯ stays at the end of the row whichever way round they are built.
      const row = go[0].parentNode;
      ok(row.children.indexOf(go[0]) === 0 && row.querySelector('.mini.more') === row.children[1],
         'with Replay first and the ⋯ after it');
    });
  }
}

part('watching one game again, on a page of its own');
{
  const REAL = ['public/ui.js', 'public/viewer.js'];
  const say = (over) => JSON.stringify(Object.assign({
    t: 'replay', code: 'ZZZZ', of: 'BBBB', at: 0, n: 6, playing: false, rate: 1,
    marks: [{ at: 1, i: 0, cards: 2, w: 'game' }, { at: 5, i: null, w: 'end' }],
    kinds: 'GRbbeE',
    says: ['the game starts', 'the round is dealt', 'Ann bids 1', 'Bob bids 0',
           'the round is scored', 'the game ends'],
    faces: ['', '', '1', '0', '', ''],
    seats: [{ id: 's1', name: 'Ann', watch: 'rw1' }, { id: 's2', name: 'Bob', watch: 'rw2' }],
    where: 'Round 1 of 1 · 2 cards · Ann bids 1',
  }, over || {}));

  {   // the whole address is the game: no table, and no key
    const P = loadPage('replay.js', {}, '?g=a1b2c3d4e5f6', { real: REAL });
    P.start();
    P.socks[0].onopen();
    ok(JSON.stringify(P.socks[0].sent[0])
       === '{"t":"replay","do":"open","game":"a1b2c3d4e5f6"}',
       'the page opens the game its address names  got '
       + JSON.stringify(P.socks[0].sent[0]));
    ok(P.pick('#band').hidden === true, 'and shows nothing until there is a copy');

    P.socks[0].onmessage({ data: say() });
    ok(P.pick('#band').hidden === false, 'a copy opened brings the way about it up');
    ok(P.pick('#screen').src === 'host.html?c=ZZZZ',
       'and the table is shown on the screen a table is shown on  got ' + P.pick('#screen').src);
    ok(P.pick('#subtitle').textContent === 'table BBBB · point 1 of 6',
       'the head says which game, and where in it  got ' + P.pick('#subtitle').textContent);

    // Every part of it is the viewer's; this page only says where each goes.
    ok(P.pick('#rounds').querySelectorAll('.scell').length === 2,
       'the rounds are drawn  got ' + P.pick('#rounds').querySelectorAll('.scell').length);
    ok(!!P.pick('#transport').querySelector('.vw-play'), 'the transport too');
    ok(P.pick('#points').querySelectorAll('.tick').length === 5,
       'and the points of the round on show  got '
       + P.pick('#points').querySelectorAll('.tick').length);
    ok(P.pick('#points').querySelector('.viewer-where').textContent
       === 'Round 1 of 1 · 2 cards · Ann bids 1', 'with the line under it');

    P.socks[0].sent.length = 0;
    P.pick('#transport').querySelector('.vw-fwd').fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"replay","do":"step","by":1}',
       'and it asks the copy for things itself  got ' + JSON.stringify(P.socks[0].sent[0]));

    /* Whose screen it is watched from. A seat is opened by its watching key,
       which shows that screen without putting anybody at the table -- and this
       asks the copy for nothing: it is the same moment, looked at from
       somewhere else. */
    const from = () => P.pick('#seen').querySelectorAll('.btn');
    ok(from().length === 3, 'the table, and a seat each  got ' + from().length);
    ok(from()[0].classList.contains('on'), 'the table to start with');
    P.socks[0].sent.length = 0;
    from()[1].fire('click');
    ok(P.pick('#screen').src === 'play.html?seat=s1#c=ZZZZ&w=rw1',
       'a seat puts that seat\'s screen up  got ' + P.pick('#screen').src);
    ok(from()[1].classList.contains('on') && !from()[0].classList.contains('on'),
       'and the row says which it is on');
    ok(P.socks[0].sent.length === 0, 'with nothing asked of the copy');

    /* One seat to the next differs before the # as well as after it. A frame
       handed an address that differs from its own only after the # follows the
       fragment instead of loading the page again, and the screen would go on
       showing the seat before it. */
    from()[2].fire('click');
    const two = P.pick('#screen').src;
    ok(two === 'play.html?seat=s2#c=ZZZZ&w=rw2',
       'and the next seat puts theirs up  got ' + two);
    ok(two.split('#')[0] !== 'play.html?seat=s1',
       'by an address that differs before the # as well as after it');

    from()[0].fire('click');
    ok(P.pick('#screen').src === 'host.html?c=ZZZZ', 'and back to the table');

    /* A copy playing itself says where it has got to, unasked. Only the place
       moves: the frame stays on the copy it is already showing. */
    P.socks[0].onmessage({ data: JSON.stringify({
      t: 'replayAt', code: 'ZZZZ', at: 3, playing: true, rate: 1,
      where: 'Round 1 of 1 · 2 cards · the round is scored' }) });
    ok(P.pick('#subtitle').textContent === 'table BBBB · point 4 of 6',
       'the head keeps up  got ' + P.pick('#subtitle').textContent);
    /* A frame told its own address again loads it again, so the address is
       compared rather than set: the game would otherwise start over every time
       the copy moved a point. */
    P.pick('#screen').src = 'SET-ONCE';
    P.socks[0].onmessage({ data: JSON.stringify({
      t: 'replayAt', code: 'ZZZZ', at: 4, playing: true, rate: 1, where: 'the game ends' }) });
    ok(P.pick('#screen').src === 'SET-ONCE', 'and the screen is not loaded again');
    ok(P.pick('#transport').querySelector('.vw-play').textContent === '❚❚ Pause',
       'a playing copy offers to stop');
  }

  {   // no game named, and nothing to open
    const P = loadPage('replay.js', {}, '', { real: REAL });
    P.start();
    ok(P.socks.length === 0, 'a page with no game in its address opens no socket');
    ok(/Past games/.test(P.pick('#err').textContent),
       'and says where to pick one  got ' + P.pick('#err').textContent);
  }

  {   /* A game the table can no longer put back. The page says what the
         server said, and there is nothing to show. */
    const P = loadPage('replay.js', {}, '?g=a1b2c3d4e5f6', { real: REAL });
    P.start();
    P.socks[0].onopen();
    P.socks[0].onmessage({ data: JSON.stringify({
      t: 'error', msg: 'Nothing was written down about that game.' }) });
    ok(P.pick('#err').textContent === 'Nothing was written down about that game.',
       'the refusal is what the page says  got ' + P.pick('#err').textContent);
    ok(P.pick('#band').hidden === true, 'and there is no way about a copy there is not');
  }
}

part('the dev controls, on each kind of server');

  /* The replay half of the page is the viewer's own file, so the checks run
     the real one: what they are proving is that the page puts it where it
     goes and that it draws what the server said. */
  // What dev.html loads beside the page itself. Settings is real here because
  // the bar's one button opens it: the look and the preview size are rows in
  // it, not controls of this page's own.
  const VIEWER = ['public/ui.js', 'public/settings.js', 'public/viewer.js'];

  /* An address that already names where to go still asks what this server
     will take. A table answers with a hello, which says as much; a copy
     answers with the copy, which says nothing about the server -- so a replay
     opened by address believed it was on a server that invents nothing, and
     put away every control that needs one, the hand picker among them.

     Asked second, so the answer that draws the page lands first and the door
     never flashes up on its way to somewhere the address already named. */
  {
    const byGame = loadPage('dev.js', {}, '', { hash: '#g=a1b2c3d4e5f6', real: VIEWER });
    byGame.start();
    byGame.socks[0].onopen();
    const said = byGame.socks[0].sent.map((o) => o.do || o.action);
    ok(said.join(',') === 'open,ways',
       'a page sent to a game opens it, then asks what it may do there  got ' + said.join(','));

    const byCode = loadPage('dev.js', {}, '', { hash: '#c=AAAA&t=th', real: VIEWER });
    byCode.start();
    byCode.socks[0].onopen();
    ok(byCode.socks[0].sent.map((o) => o.action).join(',') === 'open,ways',
       'and so does one sent to a table  got '
       + byCode.socks[0].sent.map((o) => o.action).join(','));

    /* A refusal to a question the page did not need the answer to is not the
       question being refused. Asked while there is nowhere else to be, a
       refused `ways` draws the fallback door; asked from somewhere, it draws
       nothing and leaves the line to whatever it was really about. */
    byGame.socks[0].onmessage({ data: JSON.stringify({ t: 'error', msg: 'no such game' }) });
    ok(byGame.pick('#dev-err').textContent === 'no such game',
       'and an error still reaches the page  got ' + byGame.pick('#dev-err').textContent);
  }

  /* The tab strip is markup, not something the page builds, so a fake page is
     given one: the two buttons dev.html carries, clicked as a hand clicks
     them. `P.tab('state')` is the tools half changing tables. */
  const devTabs = (P) => {
    const strip = P.pick('#dev-tabs');
    const made = {};
    ['players', 'state'].forEach((t) => {
      const b = new P.dom.El('button');
      b.className = 'btn devtab';
      b.dataset.tab = t;
      strip.appendChild(b);
      made[t] = b;
    });
    return (t) => made[t].fire('click');
  };

  // A table on the wire: the hello the dev page gets, then a state.
  const devPage = (srv, seats, tab) => {
    const P = loadPage('dev.js', tab ? { 'rcs:dev:tab': tab } : {}, '',
                       { hash: '#c=AAAA&t=th', real: VIEWER });
    P.tab = devTabs(P);
    P.start();
    P.socks[0].onopen();
    P.socks[0].onmessage({ data: JSON.stringify({
      t: 'hello', role: 'host', code: 'AAAA', token: 'th', dev: true, srv,
      stand: !!srv, seats,
    }) });
    return P;
  };
  const devState = (dev, over) => JSON.stringify(Object.assign({
    t: 'state', code: 'AAAA', phase: 'bid', dev, idx: 0,
    cfg: { max: 3, pattern: 'down', ones: 2, deck: 'real' },
    seats: [{ id: 's1', name: 'Ann' }, { id: 's2', name: 'Bob' }],
    captainId: 's1', firstDealerId: 's1',
    rounds: [{ cards: 3, dealer: 0, bids: [null, null], tricks: null },
             { cards: 2, dealer: 1, bids: null, tricks: null }],
    totals: [0, 0], chat: [],
  }, over || {}));

  {   // a real game on a normal server: the repair tools, and no more
    const P = devPage(false, [{ id: 's1', name: 'Ann', watch: 'w1' },
                              { id: 's2', name: 'Bob', watch: 'w2' }]);
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"dev","action":"open","code":"AAAA","token":"th"}',
       'the page opens on the table its address names  got ' + JSON.stringify(P.socks[0].sent[0]));
    P.socks[0].onmessage({ data: devState(false) });

    ok(P.pick('#tables-tools').hidden === true, 'a normal server hides the tables a page cannot list');
    ok(P.pick('#scrub-tools').hidden === true, 'and the scrubber, which fills a card it may not invent');
    ok(P.pick('#shots-dev').hidden === true, 'and every one-shot that makes data up');
    ok(P.pick('#scrub').children.length === 0, 'so the card is not even drawn');
    ok(P.pick('#panel-toggles').hidden === false, 'but the panels that put a game right stay');
    ok(P.pick('#live-note').hidden === false, 'and the page says real players may be at the table');
    ok(P.pick('#ph-photo').textContent === '', 'the photo column says nothing it cannot do');

    /* ---- managing the round a live game is stuck in ----
       The panel says which round it is editing, and carries the one control
       the numbers themselves cannot supply: the phase. */
    const row = P.pick('#phase-row');
    ok(row.querySelector('.pround').textContent === 'Round 1 of 2 · 3 cards',
       'the panel names the round it is editing  got ' + row.querySelector('.pround').textContent);
    const seg = row.querySelector('.pphase').querySelector('.seg');
    ok(seg && seg.querySelectorAll('.btn').length === 4,
       'it offers the four phases the table will hold');
    ok(seg.querySelector('.btn.on').dataset.v === 'bid',
       'and marks the one the game is in  got ' + seg.querySelector('.btn.on').dataset.v);

    P.socks[0].sent.length = 0;
    seg.querySelectorAll('.btn').find((b) => b.dataset.v === 'tricks').fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"dev","action":"patch","patch":{"phase":"tricks"}}',
       'and a phase lands the moment it is pressed  got ' + JSON.stringify(P.socks[0].sent[0]));

    /* The rest of what the round is, above the seats: things that belong to
       the hand rather than to any one player. A row that does not apply to
       this table is not there -- a rule the table will not take should not be
       offered one press at a time. */
    const trump = row.querySelector('.ptrump');
    ok(trump && trump.hidden === true,
       'with real cards the deck on the table decides the trumps, so none is offered');
    ok(row.querySelector('.ptrick').hidden === true, 'and no trick to count while the bids are up');

    // The bids go in, and the trick is the table's to hand to somebody.
    P.socks[0].onmessage({ data: devState(false, { phase: 'tricks' }) });
    const trick = row.querySelector('.ptrick');
    ok(trick.hidden === false, 'once the hand is on, the trick can be counted to a seat');
    ok(trick.querySelector('.seg').querySelectorAll('.btn').length === 2,
       'one button a seat  got ' + trick.querySelector('.seg').querySelectorAll('.btn').length);
    P.socks[0].sent.length = 0;
    trick.querySelector('.seg').querySelectorAll('.btn')[1].fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"trick","p":1}',
       'as the table\'s own message, since this page holds the host token  got '
       + JSON.stringify(P.socks[0].sent[0]));
    P.socks[0].sent.length = 0;
    trick.querySelectorAll('button').find((b) => /Take back/.test(b.textContent)).fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"trickback"}', 'and one taken back the same way');

    /* A table that deals the cards turns its own trump and counts its own
       tricks, so the two rows swap over. */
    P.socks[0].onmessage({ data: devState(false, {
      phase: 'tricks', cfg: { max: 3, pattern: 'down', ones: 2, deck: 'virtual' } }) });
    ok(row.querySelector('.ptrump').hidden === false, 'a table that deals turns a trump');
    ok(row.querySelector('.ptrick').hidden === true, 'and counts its own tricks');
    P.socks[0].sent.length = 0;
    row.querySelector('.ptrump').querySelector('.seg')
      .querySelectorAll('.btn').find((b) => b.dataset.v === 'H').fire('click');
    ok(JSON.stringify(P.socks[0].sent[0])
       === '{"t":"dev","action":"patch","patch":{"round":{"i":0,"trump":"H"}}}',
       'the trump lands on the round on show  got ' + JSON.stringify(P.socks[0].sent[0]));
    P.socks[0].sent.length = 0;
    row.querySelector('.ptrump').querySelectorAll('button')
      .find((b) => b.textContent === 'Deal again').fire('click');
    ok(JSON.stringify(P.socks[0].sent[0])
       === '{"t":"dev","action":"patch","patch":{"round":{"i":0,"redeals":1}}}',
       'and the redeal count is what makes a fresh deal land  got '
       + JSON.stringify(P.socks[0].sent[0]));
    P.socks[0].onmessage({ data: devState(false) });

    const vote = row.querySelector('.pvote');
    ok(vote && vote.hidden === false && /none open/.test(vote.querySelector('.pstate').textContent),
       'and a vote says whether one is open  got '
       + (vote && vote.querySelector('.pstate').textContent));
    P.socks[0].sent.length = 0;
    vote.querySelectorAll('button').find((b) => b.textContent === 'Cancel').fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"votecancel"}',
       'and cancelling one is the table\'s own message  got '
       + JSON.stringify(P.socks[0].sent[0]));

    /* ---- what can be done to one seat ----
       A row of verbs under each seat's values. Every one of them is a state a
       real table reaches on its own; the page only reaches it sooner, and by
       the same door -- each is a room verb, not a value written over. */
    const tools = P.pick('#prows').querySelectorAll('.ptools');
    ok(tools.length === 2, 'every seat carries its own row of verbs  got ' + tools.length);
    const verb = (i, word) =>
      tools[i].querySelectorAll('button').find((b) => b.textContent === word);
    ['Phone off', 'Leave', 'Kick', 'Time out', 'Rejoin'].forEach((w) =>
      ok(!!verb(0, w), 'the seat can be told to ' + w));

    P.socks[0].sent.length = 0;
    verb(0, 'Leave').fire('click');
    ok(JSON.stringify(P.socks[0].sent[0])
       === '{"t":"dev","action":"seatDo","id":"s1","do":"leave"}',
       'and each goes as itself, not as a value written over  got '
       + JSON.stringify(P.socks[0].sent[0]));

    /* Mid-game a seat cannot simply go -- the rounds played are that player's,
       and the scorecard is a column for it -- so Kick says so rather than
       earning a refusal one press at a time. */
    ok(verb(0, 'Kick').disabled === true, 'a seat only leaves the table in the lobby');
    /* Every seat verb goes through the one door, because this page's socket is
       not always at the table it is driving: watching a game again it is at no
       table at all, and the copy is reached by name. The rules they lean on
       are the room's -- kickSeat will not take a seat off a table that has
       started, whoever asks -- so nothing is agreed twice. */
    P.socks[0].onmessage({ data: devState(false, { phase: 'lobby' }) });
    P.socks[0].sent.length = 0;
    P.pick('#prows').querySelectorAll('.ptools')[0]
      .querySelectorAll('button').find((b) => b.textContent === 'Kick').fire('click');
    ok(JSON.stringify(P.socks[0].sent[0])
       === '{"t":"dev","action":"seatDo","id":"s1","do":"kick"}',
       'and in the lobby it goes  got ' + JSON.stringify(P.socks[0].sent[0]));
    P.socks[0].onmessage({ data: devState(false) });
    ok(verb(0, 'Rejoin').disabled === true, 'and only a seat the table took over comes back');

    /* A phone goes quiet by its socket going, which here is its pane not being
       drawn: presence is worked out from the live sockets on every broadcast,
       so a flag would be wiped by the next thing that happened. */
    P.socks[0].sent.length = 0;
    const panes = () => P.pick('#seat-frames').querySelectorAll('.frame').length;
    const had = panes();
    verb(0, 'Phone off').fire('click');
    ok(P.socks[0].sent.length === 0, 'shutting a phone tells the table nothing');
    ok(panes() === had - 1, 'it takes the pane away  got ' + panes() + ' of ' + had);
    const back = P.pick('#prows').querySelectorAll('.ptools')[0]
      .querySelectorAll('button').find((b) => b.textContent === 'Phone on');
    ok(!!back, 'and offers to draw it again');
    back.fire('click');
    ok(panes() === had, 'which brings the socket back  got ' + panes());

    /* Acting for a seat. The table's own two are offered on exactly the seat
       the table would take them for -- the one it is waiting on that nobody is
       behind -- because anywhere else they are a button that earns a refusal. */
    const toolsOf = (i) => P.pick('#prows').querySelectorAll('.ptools')[i];
    const wordOn = (i, w) => toolsOf(i).querySelectorAll('button').find((b) => b.textContent === w);
    ok(!wordOn(0, 'Bid for'), 'nobody bids for a seat whose phone is at the table');
    P.socks[0].onmessage({ data: devState(false, {
      seats: [{ id: 's1', name: 'Ann', online: false }, { id: 's2', name: 'Bob', online: true }],
      rounds: [{ cards: 3, dealer: 1, bids: [null, null], tricks: null },
               { cards: 2, dealer: 1, bids: null, tricks: null }] }) });
    ok(!!wordOn(0, 'Bid for'), 'the seat the table waits on, that nobody is behind, is bid for');
    ok(!wordOn(1, 'Bid for'), 'and only that one');
    P.socks[0].sent.length = 0;
    wordOn(0, 'Bid for').fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"bidfor"}',
       'as the table\'s own message  got ' + JSON.stringify(P.socks[0].sent[0]));

    // A vote is answered by the phone it is put to, so this is the one thing
    // here that no host-side message can say.
    ok(!wordOn(0, '\u2713'), 'no vote open, nothing to answer');
    P.socks[0].onmessage({ data: devState(false, {
      vote: { kind: 'bumdeal', by: 1, round: 0, yes: [1], no: [] } }) });
    ok(!!wordOn(0, '\u2713') && !!wordOn(0, '\u2717'), 'a vote open, and each seat may answer it');
    P.socks[0].sent.length = 0;
    wordOn(0, '\u2717').fire('click');
    ok(JSON.stringify(P.socks[0].sent[0])
       === '{"t":"dev","action":"seatDo","id":"s1","do":"no"}',
       'and a no goes as that seat\'s  got ' + JSON.stringify(P.socks[0].sent[0]));
    ok(/Bob asked . 1 yes, 0 no/.test(P.pick('#phase-row').querySelector('.pvote')
         .querySelector('.pstate').textContent),
       'while the round line says who asked and how it stands  got '
       + P.pick('#phase-row').querySelector('.pvote').querySelector('.pstate').textContent);

    // And a line in the talk, as that seat.
    P.dom.window.prompt = () => 'well played';
    P.socks[0].sent.length = 0;
    wordOn(0, '\uD83D\uDCAC').fire('click');
    ok(JSON.stringify(P.socks[0].sent[0])
       === '{"t":"dev","action":"seatDo","id":"s1","do":"say","text":"well played"}',
       'said as that seat  got ' + JSON.stringify(P.socks[0].sent[0]));
    P.dom.window.prompt = () => null;
    P.socks[0].sent.length = 0;
    wordOn(0, '\uD83D\uDCAC').fire('click');
    ok(P.socks[0].sent.length === 0, 'and nothing said is nothing sent');

    P.socks[0].onmessage({ data: devState(false, {
      seats: [{ id: 's1', name: 'Ann', left: true }, { id: 's2', name: 'Bob' }] }) });
    const give = P.pick('#prows').querySelectorAll('.ptools')[0]
      .querySelectorAll('button').find((b) => b.textContent === 'Rejoin');
    ok(give && give.disabled === false, 'a seat the table took over can be given back');
    P.socks[0].sent.length = 0;
    give.fire('click');
    ok(JSON.stringify(P.socks[0].sent[0])
       === '{"t":"dev","action":"seatDo","id":"s1","do":"back"}',
       'by name, through the same door  got ' + JSON.stringify(P.socks[0].sent[0]));
  }

  {   /* ---- a record the table will not have ----
         The refusal belongs beside the button that earned it, and the edit
         has to survive it: it is the thing being put right. */
    const P = devPage(false, [{ id: 's1', name: 'Ann', watch: 'w1' }]);
    P.pick('#state-text').blur = () => {};          // the fake DOM has no focus
    P.socks[0].onmessage({ data: devState(false) });

    ok(P.socks[0].sent.some((m) => m.action === 'state' && !('record' in m)),
       'a table arriving asks for the record, since the box is always beside it');
    P.socks[0].onmessage({ data: JSON.stringify({ t: 'stateRaw', record: { code: 'AAAA', seats: [] } }) });

    const edited = '{"code":"AAAA","seats":[]}';
    P.pick('#state-text').value = edited;
    P.socks[0].sent.length = 0;
    P.pick('#btn-state-apply').fire('click');
    ok(P.socks[0].sent.length === 1 && 'record' in P.socks[0].sent[0],
       'Apply sends the record and nothing after it  got ' + JSON.stringify(P.socks[0].sent));

    P.socks[0].onmessage({ data: JSON.stringify({ t: 'error', msg: 'a table needs its seats' }) });
    ok(P.pick('#state-err').textContent === 'a table needs its seats'
       && P.pick('#state-err').hidden === false,
       'a refused record says why beside the Apply button');
    ok(P.pick('#dev-err').textContent !== 'a table needs its seats',
       'and not away at the top of the page');
    ok(P.pick('#state-text').value === edited, 'and the edit that was refused is still there');

    // The same apply, taken: the table answers with a hello, and only then is
    // the record read back.
    P.pick('#btn-state-apply').fire('click');
    P.socks[0].sent.length = 0;
    P.socks[0].onmessage({ data: JSON.stringify({
      t: 'hello', role: 'host', code: 'AAAA', token: 'th', dev: true, srv: false,
      stand: false, seats: [{ id: 's1', name: 'Ann', watch: 'w1' }],
    }) });
    ok(P.socks[0].sent.some((m) => m.action === 'state' && !('record' in m)),
       'a record the table took is read back once it has landed');
  }

  {   /* ---- the table moving under the text ----
         An Apply puts back everything the record does not carry, so a table
         that has moved since the read has to be said, not found out. */
    const P = devPage(false, [{ id: 's1', name: 'Ann', watch: 'w1' }]);
    P.pick('#state-text').blur = () => {};
    P.socks[0].onmessage({ data: devState(false) });
    P.socks[0].sent.length = 0;
    P.tab('state');
    ok(P.socks[0].sent.some((m) => m.action === 'state' && !('record' in m)),
       'the record is read on the way into its tab  got ' + JSON.stringify(P.socks[0].sent));
    P.socks[0].onmessage({ data: JSON.stringify({ t: 'stateRaw', record: { code: 'AAAA', seats: [] } }) });
    ok(P.pick('#state-stale').hidden === true, 'a record just read is not stale');

    P.socks[0].onmessage({ data: devState(false) });
    ok(P.pick('#state-stale').hidden === false,
       'the table moving under the text says so');

    P.pick('#btn-state-reload').fire('click');
    P.socks[0].onmessage({ data: JSON.stringify({ t: 'stateRaw', record: { code: 'AAAA', seats: [] } }) });
    ok(P.pick('#state-stale').hidden === true, 'and reading it afresh clears it');

    // The answer to a read is not the table moving.
    P.pick('#btn-state-reload').fire('click');
    P.socks[0].onmessage({ data: devState(false) });
    ok(P.pick('#state-stale').hidden === true,
       'a state arriving with a read outstanding is the answer coming, not news');

    // A copy of the broken table, before it is put right.
    const took = [];
    P.dom.window.navigator = { clipboard: { writeText: (t) => { took.push(t); return Promise.resolve(); } } };
    P.pick('#state-text').value = '{"code":"AAAA"}';
    P.pick('#btn-state-copy').fire('click');
    ok(took[0] === '{"code":"AAAA"}', 'Copy puts the record on the clipboard  got ' + took[0]);

    P.dom.window.navigator = {};              // a page that may not copy
    P.pick('#btn-state-copy').fire('click');
    ok(took.length === 1, 'and where it may not, it says so rather than doing nothing');
  }

  {   /* ---- the look of the page, and how big it draws the screens ----
         Both are settings, and the app has one place for those. A select and a
         half-moon parked on the top bar were this page keeping its own. */
    const P = devPage(true, [{ id: 's1', name: 'Ann', token: 't1' }]);
    P.socks[0].onmessage({ data: devState(true) });
    const menu = P.dom.document.body.querySelector('.settings');
    ok(!!menu, 'the bar has the settings page every screen has');
    P.pick('#btn-settings').fire('click');
    ok(menu.hidden === false, 'and its one button opens it');
    const rowOf = (label) => menu.querySelectorAll('.menu-row')
      .find((r) => (r.querySelector('.menu-label') || {}).textContent === label);
    ok(!!rowOf('Theme'), 'with the theme in it, where every other page has it');
    const size = rowOf('Preview size');
    ok(!!size, 'and how big this page draws its screens');
    const picks = size.querySelector('.seg').querySelectorAll('button');
    ok(picks.map((b) => b.textContent).join(' ') === '50% 65% 80% 100%',
       'the sizes the bar used to carry  got ' + picks.map((b) => b.textContent).join(' '));
    ok(picks[1].classList.contains('on'), 'opening on the one it is drawn at');

    /* The size itself is written into the pane as it is built, which a fake
       page cannot read. What it can see is that another size draws them
       again: every pane is thrown away and rebuilt, which is the whole of
       what the old select's change handler did. */
    const pane = () => P.pick('#seat-frames').querySelector('.frame');
    const was = pane();
    ok(!!was, 'there is a pane a seat');
    picks[3].fire('click');
    ok(pane() !== was && !!pane(), 'and picking another size draws them again');
    ok(P.dom.localStorage.getItem('rcs:dev:scale') === '1',
       'which is remembered, as the tab is  got ' + P.dom.localStorage.getItem('rcs:dev:scale'));
  }

  {   /* ---- the record, drawn ----
         The box is a textarea and nothing else -- what is typed is what is
         sent -- with a coloured copy of the same text lying under it and the
         line numbers beside it. Whether the text was even JSON used to be a
         thing you found out by sending it to the table. */
    const P = devPage(false, [{ id: 's1', name: 'Ann', watch: 'w1' }], 'state');
    const box = P.pick('#state-text');
    box.blur = () => {};
    P.socks[0].onmessage({ data: JSON.stringify({ t: 'stateRaw', record: {
      code: 'AAAA', idx: 1, phase: 'bid', seats: [{ id: 's1', name: 'Ann', bot: false }],
      rounds: [{ cards: 3 }, { cards: 2 }], vote: null,
    } }) });

    const paint = P.pick('#state-paint');
    ok(paint.querySelectorAll('.jk').length >= 5,
       'a name in the record is coloured as one  got ' + paint.querySelectorAll('.jk').length);
    ok(paint.querySelectorAll('.js').length >= 3, 'and a word as a word');
    ok(paint.querySelectorAll('.jn').length >= 3, 'a number as a number');
    ok(paint.querySelectorAll('.jz').length === 1, 'and the one nothing in it');
    const lines = box.value.split('\n').length;
    ok(P.pick('#state-nums').textContent.split('\n').length === lines,
       'a number down the side for every line  got '
       + P.pick('#state-nums').textContent.split('\n').length + ' against ' + lines);
    ok(/^table AAAA · 1 seat · round 2 of 2/.test(P.pick('#state-what').textContent),
       'the head says what the record is  got ' + P.pick('#state-what').textContent);
    ok(P.pick('#state-ok').textContent === '✓', 'and that it is JSON');
    ok(new RegExp('^' + lines + ' lines · ').test(P.pick('#state-size').textContent),
       'the foot says how big it is  got ' + P.pick('#state-size').textContent);
    ok(P.pick('#btn-state-apply').disabled === false, 'a record that parses can be applied');

    /* Typed into and broken: said as it is typed, and on the box rather than
       in a line under it. The head is where the eye already is. */
    box.value = '{"code":"AAAA",';
    box.fire('input');
    ok(P.pick('#state-ok').textContent === '✗', 'a record half typed says so');
    ok(P.pick('#state-body').classList.contains('bad'), 'the frame says it too');
    ok(/^not JSON — /.test(P.pick('#state-what').textContent),
       'with the reason where the name was  got ' + P.pick('#state-what').textContent);
    ok(P.pick('#btn-state-apply').disabled === true,
       'and there is nothing to apply until it parses');

    box.value = '{"code":"AAAA"}';
    box.fire('input');
    ok(P.pick('#state-ok').textContent === '✓' && P.pick('#btn-state-apply').disabled === false,
       'closed again, it can go');
    ok(!P.pick('#state-body').classList.contains('bad'), 'and the frame is a frame again');

    // The layers under the box are moved by its own scrolling, not their own.
    box.scrollTop = 40; box.scrollLeft = 12;
    box.fire('scroll');
    ok(P.pick('#state-paint').scrollTop === 40 && P.pick('#state-paint').scrollLeft === 12,
       'the colours ride with the text');
    ok(P.pick('#state-nums').scrollTop === 40, 'and so do the numbers, down only');

    // The table moving under it is said on the frame as well as in words.
    P.socks[0].onmessage({ data: devState(false) });
    ok(P.pick('#state-body').classList.contains('stale'),
       'a table that has moved is said on the box itself');
  }

  {   /* ---- the table the half was left on ----
         A change under public/ reloads this page while it is being worked in,
         so the tab outlives the reload: coming back to the seats every time a
         file is saved is the page undoing what was just chosen. */
    const P = devPage(false, [{ id: 's1', name: 'Ann', watch: 'w1' }], 'state');
    ok(P.pick('#state-panel').hidden === false && P.pick('#players-panel').hidden === true,
       'the tools half opens on the table it was left on');
    P.tab('players');
    ok(P.dom.localStorage.getItem('rcs:dev:tab') === 'players',
       'and changing tables is remembered  got ' + P.dom.localStorage.getItem('rcs:dev:tab'));
  }

  {   /* ---- the won column ----
         The table keeps the tricks only when every seat has a number, so a
         column sent a cell at a time was thrown away on each cell and took
         the typing with it. It goes as one now. */
    const P = devPage(false, [{ id: 's1', name: 'Ann', watch: 'w1' },
                              { id: 's2', name: 'Bob', watch: 'w2' }]);
    P.socks[0].onmessage({ data: devState(false) });

    const won = P.pick('#prows').querySelectorAll('input.won');
    ok(won.length === 2, 'one won box a seat  got ' + won.length);

    P.socks[0].sent.length = 0;
    won[0].value = '2';
    won[0].fire('change');
    ok(P.socks[0].sent.length === 0, 'half a column is not sent, so it cannot be thrown away');
    ok(won[1].classList.contains('part') && !won[0].classList.contains('part'),
       'and the cell it is waiting on says so');

    won[1].value = '1';
    won[1].fire('change');
    ok(JSON.stringify(P.socks[0].sent[0])
       === '{"t":"dev","action":"patch","patch":{"round":{"i":0,"tricks":[2,1]}}}',
       'the whole column goes at once  got ' + JSON.stringify(P.socks[0].sent[0]));
    ok(!won[0].classList.contains('part') && !won[1].classList.contains('part'),
       'and nothing is left ringed');

    // A bid is not a column: the table keeps one with gaps, so it still goes
    // on its own.
    P.socks[0].sent.length = 0;
    const bids = P.pick('#prows').querySelectorAll('input').filter(
      (el) => el.type === 'number' && !el.classList.contains('won'));
    bids[0].value = '3';
    bids[0].fire('change');
    ok(JSON.stringify(P.socks[0].sent[0])
       === '{"t":"dev","action":"patch","patch":{"round":{"i":0,"bids":[3,null]}}}',
       'a bid still lands beside the gaps  got ' + JSON.stringify(P.socks[0].sent[0]));
  }

  {   /* ---- the way in ----
         Three doors, asked before anything else is drawn. Which of them are
         open follows the server; a code in the address answers the question
         before it is put. */
    const cold = (srv) => {
      const P = loadPage('dev.js', {}, '', { real: VIEWER });
      P.pick('#state-panel').hidden = true;
      P.start();
      P.socks[0].onopen();
      ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"dev","action":"ways"}',
         'a page with nothing in its address asks what it may do  got '
         + JSON.stringify(P.socks[0].sent[0]));
      P.socks[0].onmessage({ data: JSON.stringify({
        t: 'ways', srv, tables: srv ? [{ code: 'WXYZ', phase: 'bid', round: 2, rounds: 7,
                                         seats: ['a', 'b', 'c', 'd'], stand: true }] : [],
        here: null,
        games: [{ id: 'a1b2c3d4e5f6', code: 'BBBB', at: 1787000000000,
                  names: ['Cal', 'Dot'], totals: [31, 47], winners: [1] },
                { id: 'f6e5d4c3b2a1', code: 'QRST', at: 1786900000000,
                  names: ['Eve', 'Fay'], unfinished: true, round: 4, rounds: 15 }],
      }) });
      return P;
    };

    {   // a normal server: no stand-ins to be had, and no list of tables
      const P = cold(false);
      ok(P.pick('#ways').hidden === false, 'the way in is the whole page');
      ok(P.pick('#band').hidden === true, 'and the controls are not drawn yet');
      const doors = P.pick('#ways').querySelectorAll('.way');
      ok(doors.length === 3, 'a new table, one in play, and a game to watch  got ' + doors.length);
      ok(doors[0].classList.contains('shut'),
         'a table of stand-ins needs a dev server, and says so rather than failing');
      ok(doors[0].querySelectorAll('input').length === 0, 'so it asks for nothing');
      ok(doors[1].querySelectorAll('input').length === 2,
         'a table in play wants its code and its host key  got '
         + doors[1].querySelectorAll('input').length);
      ok(doors[1].querySelectorAll('.waylist').length === 0,
         'and a normal server hands over no list of its tables');
      const games = doors[2].querySelectorAll('.grow');
      ok(games.length === 2, 'a game on file needs neither  got ' + games.length);
      ok(games[0].querySelector('.gwon').textContent === '🏆 Dot · 47',
         'a row says who took it and with what  got '
         + games[0].querySelector('.gwon').textContent);
      ok(games[0].querySelector('.gwho').textContent === '2 players · Cal, Dot',
         'and who was at it  got ' + games[0].querySelector('.gwho').textContent);
      ok(!!games[0].querySelector('.gwhen').textContent, 'and when it was played');

      /* A game that never finished has no winner to name. What it has instead
         is how far it got, which is the thing you came to look at. */
      ok(games[1].classList.contains('part'), 'one that never finished is marked apart');
      ok(games[1].querySelector('.gwon').textContent === '⚠️ unfinished · round 4 of 15',
         'and says how far it got  got ' + games[1].querySelector('.gwon').textContent);

      P.socks[0].sent.length = 0;
      games[0].fire('click');
      ok(JSON.stringify(P.socks[0].sent[0])
         === '{"t":"replay","do":"open","game":"a1b2c3d4e5f6"}',
         'and picking one watches it  got ' + JSON.stringify(P.socks[0].sent[0]));

      // The code typed in, on a server that will not list its tables.
      const box = doors[1].querySelectorAll('input');
      box[0].value = 'wxyz';
      box[1].value = 'thost';
      P.socks[0].sent.length = 0;
      doors[1].querySelector('.btn').fire('click');
      ok(JSON.stringify(P.socks[0].sent[0])
         === '{"t":"dev","action":"open","code":"WXYZ","token":"thost"}',
         'a code typed in opens that table  got ' + JSON.stringify(P.socks[0].sent[0]));
    }

    {   // a dev server: stand-ins, and every table it is running
      const P = cold(true);
      const doors = P.pick('#ways').querySelectorAll('.way');
      ok(!doors[0].classList.contains('shut'), 'a dev server makes a table of stand-ins');
      P.socks[0].sent.length = 0;
      doors[0].querySelector('.btn').fire('click');
      ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"dev","action":"setup","players":4}',
         'and asks for one the size the box says  got ' + JSON.stringify(P.socks[0].sent[0]));
      const rows = doors[1].querySelectorAll('.trow');
      ok(rows.length === 1, 'the tables it is running are a list to press  got ' + rows.length);
      ok(doors[1].querySelectorAll('input').length === 1,
         'and no host key is typed, because it hands them over anyway');
      P.socks[0].sent.length = 0;
      rows[0].fire('click');
      ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"dev","action":"open","code":"WXYZ"}',
         'pressing one opens the page on it  got ' + JSON.stringify(P.socks[0].sent[0]));
    }

    {   /* A server older than this page does not know the question, so nothing
           will answer it. The card is still drawn off what the page knows on
           its own: a blank panel with a line and no doors is no way in. */
      const P = loadPage('dev.js', {}, '', { real: VIEWER });
      P.pick('#state-panel').hidden = true;
      P.start();
      P.socks[0].onopen();
      P.socks[0].onmessage({ data: JSON.stringify({
        t: 'error', msg: 'Open a table first.' }) });
      ok(P.pick('#ways').hidden === false, 'the way in is still the page');
      ok(P.pick('#ways').querySelectorAll('.way').length === 3,
         'with its three doors  got ' + P.pick('#ways').querySelectorAll('.way').length);
      ok(P.pick('#ways').querySelectorAll('.way')[1].querySelectorAll('input').length === 2,
         'and the one that still works there asking for a code and a key');
      ok(P.pick('#dev-err').textContent === 'Open a table first.',
         'the refusal stays under it  got ' + P.pick('#dev-err').textContent);
    }

    {   /* A line earned before the question does not outlive its answer. */
      const P = cold(false);
      P.socks[0].onmessage({ data: JSON.stringify({ t: 'error', msg: 'no such thing' }) });
      ok(P.pick('#dev-err').textContent === 'no such thing', 'a refusal is put up');
      P.socks[0].sent.length = 0;
      P.pick('#ways').querySelectorAll('.way')[1].querySelector('.btn').fire('click');
      ok(P.pick('#dev-err').textContent === 'a table needs its code',
         'and pressing a door with nothing in it earns its own  got '
         + P.pick('#dev-err').textContent);
    }

    {   // a code in the address is the question already answered
      const P = devPage(false, [{ id: 's1', name: 'Ann', watch: 'w1' }]);
      ok(P.pick('#ways').hidden === true, 'a code in the address opens straight onto that table');
      ok(P.pick('#band').hidden === false, 'with the controls drawn');
      P.socks[0].sent.length = 0;
      P.pick('#btn-ways').fire('click');
      ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"dev","action":"ways"}',
         'and ⌂ puts the question back  got ' + JSON.stringify(P.socks[0].sent[0]));
      ok(P.pick('#ways').hidden === false, 'the way in comes back');
      ok(P.pick('#band').hidden === true, 'and the controls go');

      /* A line earned before the question is answered by it, so it goes with
         the answer; a line that is the reason for the question stays. */
      P.pick('#dev-err').textContent = 'something older';
      P.socks[0].onmessage({ data: JSON.stringify({
        t: 'ways', srv: false, tables: [], here: null, games: [] }) });
      ok(P.pick('#dev-err').textContent === '', 'an answered question leaves no line behind');

      P.socks[0].onmessage({ data: JSON.stringify({
        t: 'hello', role: 'host', code: 'AAAA', token: 'th', dev: true, srv: false,
        stand: false, seats: [] }) });
      P.socks[0].onmessage({ data: JSON.stringify({ t: 'error', msg: 'That table is gone.' }) });
      ok(P.pick('#ways').hidden === false, 'a table that goes puts the question back');
      P.socks[0].onmessage({ data: JSON.stringify({
        t: 'ways', srv: false, tables: [], here: null, games: [] }) });
      ok(P.pick('#dev-err').textContent === 'That table is gone.',
         'and the reason for it outlives the answer  got ' + P.pick('#dev-err').textContent);
    }
  }

  {   /* ---- watching the game again ----
         A replay takes the band a table takes: the games where the tables are,
         the rounds where the scorecard is, the transport where Pause is. It
         is offered on any server, because it invents nothing -- it puts back
         what already happened, on a copy. */
    const P = devPage(false, [{ id: 's1', name: 'Ann', watch: 'w1' },
                              { id: 's2', name: 'Bob', watch: 'w2' }]);
    P.socks[0].onmessage({ data: devState(false) });
    ok(P.pick('#replay-run').hidden === true, 'with nothing being watched there is no transport');
    ok(P.pick('#steps-row').hidden === true, 'and no points to step through');

    const say = (over) => P.socks[0].onmessage({ data: JSON.stringify(Object.assign({
      t: 'replay', code: 'ZZZZ', of: 'AAAA', at: 0, n: 13, playing: false, rate: 1,
      here: 'AAAA', game: 'a1b2c3d4e5f6',
      games: [{ id: 'a1b2c3d4e5f6', code: 'BBBB', at: 1787000000000, names: ['Cal', 'Dot'] }],
      state: JSON.parse(devState(false)),
      seats: [{ id: 's1', name: 'Ann', watch: 'rw1' }, { id: 's2', name: 'Bob', watch: 'rw2' }],
      marks: [{ at: 1, i: 0, cards: 3, w: 'game' }, { at: 6, i: 0, cards: 3, w: 'bum' },
              { at: 11, i: null, w: 'end' }],
      kinds: 'GRbbscccwΣRbE'.replace('Σ', 'e'),
      says: ['the game starts', 'the round is dealt', 'Ann bids 1', 'Bob bids 2',
             'a trick opens', 'Ann plays 9♠', 'Bob plays 4♥', 'Ann plays K♦',
             'Ann takes the trick', 'the round is scored', 'the round is dealt',
             'Bob bids 0', 'the game ends'],
      faces: ['', '', '1', '2', '', '9♠', '4♥', 'K♦', '', '', '', '0', ''],
      where: 'Round 1 of 2 · 3 cards · Ann bids 1',
    }, over || {})) });

    /* ---- a copy open: the band it takes over ---- */
    say();
    const run = () => P.pick('#replay-transport').querySelector('.viewer-run');
    const tl = () => P.pick('#replay-points').querySelector('.tlbody');
    const where = () => P.pick('#replay-points').querySelector('.viewer-where').textContent;
    const strip = () => P.pick('#replay-rounds').querySelector('.scrub');
    ok(P.pick('#replay-run').hidden === false, 'a copy opened brings the transport up');
    ok(P.pick('#rounds-tools').hidden === false, 'and its rounds where a table\'s are');
    ok(P.pick('#tables-tools').hidden === true, 'the tables go: a copy is not a table to hop to');
    ok(P.pick('#scrub-tools').hidden === true,
       'and so does the strip that sends a table to a round');
    ok(P.pick('#shots-dev').hidden === true, 'nothing here invents anything');
    ok(P.pick('#run-tools').hidden === true, 'and a game already played is not stopped, it is stepped');
    ok(where() === 'Round 1 of 2 · 3 cards · Ann bids 1', 'a line says what is on the table');
    ok(run().querySelector('.viewer-at').textContent === '1 of 13',
       'and where in the game it is  got ' + run().querySelector('.viewer-at').textContent);
    ok(P.pick('#code').textContent === 'AAAA', 'the head names the table it is a copy of');

    /* The rounds go in the strip a scorecard uses: they are the same thing. */
    const marks = strip().querySelectorAll('.scell');
    ok(marks.length === 3, 'a mark a round, and the finish  got ' + marks.length);
    ok(marks[0].querySelector('small').textContent === '3 cards',
       'saying how big a hand it was, in words  got '
       + marks[0].querySelector('small').textContent);

    /* More rounds than fit is said by fading the side there is more on, not by
       a scrollbar across the band. Nothing is laid out in a fake page, so the
       strip is given a shape by hand. */
    const bar = strip();
    const shape = (wide, at) => {
      Object.defineProperty(bar, 'clientWidth', { value: 100, configurable: true });
      bar.scrollWidth = wide;
      bar.scrollLeft = at;
      bar.fire('scroll');
    };
    shape(100, 0);
    ok(!bar.classList.contains('more-l') && !bar.classList.contains('more-r'),
       'a strip that fits fades on neither side');
    shape(300, 0);
    ok(!bar.classList.contains('more-l') && bar.classList.contains('more-r'),
       'at the left end, only the side there is more on');
    shape(300, 100);
    ok(bar.classList.contains('more-l') && bar.classList.contains('more-r'),
       'part way along, both');
    shape(300, 200);
    ok(bar.classList.contains('more-l') && !bar.classList.contains('more-r'),
       'and at the right end, only the way back');

    /* And landing on a round at the edge of the strip brings the next couple
       into view: a cell hard against the edge says nothing about whether there
       is anything after it. Laid out by hand, there being no layout here. */
    const off = (k, v) => Object.defineProperty(P.dom.El.prototype, k,
                                                { value: v, configurable: true });
    off('offsetLeft', 700);
    off('offsetWidth', 60);
    Object.defineProperty(bar, 'clientWidth', { value: 400, configurable: true });
    bar.scrollWidth = 900;
    bar.scrollLeft = 0;
    say({ at: 8 });
    ok(bar.scrollLeft === 480,
       'the strip moves on so two more cells stand past it  got ' + bar.scrollLeft);
    say({ at: 9 });
    ok(bar.scrollLeft === 480, 'and stays where it is once they do');
    delete P.dom.El.prototype.offsetLeft;
    delete P.dom.El.prototype.offsetWidth;
    ok(marks[0].classList.contains('on'), 'the round it is in is marked');
    ok(marks[1].classList.contains('bum'), 'and a hand thrown in is marked as its own go');
    P.socks[0].sent.length = 0;
    marks[1].fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"replay","do":"seek","at":6}',
       'pressing one takes the copy there  got ' + JSON.stringify(P.socks[0].sent[0]));

    /* The steps inside the round on show. Discrete, because a game is: each of
       these either happened or has not. */
    say({ at: 3 });
    const steps = tl().querySelectorAll('.tick');
    /* The round on show is its own points, and the first round takes the game
       starting with it: that point is the run-up to round one, not a timeline
       of its own with one mark on it. */
    ok(steps.length === 6, 'the round on show is its own points  got ' + steps.length);
    ok(steps[0].style.left === '0%' && steps[5].style.left === '100%',
       'laid along the rail, first to last  got ' + steps[0].style.left + '..' + steps[5].style.left);
    ok(steps[2].classList.contains('done'), 'the ones behind the head are done');
    ok(!steps[3].classList.contains('done'), 'and the one it stands on is not');
    ok(tl().querySelector('.fill').style.width === '60%',
       'the rail is filled to the head  got ' + tl().querySelector('.fill').style.width);
    ok(tl().querySelector('.head').style.left === '60%',
       'which is where the head is  got ' + tl().querySelector('.head').style.left);
    ok(tl().querySelector('.knob').textContent === '2',
       'and the head wears the point it is on  got ' + tl().querySelector('.knob').textContent);

    /* What a mark wears is what it is: a bid its number, a card itself, a
       trick opening a divider, and the beats that shape a round an icon. */
    ok(steps[3].querySelector('.face').textContent === '2', 'a bid wears the number said');
    ok(steps[4].classList.contains('bar'), 'a trick opening is a divider through the rail');
    ok(steps[5].classList.contains('wee'), 'a card is a dot');
    ok(steps[5].querySelector('.face').textContent === '9♠',
       'that carries the card itself  got ' + steps[5].querySelector('.face').textContent);
    ok(steps[1].querySelector('.face').textContent === '🃏',
       'and a round dealt wears an icon  got ' + steps[1].querySelector('.face').textContent);
    ok(steps[0].querySelector('.face').textContent === '🎬',
       'as does the game starting  got ' + steps[0].querySelector('.face').textContent);

    /* Passing over a mark says what happened there, over the mark itself. The
       line beside the rail stays on the point the copy is standing on. */
    ok(steps[3].title === 'Bob bids 2 — point 4 of 13',
       'a mark names its own point  got ' + steps[3].title);
    steps[4].fire('mouseenter');
    ok(tl().querySelector('.tip').textContent === 'a trick opens — point 5 of 13',
       'passing over one says what happened there  got '
       + (tl().querySelector('.tip') || {}).textContent);
    ok(tl().querySelector('.tip').style.left === '80%', 'over the mark it belongs to');
    ok(where() === 'Round 1 of 2 · 3 cards · Ann bids 1',
       'and the line beside it stays where the copy is  got ' + where());
    steps[4].fire('mouseleave');
    ok(!tl().querySelector('.tip'), 'leaving it takes the tip away');

    /* Half a tip hangs to the left of the mark it belongs to, so at the first
       point on the rail it hangs off the side of the screen. It slides back on
       once it is up, which is the only moment that can be worked out. */
    const rect = P.dom.El.prototype.getBoundingClientRect;
    P.dom.El.prototype.getBoundingClientRect =
      () => ({ left: -80, right: 80, width: 160, top: 0, bottom: 20, height: 20 });
    steps[0].fire('mouseenter');
    ok(tl().querySelector('.tip').style.marginLeft === '88px',
       'a tip against the edge of the screen slides back on  got '
       + tl().querySelector('.tip').style.marginLeft);
    steps[0].fire('mouseleave');
    P.dom.El.prototype.getBoundingClientRect = rect;

    P.socks[0].sent.length = 0;
    steps[5].fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"replay","do":"seek","at":5}',
       'and each of them is a place to go  got ' + JSON.stringify(P.socks[0].sent[0]));
    ok(P.pick('#replay-run').querySelectorAll('input').length === 0,
       'nothing here is a slider: nothing here is continuous');

    /* The rail is a picker: a press takes the head there and a drag moves it,
       and only letting go asks the copy to follow. Nothing is measured in a
       fake page, so the drag is walked by hand. */
    const body = tl();
    body.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 24,
                                          right: 100, bottom: 24 });
    P.socks[0].sent.length = 0;
    body.fire('pointerdown', { clientX: 0, pointerId: 1 });
    ok(body.querySelector('.head').style.left === '0%',
       'a press takes the head to where it landed  got ' + body.querySelector('.head').style.left);
    body.fire('pointermove', { clientX: 100, pointerId: 1 });
    ok(body.querySelector('.head').style.left === '100%', 'and a drag moves it along');
    ok(P.socks[0].sent.length === 0, 'with nothing asked of the copy while it is moving');
    body.fire('pointerup', { clientX: 100, pointerId: 1 });
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"replay","do":"seek","at":5}',
       'letting go takes the copy there  got ' + JSON.stringify(P.socks[0].sent[0]));

    P.socks[0].sent.length = 0;
    run().querySelector('.vw-fwd').fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"replay","do":"step","by":1}',
       'it can be walked a point at a time  got ' + JSON.stringify(P.socks[0].sent[0]));
    P.socks[0].sent.length = 0;
    run().querySelector('.vw-back').fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"replay","do":"step","by":-1}',
       'either way  got ' + JSON.stringify(P.socks[0].sent[0]));

    /* And a round at a time, outside those. Back part way through a round goes
       to the top of it first, the way a track does: the same press means "this
       one again" and "the one before", and which you meant is where you are.
       The marks here are the game start, a hand thrown in, and the finish. */
    const roundGoes = (from, btn, want, why) => {
      say({ at: from });
      P.socks[0].sent.length = 0;
      run().querySelector(btn === 'back' ? '.vw-prev' : '.vw-next').fire('click');
      ok(JSON.stringify(P.socks[0].sent[0])
         === `{"t":"replay","do":"seek","at":${want}}`,
         why + '  got ' + JSON.stringify(P.socks[0].sent[0]));
    };
    roundGoes(3, 'back', 0, 'part way through a round, back goes to the top of it');
    roundGoes(7, 'back', 6, 'wherever that round starts');
    roundGoes(6, 'back', 0, 'and at the top already, back goes to the round before');
    roundGoes(3, 'on', 6, 'on goes to the round after');
    roundGoes(7, 'on', 11, 'the finish being one of them');
    roundGoes(11, 'on', 12, 'and past the last round there is only the end');

    say({ at: 0 });
    ok(run().querySelector('.vw-prev').disabled === true,
       'at the first point there is no round behind it');
    ok(run().querySelector('.vw-next').disabled === false, 'but there is one in front');
    say({ at: 12 });
    ok(run().querySelector('.vw-next').disabled === true, 'and at the last there is none');
    say();

    // Playing it back: one button, saying what it will do.
    const play = run().querySelector('.vw-play');
    ok(play.textContent === '▶ Play', 'a stopped replay offers to play  got ' + play.textContent);
    P.socks[0].sent.length = 0;
    play.fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"replay","do":"play"}',
       'and asks for it  got ' + JSON.stringify(P.socks[0].sent[0]));
    /* A copy that has been changed is a table of its own, and Carry on is what
       starts it: the panes hold their seats and the bots take their turns.
       There is nothing to start on a copy that is still the game it is a copy
       of -- nothing is played at one of those. */
    /* On a fork there is one button still, and it means what it always meant:
       go forward from here. What is in front depends on where the head is --
       tape while there is tape, and at the end of a fork's own tape a game.
       Two buttons for that were two clocks wearing one face. */
    const forkBox = () => P.pick('#fork-run').querySelector('.viewer-fork');
    const word = () => forkBox().querySelector('.viewer-held').textContent;
    /* Which of the two timelines the copy is on is always up: it is the thing
       that says whether what you are about to change is the game that was
       played or a game of your own. It used to appear only once it was the
       second, so nothing said which until you were past the choice. */
    ok(forkBox().hidden === false && word() === 'original replay',
       'a copy says it is still the game that was played  got ' + word());
    ok(!run().querySelector('.vw-run'), 'and no second clock beside the transport');
    const forkBtn = () => forkBox().querySelector('.vw-fork');
    const resetBtn = () => forkBox().querySelector('.vw-reset');
    ok(forkBtn().disabled === false && resetBtn().disabled === true,
       'there is a way onto a timeline of its own, and nothing yet to put back');
    P.socks[0].sent.length = 0;
    forkBtn().fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"replay","do":"fork"}',
       'and branching is asked for by pressing it  got ' + JSON.stringify(P.socks[0].sent[0]));

    const held = (on) => JSON.parse(devState(false, { paused: on }));
    say({ forked: true, at: 12, n: 13, state: held(true) });
    ok(forkBox().hidden === false && word() === 'forked · paused',
       'a fork says so, and what its table is doing  got ' + word());
    ok(resetBtn().disabled === false, 'and now there is something to put back');
    ok(forkBtn().disabled === true,
       'with nothing in front of the head to branch away from');
    ok(/changed by hand · paused/.test(P.pick('#subtitle').textContent),
       'and the head says it too, where the eye already is  got '
       + P.pick('#subtitle').textContent);
    ok(play.textContent === '▶ Play', 'the one button offers to go forward');
    P.socks[0].sent.length = 0;
    play.fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"replay","do":"run","on":true}',
       'and at the end of the tape that is the game  got '
       + JSON.stringify(P.socks[0].sent[0]));
    say({ forked: true, at: 12, n: 13, state: held(false) });
    ok(play.textContent === '❚❚ Pause' && word() === 'forked · playing',
       'a running fork says so, and the same button stops it  got ' + play.textContent);
    P.socks[0].sent.length = 0;
    play.fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"replay","do":"run","on":false}',
       'which stops the table  got ' + JSON.stringify(P.socks[0].sent[0]));

    /* And the way back off a fork. Everything the copy became goes -- the
       change, and whatever was played on it -- so it is asked about first: it
       is the one thing on the band that pressing again does not undo. */
    say({ forked: true, at: 12, n: 13, state: held(true) });
    const reset = forkBox().querySelectorAll('button').find((b) => b.textContent === 'Reset');
    ok(!!reset, 'a fork offers the way back off it');
    P.socks[0].sent.length = 0;
    let put = 0;
    P.dom.window.confirm = () => { put += 1; return false; };   // the page has no dialog here
    reset.fire('click');
    ok(put === 1 && P.socks[0].sent.length === 0,
       'which asks first, and does nothing when the answer is no');
    P.dom.window.confirm = () => true;
    const said = P.socks[0].sent, mark = said.length;
    reset.fire('click');
    // The answer comes back in a microtask, and the word goes in the one after.
    Promise.resolve().then(() => Promise.resolve()).then(() => {
      const after = said.slice(mark).map((o) => JSON.stringify(o));
      ok(after.includes('{"t":"replay","do":"reset"}'),
         'and puts the copy back when it is yes  got ' + after.join(' '));
    });
    say();
    ok(word() === 'original replay' && resetBtn().disabled === true,
       'a copy that is the game again has nothing to put back  got ' + word());
    say({ forked: true, at: 12, n: 13, state: held(true) });

    /* Scrubbed back, there is tape in front of the head again, so going
       forward is playing it back -- the game is where the tape ends. */
    say({ forked: true, at: 4, n: 13, state: held(true) });
    ok(forkBtn().disabled === false,
       'behind the end of a fork there is a tail to branch away from');
    P.socks[0].sent.length = 0;
    play.fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"replay","do":"play"}',
       'with tape in front of it, the same button plays the tape  got '
       + JSON.stringify(P.socks[0].sent[0]));
    say();

    say({ playing: true, at: 4 });
    ok(play.textContent === '❚❚ Pause', 'a playing one offers to stop');
    P.socks[0].sent.length = 0;
    play.fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"replay","do":"pause"}',
       'and the same button stops it  got ' + JSON.stringify(P.socks[0].sent[0]));
    say();

    /* How fast it plays itself. The table's own pace is one of the speeds, and
       the one it is set to is marked, so the row says where it is as well as
       where to send it. */
    const rates = run().querySelector('.vw-rate').querySelectorAll('.btn');
    ok(rates.length === 4, 'four speeds to play it back at  got ' + rates.length);
    ok(rates[1].classList.contains('on'),
       'the table\'s own pace to start with  got ' + rates.map((b) => b.className).join('|'));
    P.socks[0].sent.length = 0;
    rates[0].fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"replay","do":"rate","v":0.5}',
       'and picking one asks for it  got ' + JSON.stringify(P.socks[0].sent[0]));
    say({ rate: 0.5 });
    ok(rates[0].classList.contains('on') && !rates[1].classList.contains('on'),
       'the one it is playing at is the one marked');
    say();

    /* The two forcing panels write to the copy as they write to a table. What
       the trail says happened stops being what the copy is the moment it is
       changed, and the server says so: the change becomes the copy's last
       point and the rest of the trail goes with it. */
    P.pick('#btn-tools').fire('click');          // shut
    P.pick('#btn-tools').fire('click');          // and open again, drawing them
    const rows = P.pick('#prows').querySelectorAll('.prow');
    ok(rows.length === 2, 'who was at the table  got ' + rows.length);
    ok(rows[0].querySelectorAll('input').every((el) => !el.disabled),
       'with every cell on the row to type into');
    ok(P.pick('#btn-state-apply').hidden !== true, 'and a record to apply to the copy');

    /* A photo is the one thing here that is a look and not a state. It is not
       in the record, so a copy takes one and stays the game it is a copy of --
       which is why it is offered on a copy at all. */
    P.socks[0].sent.length = 0;
    rows[0].querySelector('.pbtns').querySelectorAll('.btn')[0].fire('click');
    const shot = P.socks[0].sent.find((o) => o.action === 'avatar');
    ok(!!shot && shot.replay === true && shot.seat === 0 && /^data:image\//.test(shot.data),
       'a stand-in photo goes to the copy  got ' + JSON.stringify(shot));
    P.socks[0].sent.length = 0;
    rows[0].querySelector('.pbtns').querySelectorAll('.btn')[1].fire('click');
    ok((P.socks[0].sent.find((o) => o.action === 'avatar') || {}).data === null,
       'and taking it off goes the same way');

    // Everybody at once is the same verb, in the panel beside it.
    P.socks[0].sent.length = 0;
    P.pick('#phase-row').querySelector('.pphoto').querySelectorAll('.btn')[0].fire('click');
    ok(P.socks[0].sent.filter((o) => o.action === 'avatar' && o.replay).length === 2,
       'a photo on every seat is one message a seat  got '
       + JSON.stringify(P.socks[0].sent));
    P.socks[0].sent.length = 0;
    P.tab('state');
    ok(P.socks[0].sent.some((o) =>
         JSON.stringify(o) === '{"t":"dev","action":"state","replay":true}'),
       'the record read is the copy\'s  got ' + JSON.stringify(P.socks[0].sent));
    ok(P.pick('#players-panel').hidden === true && P.pick('#state-panel').hidden === false,
       'and the two tables take turns in the half rather than share it');
    P.tab('players');
    ok(P.pick('#players-panel').hidden === false && P.pick('#state-panel').hidden === true,
       'either way about');

    /* And a change made in the panel goes to the copy, not to a table: the
       page has no table when it is watching one. */
    P.socks[0].sent.length = 0;
    const bid = rows[0].querySelectorAll('input').find((el) => el.type === 'number');
    bid.value = '2';
    bid.fire('change');
    const wrote = P.socks[0].sent[0];
    ok(wrote && wrote.t === 'dev' && wrote.action === 'patch' && wrote.replay === true,
       'a bid typed over lands on the copy  got ' + JSON.stringify(wrote));

    // A copy that has been changed says so, rather than call itself the game.
    say({ forked: true, at: 2, n: 3 });
    ok(/changed by hand/.test(P.pick('#subtitle').textContent),
       'and the page stops calling it the game that was played  got '
       + P.pick('#subtitle').textContent);
    say();

    /* Every forcing control on a copy acts on the copy: the page has no table
       while it is watching one, so the flag goes on once rather than at each
       of the places a control sends. The cards a picker draws from are one of
       them -- a hand is a secret, so they never come in a state. */
    P.socks[0].sent.length = 0;
    P.pick('#prows').querySelectorAll('input').find((el) => el.type === 'number').fire('change');
    ok(P.socks[0].sent.length > 0 && P.socks[0].sent.every((o) => o.replay === true),
       'a copy takes every one of them  got ' + JSON.stringify(P.socks[0].sent));

    /* Each pane holds a socket on the copy, so a step reaches it on its own.
       Throwing them away at every press reloaded every frame -- and closed the
       copy's last window, which used to take the copy with it. */
    const pane = P.pick('#seat-frames').children[0];
    say({ at: 7 });
    ok(P.pick('#seat-frames').children[0] === pane,
       'moving about in a copy leaves its panes where they are');
    say({ code: 'YYYY' });
    ok(P.pick('#seat-frames').children[0] !== pane,
       'and only another copy is another set of panes');
    say();

    // The panes are the copy's while one is open, and ⌂ lets the copy go.
    ok(P.pick('#seat-frames').children.length === 2, 'the panes follow the copy');
    P.socks[0].sent.length = 0;
    ok(P.pick('#btn-ways').textContent === '⌂ Stop watching',
       'the one way back says what it does here  got ' + P.pick('#btn-ways').textContent);
    P.pick('#btn-ways').fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"replay","do":"close"}',
       'and lets the copy go  got ' + JSON.stringify(P.socks[0].sent[0]));
    ok(JSON.stringify(P.socks[0].sent[1]) === '{"t":"dev","action":"ways"}',
       'and asks what to do next  got ' + JSON.stringify(P.socks[0].sent[1]));
    ok(P.pick('#ways').hidden === false, 'which is the way in again');
  }

  {   /* ---- stopping the table, and walking it on ----
         Stopping is any table with a hand out. Stepping is the other half:
         a move out of a hand nobody is behind, and a dev server's alone. */
    const bots = { cfg: { max: 3, pattern: 'down', ones: 2, deck: 'virtual' },
                   seats: [{ id: 's1', name: 'Ann' }, { id: 's2', name: 'Otter', bot: true }] };
    const P = devPage(false, [{ id: 's1', name: 'Ann', watch: 'w1' }]);

    P.socks[0].onmessage({ data: devState(false) });
    ok(P.pick('#run-tools').hidden === false,
       'a table of people playing real cards can be stopped like any other');
    ok(P.pick('#btn-step').hidden === true,
       'but it has no hand of its own, so there is no move of one to take');

    P.socks[0].onmessage({ data: devState(false, bots) });
    ok(P.pick('#run-tools').hidden === false, 'a table with a bot in it too');
    ok(P.pick('#btn-pause').textContent === '❚❚ Pause', 'and it offers to stop it');
    ok(P.pick('#btn-step').hidden === true,
       'but a normal server will not step one, so it is not offered');

    P.socks[0].sent.length = 0;
    P.pick('#btn-pause').fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"pause","on":true}',
       'and says so as the table\'s own message, not a dev one  got '
       + JSON.stringify(P.socks[0].sent[0]));

    P.socks[0].onmessage({ data: devState(false, Object.assign({ paused: true }, bots)) });
    ok(P.pick('#btn-pause').textContent === '▶ Play', 'a stopped table offers to go on');
    P.socks[0].sent.length = 0;
    P.pick('#btn-pause').fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"pause","on":false}',
       'and the same button lets it go  got ' + JSON.stringify(P.socks[0].sent[0]));

    // Once the game is over there is nothing playing to stop.
    P.socks[0].onmessage({ data: devState(false, Object.assign({ phase: 'done' }, bots)) });
    ok(P.pick('#run-tools').hidden === true, 'a game that has ended has nothing to stop');
  }

  {   // a table of stand-ins on a dev server: everything, as before
    const P = devPage(true, [{ id: 's1', name: 'Ann', token: 't1' },
                             { id: 's2', name: 'Bob', token: 't2' }]);
    P.socks[0].onmessage({ data: devState(true) });

    ok(P.pick('#tables-tools').hidden === false, 'a dev server shows the tables it will hand over');
    ok(P.pick('#scrub-tools').hidden === false, 'and the scrubber');
    ok(P.pick('#shots-dev').hidden === false, 'and the one-shots');
    ok(P.pick('#phase-row').querySelector('.pphase').querySelector('.seg')
         .querySelectorAll('.btn').length === 4,
       'and the panel still carries the phase, which unsticks a flow either way');
    ok(P.pick('#scrub').children.length === 4, 'the card is the lobby, both rounds and the finish  got '
       + P.pick('#scrub').children.length);
    ok(P.pick('#ph-photo').textContent === 'photo', 'and the photo column is offered');

    // And on a dev server a stopped table can be walked on a move at a time.
    P.socks[0].onmessage({ data: devState(true, {
      paused: true, cfg: { max: 3, pattern: 'down', ones: 2, deck: 'virtual' },
      seats: [{ id: 's1', name: 'Ann' }, { id: 's2', name: 'Otter', bot: true }],
    }) });
    ok(P.pick('#btn-step').hidden === false, 'a dev server offers the step');
    ok(P.pick('#btn-step').disabled === false, 'and it is live on a stopped table');
    P.socks[0].sent.length = 0;
    P.pick('#btn-step').fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"dev","action":"step"}',
       'which asks the table for one move  got ' + JSON.stringify(P.socks[0].sent[0]));

    /* ---- the hand a seat holds ----
       A deck is fifty-two cards and no card is in two places, so the picker is
       the deck itself: this seat's cards marked, another seat's shut with a
       line saying whose, and the rest there to be taken. */
    /* A hand is a secret: the state a screen is sent carries how many cards a
       seat holds and never which, so the picker asks for them by a door of
       their own and draws nothing until they come. */
    P.socks[0].onmessage({ data: devState(true, {
      phase: 'tricks', cfg: { max: 3, pattern: 'down', ones: 2, deck: 'virtual' },
      seats: [{ id: 's1', name: 'Ann' }, { id: 's2', name: 'Bob' }],
      play: { turn: 0, trick: [], counts: [2, 2] },
    }) });
    const tools0 = () => P.pick('#prows').querySelectorAll('.ptools')[0];
    const word = (w) => tools0().querySelectorAll('button').find((b) => b.textContent === w);
    ok(/2 cards/.test(P.pick('#prows').querySelectorAll('.prow')[0]
         .querySelector('.pstate').textContent),
       'the row says how many a seat holds  got '
       + P.pick('#prows').querySelectorAll('.prow')[0].querySelector('.pstate').textContent);
    const openIt = word('Hand \u25be');
    ok(!!openIt, 'and offers the cards themselves');
    ok(!P.pick('#prows').querySelector('.phand'), 'shut until it is asked for');
    P.socks[0].sent.length = 0;
    openIt.fire('click');
    ok(P.socks[0].sent.some((o) => o.action === 'hands'),
       'opening it asks the table for the cards  got ' + JSON.stringify(P.socks[0].sent));
    ok(!P.pick('#prows').querySelector('.phand'),
       'and draws nothing until they come: the state never carried them');
    P.socks[0].onmessage({ data: JSON.stringify({ t: 'handsRaw',
      hands: [['AS', 'KH'], ['2C', 'QD']] }) });
    const pick2 = P.pick('#prows').querySelector('.phand');
    ok(!!pick2, 'the picker opens on the cards that came back');
    ok(pick2.querySelectorAll('.phand-row').length === 4, 'a line a suit  got '
       + pick2.querySelectorAll('.phand-row').length);
    const cards = pick2.querySelectorAll('.btn.card');
    ok(cards.length === 52, 'and the whole deck to choose from  got ' + cards.length);
    ok(cards.filter((b) => b.classList.contains('primary')).length === 2,
       'with the two this seat holds marked  got '
       + cards.filter((b) => b.classList.contains('primary')).length);
    ok(cards.filter((b) => b.disabled).length === 2,
       'and the two another seat holds shut  got ' + cards.filter((b) => b.disabled).length);

    /* Moving a card changes two hands, so every hand goes. This one is free,
       so it lands on Ann and Bob keeps what Bob had. */
    P.socks[0].sent.length = 0;
    const free = cards.find((b) => !b.disabled && !b.classList.contains('primary'));
    free.fire('click');
    const laid = P.socks[0].sent[0];
    ok(laid && laid.action === 'patch' && Array.isArray(laid.patch.hands)
       && laid.patch.hands.length === 2 && laid.patch.hands[0].length === 3
       && JSON.stringify(laid.patch.hands[1]) === '["2C","QD"]',
       'every hand goes, and only this one changed  got ' + JSON.stringify(laid));

    /* A round of three is three cards a hand. The table holds a dealt hand to
       the round's own size, so a card offered here that the table would drop
       is a control that lies: once the hand is full the rest are shut, and the
       picker says why rather than leaving a grid of dead buttons. */
    const grid = () => P.pick('#prows').querySelector('.phand');
    const cardsIn = () => grid().querySelectorAll('.btn.card');
    ok(grid().querySelector('.phand-said').textContent === '2 of 3 cards',
       'the picker says how many of the round it holds  got '
       + grid().querySelector('.phand-said').textContent);
    ok(cardsIn().filter((b) => b.disabled).length === 2,
       'and only the two another seat holds are shut  got '
       + cardsIn().filter((b) => b.disabled).length);
    P.socks[0].onmessage({ data: JSON.stringify({ t: 'handsRaw',
      hands: [['AS', 'KH', '3S'], ['2C', 'QD']] }) });
    ok(/3 of 3 cards/.test(grid().querySelector('.phand-said').textContent)
       && /no more/.test(grid().querySelector('.phand-said').textContent),
       'a full hand says the round holds no more  got '
       + grid().querySelector('.phand-said').textContent);
    ok(cardsIn().filter((b) => !b.disabled).length === 3,
       'and only the three it holds can still be pressed, to take one off  got '
       + cardsIn().filter((b) => !b.disabled).length);
    ok(cardsIn().filter((b) => !b.disabled).every((b) => b.classList.contains('primary')),
       'which are its own');
    P.socks[0].onmessage({ data: JSON.stringify({ t: 'handsRaw',
      hands: [['AS', 'KH'], ['2C', 'QD']] }) });

    // Only one picker at a time: fifty-two buttons a seat is four hundred.
    P.pick('#prows').querySelectorAll('.ptools')[1]
      .querySelectorAll('button').find((b) => b.textContent === 'Hand \u25be').fire('click');
    ok(P.pick('#prows').querySelectorAll('.phand').length === 1,
       'one hand is open at a time  got ' + P.pick('#prows').querySelectorAll('.phand').length);

    /* The table moving under an open picker asks again: what it draws has to
       be the hand now, not the hand the picker opened on. */
    P.socks[0].sent.length = 0;
    P.socks[0].onmessage({ data: devState(true, {
      phase: 'tricks', cfg: { max: 3, pattern: 'down', ones: 2, deck: 'virtual' },
      seats: [{ id: 's1', name: 'Ann' }, { id: 's2', name: 'Bob' }],
      play: { turn: 1, trick: [], counts: [1, 2] },
    }) });
    ok(P.socks[0].sent.some((o) => o.action === 'hands'),
       'the table moving asks for the cards again  got ' + JSON.stringify(P.socks[0].sent));

    /* A card pressed keeps the focus, and the press is over the moment it
       fires. The panel used to refuse to rebuild while anything in it had the
       focus at all, so a card given to a seat did not appear until you clicked
       away -- it read as the table ignoring you. A word half typed is the one
       thing worth holding off for. */
    const dealt = (h) => JSON.stringify({ t: 'handsRaw', hands: h });
    const shown = () => P.pick('#prows').querySelector('.phand')
      .querySelectorAll('.btn.card').filter((b) => b.classList.contains('primary')).length;
    P.pick('#prows').querySelectorAll('.ptools')[0]
      .querySelectorAll('button').find((b) => b.textContent === 'Hand \u25be').fire('click');
    P.socks[0].onmessage({ data: dealt([['AS', 'KH'], ['2C', 'QD']]) });
    ok(shown() === 2, 'two cards to start  got ' + shown());
    const card = P.pick('#prows').querySelector('.phand')
      .querySelectorAll('.btn.card').find((b) => !b.disabled && !b.classList.contains('primary'));
    P.dom.document.activeElement = card;             // as a browser leaves it
    card.fire('click');
    P.socks[0].onmessage({ data: dealt([['AS', 'KH', '3S'], ['2C', 'QD']]) });
    ok(shown() === 3, 'the card lands while the button that dealt it still has the focus  got '
       + shown());

    // But a word being typed is not thrown away under whoever is typing it.
    const bid = P.pick('#prows').querySelectorAll('.prow')[0]
      .querySelectorAll('input').find((el) => el.type === 'number');
    P.dom.document.activeElement = bid;
    P.socks[0].onmessage({ data: dealt([['AS'], ['2C', 'QD']]) });
    ok(shown() === 3, 'a row is not rebuilt under a half-typed number  got ' + shown());
    P.dom.document.activeElement = null;
    P.socks[0].onmessage({ data: dealt([['AS'], ['2C', 'QD']]) });
    ok(shown() === 1, 'and it lands as soon as the typing is done  got ' + shown());

    // With real cards the hand is on the table, and nothing here knows it.
    P.socks[0].onmessage({ data: devState(true, { phase: 'tricks' }) });
    ok(!tools0().querySelectorAll('button').find((b) => /^Hand/.test(b.textContent)),
       'and with real cards there is no hand here to deal');
  }
}

/* ---- the pad that unsticks the table ----

   Scenario 3 on the player page: a phone has gone quiet at the bidding, so
   nobody may bid and the table stops. What the table host sees, and what the
   tap actually puts on the wire. And scenario 5: leaving on purpose. */
part('bidding for a seat that is not there, and leaving');
{
  const anything = new Proxy(function () {}, {
    get: (t, k) => (k === 'then' ? undefined
                  : k === Symbol.toPrimitive ? (() => '')
                  : k === 'toString' ? (() => '') : anything),
    apply: () => anything, construct: () => anything,
  });
  const said = [];
  const fx = {
    toast: (t, o) => said.push(t + ((o && o.note) ? ' · ' + o.note : '')),
    pop() {}, ring() {}, rise() {}, count() {}, barsBefore: () => ({}), scores: () => ({}),
    flip: (box, f) => { if (f) f(); }, on: () => false,
  };
  // ask() answers yes, and answers it now, so the tap can be followed
  const asked = [];
  // and tell() is tapped away at once, the way a player taps it
  const telling = [];
  // The speed the table says it is going at, as each screen is told it.
  const played = [];
  const uiReal = { fx, ask: (t, b, l) => { asked.push({ t, b, l }); return { then: (f) => f(true) }; },
                   tell: (t, b, l) => { telling.push({ t, b, l }); return { then: (f) => f() }; },
                   keepAwake: () => ({ then: () => {} }),
                   setPlayed: (v) => { played.push(v); },
                   // a real list, so a page can add its own rows to it
                   commonSettings: () => [] };
  const UI = new Proxy(uiReal, { get: (t, k) => (k in t ? t[k] : anything) });
  /* The same stand-in, for one page, answering where that page is read: yes to
     everything would have every screen believe it was the machine serving it,
     and offer what only that machine may do. */
  const uiFor = (loc, doFetch) => new Proxy(
    Object.assign({
      servedHere: () => /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(loc.hostname || ''),
      /* The real one asks, then puts the table off the server. The stand-in ask
         answers yes at once, as it does everywhere here, so what is left to
         prove is that the page reaches the server and does what it does next.
         The fetch is the page's own, which is what the checks read. */
      endTable: (code, before) => {
        asked.push({ t: `End table ${code}?`, b: '', l: 'End the table' });
        if (before) before();
        if (doFetch) doFetch('/table/end?c=' + encodeURIComponent(code), { method: 'POST' });
        return { then: (f) => f(true) };
      },
    }, uiReal),
    { get: (t, k) => (k in t ? t[k] : anything) });

  function playPage(seed, search, o) {
    o = o || {};
    const dom = makeDom(412, 860);
    Object.keys(seed || {}).forEach((k) => dom.localStorage.setItem(k, seed[k]));
    const els = {};
    /* An id that names a button is a button, as it is on the page: a widget
       handed one draws into it, and handed anything else builds one inside. */
    const pick = (sel) => (els[sel] || (els[sel] = new dom.El(/^#btn-/.test(sel) ? 'button' : 'div')));
    dom.document.querySelector = pick;
    dom.document.getElementById = (id) => pick('#' + id);
    const gone = [];
    const location = { protocol: 'http:', host: 'table', hostname: 'table', pathname: '/play.html',
                       search: search || '', hash: '',
                       get href() { return this._h; }, set href(v) { this._h = v; gone.push(v); } };
    const history = { replaceState: (a, b, u) => { history.url = u; } };
    dom.window.location = location;              // as in a browser: one address, two names
    const socks = [];
    function WebSocket(url) { this.readyState = 1; this.sent = []; socks.push(this); }
    WebSocket.prototype.send = function (raw) { this.sent.push(JSON.parse(raw)); };
    WebSocket.prototype.close = function () { this.readyState = 3; };
    const Table = new Function('UI', 'Game', 'document',
      fs.readFileSync(path.join(ROOT, 'public/table.js'), 'utf8') + '\n; return Table;')(UI, Game, dom.document);
    const src = ['public/lobby.js', 'public/round.js'].concat(o.real || []).concat(['public/net.js', 'public/play.js'])
      .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
    const stubs = ['Settings', 'Scan', 'Avatar', 'Chat', 'Deal', 'Games', 'Finale', 'Stage', 'Felt']
      .filter((n) => !(o.real || []).some((f) => f.toLowerCase().indexOf(n.toLowerCase() + '.js') >= 0));
    const given = Object.assign({ Avatar: { saved: () => null, remember() {}, url: () => null,
      picker: () => ({ el: new dom.El('div'), show() {}, say() {} }) } }, o.given || {});
    const fn = new Function('window', 'document', 'localStorage', 'location', 'history', 'WebSocket',
      'Game', 'UI', 'Table', 'Accolades', 'console', ...stubs, src + '\n; return { Net };');
    const out = fn(dom.window, dom.document, dom.localStorage, location, history, WebSocket, Game, UI, Table,
      Accolades, { log() {}, info() {}, warn() {}, error() {} },
      ...stubs.map((n) => (n in given ? given[n] : anything)));
    dom.document.fire('DOMContentLoaded');
    if (socks[0]) {
      socks[0].onopen();
      socks[0].onmessage({ data: JSON.stringify({ t: 'hello', role: 'player', code: 'TEST', seatId: 's0' }) });
    }
    return Object.assign(out, { dom, pick, gone, socks, said,
      feed: (st) => { try { socks[0].onmessage({ data: JSON.stringify(st) }); }
                      catch (e) { console.log('  (the page threw: ' + e.message + ')'); throw e; } } });
  }

  /* The TV screen on the same footing: the page as it comes, the widgets it
     draws, and a socket that hands it a hello and a state. `role` is what the
     screen is to the table: 'host' runs it, 'screen' only shows it. */
  function hostPage(role, o) {
    o = o || {};
    const dom = makeDom(1280, 720);
    dom.localStorage.setItem('rcs:tables:v1',
      JSON.stringify([{ code: 'TEST', token: role === 'host' ? 'th' : null, role }]));
    const els = {};
    const pick = (sel) => (els[sel] || (els[sel] = new dom.El(/^#btn-/.test(sel) ? 'button' : 'div')));
    dom.document.querySelector = pick;
    dom.document.getElementById = (id) => pick('#' + id);
    const gone = [];
    const location = { protocol: 'http:', host: 'table', hostname: o.hostname || 'table',
                       pathname: '/host.html', search: '?c=TEST', hash: '',
                       get href() { return this._h; }, set href(v) { this._h = v; gone.push(v); } };
    const history = { replaceState() {} };
    dom.window.location = location;              // as in a browser: one address, two names
    const socks = [];
    function WebSocket(url) { this.readyState = 1; this.sent = []; socks.push(this); }
    WebSocket.prototype.send = function (raw) { this.sent.push(JSON.parse(raw)); };
    WebSocket.prototype.close = function () { this.readyState = 3; };
    const Table = new Function('UI', 'Game', 'document',
      fs.readFileSync(path.join(ROOT, 'public/table.js'), 'utf8') + '\n; return Table;')(UI, Game, dom.document);
    const src = ['public/lobby.js', 'public/round.js', 'public/net.js', 'public/host.js']
      .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
    const stubs = ['Settings', 'Avatar', 'Chat', 'Deal', 'Games', 'Accolades', 'Finale', 'Stage'];
    const given = o.given || {};
    const asked = [];
    const fetch = (u, opt) => { asked.push({ u, method: (opt || {}).method || 'GET' }); return Promise.resolve({ ok: true }); };
    const fn = new Function('window', 'document', 'localStorage', 'location', 'history', 'WebSocket',
      'Game', 'UI', 'Table', 'console', 'fetch', ...stubs, src + '\n; return { Net };');
    const out = fn(dom.window, dom.document, dom.localStorage, location, history, WebSocket, Game,
      uiFor(location, fetch), Table, { log() {}, info() {}, warn() {}, error() {} }, fetch,
      ...stubs.map((n) => (n in given ? given[n] : anything)));
    dom.document.fire('DOMContentLoaded');
    socks[0].onopen();
    socks[0].onmessage({ data: JSON.stringify({ t: 'hello', role, code: 'TEST', token: role === 'host' ? 'th' : null }) });
    return Object.assign(out, { dom, pick, socks, said, gone, asked,
      feed: (st) => { try { socks[0].onmessage({ data: JSON.stringify(st) }); }
                      catch (e) { console.log('  (the screen threw: ' + e.message + ')'); throw e; } } });
  }

  const seed = { 'rcs:tables:v1': JSON.stringify([{ code: 'TEST', token: 't0', role: 'player', seatId: 's0' }]) };
  // three seats, two cards each, bidding, and the third seat is on turn
  const table = (o) => {
    const { ST } = stateFor(3, 2, 0, { phase: 'bid', turn: 2, bids: [null, 1, null] });   // Ben bid, Cal to bid
    ST.t = 'state';                       // it arrives the way the server sends it
    ST.captainId = o.boss === false ? 's1' : 's0';
    ST.seats[2].online = o.away === false;
    if (o.left) ST.seats[2].left = true;
    ST.seats.forEach((x, i) => { x.name = ['Ann', 'Ben', 'Cal'][i]; });
    if (o.phase) ST.phase = o.phase;
    return ST;
  };

  {   /* A screen on a copy draws at the speed the copy is being played back at.
         The table is what says so: nothing on a screen knows what a replay is,
         and a real table says nothing and is drawn at the speed it is. */
    const P = hostPage('host');
    played.length = 0;
    P.feed(table({}));
    ok(played[played.length - 1] === 1,
       'a real table is drawn at the speed it is  got ' + played[played.length - 1]);
    played.length = 0;
    P.feed(Object.assign(table({}), { rate: 0.5 }));
    ok(played[played.length - 1] === 0.5,
       'a copy played back at half speed is drawn at half speed  got '
       + played[played.length - 1]);

    const Q = playPage(seed, '?c=TEST');
    played.length = 0;
    Q.feed(Object.assign(table({}), { rate: 2 }));
    ok(played[played.length - 1] === 2,
       'and the phones on it draw at it too  got ' + played[played.length - 1]);
  }

  {   /* The TV screen holds the deal scene up while the bids come in, and keeps
         it current through one call. Who dealt is part of what it keeps: with
         real cards a person dealt, and the table host can say it was somebody
         else while the scene is still up. Every other screen reads the dealer
         off the state on every render, so only the held scene was left ringing
         the seat that had stopped being the dealer. */
    const pushed = [];
    const Deal = { play: () => Promise.resolve(), close() {}, isOpen: () => true,
                   finale: () => Promise.resolve(), update: (o) => pushed.push(o) };
    const H = hostPage('host', { given: { Deal } });
    const st = table({});
    H.feed(st);
    const last = () => pushed[pushed.length - 1] || {};
    ok(last().dealer === st.rounds[0].dealer,
       'the scene is told who deals  got ' + last().dealer);
    const moved = table({});
    moved.rounds[0].dealer = (st.rounds[0].dealer + 1) % 3;
    H.feed(moved);
    ok(last().dealer === moved.rounds[0].dealer,
       'and told again when it changes under it  got ' + last().dealer);
  }

  {   // the table host sees the pad
    const P = playPage(seed, '?c=TEST');
    said.length = 0;
    P.feed(table({}));
    ok(P.pick('#bidfor-pad').hidden === false, 'the host is offered the bid for a seat that is away');
    ok(P.pick('#bidfor-pad').querySelector('.btn').textContent === 'Bid for Cal',
       'named, so nobody bids for the wrong seat  got ' + P.pick('#bidfor-pad').querySelector('.btn').textContent);
    ok(P.pick('#bidfor-pad').querySelector('.chips').children.length === 3,
       'with a number for every trick in the hand  got ' + P.pick('#bidfor-pad').querySelector('.chips').children.length);
    ok(/not at the table/.test(P.pick('#bidfor-pad').querySelector('.hint').textContent),
       'and says why it is there  got ' + P.pick('#bidfor-pad').querySelector('.hint').textContent);
    // the felt is the game on this table, so the page keeps no turn panel
    ok(P.pick('#turn-panel').hidden === true, 'the scorecard page keeps no turn panel');
    ok(P.pick('#attn-panel').hidden === false, 'the pad has a panel of its own');

    P.socks[0].sent.length = 0;
    P.pick('#bidfor-pad').querySelector('.btn').fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"bidfor"}',
       'the button asks the table to read that hand  got ' + JSON.stringify(P.socks[0].sent[0]));

    P.socks[0].sent.length = 0;
    P.pick('#bidfor-pad').querySelector('.chips').children[2].fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"bidfor","v":2}',
       'and a number sends that number  got ' + JSON.stringify(P.socks[0].sent[0]));
  }

  {   // and nobody else does
    const P = playPage(seed, '?c=TEST');
    P.feed(table({ boss: false }));
    ok(P.pick('#bidfor-pad').hidden === true, 'a player who does not run the table is not offered it');
  }

  {   /* The phone's own bid pad, on a table with real cards. A stopped table
         takes no bid, so it is not offered one -- and a bid the table would
         not take leaves the pad usable, because a refusal is an answer and the
         pad dims its chips as it sends. Both together were the bug: the pad
         went dead on the refusal and stayed dead. */
    const mine = () => {
      const st = table({ away: false });
      st.cfg.deck = 'physical';
      st.turn = 0;                            // this phone's seat, and its bid
      st.rounds[0].bids = [null, null, null];
      return st;
    };
    const P = playPage(seed, '?c=TEST');
    P.feed(mine());
    ok(P.pick('#bid-pad').hidden === false, 'a phone on turn is offered the numbers');
    const chips = () => P.pick('#bid-chips').querySelectorAll('.chip');
    ok(chips().length === 3, 'one a trick in the hand  got ' + chips().length);

    P.socks[0].sent.length = 0;
    chips()[1].fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"bid","v":1}',
       'a tap bids it  got ' + JSON.stringify(P.socks[0].sent[0]));
    ok(chips().every((c) => c.disabled), 'and the pad waits for the answer');
    P.socks[0].onmessage({ data: JSON.stringify({ t: 'error', msg: 'the table is stopped' }) });
    ok(chips().some((c) => !c.disabled),
       'a refusal is an answer, and the pad can be used again');

    const held = mine(); held.paused = true;
    P.feed(held);
    ok(P.pick('#bid-pad').hidden === true, 'a paused table is offered no bid at all');
    ok(/paused/.test(P.pick('#bid-hint').textContent),
       'and says why, where the numbers were  got ' + P.pick('#bid-hint').textContent);
    P.feed(mine());
    ok(P.pick('#bid-pad').hidden === false, 'which comes back when the table is let go');
  }

  {   /* A paused table is paused for the seat it is holding too. Whoever runs
         it paused it on purpose; the way on is to start it again, not to bid
         past it and be refused. */
    const P = playPage(seed, '?c=TEST');
    P.feed(Object.assign(table({}), { paused: true }));
    ok(P.pick('#bidfor-pad').hidden === true, 'nor is it offered while the table is paused');
    P.feed(table({}));
    ok(P.pick('#bidfor-pad').hidden === false, 'and it comes back when the table is let go');
  }

  {   // nor when the seat is there
    const P = playPage(seed, '?c=TEST');
    P.feed(table({ away: false }));
    ok(P.pick('#bidfor-pad').hidden === true, 'and not while that phone is at the table');
    ok(P.pick('#attn-panel').hidden === true,
       'with nothing to decide, the panel is not there at all');
  }

  {   // the scorecard page, on a table the felt plays
    const P = playPage(seed, '?c=TEST');
    P.feed(table({ away: false }));
    ok(P.pick('#turn-panel').hidden === true, 'no turn panel: the felt asks for the bid');
    ok(P.pick('#bids-panel').hidden === false, 'the bids stay on the page under the felt');
    ok(P.pick('#bidstrip').children.length === 3, 'one pill a seat  got ' + P.pick('#bidstrip').children.length);
    // the bum deal is not the turn panel's, so it stays when the panel goes
    ok(P.pick('#bum-row').hidden === false, 'a bum deal can still be asked for on the page');
    ok(P.pick('#btn-bum').textContent === 'Bum deal',
       'and the table host throws it in  got ' + P.pick('#btn-bum').textContent);
    const other = table({ away: false, boss: false }); other.rounds[0].dealer = 1;   // neither host nor dealer
    P.feed(other);
    ok(P.pick('#btn-bum').textContent === 'Ask for a bum deal',
       'while anybody else asks  got ' + P.pick('#btn-bum').textContent);
    ok(P.pick('#leave-row').hidden === false, 'leaving is at the top of the page');
    ok(P.pick('#scorecard').hidden !== true, 'and the scorecard is drawn on a plain panel, never folded away');
  }

  {   // the rules form is built from one list, and a change goes back as one rule
    const P = playPage(seed, '?c=TEST');
    const st = table({ phase: 'lobby' }); st.cfg.max = 5;
    P.feed(st);
    const form = P.pick('#rules-form');
    const max = form.querySelector('#cfg-max');
    ok(max && max.value === '5', 'the form is built on the page and filled from the rules  got ' + (max && max.value));
    const miss = form.querySelector('#cfg-miss');
    ok(miss && miss.children.length === 5, 'with every choice of a rule  got ' + (miss && miss.children.length));
    ok(form.querySelector('#cfg-trump-row') && form.querySelector('#cfg-trump-row').hidden === false,
       'and the trump switch, since this table deals the cards');
    /* The order is what a table sets first: the cards before anything, then
       the shape of the game, what a bid pays, the variants, and last the
       prizes, which change no play at all. Each kind in a group of its own. */
    const groups = form.children.filter((g) => g.classList.contains('rules-group'));
    ok(groups.length === 5, 'the rules stand in groups, not one long form  got ' + groups.length);
    ok(!!groups[0].querySelector('#cfg-deck'), 'what the cards are comes first');

    /* And it is not a list to pick from. What kind of cards are on the table
       decides what everybody will be doing for the whole game, so both answers
       stand on the page at once: two regions side by side, each an outline
       with the mark of the mode at its left and what the mode means beside
       it. There is no line under the rule saying the same thing twice. */
    const deck = form.querySelector('#cfg-deck');
    ok(deck.classList.contains('modepick') && deck.tagName !== 'SELECT',
       'the cards are chosen as regions, not from a list  got ' + deck.tagName);
    const modes = deck.querySelectorAll('.mode');
    ok(modes.length === 2, 'one region a mode, and there are two  got ' + modes.length);
    ok(modes.every((m) => !!m.querySelector('.mode-icon') && !!m.querySelector('b')
                       && !!m.querySelector('small')),
       'each carries its mark, its name and what it means');
    ok(modes.every((m) => (m.querySelector('input') || {}).type === 'radio'),
       'with a radio inside, for a keyboard and a reader');
    ok(!form.querySelector('#cfg-deck-hint'),
       'and nothing under it repeating what the regions already say');
    // The one in force wears the outline: this table deals on the phones.
    ok(deck.querySelector('#cfg-deck-virtual').checked
       && deck.querySelector('#cfg-deck-virtual').parentNode.classList.contains('on'),
       'the mode in force wears the outline');
    ok(!deck.querySelector('#cfg-deck-physical').parentNode.classList.contains('on'),
       'and the other does not');
    P.socks[0].sent.length = 0;
    deck.querySelector('#cfg-deck-physical').fire('change');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"config","patch":{"deck":"physical"}}',
       'pressing a region sends that one rule  got ' + JSON.stringify(P.socks[0].sent[0]));
    const real = table({ phase: 'lobby' });
    real.cfg.deck = 'physical';
    P.feed(real);
    ok(deck.querySelector('#cfg-deck-physical').parentNode.classList.contains('on')
       && !deck.querySelector('#cfg-deck-virtual').parentNode.classList.contains('on'),
       'and the outline moves with the table');

    /* A bot has nothing to hold at a table with real cards. The table refuses
       the switch back while one is seated, so the region is shut rather than
       offered and refused: it says why instead of how, and cannot be pressed.
       Asking for a bot put the deck on the phones in the first place, which is
       the table's doing and reaches the screen as any other change does. */
    const withBot = table({ phase: 'lobby' });
    withBot.seats[2].bot = true;
    P.feed(withBot);
    const real2 = deck.querySelector('#cfg-deck-physical');
    ok(real2.parentNode.classList.contains('shut'),
       'a bot at the table shuts the real cards');
    ok(real2.disabled === true, 'and it cannot be pressed');
    ok(/no cards to hold/.test(deck.querySelector('#cfg-deck-physical-says').textContent),
       'the region says why, not how  got '
       + deck.querySelector('#cfg-deck-physical-says').textContent);
    ok(deck.querySelector('#cfg-deck-virtual').parentNode.classList.contains('on')
       && !deck.querySelector('#cfg-deck-virtual').parentNode.classList.contains('shut'),
       'and the choice sits on the virtual cards, which is where the table put it');
    P.feed(st);
    ok(!deck.querySelector('#cfg-deck-physical').parentNode.classList.contains('shut')
       && deck.querySelector('#cfg-deck-physical').disabled === false,
       'the bot goes and the real cards come back');
    ok(/You deal a real deck/.test(deck.querySelector('#cfg-deck-physical-says').textContent),
       'saying how again  got ' + deck.querySelector('#cfg-deck-physical-says').textContent);
    ok(!!groups[1].querySelector('#cfg-max') && !!groups[1].querySelector('#cfg-pattern'),
       'then the shape of the game');
    ok(!!groups[2].querySelector('#cfg-miss'), 'then what a bid pays');
    ok(!!groups[3].querySelector('#cfg-screw'), 'then the variants');
    ok(!!groups[4].querySelector('#cfg-accolade-count'), 'and the prizes last');
    ok(groups[4].children[0].id === 'cfg-accolade-which',
       'which accolades a table plays for heads that group  got ' + groups[4].children[0].id);
    ok(form.querySelector('#cfg-accolade-which').querySelector('.capset-name').textContent === 'Accolades',
       'under the name of the thing itself  got '
       + form.querySelector('#cfg-accolade-which').querySelector('.capset-name').textContent);

    /* Which accolades this table hands out: eleven switches, folded away
       because most tables never touch them, and every change sends the whole
       list of what is still ticked. */
    const which = form.querySelector('#cfg-accolade-which');
    ok(!!which && which.querySelectorAll('.switch').length === Accolades.ALL.length,
       'every accolade the game has can be turned off  got '
       + (which ? which.querySelectorAll('.switch').length : 'no list'));
    ok(which.querySelector('.capset-sum').textContent === '11 of 11',
       'a table that has not been asked hands out all of them  got ' + which.querySelector('.capset-sum').textContent);
    ok(which.querySelectorAll('input').every((i) => i.checked), 'with every one ticked');
    // the fake DOM matches one selector at a time, so this is asked in two
    const told = which.querySelectorAll('.switchrow').filter((r) => !!r.querySelector('small'));
    ok(told.length === Accolades.ALL.length,
       'and each says what it takes to be given it  got ' + told.length);
    ok(Accolades.ALL.every((a) => a.how && /\.$/.test(a.how)), 'every accolade has that line');
    P.socks[0].sent.length = 0;
    const off = which.querySelector('#acc-steady');
    off.checked = false;
    off.fire('change');
    const sent = P.socks[0].sent[0];
    ok(sent && sent.t === 'config' && sent.patch.accolades.length === Accolades.ALL.length - 1
       && sent.patch.accolades.indexOf('steady') < 0,
       'unticking one sends the rest  got ' + JSON.stringify(sent));
    const fewer = table({ phase: 'lobby' });
    fewer.cfg.accolades = ['tricks', 'best'];
    P.feed(fewer);
    ok(which.querySelector('.capset-sum').textContent === '2 of 11',
       'and the table says how many it hands out  got ' + which.querySelector('.capset-sum').textContent);
    ok(which.querySelector('#acc-tricks').checked && !which.querySelector('#acc-steady').checked,
       'with those two ticked and the rest not');
    const none = table({ phase: 'lobby' });
    none.cfg.accoladeCount = 0;
    P.feed(none);
    ok(which.hidden === true, 'a table that draws none is not asked which');
    P.socks[0].sent.length = 0;
    max.value = '6'; max.fire('change');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"config","patch":{"max":"6"}}',
       'a change goes to the table as that one rule  got ' + JSON.stringify(P.socks[0].sent[0]));
    P.feed(st);
    ok(form.querySelectorAll('#cfg-max').length === 1, 'and the next state fills the form it has, not a second one');
    P.feed(table({ phase: 'lobby', boss: false }));
    ok(max.disabled === true, 'a player who does not run the table reads the rules and cannot touch them');
    ok(deck.classList.contains('off')
       && deck.querySelectorAll('input').every((i) => i.disabled),
       'the regions with them: one that cannot be pressed should not look as though it can');
  }

  {   /* Folded away on a phone, the heading still says what the rules are, and
         it is opened for whoever runs the table: they came to set them. */
    const P = playPage(seed, '?c=TEST');
    const st = table({ phase: 'lobby' });
    st.cfg.max = 7; st.cfg.screw = true; st.cfg.deck = 'physical';
    P.feed(st);
    const rounds = Game.schedule(st.cfg.max, st.cfg.pattern, st.cfg.ones).length;
    ok(P.pick('#rules-sum').textContent === `${rounds} rounds · real cards · screw the dealer`,
       'shut, the rules say what they are  got ' + P.pick('#rules-sum').textContent);
    ok(P.pick('#rules-box').open === true, 'and they are open for whoever sets them');
    P.pick('#rules-box').open = false;                 // shut by hand
    P.feed(st);
    ok(P.pick('#rules-box').open === false, 'and stay shut once they have been shut');

    const Q = playPage(seed, '?c=TEST');
    const qst = table({ phase: 'lobby', boss: false });
    qst.cfg.deck = 'virtual'; qst.cfg.screw = false; qst.cfg.max = 7; qst.cfg.ones = 3;
    Q.feed(qst);
    ok(Q.pick('#rules-box').open === false, 'a player who is not setting them is not opened into a form');
    const qrounds = Game.schedule(qst.cfg.max, qst.cfg.pattern, qst.cfg.ones).length;
    ok(Q.pick('#rules-sum').textContent === `${qrounds} rounds · dealt on the phones`,
       'and reads them on the heading, with no rule that is off  got ' + Q.pick('#rules-sum').textContent);
  }

  {   /* The lobby is one thing, in the order it is done: the way in at the
         top, the seats, the rules, and the button that ends the waiting at the
         foot. Nothing of it is in a panel of its own any more. */
    const P = playPage(seed, '?c=TEST');
    const alone = table({ phase: 'lobby' });
    P.feed(alone);
    ok(P.pick('#cap-join').hidden === false && P.pick('#cap-tv').hidden === true,
       'with no TV screen the phone shows the code');
    ok(P.pick('#btn-start').hidden === false, 'and carries the start button itself');
    ok(P.pick('#bum-row').hidden === true, 'with no row of game controls: there is no game yet');
    ok(P.pick('#lobby-hint').hidden === true,
       'and says nothing to whoever runs it: the screen itself says what to do  got '
       + P.pick('#lobby-hint').textContent);

    const shared = table({ phase: 'lobby' }); shared.tv = true;
    P.feed(shared);
    ok(P.pick('#cap-join').hidden === true, 'with a TV screen at the table the phone does not repeat the code');
    ok(P.pick('#cap-tv').hidden === false, 'and says the screen is there');   // the words are the page's own
    ok(P.pick('#btn-start').disabled === false, 'and can still start the game');

    // a player who does not run the table is offered none of it
    const Q = playPage(seed, '?c=TEST');
    Q.feed(table({ phase: 'lobby', boss: false }));
    ok(Q.pick('#cap-join').hidden === true && Q.pick('#btn-start').hidden === true,
       'a player who does not run the table is shown neither the code nor the button');
    ok(/starts the game when everybody is seated/.test(Q.pick('#lobby-hint').textContent),
       'and is told who will  got ' + Q.pick('#lobby-hint').textContent);

    /* In a game it is one row, and the bum deal any player can ask for is in
       it beside the four that are the table host's. */
    const R = playPage(seed, '?c=TEST');
    R.feed(table({}));
    ok(R.pick('#bum-row').hidden === false, 'in play the row of controls is there');
    ok(R.pick('#btn-bum').hidden === false && R.pick('#btn-reset').hidden === false,
       'with the bum deal and a new game side by side');
    const S = playPage(seed, '?c=TEST');
    S.feed(table({ boss: false }));
    ok(S.pick('#btn-reset').hidden === true,
       'a player who runs nothing is offered no new game');
    ok(S.pick('#bum-row').hidden === false && S.pick('#btn-bum').hidden === false,
       'but can still ask the table to throw the hand in');
  }

  {   // the seat controls are a menu with words on it, not a row of glyphs
    const P = playPage(seed, '?c=TEST');
    P.feed(table({ phase: 'lobby' }));
    const rows = P.pick('#lobby-seats').children;
    ok(rows.length === 3 && !!rows[1].querySelector('.more'), 'every seat has one ⋯ button');
    rows[1].querySelector('.more').fire('click');
    const menu = rows[1].querySelector('.seatmenu');
    ok(!!menu, 'and it opens a menu on the row');
    // the words are on a span inside the button, and the fake DOM does not roll text up
    const label = (b) => b.querySelector('.menu-label').textContent;
    const names = menu ? menu.querySelectorAll('.menu-tap').map(label) : [];
    ok(names.indexOf('Make table host') >= 0 && names.indexOf('Make dealer') >= 0 && names.indexOf('Kick') >= 0,
       'with the controls named  got ' + names.join(' | '));
    P.socks[0].sent.length = 0;
    menu.querySelectorAll('.menu-tap').find((b) => label(b) === 'Make dealer').fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"dealer","id":"s1"}',
       'and a row says who deals, the one way the table hears it  got '
       + JSON.stringify(P.socks[0].sent[0]));
    ok(!rows[1].querySelector('.seatmenu'), 'the menu shuts on the tap');
    ok(names.indexOf('Move up') < 0 && names.indexOf('Move down') < 0, 'the order is changed by dragging, not from the menu');
    // seat 1 runs the table and deals first, and it is this phone's: nothing to offer
    ok(!rows[0].querySelector('.more'), 'a seat with nothing left to offer has no ⋯');
    const D = playPage(seed, '?c=TEST');
    const dealt = table({ phase: 'lobby' });
    dealt.firstDealerId = 's1';
    D.feed(dealt);
    const drows = D.pick('#lobby-seats').children;
    drows[0].querySelector('.more').fire('click');
    const host = drows[0].querySelector('.seatmenu').querySelectorAll('.menu-tap').map(label);
    ok(host.join(' | ') === 'Make dealer', 'the seat that runs the table is offered the deal and nothing else  got ' + host.join(' | '));
    drows[1].querySelector('.more').fire('click');
    const dealer = drows[1].querySelector('.seatmenu').querySelectorAll('.menu-tap').map(label);
    ok(dealer.indexOf('Make dealer') < 0 && dealer.indexOf('Make table host') >= 0,
       'and the seat that already deals first is not offered the deal  got ' + dealer.join(' | '));
    P.feed(table({ phase: 'lobby', boss: false }));
    ok(!P.pick('#lobby-seats').children[1].querySelector('.more'), 'a player who does not run the table has no menu');
  }

  {   /* A table watched on the machine that runs it can be put down: a screen
         showing a table has no other way out of it. Never on a TV or a laptop
         across the room -- they only show what is there. */
    const seen = [];
    const Settings = { wire: (btn, o) => { seen.push(o); return { refresh() {}, open() {}, close() {} }; } };
    const rowsOf = (page) => seen[seen.length - 1].items
      .filter((it) => !(it.hidden && it.hidden()))
      .map((it) => (typeof it.label === 'function' ? it.label() : it.label));

    const H = hostPage('screen', { hostname: '127.0.0.1', given: { Settings } });
    const mine = rowsOf(H);
    ok(mine.indexOf('End this table') >= 0,
       'the machine that runs the table is offered the way to end it  got ' + mine.join(' | '));
    ok(mine.indexOf('This table') >= 0, 'under a heading of its own');
    const end = seen[seen.length - 1].items.find((it) => it.label === 'End this table');
    ok(end.danger === true, 'and it is not offered lightly');
    end.run();                                    // the stand-in answers the question yes
    ok(JSON.stringify(H.asked[0]) === '{"u":"/table/end?c=TEST","method":"POST"}',
       'the table is ended on the server  got ' + JSON.stringify(H.asked[0]));
    Promise.resolve().then(() => Promise.resolve()).then(() => {
      ok(H.gone[H.gone.length - 1] === 'index.html', 'and the screen goes back to the front page');
      ok(!H.Net.tables().some((t) => t.code === 'TEST'), 'with the table forgotten');
    });

    const away = hostPage('screen', { given: { Settings } });
    ok(rowsOf(away).indexOf('End this table') < 0,
       'a screen across the room is offered no such thing  got ' + rowsOf(away).join(' | '));
  }

  {   // a vote that was cast says so, and can still be changed
    const P = playPage(seed, '?c=TEST');
    const st = table({ away: false }); st.cfg.deck = 'physical';
    st.vote = { kind: 'bumdeal', by: 1, round: 0, yes: [1, 0], no: [] };   // Ben asked, and I agreed
    P.feed(st);
    const acts = P.pick('#votebox').querySelector('.row-actions');
    ok(P.pick('#votebox').hidden === false, 'the vote box is up');
    ok(!!acts.querySelector('.hint') && /You agreed/.test(acts.querySelector('.hint').textContent),
       'and it says my vote landed  got ' + (acts.querySelector('.hint') || {}).textContent);
    const btns = acts.querySelectorAll('button');
    ok(btns.length === 1 && btns[0].textContent === 'No, play on', 'with the other answer still there  got ' + btns.map((b) => b.textContent).join('|'));
    ok(P.pick('#btn-bum').hidden === true, 'and the button that asks is away while the vote is on');
  }

  {   // the order of play is changed by dragging a seat by its handle
    const P = playPage(seed, '?c=TEST');
    P.feed(table({ phase: 'lobby' }));
    const list = P.pick('#lobby-seats');
    const rows = list.children;
    const grip = rows[0].querySelector('.grip');
    ok(!!grip, 'every seat has a handle to drag it by');
    P.socks[0].sent.length = 0;
    grip.fire('pointerdown', { clientY: 100, pointerId: 1, button: 0 });
    grip.fire('pointermove', { clientY: 145, pointerId: 1 });     // rows are 20px tall here: two places down
    ok(rows[0].classList.contains('dragging'), 'the row is held');
    ok(/translateY\(-20px\)/.test(rows[1].style.transform), 'and the rows it passes step aside  got ' + rows[1].style.transform);
    P.feed(table({ phase: 'lobby' }));
    ok(rows[0].classList.contains('dragging'), 'a state landing mid-drag does not pull the row away');
    grip.fire('pointerup', { clientY: 145, pointerId: 1 });
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"seatMove","id":"s0","to":2}',
       'and the drop says where it landed  got ' + JSON.stringify(P.socks[0].sent[0]));
    ok(!rows[0].classList.contains('dragging') && !rows[1].style.transform, 'and lets go');
    P.socks[0].sent.length = 0;
    grip.fire('pointerdown', { clientY: 100, pointerId: 1, button: 0 });
    grip.fire('pointerup', { clientY: 103, pointerId: 1 });
    ok(P.socks[0].sent.length === 0, 'a seat put back where it was sends nothing');
    P.feed(table({ phase: 'lobby', boss: false }));
    ok(!list.children[0].querySelector('.grip'), 'a player who does not run the table cannot drag');
  }

  {   // a screen that only shows a table offers nothing it cannot do
    const tricks = () => {
      const st = table({ away: false, phase: 'tricks' }); st.cfg.deck = 'physical'; st.turn = null;
      st.rounds[0].bids = [1, 1, 0];
      st.play = { turn: null, trick: [], won: [0, 0, 0], last: null, upcard: null, counts: [2, 2, 2], log: [] };
      return st;
    };
    const S = hostPage('screen');
    S.feed(tricks());
    ok(S.dom.document.body.classList.contains('showing'), 'the screen knows it only shows the table');
    ok(S.pick('#btn-bum').hidden === true && S.pick('#btn-reset-round').hidden === true
       && S.pick('#btn-reset').hidden === true && S.pick('#btn-pause').hidden === true,
       'no bum deal, reset round, pause or new game on a screen that only shows the table');
    ok(S.pick('#host-count').hidden === true, 'and no count of the tricks');
    ok(!/tap it here/.test(S.pick('#turn-hint').textContent),
       'nor a hint that says there is one  got ' + S.pick('#turn-hint').textContent);
    ok(/Ann taps who takes each trick/.test(S.pick('#turn-hint').textContent),
       'it names the dealer instead  got ' + S.pick('#turn-hint').textContent);
    const voting = tricks(); voting.vote = { kind: 'bumdeal', by: 1, round: 0, yes: [1], no: [] };
    S.feed(voting);
    ok(S.pick('#votebox').hidden === false, 'a vote is shown');
    ok(S.pick('#votebox').querySelectorAll('button').length === 0, 'and cannot be ended from here');
    const over = table({ away: false, phase: 'done' }); over.cfg.deck = 'physical'; over.idx = 1; over.turn = null;
    S.feed(over);
    ok(!/New game/.test(S.pick('#turn-hint').textContent),
       'the end of the game does not point at a button that is not there  got ' + S.pick('#turn-hint').textContent);

    const H = hostPage('host');
    H.feed(tricks());
    ok(H.pick('#btn-bum').hidden === false && H.pick('#btn-reset-round').hidden === false
       && H.pick('#btn-reset').hidden === false && H.pick('#btn-pause').hidden === false,
       'the screen that runs the table has them all, in one row under the bids');
    ok(H.pick('#host-count').hidden === false, 'and the count of the tricks');
    ok(/Ann taps who takes each trick, or tap it here/.test(H.pick('#turn-hint').textContent),
       'and says the dealer keeps it, or the screen can  got ' + H.pick('#turn-hint').textContent);
    H.feed(voting);
    const vb = H.pick('#votebox').querySelectorAll('button');
    ok(vb.length === 2 && vb[0].textContent === 'Throw it in now',
       'and can end a vote either way  got ' + vb.map((b) => b.textContent).join('|'));
    ok(H.pick('#btn-bum').hidden === true, 'while the vote box carries the bum deal');
  }

  {   // the bids are tallied in the same words on the phone and the TV screen
    const P = playPage(seed, '?c=TEST');
    P.feed(table({ away: false }));
    ok(P.pick('#bid-tally').textContent === 'Bids total 1 · 2 tricks',
       'the phone tallies the bids against the hand  got ' + P.pick('#bid-tally').textContent);
    const H = hostPage('host');
    H.feed(table({ away: false }));
    ok(H.pick('#turn-tally').textContent === 'Bids total 1 · 2 tricks',
       'in the words the TV screen uses  got ' + H.pick('#turn-tally').textContent);
    const playing = table({ away: false, phase: 'tricks' }); playing.turn = null;
    playing.rounds[0].bids = [1, 1, 0];
    playing.play = { turn: 1, trick: [], won: [1, 0, 0], last: null, upcard: 'TH', counts: [1, 1, 1] };
    P.feed(playing); H.feed(playing);
    ok(P.pick('#bid-tally').textContent === '1 of 2 tricks played' && H.pick('#turn-tally').textContent === '1 of 2 tricks played',
       'and once the cards are out both count the tricks played  got ' + P.pick('#bid-tally').textContent + ' / ' + H.pick('#turn-tally').textContent);
  }

  {   /* the beat after the last bid, on the screens above the felt
         The hold is the table's, so every screen draws it off the one state
         and none of them keeps a clock. Real cards here: it is the deck with
         no felt to say it on, and the one where a tap could land early. */
    const held = () => {
      const st = table({ away: false, phase: 'tricks' });
      st.cfg.deck = 'physical'; st.turn = null;
      st.rounds[0].bids = [1, 1, 0];
      st.play = { turn: null, held: true, trick: [], won: [0, 0, 0], last: null,
                  upcard: null, counts: [2, 2, 2], log: [] };
      return st;
    };
    const opened = () => { const st = held(); st.play.held = false; return st; };

    const H = hostPage('host');
    H.feed(held());
    ok(H.pick('#turn-title').textContent === 'Bids are in',
       'the TV screen names the moment  got ' + H.pick('#turn-title').textContent);
    ok(/^Ben leads the first trick\.$/.test(H.pick('#turn-hint').textContent),
       'and says who leads  got ' + H.pick('#turn-hint').textContent);
    ok(H.pick('#turn-tally').textContent === 'Bids total 2 · 2 tricks',
       'the tally is still the bids, not a hand nobody has played  got ' + H.pick('#turn-tally').textContent);
    ok(H.pick('#host-count').hidden === true, 'and no trick can be counted over it');
    const pillOf = (S) => S.pick('#bidstrip').querySelector('.bidpill').querySelector('.v').textContent;
    ok(pillOf(H) === '1', 'the pills carry bids while the bids are what is being read  got ' + pillOf(H));
    H.feed(opened());
    ok(H.pick('#turn-title').textContent === 'Tricks won', 'then the hand starts');
    ok(H.pick('#host-count').hidden === false, 'the count opens');
    ok(pillOf(H) === '0/1', 'and the pills turn to won against bid  got ' + pillOf(H));

    const P = playPage(seed, '?c=TEST');
    P.feed(held());
    ok(P.pick('#turn-eyebrow').textContent === 'Bids are in',
       'the phone names it in the same words  got ' + P.pick('#turn-eyebrow').textContent);
    ok(/leads the first trick$/.test(P.pick('#turn-text').textContent),
       'and says who leads  got ' + P.pick('#turn-text').textContent);
    ok(P.pick('#bid-title').textContent === 'Bids', 'its strip is still the bids  got ' + P.pick('#bid-title').textContent);
    ok(P.pick('#bid-tally').textContent === 'Bids total 2 · 2 tricks',
       'tallied as bids  got ' + P.pick('#bid-tally').textContent);
    P.feed(opened());
    ok(P.pick('#turn-eyebrow').textContent === 'Tricks won' && P.pick('#bid-title').textContent === 'Tricks won',
       'and both turn over together when the hand opens');
  }

  {   // what the round paid is said on the phone and on the TV screen
    const before = table({ away: false, phase: 'tricks' }); before.cfg.deck = 'physical'; before.turn = null;
    before.rounds[0].bids = [1, 1, 0];
    const after = JSON.parse(JSON.stringify(before)); after.rounds[0].tricks = [1, 0, 1]; after.phase = 'done'; after.idx = 1;
    const P = playPage(seed, '?c=TEST');
    P.feed(before);
    said.length = 0;
    P.feed(after);
    ok(said.some((s) => /^You made it · \+11 points/.test(s)), 'a phone at a table with real cards is told what the round paid it  got ' + said.join(' | '));
    const H = hostPage('host');
    H.feed(before);
    said.length = 0;
    H.feed(after);
    ok(said.some((s) => /^Ann \+11 · Ben 0 · Cal \+1/.test(s)), 'and the TV screen is told what everybody got  got ' + said.join(' | '));
  }

  {   // with real cards the dealer counts the tricks as they are taken
    const counting = (log) => {
      const st = table({ away: false, phase: 'tricks' }); st.cfg.deck = 'physical'; st.turn = null;
      st.rounds[0].bids = [1, 1, 0];
      const won = [0, 0, 0]; log.forEach((p) => { won[p] += 1; });
      const left = 2 - log.length;
      st.play = { turn: null, trick: [], won, last: log.length ? { trick: [], winner: log[log.length - 1] } : null,
                  upcard: null, counts: [left, left, left], log };
      return st;
    };
    const P = playPage(seed, '?c=TEST');
    said.length = 0;
    P.feed(counting([]));
    const pad = P.pick('#trick-count');
    ok(pad.hidden === false, 'a phone at a table with real cards is offered the count');
    const rows = pad.querySelectorAll('.countrow');
    ok(rows.length === 3, 'one row a seat  got ' + rows.length);
    ok(/Tap who takes it/.test(P.pick('#turn-text').textContent), 'and told what to do  got ' + P.pick('#turn-text').textContent);
    P.socks[0].sent.length = 0;
    rows[1].fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"trick","p":1}',
       'a tap on a row says who took the trick  got ' + JSON.stringify(P.socks[0].sent[0]));
    ok(!pad.querySelector('.count-foot').querySelector('button'), 'nothing to take back yet');
    P.feed(counting([1]));
    ok(pad.querySelectorAll('.countrow')[1].classList.contains('took'), 'the row that took it is marked');
    ok(said.some((s) => /^Ben took the trick · trick 1 of 2/.test(s)), 'and it is said  got ' + said.join(' | '));
    ok(/Trick 2 of 2/.test(P.pick('#turn-text').textContent), 'the next trick is asked for  got ' + P.pick('#turn-text').textContent);
    ok(P.pick('#bid-tally').textContent === '1 of 2 tricks played', 'the tally counts the tricks played  got ' + P.pick('#bid-tally').textContent);
    const pills = P.pick('#bidstrip').children;
    ok(pills.some((el) => el.querySelector('.v') && el.querySelector('.v').textContent === '1/1'), 'and the pills carry won against bid');
    P.socks[0].sent.length = 0;
    const back = pad.querySelector('.count-foot').querySelector('button');
    ok(!!back, 'and the last trick can be taken back');
    back.fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"trickback"}', 'which says so  got ' + JSON.stringify(P.socks[0].sent[0]));
    P.feed(counting([]));
    ok(said.some((s) => /taken back/.test(s)), 'a trick taken back is said too  got ' + said.join(' | '));

    const H = hostPage('host');
    H.feed(counting([]));
    ok(H.pick('#host-count').hidden === false && H.pick('#host-count').querySelectorAll('.countrow').length === 3,
       'the TV screen counts too');
    H.socks[0].sent.length = 0;
    H.pick('#host-count').querySelectorAll('.countrow')[2].fire('click');
    ok(JSON.stringify(H.socks[0].sent[0]) === '{"t":"trick","p":2}', 'with the same tap  got ' + JSON.stringify(H.socks[0].sent[0]));
    const S = hostPage('screen');
    S.feed(counting([]));
    ok(S.pick('#host-count').hidden === true, 'a screen that only shows the table does not');

    /* A paused table takes no trick, so it is not offered one to take. The
       round line already says the table is paused; rows that are lit and
       refused say the opposite of it. */
    const held = counting([]); held.paused = true;
    const Q = playPage(seed, '?c=TEST');
    Q.feed(held);
    ok(Q.pick('#trick-count').hidden === true, 'a paused table is offered no trick to count');
    Q.feed(counting([]));
    ok(Q.pick('#trick-count').hidden === false, 'and gets it back when the table is let go');

    /* The phone above is the dealer's, which is why it has the rows. Move the
       deal one seat and the same phone is a player like any other: it reads
       the count off the pills and is told whose job it is. */
    const notMine = counting([]); notMine.rounds[0].dealer = 1;
    const O = playPage(seed, '?c=TEST');
    O.feed(notMine);
    ok(O.pick('#trick-count').hidden === true, 'a phone that is not the dealer is offered no count');
    ok(/Ben counts the tricks\.$/.test(O.pick('#turn-text').textContent),
       'and is told who keeps it  got ' + O.pick('#turn-text').textContent);
    ok(O.pick('#bid-tally').textContent === '0 of 2 tricks played',
       'while the count itself is still everybody\'s to read  got ' + O.pick('#bid-tally').textContent);
    const H2 = hostPage('host');
    H2.feed(notMine);
    ok(H2.pick('#host-count').hidden === false,
       'the screen that runs the table counts whoever deals: it holds no seat');
  }

  {   // on a table dealt on the phones the TV waits on a seat with a card back in the trick
    const H = hostPage('host');
    const st = table({ away: false }); st.phase = 'tricks'; st.turn = null;
    st.rounds[0].bids = [1, 1, 0]; st.play.turn = 2;
    H.feed(st);
    const box = H.pick('#trick');
    ok(H.pick('#table-panel').hidden === false, 'the table panel is up in play');
    const next = box.querySelector('.slot.next');
    ok(!!next && next.querySelector('.who').textContent === 'Cal', 'and a card back stands for the seat to play  got '
       + (next ? next.querySelector('.who').textContent : 'none'));
    H.feed(st);
    ok(box.querySelector('.slot.next') === next, 'the same seat again keeps its slot');
    st.play.turn = 0;
    H.feed(st);
    ok(box.querySelector('.slot.next') !== next && box.querySelector('.slot.next').querySelector('.who').textContent === 'Ann',
       'the turn moves, the card back moves with it');
    const bid = table({ away: false });
    H.feed(bid);
    ok(H.pick('#table-panel').hidden === true && !box.querySelector('.slot.next'), 'the bidding: no panel, no card back');
  }

  {   // the end of the game is said once on the page
    const P = playPage(seed, '?c=TEST');
    const st = table({ away: false }); st.cfg.deck = 'physical'; st.phase = 'done'; st.idx = 1; st.turn = null;
    P.feed(st);
    ok(P.pick('#turn-panel').hidden === true, 'the turn panel goes when the game is over');
    ok(P.pick('#winner-panel').hidden === false, 'and the winner panel says who won');
  }

  {   /* Putting the round back is asked about first, and told what it takes.
         From the bidding there is nothing behind the bids, so it is not there
         at all -- the hand is thrown in with Bum deal instead. */
    const P = playPage(seed, '?c=TEST');
    const st = table({ away: false }); st.phase = 'tricks'; st.turn = null;
    P.feed(st);
    ok(P.pick('#btn-reset-round').hidden === false, 'a round being played can be put back');
    ok(P.pick('#btn-reset-round').textContent === 'Reset round',
       'and says so  got ' + P.pick('#btn-reset-round').textContent);
    asked.length = 0; P.socks[0].sent.length = 0;
    P.pick('#btn-reset-round').fire('click');
    ok(asked.length === 1 && /^Reset this round/.test(asked[0].t),
       'it asks first  got ' + JSON.stringify(asked[0]));
    ok(/Round 1 goes back to its bids/.test(asked[0].b),
       'and names the round it takes back  got ' + (asked[0] || {}).b);
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"resetround"}',
       'and the tap goes to the table once it is confirmed  got ' + JSON.stringify(P.socks[0].sent[0]));

    P.feed(table({ away: false }));            // back to the bidding
    ok(P.pick('#btn-reset-round').hidden === true,
       'while the bids are still coming in there is nothing behind them to go back to');
  }

  {   // a refusal is said where it can be seen
    const P = playPage(seed, '?c=TEST');
    P.feed(table({ away: false }));            // a virtual table: the turn panel is hidden
    said.length = 0;
    P.feed({ t: 'error', msg: 'Too late to change your bid.' });
    ok(said.length === 1 && /Too late/.test(said[0]),
       'a refused action is said in a line under the top bar, not in a panel the felt hides  got ' + said.join());
  }

  /* ---- the card is drawn when it changes, and not when it does not ----

     A state arrives for everything a table does -- a card played, a line of
     talk, a phone coming back -- and the card was rebuilt from scratch on
     every one of them: a table of HTML parsed and laid out again, then read
     back to keep the round in play in view. Most states do not change a
     figure on it. */
  {
    const P = playPage(seed, '?c=TEST');
    // One table, arriving again and again the way the server sends it: a fresh
    // object every time, saying the same thing.
    const base = table({});
    const arrives = () => JSON.parse(JSON.stringify(base));
    P.feed(arrives());
    const box = P.pick('#scorecard');
    let draws = 0;
    const write = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'innerHTML').set;
    Object.defineProperty(box, 'innerHTML', { set(v) { draws += 1; write.call(this, v); } });

    P.feed(arrives());
    ok(draws === 0, 'a state that says nothing new leaves the card alone  got ' + draws + ' redraws');
    const bidIn = arrives();
    bidIn.rounds[0].bids = [0, 1, 1];
    P.feed(bidIn);
    ok(draws === 1, 'and a bid that lands draws it  got ' + draws + ' redraws');
  }

  {   // the page says a phone has gone, once
    const P = playPage(seed, '?c=TEST');
    P.feed(table({ away: false }));
    said.length = 0;
    P.feed(table({}));
    ok(said.length === 1 && /^Cal dropped out/.test(said[0]), 'the page says a phone has gone  got ' + said[0]);
    ok(/waiting on them/.test(said[0]), 'and that the table is stopped  got ' + said[0]);
    said.length = 0;
    P.feed(table({}));
    ok(said.length === 0, 'and does not say it again on the next state');
    said.length = 0;
    P.feed(table({ away: false }));
    ok(said.length === 1 && /^Cal is back/.test(said[0]), 'coming back is said  got ' + said[0]);
  }

  {   // handing a seat to auto-play for good
    const P = playPage(seed, '?c=TEST');
    P.feed(table({}));
    ok(P.pick('#playout-row').hidden === false, 'the host can hand the empty seat to auto-play');
    ok(P.pick('#playout-row').querySelector('.btn').textContent === "Auto-play Cal's hand",
       'named, like the bid  got ' + P.pick('#playout-row').querySelector('.btn').textContent);
    P.socks[0].sent.length = 0;
    P.pick('#playout-row').querySelector('.btn').fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"playout"}',
       'and the tap says so, once it is confirmed  got ' + JSON.stringify(P.socks[0].sent[0]));

    P.feed(table({ boss: false }));
    ok(P.pick('#playout-row').hidden === true, 'only whoever runs the table is offered it');
    P.feed(table({ away: false }));
    ok(P.pick('#playout-row').hidden === true, 'and not while that phone is there');
    const gone = table({}); gone.seats[2].left = true;
    P.feed(gone);
    ok(P.pick('#playout-row').hidden === true, 'nor for a hand the table already plays');
  }

  {   // the TV screen says it too, and runs the table
    const H = hostPage('host');
    const st = table({}); st.stalled = { id: 's2', ms: 300000 };
    H.feed(st);
    ok(H.pick('#stalled-row').hidden === false, 'the TV screen says the table is stopped');
    H.socks[0].sent.length = 0;
    H.pick('#stalled-row').querySelector('.btn').fire('click');
    ok(JSON.stringify(H.socks[0].sent[0]) === '{"t":"carryon"}',
       'and carries on from it  got ' + JSON.stringify(H.socks[0].sent[0]));
    const S = hostPage('screen');
    S.feed(st);
    ok(S.pick('#stalled-row').hidden === false, 'a screen that only shows the table says so as well');
    ok(S.pick('#stalled-row').querySelector('.row-actions').hidden === true, 'with nothing to tap');
  }

  {   // the table stopped on a seat, with real cards nobody else can play
    const P = playPage(seed, '?c=TEST');
    const stop = (o) => Object.assign(table(o || {}), { stalled: { id: 's2', ms: 300000 } });
    P.feed(stop());
    const row = P.pick('#stalled-row');
    ok(row.hidden === false, 'every screen says the table is held up');
    /* Not "paused": that word is the hold somebody pressed, and this is a
       table waiting on a seat nobody is behind. Two things with two ways out
       of them, and one word for both had a player pressing Play at a phone
       that had gone quiet. */
    ok(row.querySelector('.hint').textContent === 'Waiting on Cal. No answer for 5 minutes.',
       'naming the seat and how long  got ' + row.querySelector('.hint').textContent);
    ok(P.pick('#attn-panel').hidden === false, 'and the panel it sits in is up');
    P.socks[0].sent.length = 0;
    row.querySelector('.btn').fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"carryon"}',
       'whoever runs the table carries on  got ' + JSON.stringify(P.socks[0].sent[0]));
    P.feed(stop({ boss: false }));
    ok(row.hidden === false, 'a player who does not run the table still sees it stopped');
    ok(row.querySelector('.row-actions').hidden === true, 'with nothing to tap');
    P.feed(table({}));
    ok(row.hidden === true, 'and it goes when the table is not stopped');
  }

  {   // the table has been waiting on this phone, and asks whether anybody is there
    const P = playPage(seed, '?c=TEST');
    P.feed(table({}));
    telling.length = 0;
    P.socks[0].sent.length = 0;
    P.socks[0].onmessage({ data: JSON.stringify({ t: 'idle', in: 60000 }) });
    ok(telling.length === 1 && telling[0].t === 'Still there?',
       'the table asks the phone it is waiting on whether anybody is there');
    ok(/auto-play takes your hand/.test(telling[0].b),
       'and says what happens if nobody answers  got ' + (telling[0] || {}).b);
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"here"}',
       'the tap is the answer  got ' + JSON.stringify(P.socks[0].sent[0]));
  }

  {   // leaving
    const P = playPage(seed, '?c=TEST');
    P.feed(table({}));
    ok(P.pick('#leave-row').hidden === false, 'a seated player can leave');
    ok(P.pick('#btn-leave').textContent === 'Leave the game',
       'in a game  got ' + P.pick('#btn-leave').textContent);
    P.socks[0].sent.length = 0;
    P.pick('#btn-leave').fire('click');
    ok(JSON.stringify(P.socks[0].sent[0]) === '{"t":"leave"}',
       'and the tap says so, once it is confirmed  got ' + JSON.stringify(P.socks[0].sent[0]));

    P.feed(table({ phase: 'lobby' }));
    ok(P.pick('#btn-leave').textContent === 'Leave the table',
       'before the game it is the table you leave  got ' + P.pick('#btn-leave').textContent);

    // and the page walks away when the server says the seat was given up
    P.socks[0].onmessage({ data: JSON.stringify({ t: 'left', code: 'TEST' }) });
    ok(P.gone[P.gone.length - 1] === 'index.html', 'the page goes back to the front  got ' + P.gone.join());
    ok(P.Net.tables().length === 1,
       'and the table is still remembered, so the seat can be taken back');
  }

  part('who you are, on the phone');

  /* The name and the photo live on the settings page. At a table they are the
     seat's: a change in the lobby goes to the table, a change during a game
     goes with the next table. */
  {
    let kept = null, picked = null;
    const El = makeDom(1, 1).El;
    const Avatar = { saved: () => kept, remember: (d) => { kept = d; }, url: (code, s) => (s && s.av ? 'pic:' + s.av : null),
      picker: (onPick) => { picked = onPick; return { el: new El('div'), show() {}, say() {} }; } };
    const o = { real: ['public/settings.js'], given: { Avatar } };

    const P = playPage(seed, '?c=TEST', o);
    P.feed(table({ phase: 'lobby' }));
    const page = P.dom.document.body.querySelector('.settings');
    P.pick('#btn-settings').fire('click');
    ok(!page.hidden, 'the ⚙ opens the settings page');
    const inp = page.querySelector('.settings-name');
    ok(inp.value === 'Ann', 'with the name this seat plays under  got ' + inp.value);
    ok(page.querySelector('.settings-note').hidden, 'and nothing to add in the lobby');
    inp.value = 'Zed';
    page.querySelector('.settings-back').fire('click');
    const sent = P.socks[0].sent.filter((m) => m.t === 'rename');
    ok(sent.length === 1 && sent[0].name === 'Zed', 'a new name goes to the table  got ' + JSON.stringify(sent));
    ok(P.Net.name() === 'Zed', 'and the phone keeps it for the next table');
    picked('data:me');
    const pics = P.socks[0].sent.filter((m) => m.t === 'avatar');
    ok(pics.length === 1 && pics[0].data === 'data:me', 'a photo picked goes to the table at once  got ' + JSON.stringify(pics));
    ok(kept === 'data:me', 'and the phone keeps that too');

    const Q = playPage(seed, '?c=TEST', o);
    Q.feed(table({}));                       // bidding: the game is on
    const qp = Q.dom.document.body.querySelector('.settings');
    Q.pick('#btn-settings').fire('click');
    const note = qp.querySelector('.settings-note');
    ok(!note.hidden && /next table/.test(note.textContent), 'during a game the page says the change goes with the next table');
    qp.querySelector('.settings-name').value = 'Zed';
    qp.querySelector('.settings-back').fire('click');
    ok(!Q.socks[0].sent.some((m) => m.t === 'rename'), 'and sends the table no name');
    ok(Q.Net.name() === 'Zed', 'but the phone keeps it');
    picked('data:later');
    ok(!Q.socks[0].sent.some((m) => m.t === 'avatar'), 'nor a photo');
    ok(kept === 'data:later', 'which the phone keeps for the next table');

    // a window that only watches a seat has no name to change
    const W = playPage({ 'rcs:tables:v1': JSON.stringify([{ code: 'TEST', token: 'w0', role: 'watch', seatId: 's0' }]) }, '?c=TEST', o);
    W.feed(table({ phase: 'lobby' }));
    W.pick('#btn-settings').fire('click');
    ok(!W.dom.document.body.querySelector('.settings').querySelector('.settings-you'), 'a watching window is offered no name');
}

/* ---- the deal, with motion on ----

   Every other check here runs with motion off, where the deal bows out
   before it builds a scene. That let a throw inside the scene go unseen: the
   shuffle started, the build fell over on a name that had been deleted, and
   the felt stood up a still table with no deal at all. So the scene is built
   once with the Web Animations API stubbed to record what it is asked for. */
part('the deal, with motion on');
{
  const L = load(412, 860, 'full');
  const asked = [];
  L.dom.El.prototype.animate = function (kf, opts) {
    const a = { el: this, kf, opts: opts || {}, cancel() {}, commitStyles() {}, pause() {}, play() {},
                finished: Promise.resolve() };
    asked.push(a);
    return a;
  };
  L.dom.El.prototype.getAnimations = () => [];
  const { ST } = stateFor(3, 5, 1, { phase: 'bid', turn: 2 });
  let threw = null;
  try { L.Felt.sync(ST, 1, { send() {}, watch: false, onView() {} }); } catch (e) { threw = e; }
  ok(!threw, 'the scene builds without throwing  ' + (threw ? threw.message : ''));
  const cls = (a) => a.el.className;
  const deck = asked.filter((a) => /\bdcard\b/.test(cls(a)) && /\bdeck\b/.test(cls(a)));
  const mine = asked.filter((a) => /\bdcard\b/.test(cls(a)) && /\bmine\b/.test(cls(a)));
  const hero = asked.filter((a) => /\bhero\b/.test(cls(a)));
  ok(deck.length >= 30, 'the deck is shuffled on screen  got ' + deck.length + ' moves');
  ok(mine.length >= 5, 'and every card of the hand is dealt  got ' + mine.length);
  ok(hero.length >= 1, 'and a card is turned for trumps');
  const ends = asked.map((a) => (a.opts.delay || 0) + (a.opts.duration || 0));
  ok(Math.max(...ends) > 3000, 'the whole thing takes a few seconds  got ' + Math.round(Math.max(...ends)) + 'ms');

  /* ---- the card of the player to act ----

     It peeks up, shivers and lies down again, once every three seconds. That
     was one animation of three seconds repeating for ever, two seconds of it
     holding the card where it already was, and the phone drew every frame of
     it: a whole core, for the whole of the bidding. The peek is the animation
     now and the wait between peeks is a timer, so nothing is drawn while the
     card lies still. Anything on this screen that repeats for ever costs the
     same, so none of it may. */
  const before = asked.length;
  L.Stage.S.live.settled = true;                  // the cards have landed
  L.Deal.update({ turn: 2, bids: [null, null, null] });
  const peek = asked.slice(before);
  ok(peek.length >= 1, 'the card of the player to act moves  got ' + peek.length + ' animations');
  ok(peek.every((a) => a.opts.duration <= 1200),
     'and the peek is a second, not three  got ' + JSON.stringify(peek.map((a) => a.opts.duration)));
  ok(asked.every((a) => a.opts.iterations === undefined || Number.isFinite(a.opts.iterations)),
     'nothing on the deal repeats for ever: a phone would draw it for ever');
}

/* ---- the seat the table waits on ----

   The pile of the seat to act peeks on the felt the same as on the deal and
   on the TV screen, so whose turn it is reads without the words. It rides on
   the top card of that pile, moves with the turn, and stops when the turn is
   this phone's own, when nobody is on play, and when the felt is dropped. */
part('the seat the table waits on peeks');
{
  const stub = (L) => {
    const asked = [];
    L.dom.El.prototype.animate = function (kf, opts) {
      const a = { el: this, kf, opts: opts || {}, off: false, cancel() { this.off = true; },
                  commitStyles() {}, pause() {}, play() {}, finish() {}, finished: Promise.resolve() };
      asked.push(a);
      return a;
    };
    L.dom.El.prototype.getAnimations = () => [];
    return asked;
  };
  const W = 412, H = 860, n = 3, cards = 5, me = 1;
  const L = load(W, H, 'full');
  const asked = stub(L);
  // a peek is 1050 ms; a bid landing hits the pile too, and that is not one
  const piles = () => asked.filter((a) => /\bdcard\b/.test(a.el.className) && !/\b(mine|hero|deck)\b/.test(a.el.className) && a.opts.duration === 1050);
  const live = () => piles().filter((a) => !a.off);
  const seatOf = (a) => {
    const at = spotOf(a.el);
    const R = L.Stage.ring(n, me, W, H), F = L.Stage.fan(cards, W, H);
    for (let q = 0; q < n; q++) {
      const h = L.Stage.pile(R, F, q, cards - 1, n);
      if (at && Math.abs(at.x - h.x) < 1 && Math.abs(at.y - h.y) < 1) return q;
    }
    return -1;
  };
  // a round with a bid in is built at once, so nothing but the peek moves
  const touched = (o) => stateFor(n, cards, me, Object.assign({ bids: [null, 1, null] }, o)).ST;
  L.Felt.sync(touched({ phase: 'bid', turn: 2 }), me, { send() {}, watch: false, onView() {} });
  ok(live().length === 1, 'the pile of the seat to bid peeks  got ' + live().length);
  ok(live().length && seatOf(live()[0]) === 2, 'and it is that seat\'s pile  got seat ' + (live().length ? seatOf(live()[0]) : '-'));
  ok(live().length && live()[0].el.style.zIndex === String(cards - 1), 'on the top card of it');
  ok(live().length && live()[0].kf[0].transform === live()[0].el.style.transform, 'from where the card lies');
  ok(live().length && live()[0].opts.duration <= 1200 && live()[0].opts.iterations === undefined,
     'one peek at a time: a phone would draw a repeat for ever');
  const first = live()[0];
  L.Felt.sync(touched({ phase: 'bid', turn: 2 }), me, {});
  ok(piles().length === 1, 'the same turn again does not start it over  got ' + piles().length);
  L.Felt.sync(touched({ phase: 'bid', turn: 0 }), me, {});
  ok(first.off, 'the turn moves on: the old pile is let go');
  ok(live().length === 1 && seatOf(live()[0]) === 0, 'and the new seat\'s pile peeks  got seat ' + (live().length ? seatOf(live()[0]) : '-'));
  L.Felt.sync(touched({ phase: 'bid', turn: me }), me, {});
  ok(live().length === 0, 'your own turn peeks nothing: the hand and the line say it');
  L.Felt.sync(touched({ phase: 'tricks', turn: null, pturn: 2, bids: [1, 1, 1] }), me, {});
  ok(live().length === 1 && seatOf(live()[0]) === 2, 'a card wanted from a seat peeks its pile  got ' + live().length);
  L.Felt.sync(touched({ phase: 'tricks', turn: null, pturn: null, bids: [1, 1, 1] }), me, {});
  ok(live().length === 0, 'nobody on play, nothing peeks');
  L.Felt.sync(touched({ phase: 'tricks', turn: null, pturn: 0, bids: [1, 1, 1] }), me, {});
  ok(live().length === 1, 'and it is back when somebody is');
  L.Felt.hide();
  ok(live().length === 0, 'the felt dropped, it stops');
  L.Felt.show();
  ok(live().length === 1, 'and starts again when the felt is back');
  L.dom.window.fire('resize');
  ok(live().length === 1 && live()[0].kf[0].transform === live()[0].el.style.transform,
     'a resize places it where the pile lies now');
  L.Felt.sync(Object.assign({}, touched({ phase: 'lobby' }), { rounds: [], play: null }), me, {});
  ok(live().length === 0, 'the round over, it stops');

  {   // with reduced motion the label is enough, as on the deal
    const L2 = load(W, H, 'reduced');
    const asked2 = stub(L2);
    L2.Felt.sync(touched({ phase: 'bid', turn: 2 }), me, { send() {}, watch: false, onView() {} });
    ok(asked2.filter((a) => /\bdcard\b/.test(a.el.className)).length === 0, 'with reduced motion no pile peeks');
  }

  {   // the deal hands the stage over, and its own peek with it
    const L3 = load(W, H, 'full');
    const asked3 = stub(L3);
    const { ST } = stateFor(n, cards, me, { phase: 'bid', turn: 2 });
    L3.Felt.sync(ST, me, { send() {}, watch: false, onView() {} });
    L3.Stage.S.live.settled = true;
    L3.Deal.update({ turn: 2, bids: [null, null, null] });
    const dealPeek = L3.Stage.S.live.turnAnim;
    ok(!!dealPeek, 'the deal peeks the player to bid while the cards are in the air');
    const overlay = L3.dom.document.getElementById('deal');
    overlay.fire('pointerdown', { target: overlay, clientX: 200, clientY: 700, pointerId: 1 });
    ok(L3.Stage.S.live.turnAnim === null, 'the table takes the stage, and the deal lets its peek go');
    const on = asked3.filter((a) => /\bdcard\b/.test(a.el.className) && !/\b(mine|hero|deck)\b/.test(a.el.className)
      && a.opts.duration === 1050 && !a.off);
    ok(on.length === 1, 'and one peek is on the table: the felt\'s own  got ' + on.length);
  }
}

/* ---- a bid landing on the felt ----

   The TV screen stamps every bid onto the pile it belongs to, in gold. The
   deal did that on a phone while it held the stage, and the felt did not
   once it had taken over: a bid was a name changing under a pile. The felt
   stamps now, the same way; only bids that land after the table is stood
   up, and never your own. */
part('a bid landing on the felt is stamped');
{
  const stub = (L) => {
    const asked = [];
    L.dom.El.prototype.animate = function (kf, opts) {
      const a = { el: this, kf, opts: opts || {}, cancel() {}, commitStyles() {}, pause() {}, play() {},
                  finish() {}, finished: Promise.resolve(), onfinish: null };
      asked.push(a);
      return a;
    };
    L.dom.El.prototype.getAnimations = () => [];
    return asked;
  };
  const n = 3, cards = 5, me = 1;
  const L = load(412, 860, 'full');
  const asked = stub(L);
  const stage = () => L.dom.document.querySelector('.deal-stage');
  const stamps = () => stage().querySelectorAll('.dstamp');
  const hits = () => asked.filter((a) => /\bdcard\b/.test(a.el.className) && a.kf[1] && /scale\(1\.13\)/.test(a.kf[1].transform));
  const st = (bids, o) => stateFor(n, cards, me, Object.assign({ phase: 'bid', turn: 2, bids }, o)).ST;
  L.Felt.sync(st([0, null, null], { turn: 1 }), me, { send() {}, watch: false, onView() {} });
  ok(stamps().length === 0, 'a table stood up with a bid on it stamps nothing');
  L.Felt.sync(st([0, 1, null]), me, {});
  ok(stamps().length === 0, 'your own bid is the lit number on the rail: not stamped');
  L.Felt.sync(st([0, 1, 2], { turn: null }), me, {});
  ok(stamps().length === 1 && stamps()[0].textContent === '2', 'a bid landing is stamped, in its number  got ' + stamps().length);
  ok(hits().length === 1 && hits()[0].el.style.zIndex === String(cards - 1), 'and the top card of that pile takes the hit');
  ok(asked.some((a) => /\bdname\b/.test(a.el.className) && a.kf[1] && /scale\(1\.22\)/.test(a.kf[1].transform)),
     'and the name under it pops');
  L.Felt.sync(st([0, 1, 2], { turn: null }), me, {});
  ok(stamps().length === 1, 'the same bids again stamp nothing more');
  L.Felt.sync(st([3, 1, 2], { turn: null }), me, {});
  ok(stamps().length === 1, 'a bid changed is not stamped again, as on the TV screen');
  stamps().forEach((el) => el.remove());
  L.Felt.hide(); L.Felt.show();
  ok(stamps().length === 0, 'the felt dropped and brought back stamps nothing');

  const L2 = load(412, 860, 'reduced');
  stub(L2);
  L2.Felt.sync(st([0, null, null], { turn: 1 }), me, { send() {}, watch: false, onView() {} });
  L2.Felt.sync(st([0, 1, 2], { turn: null }), me, {});
  ok(L2.dom.document.querySelector('.deal-stage').querySelectorAll('.dstamp').length === 0, 'with reduced motion nothing is stamped');
}

/* ---- the seat the table waits on, in the trick ----

   The TV screen is dealt nothing, so during play it has no pile to peek. A
   card back stands in the trick for the seat to play instead, and peeks the
   same way. It stays put while the seat is the same, so a state coming in
   does not start the peek over, and it goes with the turn. */
part('the seat the table waits on peeks in the trick');
{
  const stub = (L) => {
    const asked = [];
    L.dom.El.prototype.animate = function (kf, opts) {
      const a = { el: this, kf, opts: opts || {}, off: false, cancel() { this.off = true; },
                  commitStyles() {}, pause() {}, play() {}, finish() {}, finished: Promise.resolve() };
      asked.push(a);
      return a;
    };
    L.dom.El.prototype.getAnimations = () => [];
    return asked;
  };
  const L = load(1280, 720, 'full');
  const asked = stub(L);
  const backs = () => asked.filter((a) => /\bback\b/.test(a.el.className) && a.kf[0].transform !== undefined);
  const live = () => backs().filter((a) => !a.off);
  const made = stateFor(3, 5, -1, { phase: 'tricks', bids: [1, 1, 1], pturn: 2 });
  const st = (o) => Object.assign({}, made.ST, { play: Object.assign({}, made.ST.play, o) });
  const box = L.dom.document.createElement('div');
  L.Table.trickEl(box, st({ turn: 2 }), -1);
  const next = box.querySelector('.slot.next');
  ok(!!next && next.querySelector('.pcard.back') && next.querySelector('.who').textContent === 'P3',
     'a card back stands in the trick for the seat to play');
  ok(live().length === 1 && live()[0].kf[0].transform === 'none', 'and it peeks, from flat  got ' + live().length);
  L.Table.trickEl(box, st({ turn: 2 }), -1);
  ok(box.querySelector('.slot.next') === next && backs().length === 1, 'the same seat again does not start it over');
  const first = live()[0];
  L.Table.trickEl(box, st({ turn: 0, trick: [{ p: 2, card: made.hands[2][0] }] }), -1);
  ok(first.off, 'the turn moves on: the old back is let go');
  const slots = box.querySelectorAll('.slot');
  ok(slots.length === 2 && slots[1].classList.contains('next') && slots[1].querySelector('.who').textContent === 'P1',
     'and the new seat\'s card back stands after the card played  got ' + slots.map((x) => x.className).join('|'));
  ok(live().length === 1, 'peeking  got ' + live().length);
  L.Table.trickEl(box, st({ turn: null, trick: [], last: { winner: 2, trick: [{ p: 2, card: made.hands[2][0] }] } }), -1);
  ok(!box.querySelector('.slot.next') && live().length === 0, 'a trick taken lies there with nobody on play: no card back');
  ok(box.querySelector('.slot.won'), 'the card that took it is marked');
  L.Table.trickEl(box, st({ turn: 1 }), -1);
  ok(live().length === 1, 'the winner leads: their card back peeks');
  L.Table.trickEl(box, Object.assign({}, made.ST, { play: null }), -1);
  ok(box.children.length === 0 && live().length === 0, 'no play, nothing in the box');

  const L2 = load(1280, 720, 'reduced');
  const asked2 = stub(L2);
  const box2 = L2.dom.document.createElement('div');
  L2.Table.trickEl(box2, st({ turn: 2 }), -1);
  ok(!!box2.querySelector('.slot.next') && asked2.length === 0, 'with reduced motion the card back stands still');
}

/* ---- tapping the deal away ----

   The tap that lands a deal, and the tap that closes one, both ran through a
   name that had been deleted with the shuffle loop; so did the timer that
   closes a scene on its own. A tap did nothing, and a scene with real cards
   never closed. Both taps are made here, with the animations recorded. */
part('tapping the deal away');
{
  const record = (L) => {
    const asked = [];
    L.dom.El.prototype.animate = function (kf, opts) {
      const a = { el: this, kf, opts: opts || {}, cancel() {}, commitStyles() {}, pause() {}, play() {},
                  finish() { this.finished_ = true; }, finished: Promise.resolve(), onfinish: null };
      asked.push(a);
      return a;
    };
    L.dom.El.prototype.getAnimations = () => [];
    return asked;
  };

  {   // a table (keep): the first tap lands the cards and hands the stage over
    const L = load(412, 860, 'full');
    const asked = record(L);
    const { ST } = stateFor(3, 5, 1, { phase: 'bid', turn: 2 });
    L.Felt.sync(ST, 1, { send() {}, watch: false, onView() {} });
    const overlay = L.dom.document.getElementById('deal');
    const before = asked.length;
    let threw = null;
    try { overlay.fire('pointerdown', { target: overlay, clientX: 200, clientY: 700, pointerId: 1 }); }
    catch (e) { threw = e; }
    ok(!threw, 'a tap on the deal does not throw  ' + (threw ? threw.message : ''));
    ok(asked.slice(0, before).every((a) => a.finished_), 'and it lands every card at once');
    ok(overlay.querySelectorAll('.dcard.mine').length === 5, 'the hand is on the table');
    ok(!overlay.hidden, 'and the table stays up: the deal is the round, not a scene');
  }

  {   // a scene of its own (a phone at a table with real cards): the bids land on it, and one tap closes it
    const L = load(412, 860, 'full');
    const asked = record(L);
    const overlay = L.Stage.parts().overlay;
    const p = L.Deal.play({
      names: ['Ann', 'Ben', 'Cal'], dealer: 0, cards: 3, round: 1,
      deck: 'physical', mine: 1, hand: [], upcard: null, trump: null, linger: 1000, key: '0:0',
    });
    ok(L.Stage.isOpen('deal'), 'the scene is live while it is up, so the bids can land on it');
    L.Deal.update({ key: '0:0', bids: [null, 1, null], turn: 2, text: 'Waiting for Cal to bid' });
    const names = overlay.querySelectorAll('.dname').map((el) => el.textContent);
    ok(names.indexOf('Ben · 1') >= 0, 'a bid that lands is written under that pile  got ' + names.join('|'));
    ok(overlay.querySelector('.deal-status').textContent === 'Waiting for Cal to bid', 'and the line says whose bid it is');
    ok(overlay.querySelector('.deal-skip').textContent === 'tap to skip', 'nothing waits for a tap');
    let threw = null;
    try {
      overlay.fire('pointerdown', { target: overlay, clientX: 200, clientY: 400, pointerId: 1 });
    } catch (e) { threw = e; }
    ok(!threw, 'one tap closes a scene without throwing  ' + (threw ? threw.message : ''));
    const out = asked[asked.length - 1];
    ok(out && out.el === overlay && out.kf[1] && out.kf[1].opacity === 0, 'the last thing asked for is the fade out');
    if (out && out.onfinish) out.onfinish();
    ok(overlay.hidden, 'and the overlay is gone after it');
    ok(!L.dom.document.body.classList.contains('stage-head'),
       'and the band a toast came up in goes with it');
    p.then(() => ok(true, 'the scene\'s promise settles'));
  }

  {   // a bid that lands while the cards are in the air is stamped once they are down
    const L = load(1280, 720, 'full');
    const asked = record(L);
    const overlay = L.Stage.parts().overlay;
    const stage = () => L.dom.document.querySelector('.deal-stage');
    L.Deal.play({ names: ['Ann', 'Ben', 'Cal'], dealer: 0, cards: 3, round: 1,
                  deck: 'virtual', mine: -1, hand: [], upcard: 'TH', trump: 'H', hold: true, key: '0:0' });
    L.Deal.update({ key: '0:0', bids: [null, null, null], turn: 1, text: '' });   // the TV fills in the bids it opens with
    L.Deal.update({ key: '0:0', bids: [null, 1, null], turn: 2, text: 'Waiting for Cal to bid' });
    // The deal is the dealer's on either deck, and the same words say so.
    ok(overlay.querySelector('.deal-doing').textContent === 'Ann is dealing…',
       'the line says whose deal it is  got ' + overlay.querySelector('.deal-doing').textContent);
    /* What the deck turned is not said in words: the card is turned over in
       the middle of the table, and the band under the round line is left for
       what the table has to say. */
    ok(!overlay.querySelector('.deal-tag'), 'nothing says the trump suit in words');
    /* And nothing says who deals in words either: the round line is the round
       and the count, and the seat that deals carries the mark. The screen that
       holds no seat rings a pile, since every pile on it belongs to somebody
       else. */
    ok(overlay.querySelector('.deal-cap').textContent === 'Round 1 · 3 cards',
       'the round line does not name the dealer  got ' + overlay.querySelector('.deal-cap').textContent);
    const dring = overlay.querySelector('.dring');
    ok(!!dring && dring.querySelector('.dring-tag').textContent === 'dealer',
       'the seat that deals is ringed instead');
    const dbox = boxOf(dring);
    const dseat = L.Stage.ring(3, 0, 1280, 720).at(0);
    ok(dbox.y < dseat.y && dbox.y + dbox.h > dseat.y,
       'the ring stands over that seat  got ' + dbox.y + '..' + (dbox.y + dbox.h) + ' for ' + dseat.y);
    ok(dbox.h > L.Stage.cardSize(1280).h,
       'and takes in the cards and the name, not a heading  got ' + dbox.h);

    /* Who dealt can be corrected while the scene is still up -- a real deck
       was dealt by a person, and the table host says which person. The ring
       moves to them; the round is not dealt again, because the hand did not
       change. It used to be drawn once with the cards, so every other screen
       followed the change and the TV screen went on ringing the old seat. */
    L.Deal.update({ key: '0:0', bids: [null, 1, null], turn: 2, dealer: 2 });
    ok(overlay.querySelectorAll('.dring').length === 1, 'still one ring, one dealer');
    const moved = boxOf(overlay.querySelector('.dring'));
    const two = L.Stage.ring(3, 0, 1280, 720).at(2);
    ok(moved.y < two.y && moved.y + moved.h > two.y,
       'and it stands over the seat that deals now  got ' + moved.y + '..'
       + (moved.y + moved.h) + ' for ' + two.y);
    ok(moved.x !== dbox.x || moved.y !== dbox.y, 'which is not where it was');
    L.Deal.update({ key: '0:0', bids: [null, 1, null], turn: 2, dealer: 0 });
    ok(boxOf(overlay.querySelector('.dring')).y === dbox.y, 'and back again if it is put back');
    const body = L.dom.document.body;
    ok(body.classList.contains('stage-head'), 'the page is marked while a round line is up');
    const bandTop = Number(String(body.style.getPropertyValue('--stage-band')).replace('px', ''));
    const headBox = overlay.querySelector('.deal-head');
    const headFoot = headBox.offsetTop + headBox.getBoundingClientRect().height;
    const ringTop = 720 / 2 + L.Stage.ring(3, 0, 1280, 720).cy - L.Stage.ring(3, 0, 1280, 720).ry - 56;
    ok(bandTop >= headFoot, 'a toast comes up under the round line  got ' + bandTop + ' against ' + headFoot);
    ok(bandTop + 64 <= ringTop || bandTop <= headFoot + 6,
       'and clear of the top of the ring  got ' + bandTop + ' against ' + ringTop);
    ok(stage().querySelectorAll('.dstamp').length === 0, 'nothing is stamped onto a pile that has not landed');
    ok(overlay.querySelectorAll('.dname').map((el) => el.textContent).indexOf('Ben · 1') >= 0, 'but the name has the bid');
    const timers = [];
    const realSet = setTimeout;
    global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return realSet(() => {}, 0); };
    try { overlay.fire('pointerdown', { target: overlay, clientX: 200, clientY: 400, pointerId: 1 }); }   // lands it
    finally { global.setTimeout = realSet; }
    ok(L.Stage.S.live && L.Stage.S.live.settled, 'a tap lands the cards');
    timers.filter((t) => t.ms < 1000).forEach((t) => t.fn());
    const stamps = stage().querySelectorAll('.dstamp').map((el) => el.textContent);
    ok(stamps.length === 1 && stamps[0] === '1', 'and the bid that came first is stamped then  got ' + stamps.join(','));
    L.Deal.update({ key: '0:0', bids: [null, 1, 2], turn: 0, text: 'Waiting for Ann to bid' });
    ok(stage().querySelectorAll('.dstamp').length === 2, 'the next one is stamped as it lands');
    ok(asked.some((a) => /\bdstamp\b/.test(a.el.className)), 'stamps move');
    L.Deal.close('deal');
  }

  {   // and left alone, it goes by itself
    const L = load(412, 860, 'full');
    record(L);
    const overlay = L.Stage.parts().overlay;
    const timers = [];
    const realSet = setTimeout;
    global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return realSet(() => {}, 0); };
    try {
      L.Deal.play({ names: ['Ann', 'Ben', 'Cal'], dealer: 0, cards: 3, round: 1,
                    deck: 'physical', mine: 0, hand: [], upcard: null, trump: null, linger: 1000 });
    } finally { global.setTimeout = realSet; }
    const ends = timers.filter((t) => t.ms > 3000);
    ok(ends.length >= 1, 'a scene of its own arms its own end  got ' + timers.map((t) => t.ms).join(','));
    ends.forEach((t) => t.fn());
    const out = overlay._on && overlay._on.pointerdown ? overlay._on.pointerdown.length : 0;
    ok(out === 0, 'and once it has gone a tap on the stage is nobody\'s');
  }

  {   // a phone at a table with real cards: the shuffle plays, and the scene goes before a card is dealt
    const L = load(412, 860, 'full');
    const asked = record(L);
    const overlay = L.Stage.parts().overlay;
    const timers = [];
    const realSet = setTimeout;
    global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return realSet(() => {}, 0); };
    try {
      L.Deal.play({ names: ['Ann', 'Ben', 'Cal'], dealer: 0, cards: 3, round: 1,
                    deck: 'physical', mine: 1, hand: [], upcard: null, trump: null, shuffleOnly: true });
    } finally { global.setTimeout = realSet; }
    const cls = (a) => a.el.className;
    const deck = asked.filter((a) => /\bdeck\b/.test(cls(a)));
    const dealt = asked.filter((a) => /\bdcard\b/.test(cls(a)) && !/\bdeck\b/.test(cls(a)));
    ok(deck.length >= 30, 'the deck is shuffled on screen  got ' + deck.length);
    ok(dealt.length === 0, 'and no card is dealt out  got ' + dealt.length);
    ok(overlay.querySelectorAll('.dname').length === 0, 'no pile is named');
    ok(overlay.querySelectorAll('.dcard.hero').length === 0, 'and nothing is turned for trumps');
    ok(overlay.querySelector('.deal-doing').textContent === 'Ann is dealing…', 'the line says who is dealing');
    const shuffleEnd = Math.max(...deck.map((a) => (a.opts.delay || 0) + (a.opts.duration || 0)));
    const end = timers.filter((t) => t.ms > shuffleEnd);
    ok(end.length >= 1 && Math.min(...end.map((t) => t.ms)) < shuffleEnd + 800,
       'it goes by itself as soon as the shuffle is over  shuffle ends ' + shuffleEnd + ', timers ' + end.map((t) => t.ms).join(','));
    end.forEach((t) => t.fn());
    const out = asked[asked.length - 1];
    ok(out && out.el === overlay && out.kf[1] && out.kf[1].opacity === 0, 'and it fades out');
  }
}
}


part('the finish takes the stage over');

/* On a table dealt on the phones the felt is up when the last round is scored,
   and it hands the game straight to the finish. An overlay faded in from
   nothing shows the page behind it -- the scorecard -- for the length of the
   fade, which reads as being taken to the scores and brought back. */
{
  const spy = (L) => {
    const asked = [];
    L.dom.El.prototype.animate = function (kf, opts) {
      const a = { el: this, kf, opts: opts || {}, cancel() {}, commitStyles() {}, pause() {},
                  play() {}, finish() {}, finished: Promise.resolve(), onfinish: null };
      asked.push(a);
      return a;
    };
    L.dom.El.prototype.getAnimations = () => [];
    return asked;
  };
  const opts = () => ({ names: ['P1', 'P2', 'P3'], totals: [10, 8, 6],
                        awards: [], points: 0, bonus: [0, 0, 0] });
  const overlayFade = (asked, overlay) => {
    const mine = asked.filter((a) => a.el === overlay && a.kf && a.kf[0] && 'opacity' in a.kf[0]);
    return mine[mine.length - 1];         // the last one asked for is the one that holds
  };

  {
    const n = 3, cards = 3, me = 1;
    const made = stateFor(n, cards, me, { bids: [1, null, null], turn: 1 });
    const L = load(412, 860, 'full', true);
    const asked = spy(L);
    L.Felt.sync(made.ST, me, { send: () => {} });
    const overlay = L.dom.document.getElementById('deal');
    ok(!overlay.hidden, 'the felt is on screen when the last round is scored');
    asked.length = 0;
    L.Deal.finale(opts());
    const f = overlayFade(asked, overlay);
    ok(!!f && f.kf[0].opacity === 1 && f.kf[1].opacity === 1,
       'the finish holds the stage at full, so the scorecard is never shown  got '
       + JSON.stringify(f && f.kf));
  }
  {
    const L = load(412, 860, 'full', true);
    const asked = spy(L);
    const overlay = L.Stage.parts().overlay;
    ok(overlay.hidden, 'a screen with nothing up');
    L.Deal.finale(opts());
    const f = overlayFade(asked, overlay);
    ok(!!f && f.kf[0].opacity === 0 && f.kf[1].opacity === 1,
       'is a scene opening, and it fades in  got ' + JSON.stringify(f && f.kf));
  }
}

part('the pages and the stylesheet agree');

/* The page is two halves: the screens on the left, the tools on the right.
   They were one column with the panels folded away under the screens, which
   meant setting a table up and watching it were the same scroll -- open the
   players table and the screens went off the top. */
{
  const dev = fs.readFileSync(path.join(ROOT, 'public/dev.html'), 'utf8');
  ok(/\.devmain\{display:flex;gap/.test(dev), 'the main view is two halves side by side');
  const left = dev.indexOf('class="devleft"'), right = dev.indexOf('class="devright"');
  ok(left > 0 && right > left, 'the screens first, the tools beside them');
  ['host-frame', 'seat-frames'].forEach((id) => {
    const i = dev.indexOf('id="' + id + '"');
    ok(i > left && i < right, id + ' is on the screens side  got ' + i);
  });
  ['players-panel', 'state-panel'].forEach((id) => {
    ok(dev.indexOf('id="' + id + '"') > right, id + ' is on the tools side');
  });
  // One button folds both away, because they are one job and not two panels.
  ok(/id="btn-tools"/.test(dev) && !/id="btn-players"/.test(dev) && !/id="btn-state"[^-]/.test(dev),
     'and one Tools button folds the half away');
  ok(/\.devwrap\.notools \.devright\{display:none\}/.test(dev),
     'which is what gives the screens the whole width');
  /* And puts them in the middle of it. A row left hard against the side the
     tools used to be beside is the same view with a hole in it. */
  ok(/\.devwrap\.notools \.frameset\{justify-content:center;justify-content:safe center\}/.test(dev),
     'and the screens take the middle of what it frees');

  /* In that half the two take turns rather than share it. Stacked, each was
     the other's ceiling: a record is a whole table as text and the seats are
     a row each with a hand under them, and neither had the room it wanted. */
  /* The bar carries the one button every page has, and nothing of its own.
     A select and a half-moon parked on it were this page keeping its own
     settings beside the app's. */
  ok(/id="btn-settings"/.test(dev) && !/id="scale"/.test(dev) && !/id="btn-theme"/.test(dev),
     'the top bar opens the settings page rather than carrying controls');
  ok(/<script src="settings.js">/.test(dev), 'so the page loads it');

  const tabs = dev.indexOf('id="dev-tabs"');
  ok(tabs > right && tabs < dev.indexOf('id="players-panel"'),
     'a tab strip heads the tools half  got ' + tabs);
  ok((dev.match(/class="btn devtab/g) || []).length === 2, 'with a button a table');
  ok(/\.devright\{flex:1 1 50%;overflow:hidden\}/.test(dev),
     'the half itself does not scroll');
  ok(/\.devright > \.panel\{flex:1 1 auto;min-height:0;overflow-y:auto\}/.test(dev),
     'the table on show has the whole height, and scrolls inside itself');
  ok(/\.stbody\{[^}]*flex:1 1 auto/.test(dev),
     'and the record grows into the height it is given');
}

/* The band is how a game is driven, so it does not scroll away from the thing
   it is driving. Both pages that have one are built the same shape: as tall as
   the window less the bar, the screens scrolling inside, the band last and at
   the foot. The dev page had it at the top, where it went off the screen the
   moment there was more to look at than fitted. */
{
  const page = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  [['dev.html', '.devwrap', 'devmain', 'band'],
   ['replay.html', '.replaywrap', 'replay-screen', 'replay-band']].forEach(([f, wrap, above, band]) => {
    const html = page(f);
    const tall = new RegExp(wrap.replace('.', '\\.')
      + '\\{[^}]*height:calc\\(100dvh - var\\(--topbar-h');
    ok(tall.test(html),
       f + ' is as tall as the window less the bar it measured');
    const i = html.indexOf('class="' + above), j = html.lastIndexOf(band + '"');
    ok(i > 0 && j > i, f + ' puts the band under what it drives  got ' + i + ' then ' + j);
  });
  // And the dev band is the last thing in the wrap, not merely late in it.
  const dev = page('dev.html');
  ok(/<div class="panel band" id="band" hidden>[\s\S]*<\/div>\s*<\/div>\s*<script/.test(dev),
     'the dev band is the last thing on the page');
}

/* The felt gives every card on the table a z-index of its own -- a pile card
   its place in the pile, the card in the reader's fingers 30, a bid number
   picked up 40 -- and a stamp with no z-index went under the pile it was
   slammed onto. Every phone at a virtual table missed every golden number. */
{
  const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');
  const rule = /\.dstamp\{([^}]*)\}/.exec(css);
  const z = rule && /z-index:\s*(\d+)/.exec(rule[1]);
  ok(!!z && Number(z[1]) > 40, 'the bid stamp lies over every card on the felt  got ' + (z ? z[1] : 'no z-index'));
}

/* A choice of two or three, side by side, is one thing in this app: a groove
   with the choice sitting in it as a pill. There were two -- the settings
   page's groove, and a framed box with square blocks in it on the dev page
   and the replay band -- doing the same job in two shapes. */
{
  const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');
  const segs = css.match(/\n\.seg\{([^}]*)\}/g) || [];
  ok(!segs.some((r) => /border:1px/.test(r)),
     'a segmented control is a groove, not a framed box  got ' + segs.join(' '));
  const inner = /\n\.seg \.btn\{([^}]*)\}/.exec(css);
  const r = inner && /border-radius:\s*(\d+)px/.exec(inner[1]);
  ok(!!r && Number(r[1]) > 0,
     'and what is in it is rounded  got ' + (r ? r[1] + 'px' : 'no radius'));
  const track = /\n\.seg\{[^}]*border-radius:\s*(\d+)px[^}]*\}/.exec(css);
  const pad = /\n\.seg\{[^}]*padding:\s*(\d+)px/.exec(css);
  ok(!!track && !!pad && Number(r[1]) === Number(track[1]) - Number(pad[1]),
     'by the groove\'s own corner less its padding, so the two are concentric'
     + `  got ${r && r[1]} inside ${track && track[1]} with ${pad && pad[1]} of pad`);
}

/* The gold a bid is stamped in and the gold the dealer is ringed in are the
   same gold: two marks the table makes on the same felt, and two shades of it
   would read as two different kinds of thing. */
{
  const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');
  const colourOf = (sel) => {
    const r = new RegExp('\\n' + sel.replace('.', '\\.') + '\\{([^}]*)\\}').exec(css);
    const c = r && /(?:^|;)\s*color:\s*(#[0-9a-fA-F]{3,8})/.exec(r[1]);
    return c ? c[1].toLowerCase() : null;
  };
  const stamp = colourOf('.dstamp'), ring = colourOf('.dring-tag');
  ok(stamp !== null && stamp === ring,
     `the dealer's ring is the bid stamp's gold  got ${ring} against ${stamp}`);
}

/* The settings page lies over the felt and the deal, and under the toasts:
   a refusal said while it is open -- a photo the table would not take -- has
   to be seen over it. */
{
  const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');
  const zOf = (sel) => { const r = new RegExp('\\n' + sel.replace('.', '\\.') + '\\{([^}]*)\\}').exec(css);
    const z = r && /z-index:\s*(\d+)/.exec(r[1]); return z ? Number(z[1]) : null; };
  const page = zOf('.settings'), toast = zOf('.toaster'), deal = zOf('.deal');   // the felt plays on the deal's overlay
  ok(page !== null && toast !== null && page < toast, `the settings page lies under the toasts  got ${page} vs ${toast}`);
  ok(deal !== null && page > deal, `and over the felt and the deal  got ${page} vs ${deal}`);
}

/* A screen that only shows a table, and a window that only watches a seat,
   cannot press anything on the game -- and the stylesheet does that with one
   rule over every button on the page. The settings page is not the game: it is
   the reader's own theme, text size and full screen, and the way to put a
   table down. It used to be a menu inside the top bar, which that rule already
   let through; as a page of its own over the body every row on it went dead,
   the way back included, and the question it asks went with it. */
{
  const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');
  const rules = css.split('}').map((chunk) => {
    const i = chunk.lastIndexOf('{');
    return i < 0 ? null : { sel: chunk.slice(0, i), body: chunk.slice(i + 1) };
  }).filter(Boolean);
  const inRules = (want, value) => rules.some((r) =>
    r.body.indexOf('pointer-events:' + value) >= 0
    && r.sel.split(',').some((s) => s.trim() === want));
  ['showing', 'watching'].forEach((cls) => {
    if (!inRules(`body.${cls} button`, 'none')) return;      // nothing turned off, nothing to let through
    ok(inRules(`body.${cls} .settings button`, 'auto'),
       `body.${cls}: the settings page can still be pressed`);
    ok(inRules(`body.${cls} dialog button`, 'auto'),
       `body.${cls}: and so can the question it asks`);
  });
}

/* A class on a <body> styles the whole page. One that already means something
   else in the stylesheet turns the page into that thing: `class="sheet"` made
   a page the sheet the table talk opens in -- fixed, over everything, and the
   wrong size. So a class the pages put on a body may only ever be written
   `body.that` in the stylesheet, and never on its own. */
{
  const css = fs.readFileSync(path.join(ROOT, 'public/styles.css'), 'utf8');
  const pages = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html'));
  pages.forEach((file) => {
    const html = fs.readFileSync(path.join(ROOT, 'public', file), 'utf8');
    const m = /<body[^>]*\sclass="([^"]*)"/.exec(html);
    (m ? m[1].split(/\s+/) : []).filter(Boolean).forEach((cls) => {
      const re = new RegExp('(^|[\\s,{}>+~])(body)?\\.' + cls + '(?![\\w-])', 'g');
      let loose = 0, hit;
      while ((hit = re.exec(css))) { if (!hit[2]) loose += 1; }
      ok(loose === 0, `${file}: body class "${cls}" is a page's own, not something else in the stylesheet`);
    });
  });
}

// Every check above is made in this turn, bar the one the felt hands to the
// next; the tally waits for that.
setImmediate(done);
