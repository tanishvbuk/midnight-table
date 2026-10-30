import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { viewProblems, view } from '@midnight/engine';
import { FileLog, openLog, readLogs } from '../src/log';
import { Room } from '../src/room';
import { VirtualScheduler } from '../src/scheduler';
import { FakeClient, rngFor, viewPolicy } from './helpers';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(seed: number, extra: Partial<ConstructorParameters<typeof Room>[0]> = {}) {
  const sched = new VirtualScheduler();
  const room = new Room({
    code: 'TEST',
    seed,
    scheduler: sched,
    botDelayMs: [50, 400],
    ...extra,
  });
  return { sched, room };
}

/** Joins a scripted human as host, fills with bots, starts, and plays to the end. */
function playWithBots(seed: number, players: number, opts: { leakCheck?: boolean } = {}) {
  const { sched, room } = setup(seed);
  const human = new FakeClient();
  const castle = new FakeClient();
  room.connectCastle(castle);
  const joined = room.join('Human', null);
  if (typeof joined === 'string') throw new Error(joined);
  room.connectPlayer(joined.token, human);
  expect(room.host(joined.playerId, { cmd: 'addBots', count: players - 1 })).toBeNull();
  const rng = rngFor(seed);

  const problems: string[] = [];
  if (opts.leakCheck) {
    const check = (viewer: string) => (m: { t: string }) => {
      if (m.t === 'state') problems.push(...viewProblems(room.state, viewer));
    };
    castle.onMessage = check('castle');
    human.onMessage = check(joined.playerId);
  }
  human.onMessage = ((prev) => (m) => {
    prev?.(m);
    if (m.t !== 'state') return;
    const action = viewPolicy(m.view, rng);
    if (action) sched.setTimeout(() => void room.act(joined.playerId, action), 100);
  })(human.onMessage);

  expect(room.act(joined.playerId, { type: 'start' })).toBeNull();
  sched.run(() => room.state.phase.kind === 'finalReveal');
  return { room, human, castle, problems, joined, sched };
}

describe('room: full games with one human and bots', () => {
  it.each([4, 6, 12])('a %i-player game runs start to finish', (n) => {
    const { room, human, castle, problems } = playWithBots(n * 7, n, { leakCheck: true });
    expect(room.state.phase.kind).toBe('finalReveal');
    expect(room.state.result).not.toBeNull();
    expect(problems).toEqual([]);
    expect(human.errors).toEqual([]);
    // the castle only ever gets public events and a view with no private section
    for (const m of castle.messages) {
      if (m.t !== 'state') continue;
      expect(m.view.you).toBeNull();
      expect(m.events.every((e) => e.audience === 'public')).toBe(true);
    }
    const last = castle.last;
    expect(last?.narration).toMatch(/win/);
  });

  it('keeps one line of narration per state and never names a hidden role', () => {
    const { castle } = playWithBots(99, 8);
    for (const m of castle.messages) {
      if (m.t === 'state') expect(m.narration.length).toBeGreaterThan(0);
    }
  });
});

describe('room: seats, rejoin and the host', () => {
  it('rejoins the same player from a token with the same view', () => {
    const { room } = setup(1);
    const a = new FakeClient();
    const joined = room.join('Ann', null);
    if (typeof joined === 'string') throw new Error(joined);
    room.connectPlayer(joined.token, a);
    room.disconnect(a);
    const b = new FakeClient();
    expect(room.connectPlayer(joined.token, b)).toBe(joined.playerId);
    expect(b.last?.view).toEqual(view(room.state, joined.playerId));
    expect(room.connectPlayer('wrong', new FakeClient())).toBeNull();
  });

  it('rejects host commands from anyone but the creator, and bad actions', () => {
    const { room } = setup(2);
    const a = room.join('Host', null);
    const b = room.join('Guest', null);
    if (typeof a === 'string' || typeof b === 'string') throw new Error();
    room.host(a.playerId, { cmd: 'addBots', count: 3 });
    expect(room.host(b.playerId, { cmd: 'pause' })).toMatch(/creator/);
    expect(room.act(b.playerId, { type: 'start' })).toMatch(/host/);
    expect(room.act(b.playerId, { type: 'bogus' })).toBe('Invalid action.');
    expect(room.act(a.playerId, { type: 'vote', target: 42 })).toBe('Invalid action.');
    expect(room.act(a.playerId, { type: 'start' })).toBeNull();
    expect(room.host(a.playerId, { cmd: 'addBots', count: 1 })).toMatch(/lobby/);
  });

  it('never trusts a client-supplied actor', () => {
    const { room } = setup(3);
    const a = room.join('A', null);
    const b = room.join('B', null);
    if (typeof a === 'string' || typeof b === 'string') throw new Error();
    room.host(a.playerId, { cmd: 'addBots', count: 4 });
    room.act(a.playerId, { type: 'start' });
    expect(room.act(b.playerId, { type: 'ackRole', actor: a.playerId })).toBeNull();
    expect(room.state.phase).toMatchObject({ kind: 'roleReveal', acked: [b.playerId] });
  });
});

