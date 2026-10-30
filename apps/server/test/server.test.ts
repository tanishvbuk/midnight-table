import { afterEach, describe, expect, it } from 'vitest';
import { connect } from 'node:net';
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
  constructor(
    url: string,
    onState?: (s: StateMessage, self: Socket) => void,
    headers?: Record<string, string>,
  ) {
    this.ws = new WebSocket(url, { headers });
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

async function boot(extra: Partial<Parameters<typeof createServer>[0]> = {}) {
  const server = createServer({ port: 0, timeScale: 0.002, botDelayMs: [0, 3], ...extra });
  const port = await server.listen();
  open.push(server);
  const http = `http://127.0.0.1:${port}`;
  const code = (
    (await (await fetch(`${http}/api/rooms`, { method: 'POST' })).json()) as { code: string }
  ).code;
  return { http, ws: `ws://127.0.0.1:${port}/ws`, code };
}

describe('websocket server', () => {
  it.each([4, 6, 12])(
    'plays a %i-player game, 1 human plus bots, over real sockets',
    async (n) => {
      const { ws, code } = await boot();
      const rng = rngFor(n);
      const castle = new Socket(ws);
      await castle.ready();
      castle.send({ t: 'hello', room: code, kind: 'castle' });

      // Like a person, send each decision once rather than on every state message the bots cause.
      let lastSent = '';
      const human = new Socket(ws, (s, self) => {
        const a = viewPolicy(s.view, rng);
        const key = a ? `${s.view.phase.kind}:${JSON.stringify(a)}` : '';
        if (a && key !== lastSent) {
          lastSent = key;
          self.send({ t: 'act', action: a });
        }
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
    },
    30_000,
  );

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

  it('lets a join be retried with the same token without taking a second seat', async () => {
    const { ws, code, http } = await boot();
    const token = 'a1'.repeat(16);
    const first = new Socket(ws);
    await first.ready();
    first.send({ t: 'hello', room: code, kind: 'player', name: 'Ann', token });
    await first.until(() => first.welcome !== null && first.state !== null);
    expect(first.welcome?.token).toBe(token);
    first.ws.terminate();

    const retry = new Socket(ws);
    await retry.ready();
    retry.send({ t: 'hello', room: code, kind: 'player', name: 'Ann', token });
    await retry.until(() => retry.state !== null);
    expect(retry.welcome?.playerId).toBe(first.welcome?.playerId);
    const info = (await (await fetch(`${http}/api/rooms/${code}`)).json()) as { players: number };
    expect(info.players).toBe(1);
  });

  it('works behind a TLS-terminating proxy', async () => {
    const { ws, code, http } = await boot();
    const headers = {
      origin: 'https://table.example.com',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'table.example.com',
      'x-forwarded-for': '203.0.113.9',
    };
    const cfg = (await (await fetch(`${http}/api/config`, { headers })).json()) as {
      publicUrl: string;
    };
    expect(cfg.publicUrl).toBe('https://table.example.com');
    expect(((await (await fetch(`${http}/healthz`)).json()) as { ok: boolean }).ok).toBe(true);

    const sock = new Socket(ws, undefined, headers);
    await sock.ready();
    sock.send({ t: 'hello', room: code, kind: 'castle' });
    await sock.until(() => sock.state !== null);
    expect(sock.state?.view.phase.kind).toBe('lobby');
  });

  it('prefers the configured public URL over proxy headers', async () => {
    const { http } = await boot({ publicUrl: 'https://fixed.example.org/' });
    const cfg = (await (
      await fetch(`${http}/api/config`, { headers: { 'x-forwarded-host': 'other.example' } })
    ).json()) as { publicUrl: string };
    expect(cfg.publicUrl).toBe('https://fixed.example.org');
  });

  it('drops a socket that stops answering protocol pings', async () => {
    const { ws } = await boot({ heartbeatMs: 40 });
    const { port } = new URL(ws);
    // A raw TCP client that completes the handshake and then never answers a ping.
    const raw = connect(Number(port), '127.0.0.1');
    raw.write(
      'GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
    );
    raw.resume();
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('socket never dropped')), 3000);
      raw.on('close', () => (clearTimeout(t), res()));
    });
  });
});
