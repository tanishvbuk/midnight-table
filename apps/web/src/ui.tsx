import { useEffect, useState, type ReactNode } from 'react';
import type { PublicPlayer } from '@midnight/engine';
import type { Connection } from './net';

export function hue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function Portrait({
  p,
  size = 56,
  badge,
}: {
  p: PublicPlayer;
  size?: number;
  badge?: ReactNode;
}) {
  const dead = p.fate !== 'alive';
  return (
    <div className="portrait-wrap" style={{ width: size, height: size }}>
      <div className={`portrait ${dead ? 'dead' : ''}`}>
        {p.avatar ? (
          <span className="emoji" style={{ fontSize: size * 0.56 }}>
            {p.avatar}
          </span>
        ) : (
          <span style={{ background: `hsl(${hue(p.name)} 45% 32%)`, fontSize: size * 0.4 }}>
            {p.name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>
      {badge && <i className="badge">{badge}</i>}
    </div>
  );
}

export function PlayerChip({
  p,
  onClick,
  selected,
}: {
  p: PublicPlayer;
  onClick?: () => void;
  selected?: boolean;
}) {
  const inner = (
    <>
      <Portrait p={p} size={40} />
      <span>{p.name}</span>
    </>
  );
  // Only real buttons look like buttons: a list of who is here must not look greyed out.
  if (!onClick)
    return <div className={`chip static ${p.fate !== 'alive' ? 'gone' : ''}`}>{inner}</div>;
  return (
    <button className={`chip ${selected ? 'selected' : ''}`} onClick={onClick}>
      {inner}
    </button>
  );
}

/** Counts down to a server deadline using the server's clock. */
export function Countdown({ conn }: { conn: Connection }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  const s = conn.state;
  if (!s) return null;
  if (s.paused) return <span className="timer paused">Paused</span>;
  if (s.deadlineAt === null) return null;
  const left = Math.max(0, Math.ceil((s.deadlineAt - conn.serverNow()) / 1000));
  const m = Math.floor(left / 60);
  return (
    <span className={`timer ${left <= 10 ? 'urgent' : ''}`}>
      {m}:{String(left % 60).padStart(2, '0')}
    </span>
  );
}

export function Notices({ conn }: { conn: Connection }) {
  return (
    <div className="notices">
      {conn.notices.map((n) => (
        <div key={n.id} className="notice">
          {n.text}
        </div>
      ))}
    </div>
  );
}

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="panel">
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

export function go(path: string): void {
  history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
