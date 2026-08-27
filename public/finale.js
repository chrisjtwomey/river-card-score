'use strict';
/* The finish: the places as they stood, then each accolade in turn, then the
   winner. It plays on the shared Stage, so it closes a deal still on screen,
   and Deal.close() shuts it.

   Deal.finale() is still the way in, so no page had to learn a new name.
*/
const Finale = (function () {
  const { S, cardEl, fade, parts, close } = Stage;

  function finale(opts, force) {
    close();
    return new Promise((resolve) => {
      const { overlay, stage } = parts();
      // The page behind already names the winner, so this scene must not let
      // anything through: the accolades come first.
      overlay.classList.add('solid');
      const names = (opts && opts.names) || [];
      const totals = (opts && opts.totals) || [];
      const m = force || UI.motion();

      if (!names.length || !stage || !stage.animate) {
        console.warn('[finale] skipped: no players, or no Web Animations API');
        resolve(); return;
      }
      if (m === 'off') { console.info('[finale] skipped: motion is off'); resolve(); return; }
      const calm = m === 'reduced';

      const n = names.length;
      const awards = (opts && opts.awards) || [];
      const pay = Number(opts && opts.points) || 0;
      const paidIn = (opts && opts.bonus) || [];
      const final = names.map((nm, i) => Number(totals[i]) || 0);
      const cur = final.map((v, i) => v - (Number(paidIn[i]) || 0));   // before the accolades
      const best = Math.max.apply(null, final);
      const champs = names.map((nm, i) => ({ nm, i })).filter((c) => final[c.i] === best);
      const each = champs.length > 1 ? ' each' : '';
      const tail = champs.some((c) => paidIn[c.i]) ? ', accolades in' : '';
      const points = (v) => `${v} point${Math.abs(v) === 1 ? '' : 's'}${each}${tail}`;

      stage.innerHTML = '';
      overlay.hidden = false;

      // The pacing is the same either way: the accolades are there to be read,
      // and reduced motion takes the movement out, not the time.
      // gap is how long each place is left alone on screen before the next one
      // comes up, so the table can take them in one at a time.
      const T = calm
        ? { fade: 120, gap: 180, flip: 240, out: 220, acc: 8000, settle: 4000, hold: 2400 }
        : { fade: 200, gap: 480, flip: 620, out: 320, acc: 8000, settle: 4000, hold: 4200 };
      const anims = [], timers = [];
      let ended = false, settled = false, raf = 0, bob = null;

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

      const note = document.createElement('div');            // what the table is waiting for
      note.className = 'fin-note';
      note.textContent = awards.length
        ? `${awards.length} accolade${awards.length === 1 ? '' : 's'} to come`
        : 'Final scores';
      box.appendChild(note);

      const title = document.createElement('div');
      title.className = 'fin-title';
      title.textContent = champs.length > 1
        ? `${champs.map((c) => c.nm).join(' & ')} tie`
        : `${champs[0].nm} wins`;
      const sub = document.createElement('div');
      sub.className = 'fin-sub';
      box.append(title, sub);

      const run = document.createElement('div');             // where the accolades are read
      run.className = 'fin-run';
      box.appendChild(run);

      const list = document.createElement('div');
      list.className = 'fin-list';
      box.appendChild(list);

      // One row a seat, so a row can move when its score changes.
      const rows = names.map((nm, i) => {
        const el = document.createElement('div');
        el.className = 'fin-row';
        el.dataset.k = String(i);
        const pl = document.createElement('span'); pl.className = 'pl';
        const who = document.createElement('span'); who.className = 'nm'; who.textContent = nm;
        const sc = document.createElement('span'); sc.className = 'sc'; sc.textContent = String(cur[i]);
        el.append(pl, who, sc);
        return { el, pl, sc, i };
      });

      // Put the rows in score order, number the places, and slide them there.
      function relayout(move) {
        const seats = names.map((nm, i) => i).sort((a, b) => cur[b] - cur[a]);
        const top = Math.max.apply(null, cur);
        const was = new Map();
        if (move) rows.forEach((r) => was.set(r.i, r.el.getBoundingClientRect().top));
        seats.forEach((i) => list.appendChild(rows[i].el));
        seats.forEach((i) => {
          rows[i].pl.textContent = String(seats.findIndex((x) => cur[x] === cur[i]) + 1);
          rows[i].el.classList.toggle('first', cur[i] === top);
        });
        if (!move || calm) return;
        rows.forEach((r) => {
          const from = was.get(r.i);
          if (from === undefined || !r.el.animate) return;
          const dy = from - r.el.getBoundingClientRect().top;
          if (Math.abs(dy) < 1) return;
          anims.push(r.el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
            { duration: 460, easing: 'cubic-bezier(.2,.85,.3,1)' }));
        });
      }
      relayout(false);

      anims.push(overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: T.fade, fill: 'both' }));

      /* The trophy lies face down from the first frame, so the top of the scene
         is not a hole while the table reads the scores. Only the faces fade: an
         opacity on the card would flatten it, and the back would paint as a
         blank front. It breathes until the winner turns it over. */
      fade(card, [{ opacity: 0 }, { opacity: 1 }],
        { duration: calm ? 200 : 420, delay: T.fade + 120, easing: 'ease-out', fill: 'both' }, anims);
      if (!calm && card.animate) {
        bob = card.animate(
          [{ transform: 'rotateY(180deg) translateY(-5px) rotate(-1.4deg)' },
           { transform: 'rotateY(180deg) translateY(5px) rotate(1.4deg)' }],
          { duration: 3600, delay: T.fade, direction: 'alternate', iterations: Infinity,
            easing: 'ease-in-out' });
      }

      /* ---- 1. the places, as they stood before the accolades ---- */
      const order0 = names.map((nm, i) => i).sort((a, b) => cur[b] - cur[a]);
      const start = T.fade + (calm ? 200 : 520);
      order0.forEach((i, k) => {
        anims.push(rows[i].el.animate(
          calm ? [{ opacity: 0 }, { opacity: 1 }]
               : [{ opacity: 0, transform: 'translateX(30px) scale(.94)' },
                  { opacity: 1, transform: 'none' }],
          { duration: calm ? 160 : 320, delay: start + (n - 1 - k) * T.gap,
            easing: 'cubic-bezier(.2,.9,.3,1.3)', fill: 'both' }));
      });
      const runAt = start + n * T.gap + T.settle;

      // The note holds the space under the card, then clears it just before the
      // first accolade rises into the same place.
      const noteMs = Math.max(700, runAt - 500);
      const noteIn = Math.min(.4, 420 / noteMs);
      const noteOut = Math.max(noteIn, 1 - Math.min(.4, 300 / noteMs));
      anims.push(note.animate(
        [{ opacity: 0, offset: 0 }, { opacity: 1, offset: noteIn },
         { opacity: 1, offset: noteOut }, { opacity: 0, offset: 1 }],
        { duration: noteMs, delay: T.fade + 200, easing: 'ease-out', fill: 'both' }));

      /* ---- 2. the accolades, one at a time, paying as they land ---- */
      // Where each beat falls inside one accolade: it rises, the points chip
      // pops, the score runs up, then it leaves.
      const o = (ms) => Math.max(0, Math.min(1, ms / T.acc));
      const chipAt = Math.min(1200, Math.round(T.acc * 0.2));
      const payAt = Math.min(3800, Math.round(T.acc * 0.5));
      awards.forEach((a, k) => {
        const at = runAt + k * T.acc;
        const row = document.createElement('div');
        row.className = 'fin-award';
        const t = document.createElement('div');
        t.className = 'fa-title';
        t.textContent = a.title;
        const w = document.createElement('div');
        w.className = 'fa-who';
        w.textContent = (a.who || []).map((i) => names[i]).join(' & ');
        const note = document.createElement('div');
        note.className = 'fa-note';
        note.textContent = a.note;
        row.append(t, w, note);
        if (pay) {
          const pts = document.createElement('div');
          pts.className = 'fa-pts';
          pts.textContent = `+${pay}`;
          row.appendChild(pts);
          anims.push(pts.animate(
            calm ? [{ opacity: 0 }, { opacity: 1 }]
                 : [{ opacity: 0, transform: 'scale(2.4) rotate(-9deg)' },
                    { opacity: 1, transform: 'scale(1) rotate(0deg)' }],
            { duration: calm ? 200 : 440, delay: at + chipAt,
              easing: 'cubic-bezier(.2,.9,.3,1.5)', fill: 'both' }));
        }
        run.appendChild(row);
        anims.push(row.animate(
          calm
            ? [{ opacity: 0, offset: 0 }, { opacity: 1, offset: o(400) },
               { opacity: 1, offset: o(T.acc - 700) }, { opacity: 0, offset: 1 }]
            : [{ opacity: 0, transform: 'translateY(18px) scale(.94)', offset: 0 },
               { opacity: 1, transform: 'none', offset: o(400) },
               { opacity: 1, transform: 'none', offset: o(T.acc - 700) },
               { opacity: 0, transform: 'translateY(-20px) scale(.98)', offset: 1 }],
          { duration: T.acc, delay: at, easing: 'ease-out', fill: 'both' }));

        // and the points land in the standings behind it
        if (pay) {
          timers.push(setTimeout(() => {
            if (ended) return;
            (a.who || []).forEach((i) => {
              const from = cur[i];
              cur[i] = from + pay;
              countTo(rows[i].sc, from, cur[i], calm ? 0 : 620);
              if (!calm && rows[i].el.animate) {
                anims.push(rows[i].el.animate(
                  [{ transform: 'scale(1)' }, { transform: 'scale(1.08)', offset: .4 },
                   { transform: 'scale(1)' }],
                  { duration: 380, easing: 'cubic-bezier(.2,.9,.3,1.4)' }));
              }
            });
            timers.push(setTimeout(() => { if (!ended) relayout(true); }, calm ? 0 : 640));
          }, at + payAt));
        }
      });
      const winAt = runAt + awards.length * T.acc + (calm ? 60 : 300);

      /* The card steps out of the way while the accolades use that space, and
         comes back for the flip. These fades hold forwards only: a backwards
         fill would reach back over the fade that first brought the card up. */
      if (awards.length) {
        fade(card, [{ opacity: 1 }, { opacity: 0 }],
          { duration: 320, delay: Math.max(0, runAt - 620), easing: 'ease-out', fill: 'forwards' },
          anims);
        fade(card, [{ opacity: 0 }, { opacity: 1 }],
          { duration: calm ? 200 : 380, delay: Math.max(0, winAt - 620), easing: 'ease-out',
            fill: 'forwards' }, anims);
      }
      // The breathing stops before the card leaves, so the flip starts square.
      timers.push(setTimeout(() => { if (bob) { bob.cancel(); bob = null; } },
        Math.max(0, (awards.length ? runAt : winAt) - 700)));

      /* ---- 3. the winner, once every accolade is in ---- */
      anims.push(card.animate(
        calm ? [{ transform: 'rotateY(0deg) scale(1.16)' }]
             : [{ transform: 'rotateY(180deg) scale(1)', offset: 0 },
                { transform: 'rotateY(0deg) scale(1.3)', offset: .7, easing: 'cubic-bezier(.2,.9,.3,1.4)' },
                { transform: 'rotateY(0deg) scale(1.16)', offset: 1 }],
        { duration: calm ? 200 : T.flip, delay: winAt, easing: 'linear', fill: 'forwards' }));
      champs.forEach((c, k) => {
        anims.push(rows[c.i].el.animate(
          calm ? [{ opacity: 1 }, { opacity: 1 }]
               : [{ transform: 'scale(1)' }, { transform: 'scale(1.07)', offset: .5 },
                  { transform: 'scale(1)' }],
          { duration: calm ? 200 : 520, delay: winAt + (calm ? 40 : 160) + k * 90,
            easing: 'cubic-bezier(.2,.9,.3,1.3)' }));
      });
      anims.push(title.animate(
        calm ? [{ opacity: 0 }, { opacity: 1 }]
             : [{ opacity: 0, transform: 'scale(.82)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: calm ? 200 : 420, delay: winAt + (calm ? 60 : 240),
          easing: 'cubic-bezier(.2,.9,.3,1.5)', fill: 'both' }));
      anims.push(sub.animate([{ opacity: 0 }, { opacity: 1 }],
        { duration: 260, delay: winAt + (calm ? 120 : 420), easing: 'ease-out', fill: 'both' }));

      if (calm || awards.length) sub.textContent = points(best);
      else countTo(sub, 0, best, 700, winAt + 420, points);
      burst(winAt + 200);

      // A number that runs to its new value. `el` may be a score in the list,
      // or the winner's line, which needs its own wording.
      function countTo(el, from, to, ms, delay, fmt) {
        const say = fmt || String;
        if (!ms || !el || typeof requestAnimationFrame !== 'function') {
          el.textContent = say(to);
          return;
        }
        const at = (window.performance ? performance.now() : Date.now()) + (delay || 0);
        const tick = (now) => {
          if (ended) return;
          if (settled) { el.textContent = say(to); return; }
          const k = Math.max(0, Math.min(1, (now - at) / ms));
          if (k <= 0) { raf = requestAnimationFrame(tick); return; }
          el.textContent = say(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
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
        if (S.live && S.live.finish === finish) S.live = null;
        timers.forEach(clearTimeout);
        if (raf) cancelAnimationFrame(raf);
        if (bob) { bob.cancel(); bob = null; }
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
      // A tap lands the whole thing: every accolade is paid at once.
      function settle() {
        settled = true;
        timers.forEach(clearTimeout);
        timers.length = 0;
        names.forEach((nm, i) => { cur[i] = final[i]; rows[i].sc.textContent = String(final[i]); });
        relayout(false);
        if (bob) { bob.cancel(); bob = null; }
        anims.forEach((a) => { try { a.finish(); } catch (e) {} });
        sub.textContent = points(best);
      }
      function skip() { if (!settled) { settle(); return; } finish(); }

      overlay.addEventListener('pointerdown', skip);
      window.addEventListener('keydown', skip);
      S.live = { kind: 'finale', finish };
      const linger = Math.max(0, Number(opts && opts.linger) || 0);
      const shown = winAt + T.flip + 400;
      timers.push(setTimeout(() => { settled = true; }, shown));   // now a tap clears it
      timers.push(setTimeout(finish, shown + T.hold + linger));
    });
  }

  return { play: finale };
})();
