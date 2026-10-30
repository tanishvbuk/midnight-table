import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, HostCommand, ServerMessage, StateMessage } from '@midnight/engine';

export type Status = 'connecting' | 'open' | 'reconnecting' | 'failed';

export interface Hello {
  name?: string;
  avatar?: string | null;
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

const tokenKey = (room: string) => `mt:token:${room}`;

export function readToken(room: string): string | null {
  try {
    return localStorage.getItem(tokenKey(room));
  } catch {
    return null;
  }
}

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

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${proto}//${location.host}/ws`);
      ws.current = socket;
      socket.onopen = () => {
        setStatus('open');
        const msg: ClientMessage =
          kind === 'castle'
            ? { t: 'hello', room, kind: 'castle' }
            : {
                t: 'hello',
                room,
                kind: 'player',
                token: readToken(room) ?? undefined,
                name: helloRef.current.name,
                avatar: helloRef.current.avatar ?? null,
              };
        socket.send(JSON.stringify(msg));
        ping = setInterval(() => socket.send(JSON.stringify({ t: 'ping' })), 20_000);
      };
      socket.onmessage = (ev) => {
        const m = JSON.parse(String(ev.data)) as ServerMessage;
        if (m.t === 'welcome') {
          setPlayerId(m.playerId);
          if (m.token) {
            try {
              localStorage.setItem(tokenKey(room), m.token);
            } catch {
              /* private mode: rejoin by token won't survive a refresh */
            }
          }
        } else if (m.t === 'state') {
          offset.current = m.now - Date.now();
          setState(m);
          setError(null);
        } else if (m.t === 'notice') {
          const id = ++noticeId.current;
          setNotices((n) => [...n.slice(-3), { id, text: m.text }]);
          setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 6000);
        } else if (m.t === 'error') {
          setError(m.message);
          if (m.fatal) {
            closed = true;
            setStatus('failed');
            if (/seat is gone/i.test(m.message)) {
              try {
                localStorage.removeItem(tokenKey(room));
              } catch {
                /* ignore */
              }
            }
          }
        }
      };
      socket.onclose = () => {
        clearInterval(ping);
        if (closed) return;
        setStatus('reconnecting');
        retry = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(ping);
      ws.current?.close();
    };
  }, [room, kind]);

  const send = useCallback((m: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m));
  }, []);
  return {
    state,
    status,
    error,
    notices,
    playerId,
    serverNow: () => Date.now() + offset.current,
    act: (action) => send({ t: 'act', action }),
    host: (command) => send({ t: 'host', command }),
  };
}
