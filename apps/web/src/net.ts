import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, HostCommand, ServerMessage, StateMessage } from '@midnight/engine';

export type Status = 'connecting' | 'open' | 'reconnecting' | 'failed';

export interface Hello {
  name?: string;
  avatar?: string | null;
  /** The token the phone picked for itself, so a join retried after a drop takes no second seat. */
  token?: string;
}

export interface Connection {
  state: StateMessage | null;
  status: Status;
  error: string | null;
  notices: { id: number; text: string }[];
  playerId: string | null;
  /** Seconds-accurate server time, derived from the last message. */
  serverNow: () => number;
  act: (action: Record<string, unknown>) => void;
  host: (command: HostCommand) => void;
}

// A phone that locks usually leaves a socket that still looks open. These keep a rejoin well
// inside the 5 seconds the spec asks for.
const RETRY_MS = [0, 250, 500, 1000, 1500];
const CONNECT_TIMEOUT_MS = 3500;
const PING_EVERY_MS = 4000;
const SILENCE_LIMIT_MS = 9000;
const PROBE_MS = 1200;

// ---------------------------------------------------------------- storage

const memory = new Map<string, string>();

/** localStorage, then sessionStorage, then memory: private tabs must still render. */
export function store(key: string): {
  get: () => string | null;
  set: (v: string) => void;
  del: () => void;
} {
  const areas: Storage[] = [];
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try {
      areas.push(window[name]);
    } catch {
      /* blocked */
    }
  }
  return {
    get: () => {
      for (const a of areas) {
        try {
          const v = a.getItem(key);
          if (v !== null) return v;
        } catch {
          /* try the next one */
        }
      }
      return memory.get(key) ?? null;
    },
    set: (v) => {
      memory.set(key, v);
      for (const a of areas) {
        try {
          a.setItem(key, v);
        } catch {
          /* quota or private mode */
        }
      }
    },
    del: () => {
      memory.delete(key);
      for (const a of areas) {
        try {
          a.removeItem(key);
        } catch {
          /* ignore */
        }
      }
    },
  };
}

const tokenStore = (room: string) => store(`mt:token:${room}`);
const pendingStore = (room: string) => store(`mt:pending:${room}`);

export function readToken(room: string): string | null {
  return tokenStore(room).get();
}

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface PendingJoin {
  name: string;
  avatar: string | null;
  token: string;
}

export function savePending(room: string, p: Omit<PendingJoin, 'token'>): void {
  pendingStore(room).set(JSON.stringify({ ...p, token: newToken() }));
}

export function readPending(room: string): PendingJoin | null {
  try {
    const p = JSON.parse(pendingStore(room).get() ?? 'null') as PendingJoin | null;
    return p && typeof p.token === 'string' ? p : null;
  } catch {
    return null;
  }
}

/** A value that survives a reload, tagged with the phase it belongs to so stale drafts are ignored. */
export function useDraft<T>(
  room: string,
  slot: string,
  epoch: number,
  initial: T,
): [T, (v: T) => void] {
  const s = store(`mt:draft:${room}:${slot}`);
  const read = (): T => {
    try {
      const raw = JSON.parse(s.get() ?? 'null') as { epoch: number; value: T } | null;
      return raw && raw.epoch === epoch ? raw.value : initial;
    } catch {
      return initial;
    }
  };
  const [value, setValue] = useState<T>(read);
  const last = useRef(epoch);
  if (last.current !== epoch) {
    last.current = epoch;
    setValue(read());
  }
  const set = (v: T) => {
    setValue(v);
    s.set(JSON.stringify({ epoch, value: v }));
  };
  return [value, set];
}

