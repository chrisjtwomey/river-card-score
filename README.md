# Up the River, Down the River — score tracker

A local, offline score tracker for the betting card game. No build step. No network calls.

## How to use it

Open `index.html` in a browser. On macOS:

```sh
open index.html
```

## What it does

- Set 2 to 8 players in seating order.
- Set the biggest hand and the round pattern: down then up, up then down, down only, or up only.
- The 1-card hand repeats once per player, so every player deals it one time. Example: 4 players, down then up, biggest hand 7 gives `7 6 5 4 3 2 1 1 1 1 2 3 4 5 6 7`. Change the count in "Rounds of 1 card".
  In the "up then down" pattern the game starts and ends at 1 card, so it has a run of 1-card rounds at each end.
- Set the score rule: an exact bid pays 10, 5, 1, or 0 plus the tricks won.
- Choose what a missed bid pays:
  - **must make the bid** (default) — win more than your bid and you score the tricks won. Win fewer and you score 0. Example with a 10 bonus: bid 2, win 3 = 3; bid 2, win 2 = 12; bid 2, win 1 = 0.
  - **must make the bid, with a penalty** — the same, but short by *n* tricks costs *n* points.
  - **0 points** — any miss scores nothing.
  - **minus 1 per trick off** — over or short, each trick costs 1 point.
  - **tricks won only** — any miss still pays the tricks won.
- Option "Screw the dealer": the bids must not total the number of tricks. The tracker disables the forbidden chip for the dealer.
- Option "Trump": record the trump suit for each round.
- Each round has two steps: enter the bids, then enter the tricks won. The tricks must total the hand size.
- The dealer rotates each round. The player to the left of the dealer bids first.
- The scorecard shows `bid→won (points)` and the running total for each round.
- Tap a finished round in the scorecard to correct it. All totals recalculate.
- Pressing "Start game" plays a deal animation: the deck pops up, one card flies to each player in dealing order, then a card turns over with the round caption. Tap, click, or press a key to skip it.

### Motion

The animation follows the system "reduce motion" setting. On macOS that is System Settings → Accessibility → Display → Reduce motion. With reduce motion on, the cards fade in at their seats instead of flying.

To override the system setting, open the page with a flag. The choice is saved for that browser:

- `index.html?motion=full` — always play the full deal
- `index.html?motion=reduced` — always play the short fade
- `index.html?motion=off` — never animate

To test from the browser console: `playDeal()` for the full deal, `playDeal('reduced')` for the short one, and `motionMode()` to print the current mode. The console also prints the reason when the animation is cut short.
- The game shows the winner after the last round. Use "Rematch" to play again with the same players and rules.

## Storage

The game state stays in the browser `localStorage` of that device. It reloads when you open the page again. "New game" deletes the current scorecard. Nothing leaves the device.

## Files

- `index.html` — markup
- `styles.css` — styles, light and dark
- `app.js` — game state, scoring, and rendering
