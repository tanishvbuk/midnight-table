import { useEffect, useState } from 'react';
import { readToken } from '../net';
import { go, resizeImage } from '../ui';
import { Ornament } from '../scenes';

export function Join({ code }: { code: string }) {
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (readToken(code)) go(`/play/${code}`); // already seated: straight back in
  }, [code]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setAvatar(await resizeImage(file));
    } catch {
      setError('Could not read that photo.');
    }
  };
  const enter = () => {
    try {
      sessionStorage.setItem(`mt:pending:${code}`, JSON.stringify({ name: name.trim(), avatar }));
    } catch {
      return setError('Your browser blocked storage; try a normal tab.');
    }
    go(`/play/${code}`);
  };

  return (
    <main className="page center">
      <h1 className="title">Castle {code}</h1>
      <Ornament />
      <input
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 20))}
        placeholder="Your name, Faithful"
        autoFocus
      />
      <label className="selfie">
        {avatar ? (
          <img src={avatar} alt="Your portrait" />
        ) : (
          <span>Add your portrait (optional)</span>
        )}
        <input
          type="file"
          accept="image/*"
          capture="user"
          hidden
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </label>
      <button className="primary" onClick={enter} disabled={name.trim().length === 0}>
        Take your seat
      </button>
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
