# Hosting a game night

The Wake Lock API (keeps phones and the castle awake) needs a secure context, so game night must
be served over **HTTPS**. The WebSocket then runs over `wss://` automatically: the web app picks
`wss:` whenever the page is `https:`.

## The decision

**Primary: your laptop, behind a Cloudflare quick tunnel.** Nothing to deploy, no account, no
cost, and the laptop is already the castle screen. The server keeps every room in memory and
appends an event log to disk, so a crash or restart resumes the game (see "If something dies").

**Backup: a small VPS with Caddy**, if the tunnel misbehaves, the home Wi-Fi is bad, or you want a
stable address. Same server, same commands, plus a reverse proxy.

I chose the laptop because the failure you care about is "game night is ruined", and a tunnel has
the fewest moving parts to prepare. If you would rather have a permanent URL, jump to the VPS
section; nothing in the app changes.

## Option A: laptop and a tunnel

One-time install (pick one):

```bash
brew install cloudflared                     # macOS
sudo apt install cloudflared                 # Debian/Ubuntu, after adding Cloudflare's apt repo
# or download the binary: https://github.com/cloudflare/cloudflared/releases
```

Each game night, in two terminals:

```bash
# 1. the game (builds the web app, then serves everything on :8787, loopback only)
HOST=127.0.0.1 pnpm start
```

```bash
# 2. the tunnel; it prints a https://<random-words>.trycloudflare.com address
cloudflared tunnel --url http://localhost:8787
```

Then:

1. Open the printed `https://….trycloudflare.com` address **on the laptop** (the same address the
   phones will use), press **Create a room**, then on the castle screen go to
   `/castle/CODE`, or use "Open this device as the castle screen" on the join page.
2. Put the laptop on a TV by HDMI or cast the tab. Keep it plugged in. Wake Lock keeps the screen
   on; also turn off sleep in the OS settings.
3. Phones scan the QR code on the castle, or visit the address and type the 4-letter code.

The address changes every time you start the tunnel. If you want to fix it, set up a named tunnel
on a domain you own (`cloudflared tunnel login`, `cloudflared tunnel create midnight`, then
`cloudflared tunnel route dns midnight table.example.com` and `cloudflared tunnel run --url
http://localhost:8787 midnight`) and start the server with `PUBLIC_URL=https://table.example.com`.

`ngrok http 8787` or `tailscale funnel 8787` work the same way; nothing is Cloudflare-specific.

### Why the QR is right even if you opened localhost

If you open the castle at `http://localhost:8787`, the QR would point phones at localhost. The
castle and the host's phone ask the server for `/api/config`, which returns the public address
(from `PUBLIC_URL` if set, otherwise from `X-Forwarded-Host` / `X-Forwarded-Proto`, otherwise the
`Host` header), and use that for QR codes when the page itself was opened on a local address.
Still, opening the public address on the laptop is the simplest thing and avoids surprises.

### Check it before guests arrive

```bash
curl -s https://YOUR-ADDRESS/healthz                     # {"ok":true}
curl -s https://YOUR-ADDRESS/api/config                  # {"publicUrl":"https://YOUR-ADDRESS"}
```

Then run a bot game from the tunnel address on your own phone on mobile data (not the home Wi-Fi):
create a room, add bots, start, lock the phone for 10 seconds, unlock. You should be back in
under 5 seconds.

If you do not have a tunnel at hand, `pnpm start` also works on the home network over plain
`http://<laptop-ip>:8787`. Everything plays, but Wake Lock is not available over plain http on
phones, so players must keep their screens on by hand.

## Option B: a small VPS (Caddy in front)

Any 1 vCPU / 512 MB box with Node 22 and pnpm works. Point a DNS name at it, then:

```bash
git clone https://github.com/tanishvbuk/midnight-table.git && cd midnight-table
pnpm install --frozen-lockfile
pnpm build
HOST=127.0.0.1 PORT=8787 PUBLIC_URL=https://table.example.com \
  DATA_DIR=/var/lib/midnight pnpm --filter @midnight/server start
```

`/etc/caddy/Caddyfile` (Caddy gets the certificate and upgrades WebSockets by itself):

```
table.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Keep it running with systemd, `/etc/systemd/system/midnight.service`:

```ini
[Unit]
Description=Midnight Table
After=network.target

[Service]
WorkingDirectory=/home/deploy/midnight-table
Environment=HOST=127.0.0.1 PORT=8787 PUBLIC_URL=https://table.example.com DATA_DIR=/var/lib/midnight
ExecStart=/usr/bin/env pnpm --filter @midnight/server start
Restart=always
User=deploy

[Install]
WantedBy=multi-user.target
```

nginx instead of Caddy needs the upgrade headers and a long read timeout:

```
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
}
```

## What the server does for a proxy

| Concern           | Behaviour                                                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebSocket upgrade | `/ws` on the same port and origin as the page. Tested with `X-Forwarded-*` headers and a foreign `Origin`.                                                                              |
| `wss://`          | The client uses `wss:` on https pages. Nothing to configure.                                                                                                                            |
| CORS              | None, on purpose. The app only talks to its own origin. The WebSocket carries no cookies (the seat token is sent in the first message), so a foreign page gains nothing by opening one. |
| Idle timeouts     | The client pings every 4 s and the server sends protocol pings every 10 s and drops a socket that misses one, so a tunnel's idle timeout never fires and ghosts are cleaned up.         |
| Proxy headers     | `X-Forwarded-Host` and `X-Forwarded-Proto` only feed the QR address. The server does not trust them for anything else.                                                                  |
| Caching           | `index.html` is `no-cache`; fingerprinted files under `/assets` are cached for a year, so a redeploy takes effect on the next load.                                                     |
| Bind address      | `HOST` (default all interfaces). Use `HOST=127.0.0.1` behind a tunnel or proxy so only the proxy can reach it.                                                                          |

Environment variables: `PORT`, `HOST`, `PUBLIC_URL`, `DATA_DIR`, `WEB_DIR`, `TIME_SCALE`,
`BOT_DELAY_MS`. Leave `TIME_SCALE` unset for a real game.

## If something dies

- **Server crashes or is restarted:** start it again with the same `DATA_DIR`. Each room is rebuilt
  from its log; phones reconnect on their own (the seat token is kept in the browser), timers
  restart from the top of the current step. Nobody has to rejoin.
- **Tunnel drops:** restart `cloudflared`. A quick tunnel gets a **new address**, so the old QR is
  dead. Phones already in the game must open the new address (same browser, so their seat token
  does not carry over: the seat token is stored per origin). Prefer a named tunnel or the VPS if
  you cannot afford that.
- **A phone is stuck:** the host menu can drop the player (the server then plays for them), and
  they can reopen the page to take the seat back.
- Rooms and logs live under `DATA_DIR` (default `data/rooms/`). Delete the folder to clear history.
