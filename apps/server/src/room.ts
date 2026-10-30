import { randomBytes } from 'node:crypto';
import {
  apply,
  createGame,
  createRng,
  narrate,
  pendingActors,
  timerMs,
  view,
  type Action,
  type ConfigOverrides,
  type GameEvent,
  type GameState,
  type HostCommand,
  type PlayerId,
  type Rng,
  type ServerMessage,
} from '@midnight/engine';
import { botAction, noteAction } from '@midnight/sim';
import { parsePlayerAction } from './actions';
import { nullLog, type LogEntry, type RoomLog } from './log';
import type { Scheduler, TimerHandle } from './scheduler';

export interface Client {
  send(msg: ServerMessage): void;
  close(): void;
}

interface Seat {
  playerId: PlayerId;
  token: string;
  bot: boolean;
  /** A dropped human: the server plays defaults for them from now on. */
  autopilot: boolean;
  clients: Set<Client>;
  /** Recent client action ids, so a resent action is applied once. */
  seenCids: string[];
}

export interface RoomOptions {
  code: string;
  seed: number;
  config?: ConfigOverrides;
  scheduler: Scheduler;
  log?: RoomLog;
  /** Shrinks every timer, for demos and tests. 1 is real time. */
  timeScale?: number;
  botDelayMs?: [number, number];
}

const BOT_NAMES = [
  'Ada',
  'Bram',
  'Cleo',
  'Dax',
  'Edie',
  'Finn',
  'Gwen',
  'Hugo',
  'Iris',
  'Jude',
  'Kit',
  'Lena',
  'Milo',
  'Nora',
  'Otis',
  'Pia',
];
const ADD_TIME_MS = 60_000;

export class Room {
  readonly code: string;
  state: GameState;
  private seats = new Map<PlayerId, Seat>();
  private tokens = new Map<string, PlayerId>();
  private castles = new Set<Client>();
  private clientSeat = new Map<Client, PlayerId>();
  private sched: Scheduler;
  private log: RoomLog;
  private timeScale: number;
  private botDelay: [number, number];
  private botRng: Rng;
  private timer: TimerHandle | null = null;
  private timerEpoch = -1;
  private deadlineAt: number | null = null;
  private remainingMs: number | null = null;
  private paused = false;
  private botQueued = new Set<string>();
  private replaying = false;
  lastActivity: number;

  constructor(opts: RoomOptions) {
    this.code = opts.code;
    this.sched = opts.scheduler;
    this.log = opts.log ?? nullLog;
    this.timeScale = opts.timeScale ?? 1;
    this.botDelay = opts.botDelayMs ?? [400, 2500];
    this.botRng = createRng(opts.seed ^ 0x51ed270b);
    this.state = createGame({ seed: opts.seed, config: opts.config });
    this.lastActivity = this.sched.now();
    this.log.append({
      k: 'create',
      code: opts.code,
      seed: opts.seed,
      config: opts.config,
      ts: this.sched.now(),
    });
  }

  /** Rebuilds a room from its log. Timers restart from the top of the current step. */
  static restore(
    entries: LogEntry[],
    deps: Omit<RoomOptions, 'code' | 'seed' | 'config'>,
  ): Room | null {
    const first = entries[0];
    if (!first || first.k !== 'create') return null;
    const room = new Room({
      ...deps,
      code: first.code,
      seed: first.seed,
      config: first.config,
      log: nullLog,
    });
    room.replaying = true;
    for (const e of entries.slice(1)) {
      if (e.k === 'seat') room.addSeat(e.playerId, e.token, e.bot);
      else if (e.k === 'autopilot') {
        const seat = room.seats.get(e.playerId);
        if (seat) seat.autopilot = true;
      } else if (e.k === 'act') {
        const res = apply(room.state, e.action);
        if (!res.error) room.state = res.state;
      }
    }
    room.replaying = false;
    room.log = deps.log ?? nullLog;
    room.armTimer();
    room.scheduleBots();
    return room;
  }

  // ------------------------------------------------------------ seats and sockets

  private addSeat(playerId: PlayerId, token: string, bot: boolean): Seat {
    const seat: Seat = { playerId, token, bot, autopilot: false, clients: new Set(), seenCids: [] };
    this.seats.set(playerId, seat);
    this.tokens.set(token, playerId);
    return seat;
  }

