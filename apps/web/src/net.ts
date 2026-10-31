import { useEffect, useReducer, useRef } from 'react';
import type { HostCommand, StateMessage } from '@midnight/engine';
import { GameClient, tokenKey, type Hello, type KeyValue, type Status } from './client';

export type { Hello, Status };

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

const storage: KeyValue = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: rejoin by token won't survive a refresh */
    }
  },
  remove: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

export function readToken(room: string): string | null {
  return storage.get(tokenKey(room));
}

export function useGame(room: string, kind: 'castle' | 'player', hello: Hello = {}): Connection {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const client = useRef<GameClient | null>(null);
  const helloRef = useRef(hello);
  helloRef.current = hello;

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const c = new GameClient(room, kind, () => helloRef.current, {
      url: `${proto}//${location.host}/ws`,
      WebSocket,
      storage,
    });
    c.onChange = rerender;
    client.current = c;
    c.start();
    // A locked or backgrounded phone, a Wi-Fi hop or a bfcache restore all end here.
    const wake = () => {
      if (document.visibilityState !== 'hidden') c.wake();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('pageshow', wake);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('pageshow', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      c.stop();
      client.current = null;
    };
  }, [room, kind]);

  const c = client.current;
  return {
    state: c?.state ?? null,
    status: c?.status ?? 'connecting',
    error: c?.error ?? null,
    notices: c?.notices ?? [],
    playerId: c?.playerId ?? null,
    serverNow: () => c?.serverNow() ?? Date.now(),
    act: (a) => client.current?.act(a),
    host: (cmd) => client.current?.host(cmd),
  };
}