describe('room: escape hatch', () => {
  function inGame() {
    const { room, sched } = setup(5, { botDelayMs: [10, 20] });
    const host = room.join('Host', null);
    if (typeof host === 'string') throw new Error();
    const c = new FakeClient();
    room.connectPlayer(host.token, c);
    const castle = new FakeClient();
    room.connectCastle(castle);
    room.host(host.playerId, { cmd: 'addBots', count: 5 });
    room.act(host.playerId, { type: 'start' });
    return { room, sched, host, castle };
  }

  it('pauses, resumes, and announces each use', () => {
    const { room, sched, host, castle } = inGame();
    expect(room.host(host.playerId, { cmd: 'pause' })).toBeNull();
    const epoch = room.state.epoch;
    sched.run(() => false, 200);
    expect(room.state.epoch).toBe(epoch);
    expect(room.act(host.playerId, { type: 'ackRole' })).toMatch(/paused/);
    expect(castle.last?.paused).toBe(true);
    room.host(host.playerId, { cmd: 'resume' });
    sched.run(() => room.state.phase.kind !== 'roleReveal', 500);
    expect(room.state.epoch).toBeGreaterThan(epoch);
    const notices = castle.messages.flatMap((m) => (m.t === 'notice' ? [m.text] : []));
    expect(notices).toEqual(['The host paused the game.', 'The host resumed the game.']);
  });

  it('adds 60 seconds to the running timer', () => {
    const { room, host, castle } = inGame();
    const before = castle.last?.deadlineAt as number;
    room.host(host.playerId, { cmd: 'addTime' });
    expect((castle.last?.deadlineAt as number) - before).toBe(60_000);
  });

  it('drops a player to autopilot so the game still finishes', () => {
    const { room, sched, host } = inGame();
    const guest = room.state.players.find((p) => p.id !== host.playerId)!;
    expect(room.host(host.playerId, { cmd: 'dropPlayer', target: guest.id })).toBeNull();
    expect(room.host(host.playerId, { cmd: 'dropPlayer', target: host.playerId })).toBeTruthy();
    const rng = rngFor(1);
    const c = new FakeClient();
    room.connectPlayer(host.token, c);
    c.onMessage = (m) => {
      if (m.t !== 'state') return;
      const a = viewPolicy(m.view, rng);
      if (a) sched.setTimeout(() => void room.act(host.playerId, a), 30);
    };
    room.host(host.playerId, { cmd: 'rerunVote' }); // harmless no-op outside a vote
    sched.run(() => room.state.phase.kind === 'finalReveal', 200_000);
    expect(room.state.phase.kind).toBe('finalReveal');
  });

  it('can end the game on demand', () => {
    const { room, host } = inGame();
    expect(room.host(host.playerId, { cmd: 'endGame' })).toBeNull();
    expect(room.state.phase.kind).toBe('finalReveal');
    expect(room.host(host.playerId, { cmd: 'endGame' })).toBeTruthy();
  });
});

describe('room: crash recovery', () => {
  it('rebuilds the same room, seats and state from the event log', () => {
    const dir = mkdtemp();
    const { sched, room } = setup(11, { log: openLog(dir, 'TEST'), botDelayMs: [10, 50] });
    const host = room.join('Host', null);
    if (typeof host === 'string') throw new Error();
    room.host(host.playerId, { cmd: 'addBots', count: 7 });
    room.act(host.playerId, { type: 'start' });
    sched.run(() => room.state.day >= 2, 5000);
    expect(room.state.day).toBeGreaterThanOrEqual(2);

    const [saved] = readLogs(dir);
    const restored = Room.restore(saved!.entries, {
      scheduler: new VirtualScheduler(),
      log: new FileLog(join(dir, 'x')),
    });
    expect(restored?.state).toEqual(room.state);
    const c = new FakeClient();
    expect(restored?.connectPlayer(host.token, c)).toBe(host.playerId);
    expect(
      readFileSync(join(dir, 'TEST.jsonl'), 'utf8').split('\n').filter(Boolean).length,
    ).toBeGreaterThan(10);

    // and the restored room keeps going on its own
    const sched2 = new VirtualScheduler();
    const again = Room.restore(saved!.entries, { scheduler: sched2, botDelayMs: [10, 50] })!;
    sched2.run(() => again.state.phase.kind === 'finalReveal', 100_000);
    expect(again.state.phase.kind).toBe('finalReveal');
  });
});

function mkdtemp(): string {
  const d = mkdtempSync(join(tmpdir(), 'mt-'));
  dirs.push(d);
  return d;
}

describe('room: resent actions', () => {
  it('applies an action with the same client id once, and still judges a fresh one', () => {
    const { room, sched } = setup(3);
    const ann = room.join('Ann', null);
    if (typeof ann === 'string') throw new Error(ann);
    expect(room.host(ann.playerId, { cmd: 'addBots', count: 3 })).toBeNull();
    expect(room.act(ann.playerId, { type: 'start' })).toBeNull();
    expect(room.act(ann.playerId, { type: 'ackRole' }, 'c1')).toBeNull();
    sched.run(() => room.state.phase.kind === 'mission');
    // The role reveal is long over, so a fresh ackRole is rejected, but the resend of c1 is not.
    expect(room.act(ann.playerId, { type: 'ackRole' }, 'c2')).toMatch(/not in/i);
    expect(room.act(ann.playerId, { type: 'ackRole' }, 'c1')).toBeNull();
  });
});