  /** A new human joins the lobby. */
  join(
    name: string,
    avatar: string | null,
    token?: string,
  ): { playerId: PlayerId; token: string } | string {
    return this.seat(name, avatar, false, token);
  }

  private seat(name: string, avatar: string | null, bot: boolean, wanted?: string) {
    const playerId = randomBytes(4).toString('hex');
    const token = wanted && !this.tokens.has(wanted) ? wanted : randomBytes(16).toString('hex');
    const res = this.tryApply({ type: 'join', id: playerId, name, avatar });
    if (res) return res;
    this.addSeat(playerId, token, bot);
    this.log.append({ k: 'seat', playerId, token, bot });
    this.broadcast([]);
    return { playerId, token };
  }

  connectCastle(client: Client): void {
    this.castles.add(client);
    this.sendState(client, null, []);
  }

  connectPlayer(token: string, client: Client): PlayerId | null {
    const id = this.tokens.get(token);
    const seat = id ? this.seats.get(id) : undefined;
    if (!seat) return null;
    seat.clients.add(client);
    this.clientSeat.set(client, seat.playerId);
    if (seat.autopilot) {
      seat.autopilot = false; // the player is back
    }
    this.sendState(client, seat.playerId, []);
    return seat.playerId;
  }

  disconnect(client: Client): void {
    this.castles.delete(client);
    const id = this.clientSeat.get(client);
    this.clientSeat.delete(client);
    if (id) this.seats.get(id)?.clients.delete(client);
  }

  get isEmpty(): boolean {
    return this.castles.size === 0 && [...this.seats.values()].every((s) => s.clients.size === 0);
  }

  // ------------------------------------------------------------ commands

  act(playerId: PlayerId, raw: Record<string, unknown>, cid?: string): string | null {
    const seat = this.seats.get(playerId);
    if (cid && seat?.seenCids.includes(cid)) return null; // a resend of something already applied
    if (this.paused) return 'The game is paused.';
    const action = parsePlayerAction(raw, playerId);
    if (!action) return 'Invalid action.';
    const err = this.tryApply(action);
    if (!err && cid && seat) {
      seat.seenCids.push(cid);
      if (seat.seenCids.length > 64) seat.seenCids.shift();
    }
    return err;
  }

  host(playerId: PlayerId, command: HostCommand): string | null {
    if (playerId !== this.state.hostId) return 'Only the room creator can do that.';
    const inLobby = this.state.phase.kind === 'lobby';
    switch (command.cmd) {
      case 'pause':
        if (this.paused || inLobby) return 'Nothing to pause.';
        this.remainingMs =
          this.deadlineAt === null ? null : Math.max(0, this.deadlineAt - this.sched.now());
        this.paused = true;
        this.timer?.cancel();
        this.timer = null;
        this.deadlineAt = null;
        return this.announce('The host paused the game.');
      case 'resume':
        if (!this.paused) return 'Not paused.';
        this.paused = false;
        this.armTimer(this.remainingMs ?? undefined);
        this.scheduleBots();
        return this.announce('The host resumed the game.');
      case 'addTime': {
        if (this.paused || this.deadlineAt === null) return 'No running timer.';
        const left = Math.max(0, this.deadlineAt - this.sched.now()) + ADD_TIME_MS;
        this.armTimer(left);
        return this.announce('The host added 60 seconds.');
      }
      case 'rerunVote': {
        const err = this.tryApply({ type: 'rerunVote' });
        return err ?? this.announce('The host re-ran the vote. Ballots are cleared.');
      }
      case 'endGame': {
        const err = this.tryApply({ type: 'endGame' });
        return err ?? this.announce('The host ended the game.');
      }
      case 'dropPlayer': {
        const seat = this.seats.get(command.target);
        if (!seat || seat.playerId === playerId) return 'Cannot drop that player.';
        if (inLobby) {
          const err = this.tryApply({ type: 'leave', actor: seat.playerId });
          if (err) return err;
          this.seats.delete(seat.playerId);
          this.tokens.delete(seat.token);
        } else {
          seat.autopilot = true;
          this.log.append({ k: 'autopilot', playerId: seat.playerId });
          for (const c of [...seat.clients]) c.close();
          this.scheduleBots();
        }
        const name = this.state.players.find((p) => p.id === command.target)?.name ?? 'A player';
        return this.announce(`The host dropped ${name}.`);
      }
      case 'addBots': {
        if (!inLobby) return 'Bots can only join in the lobby.';
        const used = new Set(this.state.players.map((p) => p.name));
        const free = BOT_NAMES.filter((n) => !used.has(`${n} (bot)`));
        for (let i = 0; i < Math.min(16, Math.max(0, Math.floor(command.count))); i++) {
          const name = free[i];
          if (!name) break;
          const res = this.seat(`${name} (bot)`, null, true);
          if (typeof res === 'string') return res;
        }
        return null;
      }
    }
  }

