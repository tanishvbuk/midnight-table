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
pnpm start            # builds the web app, serves everything on http://localhost:8787
```

Open `http://localhost:8787` on a laptop, create a room, then open `/castle/CODE` on the TV and join
from phones (or add bots from the host's phone). Environment variables: `PORT`, `DATA_DIR` (room
logs, default `data/rooms`), `WEB_DIR`, `TIME_SCALE` (e.g. `0.05` to run a game in minutes) and
`BOT_DELAY_MS` (`lo,hi`).

For development run `pnpm dev:server` and `pnpm dev:web` (Vite proxies `/api` and `/ws`).

The Wake Lock API needs HTTPS on real devices; use a tunnel for game night (decided at M3).

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm sim --games 10000 --players 4-16 --seed 1
pnpm screens --out docs/screens/after   # Playwright walkthrough: phone and castle screenshots
pnpm reconnect                          # Playwright check of R3 (refresh, dropped socket, offline blip)
```

The two Playwright scripts use the Playwright that ships with the cloud image; they are not part of
`pnpm test`.
