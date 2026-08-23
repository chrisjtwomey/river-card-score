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
          kind: 'deal', finish, stage, labels, cards: cardEls, landedAt, status, names, dealer,
          key: opts.key || null, settled: false, turn: null, turnAnim: null, calm,
          bids: null,                       // what was on the table at the last update
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

  // Closes a held scene, if one is open. With a kind, 'deal' or 'finale', it
  // closes only that one and leaves the other alone.
  function close(kind) { if (live && (!kind || live.kind === kind)) live.finish(); }
  const isOpen = (kind) => !!live && (!kind || live.kind === kind);

  // The card of the player to act breathes, so the table can see whose turn it
  // is from across the room. The landing used the Web Animations API, and that
  // owns the transform, so this has to be an animation too, not a CSS class.
  function applyTurn() {
    if (!live || live.kind !== 'deal' || !live.settled) return;
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

  /* The finish: the places come up from last to first, then the winner's card
     turns over and the room goes gold.  opts: { names, totals, linger }.
     A tap lands it; the next one closes it. */
  function finale(opts, force) {
    close();
    return new Promise((resolve) => {
      const overlay = overlayEl();
      const stage = overlay.querySelector('.deal-stage');
      const names = (opts && opts.names) || [];
      const totals = (opts && opts.totals) || [];
      const m = force || mode();

      if (!names.length || !stage || !stage.animate) {
        console.warn('[finale] skipped: no players, or no Web Animations API');
        resolve(); return;
      }
      if (m === 'off') { console.info('[finale] skipped: motion is off'); resolve(); return; }
      const calm = m === 'reduced';

      // Best first. A draw shares the place, so the places read 1, 1, 3.
      const order = names.map((nm, i) => ({ nm, v: Number(totals[i]) || 0 })).sort((a, b) => b.v - a.v);
      const best = order[0].v;
      const champs = order.filter((o) => o.v === best);
      const each = champs.length > 1 ? ' each' : '';
      const points = (v) => `${v} point${Math.abs(v) === 1 ? '' : 's'}${each}`;

      stage.innerHTML = '';
      overlay.hidden = false;

      const T = calm
        ? { fade: 120, gap: 90,  flip: 240, hold: 2600, out: 220 }
        : { fade: 200, gap: 240, flip: 620, hold: 5200, out: 320 };
      const anims = [], timers = [];
      let ended = false, settled = false, raf = 0;

      const head = document.createElement('div');            // the line across the top
      head.className = 'deal-head';
      const cap = document.createElement('div');
      cap.className = 'deal-cap';
      cap.textContent = 'Game over';
      head.appendChild(cap);
      stage.appendChild(head);
      anims.push(cap.animate(
        [{ opacity: 0, transform: 'translateY(-12px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 300, delay: T.fade, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'both' }));

      const box = document.createElement('div');
      box.className = 'fin';
      stage.appendChild(box);

      const card = cardEl(null, 'hero fin-card');            // face down until the end
      card.querySelector('.front').innerHTML = '<div class="cup">🏆</div>';
      card.style.transform = 'rotateY(180deg)';
      box.appendChild(card);

      const title = document.createElement('div');
      title.className = 'fin-title';
      title.textContent = champs.length > 1
        ? `${champs.map((c) => c.nm).join(' & ')} tie`
        : `${champs[0].nm} wins`;
      const sub = document.createElement('div');
      sub.className = 'fin-sub';
      box.append(title, sub);

      const list = document.createElement('div');
      list.className = 'fin-list';
      box.appendChild(list);
      const rows = order.map((o, i) => {
        const row = document.createElement('div');
        row.className = 'fin-row' + (o.v === best ? ' first' : '');
        const a = document.createElement('span');
        a.className = 'pl';
        a.textContent = String(order.findIndex((x) => x.v === o.v) + 1);
        const b = document.createElement('span'); b.className = 'nm'; b.textContent = o.nm;
        const c = document.createElement('span'); c.className = 'sc'; c.textContent = String(o.v);
        row.append(a, b, c);
        list.appendChild(row);
        return row;
      });

      anims.push(overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: T.fade, fill: 'both' }));
      anims.push(card.animate(
        calm ? [{ opacity: 0 }, { opacity: 1 }]
             : [{ transform: 'rotateY(180deg) scale(.6)', opacity: 0 },
                { transform: 'rotateY(180deg) scale(1)', opacity: 1 }],
        { duration: calm ? 200 : 380, delay: T.fade, easing: 'cubic-bezier(.2,.9,.3,1.35)', fill: 'both' }));

      // The also-rans come up from the bottom of the list, one at a time.
      const losers = rows.slice(champs.length);
      const start = T.fade + (calm ? 200 : 520);
      losers.forEach((row, k) => {
        anims.push(row.animate(
          calm ? [{ opacity: 0 }, { opacity: 1 }]
               : [{ opacity: 0, transform: 'translateX(30px) scale(.94)' },
                  { opacity: 1, transform: 'none' }],
          { duration: calm ? 160 : 320, delay: start + (losers.length - 1 - k) * T.gap,
            easing: 'cubic-bezier(.2,.9,.3,1.3)', fill: 'both' }));
      });

      // Then the winner. The card turns over: it fills forwards only, so it
      // leaves the card alone until its turn comes.
      const winAt = start + losers.length * T.gap + (calm ? 60 : 260);
      anims.push(card.animate(
        calm ? [{ transform: 'rotateY(0deg) scale(1.16)' }]
             : [{ transform: 'rotateY(180deg) scale(1)', offset: 0 },
                { transform: 'rotateY(0deg) scale(1.3)', offset: .7, easing: 'cubic-bezier(.2,.9,.3,1.4)' },
                { transform: 'rotateY(0deg) scale(1.16)', offset: 1 }],
        { duration: calm ? 200 : T.flip, delay: winAt, easing: 'linear', fill: 'forwards' }));
      rows.slice(0, champs.length).forEach((row, k) => {
        anims.push(row.animate(
          calm ? [{ opacity: 0 }, { opacity: 1 }]
               : [{ opacity: 0, transform: 'scale(.9)' },
                  { opacity: 1, transform: 'scale(1.06)', offset: .6 },
                  { opacity: 1, transform: 'scale(1)' }],
          { duration: calm ? 200 : 520, delay: winAt + (calm ? 40 : 160) + k * 90,
            easing: 'cubic-bezier(.2,.9,.3,1.3)', fill: 'both' }));
      });
      anims.push(title.animate(
        calm ? [{ opacity: 0 }, { opacity: 1 }]
             : [{ opacity: 0, transform: 'scale(.82)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: calm ? 200 : 420, delay: winAt + (calm ? 60 : 240),
          easing: 'cubic-bezier(.2,.9,.3,1.5)', fill: 'both' }));
      anims.push(sub.animate([{ opacity: 0 }, { opacity: 1 }],
        { duration: 260, delay: winAt + (calm ? 120 : 420), easing: 'ease-out', fill: 'both' }));

      if (calm) sub.textContent = points(best);
      else countTo(winAt + 420, 700);
      burst(winAt + 200);

      // The winner's score runs up to the total, so the eye lands on it.
      function countTo(delay, ms) {
        const at = (window.performance ? performance.now() : Date.now()) + delay;
        const tick = (now) => {
          if (ended) return;
          if (settled) { sub.textContent = points(best); return; }
          const k = Math.max(0, Math.min(1, (now - at) / ms));
          if (k <= 0) { raf = requestAnimationFrame(tick); return; }
          sub.textContent = points(Math.round(best * (1 - Math.pow(1 - k, 3))));
          if (k < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }

      // Paper on the table.
      function burst(delay) {
        if (calm) return;
        const colours = ['#e8c169', '#f3efe2', '#2f8f5b', '#c0271d', '#f0c878'];
        const fall = overlay.clientHeight + 80;
        for (let i = 0; i < 26; i++) {
          const bit = document.createElement('div');
          bit.className = 'fin-bit';
          bit.style.background = colours[i % colours.length];
          bit.style.left = `${6 + Math.random() * 88}%`;
          stage.appendChild(bit);
          anims.push(bit.animate(
            [{ transform: 'translate3d(0,0,0) rotate(0deg)', opacity: 1 },
             { transform: `translate3d(${(Math.random() * 2 - 1) * 90}px,${fall}px,0) ` +
                          `rotate(${(Math.random() * 2 - 1) * 900}deg)`, opacity: .15 }],
            { duration: 1500 + Math.random() * 1400, delay: delay + Math.random() * 500,
              easing: 'cubic-bezier(.25,.6,.5,1)', fill: 'both' }));
        }
      }

      function finish() {
        if (ended) return;
        ended = true;
        if (live && live.finish === finish) live = null;
        timers.forEach(clearTimeout);
        if (raf) cancelAnimationFrame(raf);
        overlay.removeEventListener('pointerdown', skip);
        window.removeEventListener('keydown', skip);
        const out = overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T.out, fill: 'both' });
        out.onfinish = () => { overlay.hidden = true; stage.innerHTML = ''; resolve(); };
      }
      function settle() {
        settled = true;
        anims.forEach((a) => { try { a.finish(); } catch (e) {} });
        sub.textContent = points(best);
      }
      function skip() { if (!settled) { settle(); return; } finish(); }

      overlay.addEventListener('pointerdown', skip);
      window.addEventListener('keydown', skip);
      live = { kind: 'finale', finish };
      const linger = Math.max(0, Number(opts && opts.linger) || 0);
      const shown = winAt + T.flip + 400;
      timers.push(setTimeout(() => { settled = true; }, shown));   // now a tap clears it
      timers.push(setTimeout(finish, shown + T.hold + linger));
    });
  }

  // A bid lands: the number slams down onto that player's card, holds, then
  // lifts away. The name below the card keeps it from then on.
  function stamp(p, value) {
    if (!live || live.calm || !live.settled) return;
    const card = live.cards[p], at = live.landedAt[p];
    if (!card || !at || !live.stage.animate) return;

    const el = document.createElement('div');
    el.className = 'dstamp';
    el.textContent = String(value);
    live.stage.appendChild(el);
    const a = el.animate(
      [{ transform: `${at} scale(2.7) rotate(-15deg)`, opacity: 0, offset: 0,
         easing: 'cubic-bezier(.2,.9,.3,1.5)' },
       { transform: `${at} scale(.9) rotate(5deg)`, opacity: 1, offset: .16 },
       { transform: `${at} scale(1.08) rotate(-1deg)`, opacity: 1, offset: .26 },
       { transform: `${at} scale(1) rotate(0deg)`, opacity: 1, offset: .74 },
       { transform: `${at} scale(1.6) rotate(0deg)`, opacity: 0, offset: 1 }],
      { duration: 1200, fill: 'both' });
    a.onfinish = () => el.remove();

    // the card takes the hit, and the name below it pops
    card.animate(
      [{ transform: at }, { transform: `${at} scale(1.13)`, offset: .3 },
       { transform: `${at} scale(.98)`, offset: .55 }, { transform: at }],
      { duration: 420, easing: 'cubic-bezier(.2,.9,.3,1.3)' });
    const name = live.labels[p];
    if (name) {
      name.animate(
        [{ transform: 'translate(-50%,0) scale(1)' },
         { transform: 'translate(-50%,0) scale(1.22)', offset: .35 },
         { transform: 'translate(-50%,0) scale(1)' }],
        { duration: 420, easing: 'cubic-bezier(.2,.9,.3,1.3)' });
    }
  }

  // While the scene is held, show the bids as they arrive.
  function update(o) {
    if (o) last = o;
    if (!live || live.kind !== 'deal') return;
    const bids = (o && o.bids) || [];
    // Anything new since the last push gets stamped on its card. A scene that
    // has just opened has nothing to compare with, so it stamps nothing.
    if (live.bids) {
      bids.forEach((b, p) => {
        const had = live.bids[p];
        if (b === null || b === undefined) return;
        if (had !== null && had !== undefined) return;
        stamp(p, b);
      });
    }
    live.bids = bids.slice();
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

  return { play, finale, close, update, isOpen, mode };
})();
