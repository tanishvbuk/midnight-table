import { afterEach, describe, expect, it } from 'vitest';
import { view, type GameView } from '@midnight/engine';
import {
  GameClient,
  tokenKey,
  type ClientEnv,
  type KeyValue,
  type SocketLike,
} from '../src/client';
import { createServer } from '../../server/src/server';

/**
 * R3: "A phone that locks or refreshes rejoins within 5 seconds with its state intact."
 *
 * These run the real client class against the real server over real sockets, on the real clock.
 * `DeadableSocket` can go silent without ever closing, which is what a locked iPhone does to a
 * WebSocket: the page thinks it is connected, and nothing arrives or leaves.
 */
const BUDGET_MS = 5000;

class DeadableSocket implements SocketLike {
  static all: DeadableSocket[] = [];
  readonly raw: WebSocket;
  dead = false;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  constructor(url: string) {
    this.raw = new WebSocket(url);
    DeadableSocket.all.push(this);
    this.raw.onopen = (e) => this.onopen?.(e);
    this.raw.onmessage = (e) => {
      if (!this.dead) this.onmessage?.({ data: e.data });
    };
    this.raw.onclose = (e) => {
      if (!this.dead) this.onclose?.(e);
    };
    this.raw.onerror = (e) => this.onerror?.(e);
  }
  get readyState(): number {
    return this.raw.readyState;
  }
  send(data: string): void {
    if (!this.dead) this.raw.send(data);
  }
  close(): void {
    this.raw.close();
  }
}

class MemoryStorage implements KeyValue {
  data = new Map<string, string>();
  get = (k: string) => this.data.get(k) ?? null;
  set = (k: string, v: string) => void this.data.set(k, v);
  remove = (k: string) => void this.data.delete(k);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 15_000, what = 'condition'): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return;
    await sleep(15);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
  DeadableSocket.all = [];
});

async function boot() {
  const server = createServer({ port: 0, botDelayMs: [0, 5] });
  const port = await server.listen();
  cleanup.push(() => server.close());
  const base = `127.0.0.1:${port}`;
  const code = (
    (await (await fetch(`http://${base}/api/rooms`, { method: 'POST' })).json()) as { code: string }
  ).code;
  const room = server.manager.get(code)!;
  const env = (storage: KeyValue): ClientEnv => ({
    url: `ws://${base}/ws`,
    WebSocket: DeadableSocket,
    storage,
  });
  const make = (kind: 'player' | 'castle', storage: KeyValue, name = 'Mira') => {
    const c = new GameClient(code, kind, () => ({ name }), env(storage));
    cleanup.push(() => c.stop());
    c.start();
    return c;
  };
  return { server, room, code, env, make };
}

/** A 6-player game, with the human parked in the Round Table having already pressed "Ready". */
async function humanInDiscussion(opts: { ready?: boolean } = {}) {
  const ctx = await boot();
  const storage = new MemoryStorage();
  const phone = ctx.make('player', storage);
  await until(() => phone.state !== null && phone.playerId !== null, 5000, 'first state');
  phone.host({ cmd: 'addBots', count: 5 });
  await until(() => phone.state?.view.players.length === 6, 5000, 'bots');
  phone.act({ type: 'start' });
  const step = (kind: string, action: () => Record<string, unknown>) =>
    until(() => phone.state?.view.phase.kind === kind, 15_000, kind).then(() =>
      phone.act(action()),
    );
  await step('roleReveal', () => ({ type: 'ackRole' }));
  await step('mission', () => {
    const ph = phone.state!.view.phase;
    return {
      type: 'submitAnswers',
      answers: ph.kind === 'mission' ? ph.questions.map(() => 0) : [],
    };
  });
  await until(() => phone.state?.view.phase.kind === 'discussion', 15_000, 'discussion');
  const me = phone.playerId!;
  if (opts.ready !== false) {
    phone.act({ type: 'ready' });
    await until(
      () => {
        const ph = phone.state?.view.phase;
        return ph?.kind === 'discussion' && ph.ready.includes(me);
      },
      5000,
      'ready recorded',
    );
  }
  await sleep(100);
  return { ...ctx, phone, storage, me };
}

/** What the server would show this player right now. */
const serverView = (room: { state: Parameters<typeof view>[0] }, who: string): GameView =>
  view(room.state, who);

