import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './server';

// Defaults are anchored to the repo root, not the cwd: pnpm runs package scripts from apps/server.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const port = Number(process.env.PORT ?? 8787);
const webDir = resolve(root, process.env.WEB_DIR ?? 'apps/web/dist');
const server = createServer({
  port,
  dataDir: resolve(root, process.env.DATA_DIR ?? 'data/rooms'),
  publicUrl: process.env.PUBLIC_URL?.replace(/\/+$/, '') || undefined,
  webDir: existsSync(webDir) ? webDir : undefined,
  timeScale: Number(process.env.TIME_SCALE ?? 1),
  botDelayMs: process.env.BOT_DELAY_MS
    ? (process.env.BOT_DELAY_MS.split(',').map(Number) as [number, number])
    : undefined,
});
server.listen().then((p) => {
  console.log(
    `Midnight Table server on http://localhost:${p}${existsSync(webDir) ? '' : ' (no web build found)'}`,
  );
  if (process.env.PUBLIC_URL) console.log(`Public URL: ${process.env.PUBLIC_URL}`);
});
