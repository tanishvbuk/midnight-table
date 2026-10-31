import type { ClientMessage, HostCommand, ServerMessage, StateMessage } from '@midnight/engine';

export type Status = 'connecting' | 'open' | 'reconnecting' | 'failed';

export interface Hello {
  name?: string;
  avatar?: string | null;
}

/** Method-style parameter bivariance, so both DOM and `ws` sockets fit `SocketLike`. */
type Handler<E> = { bivarianceHack(ev: E): void }['bivarianceHack'];

/** The slice of the WebSocket API we use, so tests can run this against `ws` or a fake. */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: Handler<unknown> | null;
  onmessage: Handler<{ data: unknown }> | null;
  onclose: Handler<unknown> | null;
  onerror: Handler<unknown> | null;
}

export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface ClientEnv {
  url: string;
  WebSocket: new (url: string) => SocketLike;
  storage: KeyValue;
  now?: () => number;
}

/** Wait before reconnect attempt n (0-based). The first retry is fast: a phone that just woke up. */
export const RETRY_MS = [150, 400, 800, 1500];
/** After an unlock or network change, a socket that does not answer a ping in this time is dead. */
export const WAKE_PROBE_MS = 1200;
const HEARTBEAT_MS = 4_000;
/** A ping, or an action we sent, must be answered within this or the socket is replaced. */
const ANSWER_MS = 2_500;
const QUEUE_MAX = 5;
const QUEUE_TTL_MS = 30_000;
const OPEN = 1;

export const tokenKey = (room: string) => `mt:token:${room}`;

/**
 * One device's connection to a room. Framework-free so the reconnect rules (R3) can be tested
 * against a real server. The seat survives on the server; this class only has to get back to it
 * quickly and say nothing wrong while it does.
 */
export class GameClient {
  state: StateMessage | null = null;
  status: Status = 'connecting';
  error: string | null = null;
  notices: { id: number; text: string }[] = [];
  playerId: string | null = null;
  /** Called whenever anything above changes. */
  onChange: () => void = () => {};

  private socket: SocketLike | null = null;
  private stopped = false;
  private attempt = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private probe: ReturnType<typeof setTimeout> | undefined;
  private lastHeard = 0;
  private offset = 0;
  private noticeId = 0;
  private queue: { at: number; action: Record<string, unknown> }[] = [];
  /** Actions sent but not yet followed by any server reply. If the socket was dead, they are lost. */
  private inflight: { at: number; action: Record<string, unknown> }[] = [];
  private connections = 0;

  constructor(
    readonly room: string,
    readonly kind: 'castle' | 'player',
    private getHello: () => Hello,
    private env: ClientEnv,
  ) {}

  private now(): number {
    return this.env.now ? this.env.now() : Date.now();
  }

  /** Number of sockets opened so far, for tests. */
  get connectionCount(): number {
    return this.connections;
  }

