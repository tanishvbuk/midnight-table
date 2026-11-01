import { appendFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ClientMessage, GameView, ServerMessage, StateMessage } from '@midnight/engine';
import { createServer } from '../src/server';
import { rngFor, viewPolicy } from './helpers';

/**
 * Game night, server crash: the process dies, comes back on the same data directory, and the
 * phone rejoins with the token it kept. The room is rebuilt by replaying its event log.
 */

const closers: (() => Promise<void> | void)[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

class Phone {
  ws: WebSocket;
  state: StateMessage | null = null;
  welcome: Extract<ServerMessage, { t: 'welcome' }> | null = null;
  errors: string[] = [];
  private waiters: (() => void)[] = [];
  constructor(url: string, autoplay?: () => Record<string, unknown> | null) {
    this.ws = new WebSocket(url);
    closers.push(() => this.ws.close());
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      if (m.t === 'welcome') this.welcome = m;
      if (m.t === 'error') this.errors.push(m.message);
      if (m.t === 'state') {
        this.state = m;
        const a = autoplay && this.state.view.you ? autoplay() : null;
        if (a) this.send({ t: 'act', action: a });
      }
      this.waiters.splice(0).forEach((w) => w());
    });
  }
  send(m: ClientMessage): void {
    this.ws.send(JSON.stringify(m));
  }
  open(): Promise<void> {
    return new Promise((res) =>
      this.ws.readyState === 1 ? res() : this.ws.once('open', () => res()),
    );
  }
  until(pred: () => boolean, ms = 60_000): Promise<void> {
    const site = new Error('timed out').stack?.split('\n')[2]?.trim() ?? '';
    return new Promise((resolve, reject) => {
      const t = setTimeout(
        () =>
          reject(new Error(`timed out waiting at ${site}; phase=${this.state?.view.phase.kind}`)),
        ms,
      );
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

/** What a phone shows, minus the clock (a restored room restarts its step timer). */
const stable = (v: GameView) => ({ ...v, timerMs: null });

describe('server restart', () => {
  it('rebuilds a half-played room from its log and lets the phone rejoin by token', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mt-restart-'));
    dirs.push(dir);
    const opts = {
      port: 0,
      dataDir: dir,
      timeScale: 0.002,
      botDelayMs: [0, 3] as [number, number],
    };

    // ---- first run: create a room, add 5 bots, play until the game is mid-flight
    const s1 = createServer(opts);
    const port1 = await s1.listen();
    const code = (
      (await (await fetch(`http://127.0.0.1:${port1}/api/rooms`, { method: 'POST' })).json()) as {
        code: string;
      }
    ).code;
    const rng = rngFor(7);
    const phone1: Phone = new Phone(`ws://127.0.0.1:${port1}/ws`, () =>
      phone1.state ? viewPolicy(phone1.state.view, rng) : null,
    );
    await phone1.open();
    phone1.send({ t: 'hello', room: code, kind: 'player', name: 'Mira' });
    await phone1.until(() => phone1.welcome !== null);
    const { token, playerId } = phone1.welcome!;
    phone1.send({ t: 'host', command: { cmd: 'addBots', count: 5 } });
    await phone1.until(() => phone1.state?.view.players.length === 6);
    phone1.send({ t: 'act', action: { type: 'start' } });
    // Every game reaches a first discussion (a random seed can end a game before day 2).
    await phone1.until(() => phone1.state?.view.phase.kind === 'discussion');

    // Freeze the table so "before" and "after" are comparable, and wait for it to settle.
    phone1.send({ t: 'host', command: { cmd: 'pause' } });
    await phone1.until(() => phone1.state?.paused === true);
    await new Promise((r) => setTimeout(r, 100));
    const before = phone1.state!;
    expect(before.view.you?.id).toBe(playerId);
    expect(before.view.phase.kind).not.toBe('finalReveal');

    // ---- the server dies; a torn half-line is left at the end of the log, as after a crash
    await s1.close();
    const [file] = readdirSync(dir);
    expect(file).toBe(`${code}.jsonl`);
    appendFileSync(join(dir, file!), '{"k":"act","action":{"type":"vo');

    // ---- second run, same data directory, a new port
    const s2 = createServer(opts);
    closers.push(() => s2.close());
    const port2 = await s2.listen();
    const info = (await (await fetch(`http://127.0.0.1:${port2}/api/rooms/${code}`)).json()) as {
      exists: boolean;
      players: number;
    };
    expect(info).toMatchObject({ exists: true, players: 6 });

    const phone2: Phone = new Phone(`ws://127.0.0.1:${port2}/ws`, () =>
      phone2.state ? viewPolicy(phone2.state.view, rng) : null,
    );
    await phone2.open();
    const t0 = Date.now();
    phone2.send({ t: 'hello', room: code, kind: 'player', token: token! });
    await phone2.until(() => phone2.welcome !== null && phone2.state !== null);
    expect(Date.now() - t0).toBeLessThan(5000); // R3's budget, for what the server controls
    expect(phone2.errors).toEqual([]);
    expect(phone2.welcome?.playerId).toBe(playerId);
    expect(phone2.welcome?.token).toBe(token);
    expect(phone2.state?.isHost).toBe(true);
    expect(phone2.state?.paused).toBe(true); // a host pause survives the crash

    // exactly the table and the private view the phone had before the crash
    expect(stable(phone2.state!.view)).toEqual(stable(before.view));

    // the castle still never sees a hidden role after a restart
    const castle = new Phone(`ws://127.0.0.1:${port2}/ws`);
    await castle.open();
    castle.send({ t: 'hello', room: code, kind: 'castle' });
    await castle.until(() => castle.state !== null);
    expect(castle.state?.view.you).toBeNull();
    expect(castle.state?.view.players.map((p) => p.name)).toEqual(
      before.view.players.map((p) => p.name),
    );

    // a seat the server never issued is still refused
    const stranger = new Phone(`ws://127.0.0.1:${port2}/ws`);
    await stranger.open();
    stranger.send({ t: 'hello', room: code, kind: 'player', token: 'not-a-real-token' });
    await stranger.until(() => stranger.errors.length > 0);

    // ---- the game carries on after the restart and finishes
    phone2.send({ t: 'host', command: { cmd: 'resume' } });
    await castle.until(() => castle.state?.view.phase.kind === 'finalReveal');
    expect(phone2.errors.filter((e) => !/Invalid|already|not in|paused/i.test(e))).toEqual([]);
    const endDay = castle.state!.view.day;
    expect(endDay).toBeGreaterThanOrEqual(before.view.day);
    await s2.close();

    // ---- and a finished room survives another restart, still rejoinable
    const s3 = createServer(opts);
    closers.push(() => s3.close());
    const port3 = await s3.listen();
    const phone3 = new Phone(`ws://127.0.0.1:${port3}/ws`);
    await phone3.open();
    phone3.send({ t: 'hello', room: code, kind: 'player', token: token! });
    await phone3.until(() => phone3.state !== null);
    expect(phone3.state?.view.phase.kind).toBe('finalReveal');
    expect(phone3.state?.view.day).toBe(endDay);
    expect(phone3.welcome?.playerId).toBe(playerId);
  });
});
