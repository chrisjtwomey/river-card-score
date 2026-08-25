# Up the River, Down the River — score tracker

A score tracker for the betting card game. It runs in two ways:

- **Table server** — one host screen plus a phone for each player. Players bid in turn on their own phone.
- **Single device** — the original offline tracker in one HTML file, no server.

## Run the table server

```sh
npm install
npm start
```

The console prints the addresses. On the host machine:

- host screen: `http://localhost:8787/host.html`
- players join: `http://localhost:8787/`

The players' phones must be on the same network as the server. Scan the QR code on the host screen, or type the `http://<your-ip>:8787/` address that the console prints. Set `PORT` to use a different port.

The join panel also has **Scan the code**, which opens the camera and reads the
table's QR code without leaving the page. The decoding is the browser's own, so
nothing is downloaded and no picture leaves the phone. A camera needs a secure
page, so the button is there over `https` (`npm run cert`) and in the Android
app, and it hides itself where the browser offers no camera -- plain `http` to
another machine, or Safari, which cannot read a code.

Every page has a full-screen button (⛶) next to the theme toggle. The button hides itself on browsers with no full-screen support, such as Safari on iPhone.

The server builds the QR code itself, so nothing is sent to an outside service. It is always black on white, whatever the page theme is, because a camera cannot read an inverted code.

### How a game runs

**One phone is enough.** On the landing page, type your name and press **Start a table and play**. That makes a table, takes the first seat, and hands you the controls. Your phone then shows the code and a QR code for the others to scan. A host screen on a TV is optional.

**The table host is a player.** The first player to take a seat runs the table from their own phone: rules, seat order, who deals first, start, go back, and new game. They can hand that over with the ★ button beside any player. So a game needs no host screen at all — but a host screen is still nice on a TV, and it has the same powers.

1. Someone starts the table, from a phone with **Start a table and play**, or from a host screen on a TV. Either way the server makes a 4-character table code and a QR code with the join address, shown on the table host's phone and on the host screen. A player points a phone camera at it and lands on the join page with the code already filled in. If the machine has more than one network address, a picker on the host screen chooses which one goes in the QR code.
2. Each player opens the site on their phone, types the code, and takes a seat. The seat order is the order of play. The host can move a player up or down, or remove one, until the game starts.
3. The table host taps 🂠 beside a player to say who deals the first round. Without a choice, seat 1 deals. The deal then moves on one seat each round. ★ passes the table host badge to another player.
4. The table host sets the rules and presses **Start game**. Nobody can join after that.
5. **Bidding.** The server only accepts a bid from the player whose turn it is. The order starts left of the dealer and the dealer bids last. Every other phone shows whose turn it is and the bids so far.
6. With "screw the dealer" on, the server refuses the dealer's bid if it would make the bids total the number of tricks. The forbidden chip is disabled on the dealer's phone.
7. A player can change their bid until the player after them bids. Their phone keeps the pad open and says so, and the host screen marks the bid that can still change. Once the next player bids, the change is refused.
8. **Tricks.** The dealer of that round enters the tricks each player won. The server refuses a set that does not total the hand size. The host screen can enter them too, if the dealer's phone is not handy.
9. The round scores, the next round opens, and the deal moves on one seat.
10. The table host, or the host screen, can press **Go back** to reopen the last step, and **New game** to return the same players to the lobby.

### Accolades

When the last round is scored, some of the accolades the table earned are drawn at random. **Three** by default, and the rules take anything from none to five. Each one pays its holder **10 points** by default, or 20, 5, or nothing.

The finish plays in three moves:

1. **The places, as they stood before the accolades.** Every score is the one the scorecard shows. The screen holds there for five seconds, so the table can read them.
2. **Each accolade in turn, eight seconds each.** The name comes up with what it was for, the **+10** lands, and that player's score runs up in the list behind. The places shuffle as the points go in.
3. **The winner** — whoever is top once every accolade is paid, which is not always whoever led before them.

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

1. It shuffles a 52-card deck and deals the hand to each phone. A hand is a secret: the server sends each socket the table and **its own cards only**, and the host screen is dealt none.
2. It turns the next card for trump, before the bidding, so everybody bids knowing it. With nothing left in the deck — four players at thirteen cards — the hand is played at no trumps.
3. Bidding runs as it always does, in order, with screw the dealer if it is on.
4. The player left of the dealer leads. Tap a card to play it. Cards you may not play lie flat and cannot be tapped: you must follow the suit led if you hold it.
5. The highest trump takes the trick, or the highest card of the suit led. The trick stays on the table for a second and a half so everybody sees it, then the winner leads.
6. When the last trick is played the round scores itself. Nobody types anything in.

