# Up the River, Down the River — score tracker

A score tracker for the betting card game: one TV screen plus a phone for
each player. Players bid in turn on their own phone.

## Run the table server

```sh
npm install
npm start
```

The console prints the addresses. On the host machine:

- TV screen: `http://localhost:8787/host.html`
- players join: `http://localhost:8787/`

The players' phones must be on the same network as the server. Scan the QR code on the TV screen, or type the `http://<your-ip>:8787/` address that the console prints. Set `PORT` to use a different port.

The join panel also has **Scan the code**, which opens the camera and reads the
table's QR code without leaving the page. The decoding is the browser's own, so
nothing is downloaded and no picture leaves the phone. A camera needs a secure
page, so the button is there over `https` (`npm run cert`), and it hides itself
where the browser offers no camera -- plain `http` to another machine, or
Safari, which cannot read a code. In the Android app the scanner is on the
app's own first screen instead, where it needs no server of ours at all.

Every page carries one **⚙** button in the top bar, and it opens the settings
page: the theme (system, light or dark), the animations (full, short or off),
full screen, on the TV screen the text size, and on a phone the way back to
the front page. The settings page lies over the page it was opened from, with
a back arrow of its own, so a game underneath keeps its place and its socket.
Rows that a browser cannot honour leave themselves out -- full screen is not
offered on Safari on an iPhone. On a phone the settings page also holds who
you are: the name, and the photo that goes on the back of your cards. At a
table they are the seat's, changed in the lobby; a change made during a game
goes with the next table, because the scorecard is a column under the name it
has. A table's screens have one other button, 💬 for the talk, and nothing
else.

The server builds the QR code itself, so nothing is sent to an outside service. It is always black on white, whatever the page theme is, because a camera cannot read an inverted code.

### How a game runs

**One phone is enough.** On the landing page, press **Start a table**. That makes a table, takes the first seat, and hands you the controls. The lobby then reads in the order it happens: the code and a QR code for the others to scan at the top, the seats, the bots and the rules under them, and **Start game** across the foot. A TV screen is optional.

**The table host is a player.** The first player to take a seat runs the table from their own phone: rules, seat order, who deals first, start, undo, and new game. They can hand that over from the ⋯ menu beside any player. So a game needs no TV screen at all — but a TV screen is still nice on a TV, and it has the same powers.

1. Someone starts the table, from a phone with **Start a table**, or from a TV screen. Either way the server makes a 4-character table code and a QR code with the join address, shown on the table host's phone — or, when a TV screen runs the table, on the TV screen alone, and the phone says the screen is there. A player points a phone camera at it and lands on the join page with the code already filled in. If the machine has more than one network address, a picker on the TV screen chooses which one goes in the QR code.
2. Each player opens the site on their phone, types the code, and takes a seat. The first visit asks for a name before anything else; after that the front page says who the phone plays as, and the name and the photo are changed on the settings page under ⚙. The seat order is the order of play. The host can drag a player by the handle at the left of the row to a new place in the order, or remove one, until the game starts.
3. The ⋯ menu beside a player says who deals the first round, makes them the table host, or removes them. Without a choice, seat 1 deals. The deal then moves on one seat each round.
4. The table host sets the rules and presses **Start game**. Every phone shows the rules in the lobby; only the table host's can change them. On a phone they fold away under a **Rules** heading that says what they are while it is shut — *14 rounds · real cards · screw the dealer* — and it opens itself for whoever is setting them. Nobody can join after that.
5. **The deal.** Every round opens with the deal on every screen: the deck shuffled and dealt round the table, with a line over the deck naming whose deal it is — *Ann is dealing…* — on either deck. On the TV screen it stays up while the bids come in, each bid stamped onto that player's pile. On a phone with real cards only the shuffle plays, and the scene clears itself before any card goes out — a tap skips it.
6. **Bidding.** The server only accepts a bid from the player whose turn it is. The order starts left of the dealer and the dealer bids last. Every other phone shows whose turn it is and the bids so far.
7. With "screw the dealer" on, the server refuses the dealer's bid if it would make the bids total the number of tricks. The forbidden chip is disabled on the dealer's phone.
8. A player can change their bid until the player after them bids. Their phone keeps the pad open and says so, and the TV screen marks the bid that can still change. Once the next player bids, the change is refused.
9. **Bids are in.** The last bid does not start the hand. The bids stand for a
   couple of seconds first, on every screen at once: the TV screen says *Bids
   are in* with what they total and who leads, the phones say the same, and on
   the felt it is said over the table. Nobody is on play through it, so no card
   goes down and no trick is counted — a tap that early is refused and the
   phone is told why. Then the hand opens by itself.
10. **Tricks.** The dealer keeps the round, as at a kitchen table: after each trick they tap who took it, on their own phone. A TV screen that runs the table can tap it too — it holds no seat, and it is the one everybody can see. Every other screen follows without touching it — the pills show won against bid, the tally counts the tricks played, a line says who took it — and the last trick scores the round. A wrong tap is undone with **Take back the last trick**.
11. The round scores, the next round opens, and the deal moves on one seat. Every phone says what the round paid you — made it or went down, what you bid, what you won, and the points — and the TV screen says what each player got.
12. The table host, or the TV screen, can press **Undo last step** to reopen the last step — it asks first, and says which round it takes back — and **New game** to return the same players to the lobby.

### When a phone goes

A game stops dead on an empty seat: nobody may bid or play out of turn, so one
phone in a pocket holds up everybody. The table tells the two cases apart.

**A phone that has gone quiet** — a flat battery, a lost network, a browser
that was closed — is waited for. Every screen says so: the seat is marked away,
a line slides in saying *"Ann dropped out"*, and the felt says the table is
waiting on them. Three ways back:

- **The same phone comes back.** It holds the seat's token, so it always gets
  its seat, whatever the game has done in the meantime.
- **A phone that lost the seat types the code and the same name.** This is
  accepted only while the table is still waiting on that seat — bidding has not
  moved past them, or it is their card to play. Once the game has gone on
  without them, a name is not enough and the phone that holds the seat must
  come back to it. A seat somebody is sitting in is never handed over.
- **Whoever runs the table bids or plays for them.** *Bid for Ann* appears on
  the table host's phone and on the TV screen while the bidding waits on an
  empty seat; the number is read off that seat's own hand, the same arithmetic
  the bots use, or the host taps the number the player at the table asks for.
  *Play a card for them* does the same once the cards are out.

**A phone that is not coming back** can be handed to auto-play for good:
**Auto-play their hand** appears beside the bid-for and play-for buttons
whenever the game is stopped on an empty seat. The seat keeps its name and
its column, auto-play takes it from there on, and the phone that holds the
seat takes it back by coming to the table. From the ⋯ on a
player's standings row any seat nobody is behind can be handed over, not only
the one the game is standing on — a player who has gone home need not be
holding the table up for their hand to be one nobody is behind. Either way it
is a table dealt on the phones: with real cards there is no hand for auto-play
to hold.

**And handed back.** *Let back in*, on that same ⋯, gives the seat up again. It is not the player's own button, and it cannot be: whoever the table
is playing for is not there to press anything, and their phone may have
forgotten the table altogether. Once the seat is open they come back to it the
way any phone that lost its seat does — the table's code and the name they
played under. The seat's own clock starts again from that moment, so a seat
opened and not taken up is handed over again in its own time rather than at
once.

Every screen calls it **auto-play**: the word "table" is the room the game is
in, and nothing else.

**A player who leaves on purpose** — **Leave the game** at the foot of the
player page — is not waited for. Before the cards go out the seat simply goes.
After that it cannot: the scorecard is a column for every seat and the rounds
already played are that player's. So the seat stays, marked as gone, and
auto-play takes its hand from there on. That phone can still come back to the seat
from the front page, and it is a player's again.

**A seat nobody is behind leaves the table.** A clock runs on a seat while
nobody holds it — no window open on it — and while the table is stopped on it
and can go no further. A phone that is open with nothing to do is never idle,
however long it sits there: at a table with real cards a phone is touched to
bid and not again, and the players are all sat around the table. A minute
before the clock runs out, a phone that is here is asked **Still there?**, and
any tap on it is the answer. When it runs out, a lobby seat simply goes — its
phone lands back on the front page — and in a game the hand is handed to
auto-play, exactly as if that player had pressed *Leave the game*.
`IDLE_MS`, five minutes by default, is the clock; `IDLE_WARN_MS`, one minute,
is how long before it the phone is asked. Either at nought turns it off.

**With real cards the table stops instead.** That player's hand is on the table
in front of them, not on a phone, so nothing can be taken from the seat and
only the people at the table can say what happens to it. Every screen says
*Paused — Ann has not answered for 5 minutes*, and whoever runs the table taps
**Carry on**. The seat is not asked about again until somebody is behind it;
the bid-for buttons are there in the meantime, as they always are. A player who
comes back to the seat takes the notice down by arriving.

**The table plays on only while somebody is there to see it.** Auto-play and
the bots are there so a game is not held up for a seat nobody is behind — not
so that a game plays itself in an empty room. Somebody is a player still in the
game, or, with none of those left, a screen watching: the TV screen, a screen
showing the table, a watching window. When the last of them goes, every hand
the table was holding stops where it is: no bid is made, no card goes down, and
the game is exactly as it was left when somebody comes back to it. A player
alone with bots who left used to come back to a game that had bid, played and
scored itself without them.

A table of bots alone is worth looking at — a table of stand-ins on the dev
page, a screen put up to watch one — so it plays while it is looked at. Close
the last window on it and it stops.

**Stopping it.** The host screen and the table host's phone both carry a
**❚❚ Pause**, in the row of controls under the bids, whenever a hand is out. A stopped
table is stopped for everybody: it plays none of its own hands — a bot's, or one
handed over to it — and no bid, no card and no trick lands until it is let go.
Every screen shows **❚❚ paused** on its round line, so a stopped table is never
mistaken for a hung one, and the same button lets it go again.

