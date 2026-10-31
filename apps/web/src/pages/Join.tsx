import { useEffect, useState } from 'react';
import { AVATARS } from '@midnight/engine';
import { readToken } from '../net';
import { go } from '../ui';

interface RoomInfo {
  exists: boolean;
  started: boolean;
  players: number;
  taken: string[];
}

export function Join({ code }: { code: string }) {
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (readToken(code)) go(`/play/${code}`); // already seated: straight back in
  }, [code]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/rooms/${code}`)
        .then((r) => (r.ok ? (r.json() as Promise<RoomInfo>) : null))
        .then((i) => {
          if (!alive) return;
          if (!i) return setError('No room with that code.');
          setInfo(i);
          // Start on a free emoji, and move off it if somebody else takes it first.
          setAvatar((cur) => {
            const free = AVATARS.filter((a) => !i.taken.includes(a));
            if (cur && free.includes(cur)) return cur;
            return free[Math.floor(Math.random() * free.length)] ?? null;
          });
        })
        .catch(() => alive && setError('Could not reach the server.'));
    void load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [code]);

  const enter = () => {
    try {
      sessionStorage.setItem(`mt:pending:${code}`, JSON.stringify({ name: name.trim(), avatar }));
    } catch {
      return setError('Your browser blocked storage; try a normal tab.');
    }
    go(`/play/${code}`);
  };

  const started = info?.started ?? false;
  return (
    <main className="page center">
      <h1 className="title">Room {code}</h1>
      <input
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 20))}
        placeholder="Your name"
        autoFocus
      />
      <div className="avatar-pick" role="radiogroup" aria-label="Choose your emoji">
        {AVATARS.map((a) => {
          const taken = info?.taken.includes(a) ?? false;
          return (
            <button
              key={a}
              role="radio"
              aria-checked={avatar === a}
              aria-label={a}
              className={`avatar ${avatar === a ? 'selected' : ''}`}
              disabled={taken}
              onClick={() => setAvatar(a)}
            >
              {a}
            </button>
          );
        })}
      </div>
      {started ? (
        <p className="error">This game has already started.</p>
      ) : (
        <button className="primary" onClick={enter} disabled={name.trim().length === 0}>
          Take a seat
        </button>
      )}
      <a
        href={`/castle/${code}`}
        className="muted"
        onClick={(e) => (e.preventDefault(), go(`/castle/${code}`))}
      >
        Open this device as the castle screen instead
      </a>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
