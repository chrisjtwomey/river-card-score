'use strict';
/* One game, watched again, and nothing else on the page.

   The whole of the way about it is the replay viewer's; this page says where
   each part goes, opens the copy, and shows it. The copy is a table of its
   own, so what shows it is the screen any table is shown on: host.html, in a
   frame, pointed at the copy's code. It draws the deal, the trick and the
   scorecard the way it did on the night, and it follows the speed the replay
   is being played back at because the copy tells it so.

   `?g=<id>` is the game. That is the whole address: no table, no key. */

const $ = (s) => document.querySelector(s);

let ws = null;
let R = null;                    // the copy, and where it stands
let shown = '';                  // the copy the frame is on, so it is set once
const GAME = new URLSearchParams(location.search).get('g') || '';

const err = (msg) => { $('#err').textContent = msg || ''; $('#err').hidden = !msg; };
const send = (o) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(Object.assign({ t: 'replay' }, o)));
};
const view = { send };

function connect() {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  ws = new WebSocket(proto + location.host + '/ws');
  // A copy belongs to the socket that asked for one, so a socket that drops
  // and comes back asks again rather than looking for what went with it.
  ws.onopen = () => { shown = ''; send({ do: 'open', game: GAME }); };
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch (x) { return; }
    if (m.t === 'replay') {
      R = m.shut ? null : m;
      if (R) err('');
      draw();
    } else if (m.t === 'replayAt' && R && R.code === m.code) {
      /* A copy playing itself, saying where it has got to. Only the place and
         the table move: the rounds and the points are the trail, and it is
         being read, not written. */
      R.at = m.at;
      R.playing = m.playing;
      R.rate = m.rate;
      R.where = m.where;
      R.state = m.state;
      draw();
    } else if (m.t === 'error') {
      err(m.msg);
    }
  };
  ws.onclose = () => setTimeout(connect, 1000);
}

function draw() {
  const on = !!(R && R.code);
  $('#band').hidden = !on;
  $('#screen-box').hidden = !on;
  if (!on) return;
  if (shown !== R.code) {
    shown = R.code;
    $('#screen').src = `host.html?c=${encodeURIComponent(R.code)}`;
  }
  $('#subtitle').textContent = `table ${R.of} · point ${R.at + 1} of ${R.n}`;
  Viewer.rounds($('#rounds'), R, view);
  Viewer.run($('#transport'), R, view);
  Viewer.points($('#points'), R, view);
}

document.addEventListener('DOMContentLoaded', () => {
  UI.wireTheme('#btn-theme');
  draw();                        // nothing is open yet, and the page says so
  if (!GAME) return err('No game was named. Pick one from Past games.');
  connect();
});