Everything whoever runs the table does to put a game right goes on working
while it is stopped — a step back, a bum deal, a seat given back, a new game.
That is what a table is stopped for. A table of people playing with real cards
can be stopped like any other, and is the one most likely to want a moment: the
food arrives, or somebody is arguing about a rule.

### Running the table, mid-game

Everything whoever runs a table does to a game already going is on the scores
page they are already looking at — the TV screen, and the phone of the player
who runs the table. There is no second page and no second key: whatever that
screen may do at the table, this is it.

**One row of controls**, the same five on both screens and in the same order —
under the bids on the TV screen, and beside the turn on the phone:

| | |
|---|---|
| **❚❚ Pause / ▶ Play** | Stops the table, for everybody. |
| **Start the hand** / **Take the trick in** | Only where the table has hung on a beat nothing is left to end. |
| **Bum deal** | Throws the hand in and deals it again, counting the re-deal. Any player can ask; the dealer and the table host throw it in. |
| **Reset round** | Puts the round in play back to its bids, to be played again. |
| **New game** | The same players, no scorecard. |

**Reset round** is the round in play, back to the start of its bidding: the
bids go, and on a table dealt on the phones the hand is dealt again. Where the
game is over it is the last round that comes back, so a game that ended on a
round nobody agreed with is played again rather than argued about. It is not
offered while the bids are still coming in — there is nothing behind them, and
a hand dealt wrong is thrown in with *Bum deal*, the button beside it.

**A round already scored is not reached backwards.** It is put right on the
scorecard, below, where its number is read.

Every one of them hides itself where there is nothing to do, and the row goes
when they all have. The bum deal is the only one any player gets; the rest are
the table host's.

**The seat the table is standing on** keeps its own panel, as it always had:
*Bid for them*, *Play a card for them*, *Auto-play that hand*, *Carry on*.

**The standings are the list of everybody**, once the lobby is gone, so that is
where the seat controls live. Each row says where that seat is — **host**,
**bot**, **auto-play** for one the table was given, **away 4m** for one nobody
is behind — and carries a ⋯ for whoever runs the table:

- **Let back in** — a seat the table was given, handed back. It cannot be that
  player's own button: whoever the table is playing for is not there to press
  anything, and their phone may have forgotten the table altogether. Once the
  seat is open they come back the way any phone that lost its seat does — the
  code and the name they played under. The seat's clock starts again from that
  moment, so a seat opened and not taken up is handed over again in its own
  time rather than at once.
- **Auto-play their hand** — a player who has gone home. Any seat nobody is
  behind, not only the one the table is standing on: they need not be holding
  the game up for their hand to be one nobody is behind. Only on a table dealt
  on the phones; with real cards their cards are on the table in front of them.
- **Make table host** — the table passed on, mid-game. Never to a bot, and
  never to a seat the table is playing.
- **They dealt this hand** — who dealt. Only with **real cards**, where a
  person did the dealing and can have been the wrong one, and only while nobody
  has bid, because the order of bidding is the dealer's.
A name is not on that menu. The name is the column on the scorecard, and the
head of that column is where it is changed — one place, where the thing being
renamed is the thing being looked at.

Before the game the same controls are on the lobby's own seat list, where they
have always been, with **Kick** as well — a seat only goes while nothing has
been played, because after that the scorecard is a column for it.

### The scorecard is editable

Whoever runs the table taps a **scored round** on the scorecard and retypes it.
That is the only way back into a round the game has moved past, and it is the
right one: what went wrong is a number, and the number is being read right
there.

**Three things on the card are tappable**, and each opens what it is:

- **a figure** — one seat's `2→1` in one round;
- **the round** — its own cell down the left, `3 · 5♠`;
- **a name** — at the head of its column. That opens the name to be changed,
  because the column is the name. Never a bot's: that name is the table's own.

A figure and a round open the same sheet, and it holds the **whole round**: a
bid and a won for every seat, with the check under them. Tapped on one figure
it opens on that seat, ringed and ready to retype — but the other seats are
there, because they have to be:

**The tricks have to total the hand.** At a table they always do, so a column
that does not is refused rather than filed — and it is the check that catches
the slip, because a trick taken off one seat has to land on another. A cell
sent on its own could never satisfy that, which is why the sheet is the row.

The bids are bounded by the hand and nothing else: a bid that broke the
screw-the-dealer rule was still the bid that was made.

The round in play is not editable. It is already being typed on the bid pad and
the trick counter, and on a table dealt on the phones its tricks are the cards
the server is holding. Put it back with *Reset round* and play it again.

Every screen sees the corrected card at once, the totals follow it, and a game
that was already over is filed again under the same name, so the card in *Past
games* is the card on the screen. The accolades stay as they were drawn: they
were drawn once, and drawing them again would be a different game's worth of
luck.

### A browser holds more than one table

Every table a browser takes a seat at is remembered, newest first, up to eight.
The front page lists them, each with its own **Rejoin** and a × to forget it,
and every page pins its table to its own address (`play.html?c=CODE`). A second
table therefore cannot lose the seat at the first — which it used to, because
there was one slot for a seat and every page wrote it on every reconnect.

The name a phone plays under is kept with them, so coming back to join another
table does not mean typing it again: the first visit asks for it before
anything else, and after that it lives on the settings page with the photo.

**The phone that runs the server sees every table on it.** That list is the
browser's own memory, and a server can be running tables it knows nothing
about: one started from a TV screen, or one whose seat this browser has
forgotten. So the front page, read on the machine that serves it, asks the
server what it is running and offers the rest under **Tables on this phone**,
each under **Running tables**. Each row carries what can be done with that
table: **Take a seat** while it is still in the lobby, **Take my seat** when a
seat carries this phone's name and nobody is behind it, and **Watch** — the
screen a TV shows, which changes nothing at the table. So the phone that runs
the server never types a code: a code reaches that server and no other, and
every table on it is already named here. The join panel is not offered there
at all — joining somebody else's table from a phone that has just started a
server would be running that server for a game played somewhere else, and the
app's own chooser opens their address without starting one. A player's phone
keeps it, code box and camera both. Each row reads the same way: the table's name, then the mark
and the badge that end the line, the buttons on the line under it, and who is
at the table under those — on one line, so a table of eight does not push the
page about: the names that fit, then *and 2 more*. It is measured, so a wider
screen shows more of them. The mark says what the table is doing: a game in
play turns, a table waiting for players breathes, a game that is over is
still. With reduce motion on, the marks are the same shapes and do not move. `GET /tables.json` answers that, and only to the machine the server
runs on: a table's four characters are the only door it has, and a listing
handed to every browser on the network would open every table to anybody who
could reach the page.

A table is also that machine's to **end**: the × beside it in the list, or
**End this table** on the settings page while watching one. It asks first.
Every phone at the table is told it is gone, the bots stop, and the file the
table would have come back from is removed — nothing is scored and nothing
goes to Past games. `POST /table/end?c=CODE`, local only and never a GET, so
no link followed by mistake and no page fetching ahead of itself can end a
game. A table that has ended says so on the
front page rather than sending the player back with nothing said.

### A table outlives the server it is on

The phone that hosts a game is a phone: it is stopped from its own
notification, or put away, or Android takes the memory back. The game is in
that server's memory, and every other phone still holds its seat — so a table
in play is written to disk after every change and read back when the server
comes up. Rejoin then goes back to the game, in the round it was in, with the
hands that were dealt. A trick that was being held up for the table to read
when the server stopped is settled as it comes back, because nothing is left
to end that hold.

Nobody is at a restored table until they connect to it, so every seat starts
away and fills in as the phones come back. Pictures are not kept with the
table — 48K apiece, and every phone hands its own over again. `KEEP_HOURS`,
6 by default, is how long a table nobody has touched is kept, in memory and on
disk alike.

**A table nobody is at takes itself away.** Nobody is at it when no player is
online and no screen is watching — bots are nobody, and so are the stand-ins on
a dev table. A lobby or a game that is over goes five minutes after the last of
them (`TABLE_IDLE_MS`); a game in play is given half an hour (`GAME_IDLE_MS`),
because a hand people are in the middle of is one they mean to come back to.
It is not a game ending: nothing is scored and nothing is filed, the table
itself is taken away, and its code opens nothing afterwards. A table restored
from disk starts its clocks when the server comes up, so a phone that hosts and
is restarted does not lose every table it was holding.

### Table talk

Every table has a chat room of its own. 💬 in the top bar opens a sheet over the
game, with a count on it of what has not been read; a line arriving while the
sheet is shut says itself in a toast instead, the same way a bid does. Players
talk, the TV screen talks as **Table**, and a watch-only window reads and says
nothing.

The talk belongs to the table, not to the game on it: it carries over into the
next game and lasts as long as the table does. The last hundred lines are kept,
in memory, and never written to disk -- not into a saved game, not into a phone's
history. It travels the same socket as the bids, so like the rest of the game it
needs no internet at all.

### Accolades

When the last round is scored, some of the accolades the table earned are drawn at random. **Three** by default, and the rules take anything from none to five. Each one pays its holder **10 points** by default, or 20, 5, or nothing.

**Which ones a table plays for** is the table's own choice: under *Which ones* in the rules, every accolade the game has can be turned off, and only the ones left are ever drawn. A table that has never been asked plays with all eleven, and so does every game played before the choice existed.

The finish plays in three moves:

1. **The places, as they stood before the accolades.** Every score is the one the scorecard shows. The screen holds there for five seconds, so the table can read them.
2. **Each accolade in turn, eight seconds each.** The name comes up with what it was for, the **+10** lands, and that player's score runs up in the list behind. The places shuffle as the points go in.
3. **The winner** — whoever is top once every accolade is paid, which is not always whoever led before them.

