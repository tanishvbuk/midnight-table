import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { GameView, PublicPlayer } from '@midnight/engine';
import { usePublicOrigin, useGame } from '../net';
import { Countdown, Notices, Portrait, Replay } from '../ui';

const tv = (): boolean => window.innerWidth >= 1400;

function Roster({ v }: { v: GameView }) {
  const size = tv() ? 104 : 72;
  return (
    <div className="roster">
      {v.players.map((p) => (
        <div key={p.id} className={`seat ${p.fate}`}>
          <Portrait p={p} size={size} />
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

/** One vote at a time: who voted, who for, and a running count that builds the tension. */
function VoteReveal({
  ph,
  byId,
}: {
  ph: Extract<GameView['phase'], { kind: 'voteReveal' }>;
  byId: Map<string, PublicPlayer>;
}) {
  const last = ph.revealed.at(-1);
  const voter = last ? byId.get(last.voter) : undefined;
  const target = last?.target ? byId.get(last.target) : undefined;
  const tally = new Map<string, number>();
  for (const r of ph.revealed) if (r.target) tally.set(r.target, (tally.get(r.target) ?? 0) + 1);
  const rows = [...tally].sort((a, b) => b[1] - a[1]);
  const big = tv() ? 220 : 140;
  return (
    <div className="vote-reveal">
      <div className="vote-count">
        Vote {ph.revealed.length} of {ph.total}
      </div>
      {voter && last && (
        <div className="vote-stage" key={ph.revealed.length}>
          <div className="vote-side from">
            <Portrait p={voter} size={big} />
            <b>{voter.name}</b>
          </div>
          <div className="vote-arrow">votes for</div>
          <div className="vote-side to">
            {target ? (
              <>
                <Portrait p={target} size={big} />
                <b>{target.name}</b>
              </>
            ) : (
              <b className="abstain">Abstains</b>
            )}
          </div>
        </div>
      )}
      <div className="tally">
        {rows.map(([id, n]) => {
          const p = byId.get(id);
          return p ? (
            <div className="tally-row" key={id}>
              <Portrait p={p} size={48} />
              <span className="tally-name">{p.name}</span>
              <span className="tally-pips">
                {Array.from({ length: n }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
            </div>
          ) : null;
        })}
      </div>
    </div>
  );
}

/** Survivors file in one by one, then the empty chair is named. */
function Breakfast({
  ph,
  byId,
}: {
  ph: Extract<GameView['phase'], { kind: 'breakfast' }>;
  byId: Map<string, PublicPlayer>;
}) {
  const lastId = ph.arrived.at(-1);
  const last = lastId ? byId.get(lastId) : undefined;
  const victim = ph.victim ? byId.get(ph.victim) : undefined;
  const big = tv() ? 240 : 150;
  return (
    <div className="breakfast">
      {!ph.announced && last && (
        <div className="arriving" key={last.id}>
          <Portrait p={last} size={big} />
          <b>{last.name}</b>
        </div>
      )}
      {ph.announced && (
        <div className={`verdict ${victim ? 'death' : 'safe'}`}>
          {victim ? (
            <>
              <Portrait p={victim} size={big} />
              <b>{victim.name}</b>
              <span>did not come to breakfast.</span>
            </>
          ) : (
            <b>Everyone came to breakfast.</b>
          )}
        </div>
      )}
      <div className="arrivals">
        {ph.arrived.map((id) => {
          const p = byId.get(id);
          return p ? <Portrait key={id} p={p} size={tv() ? 72 : 52} /> : null;
        })}
      </div>
    </div>
  );
}

/** Nothing here depends on anyone's role or on who has acted. */
function NightSky() {
  return (
    <div className="night-sky" aria-hidden>
      <div className="moon" />
    </div>
  );
}

export function phasePanel(v: GameView, byId: Map<string, PublicPlayer>) {
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
      return <VoteReveal ph={ph} byId={byId} />;
    case 'speech': {
      const p = byId.get(ph.player);
      return p ? (
        <div className="spotlight">
          <Portrait p={p} size={tv() ? 260 : 160} />
          <h2>{p.name}</h2>
        </div>
      ) : null;
    }
    case 'breakfast':
      return <Breakfast ph={ph} byId={byId} />;
    case 'night':
    case 'recruitOffer':
      return <NightSky />;
    case 'finalReveal':
      return (
        <>
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
          <Replay timeline={ph.timeline} live />
        </>
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
