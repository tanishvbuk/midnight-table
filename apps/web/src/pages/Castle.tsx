import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { GameView, PublicPlayer } from '@midnight/engine';
import { usePublicOrigin, useGame } from '../net';
import { Countdown, Notices, Portrait } from '../ui';

function Roster({ v }: { v: GameView }) {
  return (
    <div className="roster">
      {v.players.map((p) => (
        <div key={p.id} className={`seat ${p.fate}`}>
          <Portrait p={p} size={72} />
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

function Join({ code }: { code: string }) {
  const [qr, setQr] = useState('');
  const origin = usePublicOrigin();
  const url = `${origin}/join/${code}`;
  useEffect(() => {
    void QRCode.toDataURL(url, {
      margin: 1,
      width: 280,
      color: { dark: '#0d0b14', light: '#f3ecd9' },
    }).then(setQr);
  }, [url]);
  return (
    <div className="join-box">
      {qr && <img src={qr} alt="Scan to join" />}
      <div>
        <div className="muted">Scan, or go to</div>
        <div className="small-url">{new URL(origin).host}</div>
        <div className="bigcode">{code}</div>
      </div>
    </div>
  );
}

function phasePanel(v: GameView, byId: Map<string, PublicPlayer>) {
  const ph = v.phase;
  const name = (id: string | null) => (id ? (byId.get(id)?.name ?? '?') : 'abstained');
  switch (ph.kind) {
    case 'roleReveal':
      return (
        <p className="status">
          {ph.acked.length} of {v.players.length} have looked at their card.
        </p>
      );
    case 'mission':
      return (
        <p className="status">
          {ph.submitted.length} of {v.players.filter((p) => p.fate === 'alive').length} have
          answered.
        </p>
      );
    case 'discussion':
      return (
        <p className="status">
          {ph.ready.length} ready to vote. {ph.needed} needed to open the ballot early.
        </p>
      );
    case 'endgameVote':
      return <p className="status">{ph.submitted.length} have chosen.</p>;
    case 'voting':
      return (
        <p className="status">
          {ph.submitted.length} of {ph.eligible.length} votes cast.
          {ph.stage === 'runoff' &&
            ` Candidates: ${ph.candidates.map((c) => name(c)).join(' or ')}.`}
        </p>
      );
    case 'voteReveal':
      return (
        <ol className="reveal">
          {ph.revealed.map((r) => (
            <li key={r.voter}>
              <b>{name(r.voter)}</b> → {name(r.target)}
            </li>
          ))}
        </ol>
      );
    case 'speech': {
      const p = byId.get(ph.player);
      return p ? (
        <div className="spotlight">
          <Portrait p={p} size={160} />
          <h2>{p.name}</h2>
        </div>
      ) : null;
    }
    case 'breakfast':
      return (
        <div className="arrivals">
          {ph.arrived.map((id) => {
            const p = byId.get(id);
            return p ? <Portrait key={id} p={p} size={64} /> : null;
          })}
        </div>
      );
    case 'finalReveal':
      return (
        <table className="final">
          <tbody>
            {v.players.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className={`role-${ph.roles[p.id]}`}>{ph.roles[p.id]}</td>
                <td>{p.fate}</td>
                <td>{ph.payouts[p.id] ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    default:
      return null;
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
  const byId = new Map(v.players.map((p) => [p.id, p]));
  const night = v.phase.kind === 'night' || v.phase.kind === 'recruitOffer';
  return (
    <main className={`castle ${night ? 'night' : ''}`}>
      <header>
        <div className="code">Room {code}</div>
        <div className="pot">Pot {v.pot}</div>
        <Countdown conn={conn} />
      </header>
      <h1 className="narration">{s.narration}</h1>
      {v.phase.kind === 'lobby' && <Join code={code} />}
      {phasePanel(v, byId)}
      <Roster v={v} />
      {conn.status !== 'open' && <div className="banner">Reconnecting…</div>}
      <Notices conn={conn} />
    </main>
  );
}