On a table dealt on the phones the felt is up when the last round is scored, and it hands the game straight to the finish: the stage is held at full through the handover, so the scorecard behind it is never shown. On a screen with nothing up the finish is a scene opening, and it fades in.

With three accolades the finish runs about 35 seconds. A tap lands the whole thing at once — every accolade paid, the list settled, the winner there — and another clears it.

They come from the scorecard alone — the bids, the tricks and the hand sizes — so a table with real cards earns them the same way as one with a virtual deck. The scorecard grows an **Accolades** row under the last round, and the Total row is the final score.

| Accolade | Who gets it |
|---|---|
| **Most fearless** | Bid the most tricks in all |
| **Most tricks won** | Took the most tricks |
| **Best round** | The highest score in a single round |
| **Steadiest hand** | Fewest tricks out, over the whole game |
| **Best comeback** | Climbed the most places in the second half |
| **Zero hero** | Bid nothing and took nothing, most often |
| **All in** | Bid a whole hand and made it |
| **Quiet achiever** | Won the most tricks above their bids |
| **Most careful** | Bid the fewest tricks all game |
| **Biggest eyes** | Bid the most tricks above what they won |
| **Hardest luck** | Most rounds that paid nothing |

An accolade is shared when two players earn it, and both are paid. It is not awarded at all when half the table or more would share it, or when every seat is level. A game of fewer than three rounds earns none, and nothing is drawn.

### Playing with a virtual deck

The table can play without real cards. In the lobby set **Cards** to *Deal on the phones*, and the server becomes the dealer:

1. It shuffles a 52-card deck and deals the hand to each phone. A hand is a secret: the server sends each socket the table and **its own cards only**, and the TV screen is dealt none.
2. It turns the next card for trump, before the bidding, so everybody bids knowing it. With nothing left in the deck — four players at thirteen cards — the hand is played at no trumps.
3. Bidding runs as it always does, in order, with screw the dealer if it is on.
4. The bids stand to be read before a card is played, the same beat the whole
   table holds. The felt says *Bids are in* over the middle, with what they
   total and who leads, and every pile keeps saying what was bid until the
   hand opens.
5. The player left of the dealer leads. On a phone the round is played on the
   felt -- see **The table** below. Cards you may not play are dimmed: you must
   follow the suit led if you hold it. On the TV screen the trick lies in the
   middle, and a card back stands for the seat the table waits on -- peeking,
   the way their pile does on the deal and on the felt -- until their card
   lands on it.
6. The highest trump takes the trick, or the highest card of the suit led. The trick stays on the table for a second and a half so everybody sees it, then the winner leads.
7. When the last trick is played the round scores itself. Nobody types anything in.

The rules are held on the server, so a phone cannot renege, play out of turn, or play a card it does not hold. What changes on a virtual table:

- Nobody counts the tricks: the cards count themselves, and a tap that says who took one is refused.
- Nobody picks the trump. The deck turns it.
- **Undo last step** deals that hand again, because those cards are gone.
- The empty seats can be played by bots: see **Bots**.
- A phone that goes quiet would stop the table, so whoever runs the table gets **Play a card for them**. The server picks, and only from the cards the rules allow, so nobody chooses another player's card.

### Bots

A hand short of people, bots can play the empty seats. In the lobby,
whoever runs the table taps **Add a bot**. A bot takes a seat like anybody else:
it has a name, it is dealt a hand, and it bids and plays it. **Kick** it from
the ⋯ menu beside it, as you would a person.

- A bot needs cards of its own to hold, so adding one sets **Cards** to *Deal on
  the phones*. At a table with real cards there is nothing for a bot to hold and
  nothing it could do. The switch back is refused while any are seated.
- A bot is never handed the table: somebody has to be able to start the game.
- It bids what its hand looks worth -- top trumps, aces and kings, and a void
  when there are trumps to ruff with -- and it will not call the number screw
  the dealer forbids.
- It plays to make its bid and no more. Wanting a trick it takes it with the
  cheapest card that will; having made its bid it ducks, because an overtrick
  pays less than an exact one.
- It plays through the same rules as everybody else, so it cannot renege, play
  out of turn, or play a card it does not hold.
- It has no opinion about a bum deal, so it agrees to one.
- It waits for the deal to be watched. The round is dealt on the phones before
  it is bid, and a bot that bid while the cards were in the air had bid before
  anybody saw one. Each phone says when its table is up -- the deal played out,
  or was tapped away, or was never played at all -- and the first hand of the
  round is bid only then.

`BOT_DELAY` sets how long a bot waits before it acts, in milliseconds. The
default is 1250: long enough that it does not answer before the table has read
the last card, short enough that three of them are not a wait. `BOT_DEAL_WAIT`
is the longest it waits for a phone that says nothing at all, 9000 by default.

### The table

With a virtual deck, a phone plays the round on the felt the deal lands on. It
is the screen, not a flourish: the hand you were dealt is the fan in front of
you, the card the deck turned lies in the middle, and the cards played ring it
rather than pile onto it, so it is on show all round. The table sits a little
above the middle of the screen, and your own hand well below it. Between the
piles either side of you and the line along the bottom there is a band, and
what stands in it -- your hand, the heading that names it, and while the
bidding is on the row of numbers and its own heading -- goes in the middle of
that band.

- **Touch a card** and it lifts out of the fan and enlarges. **Run a thumb along
  the fan** and each card lifts in turn -- the overlap does not have to be aimed
  at, because the card nearest the thumb is the one meant.
- **Push a card up** out of the fan to play it. A dashed line appears; released
  above it the card flies to the middle, released below it drops back. A card
  already lifted is played by tapping it again, so nothing needs a drag. The
  line runs at the height the word **dealer** stands at when the deal is yours,
  and breaks for it, so the word sits in the line.
- A card you may not play is dimmed, and says why if you try: it shakes, keeps
  its place, and the line at the bottom gives the reason.
- **The place a hand had stays.** The last card of a hand -- yours, or any
  seat's pile -- lies on a dashed outline of itself, and the outline stays when
  the card is played. A hand played out to nothing leaves its place, not a
  hole.
- **Another seat's card is picked up, not produced.** When somebody else
  plays, the card comes off the top of their pile: it lifts off the stack and
  bows across onto the spot it lands on -- clockwise, the way the trick that
  gathers it comes round -- turning face up and swelling as it comes. The turn
  takes most of the way over rather than a moment in the middle of it: there is
  no perspective for a card to turn under here, so what says it turned over is
  how long it takes. The whole of it is a card's own pace -- the same as the
  plain slide a screen falls back to when it cannot draw an arc, so the round
  is paced the same either way -- because it is the move the table is waiting
  on and there is one of them per card in the trick. Your own card is different, and unchanged: it
  comes out of the fan under your thumb.
- **A trick taken is said out loud**: *"Otter won that trick"* comes up under
  the pile, so the card that took it is still there to see. It stays for two
  seconds, and the cards come in while it is still up -- each one curves round
  the ring clockwise, the way the seats run and the order the cards were
  played, until the whole trick is stacked on the winner's card. The way round
  is one drawn arc, not a hop from seat to seat: a card comes round the table
  in a single movement, the way it goes back out again when the round is put
  away. The longest way round takes the whole sweep, whatever the size of the
  table, and the nearer seats proportionally less, so they all set off
  together and come in in the order they sit.
  Then the trick goes to a little fanned stack beside their seat, all of
  it: those are the cards that were played, and they are what comes back out
  when the round is put away. The stacks count the
  tricks won. The table holds the trick a little longer than that before the
  winner leads, so a lead never cuts the news short (`TRICK_HOLD`).
- **The round is put away, not replaced.** When the last trick is scored,
  what the round paid stands for two seconds; then each seat's pile of tricks
  unwinds. The cards leave one after another in a single stream, evenly spaced,
  trick by trick and the seats anticlockwise: each lifts off the little stack
  beside its seat -- the rest of that pile lies where it is, face down, until
  its own turn comes -- and spirals in --
  anticlockwise, the way round the table opposite to the way a trick was
  gathered -- coming up to the size of a card in play and turning face up as it
  goes, until it settles under the card the deck turned. One card at a time,
  and the seats in that same anticlockwise order, so the whole table unwinds
  one way. The names stay until the cards are well on their way, so there is
  something for them to have come from. They square up in the middle, under the card the
  deck turned, which stands over them the whole way. Only when the last one is
  in does that card turn face down on top of them, and what is left is a deck.
  A hand of thirteen tricks shortens the wait between cards rather than making
  the round longer; a stand-in for a trick this phone never saw has no face to
  show, so it comes in face down. Where the round leaves everybody then
  stands over that deck for three seconds. It comes up as the round found it
  -- the scorecard's own rows, best first, with everybody where they stood
  before the hand -- holds still for half a second so you can find your own
  row, and only then says what the round did: the scores run up, the bars grow
  to their new lengths, and anybody who changed places slides past whoever
  they passed, exactly as on the scores page. Then it fades. Then the next round is shuffled out of the same deck: the scene
  carries on from the table rather than opening on one, so nothing is wiped,
  nothing is faded up, and the page behind is never seen between two rounds.
  With movement off none of this plays.
- **Bidding** happens on the felt too: the numbers arc above your hand, under
  a heading of their own and clear of it -- and of the ring round it when the
  deal is yours -- and are picked up the same way -- touch to lift, tap
  again to call. Your own bid stays lit and can be changed until the next player bids.
  The number screw the dealer forbids is struck through. Another player's bid
  lands the way it does on the TV screen: the number slams onto their pile in
  gold, the pile takes the hit, and the name under it keeps the bid.
- **Who deals is marked, not written.** The dealer's cards and the name under
  them stand in a gold dashed outline with **dealer** cutting the line at the
  top, so the round line above stays the round and the hand size. When the deal
  is yours you get the word alone with no outline round it: a box round the
  heading over your own hand crowded the hand it belongs to.
