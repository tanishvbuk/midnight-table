import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PublicPlayer, TimelineEntry } from '@midnight/engine';
import type { Connection } from './net';

export function hue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function Portrait({ p, size = 56 }: { p: PublicPlayer; size?: number }) {
  const dead = p.fate !== 'alive';
  return (
    <div className={`portrait ${dead ? 'dead' : ''}`} style={{ width: size, height: size }}>
      {p.avatar ? (
        <img src={p.avatar} alt={p.name} />
      ) : (
        <span style={{ background: `hsl(${hue(p.name)} 45% 32%)`, fontSize: size * 0.4 }}>
          {p.name.slice(0, 1).toUpperCase()}
        </span>
      )}
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
  return (
    <button className={`chip ${selected ? 'selected' : ''}`} onClick={onClick} disabled={!onClick}>
      <Portrait p={p} size={40} />
      <span>{p.name}</span>
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

export async function resizeImage(file: File, size = 128): Promise<string> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.7);
}

/** The post-game replay (R27). `live` reveals one line at a time, for the castle. */
export function Replay({ timeline, live = false }: { timeline: TimelineEntry[]; live?: boolean }) {
  const [shown, setShown] = useState(live ? Math.min(1, timeline.length) : timeline.length);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setShown((n) => Math.min(timeline.length, n + 1)), 3000);
    return () => clearInterval(t);
  }, [live, timeline.length]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [live, shown]);
  const lines = timeline.slice(0, shown);
  const rows: ReactNode[] = [];
  let when = '';
  lines.forEach((e, i) => {
    if (e.when !== when) {
      when = e.when;
      rows.push(<h3 key={`w${i}`}>{when}</h3>);
    }
    rows.push(
      <p key={i} className={`replay-line replay-${e.kind}`}>
        {e.text}
      </p>,
    );
  });
  return (
    <div className="replay" ref={box}>
      {rows.length === 0 ? <p className="muted">The replay is about to start…</p> : rows}
    </div>
  );
}
