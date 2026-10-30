import { randomInt } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer as createHttp, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import type { ClientMessage, ConfigOverrides, HostCommand, ServerMessage } from '@midnight/engine';
import { WebSocketServer, type WebSocket } from 'ws';
import { openLog, readLogs } from './log';
import { Room, type Client } from './room';
import { realScheduler, type Scheduler } from './scheduler';

export interface ServerOptions {
  port: number;
  dataDir?: string;
  webDir?: string;
  scheduler?: Scheduler;
  /** Public origin to put in QR codes, e.g. https://table.example.com. Derived from proxy headers if unset. */
  publicUrl?: string;
  host?: string;
  /** Protocol ping interval; a socket that misses one pong is dropped. */
  heartbeatMs?: number;
  timeScale?: number;
  botDelayMs?: [number, number];
  config?: ConfigOverrides;
}

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const IDLE_ROOM_MS = 6 * 60 * 60 * 1000;
/** Protocol-level ping, so a phone that vanished (lock, tunnel drop) is noticed quickly. */
const HEARTBEAT_MS = 10_000;
const TOKEN_RE = /^[0-9a-f]{32}$/;

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  constructor(private opts: Omit<ServerOptions, 'port' | 'webDir'>) {
    if (opts.dataDir) {
      for (const { code, entries } of readLogs(opts.dataDir)) {
        const room = Room.restore(entries, {
          scheduler: this.scheduler,
          log: openLog(opts.dataDir, code),
          timeScale: opts.timeScale,
          botDelayMs: opts.botDelayMs,
        });
        if (room) this.rooms.set(code, room);
      }
    }
  }

  private get scheduler(): Scheduler {
    return this.opts.scheduler ?? realScheduler;
  }

  create(): Room {
    const makeCode = (): string =>
      Array.from({ length: 4 }, () => LETTERS[randomInt(LETTERS.length)]).join('');
    let code = makeCode();
    while (this.rooms.has(code)) code = makeCode();
    const room = new Room({
      code,
      seed: randomInt(2 ** 31),
      config: this.opts.config,
      scheduler: this.scheduler,
      log: this.opts.dataDir ? openLog(this.opts.dataDir, code) : undefined,
      timeScale: this.opts.timeScale,
      botDelayMs: this.opts.botDelayMs,
    });
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  sweep(): void {
    const now = this.scheduler.now();
    for (const [code, room] of this.rooms) {
      if (room.isEmpty && now - room.lastActivity > IDLE_ROOM_MS) this.rooms.delete(code);
    }
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function serveStatic(webDir: string, req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x');
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return void json(res, 400, { error: 'bad path' });
  }
  let file = normalize(join(webDir, pathname));
  if (file !== webDir && !file.startsWith(webDir + sep)) {
    return void json(res, 403, { error: 'forbidden' });
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(webDir, 'index.html');
  if (!existsSync(file)) return void json(res, 404, { error: 'not found' });
  // Vite fingerprints everything under /assets, so it can be cached forever. The shell must not be.
  const cache = file.includes(`${sep}assets${sep}`)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': cache,
  });
  res.end(readFileSync(file));
}

