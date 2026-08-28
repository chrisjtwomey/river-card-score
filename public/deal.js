'use strict';
/* The deal flourish: a card flies to each seat, then a card turns over.
   Used by the host screen and the player phones.

   The overlay, the card, the fade and the motion setting are the Stage's, and
   so is the slot for whichever scene is open. The finish is in finale.js.
*/
const Deal = (function () {
  const { S, faceOf, cardEl, tf, fade, parts, close } = Stage;
  let last = null;        // the last status shown, to restore it on re-open


  /* opts: { names, dealer, cards, round, hold, linger, deck, mine, hand,
     upcard, trump, avatars }.
     The deck is shuffled and cut on screen, and the whole hand is dealt round
     the table, face down. With deck 'virtual' the turned card is the real one
     and your own cards land face up: `mine` is the seat watching, `hand` the
     cards it was given. With real cards the scene deals straight through:
     the real deck on the real table is the one that matters, and nothing on
     screen waits for anybody.
     linger adds milliseconds to the pause before it clears itself.
     With hold, the scene stays on screen after the deal, until close() is
     called, so the table can see the hand while the bids come in.
     With keep, the scene never closes itself at all: once the cards are down
     it hands the stage over to onTable() and the table plays on it for the
     rest of the round. A tap still lands the deal, and only that.
     A tap, a click, or a key ends the deal early; a second one closes it. */
  /* A scene that throws half-built is worse than no scene at all. The overlay
     is already up, and the tap that closes it is bound at the end of the
     build, so a throw leaves a screen the player cannot get past. Whatever
     goes wrong, the stage comes down. */
  function play(opts, force) {
    return build(opts, force).catch((e) => {
      console.error('[deal] the scene failed to build:', e);
      const { overlay, stage } = parts();
      S.live = null;
      overlay.hidden = true;
      if (stage) stage.innerHTML = '';
    });
  }

  function build(opts, force) {
    close();
    return new Promise((resolve) => {
      const { overlay, stage, skip: skipEl } = parts();
      overlay.classList.remove('solid');
      const names = (opts && opts.names) || [];
      const n = names.length;
      const cards = (opts && opts.cards) || 1;
      const dealer = (opts && opts.dealer) || 0;
      const m = force || UI.motion();
      const virtual = !!(opts && opts.deck === 'virtual');
      const mine = (opts && typeof opts.mine === 'number' && opts.mine >= 0) ? opts.mine : -1;
      const myHand = (virtual && opts && opts.hand) || [];
      // A picture per seat, or nothing. It rides on the last card that seat is
      // dealt -- the one on top of its pile. The cards under it keep the back
      // every other card has.
      const avatars = (opts && opts.avatars) || [];
      const upFace = virtual ? faceOf(opts && opts.upcard) : null;
      const trumpK = (!virtual && opts && opts.trump) ? String(opts.trump) : null;

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
      // The seat watching sits at the bottom, so the cards come to them. On a
      // screen that belongs to nobody that is seat 0, as before.
      const anchor = mine >= 0 ? mine : 0;
      // Where the seats sit is the Stage's answer, so the table that carries
      // on after this scene stands in the same places.
      const R = Stage.ring(n, anchor, W, H);
      const rx = R.rx, ry = R.ry, seat = R.at;

      const T = calm
        ? { fade: 120, deckPop: 140, start: 120, gap: 45, fly: 200, flip: 200, hold: 320, out: 220 }
        : { fade: 160, deckPop: 200, start: 220, gap: 80, fly: 360, flip: 380, hold: 520, out: 280 };
      const anims = [], timers = [];
      const labels = [], cardEls = [], landedAt = [], piles = [];
      const hold = !!(opts && opts.hold);
      // The felt keeps the stage: the deal is the first move of the round, not
      // a scene of its own, so it must not close itself or be closed by a tap.
      const keep = !!(opts && opts.keep);
      // A round is dealt every hand, and thirteen full shuffles is a lot of
      // waiting. The first deal of a game gets the whole performance; after
      // that the deck is riffled once and gets on with it.
      const brief = !!(opts && opts.brief);
      // The turned card is the last thing the scene says, so a player reads
      // it in their own time and taps it away. The host screen holds through
      // the bidding anyway, so it needs none of this.
      const waitTap = !hold && !keep;
      if (skipEl) skipEl.textContent = waitTap ? 'tap to continue' : 'tap to skip';
      let ended = false, settled = false;

      /* ---- the deck in the middle, face down ---- */
      // The deck is a real stack: it is shuffled, cut, and dealt from, so it
      // needs enough cards in it to read as one.
      const stackN = 9;
      // The deck lands card by card. A round that has been dealt before does
      // not need that told slowly.
      const popStep = brief ? 16 : 40;
      const deckEls = [];
      const deckRest = (i) => tf(0, R.cy - i * 0.9, (i - (stackN - 1) / 2) * 2.2, 180, 1);
      for (let i = 0; i < stackN; i++) {
        const d = cardEl(null, 'deck');
        const rest = deckRest(i);
        d.style.transform = rest;
        stage.appendChild(d);
        deckEls.push(d);
        const pop = { duration: T.deckPop, delay: i * popStep, fill: 'both',
                      easing: calm ? 'ease-out' : 'cubic-bezier(.2,.9,.3,1.4)' };
        if (!calm) anims.push(d.animate([{ transform: rest + ' scale(.5)' }, { transform: rest + ' scale(1)' }], pop));
        fade(d, [{ opacity: 0 }, { opacity: 1 }], pop, anims);
      }

      /* ---- the shuffle: a riffle and a cut ---- */
      // A top-down riffle out of the cards already on the table: the pile
      // splits into two half-stacks, corners toward each other, then the
      // cards slide home one at a time in alternate order -- that cascade is
      // the riffle -- and the pile squares up. The interleave order becomes
      // the new z-order, so the pile is genuinely reshuffled.
      const splitMs = 240, step = 40, landMs = 180, squareMs = 140;
      const riffleMs = splitMs + (stackN - 1) * step + landMs;
      const roundMs = riffleMs + squareMs;
      const half = Math.ceil(stackN / 2);
      /* One riffle. `into` collects what it starts, so a caller can call off
         a round before starting another. Left to pile up, a card ends up
         carrying dozens of live transforms at once, and Chrome gives up keeping
         the card in three dimensions -- the back stops facing the room and the
         blank front is painted instead. */
      const riffle = (at, into) => {
        const made = into || anims;
        deckEls.forEach((d, i) => {
          const rest = deckRest(i), lift = R.cy - i * 0.9;
          const left = i < half;
          const side = left ? -1 : 1;
          const j = left ? i : i - half;              // place within the half
          const k = left ? j * 2 : j * 2 + 1;         // landing order: L R L R...
          const apart = tf(side * (44 + Math.random() * 6),
                           lift + j * 1.4 + (Math.random() * 4 - 2),
                           side * (12 + Math.random() * 3), 180, 1);
          const o = (ms) => Math.max(0, Math.min(1, ms / riffleMs));
          made.push(d.animate(
            [{ transform: rest, offset: 0, easing: 'cubic-bezier(.3,.8,.35,1)' },
             { transform: apart, offset: o(splitMs), easing: 'linear' },
             { transform: apart, offset: o(splitMs + k * step),
               easing: 'cubic-bezier(.25,.8,.3,1.12)' },
             { transform: rest, offset: o(splitMs + k * step + landMs) },
             { transform: rest, offset: 1 }],
            { duration: riffleMs, delay: at }));
          // The card goes on top as it sets off, not as it lands, so it
          // rides in over the centre instead of tucking in behind. The band
          // starts above the turned card's z-index of 5: that card sits face
          // down in the middle all through the shuffle, and every rifled
          // card belongs in front of it. The cut clears the band again
          // before the trump is turned. Not how a real riffle works, but it
          // reads better.
          timers.push(setTimeout(() => {
            if (!ended && !settled) d.style.zIndex = String(10 + k);
          }, at + splitMs + k * step));
          // and the whole pile squares up once the last card is in
          made.push(d.animate(
            [{ transform: rest }, { transform: tf(0, lift, 0, 180, 1.02), offset: .5 },
             { transform: rest }],
            { duration: squareMs, delay: at + riffleMs, easing: 'ease-in-out' }));
        });
      };
      const deckReady = T.deckPop + (stackN - 1) * popStep;
      let shuffleEnd = deckReady;
      if (!calm) {
        let at = deckReady + 60;
        riffle(at); at += roundMs;
        if (!brief) { at += 80; riffle(at); at += roundMs; }
        shuffleEnd = at;
      }

      /* ---- the deal ---- */
      // The whole hand goes out, one card at a time, round and round the
      // table. The deal takes about the same time whatever the hand size:
      // with more cards to give out, they go faster.
      const passes = cards;
      const perCard = Math.max(24, Math.min(T.gap,
        Math.round((calm ? 420 : 1200) / Math.max(1, n * passes))));
      // A virtual deck lingers a moment after its shuffle, so the table has
      // time to take it in. A real table has been watching its dealer
      // shuffle all along, so it deals as soon as it is released.
      // A screen that only watches can take its time over the shuffle. A screen
      // the round is about to be played on cannot: the cards are wanted.
      const dealAt = shuffleEnd
        + (virtual && !calm ? (brief ? 600 : (keep ? 1400 : 3500)) : T.start);
      // Where your own hand lies is the Stage's answer too: a fan below the
      // ring, tightening as the hand grows. The table that carries on after
      // this scene asks the same question and gets the same fan.
      const F = Stage.fan(passes, W, H);
      const lastAt = [], myCards = [];
      let given = 0;

      for (let k = 0; k < passes; k++) {
        for (let step = 1; step <= n; step++) {       // left of the dealer first
          const p = (dealer + step) % n;
          const { x } = seat(p);
          // A seat only owns its cards when the deck is virtual. At a real
          // table every card is decoration, so they all land face up alike.
          const own = virtual && p === mine;
          // Your own cards spread into a fan you can read. Everybody else gets
          // a neat pile.
          const spot = F.at(k);
          const heap = own ? null : Stage.pile(R, F, p, k, n);
          const gx = own ? x + spot.x : heap.x;
          const gy = own ? spot.y : heap.y;
          const tilt = own ? (x / (rx || 1)) * 9 + spot.tilt : heap.tilt;
          const delay = dealAt + given * perCard;
          given += 1;
          lastAt[p] = delay;

          // Only your own cards show their faces, and only a virtual deck
          // knows them. Everything else lands face down, like the real thing.
          const face = own ? faceOf(myHand[k]) : null;
          const up = !!face;
          const card = cardEl(face, own ? 'mine' : '', k === passes - 1 ? avatars[p] : null);
          stage.appendChild(card);
          const landed = tf(gx, gy, tilt, up ? 0 : 180, own ? 1 : heap.z);
          cardEls[p] = card;                          // the top of that seat's pile
          (piles[p] || (piles[p] = [])).push(card);    // and all of it, bottom first
          landedAt[p] = landed;
          if (own) myCards.push({ el: card, gx, gy, tilt });
          const flight = { duration: T.fly, delay, fill: 'both',
                           easing: calm ? 'ease-out' : 'cubic-bezier(.25,.8,.3,1)' };
          if (!calm) {
            (anims[anims.push(card.animate(
              [{ transform: tf(0, R.cy, 0, 180, .9), offset: 0 },
               { transform: tf(gx * 0.55, R.cy + (gy - R.cy) * 0.55 - 26, tilt * 0.6, up ? 90 : 180, 1.06), offset: .55 },
               { transform: landed, offset: 1 }], flight)) - 1]);
          } else {
            card.style.transform = landed;
          }
          // Held at nothing until its turn comes: the card is not on the table
          // before it is dealt.
          fade(card, [{ opacity: 0 }, { opacity: 1 }],
            { duration: calm ? T.fly : 140, delay, easing: 'ease-out', fill: 'both' }, anims);
        }
      }

      const dealEnd = dealAt + (given - 1) * perCard + T.fly;

      // The shuffle's z-order has done its work. It has to go before the
      // turned trump card flips on top of the pile, and by now the deck is
      // fading out, so nobody sees the pile reorder.
      const dropBand = () => timers.push(setTimeout(() => {
        deckEls.forEach((d) => { d.style.zIndex = ''; });
      }, dealEnd));
      dropBand();

      for (let step = 1; step <= n; step++) {          // the names, as each pile lands
        const p = (dealer + step) % n;
        // Your own cards are named for what they are, above the fan. Every
        // other pile is named for whose it is, below it.
        const own = virtual && p === mine;
        const name = document.createElement('div');
        name.className = 'dname' + (own ? ' mine' : '');
        name.textContent = own ? 'Your hand' : names[p];
        labels[p] = name;
        Stage.nameAt(name, R, p, own, n, W, H);
        stage.appendChild(name);
        (anims[anims.push(name.animate(
          [{ opacity: 0, transform: 'translate(-50%,6px)' }, { opacity: 1, transform: 'translate(-50%,0)' }],
          { duration: 220, delay: lastAt[p] + T.fly - 120, easing: 'ease-out', fill: 'both' }
        )) - 1]);
      }

      // Your hand settles: the fan lifts, card by card, once it is all in.
      if (!calm && myCards.length > 1) {
        myCards.forEach((c, k) => {
          const at = tf(c.gx, c.gy, c.tilt, 0, 1);
          (anims[anims.push(c.el.animate(
            [{ transform: at }, { transform: tf(c.gx, c.gy - 9, c.tilt, 0, 1.06), offset: .45 },
             { transform: at }],
            { duration: 380, delay: dealEnd + 40 + k * 34, easing: 'cubic-bezier(.2,.9,.3,1.35)' })) - 1]);
        });
      }

      // The deck goes quiet once it has given everything out.
      deckEls.forEach((d, i) => fade(d,
        [{ opacity: 1 }, { opacity: keep ? 0 : (i === stackN - 1 ? .5 : .18) }],
        { duration: 320, delay: dealEnd - 200, easing: 'ease-out', fill: 'both' }, anims));

      /* ---- the card turned for trumps ---- */
      const heroAt = dealEnd + (virtual ? 260 : 140);
      const hero = cardEl(upFace, 'hero');
      const heroFront = hero.querySelector('.front');
      if (!upFace) {
        heroFront.innerHTML =
          '<div class="quad"><span>♠</span><span>♥</span><span>♦</span><span>♣</span></div>';
      }
      // A real table knows only the suit, not the card, so the hero wears the
      // suit alone. It can be set again: the host may correct a mis-tap.
      const setHeroFace = (k) => {
        if (virtual) return;
        const su = Game.SUITS.find((x) => x.k === k && x.k !== 'NT');
        heroFront.classList.toggle('red', !!(su && su.red));
        heroFront.innerHTML = '<span class="big"></span>';
        heroFront.querySelector('.big').textContent = su ? su.g : 'NT';
      };
      if (trumpK) setHeroFace(trumpK);
      hero.style.transform = calm ? 'rotateY(0deg)' : 'rotateY(180deg)';
      stage.appendChild(hero);
      const turn = { duration: T.flip, delay: heroAt, fill: 'both',
                     easing: calm ? 'ease-out' : 'cubic-bezier(.2,.9,.3,1.3)' };
      if (calm) {
        hero.style.transform = tf(0, R.cy, 0, 0, 1.15);
        fade(hero, [{ opacity: 0 }, { opacity: 1 }], turn, anims);
      } else {
        (anims[anims.push(hero.animate(
          [{ transform: tf(0, R.cy, 0, 180, .8) },
           { transform: tf(0, R.cy, 0, 0, 1.15) }], turn)) - 1]);
      }

      /* ---- the round line across the top, and the trump under it ----
         Where it sits is the stage's to say: the felt draws the same line
         when there was no deal, and the handover must not jump. */
      const { cap, status, tag: tagEl } = Stage.head(stage, {
        round: opts.round || 1, cards, dealer: names[dealer],
        tag: virtual
          ? (upFace ? Stage.trumpLine(Game.suitOf(opts.upcard)) : 'No trumps')
          : (trumpK ? Stage.trumpLine(trumpK) : ''),
        ringTop: H / 2 + R.cy - ry - 56,       // the top card's top edge
      });
      anims.push(cap.animate(
        [{ opacity: 0, transform: 'translateY(-10px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 300, delay: heroAt + 120,
          easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'both' }
      ));

      /* ---- what is happening, just above the deck ---- */
      // Nothing is shuffled under reduced motion, so there is nothing to say.
      const doing = calm ? '' : (virtual ? 'Shuffling…' : `${names[dealer]} is dealing…`);
      if (doing) {
        const doingEl = document.createElement('div');
        doingEl.className = 'deal-doing';
        doingEl.textContent = doing;
        stage.appendChild(doingEl);
        // fill 'forwards': a backwards fill on the fade out would reach back
        // and cancel the fade in.
        anims.push(doingEl.animate(
          [{ opacity: 0, transform: 'translate(-50%,8px)' }, { opacity: 1, transform: 'translate(-50%,0)' }],
          { duration: 300, delay: T.fade + 200, easing: 'ease-out', fill: 'forwards' }));
        // It goes as soon as the shuffle is over, well before the cards move.
        const at = Math.max(0, Math.min(dealAt - 320, shuffleEnd + 400));
        anims.push((doingEl.animate(
          [{ opacity: 1, transform: 'translate(-50%,0)' }, { opacity: 0, transform: 'translate(-50%,-8px)' }],
          { duration: 280, delay: at, easing: 'ease-out', fill: 'forwards' })));
      }

      (anims[anims.push(tagEl.animate(
        [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 260, delay: heroAt + T.flip - 80, easing: 'ease-out', fill: 'forwards' }
      )) - 1]);

      // What the trump pick paints, whenever it lands or changes.
      const trumpSet = virtual ? null : (k) => {
        setHeroFace(k);
        tagEl.textContent = Stage.trumpLine(k);
      };

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
        if (S.live && S.live.finish === finish) S.live = null;
        timers.forEach(clearTimeout);
        overlay.removeEventListener('pointerdown', skip);
        window.removeEventListener('keydown', skip);
        const out = overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T.out, fill: 'both' });
        // A scene that opens while this one fades out owns the overlay now, so
        // do not pull the stage out from under it.
        out.onfinish = () => {
          if (!S.live) { overlay.hidden = true; stage.innerHTML = ''; }
          resolve();
        };
      }
      function settle() {
        settled = true;
        anims.forEach((a) => { try { a.finish(); } catch (e) {} });
        deckEls.forEach((d) => { d.style.zIndex = ''; });
        handover();
      }
      /* The stage, and everything the deal left standing on it, given to
         whoever asked to keep it. Once only: a tap can land the deal before
         the cards were due down, and then the timer comes round as well. */
      let handed = false;
      function handover() {
        if (handed || !keep) return;
        handed = true;
        deckEls.forEach((d) => { d.style.zIndex = ''; });
        // Every tap from here on belongs to the table: a card being picked up,
        // not a scene being landed.
        overlay.removeEventListener('pointerdown', skip);
        window.removeEventListener('keydown', skip);
        if (opts.onTable) {
          opts.onTable({ stage, overlay, cards: cardEls, piles, landedAt, labels,
                         hero, deckEls, names, dealer, anchor, W, H, calm, ring: R, fan: F });
        }
      }
      function skip() {
        // A table only ever lands the deal: it is the round's own screen, and
        // the next tap on it is a card being picked up, not a scene being shut.
        if (keep) { if (!settled) settle(); return; }
        // The first tap lands the deal; the next one closes it. A scene that
        // is only waiting to be tapped away is already landed, so one does.
        if ((hold || waitTap) && !settled) { settle(); return; }
        settle(); finish();
      }

      overlay.addEventListener('pointerdown', skip);
      window.addEventListener('keydown', skip);
      const linger = Math.max(0, Number(opts && opts.linger) || 0);
      const trumpHold = waitTap ? 0 : T.hold + linger;
      // Timed from the start of the scene.
      const naturalEnd = heroAt + T.flip + trumpHold;
      const landedAtEnd = heroAt + T.flip;               // the cards are all down
      function arm() {
        if (hold || waitTap || keep) {
          timers.push(setTimeout(() => {
            settled = true;
            if (S.live) { S.live.settled = true; applyTurn(); }   // now the cards have landed
            handover();
          }, landedAtEnd));
        } else {
          timers.push(setTimeout(finish, naturalEnd));
        }
      }

      if (hold || waitTap || keep) {
        S.live = {
          kind: 'deal', finish, stage, labels, cards: cardEls, landedAt, status, names, dealer,
          key: opts.key || null, settled: false, turn: null, turnAnim: null, calm,
          bids: null,                       // what was on the table at the last update
          trumpSet,                         // repaints the suit if the host corrects it
        };
        if (hold && last && last.key === S.live.key) update(last);   // re-opened: catch up
      }
      arm();
    });
  }

  // Closes a held scene, if one is open. With a kind, 'deal' or 'finale', it
  // closes only that one and leaves the other alone.

  // The card of the player to act breathes, so the table can see whose turn it
  // is from across the room. The landing used the Web Animations API, and that
  // owns the transform, so this has to be an animation too, not a CSS class.
  function applyTurn() {
    if (!S.live || S.live.kind !== 'deal' || !S.live.settled) return;
    if (S.live.turnAnim) { try { S.live.turnAnim.cancel(); } catch (e) {} S.live.turnAnim = null; }
    const p = S.live.turn;
    const card = (p === null || p === undefined) ? null : S.live.cards[p];
    if (!card || S.live.calm) return;                 // reduced motion: the label is enough
    // The card tips up on its edge, shivers while it is up, settles, then
    // waits. Written in milliseconds, because that is how it is judged.
    const UP = 182, SHIVER_IN = 280, SHIVER_OUT = 784, SIDE = 84, DOWN_AT = 868, FLAT = 1050;
    const D = 3000;                                 // one peek every three seconds
    const at = S.live.landedAt[p];
    const o = (ms) => Number((ms / D).toFixed(4));
    const rest = 'drop-shadow(0 5px 9px rgba(0,0,0,.45)) drop-shadow(0 0 5px rgba(255,255,255,.22))';
    const up = 'drop-shadow(0 16px 18px rgba(0,0,0,.55)) drop-shadow(0 0 12px rgba(255,255,255,.4))';
    const tip = `${at} translateY(-11px) rotateX(-26deg)`;

    // The transform rides on the card, but the shadow has to ride on the
    // faces: a filter on the card itself would flatten its 3D, and a card
    // lying face down would paint a blank front instead of its back.
    const frames = [
      { transform: at, offset: 0, easing: 'cubic-bezier(.3,.7,.35,1)' },
      { transform: tip, offset: o(UP), easing: 'linear' },
    ];
    const glow = [
      { filter: rest, offset: 0, easing: 'cubic-bezier(.3,.7,.35,1)' },
      { filter: up, offset: o(UP), easing: 'linear' },
    ];
    for (let ms = SHIVER_IN, i = 0; ms <= SHIVER_OUT; ms += SIDE, i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      frames.push({
        transform: `${tip} translateX(${dir * 3}px) rotate(${dir * 1.2}deg)`,
        offset: o(ms), easing: 'linear',
      });
    }
    frames.push({ transform: tip, offset: o(DOWN_AT), easing: 'cubic-bezier(.45,0,.55,1)' });
    frames.push({ transform: at, offset: o(FLAT) });
    frames.push({ transform: at, offset: 1 });
    glow.push({ filter: up, offset: o(DOWN_AT), easing: 'cubic-bezier(.45,0,.55,1)' });
    glow.push({ filter: rest, offset: o(FLAT) });
    glow.push({ filter: rest, offset: 1 });
    const opt = { duration: D, iterations: Infinity };
    const set = [card.animate(frames, opt)];
    card.querySelectorAll('.face').forEach((f) => set.push(f.animate(glow, opt)));
    S.live.turnAnim = { cancel: () => set.forEach((a) => a.cancel()) };
  }

  /* The finish, in three moves:
       1. the places, with the scores as they stood before the accolades;
       2. each accolade in turn, four seconds each, paying as it lands, so the
          places shuffle while the table watches;
       3. the winner, whoever is top once they are all in.
     opts: { names, totals, bonus, awards, points, linger }. `totals` are the
     final scores, with what the accolades paid already in them.
     A tap lands it; the next one closes it. */

  // A bid lands: the number slams down onto that player's card, holds, then
  // lifts away. The name below the card keeps it from then on.
  function stamp(p, value) {
    if (!S.live || S.live.calm || !S.live.settled) return;
    const card = S.live.cards[p], at = S.live.landedAt[p];
    if (!card || !at || !S.live.stage.animate) return;
    // The pile lies face down, and a stamp that inherits its rotateY(180)
    // prints the number in a mirror. The stamp lies flat; the card stays as
    // it is.
    const flat = at.replace('rotateY(180deg)', 'rotateY(0deg)');

    const el = document.createElement('div');
    el.className = 'dstamp';
    el.textContent = String(value);
    S.live.stage.appendChild(el);
    const a = el.animate(
      [{ transform: `${flat} scale(2.7) rotate(-15deg)`, opacity: 0, offset: 0,
         easing: 'cubic-bezier(.2,.9,.3,1.5)' },
       { transform: `${flat} scale(.9) rotate(5deg)`, opacity: 1, offset: .16 },
       { transform: `${flat} scale(1.08) rotate(-1deg)`, opacity: 1, offset: .26 },
       { transform: `${flat} scale(1) rotate(0deg)`, opacity: 1, offset: .74 },
       { transform: `${flat} scale(1.6) rotate(0deg)`, opacity: 0, offset: 1 }],
      { duration: 1200, fill: 'both' });
    a.onfinish = () => el.remove();

    // the card takes the hit, and the name below it pops
    card.animate(
      [{ transform: at }, { transform: `${at} scale(1.13)`, offset: .3 },
       { transform: `${at} scale(.98)`, offset: .55 }, { transform: at }],
      { duration: 420, easing: 'cubic-bezier(.2,.9,.3,1.3)' });
    const name = S.live.labels[p];
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
    if (!S.live || S.live.kind !== 'deal') return;
    if (o && o.trump && S.live.trumpSet) S.live.trumpSet(o.trump);
    const bids = (o && o.bids) || [];
    // Anything new since the last push gets stamped on its card. A scene that
    // has just opened has nothing to compare with, so it stamps nothing.
    if (S.live.bids) {
      bids.forEach((b, p) => {
        const had = S.live.bids[p];
        if (b === null || b === undefined) return;
        if (had !== null && had !== undefined) return;
        stamp(p, b);
      });
    }
    S.live.bids = bids.slice();
    S.live.labels.forEach((el, p) => {
      if (!el) return;
      const b = bids[p];
      el.textContent = S.live.names[p] + (b === null || b === undefined ? '' : ` · ${b}`);
      el.classList.toggle('turn', o && o.turn === p);
      el.classList.toggle('bidin', b !== null && b !== undefined);
    });
    if (S.live.status) S.live.status.textContent = (o && o.text) || '';
    const next = (o && typeof o.turn === 'number') ? o.turn : null;
    if (next !== S.live.turn) { S.live.turn = next; applyTurn(); }
  }

  /* The finish comes from finale.js and the stage answers for close and
     isOpen, but a page asks the deal for all of them. */
  return { play, finale: (opts, force) => Finale.play(opts, force),
           close: Stage.close, update, isOpen: Stage.isOpen };
})();
