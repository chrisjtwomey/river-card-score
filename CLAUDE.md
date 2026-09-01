# CLAUDE.md

Up the River, Down the River — a score tracker for the card game.

## Read these first

| | |
|---|---|
| **[CONTRIBUTING.md](CONTRIBUTING.md)** | How to run it, how to test it, where every module lives, the rules that stop drift, and how to add things. **Read it before changing anything.** |
| **[README.md](README.md)** | What the project is and how to start it. |
| **[The wiki](https://github.com/chrisjtwomey/up-and-down-the-river/wiki)** | How the game and every feature is used. Update it when behaviour changes. |

**Where a fact goes.** Ask: is this for somebody working on this repo, or for
somebody reading about it for the first time?

- **How to build, test or extend the code** → CONTRIBUTING.md
- **How to use a feature** → the wiki
- **What the project is** → README.md
- **Why a decision was made, and why it must not be undone** → this file

---

## How to work here

### Communication

Address Chris by name. Short and direct: the conclusion and the minimum
supporting facts, then stop. Do not pre-empt questions with background or
caveats.

Say plainly which part no suite can see — CSS, layout, a flow — and stop there.

### Before you change what a player sees

A change to the experience — something put on a screen, something taken off it, a
control that moves or is worded differently, a flow that ends somewhere else — **is
Chris's decision, not yours**.

**Put up several options first.** Say what each one looks like on the screen and
what it costs, name the one you would pick, and wait to be told. Then build that
one.

This holds for a fix as much as for a feature: **a bug whose cure is a different
screen is a design question in a bug's clothes.** It does not hold when Chris has
already said which change he wants, or has told you to go ahead without asking.

**Weigh every option against all the modes.** Real cards or dealt on the devices,
the host screen or a device in a hand, a screen that only watches — they play and
look different, and they are still one game seen from different sides. Say what an
option does to each, and where it can only land in one, say why the others stay as
they are. **Drift between the modes is the thing being guarded against.**

### Running the game

Chris keeps the app open and checks every change himself as it lands. **Do not ask
whether he wants to look** — he says when you should.

When he does say so: your own server on **8790**, your own headless Chrome, your
own profile. **8787 is his.** Never touch a server or a browser he is running, and
never run a broad `pkill` for an app he is using.

Say what you ran, on which port, and which paths you played — including the ones
you did not.

### Committing

- One change, one commit. **Stage named paths — never `git add -A`**: Chris edits
  the tree while you work.
- Commit titles are one plain sentence saying what is true now. Comments say why,
  not what.
- **All three suites green before every commit.**
- Build and commit locally; **push only when Chris asks**.

---

## Design decisions that hold

Why the code is the way it is. Each of these was arrived at by getting it wrong
first, so **do not undo one without saying why**.

### Loading and layout

- **`ui.js` is in the `<head>`, alone.** It puts on the saved theme and swatch
  before the page is drawn. Anywhere else and a page paints in the colours it opens
  with and corrects itself in front of you, which reads as the choice not having
  been kept at all. `test-pages.js` checks the tag is there.
- **`styles.css` writes no colour below the swatches.** A number in the body of the
  file is a colour no swatch could change; `test-pages.js` fails on one.
- **A page inside a frame never opens the live-reload stream.** A browser allows six
  connections to one origin and the stream never closes, so a wall of dev previews
  would use them all up and every later request would wait for ever.
- **The dev page's controls are one band at the foot of the window.** They used to
  sit over the screens, where they went off the top the moment there was more to
  look at than fitted — which on that page is always.
- **A standings row is two lines**, and every cell says which line and column it is
  in. The score sits beside the bar that is a picture of it. The suite fails if the
  TV screen names a different number of columns from the row.

### Colour and art

- **A card's whites are declared once and are not a swatch's to change.** A playing
  card is white paper with a white edge, in a green room and a red one — the one
  thing on the table that has to look the same twice cannot be part of the
  furniture.
- **The gold is turned toward copper in every theme**, so a highlight carries some
  red without red being asked to mean two things. **A refusal is the only red
  thing.**
- **A card is backed in the colour of the room, not the cloth**: every swatch builds
  its card backs out of the same hue as its bar. Parlour is where that shows —
  red-backed cards on green baize.
- **River's page is warm against a cool bar.** A first cut tinted the page with the
  same cold hue as the bars, and with nothing to relieve it the whole screen sat in
  one cast and looked ill.
- **The boat carries no shadow.** It is a masked element, and the WebView on a phone
  draws a filter on a masked element over the whole of its box rather than over what
  is in it — a soft dark rectangle with a hard edge where the picture ends. A desktop
  browser does not, so it is invisible everywhere except the one place the screen is
  actually used.
- **The boat only ever rides *down* from where it sits**, by a fraction of how deep
  it sits. A boat that can ride above its own waterline lifts off the horizon at the
  top of every cycle, and once you have seen that you cannot stop seeing it.
- **The app menu's sky is the cream the phone drew behind the page**, whatever the
  theme, so the two land on each other. Everything below the horizon follows the
  theme.
- **The menu's parts arrive at different rates on purpose.** At one rate they read as
  a single picture; at two they read as two, one in front of the other.
- **The mark and the launcher icon are cut about the boat, not the picture's edges.**
  The boat sits left of centre with the waves trailing right, so squaring up by the
  edges leaves the boat small and off to one side. Recutting them means laying
  `sun.png` behind `boat.png` first — they are still one picture on one canvas.
- **`art/` is kept out of `public/`.** Everything under `public/` is packed into the
  APK and unpacked on the device at first run, and a source file no page loads has
  no business there.
- **There is one drawing of a thing.** The card-stack mark went because it was drawn
  twice, in two files, that had to be changed together.

### The game on the screen

- **The bids-in beat has nobody on play.** The last bid does not start the hand: the
  round goes to tricks with nobody on play, so no device and no bot can put a card
  down over the moment, and every screen has the same still table to say it on.
- **The dealer is marked, not written.** A name in a line has to be read and then
  matched to a seat; the gold ring is the answer where the question is asked. When
  the deal is yours you get the word alone — a box round your own fan would be most
  of the screen wide, and a box round the heading crowded the hand.
- **A bot's bid is not said in a line.** A line is for what somebody did while you
  were looking away, and a bot answers the moment it is asked: a table with three of
  them kept three lines stacked up through the whole of the bidding.
- **A trick comes in on one drawn arc**, not a hop from seat to seat. The longest way
  round takes the whole sweep whatever the size of the table, so they all set off
  together and come in in the order they sit.
- **The round is put away, not replaced.** The next round is shuffled out of the same
  deck: the scene carries on from the table rather than opening on one, so nothing is
  wiped and the page behind is never seen between two rounds.
- **The place a hand had stays.** A hand played out to nothing leaves its place, not
  a hole.
- **The screens ask the same question the table does**, so nothing is offered that
  would be refused. Controls used to stay lit and earn a refusal for a tap that
  looked allowed — and on the felt the card had already left the hand by then.
- **A name is changed at the head of its own column, never on the ⋯.** One place,
  where the thing being renamed is the thing being looked at.
- **A figure and a round open the same sheet, holding the whole round**, because the
  check — the tricks total the hand — is a row's. A cell sent on its own could never
  satisfy it.
- **`Cards` is two regions, not a list to pick from.** It decides what everybody will
  be doing for the whole game, so both answers stand on the page at once. The words
  live in `MODES` in `public/lobby.js` and nowhere else.
- **A region the table would refuse is dashed as well as grey**, and its words change
  from how the mode works to why it is not on offer. That is not the same as the grey
  worn by somebody who does not run the table.
- **Game speed divides every duration and cannot stretch a beat the table grants.**
  A trick sits for `TRICK_HOLD` before the winner may lead; past that window the
  table moves on and cuts the beat anyway, which reads worse than never having asked.
  A replay's speed and a screen's own multiply.

### The table, and what it writes down

- **Presence is derived, not a flag.** `markPresence` works it out again from the
  live sockets on every broadcast, so a forced one would be wiped by the next thing
  that happened. A device goes quiet by its socket going.
- **The table plays on only while somebody is there to see it.** Bots are nobody. A
  player alone with bots who left used to come back to a game that had bid, played
  and scored itself without them.
- **A seat mid-game cannot simply go**, because the scorecard is a column for it and
  the rounds already played are that player's. One rule (`Room.kickSeat`), three
  doors: a device leaving, the host putting a seat out, the dev page doing either
  from outside.
- **The accolades stay as they were drawn** when a scorecard is corrected. They were
  drawn once; drawing them again would be a different game's worth of luck.
- **A table that never dealt is kept nowhere.** `Game.played` is asked by
  `lib/games.js` and `public/games.js` alike, so nothing is filed in one place and
  not the other.
- **The trail keeps points, not pictures** — twenty-odd bytes against three
  kilobytes. A picture is taken only where the game could not be worked out again
  without one: the game starting, a round opening, the finish.
- **The trail goes in a file of its own, appended.** A table's own record is
  rewritten whole after every broadcast, so a trail kept there would be written again
  for every card — hundreds of megabytes over one game, on a machine that may be a
  phone.
- **A replay is a copy, never the table it happened at.** A real game has people at
  it, and taking their screens over to look at the past would be its own kind of bug.
- **A point is put back through the game's own verbs**, so a replayed table is one
  the rules could have reached, and **a replay that could not happen stops rather
  than lies**.
- **Moving about in a replay goes from the nearest picture and forward.** That is the
  only honest way, because the pictures are the only states the trail actually holds.

### What is allowed, and to whom

- **`/tables.json` answers the serving machine alone.** A table's four characters are
  its only door; a listing handed to every browser on the network would open every
  table to anybody who could reach the page.
- **Ending a table is a POST, never a GET**, so no link followed by mistake and no
  page fetching ahead of itself can end a game.
- **The dev page offers what works and nothing else.** A control that draws itself
  and then answers a refusal teaches the limits one click at a time; the page is told
  which kind of server it reached in the same breath as the table.
- **The keys are the table's own, never the text's.** A pasted record cannot change
  the host token, hand anybody a seat, or leave a table nobody can open.
- **A real table hands out a watch token, never a seat token.** A watching socket is
  refused every message but `ping` and is left out of who counts as online.
- **A watching window's link never saves itself in the browser**, so watching cannot
  evict your own seat. Inside a frame a seat is kept in memory only.
- **The way-in card is asked even when the address answers it.** A table answers with
  a hello, which says what the server will take; a copy answers with the copy, which
  says nothing about the server — so without asking, a replay opened by address
  believed it was on a server that invents nothing.
