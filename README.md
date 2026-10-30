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

Wake Lock needs HTTPS on real devices, so game night runs the laptop behind a tunnel (or on a small
VPS). Exact commands are in [`docs/HOSTING.md`](docs/HOSTING.md); the playtest plan is in
[`docs/PLAYTEST.md`](docs/PLAYTEST.md).

Also: `HOST` (bind address, use `127.0.0.1` behind a proxy) and `PUBLIC_URL` (the address QR codes
point at; derived from proxy headers if unset).

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm sim --games 10000 --players 4-16 --seed 1
pnpm e2e              # optional, not in CI: real Chromium on phone viewports against `pnpm start`
```

`pnpm e2e` needs `playwright` resolvable from Node (preinstalled in the cloud sandbox; elsewhere
`npm i -g playwright && npx playwright install chromium`). It spawns the server with scaled timers,
plays a full game with bots through the UI, and writes screenshots to `e2e/out/`.
