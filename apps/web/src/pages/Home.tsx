import { useState } from 'react';
import { go } from '../ui';
import { HoodedFigure, Ornament } from '../scenes';

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
    <main className="page center paper-page">
      <HoodedFigure size={110} />
      <h1 className="title">Midnight Table</h1>
      <Ornament />
      <p className="tagline">Trust no one. Four to sixteen friends. One of you is lying.</p>
      <button className="primary" onClick={create} disabled={busy}>
        Open the castle doors
      </button>
      <div className="row">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
          placeholder="CASTLE CODE"
          maxLength={4}
          autoCapitalize="characters"
        />
        <button onClick={join} disabled={code.length !== 4}>
          Enter
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