describe('R3: a phone that drops rejoins within 5s with its state intact', () => {
  it('rejoins the same seat after a clean disconnect', async () => {
    const { phone, room, me, storage } = await humanInDiscussion();
    const token = storage.get(tokenKey(phone.room));
    const before = structuredClone(phone.state!.view);

    const t0 = Date.now();
    const first = phone.connectionCount;
    DeadableSocket.all.at(-1)!.close();
    await until(
      () => phone.connectionCount > first && phone.status === 'open',
      BUDGET_MS,
      'rejoin',
    );
    const took = Date.now() - t0;

    expect(took).toBeLessThan(BUDGET_MS);
    expect(phone.playerId).toBe(me);
    expect(storage.get(tokenKey(phone.room))).toBe(token);
    expect(phone.state!.view).toEqual(before);
    expect(phone.state!.view).toEqual(serverView(room, me));
    expect(phone.state!.isHost).toBe(true);
    console.log(`clean drop: rejoined in ${took} ms`);
  });

  it('replaces a socket that went dead while the phone was locked, and catches up', async () => {
    const { phone, room, me } = await humanInDiscussion();
    const stale = structuredClone(phone.state!.view);

    // The phone locks: the socket stays "open" but nothing flows, and no close event ever comes.
    const zombie = DeadableSocket.all.at(-1)!;
    zombie.dead = true;
    // Meanwhile the game moves on: a bot says it is ready to vote.
    const bot = room.state.players.find((p) => p.id !== me)!.id;
    expect(room.act(bot, { type: 'ready' })).toBeNull();
    await sleep(300);
    expect(phone.state!.view).toEqual(stale); // the locked phone has seen none of it

    // The phone unlocks: the page becomes visible and the client is woken.
    const t0 = Date.now();
    const first = phone.connectionCount;
    phone.wake();
    await until(
      () => phone.connectionCount > first && phone.status === 'open' && phone.state!.view !== stale,
      BUDGET_MS,
      'rejoin after unlock',
    );
    const took = Date.now() - t0;

    expect(took).toBeLessThan(BUDGET_MS);
    expect(phone.playerId).toBe(me);
    expect(phone.state!.view).toEqual(serverView(room, me));
    const ph = phone.state!.view.phase;
    expect(ph.kind === 'discussion' && ph.ready.includes(bot) && ph.ready.includes(me)).toBe(true);
    console.log(`locked phone: rejoined and caught up in ${took} ms`);
  });

  it('does not churn when the socket is healthy and the page merely wakes', async () => {
    const { phone } = await humanInDiscussion();
    const n = phone.connectionCount;
    phone.wake();
    phone.wake();
    await sleep(2000);
    expect(phone.connectionCount).toBe(n);
    expect(phone.status).toBe('open');
  });

  it('takes the same seat after a page refresh (new client, same stored token)', async () => {
    const { phone, room, me, storage, make } = await humanInDiscussion();
    phone.stop(); // the old page is gone
    const t0 = Date.now();
    const fresh = make('player', storage, 'ignored: seat already exists');
    await until(() => fresh.state !== null, BUDGET_MS, 'state after refresh');
    const took = Date.now() - t0;

    expect(took).toBeLessThan(BUDGET_MS);
    expect(fresh.playerId).toBe(me);
    expect(fresh.state!.view).toEqual(serverView(room, me));
    expect(fresh.state!.view.players).toHaveLength(6);
    console.log(`refresh: back in ${took} ms`);
  });

  it('sends an action pressed while the socket is closing, once the seat is back', async () => {
    const { phone, room, me } = await humanInDiscussion({ ready: false });
    DeadableSocket.all.at(-1)!.close(); // the connection drops under the user's thumb
    phone.act({ type: 'ready' }); // tapped before the client has even noticed
    await until(
      () => {
        const ph = phone.state?.view.phase;
        return phone.status === 'open' && ph?.kind === 'discussion' && ph.ready.includes(me);
      },
      BUDGET_MS,
      'queued ready delivered',
    );
    expect(phone.state!.view).toEqual(serverView(room, me));
  });

  it('resends an action tapped on a socket that was already dead (Wi-Fi blip, no unlock event)', async () => {
    const { phone, room, me } = await humanInDiscussion({ ready: false });
    DeadableSocket.all.at(-1)!.dead = true; // looks open, carries nothing
    const t0 = Date.now();
    phone.act({ type: 'ready' }); // goes into the void
    await sleep(100);
    const sp = room.state.phase;
    expect(sp.kind === 'discussion' && sp.ready.includes(me)).toBe(false); // the server never got it
    await until(
      () => {
        const ph = phone.state?.view.phase;
        return ph?.kind === 'discussion' && ph.ready.includes(me);
      },
      BUDGET_MS,
      'ready resent after rejoin',
    );
    expect(Date.now() - t0).toBeLessThan(BUDGET_MS);
    expect(phone.state!.view).toEqual(serverView(room, me));
    expect(phone.error).toBeNull();
  });

  it('gives up cleanly when the seat no longer exists, without hammering the server', async () => {
    const { code, env } = await boot();
    const storage = new MemoryStorage();
    storage.set(tokenKey(code), 'a-token-the-server-never-issued');
    const c = new GameClient(code, 'player', () => ({}), env(storage));
    cleanup.push(() => c.stop());
    c.start();
    await until(() => c.status === 'failed', 5000, 'failure');
    const n = c.connectionCount;
    await sleep(1500);
    expect(c.connectionCount).toBe(n);
    expect(c.error).toMatch(/seat/i);
    expect(storage.get(tokenKey(code))).toBeNull();
  });

  it('reconnects the castle screen too', async () => {
    const { phone, room, make } = await humanInDiscussion();
    const castle = make('castle', new MemoryStorage());
    await until(() => castle.state !== null, 5000, 'castle state');
    const first = castle.connectionCount;
    const t0 = Date.now();
    DeadableSocket.all.at(-1)!.close();
    await until(
      () => castle.connectionCount > first && castle.status === 'open',
      BUDGET_MS,
      'castle',
    );
    expect(Date.now() - t0).toBeLessThan(BUDGET_MS);
    expect(castle.state!.view).toEqual(view(room.state, 'castle'));
    void phone;
  });
});
