import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ClientMessage, ServerMessage, StateMessage } from '@midnight/engine';
import { createServer } from '../src/server';
import { rngFor, viewPolicy } from './helpers';

const open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const s of open.splice(0)) await s.close();
});

class Socket {
  ws: WebSocket;
  state: StateMessage | null = null;
  welcome: Extract<ServerMessage, { t: 'welcome' }> | null = null;
  errors: string[] = [];
  private waiters: (() => void)[] = [];
  constructor(url: string, onState?: (s: StateMessage, self: Socket) => void) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      if (m.t === 'welcome') this.welcome = m;
      if (m.t === 'error') this.errors.push(m.message);
      if (m.t === 'state') {
        this.state = m;
        onState?.(m, this);
      }
      this.waiters.splice(0).forEach((w) => w());
    });
  }
  send(m: ClientMessage): void {
    this.ws.send(JSON.stringify(m));
  }
  ready(): Promise<void> {
    return new Promise((res) =>
      this.ws.readyState === 1 ? res() : this.ws.once('open', () => res()),
    );
  }
  until(pred: () => boolean, ms = 60_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timed out')), ms);
      const check = () => {
        if (pred()) {
          clearTimeout(t);
          resolve();
        } else this.waiters.push(check);
      };
      check();
    });
  }
}

async function boot() {
  const server = createServer({ port: 0, timeScale: 0.002, botDelayMs: [0, 3] });
  const port = await server.listen();
  open.push(server);
  const http = `http://127.0.0.1:${port}`;
  const code = (
    (await (await fetch(`${http}/api/rooms`, { method: 'POST' })).json()) as { code: string }
  ).code;
  return { http, ws: `ws://127.0.0.1:${port}/ws`, code };
}

describe('websocket server', () => {
  it.each([4, 6, 12])('plays a %i-player game, 1 human plus bots, over real sockets', async (n) => {
    const { ws, code } = await boot();
    const rng = rngFor(n);
    const castle = new Socket(ws);
    await castle.ready();
    castle.send({ t: 'hello', room: code, kind: 'castle' });

    const human = new Socket(ws, (s, self) => {
      const a = viewPolicy(s.view, rng);
      if (a) self.send({ t: 'act', action: a });
    });
    await human.ready();
    human.send({ t: 'hello', room: code, kind: 'player', name: 'Human' });
    await human.until(() => human.welcome !== null);
    expect(human.welcome?.token).toBeTruthy();

    human.send({ t: 'host', command: { cmd: 'addBots', count: n - 1 } });
    await human.until(() => human.state?.view.players.length === n);
    human.send({ t: 'act', action: { type: 'start' } });
    await castle.until(() => castle.state?.view.phase.kind === 'finalReveal');

    expect(castle.state?.view.you).toBeNull();
    expect(JSON.stringify(castle.state)).not.toContain('"chat":[{');
    expect(human.errors.filter((e) => !/Invalid|already|not in/i.test(e))).toEqual([]);
  });

  it('rejoins from a token and rejects a stale one', async () => {
    const { ws, code, http } = await boot();
    const a = new Socket(ws);
    await a.ready();
    a.send({ t: 'hello', room: code, kind: 'player', name: 'Ann' });
    await a.until(() => a.welcome !== null && a.state !== null);
    const { token, playerId } = a.welcome!;
    a.ws.close();

    const b = new Socket(ws);
    await b.ready();
    b.send({ t: 'hello', room: code, kind: 'player', token: token! });
    await b.until(() => b.state !== null);
    expect(b.welcome?.playerId).toBe(playerId);
    expect(b.state?.view.you?.id).toBe(playerId);
    expect(b.state?.isHost).toBe(true);

    const c = new Socket(ws);
    await c.ready();
    c.send({ t: 'hello', room: code, kind: 'player', token: 'nope' });
    await c.until(() => c.errors.length > 0);
    expect(c.errors[0]).toMatch(/seat/i);

    const info = (await (await fetch(`${http}/api/rooms/${code}`)).json()) as { players: number };
    expect(info.players).toBe(1);
    expect((await fetch(`${http}/api/rooms/ZZZZ`)).status).toBe(404);
  });

  it('survives malformed websocket messages', async () => {
    const { ws, code, http } = await boot();
    const host = new Socket(ws);
    await host.ready();
    // Before hello: values JSON.parse accepts but that are not message objects.
    for (const raw of ['null', '0', '"x"', '[]', 'true']) host.ws.send(raw);
    host.send({ t: 'hello', room: code, kind: 'player', name: 'Host' });
    await host.until(() => host.welcome !== null && host.state !== null);
    // After hello, as the host: missing or junk payloads.
    for (const raw of [
      '{"t":"host"}',
      '{"t":"host","command":null}',
      '{"t":"host","command":"pause"}',
      '{"t":"host","command":{"cmd":"dropPlayer"}}',
      '{"t":"host","command":{"cmd":"addBots","count":"9"}}',
      '{"t":"act","action":null}',
      '{"t":"act","action":"start"}',
    ]) {
      host.ws.send(raw);
    }
    await host.until(() => host.errors.length >= 12);
    // Still serving: the room answers and a valid command still works.
    expect((await fetch(`${http}/api/rooms/${code}`)).status).toBe(200);
    host.send({ t: 'host', command: { cmd: 'addBots', count: 2 } });
    await host.until(() => host.state?.view.players.length === 3);
  });
});

describe('static files', () => {
  function rawGet(port: number, path: string): Promise<number> {
    // fetch() would normalise the path; send it exactly as an attacker could.
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('rejects malformed URLs and sibling directories without crashing', async () => {
    const base = mkdtempSync(join(tmpdir(), 'mt-static-'));
    const webDir = join(base, 'dist');
    mkdirSync(webDir);
    mkdirSync(join(base, 'dist-old'));
    writeFileSync(join(webDir, 'index.html'), 'app');
    writeFileSync(join(base, 'dist-old', 'secret.txt'), 'secret');
    const server = createServer({ port: 0, webDir });
    const port = await server.listen();
    open.push(server);

    expect(await rawGet(port, '/%E0%A4%A')).toBe(400);
    expect(await rawGet(port, '/..%2fdist-old/secret.txt')).toBe(403);
    expect(await rawGet(port, '/index.html')).toBe(200);
  });
});