- **The seat the table waits on peeks.** The top card of that player's pile
  tips up on its edge and shivers, every few seconds -- the same peek the TV
  screen gives the player to bid -- through the bidding and whenever a card
  is wanted from them. Your own seat never peeks: your hand, and the line
  under it, say when it is you.
- What is said in passing -- a bid landing, a phone dropping out, a refusal
  -- comes up in the band under the round line, clear of the piles and the
  hand, and never over the round line itself.
- The corner buttons are the way off the table: **Scores** drops the felt to
  the page underneath, and **Back to your cards** brings it back. That page is
  the scorecard and nothing else -- the round, the bids (won against bid once
  the cards are out), the standings, and the card, open, never folded away --
  read as one page rather than a stack of cards,
  with **Leave the game** across the foot of it. One panel appears on it only
  when the table needs a decision from that phone: a vote to answer, or a seat
  with nobody behind it that the table is stopped on.
  The other corner opens table talk.
- **A table of many comes down in size.** Eight piles at full size do not go
  round a phone, so the piles, the stacks of tricks won and the names under
  them shrink as seats are added.
- With **Animations** set to *Off* on the settings page the felt is drawn without the
  deal and without any movement. Everything is still reachable.
- **Game speed**, in a section of its own on the settings page, is `0.5×`, `1×`
  or `2×`. It is written the way a speed is written on anything that plays --
  bigger is quicker -- so every duration is divided by it: `2×` draws the deal,
  the cards, the gather, the putting away and the finish in half the time, and
  `0.5×` takes twice as long over them. `1×` is the game as it is drawn, and
  every number in this file is that.

  It belongs to the screen, not to the table. Everybody at a table may have a
  different one and none of them changes the game for anybody else: what it
  moves is how this screen draws what happened, never what happened or when
  the table allowed it.

  The one thing the table does have a say in is a **replay**. A copy of a game
  being watched again tells every screen on it how fast it is being played
  back, and the two multiply: a screen set to `0.5×` watching a replay at `2×`
  draws at `1×`, which is what both of them asked for. A real table says
  nothing here -- what happened, happened when it did -- so it is always `1×`,
  and the settings row goes on showing this screen's own choice and nothing
  else.

  That is also why it cannot slow everything down. A beat this screen holds
  while the table waits for it -- a trick left up to be read, what a round
  paid, the places at the end of one -- sits inside a window the table grants:
  a trick sits for `TRICK_HOLD` before the winner may lead, and the bots wait
  `DEAL_WAIT` for the phones to say their tables are up. Those beats are cut
  short at `2×` and left alone at `0.5×`; past the window the table moves on
  and cuts the beat anyway, which reads worse than never having asked. The
  movements themselves scale both ways.

  What the table itself paces is untouched by it: a bot still thinks for
  `BOT_DELAY` before it plays, whatever this is set to.

### Bum deal

If the cards were dealt wrong, throw the hand in and deal it again. The round keeps the same dealer and hand size, and the bids, tricks, and trump are cleared. The round label then shows `re-deal 1`.

- The **dealer** or the **table host** presses **Bum deal** and re-deals on their own. They are asked to confirm first, so one stray tap cannot throw a hand in.
- Any other player presses **Ask for a bum deal** and the table votes. Every player must agree. One "no" ends it, and the player who asked can withdraw it. The table host, or the TV screen, can also throw the hand in without waiting for the vote.
- On a table dealt on the phones the button is on the page under the felt (press **Scores**), and the vote shows on the felt as well, so a player answers it without leaving their cards.

If the table host leaves the table, the badge moves to the first seat.

### TV screen

A TV screen belongs to one table, and it asks which. **Start a table**
makes one. Or type a table code and **Show a table**: the screen shows a
game that is already running, and changes nothing at it — the players keep
their seats and their phones still run the game. That screen cannot touch the
game, which is what lets it take a code alone: it is shown only what is already
on show, and none of the table's controls — no bum deal, undo, new game, trick
pad or vote buttons. Use it to put a game that started on a phone up on a
television without moving anybody.

- **Text size** under ⚙ scales the page from 100% to 200%, so the table can read
  it from across the room. The size is remembered in that browser.
