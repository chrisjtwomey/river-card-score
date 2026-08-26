'use strict';
/* The deal flourish: a card flies to each seat, then a card turns over.
   Used by the offline tracker, the host screen and the player phones.

   The overlay, the card, the fade and the motion setting are the Stage's, and
   so is the slot for whichever scene is open. The finish is in finale.js.
*/
const Deal = (function () {
  const { S, mode, faceOf, cardEl, tf, fade, overlayEl, close } = Stage;
  let last = null;        // the last status shown, to restore it on re-open


  /* opts: { names, dealer, cards, round, hold, linger, deck, mine, hand,
     upcard, trump, waitTrump, avatars }.
     The deck is shuffled and cut on screen, and the whole hand is dealt round
     the table, face down. With deck 'virtual' the turned card is the real one
     and your own cards land face up: `mine` is the seat watching, `hand` the
     cards it was given. With real cards and waitTrump, the deck shuffles over
     and over -- the real dealer is shuffling too -- and the cut and the deal
     play once update() brings the trump suit the dealer turned.
     linger adds milliseconds to the pause before it clears itself.
     With hold, the scene stays on screen after the deal, until close() is
     called, so the table can see the hand while the bids come in.
     A tap, a click, or a key ends the deal early; a second one closes it. */
  function play(opts, force) {
    close();
    return new Promise((resolve) => {
      const overlay = overlayEl();
      overlay.classList.remove('solid');
      const stage = overlay.querySelector('.deal-stage');
      const names = (opts && opts.names) || [];
      const n = names.length;
      const cards = (opts && opts.cards) || 1;
      const dealer = (opts && opts.dealer) || 0;
      const m = force || mode();
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
      const rx = Math.min(W * 0.33, 250);
      // A wider screen gives the ring more room, so the piles stand clear of
      // the round line above and the turned card in the middle. A phone has
      // none to spare, so it keeps the tighter ring.
      const ry = Math.min(H * 0.27, W < 560 ? 160 : 192);
      // The seat watching sits at the bottom, so the cards come to them. On a
      // screen that belongs to nobody that is seat 0, as before.
      const anchor = mine >= 0 ? mine : 0;
      const seat = (p) => {
        const a = (Math.PI / 2) + ((((p - anchor) % n) + n) % n) * 2 * Math.PI / n;
        return { x: Math.cos(a) * rx, y: Math.sin(a) * ry };
      };

      const T = calm
        ? { fade: 120, deckPop: 140, start: 120, gap: 45, fly: 200, flip: 200, hold: 320, out: 220 }
        : { fade: 160, deckPop: 200, start: 220, gap: 80, fly: 360, flip: 380, hold: 520, out: 280 };
      const anims = [], timers = [];
      const labels = [], cardEls = [], landedAt = [];
      const hold = !!(opts && opts.hold);
      // The turned card is the last thing the scene says, so a player reads
      // it in their own time and taps it away. The host screen holds through
      // the bidding anyway, so it needs none of this.
      const waitTap = !hold;
      const skipEl = overlay.querySelector('.deal-skip');
      if (skipEl) skipEl.textContent = waitTap ? 'tap to continue' : 'tap to skip';
      let ended = false, settled = false;
      // With real cards the deck on screen shuffles along with the dealer,
      // over and over, until the trump suit is picked. Everything after the
      // shuffle is built now but held paused, and released by that pick.
      const waiting = !virtual && !calm && !!(opts && opts.waitTrump);
      const gated = [];
      const gate = (a) => { if (waiting) { a.pause(); gated.push(a); } return a; };

      /* ---- the deck in the middle, face down ---- */
      // The deck is a real stack: it is shuffled, cut, and dealt from, so it
      // needs enough cards in it to read as one.
      const stackN = 9;
      const deckEls = [];
      const deckRest = (i) => tf(0, -i * 0.9, (i - (stackN - 1) / 2) * 2.2, 180, 1);
      for (let i = 0; i < stackN; i++) {
        const d = cardEl(null, 'deck');
        const rest = deckRest(i);
        d.style.transform = rest;
        stage.appendChild(d);
        deckEls.push(d);
        const pop = { duration: T.deckPop, delay: i * 40, fill: 'both',
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
      /* One riffle. `into` collects what it starts: the loop that runs while a
         real dealer shuffles calls this over and over, and it has to be able to
         call off the round before it. Left to pile up, a card ends up carrying
         dozens of S.live transforms at once, and Chrome gives up keeping the card
         in three dimensions -- the back stops facing the room and the blank
         front is painted instead. */
      const riffle = (at, into) => {
        const made = into || anims;
        deckEls.forEach((d, i) => {
          const rest = deckRest(i), lift = -i * 0.9;
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
      const deckReady = T.deckPop + (stackN - 1) * 40;
      let shuffleEnd = deckReady;
      if (!calm && !waiting) {
        let at = deckReady + 60;
        riffle(at); at += roundMs + 80;
        riffle(at); at += roundMs;
        shuffleEnd = at;
      } else if (waiting) {
        // Everything past the shuffle is timed from the release, not from
        // the start of the scene: it sits paused until the trump suit is
        // picked.
        shuffleEnd = 60;
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
      const dealAt = shuffleEnd + (virtual && !calm ? 3500 : T.start);
      // Your own hand sits below the ring, not in it: at a full table the
      // seats either side of you reach down far enough to clip a fan left at
      // seat height.
      const fanY = Math.min(H * 0.34, 240);
      /* A hand is a fan, not a row. Each card steps a fixed distance along from
         the one before -- far enough to read the corner, near enough to still
         overlap -- and turns a fixed amount further round. A step worked out by
         dividing a width between the cards does the opposite of a fan: the
         fewer the cards, the farther apart they land, and two cards end up at
         opposite edges of the screen.

         The fan tightens instead as the hand grows, and never grows past the
         room it is given. */
      const cardW = W <= 420 ? 52 : 64;               // .dcard, and its narrow rule
      const fanRoom = Math.min(W * 0.86, 340);
      const fanStep = passes > 1
        ? Math.min(cardW * 0.62, (fanRoom - cardW) / (passes - 1)) : 0;
      // The whole fan turns through 34 degrees at most, however many cards are
      // in it, or the end cards of a long hand lie on their sides.
      const fanTilt = passes > 1 ? Math.min(6.5, 34 / (passes - 1)) : 0;
      // Turning about a point below the fan is what gives it its dome: the
      // farther a card is from the middle, the lower it sits. This is the point
      // that fits that step to that turn.
      const rad = (deg) => deg * Math.PI / 180;
      const fanPivot = fanTilt ? fanStep / Math.sin(rad(fanTilt)) : 0;
      const lastAt = [], myCards = [];
      let given = 0;

      for (let k = 0; k < passes; k++) {
        for (let step = 1; step <= n; step++) {       // left of the dealer first
          const p = (dealer + step) % n;
          const { x, y } = seat(p);
          // A seat only owns its cards when the deck is virtual. At a real
          // table every card is decoration, so they all land face up alike.
          const own = virtual && p === mine;
          // Your own cards spread into a fan you can read. Everybody else gets
          // a neat pile.
          const off = passes > 1 ? k - (passes - 1) / 2 : 0;
          const step2 = own ? fanStep : 4.5;
          const gx = x + off * step2;
          const gy = own
            ? fanY + fanPivot * (1 - Math.cos(rad(off * fanTilt)))
            : y - k * 1.6;
          const tilt = (x / (rx || 1)) * 9 + off * (own ? fanTilt : 2.2);
          const delay = dealAt + given * perCard;
          given += 1;
          lastAt[p] = delay;

          // Only your own cards show their faces, and only a virtual deck
          // knows them. Everything else lands face down, like the real thing.
          const face = own ? faceOf(myHand[k]) : null;
          const up = !!face;
          const card = cardEl(face, own ? 'mine' : '', k === passes - 1 ? avatars[p] : null);
          stage.appendChild(card);
          const landed = tf(gx, gy, tilt, up ? 0 : 180, 1);
          cardEls[p] = card;                          // the top of that seat's pile
          landedAt[p] = landed;
          if (own) myCards.push({ el: card, gx, gy, tilt });
          const flight = { duration: T.fly, delay, fill: 'both',
                           easing: calm ? 'ease-out' : 'cubic-bezier(.25,.8,.3,1)' };
          if (!calm) {
            gate(anims[anims.push(card.animate(
              [{ transform: tf(0, 0, 0, 180, .9), offset: 0 },
               { transform: tf(gx * 0.55, gy * 0.55 - 26, tilt * 0.6, up ? 90 : 180, 1.06), offset: .55 },
               { transform: landed, offset: 1 }], flight)) - 1]);
          } else {
            card.style.transform = landed;
          }
          // Held at nothing until its turn comes: the card is not on the table
          // before it is dealt.
          fade(card, [{ opacity: 0 }, { opacity: 1 }],
            { duration: calm ? T.fly : 140, delay, easing: 'ease-out', fill: 'both' }, anims)
            .forEach(gate);
        }
      }

      const dealEnd = dealAt + (given - 1) * perCard + T.fly;

      // The shuffle's z-order has done its work. It has to go before the
      // turned trump card flips on top of the pile, and by now the deck is
      // fading out, so nobody sees the pile reorder. Timed from the release
      // when the deck was waiting on the real dealer.
      const dropBand = () => timers.push(setTimeout(() => {
        deckEls.forEach((d) => { d.style.zIndex = ''; });
      }, dealEnd));
      if (!waiting) dropBand();

      for (let step = 1; step <= n; step++) {          // the names, as each pile lands
        const p = (dealer + step) % n;
        const { x, y } = seat(p);
        // Your own cards are named for what they are, above the fan. Every
        // other pile is named for whose it is, below it.
        const own = virtual && p === mine;
        const name = document.createElement('div');
        name.className = 'dname' + (own ? ' mine' : '');
        name.textContent = own ? 'Your hand' : names[p];
        labels[p] = name;
        name.style.left = `calc(50% + ${own ? 0 : x}px)`;
        name.style.top = `calc(50% + ${own ? fanY - 76 : y + 56}px)`;
        stage.appendChild(name);
        gate(anims[anims.push(name.animate(
          [{ opacity: 0, transform: 'translate(-50%,6px)' }, { opacity: 1, transform: 'translate(-50%,0)' }],
          { duration: 220, delay: lastAt[p] + T.fly - 120, easing: 'ease-out', fill: 'both' }
        )) - 1]);
      }

      // Your hand settles: the fan lifts, card by card, once it is all in.
      if (!calm && myCards.length > 1) {
        myCards.forEach((c, k) => {
          const at = tf(c.gx, c.gy, c.tilt, 0, 1);
          gate(anims[anims.push(c.el.animate(
            [{ transform: at }, { transform: tf(c.gx, c.gy - 9, c.tilt, 0, 1.06), offset: .45 },
             { transform: at }],
            { duration: 380, delay: dealEnd + 40 + k * 34, easing: 'cubic-bezier(.2,.9,.3,1.35)' })) - 1]);
        });
      }

      // The deck goes quiet once it has given everything out.
      deckEls.forEach((d, i) => fade(d,
        [{ opacity: 1 }, { opacity: i === stackN - 1 ? .5 : .18 }],
        { duration: 320, delay: dealEnd - 200, easing: 'ease-out', fill: 'both' }, anims)
        .forEach(gate));

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
        const su = SUIT_OF[k];
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
        hero.style.transform = tf(0, 0, 0, 0, 1.15);
        fade(hero, [{ opacity: 0 }, { opacity: 1 }], turn, anims);
      } else {
        gate(anims[anims.push(hero.animate(
          [{ transform: tf(0, 0, 0, 180, .8) },
           { transform: tf(0, virtual ? -10 : 0, 0, 0, 1.15) }], turn)) - 1]);
      }

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
        { duration: 300, delay: waiting ? 420 : heroAt + 120,
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
        anims.push(gate(doingEl.animate(
          [{ opacity: 1, transform: 'translate(-50%,0)' }, { opacity: 0, transform: 'translate(-50%,-8px)' }],
          { duration: 280, delay: at, easing: 'ease-out', fill: 'forwards' })));
      }

      /* ---- the trump, in the band under the round line ---- */
      const tagEl = document.createElement('div');
      tagEl.className = 'deal-tag';
      const trumpLine = (k) => (SUIT_NAME[k] ? `${SUIT_NAME[k]} are trumps` : 'No trumps');
      tagEl.textContent = virtual
        ? (upFace ? trumpLine(String(opts.upcard).slice(-1)) : 'No trumps')
        : (trumpK ? trumpLine(trumpK) : '');
      gate(anims[anims.push(tagEl.animate(
        [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 260, delay: heroAt + T.flip - 80, easing: 'ease-out', fill: 'forwards' }
      )) - 1]);

      // What the trump pick paints, whenever it lands or changes.
      const trumpSet = virtual ? null : (k) => {
        setHeroFace(k);
        tagEl.textContent = trumpLine(k);
      };

      const status = document.createElement('div');
      status.className = 'deal-status';
      head.appendChild(status);

      // The trump line goes last in the head, then drops most of the way
      // down the empty band between the round line and the top of the ring,
      // so it belongs to neither.
      head.appendChild(tagEl);
      {
        const ringTop = H / 2 - ry - 56;              // the top card's top edge
        // Measured from the free space below the line, so a screen with a
        // narrow band moves it a little and never pushes it into the cards.
        // offsetTop, not a client rect: the line is already carrying its
        // entry animation, and a transform would skew what a rect reports.
        const foot = head.offsetTop + tagEl.offsetTop + tagEl.getBoundingClientRect().height;
        tagEl.style.marginTop = `${Math.max(6, Math.round((ringTop - foot) * 0.45))}px`;
      }
      if (hold) {
        anims.push(status.animate(
          [{ opacity: 0 }, { opacity: 1 }],
          { duration: 260, delay: waiting ? 520 : dealEnd + 380, easing: 'ease-out', fill: 'both' }
        ));
      }

      anims.push(overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: T.fade, fill: 'both' }));

      function finish() {
        if (ended) return;
        ended = true;
        if (S.live && S.live.finish === finish) S.live = null;
        timers.forEach(clearTimeout);
        dropLoop();
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
        dropLoop();
        anims.forEach((a) => { try { a.finish(); } catch (e) {} });
        deckEls.forEach((d) => { d.style.zIndex = ''; });
      }
      function skip() {
        // The first tap lands the deal; the next one closes it. A scene that
        // is only waiting to be tapped away is already landed, so one does.
        if ((hold || waitTap) && !settled) { settle(); return; }
        settle(); finish();
      }

      overlay.addEventListener('pointerdown', skip);
      window.addEventListener('keydown', skip);
      const linger = Math.max(0, Number(opts && opts.linger) || 0);
      const trumpHold = waitTap ? 0 : T.hold + linger;
      // Timed from the start of the scene, or from the release when the deck
      // is waiting on the real dealer.
      const naturalEnd = heroAt + T.flip + trumpHold;
      const landedAtEnd = heroAt + T.flip;               // the cards are all down
      function arm() {
        if (hold || waitTap) {
          timers.push(setTimeout(() => {
            settled = true;
            if (S.live) { S.live.settled = true; applyTurn(); }   // now the cards have landed
          }, landedAtEnd));
        } else {
          timers.push(setTimeout(finish, naturalEnd));
        }
      }

      // While the real dealer shuffles, so does the deck on screen: one
      // riffle at a time, until the trump suit is picked.
      let loopTimer = null, roundEndsAt = 0, released = false, loopAnims = [];
      function dropLoop() {
        loopAnims.forEach((a) => { try { a.cancel(); } catch (e) {} });
        loopAnims = [];
      }
      function loopRiffle() {
        if (ended || settled) return;
        dropLoop();                        // last round's, before this round's
        riffle(0, loopAnims);
        roundEndsAt = Date.now() + roundMs;
        loopTimer = setTimeout(loopRiffle, roundMs + 380);
        timers.push(loopTimer);
      }
      function release() {
        if (released || ended) return;
        released = true;
        if (loopTimer) clearTimeout(loopTimer);
        if (settled) return;               // a tap already landed everything
        // Let the burst in the air come home first, then cut and deal.
        timers.push(setTimeout(() => {
          if (ended || settled) return;
          dropLoop();                      // the round is home; let go of it
          gated.forEach((a) => { try { a.play(); } catch (e) {} });
          dropBand();
          arm();
        }, Math.max(0, roundEndsAt - Date.now())));
      }

      if (hold || waiting || waitTap) {
        S.live = {
          kind: 'deal', finish, stage, labels, cards: cardEls, landedAt, status, names, dealer,
          key: opts.key || null, settled: false, turn: null, turnAnim: null, calm,
          bids: null,                       // what was on the table at the last update
          release: waiting ? release : null,
          trumpSet,                         // repaints the suit if the host corrects it
        };
        if (hold && last && last.key === S.live.key) update(last);   // re-opened: catch up
      }
      if (waiting) loopRiffle();
      else arm();
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
    if (o && o.trump) {
      if (S.live.trumpSet) S.live.trumpSet(o.trump);
      if (S.live.release) { S.live.release(); S.live.release = null; }
    }
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

  /* The same six names as before the split, so no page changed: the finish
     comes from finale.js and the stage answers for close and isOpen. */
  return { play, finale: (opts, force) => Finale.play(opts, force),
           close: Stage.close, update, isOpen: Stage.isOpen, mode };
})();
