import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { GameView, PublicPlayer } from '@midnight/engine';
import { useGame } from '../net';
import { Countdown, Notices, Portrait } from '../ui';

/** Players who have already done what the current phase is waiting for. All of it is public. */
function doneIds(v: GameView): Set<string> {
  const ph = v.phase;
  switch (ph.kind) {
    case 'roleReveal':
      return new Set(ph.acked);
    case 'mission':
    case 'voting':
    case 'endgameVote':
      return new Set(ph.submitted);
    case 'discussion':
      return new Set(ph.ready);
    default:
      return new Set();
  }
}

function seatSize(n: number): number {
  if (n <= 6) return 120;
  if (n <= 9) return 104;
  if (n <= 12) return 88;
  return 72;
}

function Roster({ v }: { v: GameView }) {
  const done = doneIds(v);
  const size = seatSize(v.players.length);
  return (
    <div className="roster">
      {v.players.map((p) => (
        <div key={p.id} className={`seat ${p.fate}`} style={{ width: size + 24 }}>
          <Portrait p={p} size={size} badge={p.fate === 'alive' && done.has(p.id) ? '✓' : null} />
          <div className="seat-name">{p.name}</div>
          {p.fate !== 'alive' && (
            <div className="seat-tag">{p.fate === 'murdered' ? 'Murdered' : 'Banished'}</div>
          )}
          {p.role && <div className={`seat-tag role-${p.role}`}>{p.role}</div>}
        </div>
      ))}
    </div>
  );
}

function Join({ code, count }: { code: string; count: number }) {
  const [qr, setQr] = useState('');
  const url = `${location.origin}/join/${code}`;
  useEffect(() => {
    void QRCode.toDataURL(url, {
      margin: 1,
      width: 360,
      color: { dark: '#0d0b14', light: '#f3ecd9' },
    }).then(setQr);
  }, [url]);
  return (
    <div className="join-box">
      {qr && <img src={qr} alt="Scan to join" />}
      <div className="join-text">
        <div className="muted">Scan with your phone, or go to</div>
        <div className="small-url">{location.host}</div>
        <div className="bigcode">{code}</div>
        <div className="muted">
          {count} at the table. Four or more can play; six or more is best.
        </div>
      </div>
    </div>
  );
}

function Progress({ n, of, label }: { n: number; of: number; label: string }) {
  return (
    <div className="progress">
      <div className="progress-n">
        {n}
        <span> / {of}</span>
      </div>
      <div className="progress-label">{label}</div>
    </div>
  );
}

function VoteReveal({
  ph,
  byId,
}: {
  ph: Extract<GameView['phase'], { kind: 'voteReveal' }>;
  byId: Map<string, PublicPlayer>;
}) {
  const last = ph.revealed[ph.revealed.length - 1];
  const voter = last ? byId.get(last.voter) : undefined;
  const target = last?.target ? byId.get(last.target) : undefined;
  const tally = new Map<string, number>();
  for (const r of ph.revealed) if (r.target) tally.set(r.target, (tally.get(r.target) ?? 0) + 1);
  const rows = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <>
      <div className="duel">
        {voter ? <Portrait p={voter} size={150} /> : <div className="duel-empty" />}
        <div className="duel-arrow">→</div>
        {target ? (
          <Portrait p={target} size={150} />
        ) : (
          <div className="duel-empty">{last ? 'abstained' : '?'}</div>
        )}
      </div>
      <div className="muted">
        {ph.revealed.length} of {ph.total} votes read
      </div>
      <div className="tally">
        {rows.map(([id, n]) => {
          const p = byId.get(id);
          return p ? (
            <div key={id} className="tally-row">
              <Portrait p={p} size={44} />
              <span className="tally-name">{p.name}</span>
              <span className="tally-bar" style={{ width: n * 56 }} />
              <b>{n}</b>
            </div>
          ) : null;
        })}
      </div>
    </>
  );
}

