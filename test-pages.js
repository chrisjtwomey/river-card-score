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

function makeDom(W, H) {
  const listeners = [];
  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = []; this.parentNode = null;
      this.style = { setProperty() {}, removeProperty() {} };
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
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    insertBefore(c, ref) {
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
    createElement: (t) => new El(t),
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
  const store = {};
  const localStorage = { getItem: (k) => (k in store ? store[k] : null),
                        setItem: (k, v) => { store[k] = String(v); },
                        removeItem: (k) => { delete store[k]; } };
  return { document, window, localStorage, El };
}


const ROOT = __dirname;

function load(W, H, motion) {
  const dom = makeDom(W, H);
  dom.localStorage.setItem('river-card-score:motion:v1', motion || 'off');
  const src = ['public/ui.js', 'public/stage.js', 'public/deal.js', 'public/felt.js']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
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
  const fn = new Function('window', 'document', 'localStorage', 'Game', 'Avatar', 'Finale', 'Chat', 'console',
    src + '\n; return { UI, Stage, Deal, Felt };');
  return Object.assign({ dom, talk }, fn(dom.window, dom.document, dom.localStorage, Game, Avatar, Finale, Chat,
    { log() {}, info() {}, warn() {}, error(...a) { throw new Error('console.error: ' + a.join(' ')); } }));
}

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
    play: { turn: 'pturn' in o ? o.pturn : null, trick: o.trick || [], won: o.won || Array(n).fill(0),
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
  ok(stacks.length === 1, `a trick gathered leaves one card on the winner's stack (${stacks.length})`);
  ok(spotOf(stacks[0]).scale < 0.6, 'drawn small, out of the way');
  ok(spotOf(stacks[0]).face === 180, 'and face down');
  ok(count() === all - 3, 'and the other three cards of it are off the table');
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
                           clientY: H / 2 + F.at(0).y - B.foot - size / 2 }),
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
  ok(Number(/([\d]+)px/.exec(t.head().style.bottom)[1]) >= t.L.Stage.bidRow(t.W).up,
    'and stands clear of a number lifted under a thumb');
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