- **Dev controls** under ⚙ opens the dev page on this table, to put a game in
  play right. It is offered wherever this screen holds the table's host token.
  See [Fixing a real game](#fixing-a-real-game).
- The TV screen and the player phones ask the browser to keep the display awake while a game is on, and release it in the lobby and after the last round. A pill in the top bar says what happened: `☀ screen on` means the browser is holding it, `☀ screen on*` means a best-effort silent video is holding it, and `☾ may sleep` means neither worked.

### Keeping phone screens on

The Screen Wake Lock API only exists on a **secure page**. `http://localhost` counts as secure, but `http://192.168.1.5:8787` on a phone does not, so phones fall back to the silent video, which an iPhone ignores.

To fix it, serve https:

```sh
npm run cert     # makes certs/key.pem and certs/cert.pem for this machine
npm start        # the console now says (https)
```

`npm run cert` needs `openssl`, and it puts every address of this machine in the certificate. Nobody signed it, so each phone shows a warning the first time. Accept it once and the screen lock works. Set `TLS_KEY` and `TLS_CERT` to use your own certificate, or `NO_TLS=1` to force plain http.

Both screens play the deal animation at the start of every round. On the TV screen, and on a phone at a table dealt on the phones, a card flies to each seat in dealing order, with the player names.

What the deck turned is not said in words: the card is turned face up in the middle of the table and stays there, and the band under the round line is left for what the table has to say.

Who deals is not said in words either. The round line across the top is the round and the hand size -- *Round 3 · 5 cards* -- and the dealer is ringed where they sit: a gold dashed outline round their cards and the name under them, with **dealer** cutting the line at the top. A name in a line has to be read and then matched to a seat; the ring is the answer where the question is asked. When the dealer is you, the word stands over the heading of your own hand with no outline round it -- your cards are a fan across the bottom of the screen, a box round that would be most of the screen wide and would shrink with every card you played, and a box round the heading alone crowded the hand. Every screen that draws seats draws the mark: the TV screen, the deal on a phone, and the felt. It goes when the round does.

- On the **TV screen** the scene holds while the bids come in. Each player's name gains their bid as it arrives -- a bid that lands while the cards are still in the air is stamped once they are down -- the player to act glows and their pile peeks -- the top card tips up and shivers every few seconds -- and a line reads "Waiting for Amy to bid". It closes itself when the last bid lands. One tap lands the deal early, a second tap dismisses it.
- On a **phone** at a table with real cards only the shuffle plays: the deck is riffled and squared up, and the scene fades before any card goes out -- the real dealer deals the real cards. A tap skips it. It does not replay when a phone reloads part way through a game.

When a **player** bids, every other screen says so: a line slides in — **"Hugh bid 2 · Joe to bid"** — waits a couple of seconds, and goes. A bot's bid is not said. A line is for what somebody did while you were looking away, and a bot answers the moment it is asked: a table with three of them kept three lines stacked up through the whole of the bidding. What a bot did is still shown — its chip pops in the strip, and its number slams onto its pile — it is only not said. It comes up under the top bar on a page with no table up, and while a scene is on it comes up in the empty band between the round line and the top of the ring, clear of the piles. Your own bid is not announced, because your own pad already shows it. A refusal from the table — a bid out of turn, a rule that cannot change with bots seated — is said the same way, in red, so it is seen over the felt and in the lobby alike. On the TV screen, while the deal is held open, the bid is stamped onto that player's card instead: the number slams down in gold, the card takes the hit, and the name below it keeps the bid from then on.

When the last round is scored, both screens play the finish: the places come up from last to first with the scores before the accolades, each accolade is then read out and paid into the list, and last the winner's card turns over and paper falls. Every player's score is on screen, best first, with a shared place for a draw. It clears itself after a few seconds. A tap lands it, and a second tap clears it. A screen that opens on a game already over does not replay it.

The `?motion=` flag under [Motion](#motion) works on `host.html` and `play.html`.

Phones reconnect on their own. A player who closes the page and comes back is offered their seat again, because the seat token is kept in that browser, and the table is still there because it is [kept on disk](#a-table-outlives-the-server-it-is-on).

### Rules the host can set

- Biggest hand, and the round pattern: down then up, up then down, down only, or up only.
- The 1-card hand repeats once per player, so every player deals it one time. Example: 4 players, down then up, biggest hand 7 gives `7 6 5 4 3 2 1 1 1 1 2 3 4 5 6 7`.
- An exact bid pays 10, 5, 1, or 0 plus the tricks won.
- What a missed bid pays:
  - **must make the bid** (default) — win more than your bid and you score the tricks won. Win fewer and you score 0. With a 10 bonus: bid 2, win 3 = 3; bid 2, win 2 = 12; bid 2, win 1 = 0.
  - **must make the bid, with a penalty** — the same, but short by *n* tricks costs *n* points.
  - **0 points**, **minus 1 per trick off**, or **tricks won only**.
- Screw the dealer, and -- on a virtual deck -- whether a card is turned for
  trumps. With real cards the deck on the table decides everything about
  trumps, so nothing on a phone or the TV screen asks about them.
- Real cards on the table, or a virtual deck dealt on the phones. See [Playing with a virtual deck](#playing-with-a-virtual-deck).
- How many accolades are drawn at the end, from none to five, what each one pays -- 20, 10, 5, or nothing -- and which of the eleven the table plays for at all. See [Accolades](#accolades).

## Play with no internet

The game never talks to the internet. The pages, the fonts and the QR code all
come from the server, so a table works anywhere the phones can reach the
machine that runs it — a plane included. The internet was never the
requirement; a machine on the same network running the server is.

One phone makes the network, a laptop runs the table:

1. **Before the trip, with internet:** put the project on the laptop and run
   `npm install` once.
2. **On the plane:** turn on one phone's hotspot. It needs no signal — the
   hotspot is only a local network.
3. Join the laptop to that hotspot and run `npm start`.
4. The console prints the address the hotspot gave the laptop. Open the host
   screen there, or open the site on any phone and press **Start a table and
   play** — the table host is a player, so no TV screen is needed.
5. Everyone else joins the hotspot and scans the QR code as normal.

Worth knowing:

- If the laptop holds more than one address, the picker on the TV screen
  chooses which one goes into the QR code. Pick the hotspot one.
- Some hotspots keep their devices apart from each other ("client
  isolation"). The phones only need to reach the laptop, and that path
  generally stays open. If a phone cannot load the page, look for that
  setting on the hotspot.
- Over plain `http` a phone may dim and sleep between turns. `npm run cert`
  and a restart give the server `https`, and then the pages hold the screen
  awake.
- No laptop? An Android phone can be the server: Node runs in Termux, so the
  hotspot phone itself can run `node server.js`. An iPhone cannot run the
  server.
- On Android the server cannot read the interface list (the OS hides it from
  apps), so it asks the routing table instead: a UDP socket is connected to an
  address that is never routed, and the local address the kernel picks is the
  phone's own. That address goes in the banner and in the QR code, the same as
  on a laptop. If it still shows none, `PUBLIC_URL=http://<address>:8787` names
  it by hand, and `HOST=0.0.0.0` pins the listening address.
- **Termux from Google Play cannot serve the other phones.** That build targets
  Android 17 and declares no local network permission, so Android blocks it in
  both directions: it reaches the internet, and nothing on the Wi-Fi. The
  handshake even completes and then no byte passes, which reads like a broken
  server. Install Termux from [F-Droid](https://f-droid.org/en/packages/com.termux/)
  or [GitHub](https://github.com/termux/termux-app/releases) instead; those
  builds target an older API and keep local network access. Or use the Android
  app below, which asks for the permission properly.

## Run it as an Android app

The phone can be the whole table: the app carries the server inside it, so one
phone hosts and plays, and everybody else joins with a browser. No Termux, no
laptop.

`android/` is an Android Studio project. It embeds
[Node.js for Mobile](https://github.com/nodejs-mobile/nodejs-mobile) and runs
`server.js` unchanged, with the pages served from the app's own files.

**Get the APK.** Every tag and every release builds one and attaches it: take
`up-down-the-river-<version>.apk` from the
[latest release](https://github.com/chrisjtwomey/up-and-down-the-river/releases).
That one is signed with the project's own key, so the next release installs
over it. The `-debug.apk` beside it is for working on the app.
Android asks whether to allow the install, because it did not come from a store.
Say yes, open the app, and allow the local network when it asks.

**In the app.** *Host on this phone* starts the server and opens the landing
page, where **Start a table** takes seat 1 as usual. That page leads
with Start when it is read on the phone that runs the server, and with Join
everywhere else -- the host wants a table, a player wants a seat. Join is still
there for the host: a table made from a TV screen needs a seat taken
in it. The others scan the QR code with a camera, or type the address.

**Joining somebody else's table needs no server of our own.** The app's first
screen has *Join a table*: **Scan their code**, which reads the QR code on
their TV or phone and opens that table here, or their address typed by hand.
Neither starts the server on this phone. The scanner is on that screen and not
on a table's join page because a browser hands over the camera only on a secure
page: the app's own screen is one, and a table reached over plain `http` is
not -- so the only place a scanner could otherwise live is a server we started
ourselves, which is a server running for a game played on another phone.

The way to put the table down is at the foot of the landing page: **Stop
hosting table**, under *Past games* and *TV screen*, where the player page has
*Leave the game*. It asks first, then stops the server and comes back to the
app's Host-or-Join screen. The table itself is kept on disk, so hosting again
picks it up where it was. The system back gesture still only leaves the screen
and leaves the server running. Only the app sees that button, and only on the
phone that serves the page: it marks its WebView, and the page reads the mark.

While a table is open the app shows a notification, so Android leaves the server
running with the screen off. **Stop** on that notification closes the table.
Tapping it comes back to the chooser you already had, rather than building
another on top of it, so back is one step out and not a walk down through
every screen the app has ever opened.

The phone is held awake for a table that is being played, not for one that is
merely open: once every phone has gone and nothing has happened for five
minutes, it is allowed to sleep, and the next player to arrive wakes it. A game
left open overnight no longer costs a night of battery.

**Android asks for the local network permission on first run. Say yes.** Without
it Android 16 and later cut the app off from the Wi-Fi, and no other phone can
reach the table.

**The mark.** The icon and the splash are the game drawn: five stacks of cards,
1-2-3-2-1, the hand growing to the top of the river and shrinking back down,
with the card at the peak in gold. One shape, three places, all the same size on
screen so it does not jump as one hands over to the next: the phone's own splash
(`res/values-v31/themes.xml`), the window behind the pages
(`res/drawable/splash_window.xml`), and the page the app opens on
(`assets/chooser.html`). The shape itself lives in `res/drawable/river_mark.xml`
and again, in SVG, in the chooser: change one and change the other.

**The Java.** `MainActivity` is the chooser, `TableActivity` the table in a
WebView, `NodeService` the server and its notification, and `CameraForWeb` the
one answer both WebViews give a page that asks for the camera: it hands the
question to Android and the answer back to the page.

### With no internet at all

Nothing here needs the internet. Every page, script, picture and QR code comes
from the table's own server, and the game itself is only a few phones talking to
each other. A plane, a boat, a field: it makes no difference, so long as the
phones are on **one network**.

Getting them on one network is the part that needs care.

- **Plane Wi-Fi usually will not do it.** Most of them wall the passengers off
  from each other, so a phone can reach the internet -- or the paywall -- and
  nothing else on board. Nothing in this app can undo that.
- **One phone shares its hotspot instead**, and that same phone hosts the
  table. Aeroplane mode with Wi-Fi on is enough; no mobile data is needed. The
  others join the hotspot, then open the address it shows.
- **The joining phones can find the address themselves**, if the QR code is out
  of reach: it is the "router" or "gateway" in their own Wi-Fi details.
- **Scan the code with the phone's own camera app**, or with *Scan their code*
  on the app's first screen. Not the button on a table's join page: a browser
  only hands the camera to a page over https, and a table on a hotspot is plain
  http, so the in-page scanner hides itself there.

The host phone has to know its own address to put in the QR code, and on a
hotspot with no route off it that is harder than it sounds. Four things answer
it, so one failing costs nothing:

1. Its own interface list, which is right whenever the platform will give it.
   Termux will not, and Android has taken quieter ways of asking away before.
2. The app therefore reads its interfaces in Java as well -- tethering included
   -- and leaves them in `lan-addrs.txt` for the server, refreshed every half
   minute. `LAN_ADDRS=192.168.1.5,...` does the same on any other machine.
3. The server asks the routing table, first about somewhere off this network and
   then about the local link, which needs no route off it.
4. Every player who arrives brings the address they used, and the table keeps it
   -- a private address on its own port, and nothing else, because that header
   is written by the player's browser.

If all four come up empty the TV screen says so plainly and takes the address
typed in. On a laptop `PUBLIC_URL=http://192.168.1.5:8787` still overrides the
lot.

### Build it yourself

```sh
android/tools/build-local.sh              # debug APK
android/tools/build-local.sh assembleRelease
```

One command, and it needs nothing installed first: no Android Studio, no
`JAVA_HOME`. It fetches what is missing -- a JDK through Homebrew, and the
Android command line tools, SDK, CMake and NDK into `~/Library/Android/sdk` --
then assembles the node project and builds. The first run downloads about 2 GB
and takes a few minutes; after that a build is under a minute, which beats
waiting on a runner.

The APK lands in `android/app/build/outputs/apk/debug/` as
`up-down-the-river-dev-debug.apk`, or with the version you name:
`APP_VERSION=v0.2.0 android/tools/build-local.sh`. Install it over USB:

```sh
adb install -r android/app/build/outputs/apk/debug/up-down-the-river-*-debug.apk
adb logcat -s UpTheRiver-node UpTheRiver        # the server's own output
```

With the SDK already in place, `android/tools/prepare.sh` and `gradle
assembleDebug` do the same thing in two steps. `prepare.sh` must run again
after any change to `server.js`, `game.js` or `public/`: the app carries a copy,
and the copy is not in git.

### Working on it, without building an APK each time

Three loops, from slowest to fastest. Reach for the last one that fits.

1. **Native code changed** -- Java, the manifest, `chooser.html`:
   `android/tools/build-local.sh && adb install -r <the apk>`. Under a minute.
2. **The server or the pages changed:** `android/tools/push-dev.sh`. It writes
   the node project straight into the app and takes about two seconds. A change
   under `public/` needs nothing else -- a debug build runs node with `DEV=1`,
   so it watches its own files and **every open screen reloads itself**. A
   change to `server.js`, `game.js` or a dependency restarts the runtime and
   brings the table back up, which the script notices and does for you.
3. **Pages only, and no phone in the loop at all:** `npm run dev` on the laptop,
   then *Join a table* in the app with the laptop's address. Same live reload,
   no push. This exercises the laptop's server rather than the phone's, so it
   suits screen work and not much else.

`push-dev.sh` works on a debug build only: it writes into the app's own folder
with `run-as`, which Android allows for a debuggable app and nobody else.

A debug APK is signed with a key made on the machine that built it, and Android
refuses an update signed by a different key. So a CI build cannot install over a
local one, or over an older CI build: uninstall first, or set the release
signing secrets below and install release APKs, which all carry one key.

One key of your own ends that. Make it once, keep it safe -- without it no
later build can update an installed app -- and give it to the workflow:

```sh
keytool -genkeypair -v -keystore release.keystore -alias rivertable \
  -keyalg RSA -keysize 2048 -validity 10950
base64 -i release.keystore | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEYSTORE_PASSWORD   # what keytool asked for
gh secret set ANDROID_KEY_ALIAS -b rivertable
gh secret set ANDROID_KEY_PASSWORD
```

Every release then carries `table-server-release.apk` as well, and each one
installs over the last. A store made with `openssl` instead of `keytool` is
PKCS12, which is the type the signing config names.

Worth knowing:

- Only `arm64-v8a` is built, which is every phone from about 2017. The APK is
  about 70 MB, nearly all of it the Node runtime.
- The runtime is Node 18. The server needs nothing newer, and `npm test` runs on
  Node 18 in CI to keep it that way.
- iPhones cannot host. Node.js for Mobile builds for iOS, but publishing to a
  phone needs a Mac and a paid developer account. An iPhone joins as a player
  like any other browser.
- `libnode.so` is built for 4 KB memory pages. Android warns about that on a
  debuggable build, and a phone running 16 KB pages could not load it at all.
  No phone ships that way by default today, and the app targets an API where it
  is not required. It becomes a real limit at target API 36, and the answer is
  a rebuilt Node.js for Mobile.

## Run it with Docker

```sh
PUBLIC_URL=http://192.168.1.5:8787 docker compose up --build
```

`PUBLIC_URL` is the address the phones use. A container cannot see it, so the QR code shows this instead of the container's own address. Use the address of the machine that runs Docker. Without it, the QR code says `localhost`, which no phone can reach.

`PUBLIC_URL` **replaces** the detected addresses, it does not add to them. Behind a proxy or in a container the detected ones are private and useless to a phone, so the TV screen offers only what you name here.

The compose file mounts `./certs` read only. Run `npm run cert` on the host first for https, or delete that line. `NO_TLS=1` forces plain http.

The same variable works outside Docker, and it accepts a list: `PUBLIC_URL=http://192.168.1.5:8787,https://table.example.com`. Each address appears in the picker on the TV screen.

### The built image

GitHub Actions builds the container on every push to `main` and on every `v*`
tag, and publishes it to this repository's own registry. A machine that runs the
table then needs neither the source nor Node:

```sh
docker run -p 8787:8787 -e PUBLIC_URL=http://192.168.1.5:8787   ghcr.io/chrisjtwomey/up-and-down-the-river:latest
```

- `main` is published as `:main`, and a tag `v1.2.3` as `:1.2.3`, `:1.2`, `:1`
  and `:latest`.
- Built for `linux/amd64` and `linux/arm64`, so a Raspberry Pi or a small ARM
  server runs the same image.
- Every build runs the test suites first, then starts the image it just built
  and asks it for a table: `/net.json`, the join page, the rules, the felt. A
  container that cannot serve a game is not published.
- A pull request is built and smoke tested but never published. Nothing from a
  fork can write to the registry.
- The first published image is private. Make it public once, by hand, under
  **Packages** on the repository — GitHub does not do it for you.

To use Docker Hub instead, change `IMAGE` at the top of
`.github/workflows/docker.yml` and swap the login step's registry and secrets.

## Behind a reverse proxy

The game runs on one WebSocket at **`/ws`**. A proxy that does not pass the upgrade will serve the page and then fail with `can't establish a connection to the server at wss://.../ws`. Firefox fails silently here, because it never asks about a WebSocket.

Three rules:

1. Pass the `Upgrade` and `Connection` headers to `/ws`.
2. Keep the path as `/ws`. Do not strip or rewrite it.
3. Set `PUBLIC_URL` to the address people type, so the QR code matches: `PUBLIC_URL=https://table.example.com`. That also hides the server's own private addresses from the picker.

The server pings every 30 seconds, so an idle socket survives a normal proxy timeout.

### nginx

The `map` goes in the `http` context, outside any `server` block. Put it in its own file at `/etc/nginx/conf.d/websocket.conf`, or at the top of the site file above `server {`. Inside `server` or `location`, nginx refuses it with `"map" directive is not allowed here`.

Some distributions define `$connection_upgrade` already. Check with `grep -rn connection_upgrade /etc/nginx/` first, because defining it twice gives `duplicate map`. Test with `nginx -t` before you reload.

```nginx
# http context: conf.d/websocket.conf, or above the server block
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name table.example.com;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;                      # 1.0 cannot upgrade
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
```

### Caddy

```
table.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Caddy passes WebSockets on its own. Nothing else is needed.

### Traefik

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.table.rule=Host(`table.example.com`)
  - traefik.http.services.table.loadbalancer.server.port=8787
```

Traefik passes WebSockets on its own.

### Apache

```apache
RewriteEngine on
RewriteCond %{HTTP:Upgrade} websocket [NC]
RewriteCond %{HTTP:Connection} upgrade [NC]
RewriteRule ^/ws$ ws://127.0.0.1:8787/ws [P,L]
ProxyPass        / http://127.0.0.1:8787/
ProxyPassReverse / http://127.0.0.1:8787/
```

`mod_proxy_wstunnel` must be enabled.

### Cloudflare Tunnel

WebSockets work with no extra setting. If the tunnel points at an https origin with a self-signed certificate, add `noTLSVerify: true`, or point it at plain http and let the server run without a certificate.

When the socket cannot connect, the page now says so at the bottom of the screen, with the address it tried and what to check.

## Motion

The deal animation lives in `public/deal.js` and the finish in `public/finale.js`, on the shared overlay in `public/stage.js`. Both are used by the TV screen and the phones.

The screens also move in smaller ways. When a round is scored the standings slide to their new order, each score runs up or down to its new value, and what the round paid floats up out of it in green or red. When a bid lands that player's pill springs, and a ring spreads out of the seat that has to bid next.

Both follow the system "reduce motion" setting. On macOS that is System Settings → Accessibility → Display → Reduce motion. With reduce motion on, the cards fade in at their seats instead of flying, the places fade in together, no paper falls, and the standings simply appear in their new order with the new scores.

To override it, open the page with a flag. The choice is saved for that browser:

- `host.html?motion=full` — always play the full deal
- `host.html?motion=reduced` — always play the short fade
- `host.html?motion=off` — never animate

From the browser console on the TV screen: `playDeal()`, `playFinale()`, either with `'reduced'`.

## Working on it

```sh
npm run dev
```

Same server, plus live reload. The server watches `public/` and `game.js`, and every open page reloads itself when a file changes. Pages reload straight back into their seat, because the game state lives on the server and the seat token lives in the browser, so a reload during a game is safe.

Live reload is off unless `DEV=1`. Without it, `/live` answers 404 and each page stops asking after one try. `npm start` never watches the files.

A page inside a frame never opens the stream. A browser allows only six connections to one address, and the stream never closes, so a wall of dev previews would use them all up and every later request — the QR image, `/net.json` — would wait for ever. The dev page keeps the one stream and rebuilds its frames itself.

Changes to `server.js` still need a restart, and that ends the games in memory. Client files do not.

### The dev page

```sh
npm run dev
```

Then open **`/dev.html`**. It asks what you are here for before it draws anything else — three doors on one card:

- **A new table** — stand-ins in every seat, ready to play, in the number the box says. A dev server's alone; on any other the door says so rather than failing when pressed.
- **A table already in play** — on a dev server, every table this server is running, as a list to press. On any other, its code and its host key, which the TV screen showing it has under ⚙.
- **Replays** — the game a table is playing now, and every game on file: each one a row saying who won and with what, who was at it, and when it was played. This one needs no table and no key.

A code in the address is that question already answered: `dev.html#c=CODE&t=TOKEN` opens straight onto that table, which is what **Dev controls** under ⚙ on the TV screen writes. `dev.html#g=ID` opens straight onto a game watched again, and the page writes back whichever it lands on, so a reload comes to the same place. **⌂** in the band puts the question back at any time.

Whichever door it is, what follows is the same page: every screen at once, the TV screen across the top and under it one phone per seat, live, side by side. Press a button and every pane updates together.

The phone of whoever runs the table stands first in that row, ringed in gold. It moves with the job, not with the seating, so the pane that has the table's buttons on it is always in the same place.

It talks the same protocol as a phone, so the states it makes are states a real game can reach. The only extra is a dev-only message that forces values the protocol would refuse, such as jumping to round 12.

The controls are one band over the screens, three rows — the same rows in the same places whether the page is on a table or on a game watched again. What changes is the verbs:

- **Tables** — every table this server is running: its code, how many are at it, what it is doing, and whether it is a real game (*real*) or a set of stand-ins (*stand*). Press one and this page opens on it; the ✕ on a row **destroys** that table after a confirm — the same end the machine that runs the server has, so every screen at it is told it is gone and its file goes with it. Beside the strip, **New table** makes another the size of the one on show — the number itself is asked for once, on the way-in card. Watching a game again, this row is empty: a game is picked on the way in, and picking another is going back to it.
- **Go to** — the whole scorecard as cells sharing the row between them: the lobby, every round with its hand size written out, the finish. Below the width a hand size needs they stop shrinking and the strip scrolls instead — with no scrollbar, which was a bar of its own across the band: a strip with more in it than fits fades out on whichever side there is more on, and stops fading once you reach that end. Landing on a round near an edge brings the next couple of cells in with it, rather than leaving it hard against the edge where nothing says whether there is anything after it. Click a round and the game is taken there — the card is rebuilt and played up to it with rounds a real table could make. The **bid / tricks** toggle says where the round lands: waiting for its bids, or with its bids in. So the last round with its bids in — the doorstep of the end of the game — is two clicks, and the end itself one more.
- **One-shots** — fill bids, fill tricks, play the round through, a bum deal vote, **randomise** (shuffles the rules and plays a random number of rounds), and stand-in photos on and off.

- **❚❚ Pause / ▶ Play** and **Step** — on a table that plays a hand of its own. Pause is the same control the host screen has, said the same way. **Step**, which only the dev page has, then lets the table make exactly one move: one bid, or one card. It is how a hand is read at your own pace rather than at a bot's. Step is live only while the table is stopped, and it invents nothing — it is the move the bots were going to make anyway.

- **⏮ ◀ ▶ Play ▶ ⏭** — the same place in the band, for a game watched again: a round back or on at the outside, a point back or on inside those, and Play between them. Under it, the **Points** timeline of the round on show.

**Players ▾** and **State ▾** stand apart from those, at the end of the row: they open a panel rather than move the game on, and the two of them are what is left when the rest is not offered. On a game watched again they read the copy and only read it.

- **Players** — a panel under the band. What a live game reaches for is now on the scores page itself — the row of controls under the bids, the ⋯ on each standings row, and the [editable scorecard](#the-scorecard-is-editable) — all of which stay inside the rules. This is the forcing half, for the states the rules cannot reach. It opens with the round it is editing named — *Round 3 of 7 · 5 cards* — and the four phases beside it, the one the game is in marked. Press a phase and the game is forced to it, which is the one thing the round's own numbers cannot unstick: every bid in and the phase never turned. Then one row a seat: name, who hosts, who deals, bot, this round's bid and tricks, a photo on or off, and **Hand over**. Everything lands as it is changed; the tricks go as one column, once every seat has a number, and the cells still wanted are ringed until they do.
- **Hand over** takes a player out of a game in play. Mid-game the seat cannot simply go — the rounds already played are that player's, and the scorecard is a column for it — so the seat stays, is marked gone, and the table plays its hand from there on. It is a pair: **Take back** gives the seat to whoever holds its phone again. Removing a seat outright is the lobby's business, and the table host's.
- **State** — the whole table as JSON, the same record it is saved to disk as: rounds, seats, rules, hands, everything. Edit it and press Apply, and the table becomes what the text says; Reload throws the edits away and reads the table afresh. A record the table will not have says why beside the Apply button, and the edit stays in the box to be put right — it is the thing being worked on. **Copy** takes the record to the clipboard, which is how a broken table is kept before it is mended. The table's code, its keys and the pictures stay as they are, whatever the text says. This is the raw way to any state the other controls cannot reach, and it works on any server: it is how a real game nothing else reaches is put right.

**Rules** is still to come back — the rules form, editable after the start. The server answers its action already; only the control is missing.

The filled bids keep the screw-the-dealer rule, the filled tricks always total the hand size, and every played round gets a trump, so nothing on screen is impossible.

#### Fixing a real game

The TV screen offers **Dev controls** under ⚙, on any server. It opens the dev page on **that table**, at `dev.html#c=CODE&t=TOKEN`, so a game in play can be put right: a mistyped trick three rounds back, the wrong dealer, a phase that got stuck. It goes by the host token, so it is offered only where that screen holds one — a screen only watching has nothing to open the page with. The **Tables** list is the other way to the same place: on a dev server the code alone is enough, so no token is typed or pasted.

Both doors are one message. A table's host token opens it on any server — it is authority the TV screen already holds — and with `DEV=1` the code alone will do, because that server hands its tables to the page anyway. The page writes the table it is on into its own address, so a reload comes back to it, and a socket that drops and returns re-opens it rather than making another. If the table has gone — the server restarted, the game ended — the page lets it go and makes a table of stand-ins, which is what a page with no table does.

What the page may do follows the **server**, not the table. On a server started with `DEV=1` a real table takes every control a table of stand-ins does — jump to, fill scorecard, randomise, all of it. The top bar turns red and the page says real players may be at the table, because every click lands on their game; nothing is taken away. On a normal server the host token opens the two controls that put a game right and invent nothing: the forced values of the **Players** panel, and the **State** record itself. Everything that makes data up is refused — and, being refused, is not shown. The page is told which kind of server it reached in the same breath as the table, so the tables strip, **New table**, the scrubber and the one-shots are put away before anything is drawn. A control that draws itself and then answers a refusal teaches the limits one click at a time; this way the page offers what works and nothing else.

What is left on a live table is the forcing half — for the states the rules themselves cannot reach. (Everything that stays inside the rules is on the scores page, which needs no dev page and no token in a link.) It is all in one place: the **Players** panel. The round it is editing, the phase to force, and a row a seat — the bid, the tricks, whether the seat is a bot, who runs the table, and taking a player out of it. Nothing there invents anything; every one of them is a forced value, which is what the host token has always been allowed. Anything those cannot reach is the **State** record's job.

The phones are there, one pane a player, so you can see what each of them sees. On a real table they open as **watching windows**: the same page, off the same state, with a 👁 badge and nothing on the game that can be pressed — the settings page is still the reader's own. A watching window cannot send anything to the game, and it does not put that player back at the table, so a sleeping phone still reads as offline. It opens with `play.html#c=CODE&w=WATCHTOKEN`, and that link never saves itself in the browser, so watching cannot evict your own seat.

On a dev server each of those panes carries an **act as** button. It asks the server for the seat itself and puts it in the pane, which then bids and plays as that player — the phone that holds the seat is not thrown off, so mind that two screens are then the one player. **Stop acting** puts the pane back to only watching.

The server decides this, not the page:

- Anything that invents data — a table of stand-ins, filled bids, a played-out card — needs `DEV=1`. On a dev server every table takes it; on any other, no table does. **Step** goes with them: it invents nothing, but walking a table on by hand is a developer's tool, and the host screen's **Pause** is the control a real table gets.
- The list of tables needs `DEV=1`. A table's four characters are its only door, and a listing handed to a page that has not proved anything would open every table at once.
- Opening the page on a table needs that table's host token, or `DEV=1`. Nothing else: the page cannot ask for a seat.
- Forcing a state needs only the host or the table host of that table, which is authority they already have. So does reading and rewriting the record whole: it is the same authority, made complete.
- A real table never hands its seat tokens out. It hands out a watch token a seat instead, which opens that screen and can do nothing else. The record read off a real table carries neither — nor the cards in anybody's hand, which the screen is never shown either.
- The keys are the table's own, never the text's. A pasted record cannot change the host token, cannot hand anybody a seat, and cannot leave a table nobody can open: whatever the text says, each seat keeps the key its phone holds.
- A watching socket is refused every message but `ping`, and is left out of who counts as online.
- Forced bids and tricks are checked for shape: one whole number a seat, no bigger than the hand. Junk is dropped rather than stored.

On a table of stand-ins the previews open with a `#c=CODE&t=TOKEN` link, which puts that seat in that frame. Inside a frame the seat is kept in memory only, so the panes do not overwrite each other, and none of them touches your own saved seat. The same link opened in a tab does claim the seat, which is also how you move a seat to another phone.

Making a table of stand-ins needs `DEV=1`. On a normal server the way-in card shows that door shut and says why — but the other two are open: **Dev controls** under ⚙ on the TV screen is the way in to a real table, offered wherever that screen holds the host token, and a game on file is watched back with nothing at all. That is the point: a game broken by a bug is broken on the server it is running on, not on the one with `DEV=1` set.

#### The trail a table leaves

Every table writes down what happened to it, as it happens: the game starting, each round opening, each bid, each card, each trick taken, each round scored, the finish. A scorecard keeps only what those added up to; the trail keeps the sequence, so a game can be walked back through afterwards instead of watched in the hope of catching the moment.

A point is the thing that happened and not a picture of the table — twenty-odd bytes against three kilobytes. A picture is taken only where the game could not be worked out again without one: the game starting, because it is the one point with nothing behind it to work out from; a round opening, because the deal is shuffled and will never come round the same way twice; and the finish, because the accolades are drawn rather than reckoned. Those pictures carry no table talk, no keys and no hands out of anybody's seat.

It goes in a file of its own, `data/trail/CODE.jsonl`, one line a point, appended. That is not tidiness: a table's own record is rewritten whole after every broadcast, so a trail kept there would be written again for every card — some hundreds of megabytes over one game, on a machine that may well be a phone. Appending a line costs the line.

#### Watching a game again

The trail says what happened; a **replay** puts it back. Never onto the table it happened at — a real game has people at it, and taking their screens over to look at the past would be its own kind of bug. A copy of the table is made instead, seeded from the trail, and the dev page points its screens at that. The game carries on beside it, untouched.

What a point is put back through is the game's own verbs: a bid through the same door a phone's bid goes through, a card through the deck, a round scored the way a round scores. So a replayed table is one the rules could have reached, and a replay that could not happen is one that stops rather than one that lies. The only points set outright are the ones carrying a picture, and they carry one exactly because the game could not be worked out again without it — the deal, and the accolades at the finish.

Moving about in it is that same thing from the nearest picture: back to the round, then forward one point at a time. That is the only honest way, because the pictures are the only states the trail actually holds. It is also why the game starting carries one: without it a copy had nothing to stand on at the first point there is, and opened on the second. A trail written before that — a game already on file — still opens on its second point, because the state at its first was never written down and a replay stops rather than invents.

It is drawn by `public/viewer.js`, which is the whole of it: what there is to watch, the rounds, the transport and the points, in four widgets that know nothing about the page they are on. The dev page says where each goes and how a word gets back to the copy; anything else that wants a replay does the same.

On the dev page it is one of the three doors — **Replays**, on the card the page opens with, listing the game a table is playing now and every game on file. A game's trail is kept beside its scorecard, so a game whose table went hours ago is watched exactly like one still in play.

Pick one and the copy is made, and the page becomes the same page with the verbs of a replay. The band keeps its rows and its places: the rounds of that game stand in the scorecard's own strip, and the transport — **◀ ▶ Play ▶** — stands where Pause and Step stand. The one-shots go, because a replay invents nothing; the **Players** and **State** panels stay and only read, because what happened is what the trail says.

Two levels of moving about in it, because a game is two levels: a mark a round in the strip — a hand thrown in gets its own, because it was a second go and looked different — and under it the **Points** timeline, the round on show as a rail with the points marked along it in the order they happened. The first round takes the game starting with it, since that point is the run-up to round one rather than a timeline of its own with one mark on it. Press anywhere on it and the head goes there; drag the head and it follows. Only letting go asks the copy to move, because a seek re-seeds it from the nearest picture and plays it forward — doing that for every pixel of a drag would make the drag the slowest part of it. A hand on the rail also stops a replay playing itself, because two clocks on one copy would fight over where it is.

What a mark wears is what it is. A bid wears the number that was said, a card wears itself in the colour of its suit, a trick opening is a divider through the rail, and the beats that shape a round wear an icon: 🎬 the game starts, 🃏 the round is dealt, ♻️ thrown in and dealt again, ✔ a trick taken, ↩ one taken back, 📝 the round is scored, ⟲ the round put back, ⚠️ the table forced, 🏁 the game ends. A round is mostly cards, and forty of them named at once is not a thing to read; the head wears whatever point it is standing on.

**⏮** and **⏭** move a round at a time. Back part way through a round goes to the top of it first, the way a track does: the same press means *this one again* and *the one before*, and which you meant is where you are. On from the last round is the end of the game, which is the only thing after it. Both say so when there is nowhere to go.

Pass over a mark and it says what happened there — *Nia plays 9♠ — point 42 of 214* — over the mark itself. That sentence is made once, on the server, when the copy is made, and the line beside the rail says the same one for the point the copy is standing on, so the two never drift apart and never fight over one place. **⌂ Stop watching** lets the copy go. While one is open the panes are the copy's, and none of them can be acted in: the game they show has already been played.

**Play** runs it back at the pace the table played it, and **Pause** stops it where it stands. **½× 1× 2× 4×** beside them is how fast: the speed divides every beat, the game's own ones included, so half speed is the whole game slowed down rather than the gaps between the cards stretched. The panes draw at it too — the copy tells every screen on it how fast it is going, and each multiplies that by its own [Game speed](#game-speed) setting. A hand played out at half speed with the cards still flying about at full pelt reads as a fault rather than as slow motion. It is the copy's own, and the browser remembers the last one picked — whoever slows a game down to read it wants the next one slow too. A speed changed while it is playing lands on the next point rather than the one already being waited out: clearing that timer to shorten it would step a point. A copy playing itself says where it has got to as it goes, so the step it is on, the line under it and the button all keep up — and when it runs out of trail it says that too. Only the place is sent: the rounds and the points are the trail, and the trail is being read, not written. The beats are the game's own, not a metronome: a finished trick sits for as long as a real one sits, the bids stand to be read before the hand opens, and a scored round is left up long enough to read. Only the beat between two ordinary points is the replay's own, `REPLAY_STEP`. Moving about in it by hand stops it playing itself, because two clocks on one copy would fight over where it is.

A copy is a room like any other, which is what makes the screens on it work: they reach it the way a screen reaches a table. But it is not a table, and everything that offers one asks first. It is left out of the tables this server is running, refused to anybody trying to join it or come back to a seat at it, refused to the dev page as a table to open, and never written down or read back after a restart. No browser remembers it either: the screens on a copy are told what they are on, so the front page never offers a copy under *You are in a game*. None of the table's own clocks run over one — nobody is at a copy by design, and its life belongs to the page watching it. Its seats get a watching key and never a seat's own, and never the keys of the table it is a copy of, which the trail does not carry in the first place. It goes when the page that asked for it does — that page, and not its panes: the panes are windows the dev page draws, and it throws them away and draws them again whenever it redraws.

A **game on file** needs nothing at all to watch back: no table, no host token, on any server. It is finished, and its scorecard is already served to anybody who asks at `/games.json` and on the history page; putting it back adds only the order it happened in. A **table still in play** is the one thing that stays behind the host token, because its trail holds the cards in every hand — a phone at that table is told *only the host can watch this table back*. Either way it invents nothing: it puts back what already happened, on a copy.

One game at a time: a new game starts the file over, because a table lives six hours and plays several. A game that finishes keeps its trail, copied beside its scorecard and under the same name, so it falls off by the same cap the scorecards do. A live table's trail goes when its table goes, by the same six-hour rule. Neither can outlive the thing it is a trail of. `TRAIL_MAX` (4 MB) is the point at which a table stops writing rather than filling the disk — a whole game is about ninety kilobytes, so reaching it means something is wrong.

## Test

```sh
npm test
```

Three suites, and `npm test` runs all three. Together they take about twenty
seconds, and nearly all of that is the games played over real sockets.

`test-rules.js` needs no server and no browser. It builds a table in its own
process and calls the game on it: whose turn it is, what a round pays, one bid
at a time, the rules of a trick with the cards stacked on purpose, a hand thrown
in, a step back, and who may send what and when. A rule of the game is checked
here. Run it alone with `npm run test:rules`.

`test.js` starts the server on port 8899 and plays whole games over WebSockets.
It proves what only a socket can: a refusal comes back to the phone that earned
it, a bid made on one phone is on every screen a moment later, a phone that
drops out is waited for and let back in, a table outlives the server it was on,
and the pauses that are meant to be felt — the trick held up, the bots thinking,
the moment between two lines of talk — are real pauses on a real clock. It also
checks the static routes and compares the QR image with the encoder, module by
module. It uses ports 8899 to 8906, so stop anything of your own on those first.

`test-pages.js` needs no server and no browser. It draws into a document just
big enough to hold a page and drives real events at it: where every card on the
felt lies at five screen sizes and every legal hand size, the thumb along the
fan, the push that plays a card and the one that does not, the card that
refuses, the trick taken and gathered, the bid numbers, the round held up, and
the settings page opening and closing. Where a screen arms a timer, the test catches it
and lets it off by hand rather than waiting. Run it alone with
`npm run test:pages`.

## Files

- `server.js` — the sockets, the presence, and the wiring. Rooms live in memory.
- `lib/room.js` — the table as the game sees it: every verb that moves a game on, written once. The protocol and the dev controls call these and add nothing.
- `lib/messages.js` — every message a seated socket may send, as a table: who may send it, when, and what it does.
- `lib/http.js` — everything a browser asks for over plain HTTP: the pages, the QR code, the addresses, a finished game, a picture.
- `lib/deck.js` — the dealer for a virtual table: the hands, and the rules of a trick. It moves cards; the server holds a finished trick up.
- `lib/bots.js` — the players the table provides: what a hand is worth, which card to play, and the driver that takes their turn.
- `lib/games.js` — a finished game on disk.
- `lib/trail.js` — what happened to a table, written down as it happens.
- `lib/tables.js` — a table still in play, on disk, so that stopping the server does not end it.
- `lib/dev.js` — the dev portal, which a real game never touches.
- `public/ui.js` — shared page bits: the full-screen button, the wake lock, the motion setting every scene and flourish asks.
- `public/stage.js` — the overlay both scenes are played on, its parts, the slot that says which one is open, and the peek: the one way a screen shows the seat it is waiting on.
- `public/deal.js` — the deal animation. `public/finale.js` — the game-over finish. Both used by every screen.
- `public/felt.js` — the table a phone plays a virtual round on: the fan, the pile, the gestures, the bid numbers. The deal hands it the stage and it keeps it for the round.
- `public/table.js` — the scorecard (editable, for whoever runs the table), the standings and the seat controls on them, the winner and the vote line, drawn the same on a TV screen and a phone; the ⋯ menu both lists of people use; and what the deal and the finish read off the state.
- `public/lobby.js` — the lobby: the seats, the bots, the rules form and the start button, drawn the same on the TV screen, the table host's phone and the dev page.
- `public/round.js` — the round in play: the round line, the bids as they land, the count of tricks taken, the pads for a seat with nobody behind it, and the winner. Each widget takes the element it draws into and a view of who is looking.
- `public/chat.js` — the table talk sheet, the unread count, and the toast a line raises when the sheet is shut.
- `public/ui.js` also lists the settings every page has, as rows. `public/settings.js` draws them: the page behind the ⚙, laid over the page that opened it.
- `public/accolades.js` — what each player is remembered for, worked out from the scorecard.
- `game.js` — the rules: schedule, bid order, forbidden bid, scoring, whose turn it is, which seats the table plays itself. Used by the server and by every client.
- `test-rules.js` — the rules, checked where they live: no server, no browser, no clock.
- `test.js` — end-to-end test, over real sockets. `test-pages.js` — the pages, checked without a browser.
- `make-cert.js` — makes a self-signed certificate so the server can serve https.
- `public/ui.js` also holds the live reload client, which listens to `/live` when the server runs with `DEV=1`.
- `public/viewer.js` — the replay viewer: a game watched again, drawn off the one message the server sends about a copy of it. Four widgets — the games to pick from, the rounds of the one being watched, the transport, and the points of the round on show — each built inside a root the page hands it, and each asking the copy for things through one `send`. It knows nothing about the page it is on.
- `public/dev.html`, `dev.js` — the dev page: stand-in players, forced states, live previews of every screen, and the replay viewer put where it goes.
- `Dockerfile`, `compose.yaml` — container build and run.
- `android/` — the Android app: a WebView on the table, and `server.js` running
  inside it on Node.js for Mobile. `android/tools/prepare.sh` assembles it.
- `.github/workflows/android.yml` — builds the APK on a tag or a release.
- `.github/workflows/docker.yml` — builds the container, smoke tests it, and publishes it to the repository's registry.
- `android/tools/build-local.sh` — the same build on this machine, no runner.
- `public/index.html`, `join.js` — landing page: join a table or start one.
- `public/host.html`, `host.js` — TV screen: code, lobby, rules, live bids, standings, scorecard.
- `public/play.html`, `play.js` — player phone: your bid pad, the count of tricks as they are taken, standings, and the scorecard.
- `public/net.js` — WebSocket client with reconnect, a saved session, and a message when it cannot connect.
- `public/styles.css` — shared styles, light and dark.

## Notes

- Rooms are in memory only. Restarting the server ends the games in progress.
- There is no account system. Anyone with the code and network access can take a seat, so use it on a network you trust.
