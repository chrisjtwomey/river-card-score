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

Every page has a full-screen button (⛶) next to the theme toggle. The button hides itself on browsers with no full-screen support, such as Safari on iPhone.

The server builds the QR code itself, so nothing is sent to an outside service. It is always black on white, whatever the page theme is, because a camera cannot read an inverted code.

### How a game runs

1. The host opens the host screen. The server makes a 4-character table code and shows a QR code with the join address. A player points a phone camera at it and lands on the join page with the code already filled in. If the machine has more than one network address, a picker under the code chooses which one goes in the QR code.
2. Each player opens the site on their phone, types the code, and takes a seat. The seat order is the order of play. The host can move a player up or down, or remove one, until the game starts.
3. The host taps 🂠 beside a player to say who deals the first round. Without a choice, seat 1 deals. The deal then moves on one seat each round.
4. The host sets the rules and presses **Start game**. Nobody can join after that.
5. **Bidding.** The server only accepts a bid from the player whose turn it is. The order starts left of the dealer and the dealer bids last. Every other phone shows whose turn it is and the bids so far.
6. With "screw the dealer" on, the server refuses the dealer's bid if it would make the bids total the number of tricks. The forbidden chip is disabled on the dealer's phone.
7. A player can change their bid until the player after them bids. Their phone keeps the pad open and says so, and the host screen marks the bid that can still change. Once the next player bids, the change is refused.
8. **Tricks.** The dealer of that round enters the tricks each player won. The server refuses a set that does not total the hand size. The host screen can enter them too, if the dealer's phone is not handy.
9. The round scores, the next round opens, and the deal moves on one seat.
10. The host can press **Go back** to reopen the last step, and **New game** to return the same players to the lobby.

### Bum deal

If the cards were dealt wrong, throw the hand in and deal it again. The round keeps the same dealer and hand size, and the bids, tricks, and trump are cleared. The round label then shows `re-deal 1`.

- The **dealer** or the **host** re-deals on their own.
- Any other player calls a bum deal and the table votes. Every player must agree. One "no" ends it, and the player who called it can take it back. The host can also force the re-deal from the host screen.

### Host screen

- **A−** and **A+** in the top bar change the page size, from 80% to 200%, so the table can read it from across the room. The size is remembered in that browser.
- The 🂠 button replays the deal animation for the round on screen at any time.
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

## Run it with Docker

```sh
PUBLIC_URL=http://192.168.1.5:8787 docker compose up --build
```

`PUBLIC_URL` is the address the phones use. A container cannot see it, so the QR code shows this instead of the container's own address. Use the address of the machine that runs Docker. Without it, the QR code says `localhost`, which no phone can reach.

The compose file mounts `./certs` read only. Run `npm run cert` on the host first for https, or delete that line. `NO_TLS=1` forces plain http.

The same variable works outside Docker, and it accepts a list: `PUBLIC_URL=http://192.168.1.5:8787,https://table.example.com`. Each address appears in the picker on the host screen.

## Behind a reverse proxy

The game runs on one WebSocket at **`/ws`**. A proxy that does not pass the upgrade will serve the page and then fail with `can't establish a connection to the server at wss://.../ws`. Firefox fails silently here, because it never asks about a WebSocket.

Three rules:

1. Pass the `Upgrade` and `Connection` headers to `/ws`.
2. Keep the path as `/ws`. Do not strip or rewrite it.
3. Set `PUBLIC_URL` to the address people type, so the QR code matches: `PUBLIC_URL=https://table.example.com`.

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

Open `public/local.html` in a browser. It needs no server and keeps its state in that browser. It has the same rules and scorecard, plus a deal animation when the game starts.

### Motion

The deal animation lives in `public/deal.js` and is shared by the host screen and the offline tracker.

The animation follows the system "reduce motion" setting. On macOS that is System Settings → Accessibility → Display → Reduce motion. With reduce motion on, the cards fade in at their seats instead of flying.

To override it, open the page with a flag. The choice is saved for that browser:

- `local.html?motion=full` — always play the full deal
- `local.html?motion=reduced` — always play the short fade
- `local.html?motion=off` — never animate

From the browser console: `playDeal()`, `playDeal('reduced')`, and `motionMode()`.

## Test

```sh
npm test
```

It starts the server on port 8899 and plays a whole game over WebSockets: joining, the bid order, the screw-the-dealer block, dealer-only trick entry, scoring, undo, reconnect, and late joins. It also checks the static routes and compares the QR image with the encoder, module by module.

## Files

- `server.js` — HTTP static files, the QR and address endpoints, plus the WebSocket game server. Rooms live in memory.
- `public/ui.js` — shared page bits, such as the full-screen button.
- `public/deal.js` — the deal animation, used by the host screen and the offline tracker.
- `game.js` — the rules: schedule, bid order, forbidden bid, scoring. Used by the server and by every client.
- `test.js` — end-to-end test.
- `make-cert.js` — makes a self-signed certificate so the server can serve https.
- `Dockerfile`, `compose.yaml` — container build and run.
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