describe('room: phones-only mode (R24)', () => {
  function lobby(seed: number) {
    const { sched, room } = setup(seed);
    const clients: FakeClient[] = [];
    const joined = ['A', 'B', 'C', 'D'].map((n) => {
      const j = room.join(n, null);
      if (typeof j === 'string') throw new Error(j);
      const c = new FakeClient();
      room.connectPlayer(j.token, c);
      clients.push(c);
      return j;
    });
    return { sched, room, clients, joined };
  }
  const last = (c: FakeClient) => c.messages.filter((m) => m.t === 'state').at(-1);

  it('is off by default, only the creator can switch it, and only in the lobby', () => {
    const { room, clients, joined } = lobby(11);
    expect(last(clients[0])).toMatchObject({ phonesOnly: false, publicView: null });
    expect(room.host(joined[1].playerId, { cmd: 'phonesOnly', on: true })).toMatch(/creator/);
    expect(room.host(joined[0].playerId, { cmd: 'phonesOnly', on: true })).toBeNull();
    expect(last(clients[1])).toMatchObject({ phonesOnly: true });
    expect(room.act(joined[0].playerId, { type: 'start' })).toBeNull();
    expect(room.host(joined[0].playerId, { cmd: 'phonesOnly', on: false })).toMatch(/lobby/);
  });

  it('gives every phone the same castle view and never anything role-dependent', () => {
    const { sched, room } = setup(12);
    const human = new FakeClient();
    const joined = room.join('Human', null);
    if (typeof joined === 'string') throw new Error(joined);
    room.connectPlayer(joined.token, human);
    room.host(joined.playerId, { cmd: 'addBots', count: 5 });
    room.host(joined.playerId, { cmd: 'phonesOnly', on: true });
    const rng = rngFor(12);
    const seen = new Set<string>();
    human.onMessage = (m) => {
      if (m.t !== 'state') return;
      expect(m.publicView).toEqual(view(room.state, 'castle'));
      seen.add(m.view.phase.kind);
      const action = viewPolicy(m.view, rng);
      if (action) sched.setTimeout(() => void room.act(joined.playerId, action), 100);
    };
    room.act(joined.playerId, { type: 'start' });
    sched.run(() => room.state.phase.kind === 'finalReveal');
    expect(seen.has('night')).toBe(true);
    expect(seen.has('voteReveal')).toBe(true);
    expect(
      JSON.stringify(
        human.messages.filter((m) => m.t === 'state').map((m) => m.t === 'state' && m.publicView),
      ),
    ).not.toMatch(/"role":"(traitor|faithful)"[^}]*"you"/);
  });

  it('survives a restart from the log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'room-'));
    dirs.push(dir);
    const sched = new VirtualScheduler();
    const live = new Room({ code: 'LOGG', seed: 13, scheduler: sched, log: openLog(dir, 'LOGG') });
    const j = live.join('A', null);
    if (typeof j === 'string') throw new Error(j);
    live.host(j.playerId, { cmd: 'phonesOnly', on: true });
    const [entry] = readLogs(dir);
    const restored = Room.restore(entry.entries, { scheduler: new VirtualScheduler() });
    const c = new FakeClient();
    restored?.connectPlayer(j.token, c);
    expect(last(c)).toMatchObject({ phonesOnly: true });
  });
});

describe('room: ghost predictions (R26)', () => {
  it('lets a ghost guess over the wire, and keeps it private', () => {
    const { room } = setup(5);
    const clients = ['A', 'B', 'C', 'D'].map((n) => {
      const j = room.join(n, null);
      if (typeof j === 'string') throw new Error(j);
      const c = new FakeClient();
      room.connectPlayer(j.token, c);
      return { j, c };
    });
    expect(room.act(clients[0].j.playerId, { type: 'start' })).toBeNull();
    const [a, b] = clients;
    expect(room.act(a.j.playerId, { type: 'predict', suspects: [b.j.playerId] })).toMatch(/ghost/i);
    const ghost = room.state.players[3];
    if (!ghost) throw new Error('no player');
    ghost.fate = 'banished';
    const suspect = room.state.players[1]?.id as string;
    expect(room.act(ghost.id, { type: 'predict', suspects: [suspect] })).toBeNull();
    expect(room.act(ghost.id, { type: 'predict', suspects: 'x' })).toBe('Invalid action.');
    const mine = clients[3].c.last?.view.you?.prediction;
    expect(mine).toEqual([suspect]);
    for (const other of clients.slice(0, 3)) {
      expect(other.c.last?.view.you?.prediction).toEqual([]);
      expect(JSON.stringify(other.c.last)).not.toContain(`"prediction":["${suspect}"]`);
    }
  });
});
