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
- Set the score rule: an exact bid pays 10, 5, 1, or 0 plus the tricks won. A missed bid pays 0, minus 1 per trick off, or the tricks won.
- Option "Screw the dealer": the bids must not total the number of tricks. The tracker disables the forbidden chip for the dealer.
- Option "Trump": record the trump suit for each round.
- Each round has two steps: enter the bids, then enter the tricks won. The tricks must total the hand size.
- The dealer rotates each round. The player to the left of the dealer bids first.
- The scorecard shows `bid→won (points)` and the running total for each round.
- Tap a finished round in the scorecard to correct it. All totals recalculate.
- The game shows the winner after the last round. Use "Rematch" to play again with the same players and rules.

## Storage

The game state stays in the browser `localStorage` of that device. It reloads when you open the page again. "New game" deletes the current scorecard. Nothing leaves the device.

## Files

- `index.html` — markup
- `styles.css` — styles, light and dark
- `app.js` — game state, scoring, and rendering