function Leaderboard({
  ph,
  v,
}: {
  ph: Extract<GameView['phase'], { kind: 'finalReveal' }>;
  v: GameView;
}) {
  const rows = [...v.players].sort(
    (a, b) => (ph.payouts[b.id] ?? 0) - (ph.payouts[a.id] ?? 0) || a.name.localeCompare(b.name),
  );
  return (
    <div className="board">
      {rows.map((p) => {
        const pay = ph.payouts[p.id] ?? 0;
        return (
          <div key={p.id} className={`board-row ${pay > 0 ? 'won' : ''}`}>
            <Portrait p={p} size={56} />
            <div className="board-name">
              {p.name}
              <small>{p.fate === 'alive' ? 'survived' : p.fate}</small>
            </div>
            <div className={`board-role role-${ph.roles[p.id]}`}>{ph.roles[p.id]}</div>
            <div className="board-pay">{pay > 0 ? pay.toLocaleString() : '—'}</div>
          </div>
        );
      })}
    </div>
  );
}

function Stage({ v, code }: { v: GameView; code: string }) {
  const ph = v.phase;
  const byId = new Map(v.players.map((p) => [p.id, p]));
  const alive = v.players.filter((p) => p.fate === 'alive').length;
  switch (ph.kind) {
    case 'lobby':
      return <Join code={code} count={v.players.length} />;
    case 'roleReveal':
      return (
        <Progress n={ph.acked.length} of={v.players.length} label="have looked at their card" />
      );
    case 'mission':
      return <Progress n={ph.submitted.length} of={alive} label="have answered" />;
    case 'discussion':
      return (
        <Progress
          n={ph.ready.length}
          of={ph.needed}
          label="ready to vote. The ballot opens when enough are ready, or when time runs out"
        />
      );
    case 'endgameVote':
      return <Progress n={ph.submitted.length} of={alive} label="have chosen" />;
    case 'voting':
      return (
        <>
          <Progress n={ph.submitted.length} of={ph.eligible.length} label="votes cast" />
          {ph.stage === 'runoff' && (
            <div className="runoff">
              {ph.candidates.map((c) => {
                const p = byId.get(c);
                return p ? <Portrait key={c} p={p} size={96} /> : null;
              })}
            </div>
          )}
        </>
      );
    case 'voteReveal':
      return <VoteReveal ph={ph} byId={byId} />;
    case 'speech': {
      const p = byId.get(ph.player);
      return p ? (
        <div className="spotlight">
          <Portrait p={p} size={220} />
          <h2>{p.name}</h2>
        </div>
      ) : null;
    }
    case 'breakfast':
      return (
        <div className="arrivals">
          {ph.arrived.map((id) => {
            const p = byId.get(id);
            return p ? <Portrait key={id} p={p} size={110} /> : null;
          })}
        </div>
      );
    case 'night':
    case 'recruitOffer':
      return <div className="moon" aria-hidden />;
    case 'finalReveal':
      return <Leaderboard ph={ph} v={v} />;
  }
}

export function Castle({ code }: { code: string }) {
  const conn = useGame(code, 'castle');
  const s = conn.state;
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const ask = () =>
      void navigator.wakeLock
        ?.request('screen')
        .then((l) => (lock = l))
        .catch(() => {});
    ask();
    document.addEventListener('visibilitychange', ask);
    return () => {
      document.removeEventListener('visibilitychange', ask);
      void lock?.release();
    };
  }, []);

  if (conn.status === 'failed')
    return (
      <main className="page center">
        <p className="error">{conn.error}</p>
      </main>
    );
  if (!s)
    return (
      <main className="page center">
        <p className="muted">Connecting to room {code}…</p>
      </main>
    );
  const v = s.view;
  const night = v.phase.kind === 'night' || v.phase.kind === 'recruitOffer';
  const final = v.phase.kind === 'finalReveal';
  return (
    <main className={`castle ${night ? 'night' : ''}`}>
      <header>
        <div className="code">Room {code}</div>
        <div className="pot">Pot {v.pot.toLocaleString()}</div>
        <Countdown conn={conn} />
      </header>
      <section className="stage">
        <h1 className="narration">{s.narration}</h1>
        <Stage v={v} code={code} />
      </section>
      {!final && <Roster v={v} />}
      {s.paused && <div className="banner">Paused by the host</div>}
      {conn.status !== 'open' && <div className="banner">Reconnecting…</div>}
      <Notices conn={conn} />
    </main>
  );
}
