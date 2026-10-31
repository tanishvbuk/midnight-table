# Midnight Table

A Traitors-style party game for 4–16 friends, played on phones with a shared castle screen. See
[`docs/SPEC.md`](docs/SPEC.md) for the design and [`docs/RULES-DECISIONS.md`](docs/RULES-DECISIONS.md)
for the rule calls the spec left open.

## Layout

| Path              | What                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------- |
| `packages/engine` | Pure rules engine: `apply`, `view`, narration, wire protocol types                    |
| `packages/sim`    | Random bots and the CLI simulator                                                     |
| `apps/server`     | Node + WebSocket server: rooms, auto-host timers, bots, escape hatch, JSONL event log |
| `apps/web`        | Vite + React: join, phone controller and castle screen                                |

## Run it

```bash
pnpm install
pnpm start:local      # builds, serves on http://localhost:8787, no tunnel
```

Open `http://localhost:8787` on a laptop, create a room, then open `/castle/CODE` on the TV and join
from phones (or add bots from the host's phone). Environment variables: `PORT`, `DATA_DIR` (room
logs, default `data/rooms` in the repo root), `WEB_DIR`, `PUBLIC_URL`, `TIME_SCALE` (e.g. `0.05` to
run a game in minutes) and `BOT_DELAY_MS` (`lo,hi`).

For development run `pnpm dev:server` and `pnpm dev:web` (Vite proxies `/api` and `/ws`).

## Game night

Hosting is a **laptop behind a Cloudflare quick tunnel** (reasoning in
[`docs/RULES-DECISIONS.md`](docs/RULES-DECISIONS.md#hosting-m3)). Phones need an https address for
the Wake Lock API and the selfie camera; the tunnel supplies one with no account and no domain.

One-time setup, on the laptop:

```bash
# install cloudflared (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
brew install cloudflared                 # macOS
winget install --id Cloudflare.cloudflared   # Windows
# Linux: use the package or binary from the link above
pnpm install
```

On the night:

```bash
cd midnight-table
pnpm start
```

`pnpm start` builds the web app, opens the tunnel, then starts the server with the tunnel address.
It prints a box with an `https://….trycloudflare.com` address. Then:

1. Open **that https address** in the laptop's browser (not `localhost`, so the castle gets Wake Lock
   too) and click "Create a room". Cast or plug the laptop into the TV and open the castle view.
2. Players scan the QR code on the castle screen.
3. Keep the laptop awake and plugged in, and leave the terminal open.
4. If the server crashes the launcher restarts it within a few seconds and rebuilds every room from
   `data/rooms/*.jsonl`; phones rejoin on their own.
5. Do **not** restart `pnpm start` mid-game unless you must. A new tunnel is a new address, and a
   phone's seat token only works on the address it joined on.

Fallbacks:

| Situation                  | Command                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| No tunnel, same Wi-Fi only | `pnpm start:local`, phones go to `http://<laptop-ip>:8787` (no Wake Lock, so phones may sleep)              |
| Your own https address     | `PUBLIC_URL=https://you.example.ts.net pnpm start` after e.g. `tailscale funnel 8787`; no tunnel is spawned |
| Server only, no launcher   | `pnpm build && pnpm start:server`                                                                           |

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm sim --games 10000 --players 4-16 --seed 1
pnpm screens --out docs/screens/after   # Playwright walkthrough: phone and castle screenshots
pnpm reconnect                          # Playwright check of R3 (refresh, dropped socket, offline blip)
```

The two Playwright scripts use the Playwright that ships with the cloud image; they are not part of
`pnpm test`.
