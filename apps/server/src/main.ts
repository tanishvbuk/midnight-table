import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from './server';

const port = Number(process.env.PORT ?? 8787);
// `pnpm start` runs from apps/server, so defaults are anchored to the repo, not the cwd.
const repoRoot = resolve(import.meta.dirname, '../../..');
const webDir = resolve(process.env.WEB_DIR ?? resolve(repoRoot, 'apps/web/dist'));
const server = createServer({
  port,
  host: process.env.HOST || undefined,
  publicUrl: process.env.PUBLIC_URL || undefined,
  dataDir: resolve(process.env.DATA_DIR ?? resolve(repoRoot, 'data/rooms')),
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
});
