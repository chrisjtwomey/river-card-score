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
let copy = '';                   // the copy the frame is on, so a new one starts over
let at = '';                     // and the address it is at, so it is set once
const GAME = new URLSearchParams(location.search).get('g') || '';

const err = (msg) => { $('#err').textContent = msg || ''; $('#err').hidden = !msg; };
const send = (o) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(Object.assign({ t: 'replay' }, o)));
};
/* How this page acts on the copy, and whose screen it is showing. The screen
   is nothing to do with the copy -- it is the same moment of the same game,
   looked at from somewhere else -- so it is held here and not asked for. */
const view = {
  send,
  seen: null,
  show(id) { view.seen = id || null; draw(); },
};

function connect() {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  ws = new WebSocket(proto + location.host + '/ws');
  // A copy belongs to the socket that asked for one, so a socket that drops
  // and comes back asks again rather than looking for what went with it.
  ws.onopen = () => { copy = at = ''; send({ do: 'open', game: GAME }); };
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
  $('#seen-row').hidden = !on;
  $('#screen-box').hidden = !on;
  if (!on) return;
  // Another copy is another set of seats, so it starts at the table again.
  if (copy !== R.code) { copy = R.code; view.seen = null; }
  /* The address is compared rather than read off the frame: a frame told its
     own address again loads it again, and the game would start over every time
     the copy moved a point. */
  const want = Viewer.screen(R, view.seen);
  if (at !== want) { at = want; $('#screen').src = want; }
  $('#subtitle').textContent = `table ${R.of} · point ${R.at + 1} of ${R.n}`;
  Viewer.seen($('#seen'), R, view);
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