/** The origin a phone should scan: the tunnel's address, not the laptop's localhost. */
export function usePublicOrigin(): string {
  const [origin, setOrigin] = useState(location.origin);
  useEffect(() => {
    let live = true;
    fetch('/api/config')
      .then((r) => r.json() as Promise<{ publicUrl?: string }>)
      .then((c) => {
        // Only trust it if the page was opened on a private/local address. A guest on the public
        // URL already has the right origin.
        if (
          live &&
          c.publicUrl &&
          /^(localhost|127\.|10\.|192\.168\.|\[::1\])/.test(location.hostname)
        )
          setOrigin(c.publicUrl);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return origin;
}

// ---------------------------------------------------------------- connection

export function useGame(room: string, kind: 'castle' | 'player', hello: Hello = {}): Connection {
  const [state, setState] = useState<StateMessage | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<{ id: number; text: string }[]>([]);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const offset = useRef(0);
  const helloRef = useRef(hello);
  helloRef.current = hello;
  const noticeId = useRef(0);
  /** Actions sent or queued but not yet acked by the server, resent after every reconnect. */
  const unacked = useRef(new Map<string, ClientMessage>());
  const resent = useRef(new Set<string>());
  const probe = useRef<() => void>(() => {});

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let timers: ReturnType<typeof setInterval>[] = [];
    let probeTimer: ReturnType<typeof setTimeout> | undefined;
    let fails = 0;
    let lastRx = Date.now();

    const stopTimers = () => {
      timers.forEach(clearInterval);
      timers = [];
      clearTimeout(probeTimer);
    };

    const flush = (socket: WebSocket) => {
      for (const [cid, m] of unacked.current) {
        resent.current.add(cid);
        socket.send(JSON.stringify(m));
      }
    };

    /** Abandon the current socket without waiting for the browser to notice it is dead. */
    const drop = (delay: number) => {
      const old = ws.current;
      ws.current = null;
      stopTimers();
      if (old) {
        old.onopen = old.onmessage = old.onclose = old.onerror = null;
        try {
          old.close();
        } catch {
          /* already gone */
        }
      }
      if (closed) return;
      setStatus((s) => (s === 'connecting' ? s : 'reconnecting'));
      clearTimeout(retry);
      retry = setTimeout(connect, delay);
    };

    const connect = () => {
      if (closed) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${proto}//${location.host}/ws`);
      ws.current = socket;
      lastRx = Date.now();
      const stuck = setTimeout(() => {
        if (ws.current === socket && socket.readyState !== WebSocket.OPEN) {
          fails++;
          drop(RETRY_MS[Math.min(fails, RETRY_MS.length - 1)] as number);
        }
      }, CONNECT_TIMEOUT_MS);
      socket.onopen = () => {
        clearTimeout(stuck);
        const h = helloRef.current;
        const msg: ClientMessage =
          kind === 'castle'
            ? { t: 'hello', room, kind: 'castle' }
            : {
                t: 'hello',
                room,
                kind: 'player',
                token: readToken(room) ?? h.token,
                name: readToken(room) ? undefined : h.name,
                avatar: readToken(room) ? null : (h.avatar ?? null),
              };
        socket.send(JSON.stringify(msg));
        flush(socket);
        timers.push(
          setInterval(() => socket.send(JSON.stringify({ t: 'ping' })), PING_EVERY_MS),
          setInterval(() => {
            if (Date.now() - lastRx > SILENCE_LIMIT_MS) drop(0);
          }, 2000),
        );
      };
      socket.onmessage = (ev) => {
        lastRx = Date.now();
        const m = JSON.parse(String(ev.data)) as ServerMessage;
        if (m.t === 'welcome') {
          fails = 0;
          setPlayerId(m.playerId);
          if (m.token) {
            tokenStore(room).set(m.token);
            pendingStore(room).del(); // seated: later reconnects are rejoins, not joins
          }
        } else if (m.t === 'state') {
          offset.current = m.now - Date.now();
          setState(m);
          setStatus('open');
          setError(null);
        } else if (m.t === 'ack') {
          unacked.current.delete(m.cid);
          resent.current.delete(m.cid);
        } else if (m.t === 'notice') {
          const id = ++noticeId.current;
          setNotices((n) => [...n.slice(-3), { id, text: m.text }]);
          setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 6000);
        } else if (m.t === 'error') {
          // A resent action may be stale by now (the phase moved on); that is not worth showing.
          if (m.cid && resent.current.has(m.cid)) return;
          setError(m.message);
          if (m.fatal) {
            closed = true;
            stopTimers();
            setStatus('failed');
            if (/seat is gone/i.test(m.message)) tokenStore(room).del();
          }
        }
      };
      socket.onclose = () => {
        clearTimeout(stuck);
        if (ws.current !== socket) return;
        fails++;
        drop(RETRY_MS[Math.min(fails, RETRY_MS.length - 1)] as number);
      };
      socket.onerror = () => socket.close();
    };

    // On wake-up the socket usually still claims to be open. Ask it a question; if it does not
    // answer quickly, replace it instead of waiting for TCP to give up.
    probe.current = () => {
      if (closed) return;
      const socket = ws.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return drop(0);
      const asked = Date.now();
      clearTimeout(probeTimer);
      socket.send(JSON.stringify({ t: 'ping' }));
      probeTimer = setTimeout(() => {
        if (lastRx < asked) drop(0);
      }, PROBE_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') probe.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    window.addEventListener('online', onVisible);
    window.addEventListener('focus', onVisible);

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      stopTimers();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
      window.removeEventListener('online', onVisible);
      window.removeEventListener('focus', onVisible);
      const old = ws.current;
      ws.current = null;
      if (old) {
        old.onopen = old.onmessage = old.onclose = old.onerror = null;
        old.close();
      }
    };
  }, [room, kind]);

  const act = useCallback((action: Record<string, unknown>) => {
    const cid = newToken().slice(0, 12);
    const msg: ClientMessage = { t: 'act', action, cid };
    unacked.current.set(cid, msg);
    if (unacked.current.size > 20) {
      const oldest = unacked.current.keys().next().value;
      if (oldest) unacked.current.delete(oldest);
    }
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg));
    else probe.current();
  }, []);
  const host = useCallback((command: HostCommand) => {
    // Host commands are not idempotent (add 60 seconds twice is not the same), so never queue them.
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ t: 'host', command } satisfies ClientMessage));
    } else setError('Not connected yet. Try again in a moment.');
  }, []);
  return {
    state,
    status,
    error,
    notices,
    playerId,
    serverNow: () => Date.now() + offset.current,
    act,
    host,
  };
}