  serverNow = (): number => this.now() + this.offset;

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retry);
    clearTimeout(this.probe);
    this.probe = undefined;
    clearInterval(this.heartbeat);
    this.detach();
  }

  act = (action: Record<string, unknown>): void => {
    const at = this.now();
    if (this.socket?.readyState === OPEN && this.state) {
      this.send({ t: 'act', action });
      this.inflight.push({ at, action });
      this.armProbe(ANSWER_MS);
      return;
    }
    this.enqueue({ at, action });
  };

  private enqueue(item: { at: number; action: Record<string, unknown> }): void {
    // Offline: keep the latest action of each kind and send it once the seat is back.
    this.queue = this.queue.filter(
      (q) => q.action.type !== item.action.type && item.at - q.at < QUEUE_TTL_MS,
    );
    this.queue.push(item);
    if (this.queue.length > QUEUE_MAX) this.queue.shift();
  }

  host = (command: HostCommand): void => this.send({ t: 'host', command });

  /**
   * The page became visible, the network came back, or the browser restored the page from its
   * back/forward cache. A locked phone often leaves a socket that looks open but is dead, so we
   * ping and give it a moment to answer before replacing it.
   */
  wake(): void {
    if (this.stopped || this.status === 'failed') return;
    const s = this.socket;
    if (!s || s.readyState !== OPEN) return this.reconnectNow();
    this.send({ t: 'ping' });
    this.armProbe(WAKE_PROBE_MS);
  }

  // ------------------------------------------------------------------ internals

  private changed(): void {
    this.onChange();
  }

  /** If nothing at all is heard from the server before the deadline, the socket is dead. */
  private armProbe(ms: number): void {
    if (this.probe) return;
    const heard = this.lastHeard;
    this.probe = setTimeout(() => {
      this.probe = undefined;
      if (this.lastHeard === heard) this.reconnectNow();
    }, ms);
  }

  private requeueInflight(): void {
    const at = this.now();
    for (const i of this.inflight) if (at - i.at < ANSWER_MS * 4) this.enqueue(i);
    this.inflight = [];
  }

  private send(m: ClientMessage): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(m));
  }

  private detach(): void {
    const s = this.socket;
    this.socket = null;
    if (!s) return;
    s.onopen = s.onmessage = s.onclose = s.onerror = null;
    try {
      s.close();
    } catch {
      /* already gone */
    }
  }

  private reconnectNow(): void {
    clearTimeout(this.retry);
    clearTimeout(this.probe);
    this.probe = undefined;
    clearInterval(this.heartbeat);
    this.requeueInflight();
    this.detach();
    this.attempt = 0;
    this.connect();
  }

  private connect(): void {
    if (this.stopped) return;
    this.status = this.state
      ? 'reconnecting'
      : this.connections === 0
        ? 'connecting'
        : 'reconnecting';
    this.changed();
    this.connections++;
    const socket = new this.env.WebSocket(this.env.url);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.lastHeard = this.now();
      this.send(this.hello());
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        this.send({ t: 'ping' });
        this.armProbe(ANSWER_MS);
      }, HEARTBEAT_MS);
    };
    socket.onmessage = (ev) => {
      if (this.socket !== socket) return;
      this.lastHeard = this.now();
      clearTimeout(this.probe);
      this.probe = undefined;
      this.handle(JSON.parse(String(ev.data)) as ServerMessage);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      clearInterval(this.heartbeat);
      clearTimeout(this.probe);
      this.probe = undefined;
      this.requeueInflight();
      if (this.stopped || this.status === 'failed') return;
      this.status = 'reconnecting';
      this.changed();
      const wait = RETRY_MS[Math.min(this.attempt++, RETRY_MS.length - 1)] as number;
      this.retry = setTimeout(() => this.connect(), wait);
    };
    socket.onerror = () => {
      /* onclose follows */
    };
  }

  private hello(): ClientMessage {
    if (this.kind === 'castle') return { t: 'hello', room: this.room, kind: 'castle' };
    const h = this.getHello();
    return {
      t: 'hello',
      room: this.room,
      kind: 'player',
      token: this.env.storage.get(tokenKey(this.room)) ?? undefined,
      name: h.name,
      avatar: h.avatar ?? null,
    };
  }

  private handle(m: ServerMessage): void {
    if (m.t === 'welcome') {
      this.playerId = m.playerId;
      if (m.token) this.env.storage.set(tokenKey(this.room), m.token);
    } else if (m.t === 'state') {
      this.offset = m.now - this.now();
      this.state = m;
      this.inflight = [];
      this.error = null;
      this.attempt = 0;
      this.status = 'open';
      this.flushQueue();
      this.changed();
    } else if (m.t === 'notice') {
      const id = ++this.noticeId;
      this.notices = [...this.notices.slice(-3), { id, text: m.text }];
      setTimeout(() => {
        this.notices = this.notices.filter((x) => x.id !== id);
        this.changed();
      }, 6000);
      this.changed();
    } else if (m.t === 'error') {
      this.error = m.message;
      this.inflight = [];
      if (m.fatal) {
        this.status = 'failed';
        if (/seat is gone/i.test(m.message)) this.env.storage.remove(tokenKey(this.room));
        this.detach();
      }
      this.changed();
    }
  }

  private flushQueue(): void {
    if (this.queue.length === 0) return;
    const at = this.now();
    const fresh = this.queue.filter((q) => at - q.at < QUEUE_TTL_MS);
    this.queue = [];
    for (const q of fresh) this.send({ t: 'act', action: q.action });
  }
}
