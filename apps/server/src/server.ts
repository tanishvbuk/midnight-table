import { randomInt } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer as createHttp, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
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
    let code = '';
    do {
      code = Array.from({ length: 4 }, () => LETTERS[randomInt(LETTERS.length)]).join('');
    } while (this.rooms.has(code));
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
  let file = normalize(join(webDir, decodeURIComponent(url.pathname)));
  if (!file.startsWith(webDir)) return void json(res, 403, { error: 'forbidden' });
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(webDir, 'index.html');
  if (!existsSync(file)) return void json(res, 404, { error: 'not found' });
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}

export function createServer(opts: ServerOptions) {
  const manager = new RoomManager(opts);
  const http = createHttp((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
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
        if (id === null && token) {
          return client.send({
            t: 'error',
            message: 'Your seat is gone. Join again.',
            fatal: true,
          });
        }
        if (id === null) {
          const name = typeof msg.name === 'string' ? msg.name : '';
          const avatar = typeof msg.avatar === 'string' ? msg.avatar : null;
          const joined = found.join(name, avatar);
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
      if (msg.t === 'act') err = room.act(playerId, (msg.action ?? {}) as Record<string, unknown>);
      else if (msg.t === 'host') err = room.host(playerId, msg.command as HostCommand);
      if (err) client.send({ t: 'error', message: err });
    });
    ws.on('close', () => {
      clearInterval(refill);
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
        http.listen(opts.port, () => {
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