/** The origin guests should scan: explicit config first, then what the proxy says, then the Host header. */
export function publicOrigin(req: IncomingMessage, configured?: string): string {
  if (configured) return configured.replace(/\/+$/, '');
  const first = (v: string | string[] | undefined): string | undefined =>
    (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim() || undefined;
  const host = first(req.headers['x-forwarded-host']) ?? req.headers.host ?? 'localhost';
  const proto = first(req.headers['x-forwarded-proto']) === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}

export function createServer(opts: ServerOptions) {
  const manager = new RoomManager(opts);
  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/healthz') return json(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return json(res, 200, { publicUrl: publicOrigin(req, opts.publicUrl) });
    }
    if (req.method === 'POST' && url.pathname === '/api/rooms') {
      return json(res, 200, { code: manager.create().code });
    }
    const m = /^\/api\/rooms\/([A-Za-z]{4})$/.exec(url.pathname);
    if (req.method === 'GET' && m) {
      const room = manager.get(m[1] as string);
      if (!room) return json(res, 404, { exists: false });
      return json(res, 200, {
        exists: true,
        started: room.state.phase.kind !== 'lobby',
        players: room.state.players.length,
      });
    }
    if (opts.webDir && req.method === 'GET') return serveStatic(opts.webDir, req, res);
    json(res, 404, { error: 'not found' });
  };
  const http = createHttp((req, res) => {
    try {
      handle(req, res);
    } catch {
      if (!res.headersSent) json(res, 500, { error: 'server error' });
      else res.end();
    }
  });

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 200_000 });
  wss.on('connection', (ws: WebSocket) => {
    const client: Client = {
      send: (msg: ServerMessage) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      close: () => ws.close(),
    };
    let room: Room | null = null;
    let playerId: string | null = null;
    let burst = 0;
    const refill = setInterval(() => (burst = 0), 1000);
    let alive = true;
    ws.on('pong', () => (alive = true));
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, opts.heartbeatMs ?? HEARTBEAT_MS);

    ws.on('message', (data) => {
      if (++burst > 30) return client.send({ t: 'error', message: 'Slow down.' });
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        return client.send({ t: 'error', message: 'Bad message.' });
      }
      if (msg.t === 'ping') return client.send({ t: 'pong' });
      if (msg.t === 'hello') {
        if (room) return;
        const found = manager.get(String(msg.room ?? ''));
        if (!found) return client.send({ t: 'error', message: 'No such room.', fatal: true });
        if (msg.kind === 'castle') {
          room = found;
          client.send({
            t: 'welcome',
            room: found.code,
            kind: 'castle',
            playerId: null,
            token: null,
          });
          found.connectCastle(client);
          return;
        }
        let token = typeof msg.token === 'string' ? msg.token : null;
        let id = token ? found.connectPlayer(token, client) : null;
        const name = typeof msg.name === 'string' ? msg.name : '';
        // A name means "I am joining". The phone picks its own token, so a join whose reply was
        // lost to a dropped connection can be retried without taking a second seat.
        if (id === null && token && !name) {
          return client.send({
            t: 'error',
            message: 'Your seat is gone. Join again.',
            fatal: true,
          });
        }
        if (id === null) {
          const avatar = typeof msg.avatar === 'string' ? msg.avatar : null;
          const joined = found.join(
            name,
            avatar,
            token && TOKEN_RE.test(token) ? token : undefined,
          );
          if (typeof joined === 'string') {
            return client.send({ t: 'error', message: joined, fatal: true });
          }
          token = joined.token;
          id = found.connectPlayer(token, client);
        }
        if (id === null || token === null) return;
        room = found;
        playerId = id;
        client.send({ t: 'welcome', room: found.code, kind: 'player', playerId: id, token });
        found.connectPlayer(token, client); // re-send state after the welcome
        return;
      }
      if (!room || !playerId) return client.send({ t: 'error', message: 'Say hello first.' });
      let err: string | null = null;
      let cid: string | undefined;
      if (msg.t === 'act') {
        cid = typeof msg.cid === 'string' && msg.cid.length <= 40 ? msg.cid : undefined;
        err = room.act(playerId, (msg.action ?? {}) as Record<string, unknown>, cid);
      } else if (msg.t === 'host') err = room.host(playerId, msg.command as HostCommand);
      if (err) client.send({ t: 'error', message: err, cid });
      if (cid) client.send({ t: 'ack', cid });
    });
    ws.on('close', () => {
      clearInterval(refill);
      clearInterval(heartbeat);
      room?.disconnect(client);
    });
    ws.on('error', () => ws.close());
  });

  const sweeper = setInterval(() => manager.sweep(), 10 * 60 * 1000);
  sweeper.unref();

  return {
    manager,
    http,
    listen: () =>
      new Promise<number>((resolve) =>
        http.listen(opts.port, opts.host, () => {
          const addr = http.address();
          resolve(typeof addr === 'object' && addr ? addr.port : opts.port);
        }),
      ),
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(sweeper);
        for (const c of wss.clients) c.terminate();
        wss.close(() => http.close(() => resolve()));
      }),
  };
}
