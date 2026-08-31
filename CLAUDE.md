# Up the River, Down the River — how this code is built

A score tracker for the card game: one server, one host screen, one phone per
player. Read this before changing anything. It says where each thing lives,
and the rules that keep two copies of the same idea from drifting apart.

## The shape of it

```
game.js            THE RULES. Pure functions over plain data. Runs in Node and in the
                   browser (IIFE, `module.exports` or `window.Game`). No DOM, no sockets.
lib/room.js        THE TABLE. Every verb that moves a game on, once: openRound, startGame,
                   seatBid, closeBidding, scoreRound, bumDeal, resetRound, setScore, toLobby,
                   finishGame, kickSeat, standDown, letBack, unstick, setDealer, renameSeat,
                   sweep, waitingOn, publicState. Owns lib/deck.js. Never broadcasts.
lib/deck.js        The virtual dealer: dealHands, startPlay, refusal, putCard, settleTrick.
                   Arithmetic over the room; no sockets, no timers.
lib/bots.js        The players the table provides: what a hand is worth, which card to play,
                   and the driver that takes their turn through the same verbs a phone uses.
lib/messages.js    THE PROTOCOL. A table of every message a seated socket may send: who may
                   send it, when, and which Room verb it calls. Guards are declarative.
lib/dev.js         The dev controls: the ways in (`ways`) -- a table of stand-ins
                   (`setup`) and a table in play (`tables`/`open`). Calls Room verbs;
                   invents nothing a real game cannot reach.
lib/watch.js       THE DOOR TO A REPLAY. One message, `{ t: 'replay', do: ... }`, that any
                   socket may send: open a copy of a game on file, and move about in it.
                   No table and no key -- only a table still in play is the host's.
lib/http.js        Everything over plain HTTP: pages, QR, addresses, finished games, pictures,
                   and the tables running here (`/tables.json`, to this machine alone).
lib/games.js       A finished game on disk.
lib/trail.js       What happened to a table, written down as it happens: a point a
                   thing, appended to a file of its own. `point`/`frame` are pure and
                   called from Room verbs; `flush` is the server's, at the broadcast.
                   A live trail is filed before it is destroyed -- a game finishing,
                   a table ending, one ageing out, or another game started over it.
lib/tables.js      A table still in play, on disk: written after every broadcast,
                   read back when the server comes up. Sockets and pictures left out.
server.js          Wiring only: http/ws servers, the rooms map, the entry messages
                   (create/join/resume/screen/watch/avatar), presence, broadcast, the trick
                   hold timer, upkeep.

public/ui.js       Page chrome shared by every page: the way back (backLink, off `data-back`
                   on the top bar), the settings rows, theme, zoom, wake lock,
                   full screen, the ask() dialog, the motion and speed settings, a strip that
                   does not fit (fadeStrip/showCell), the small effects (fx).
public/settings.js The settings page behind the ⚙: laid over the page that opened it, draws
                   the rows a page hands it (`UI.commonSettings` plus its own) and, on a
                   phone, who the player is (name, photo). The front page opens it first
                   when there is no name.
public/net.js      The socket client: reconnect, sessions, one table per page address.
public/table.js    The scorecard -- editable for `view.boss`: a figure, a round, or a name at
                   the head of a column, all through one delegated listener on the table. A
                   figure and a round open the same sheet, which holds the whole round,
                   because the check (tricks total the hand) is a row's --
                   the standings and the seat controls on them (badges, and the ⋯ of what may
                   be done about one person mid-game -- never the name, which is changed at the
                   head of its own column), the winner, vote line, presence and bid
                   toasts, the row menu both lists of people use (`rowMenu`), and what the
                   scenes read off the state (roundKey, dealOpts, finaleOpts).
public/lobby.js    Widgets for the lobby: seats, bots, rulesForm, startButton.
public/round.js    Widgets for a round in play: header, bidStrip, trickCount, bidFor, playFor,
                   playout, winner, and the two dialogs (newGame, bumDeal).
public/stage.js    The overlay both scenes play on, its parts, the round line (head), cards
                   drawn off Game, the seat ring, the fan geometry and the mark on the
                   dealer's seat (`dealerRing`). `Stage.peek` is the one
                   "waiting on you" animation: the deal, the felt and the trick all use it.
public/deal.js     The deal scene.   public/finale.js  The finish.   public/felt.js  The
                   table a phone plays a virtual round on; the deal hands it the stage.
public/chat.js     Table talk.       public/accolades.js  Shared with the server (A.list/pick/bonus).
public/host.js     THE HOST FLOW: connect, deal-hold policy, table panel, compose widgets.
public/play.js     THE PHONE FLOW: connect, felt/deal policy, vote buttons, who you are, compose.
public/viewer.js   THE REPLAY VIEWER. A game watched again, drawn off the one message the
                   server sends about a copy: `games`, `rounds`, `run`, `points` -- four
                   widgets, each `(root, R, view)`, each building what it needs inside the
                   root it is handed. `view = { send }` asks the copy for something
                   (`{do:'seek', at}`); how that is addressed is the page's business.
public/dev.js      The dev page: the way-in card (three doors), then one band over every
                   screen. The band is the same rows in the same places on a table and on a
                   game watched again; only the verbs change, and the replay half of them
                   is `viewer.js` put where it goes.
public/replay.html/.js  One game watched again: the table as it was in a frame, and the
                   viewer under it. `?g=<id>` is the whole address.
public/join.js, history.js   The other pages.
```

