# Hosting for game night (M3 prep)

Selfies (camera) and the Wake Lock API need HTTPS on real phones, so a plain `http://192.168.x.x`
address is not enough. Two options, both serve the same single Node process.

## Option A: laptop plus a tunnel (recommended for the first playtest)

```bash
pnpm install
pnpm start                                   # http://localhost:8787
cloudflared tunnel --url http://localhost:8787   # prints an https://*.trycloudflare.com URL
```

Open the printed HTTPS URL on the laptop or TV, create a room, and the QR code on the castle screen
will point at that same HTTPS origin, because the web app builds it from `location.origin`. Players
scan it; nothing else to configure. `ngrok http 8787` works the same way.

- Keep the laptop awake and plugged in for the whole game.
- Room logs go to `data/rooms`; restarting the server restores in-progress rooms and phones rejoin
  automatically.

## Option B: small Node host

Any host that runs Node 22+ and terminates TLS (Fly.io, Render, a VPS behind Caddy). Run
`pnpm install && pnpm start`, set `PORT`, and point `DATA_DIR` at a persistent volume.

## Pre-game checklist

1. `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
2. Start with `TIME_SCALE=0.05` once and add bots to confirm a full game finishes.
3. Open the HTTPS URL on one real phone; check the selfie prompt and that a locked phone rejoins.