The rules are held on the server, so a phone cannot renege, play out of turn, or play a card it does not hold. What changes on a virtual table:

- The dealer's trick pad is gone, and typing the tricks in is refused.
- Nobody picks the trump. The deck turns it.
- **Go back** deals that hand again, because those cards are gone.
- A phone that goes quiet would stop the table, so whoever runs the table gets **Play a card for them**. The server picks, and only from the cards the rules allow, so nobody chooses another player's card.

### Bum deal

If the cards were dealt wrong, throw the hand in and deal it again. The round keeps the same dealer and hand size, and the bids, tricks, and trump are cleared. The round label then shows `re-deal 1`.

- The **dealer** or the **table host** re-deals on their own. They are asked to confirm first, so one stray tap cannot throw a hand in.
- Any other player calls a bum deal and the table votes. Every player must agree. One "no" ends it, and the player who called it can take it back. The table host, or the host screen, can also force the re-deal.

If the table host leaves the table, the badge moves to the first seat.

### Host screen

- **A−** and **A+** in the top bar change the page size, from 80% to 200%, so the table can read it from across the room. The size is remembered in that browser.
- The 🂠 button replays the deal animation for the round on screen at any time. Once the game is over it becomes 🏆 and replays the result.
- The 🛠 button opens the dev page on this table, to put a game in play right. See [Fixing a real game](#fixing-a-real-game).
- The host screen and the player phones ask the browser to keep the display awake while a game is on, and release it in the lobby and after the last round. A pill in the top bar says what happened: `☀ screen on` means the browser is holding it, `☀ screen on*` means a best-effort silent video is holding it, and `☾ may sleep` means neither worked.

### Keeping phone screens on

The Screen Wake Lock API only exists on a **secure page**. `http://localhost` counts as secure, but `http://192.168.1.5:8787` on a phone does not, so phones fall back to the silent video, which an iPhone ignores.

To fix it, serve https:

```sh
npm run cert     # makes certs/key.pem and certs/cert.pem for this machine
npm start        # the console now says (https)
```

`npm run cert` needs `openssl`, and it puts every address of this machine in the certificate. Nobody signed it, so each phone shows a warning the first time. Accept it once and the screen lock works. Set `TLS_KEY` and `TLS_CERT` to use your own certificate, or `NO_TLS=1` to force plain http.

Both screens play the deal animation at the start of every round: a card flies to each seat in dealing order, with the player names.

- On the **host screen** the scene holds while the bids come in. Each player's name gains their bid as it arrives, the player to act glows, and a line reads "Waiting for Amy to bid". It closes itself when the last bid lands. One tap lands the deal early, a second tap dismisses it, and 🂠 brings it back with the bids so far.
- On a **phone** it plays and then clears, so the bid pad is never blocked. A tap skips it. It does not replay when a phone reloads part way through a game.

When somebody bids, every other screen says so: a line slides in under the top bar — **"Hugh bid 2 · Joe to bid"** — waits a couple of seconds, and goes. Your own bid is not announced, because your own pad already shows it. On the host screen, while the deal is held open, the bid is stamped onto that player's card instead: the number slams down in gold, the card takes the hit, and the name below it keeps the bid from then on.

When the last round is scored, both screens play the finish: the places come up from last to first with the scores before the accolades, each accolade is then read out and paid into the list, and last the winner's card turns over and paper falls. Every player's score is on screen, best first, with a shared place for a draw. It clears itself after a few seconds. A tap lands it, and a second tap clears it. A screen that opens on a game already over does not replay it.

The `?motion=` flag below works on `host.html` and `play.html` as well.

Phones reconnect on their own. A player who closes the page and comes back is offered their seat again, because the seat token is kept in that browser.

### Rules the host can set

- Biggest hand, and the round pattern: down then up, up then down, down only, or up only.
- The 1-card hand repeats once per player, so every player deals it one time. Example: 4 players, down then up, biggest hand 7 gives `7 6 5 4 3 2 1 1 1 1 2 3 4 5 6 7`.
- An exact bid pays 10, 5, 1, or 0 plus the tricks won.
- What a missed bid pays:
  - **must make the bid** (default) — win more than your bid and you score the tricks won. Win fewer and you score 0. With a 10 bonus: bid 2, win 3 = 3; bid 2, win 2 = 12; bid 2, win 1 = 0.
  - **must make the bid, with a penalty** — the same, but short by *n* tricks costs *n* points.
  - **0 points**, **minus 1 per trick off**, or **tricks won only**.
- Screw the dealer, and whether to record the trump suit.
- Real cards on the table, or a virtual deck dealt on the phones. See [Playing with a virtual deck](#playing-with-a-virtual-deck).
- How many accolades are drawn at the end, from none to five, and what each one pays: 20, 10, 5, or nothing. See [Accolades](#accolades).

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
   play** — the table host is a player, so no host screen is needed.
5. Everyone else joins the hotspot and scans the QR code as normal.

Worth knowing:

- If the laptop holds more than one address, the picker on the host screen
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
[latest release](https://github.com/chrisjtwomey/river-card-score/releases).
That one is signed with the project's own key, so the next release installs
over it. The `-debug.apk` beside it is for working on the app.
Android asks whether to allow the install, because it did not come from a store.
Say yes, open the app, and allow the local network when it asks.

**In the app.** *Host a table and play* starts the server and opens the landing
page, where **Start a table and play** takes seat 1 as usual. The others scan
the QR code with a camera, or type the address. *Join a table* is the same thing
in the app instead of a browser, for anyone who prefers it.

While a table is open the app shows a notification, so Android leaves the server
running with the screen off. **Stop** on that notification closes the table.

**Android asks for the local network permission on first run. Say yes.** Without
it Android 16 and later cut the app off from the Wi-Fi, and no other phone can
reach the table.

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

`PUBLIC_URL` **replaces** the detected addresses, it does not add to them. Behind a proxy or in a container the detected ones are private and useless to a phone, so the host screen offers only what you name here.

The compose file mounts `./certs` read only. Run `npm run cert` on the host first for https, or delete that line. `NO_TLS=1` forces plain http.

The same variable works outside Docker, and it accepts a list: `PUBLIC_URL=http://192.168.1.5:8787,https://table.example.com`. Each address appears in the picker on the host screen.

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

## Single-device tracker

Open `public/local.html` in a browser. It needs no server and keeps its state in that browser. It has the same rules and scorecard, plus a deal animation when the game starts and the finish when the last round is scored.

### Motion

The deal animation lives in `public/deal.js` and the finish in `public/finale.js`, on the shared overlay in `public/stage.js`. All three are used by the host screen, the phones and the offline tracker.

The screens also move in smaller ways. When a round is scored the standings slide to their new order, each score runs up or down to its new value, and what the round paid floats up out of it in green or red. When a bid lands that player's pill springs, and a ring spreads out of the seat that has to bid next.

Both follow the system "reduce motion" setting. On macOS that is System Settings → Accessibility → Display → Reduce motion. With reduce motion on, the cards fade in at their seats instead of flying, the places fade in together, no paper falls, and the standings simply appear in their new order with the new scores.

To override it, open the page with a flag. The choice is saved for that browser:

- `local.html?motion=full` — always play the full deal
- `local.html?motion=reduced` — always play the short fade
- `local.html?motion=off` — never animate

From the browser console: `playDeal()`, `playFinale()`, either with `'reduced'`, and `motionMode()`.

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

Then open **`/dev.html`**. It makes a real table of stand-in players and shows every screen at once: the host screen and one phone per seat, live, side by side. Press a button and every pane updates together.

It talks the same protocol as a phone, so the states it makes are states a real game can reach. The only extra is a dev-only message that forces values the protocol would refuse, such as jumping to round 12.

- **Jump to** — start game, fill bids, fill tricks, next round, end game, bum deal vote, back to lobby, and **randomise**, which shuffles the rules and plays a random number of rounds.
- **Fill scorecard** — plays whole rounds against the rules in force, and leaves the next round waiting for its bids. Type how many rounds to play, or leave the box empty for a random number. Use it to see a card part way through, or a full one.
- **Force** — round number, phase, table host, who deals first, trump, re-deal count.
- **Round** — pick any round and type each seat's bid and tricks. Scores come from the bids and the tricks, so editing a played round changes the totals.
- **Rules** — the full set, editable even after the start, which the real game does not allow.
- **State** — the live JSON the server is sending.

The filled bids keep the screw-the-dealer rule, the filled tricks always total the hand size, and every played round gets a trump, so nothing on screen is impossible.

#### Fixing a real game

The host screen always carries a 🛠 button in its top bar, on any server. It opens the dev page on **that table**, at `dev.html#c=CODE&t=TOKEN`, so a game in play can be put right: a mistyped trick three rounds back, the wrong dealer, a phase that got stuck.

A real table gets the state editor and nothing else. **Force**, **Round** and **State** work. Everything that invents data — new table, jump to, fill scorecard, randomise — is hidden, and the server refuses it even with `DEV=1`. The top bar turns red, and the page says the game is real.

The phones are there, one pane a player, so you can see what each of them sees. On a real table they are **watching windows**: the same page, off the same state, with a 👁 badge and nothing that can be pressed. A watching window cannot send anything to the game, and it does not put that player back at the table, so a sleeping phone still reads as offline. It opens with `play.html#c=CODE&w=WATCHTOKEN`, and that link never saves itself in the browser, so watching cannot evict your own seat.

The server decides this, not the page:

- Anything that makes or fills a table of stand-ins needs `DEV=1` **and** a table the dev page itself made.
- Forcing a state needs only the host or the table host of that table, which is authority they already have.
- A real table never hands its seat tokens out. It hands out a watch token a seat instead, which opens that screen and can do nothing else.
- A watching socket is refused every message but `ping`, and is left out of who counts as online.
- Forced bids and tricks are checked for shape: one whole number a seat, no bigger than the hand. Junk is dropped rather than stored.

On a table of stand-ins the previews open with a `#c=CODE&t=TOKEN` link, which puts that seat in that frame. Inside a frame the seat is kept in memory only, so the panes do not overwrite each other, and none of them touches your own saved seat. The same link opened in a tab does claim the seat, which is also how you move a seat to another phone.

Making a table of stand-ins needs `DEV=1`. On a normal server the page loads, says so, and points at the 🛠 button on the host screen, which is the way in to a real table.

## Test

```sh
npm test
```

It starts the server on port 8899 and plays a whole game over WebSockets: joining, the bid order, the screw-the-dealer block, dealer-only trick entry, scoring, undo, reconnect, and late joins. It also checks the static routes and compares the QR image with the encoder, module by module.

## Files

- `server.js` — the rooms, the sockets, and the wiring. Rooms live in memory.
- `lib/messages.js` — every message a seated socket may send, as a table: who may send it, when, and what it does.
- `lib/http.js` — everything a browser asks for over plain HTTP: the pages, the QR code, the addresses, a finished game, a picture.
- `lib/deck.js` — the dealer for a virtual table: the hands, and the rules of a trick.
- `lib/games.js` — a finished game on disk.
- `lib/dev.js` — the dev portal, which a real game never touches.
- `public/ui.js` — shared page bits, such as the full-screen button.
- `public/stage.js` — the overlay both scenes are played on, and the slot that says which one is open.
- `public/deal.js` — the deal animation. `public/finale.js` — the game-over finish. Both used by every screen.
- `public/table.js` — the scorecard, the standings, the winner and the vote line, drawn the same on a host screen and a phone.
- `public/accolades.js` — what each player is remembered for, worked out from the scorecard.
- `game.js` — the rules: schedule, bid order, forbidden bid, scoring. Used by the server and by every client.
- `test.js` — end-to-end test.
- `make-cert.js` — makes a self-signed certificate so the server can serve https.
- `public/ui.js` also holds the live reload client, which listens to `/live` when the server runs with `DEV=1`.
- `public/dev.html`, `dev.js` — the dev page: stand-in players, forced states, and live previews of every screen.
- `Dockerfile`, `compose.yaml` — container build and run.
- `android/` — the Android app: a WebView on the table, and `server.js` running
  inside it on Node.js for Mobile. `android/tools/prepare.sh` assembles it.
- `.github/workflows/android.yml` — builds the APK on a tag or a release.
- `android/tools/build-local.sh` — the same build on this machine, no runner.
- `public/index.html`, `join.js` — landing page: join a table or start one.
- `public/host.html`, `host.js` — host screen: code, lobby, rules, live bids, standings, scorecard.
- `public/play.html`, `play.js` — player phone: your bid pad, the trick pad when you deal, standings, and the scorecard.
- `public/table.js` — the scorecard table, shared by the host screen and the phones.
- `public/net.js` — WebSocket client with reconnect, a saved session, and a message when it cannot connect.
- `public/local.html`, `app.js` — the offline single-device tracker.
- `public/styles.css` — shared styles, light and dark.

## Notes

- Rooms are in memory only. Restarting the server ends the games in progress.
- There is no account system. Anyone with the code and network access can take a seat, so use it on a network you trust.