// the numbers must not sit on the heading above the fan
{
  for (const [W, H] of [[360, 640], [412, 860], [500, 860], [760, 1000]]) {
    for (const cards of [1, 5, 7, 13]) {
      const n = 4, me = 1;
      if (cards > Game.maxCardsFor(n)) continue;
      const made = stateFor(n, cards, me, { phase: 'bid', turn: me });
      const L = load(W, H, 'off');
      L.Felt.sync(made.ST, me, { send: () => {} });
      const overlay = L.dom.document.getElementById('deal');
      const F = L.Stage.fan(cards, W, H);
      const B = L.Stage.bidRow(W);
      const size = B.size;
      const foot = F.at(0).y - B.foot;             // the rail sits on this line
      const label = F.at(0).y - 66;                // and the heading starts here
      ok(foot + 4 < label, `${W}x${H} c=${cards}: the numbers clear "Your hand"`);
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
  const head = F.at(0).y - B.foot - B.head - 15;       // the top of the block
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

/* A round is scored and the next dealt in the same breath, so what the round
   paid is held up over the trick that ended it. */
function scored(motion) {
  const n = 4, cards = 5, me = 1;
  const first = stateFor(n, cards, me, { phase: 'tricks', turn: null, pturn: me, bids: [1, 2, 1, 1] });
  const L = load(412, 860, motion);
  L.Felt.sync(first.ST, me, { send: () => {} });
  const next = stateFor(n, 4, me, { phase: 'bid', turn: 2 }).ST;
  next.idx = 1;
  next.rounds = [{ cards, dealer: 0, trump: 'H', bids: [1, 2, 1, 1], tricks: [1, 0, 2, 2] },
                 next.rounds[0]];
  L.Felt.sync(next, me, { send: () => {} });
  const overlay = L.dom.document.getElementById('deal');
  return { L, overlay, beat: () => overlay.querySelector('.felt-beat') };
}
{
  const t = scored('off');
  ok(!t.beat() || t.beat().hidden, 'with animations off the round is not held up');
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
  setTimeout(() => {
    ok(t.beat().hidden, 'then the moment passes');
    ok(t.overlay.querySelector('.deal-stage').querySelectorAll('.dcard.mine').length === 4,
      'and the next hand is on the table');
    done();
  }, 2400);
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
  const t = tookTrick('off');
  ok(!t.beat() || t.beat().hidden, 'with animations off nothing is said');
  ok(t.stage.querySelectorAll('.dcard.took').length === 1, 'and the trick lies there as it always did');
}

part('the settings menu');

/* The ⚙ menu, and the one thing about it that is easy to get wrong: the button
   that opens it holds a drawn icon, so a tap on it lands on the icon and not on
   the button. */
{
  const dom = makeDom(412, 860);
  dom.localStorage.setItem('river-card-score:motion:v1', 'off');
  const src = fs.readFileSync(path.join(ROOT, 'public/ui.js'), 'utf8');
  const UI = new Function('window', 'document', 'localStorage', 'console',
    src + '\n; return UI;')(dom.window, dom.document, dom.localStorage,
    { log() {}, info() {}, warn() {}, error() {} });

  const bar = dom.document.createElement('div');
  dom.document.body.appendChild(bar);
  const btn = dom.document.createElement('button');
  const icon = dom.document.createElement('span');     // stands for the drawn icon
  btn.appendChild(icon);
  bar.appendChild(btn);

  let ran = 0;
  const menu = UI.settingsMenu(btn, [
    { kind: 'action', label: 'Do the thing', run: () => { ran += 1; } },
  ]);
  const box = () => bar.querySelector('.menu');
  ok(!!box() && box().hidden, 'the menu starts shut');

  btn.fire('click');
  ok(!box().hidden, 'the button opens it');
  ok(btn.getAttribute('aria-expanded') === 'true', 'and says so');

  // the tap that opens it lands on the icon, and the page hears it too
  dom.document.fire('pointerdown', { target: icon });
  btn.fire('click');
  ok(box().hidden, 'and the same button closes it, tapped on its icon');
  ok(btn.getAttribute('aria-expanded') === 'false', 'and says that too');

  btn.fire('click');
  ok(!box().hidden, 'it opens again');
  dom.document.fire('pointerdown', { target: dom.document.body });
  ok(box().hidden, 'a tap anywhere else closes it');

  btn.fire('click');
  box().querySelector('.menu-row').fire('click');
  ok(ran === 1 && box().hidden, 'and a row does its thing and closes it');
  ok(typeof menu.refresh === 'function', 'the page can ask it to redraw');
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
  ok(/plays that hand/.test(said[0]), 'and it says what the table does about it  got ' + said[0]);

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

/* ---- the two pages that lost the game ----

   The front page offered one table and one only; the host screen made a new
   table whenever the browser did not already hold a host token, which is how a
   television came to invent a table nobody was sitting at. Both are checked
   here against a document that answers any selector, which is enough to see
   what the page builds and what it puts on the wire. */
part('the front page, and the screen');
{
  const anything = new Proxy(function () {}, {
    get: (t, k) => (k === 'then' ? undefined : anything),
    apply: () => anything,
    construct: () => anything,
  });

  function loadPage(file, seed, search) {
    const dom = makeDom(412, 860);
    Object.keys(seed || {}).forEach((k) => dom.localStorage.setItem(k, seed[k]));
    const els = {};
    const pick = (sel) => (els[sel] || (els[sel] = new dom.El('div')));
    dom.document.querySelector = pick;
    dom.document.getElementById = (id) => pick('#' + id);
    const gone = [];
    const location = { protocol: 'http:', host: 'table', hostname: 'table', pathname: '/' + file,
                       search: search || '', hash: '',
                       get href() { return this._h; }, set href(v) { this._h = v; gone.push(v); } };
    const history = { replaceState: (a, b, u) => { history.url = u; } };
    const socks = [];
    function WebSocket(url) { this.url = url; this.readyState = 1; this.sent = []; socks.push(this); }
    WebSocket.prototype.send = function (raw) { this.sent.push(JSON.parse(raw)); };
    WebSocket.prototype.close = function () { this.readyState = 3; };
    const src = fs.readFileSync(path.join(ROOT, 'public/net.js'), 'utf8') + '\n;\n'
              + fs.readFileSync(path.join(ROOT, 'public/' + file), 'utf8');
    const names = ['UI', 'Scan', 'Avatar', 'Chat', 'Deal', 'Games', 'Table', 'Accolades', 'Finale', 'Stage', 'Felt', 'Lobby', 'Round'];
    const fn = new Function('window', 'document', 'localStorage', 'location', 'history', 'WebSocket',
      'Game', 'console', ...names, src + '\n; return { Net };');
    const out = fn(dom.window, dom.document, dom.localStorage, location, history, WebSocket, Game,
      { log() {}, info() {}, warn() {}, error() {} }, ...names.map(() => anything));
    return Object.assign(out, { dom, pick, gone, socks,
      start: () => dom.document.fire('DOMContentLoaded') });
  }

  const two = JSON.stringify([
    { code: 'BBBB', token: 'tb', role: 'player', seatId: 'sb' },
    { code: 'AAAA', token: 'ta', role: 'player', seatId: 'sa' },
  ]);

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

  {   // the name this phone plays under is asked for once
    const P = loadPage('join.js', { 'rcs:name:v1': 'Chris' });
    P.start();
    ok(P.pick('#in-name').value === 'Chris' && P.pick('#new-name').value === 'Chris',
       'the name this phone played under is already there  got ' + P.pick('#in-name').value);
    const Q = loadPage('join.js', {});
    Q.start();
    ok(Q.pick('#in-name').value === undefined || Q.pick('#in-name').value === '',
       'and a phone that has not played is asked');
    Q.pick('#in-code').value = 'AB2K';
    Q.pick('#in-name').value = 'Ann';
    Q.pick('#btn-join').fire('click');
    ok(Q.Net.name() === 'Ann', 'the name a seat was taken under is kept  got ' + Q.Net.name());
  }

  {   // a table that is not there any more says so
    const P = loadPage('join.js',
      { 'rcs:tables:v1': JSON.stringify([{ code: 'AAAA', token: 'ta', role: 'player', seatId: 'sa' }]) },
      '?gone=AAAA');
    P.start();
    ok(/AAAA is over/.test(P.pick('#join-err').textContent),
       'a table that has ended says so, instead of a silent bounce  got '
       + JSON.stringify(P.pick('#join-err').textContent));
    ok(!P.Net.tables().some((t) => t.code === 'AAAA'), 'and it is not offered again');
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
  const uiReal = { fx, ask: () => ({ then: (f) => f(true) }), keepAwake: () => ({ then: () => {} }) };
  const UI = new Proxy(uiReal, { get: (t, k) => (k in t ? t[k] : anything) });

  function playPage(seed, search) {
    const dom = makeDom(412, 860);
    Object.keys(seed || {}).forEach((k) => dom.localStorage.setItem(k, seed[k]));
    const els = {};
    const pick = (sel) => (els[sel] || (els[sel] = new dom.El(sel === '#bid-chips' ? 'div' : 'div')));
    dom.document.querySelector = pick;
    dom.document.getElementById = (id) => pick('#' + id);
    const gone = [];
    const location = { protocol: 'http:', host: 'table', hostname: 'table', pathname: '/play.html',
                       search: search || '', hash: '',
                       get href() { return this._h; }, set href(v) { this._h = v; gone.push(v); } };
    const history = { replaceState: (a, b, u) => { history.url = u; } };
    const socks = [];
    function WebSocket(url) { this.readyState = 1; this.sent = []; socks.push(this); }
    WebSocket.prototype.send = function (raw) { this.sent.push(JSON.parse(raw)); };
    WebSocket.prototype.close = function () { this.readyState = 3; };
    const Table = new Function('UI', 'Game', 'document',
      fs.readFileSync(path.join(ROOT, 'public/table.js'), 'utf8') + '\n; return Table;')(UI, Game, dom.document);
    const src = ['public/lobby.js', 'public/round.js', 'public/net.js', 'public/play.js']
      .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
    const stubs = ['Scan', 'Avatar', 'Chat', 'Deal', 'Games', 'Accolades', 'Finale', 'Stage', 'Felt'];
    const fn = new Function('window', 'document', 'localStorage', 'location', 'history', 'WebSocket',
      'Game', 'UI', 'Table', 'console', ...stubs, src + '\n; return { Net };');
    const out = fn(dom.window, dom.document, dom.localStorage, location, history, WebSocket, Game, UI, Table,
      { log() {}, info() {}, warn() {}, error() {} }, ...stubs.map(() => anything));
    dom.document.fire('DOMContentLoaded');
    if (socks[0]) {
      socks[0].onopen();
      socks[0].onmessage({ data: JSON.stringify({ t: 'hello', role: 'player', code: 'TEST', seatId: 's0' }) });
    }
    return Object.assign(out, { dom, pick, gone, socks, said,
      feed: (st) => { try { socks[0].onmessage({ data: JSON.stringify(st) }); }
                      catch (e) { console.log('  (the page threw: ' + e.message + ')'); throw e; } } });
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
    ok(P.pick('#bids-panel').hidden === true, 'no bids strip: the felt stamps them');
    ok(P.pick('#leave-row').hidden === false, 'leaving is at the top of the page');
    const sc = P.dom.document.querySelector('.scorecard-panel');
    ok(sc && sc.classList.contains('pinned') && sc.open === true,
       'and the scorecard is open, not folded away');
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

  {   // handing a seat to the table for good
    const P = playPage(seed, '?c=TEST');
    P.feed(table({}));
    ok(P.pick('#playout-row').hidden === false, 'the host can hand the empty seat to the table');
    ok(P.pick('#playout-row').querySelector('.btn').textContent === "Let the table play Cal's hand",
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

  {   // a scene of its own (a phone at a table with real cards): tap, tap, gone
    const L = load(412, 860, 'full');
    const asked = record(L);
    const overlay = L.Stage.parts().overlay;
    const p = L.Deal.play({
      names: ['Ann', 'Ben', 'Cal'], dealer: 0, cards: 3, round: 1,
      deck: 'physical', mine: 1, hand: [], upcard: null, trump: null, linger: 1000,
    });
    let threw = null;
    try {
      overlay.fire('pointerdown', { target: overlay, clientX: 200, clientY: 400, pointerId: 1 });
      overlay.fire('pointerdown', { target: overlay, clientX: 200, clientY: 400, pointerId: 1 });
    } catch (e) { threw = e; }
    ok(!threw, 'two taps close a scene without throwing  ' + (threw ? threw.message : ''));
    const out = asked[asked.length - 1];
    ok(out && out.el === overlay && out.kf[1] && out.kf[1].opacity === 0, 'the last thing asked for is the fade out');
    if (out && out.onfinish) out.onfinish();
    ok(overlay.hidden, 'and the overlay is gone after it');
    p.then(() => ok(true, 'the scene\'s promise settles'));
  }
}


part('the pages and the stylesheet agree');

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
