'use strict';
/* A player's picture. It is cropped to the shape of a card on the phone that
   picked it, so what goes to the table is small. The table keeps it and hands
   it back over HTTP, and it lands on the back of that player's cards. */
const Avatar = (function () {
  const KEY = 'river-card-score:avatar:v1';
  const W = 168, H = 236;                 // a card's shape, 64 x 90, big enough to hold up
  const CAP = 40 * 1024;                  // the address the table will take

  function saved() {
    try { return localStorage.getItem(KEY) || null; } catch (e) { return null; }
  }
  function remember(d) {
    try { d ? localStorage.setItem(KEY, d) : localStorage.removeItem(KEY); } catch (e) {}
  }

  // Where the table keeps a seat's picture. The version is in the address, so
  // a new picture is a new address and the old one is never shown again.
  function url(code, seat) {
    if (!code || !seat || !seat.av) return null;
    return `/avatar/${encodeURIComponent(code)}/${encodeURIComponent(seat.id)}?v=${encodeURIComponent(seat.av)}`;
  }

  // WebP where the browser offers it, JPEG where it does not. The quality
  // drops until it fits: this goes to everybody at the table.
  function shrink(cv) {
    const type = cv.toDataURL('image/webp', .5).indexOf('data:image/webp') === 0
      ? 'image/webp' : 'image/jpeg';
    const steps = [.82, .7, .58, .45, .34];
    for (let i = 0; i < steps.length; i++) {
      const d = cv.toDataURL(type, steps[i]);
      if (d.length < CAP) return d;
    }
    return cv.toDataURL(type, .25);
  }

  // Draws a picture into a card, filling it and cropping what hangs over.
  function crop(img) {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#0d3f2a';
    cx.fillRect(0, 0, W, H);
    const k = Math.max(W / img.width, H / img.height);
    const w = img.width * k, h = img.height * k;
    cx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    return shrink(cv);
  }

  // A picked file in, a small data address out. Rejects with a line to show.
  function fromFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) { reject(new Error('Pick a picture first.')); return; }
      if (!/^image\//.test(file.type || '')) { reject(new Error('That file is not a picture.')); return; }
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('That picture could not be read.'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('That picture could not be read.'));
        img.onload = () => {
          try { resolve(crop(img)); } catch (e) { reject(new Error('That picture could not be used.')); }
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /* The control: a preview of the card, a button to pick and a button to drop
     it. `onPick(dataUrl|null)` runs on every change. The returned object can
     `show(src)` a picture the table already holds, and `say(msg)` a problem. */
  function picker(onPick) {
    const el = document.createElement('div');
    el.className = 'avrow';
    el.innerHTML =
      '<div class="avshot"><span class="avhint">no photo</span></div>' +
      '<div class="avside">' +
      '<div class="row-actions">' +
      '<button class="btn ghost" type="button" data-a="pick">Add a photo</button>' +
      '<button class="btn ghost" type="button" data-a="drop" hidden>Remove</button>' +
      '</div>' +
      '<small>Optional. It goes on the back of your cards.</small>' +
      '<p class="err" hidden></p>' +
      '<input type="file" accept="image/*" hidden>' +
      '</div>';

    const shot = el.querySelector('.avshot');
    const pick = el.querySelector('[data-a="pick"]');
    const drop = el.querySelector('[data-a="drop"]');
    const err = el.querySelector('.err');
    const file = el.querySelector('input[type="file"]');

    function say(msg) { err.textContent = msg || ''; err.hidden = !msg; }
    function show(src) {
      shot.style.backgroundImage = src ? `url("${src}")` : '';
      shot.classList.toggle('has', !!src);
      pick.textContent = src ? 'Change' : 'Add a photo';
      drop.hidden = !src;
    }

    pick.addEventListener('click', () => { say(''); file.click(); });
    drop.addEventListener('click', () => { say(''); show(null); onPick(null); });
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      file.value = '';                       // so the same file can be picked again
      if (!f) return;
      pick.disabled = true;
      fromFile(f).then((d) => { show(d); onPick(d); }, (e) => say(e.message))
        .then(() => { pick.disabled = false; });
    });

    show(null);
    return { el, show, say };
  }

  return { saved, remember, url, fromFile, picker, W, H };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Avatar;