Read these together: a **state** is the same shape on the server (`room`) and on
every screen (`ST` from `publicState`). `game.js` functions accept either.

## The rules that stop drift

1. **One home per concept.** A rule of the game goes in `game.js`. A thing that
   moves a game on goes in `lib/room.js`. A thing drawn on more than one screen goes
   in `table.js`, `lobby.js` or `round.js`. If you are about to write the same
   `if` in two files, you are in the wrong file.
2. **Never re-derive a rule.** Ask `Game.onTurn`, `Game.awaySeat`, `Game.tablePlays`,
   `Game.tablePlaysOn`, `Game.tableSelfPlays`, `Game.canPause`, `Game.handedOver`,
   `Game.virtual`, `Game.firstLeader`, `Game.forbiddenBid`,
   `Game.changeableSeat`, `Game.bidsHeld`, `Game.countingSeat`.
   `cfg.deck === 'virtual'` appears in `game.js` and nowhere else.
3. **A new message is a row in `lib/messages.js`.** Give it `who`, `phase`, `deck`,
   `live` and `when` guards and a one-line `run` that calls a Room verb. (`live`
   means it is refused while the table is stopped: only what moves the hand on
   carries it, because everything that puts a game right is what a table is
   stopped for.) Never put game
   logic in a message body. Never add a `trump` message: with real cards nothing is
   recorded (the tests assert it is refused).
4. **Room verbs are synchronous and silent.** They change the room and return.
   `broadcast` lives in `server.js`, runs once after the verb, and nudges the bots.
   Timers (trick hold, bot delay) live outside the room and re-check the room's
   identity when they fire (`room.play !== tag`).
5. **`openRound` is the only place a round is reset for bidding** (bids null,
   tricks null, phase `bid`, vote null, play null, deal if virtual). `bumDeal`
   bumps `redeals` *before* calling it: every screen keys its deal on
   `Table.roundKey(ST)` = `idx:redeals`, and the felt hands over on it.
   `resetRound` calls it too, for the round in play; a round already scored is
   never reopened -- it is retyped in place (`setScore`).
6. **`publicState.turn` is bid-only.** During tricks the seat on play is `play.turn`.
   The phone and the felt branch on `play ? play.turn : ST.turn`.