  private announce(text: string): null {
    this.everyone({ t: 'notice', text });
    this.broadcast([]);
    return null;
  }

  // ------------------------------------------------------------ engine loop

  private tryApply(action: Action): string | null {
    let res;
    try {
      res = apply(this.state, action);
    } catch {
      return 'Internal error.';
    }
    if (res.error) return res.error;
    this.log.append({ k: 'act', action });
    this.lastActivity = this.sched.now();
    this.state = res.state;
    this.armTimer();
    this.broadcast(res.events);
    this.scheduleBots();
    return null;
  }

  private armTimer(overrideMs?: number): void {
    if (this.replaying) return;
    if (this.timerEpoch === this.state.epoch && overrideMs === undefined && this.timer) return;
    this.timer?.cancel();
    this.timer = null;
    this.deadlineAt = null;
    this.timerEpoch = this.state.epoch;
    const base = timerMs(this.state);
    if (base === null || this.paused) return;
    const ms = overrideMs ?? Math.round(base * this.timeScale);
    const epoch = this.state.epoch;
    this.deadlineAt = this.sched.now() + ms;
    this.timer = this.sched.setTimeout(() => {
      if (this.paused || this.state.epoch !== epoch) return;
      this.tryApply({ type: 'timeout', epoch });
    }, ms);
    if (overrideMs !== undefined) this.broadcast([]);
  }

  private scheduleBots(): void {
    if (this.replaying || this.paused) return;
    const s = this.state;
    const humansPlaying = [...this.seats.values()].some((x) => !x.bot && !x.autopilot);
    for (const id of pendingActors(s)) {
      const seat = this.seats.get(id);
      if (!seat || !(seat.bot || seat.autopilot)) continue;
      // With real people at the table, bots leave the "ready to vote" call to the timer and humans.
      if (s.phase.kind === 'discussion' && humansPlaying) continue;
      const key = `${s.epoch}:${id}`;
      if (this.botQueued.has(key)) continue;
      this.botQueued.add(key);
      const [lo, hi] = this.botDelay;
      const delay = Math.round(lo + this.botRng.next() * (hi - lo));
      this.sched.setTimeout(() => this.botAct(id, s.epoch), delay);
    }
    if (this.botQueued.size > 500) {
      const keep = [...this.botQueued].slice(-100);
      this.botQueued = new Set(keep);
    }
  }

  private botAct(id: PlayerId, epoch: number): void {
    if (this.paused || this.state.epoch !== epoch) return;
    if (!pendingActors(this.state).includes(id)) return;
    if (this.state.phase.kind === 'night' && this.botRng.next() < 0.5) {
      this.tryApply(noteAction(id, this.botRng));
    }
    const action = botAction(this.state, id, this.botRng);
    if (action) this.tryApply(action);
  }

  // ------------------------------------------------------------ output

  private everyone(msg: ServerMessage): void {
    for (const c of this.castles) c.send(msg);
    for (const seat of this.seats.values()) for (const c of seat.clients) c.send(msg);
  }

  private sendState(client: Client, playerId: PlayerId | null, events: GameEvent[]): void {
    const castleView = view(this.state, 'castle');
    client.send({
      t: 'state',
      view: playerId === null ? castleView : view(this.state, playerId),
      narration: narrate(castleView),
      now: this.sched.now(),
      deadlineAt: this.deadlineAt,
      paused: this.paused,
      hostId: this.state.hostId,
      isHost: playerId !== null && playerId === this.state.hostId,
      events: playerId === null ? events.filter((e) => e.audience === 'public') : [],
    });
  }

  private broadcast(events: GameEvent[]): void {
    for (const c of this.castles) this.sendState(c, null, events);
    for (const seat of this.seats.values()) {
      for (const c of seat.clients) this.sendState(c, seat.playerId, []);
    }
  }
}
