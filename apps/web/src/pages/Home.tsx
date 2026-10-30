import { useState } from 'react';
import { go } from '../ui';

export function Home() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      const { code: c } = (await res.json()) as { code: string };
      go(`/join/${c}`);
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  };
  const join = async () => {
    const c = code.trim().toUpperCase();
    const res = await fetch(`/api/rooms/${c}`).catch(() => null);
    if (!res || !res.ok) return setError('No room with that code.');
    go(`/join/${c}`);
  };

  return (
    <main className="page center">
      <h1 className="title">Midnight Table</h1>
      <p className="muted">A game of trust and betrayal for 4–16 friends. Everyone plays.</p>
      <button className="primary" onClick={create} disabled={busy}>
        Create a room
      </button>
      <div className="row">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
          placeholder="ROOM CODE"
          maxLength={4}
          autoCapitalize="characters"
        />
        <button onClick={join} disabled={code.length !== 4}>
          Join
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