7. **A widget is `(root, ST, view)`.** `view = { me, boss, send }`: this screen's
   seat (-1 for a screen that belongs to nobody), whether it may act, and how a
   message leaves. A widget queries inside `root` only, is null-tolerant (not every
   page has every part), builds with `createElement` what the page does not carry,
   and wires its own buttons once (`el._wired`). It never reads `ST`, `SHOW`,
   `WATCH` or `$` from the page. Handlers read fresh state at tap time.
8. **The flow files (`host.js`, `play.js`) own only what differs between screens:**
   how they connect, when a scene plays and how long it holds, the vote buttons,
   who you are on the settings page, the table panel. If a block in one looks like a block in the
   other, move it into a widget.
9. **Scenes are state-agnostic.** `deal.js`, `finale.js`, `felt.js` take options.
   What those options are read off the state is `Table.dealOpts` / `finaleOpts`,
   and the caller adds its own (`hold`, `key`, `hand`, `linger`, `keep`). Scenes ask
   `Stage.parts()` for the overlay; they never query `#deal` or `.deal-stage`.
10. **The motion setting is `UI.motion()` / `UI.setMotion()`.** `UI.fx.on()` is
    `motion() === 'full'`. Nobody else reads the storage key.
11. **Cards are strings** (`'TH'`, `'9S'`). Read them with `Game.suitOf`,
    `cardFace`, `cardGlyph`, `cardRed`. `Stage.faceOf` is the only adapter to a
    drawable face.
12. **No build step, no ES modules.** Every file is an IIFE assigned to one top-level
    `const`. Classic scripts share one lexical scope, so a new file declares no
    top-level `$` or `esc` (the pages own those). Script order in each HTML: `game.js`
    → helpers (`ui`, `net`, `stage`, `deal`, `finale`, `felt`) → `table` → `lobby` →
    `round` → the page. `deal/felt/finale` destructure `Stage` at load time.

## Before you change what a player sees

A change to the experience -- something put on a screen, something taken off it, a
control that moves or is worded differently, a flow that ends somewhere else -- is
the user's decision, not yours. **Put up several options first.** Say what each one
looks like on the screen and what it costs, name the one you would pick, and wait to
be told. Then build that one.

This holds for a fix as much as for a feature: a bug whose cure is a different screen
is a design question in a bug's clothes. It does not hold when the user has already
said which change they want, or has told you to go ahead without asking.

The game has modes -- real cards or dealt on the phones, the host screen or a phone
in a hand, a screen that only watches -- and they play and look different. They are
still one game seen from different sides. So weigh every option against all of them:
say what it does to each, and where it can only land in one, say why the others stay
as they are. Drift between the modes is the thing being guarded against.

## How to add things

- **A rule** (e.g. a new scoring option): `game.js` + the `config` row in
  `messages.js` that accepts it + `Lobby.rulesForm`'s `RULES` list + the `<select>`
  in `host.html`, `play.html`, `dev.html` + a check in `test-rules.js`.
- **A step in the game** (a new phase or transition): a Room verb, called from a
  message row; `publicState` if screens need to see it; then the widget that draws it.
- **A screen control that acts for the table**: a widget in `round.js` gated on
  `view.boss`, using `Game.awaySeat`/`onTurn` for who it is about. If it is
  about one *named* person rather than the seat on turn, it is a row in the
  standings' ⋯ instead (the item list in `table.js`), which is the one list of
  everybody a game in play has.
- **A page setting**: a row from `UI.commonSettings(opts)` or a page-specific item in
  its `Settings.wire` call.
- **A behaviour that differs by mode** (real cards vs dealt on the phones): a `deck`
  guard on the message row, or `Game.virtual(state)` at the one seam in the Room verb
  (`openRound`, `closeBidding`). Not an `if` in a screen.

## Working and testing

