'use strict';
/* Reads a table's QR code with the camera.

   The decoding is the browser's own: BarcodeDetector, which Chrome on Android
   has and Safari does not. Nothing is downloaded and nothing is sent anywhere,
   which is the same promise the server makes when it draws the code.

   The camera needs a secure context, so this works on https, and on the phone
   that hosts, where the page is served from 127.0.0.1. Over plain http to
   another machine the browser offers no camera at all, and the button that
   opens this hides itself. */
const Scan = (function () {
  const canDetect = typeof window.BarcodeDetector !== 'undefined';
  const canCamera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  // isSecureContext is false over plain http to another machine, and there the
  // camera is not offered at all.
  const can = () => canDetect && canCamera && window.isSecureContext;

  /* Opens the camera full screen and resolves with the text of the first code
     it reads, or null if the reader closed it first. */
  function read() {
    if (!can()) return Promise.resolve(null);

    const box = document.createElement('div');
    box.className = 'scan';
    box.innerHTML = '<video class="scan-view" playsinline muted></video>'
      + '<div class="scan-frame"></div>'
      + '<p class="scan-hint">Point the camera at the table\'s code</p>'
      + '<button class="btn scan-close" type="button">Cancel</button>';
    document.body.appendChild(box);

    const video = box.querySelector('video');
    let stream = null, timer = null, done = false;

    const shut = (value) => {
      if (done) return;
      done = true;
      if (timer) clearInterval(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      box.remove();
      finish(value);
    };
    let finish;
    const answer = new Promise((res) => { finish = res; });

    box.querySelector('.scan-close').addEventListener('click', () => shut(null));

    // The back camera, if the phone says which is which.
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((s) => {
        stream = s;
        video.srcObject = s;
        return video.play();
      })
      .then(() => {
        const reader = new window.BarcodeDetector({ formats: ['qr_code'] });
        let busy = false;
        timer = setInterval(() => {
          if (busy || done) return;
          busy = true;
          reader.detect(video)
            .then((found) => { if (found && found.length) shut(found[0].rawValue || null); })
            .catch(() => {})
            .then(() => { busy = false; });
        }, 200);
      })
      .catch(() => {
        // Refused, or no camera. Say so where the page already says things.
        box.querySelector('.scan-hint').textContent = 'The camera is not available. Type the code instead.';
        setTimeout(() => shut(null), 2200);
      });

    return answer;
  }

  /* What a scanned code means. The QR the server draws is a join address with
     the table code on it, so a code from another machine carries where to go
     as well as which table.

     Returns {code} for this server, {url} for another one, or null. */
  function readAddress(text) {
    if (!text) return null;
    const bare = text.trim().toUpperCase();
    if (/^[A-Z0-9]{4}$/.test(bare)) return { code: bare };
    let u;
    try { u = new URL(text, location.href); } catch (e) { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    // No table code on it, no table: a poster or a menu card must not send a
    // player to somebody else's website.
    const code = (u.searchParams.get('code') || '').toUpperCase().slice(0, 4);
    if (!/^[A-Z0-9]{4}$/.test(code)) return null;
    return u.host === location.host ? { code } : { url: u.href, code };
  }

  return { can, read, readAddress };
})();
