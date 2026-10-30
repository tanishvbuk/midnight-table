import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from './server';

const port = Number(process.env.PORT ?? 8787);
const webDir = resolve(process.env.WEB_DIR ?? 'apps/web/dist');
const server = createServer({
  port,
  dataDir: resolve(process.env.DATA_DIR ?? 'data/rooms'),
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
