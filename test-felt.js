'use strict';
/* The felt, checked without a browser.

   The table is geometry and gestures: where a card lies, which card the thumb
   is on, what a push up out of the fan does, and what a card that may not be
   played does instead. None of that needs a server, and none of it can be seen
   from the integration tests -- so it is checked here, against a page just big
   enough for the felt to draw into.

   Run it with `node test-felt.js`, or with `npm test`, which runs both.
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
      this.style = {}; this._cls = new Set(); this._text = '';
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
    append(...cs) { cs.forEach((c) => this.appendChild(c)); }
    remove() { if (!this.parentNode) return; const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null; }
    addEventListener(t, f) { (this._on || (this._on = {}))[t] = ((this._on || {})[t] || []).concat([f]); }
    removeEventListener(t, f) { if (this._on && this._on[t]) this._on[t] = this._on[t].filter((g) => g !== f); }
    fire(t, evt) { ((this._on || {})[t] || []).slice().forEach((f) => f(Object.assign({ type: t, preventDefault() {}, stopPropagation() {} }, evt))); }
    setPointerCapture() {}
    releasePointerCapture() {}
    setAttribute(k, v) { if (k === 'id') this.id = v; this['attr_' + k] = v; }
    getAttribute(k) { return this['attr_' + k]; }
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
    querySelector(sel) { return this.all().find((e) => e.matches(sel)) || null; }
    querySelectorAll(sel) { const r = this.all().filter((e) => e.matches(sel)); r.forEach = Array.prototype.forEach.bind(r); return r; }
  }
  const body = new El('body');
  const document = {
    body,
    createElement: (t) => new El(t),
    getElementById: (id) => body.all().find((e) => e.id === id) || null,
    querySelector: (sel) => {
      const m = /^#([\w-]+)\s+\.([\w-]+)$/.exec(sel);
      if (m) { const host = document.getElementById(m[1]); return host ? host.querySelector('.' + m[2]) : null; }
      return body.querySelector(sel);
    },
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    addEventListener: () => {},
  };
  const window = {
    innerWidth: W, innerHeight: H,
    addEventListener: (t, f) => listeners.push([t, f]),
    matchMedia: () => ({ matches: false }),
    location: { search: '' },
    fire: (t) => listeners.filter((l) => l[0] === t).forEach((l) => l[1]()),
  };
  const store = {};
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  return { document, window, localStorage, El };
}


const ROOT = __dirname;

function load(W, H, motion) {
  const dom = makeDom(W, H);
  dom.localStorage.setItem('river-card-score:motion:v1', motion || 'off');
  const src = ['public/stage.js', 'public/deal.js', 'public/felt.js']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
  const Avatar = { url: () => null };
  const Finale = { play: () => Promise.resolve() };
  const fn = new Function('window', 'document', 'localStorage', 'Game', 'Avatar', 'Finale', 'console',
    src + '\n; return { Stage, Deal, Felt };');
  return Object.assign({ dom }, fn(dom.window, dom.document, dom.localStorage, Game, Avatar, Finale,
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
  L.Felt.sync(made.ST, me, { send: (m) => sends.push(m), watch: false, onView: () => {} });
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
  L.Felt.sync(made.ST, me, { send: (m) => sends.push(m) });
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
  L.Felt.sync(made.ST, me, { send: (m) => sends.push(m), watch: true });
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

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