- `npm test` runs three suites, in the order a failure is most useful in.
  **All three must be green after every change.**
  - `test-rules.js` — the rules, in this process: `game.js`, `lib/room.js`,
    `lib/deck.js` and `lib/messages.js` called directly. `table()` builds a room
    with stand-in sockets; `t.say(who, msg)` sends one message as the server
    would and returns the line said back, or null. **A rule goes here.** No port,
    no socket, no clock: the whole file runs in well under a second.
  - `test.js` — whole games over real WebSockets, ports 8899–8907. **What a
    socket adds goes here**: a refusal reaching the phone that earned it, a
    change reaching every screen, presence, reconnect, and a table outliving its
    server. Nothing waits on the clock: `okBy(pred, msg)` polls until the table
    has made it true, `until(pred)` waits for a step with nothing to assert, and
    `c.rt()` is a ping and its pong. `tableOf(names, cfg, url)` makes a table and
    sits everybody at it. The game's own pauses are turned down by `TUNED` at the
    top — a bot's think, the trick hold, the wait on the phones — so a check
    never sits through one; what they are is checked in `test-rules.js`, and one
    server of its own proves each is really waited out.
    A `SLOW` line in the output means a wait gave up: something is wrong with the
    check, even if the check passed.
  - `test-pages.js` — the pages and the scenes in a fake DOM, with
    `playPage`/`loadPage` for screens. It never sleeps either: where a screen
    arms a timer, the test catches it and lets it off by hand.
- If a check in `test.js` fails and the same rule passes in `test-rules.js`, the
  wiring is wrong, not the rule.
- The fake DOM parses `innerHTML` only for `div|span|p` with a class; build widget
  innards with `createElement`, and assert on `pick('#container').querySelector('.btn')`,
  not on inner ids.
- `npm run dev` serves with live reload on 8787. A change to `server.js`, `lib/` or
  `game.js` needs a restart; client files do not.
- One change, one commit, locally. Commit titles are one plain sentence saying what
  is true now ("The room is a thing of its own"). Comments say why, not what.
- A change that alters what a player sees or may do is a **named behaviour change**:
  say it in the commit body, and update `README.md` in the same commit.
- `README.md` "Files" lists every module. A new file goes there.

## Running the game yourself

The suites do not see a real screen. A change to a scene, a gesture, a layout
or a flow still needs a game played on it.

**Ask first.** Before you open a browser, drive a phone, or start a server,
ask the user whether they want to check it themselves. Many do: they have the
server running, the phones on the table, and they know what it should look
like. Only run the game yourself when they say so, or when they have told you
to test autonomously. Never touch a browser or a server the user is already
running -- open your own, on a port of your own, and say which.

When you do run it:

- **Browser.** `PORT=8790 npm run dev` (live reload; a change under `public/`
  reloads every open page, a change to `server.js`, `lib/` or `game.js` needs a
  restart). Host screen at `/host.html`, a seat at `/` (type a name, *Start a
  table*), the whole table at once at `/dev.html` (needs `DEV=1`, which
  `npm run dev` sets): it seats stand-ins and shows the host screen and every
  phone side by side, and its scrubber and one-shots reach any state a
  real game can. A second phone is a second browser profile or a private window;
  a seat is one browser, so two tabs of `play.html` share it.
- **What to play through.** Real cards: lobby → bid in turn → anybody taps who takes each trick → a round scores → go back → new game. Dealt on the phones: add a
  bot, the deal lands on the felt, bid on the felt, play a trick, a bum deal,
  finish → finale. Then the odd paths: a phone goes quiet at its turn (bid for /
  play for / hand the seat over), *Show a table* on a second host screen, a
  watching window from the dev page.
- **Mobile.** A real phone on the same network reaches the laptop's server at
  the address the console prints; the QR code on the host screen carries it. For
  the Android app, `android/tools/push-dev.sh` writes the tree into a debug build
  on a phone over USB (`adb`), and `adb logcat -s UpTheRiver-node` shows the
  server's own output. A change under `public/` reloads the app's pages on its
  own; a server change restarts the runtime.
- **Say what you saw.** Report what you ran, on which port, and which of the
  paths above you played, including the ones you did not. A screen that loads is
  not a game that plays.
- `android/tools/prepare.sh` copies `lib/` and `public/` whole; nothing to register.
