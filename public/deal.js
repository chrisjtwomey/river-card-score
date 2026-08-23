'use strict';
/* The deal flourish: a card flies to each seat, then a card turns over.
   Used by the offline tracker and by the host screen. */
const Deal = (function () {
  const KEY_MOTION = 'river-card-score:motion:v1';
  let live = null;        // the scene on screen, while it is held open
  let last = null;        // the last status shown, to restore it on re-open
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const FACES = [{ g: '♠', red: false }, { g: '♥', red: true }, { g: '♦', red: true }, { g: '♣', red: false }];

  // 'full' | 'reduced' | 'off'.  ?motion=full in the URL wins and is remembered.
  function mode() {
    let saved = null;
    try { saved = localStorage.getItem(KEY_MOTION); } catch (e) {}
    const q = new URLSearchParams(window.location.search).get('motion');
    if (q === 'full' || q === 'reduced' || q === 'off') {
      saved = q;
      try { localStorage.setItem(KEY_MOTION, q); } catch (e) {}
    }
    if (saved) return saved;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return reduce ? 'reduced' : 'full';
  }

  function shuffledFaces(n) {
    const deck = [];
    FACES.forEach((s) => RANKS.forEach((r) => deck.push({ r, s })));
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    return deck.slice(0, n);
  }

  function cardEl(face, cls) {
    const el = document.createElement('div');
    el.className = 'dcard' + (cls ? ' ' + cls : '');
    const front = document.createElement('div');
    front.className = 'face front' + (face && face.s.red ? ' red' : '');
    if (face) {
      front.innerHTML = '<span class="r"></span><span class="big"></span>';
      front.querySelector('.r').textContent = face.r;
      front.querySelector('.big').textContent = face.s.g;
    }
    const back = document.createElement('div');
    back.className = 'face back';
    el.append(front, back);
    return el;
  }

  function overlayEl() {
    let el = document.getElementById('deal');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'deal';
    el.className = 'deal';
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="deal-stage" id="deal-stage"></div><div class="deal-skip">tap to skip</div>';
    document.body.appendChild(el);
    return el;
  }

  /* opts: { names, dealer, cards, round, hold, linger }.
     linger adds milliseconds to the pause before it clears itself.
     With hold, the scene stays on screen after the deal, until close() is
     called, so the table can see the hand while the bids come in.
     A tap, a click, or a key ends the deal early; a second one closes it. */
  function play(opts, force) {
    close();
    return new Promise((resolve) => {
      const overlay = overlayEl();
      const stage = overlay.querySelector('.deal-stage');
      const names = (opts && opts.names) || [];
      const n = names.length;
      const cards = (opts && opts.cards) || 1;
      const dealer = (opts && opts.dealer) || 0;
      const m = force || mode();

      if (!n || !stage || !stage.animate) {
        console.warn('[deal] skipped: no players, or no Web Animations API');
        resolve(); return;
      }
      if (m === 'off') { console.info('[deal] skipped: motion is off'); resolve(); return; }
      const calm = m === 'reduced';
      if (calm) {
        console.info('[deal] short version: this device asks for reduced motion. ' +
          'Add ?motion=full to the URL for the full deal, or run playDeal().');
      }

      stage.innerHTML = '';
      overlay.hidden = false;

      const W = overlay.clientWidth, H = overlay.clientHeight;
      const rx = Math.min(W * 0.33, 250), ry = Math.min(H * 0.27, 160);
      const seat = (p) => {                       // seat 0 sits at the bottom
        const a = (Math.PI / 2) + (p * 2 * Math.PI / n);
        return { x: Math.cos(a) * rx, y: Math.sin(a) * ry };
      };

      const T = calm
        ? { fade: 120, deckPop: 140, start: 120, gap: 45, fly: 200, flip: 200, hold: 320, out: 220 }
        : { fade: 160, deckPop: 200, start: 220, gap: 80, fly: 360, flip: 380, hold: 520, out: 280 };
      const anims = [], timers = [];
      const labels = [], cardEls = [], landedAt = [];
      const hold = !!(opts && opts.hold);
      let ended = false, settled = false;

      for (let i = 0; i < 3; i++) {               // the deck, face down in the middle
        const d = cardEl(null, 'deck');
        const rest = `translate3d(0,0,0) rotate(${(i - 1) * 4}deg) rotateY(180deg)`;
        d.style.transform = rest;
        stage.appendChild(d);
        anims.push(d.animate(
          calm
            ? [{ transform: rest, opacity: 0 }, { transform: rest, opacity: 1 }]
            : [{ transform: rest + ' scale(.5)', opacity: 0 }, { transform: rest + ' scale(1)', opacity: 1 }],
          { duration: T.deckPop, delay: i * 40, easing: calm ? 'ease-out' : 'cubic-bezier(.2,.9,.3,1.4)', fill: 'both' }
        ));
      }

      const faces = shuffledFaces(n);
      for (let step = 1; step <= n; step++) {     // dealing order: left of the dealer first
        const p = (dealer + step) % n;
        const { x, y } = seat(p);
        const tilt = (x / (rx || 1)) * 9;
        const delay = T.start + (step - 1) * T.gap;

        const card = cardEl(faces[step - 1]);
        card.style.opacity = '0';
        stage.appendChild(card);
        const landed = `translate3d(${x}px,${y}px,0) rotate(${tilt}deg) rotateY(0deg) scale(1)`;
        cardEls[p] = card;
        landedAt[p] = landed;
        anims.push(card.animate(
          calm
            ? [{ transform: landed, opacity: 0 }, { transform: landed, opacity: 1 }]
            : [{ transform: 'translate3d(0,0,0) rotate(0deg) rotateY(180deg) scale(.9)', opacity: 1, offset: 0 },
               { transform: `translate3d(${x * 0.55}px,${y * 0.55 - 26}px,0) rotate(${tilt * 0.6}deg) rotateY(90deg) scale(1.06)`, opacity: 1, offset: .55 },
               { transform: landed, opacity: 1, offset: 1 }],
          { duration: T.fly, delay, easing: calm ? 'ease-out' : 'cubic-bezier(.25,.8,.3,1)', fill: 'both' }
        ));

        const name = document.createElement('div');
        name.className = 'dname';
        name.textContent = names[p];
        labels[p] = name;
        name.style.left = `calc(50% + ${x}px)`;
        name.style.top = `calc(50% + ${y + 56}px)`;
        stage.appendChild(name);
        anims.push(name.animate(
          [{ opacity: 0, transform: 'translate(-50%,6px)' }, { opacity: 1, transform: 'translate(-50%,0)' }],
          { duration: 220, delay: delay + T.fly - 120, easing: 'ease-out', fill: 'both' }
        ));
      }

      const dealEnd = T.start + (n - 1) * T.gap + T.fly;
      const hero = cardEl(null, 'hero');
      hero.querySelector('.front').innerHTML =
        '<div class="quad"><span>♠</span><span>♥</span><span>♦</span><span>♣</span></div>';
      hero.style.transform = calm ? 'rotateY(0deg)' : 'rotateY(180deg)';
      stage.appendChild(hero);
      anims.push(hero.animate(
        calm
          ? [{ transform: 'translate3d(0,0,0) rotateY(0deg) scale(1.15)', opacity: 0 },
             { transform: 'translate3d(0,0,0) rotateY(0deg) scale(1.15)', opacity: 1 }]
          : [{ transform: 'translate3d(0,0,0) rotateY(180deg) scale(.8)' },
             { transform: 'translate3d(0,0,0) rotateY(0deg) scale(1.15)' }],
        { duration: T.flip, delay: dealEnd + 140, easing: calm ? 'ease-out' : 'cubic-bezier(.2,.9,.3,1.3)', fill: 'both' }
      ));

      // The round line sits across the top of the screen, clear of the cards.
      const head = document.createElement('div');
      head.className = 'deal-head';
      stage.appendChild(head);

      const cap = document.createElement('div');
      cap.className = 'deal-cap';
      cap.textContent = `Round ${opts.round || 1} · ${cards} card${cards === 1 ? '' : 's'} · ${names[dealer]} deals`;
      head.appendChild(cap);
      anims.push(cap.animate(
        [{ opacity: 0, transform: 'translateY(-10px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 300, delay: dealEnd + 260, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'both' }
      ));

      const status = document.createElement('div');
      status.className = 'deal-status';
      head.appendChild(status);
      if (hold) {
        anims.push(status.animate(
          [{ opacity: 0 }, { opacity: 1 }],
          { duration: 260, delay: dealEnd + 380, easing: 'ease-out', fill: 'both' }
        ));
      }

      anims.push(overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: T.fade, fill: 'both' }));

      function finish() {
        if (ended) return;
        ended = true;
        if (live && live.finish === finish) live = null;
        timers.forEach(clearTimeout);
        overlay.removeEventListener('pointerdown', skip);
        window.removeEventListener('keydown', skip);
        const out = overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T.out, fill: 'both' });
        out.onfinish = () => { overlay.hidden = true; stage.innerHTML = ''; resolve(); };
      }
      function settle() { settled = true; anims.forEach((a) => { try { a.finish(); } catch (e) {} }); }
      function skip() {
        if (hold && !settled) { settle(); return; }   // first tap lands the deal
        settle(); finish();                            // the next one closes it
      }

      overlay.addEventListener('pointerdown', skip);
      window.addEventListener('keydown', skip);
      const linger = Math.max(0, Number(opts && opts.linger) || 0);
      const naturalEnd = dealEnd + 140 + T.flip + T.hold + linger;
      if (hold) {
        live = {
          finish, labels, cards: cardEls, landedAt, status, names, dealer,
          key: opts.key || null, settled: false, turn: null, turnAnim: null, calm,
        };
        timers.push(setTimeout(() => {
          settled = true;
          if (live) { live.settled = true; applyTurn(); }   // now the cards have landed
        }, naturalEnd - T.hold));
        if (last && last.key === live.key) update(last);   // re-opened: catch up
      } else {
        timers.push(setTimeout(finish, naturalEnd));
      }
    });
  }

  // Closes a held scene, if one is open.
  function close() { if (live) live.finish(); }
  const isOpen = () => !!live;

  // The card of the player to act breathes, so the table can see whose turn it
  // is from across the room. The landing used the Web Animations API, and that
  // owns the transform, so this has to be an animation too, not a CSS class.
  function applyTurn() {
    if (!live || !live.settled) return;
    if (live.turnAnim) { try { live.turnAnim.cancel(); } catch (e) {} live.turnAnim = null; }
    const p = live.turn;
    const card = (p === null || p === undefined) ? null : live.cards[p];
    if (!card || live.calm) return;                 // reduced motion: the label is enough
    // The card tips up on its edge, shivers while it is up, settles, then
    // waits. Written in milliseconds, because that is how it is judged.
    const UP = 182, SHIVER_IN = 280, SHIVER_OUT = 784, SIDE = 84, DOWN_AT = 868, FLAT = 1050;
    const D = 3000;                                 // one peek every three seconds
    const at = live.landedAt[p];
    const o = (ms) => Number((ms / D).toFixed(4));
    const rest = 'drop-shadow(0 5px 9px rgba(0,0,0,.45)) drop-shadow(0 0 5px rgba(255,255,255,.22))';
    const up = 'drop-shadow(0 16px 18px rgba(0,0,0,.55)) drop-shadow(0 0 12px rgba(255,255,255,.4))';
    const tip = `${at} translateY(-11px) rotateX(-26deg)`;

    const frames = [
      { transform: at, filter: rest, offset: 0, easing: 'cubic-bezier(.3,.7,.35,1)' },
      { transform: tip, filter: up, offset: o(UP), easing: 'linear' },
    ];
    for (let ms = SHIVER_IN, i = 0; ms <= SHIVER_OUT; ms += SIDE, i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      frames.push({
        transform: `${tip} translateX(${dir * 3}px) rotate(${dir * 1.2}deg)`,
        filter: up, offset: o(ms), easing: 'linear',
      });
    }
    frames.push({ transform: tip, filter: up, offset: o(DOWN_AT), easing: 'cubic-bezier(.45,0,.55,1)' });
    frames.push({ transform: at, filter: rest, offset: o(FLAT) });
    frames.push({ transform: at, filter: rest, offset: 1 });
    live.turnAnim = card.animate(frames, { duration: D, iterations: Infinity });
  }

  // While the scene is held, show the bids as they arrive.
  function update(o) {
    if (o) last = o;
    if (!live) return;
    const bids = (o && o.bids) || [];
    live.labels.forEach((el, p) => {
      if (!el) return;
      const b = bids[p];
      el.textContent = live.names[p] + (b === null || b === undefined ? '' : ` · ${b}`);
      el.classList.toggle('turn', o && o.turn === p);
      el.classList.toggle('bidin', b !== null && b !== undefined);
    });
    if (live.status) live.status.textContent = (o && o.text) || '';
    const next = (o && typeof o.turn === 'number') ? o.turn : null;
    if (next !== live.turn) { live.turn = next; applyTurn(); }
  }

  return { play, close, update, isOpen, mode };
})();
