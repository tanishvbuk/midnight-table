import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { GameView, PublicPlayer, StateMessage, YouView } from '@midnight/engine';
import {
  readPending,
  readToken,
  useDraft,
  useGame,
  usePublicOrigin,
  type Connection,
} from '../net';
import { Countdown, Notices, Panel, PlayerChip, Replay, go } from '../ui';
import { phasePanel } from './Castle';

type PhaseOf<K extends GameView['phase']['kind']> = Extract<GameView['phase'], { kind: K }>;

interface Ctx {
  code: string;
  conn: Connection;
  s: StateMessage;
  v: GameView;
  you: YouView;
  others: PublicPlayer[];
  act: (a: Record<string, unknown>) => void;
}

function Waiting({ text }: { text: string }) {
  return <p className="muted center-text">{text}</p>;
}

function Lobby({ code, conn, s, v }: Ctx) {
  const [bots, setBots] = useState(3);
  const [qr, setQr] = useState('');
  const origin = usePublicOrigin();
  useEffect(() => {
    if (s.isHost)
      void QRCode.toDataURL(`${origin}/join/${code}`, { margin: 1, width: 220 }).then(setQr);
  }, [s.isHost, code, origin]);
  return (
    <>
      <Panel title={`Room ${code}`}>
        <div className="chips">
          {v.players.map((p) => (
            <PlayerChip key={p.id} p={p} />
          ))}
        </div>
      </Panel>
      {s.isHost ? (
        <Panel title="You are the host">
          {qr && <img className="qr" src={qr} alt="Join code" />}
          <div className="row">
            <input
              type="number"
              min={1}
              max={15}
              value={bots}
              onChange={(e) => setBots(Number(e.target.value))}
            />
            <button onClick={() => conn.host({ cmd: 'addBots', count: bots })}>Add bots</button>
          </div>
          <label className="row">
            <input
              type="checkbox"
              checked={s.phonesOnly}
              onChange={(e) => conn.host({ cmd: 'phonesOnly', on: e.target.checked })}
            />
            No TV: show the castle on every phone
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={s.physicalMissions}
              onChange={(e) => conn.host({ cmd: 'physicalMissions', on: e.target.checked })}
            />
            Physical tasks: every other mission is a task for the whole table
          </label>
          <button
            className="primary"
            disabled={v.players.length < 4}
            onClick={() => conn.act({ type: 'start' })}
          >
            {v.players.length < 4
              ? `Need ${4 - v.players.length} more`
              : `Start with ${v.players.length}`}
          </button>
        </Panel>
      ) : (
        <Waiting text="Waiting for the host to start…" />
      )}
    </>
  );
}

function Reveal({ you, act, v }: Ctx) {
  const ph = v.phase as PhaseOf<'roleReveal'>;
  const [held, setHeld] = useState(false);
  const names = (ids: string[]) =>
    ids.filter((i) => i !== you.id).map((i) => v.players.find((p) => p.id === i)?.name);
  return (
    <>
      <Panel title="Your role">
        <button
          className={`hold ${held ? 'open' : ''}`}
          onPointerDown={() => setHeld(true)}
          onPointerUp={() => setHeld(false)}
          onPointerLeave={() => setHeld(false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          {held ? (
            <>
              <strong className={`role-${you.role}`}>
                {you.role === 'traitor' ? 'TRAITOR' : 'FAITHFUL'}
              </strong>
              {you.team && <small>With: {names(you.team).join(', ') || 'no one else'}</small>}
            </>
          ) : (
            'Press and hold to reveal'
          )}
        </button>
      </Panel>
      {ph.acked.includes(you.id) ? (
        <Waiting text="Waiting for the others…" />
      ) : (
        <button className="primary" onClick={() => act({ type: 'ackRole' })}>
          I have seen it
        </button>
      )}
    </>
  );
}

function Quiz({ code, you, act, v }: Ctx) {
  const ph = v.phase as PhaseOf<'mission'>;
  // Kept across a reload, so a refreshed phone carries on from the question it was on.
  const [answers, setAnswers] = useDraft<(number | null)[]>(code, 'quiz', v.epoch, []);
  const i = answers.length;
  const finished = i >= ph.questions.length;
  const sent = useRef(false);
  useEffect(() => {
    if (finished && !you.answered && !sent.current) {
      sent.current = true; // the connection resends it until the server acks
      act({ type: 'submitAnswers', answers });
    }
  }, [finished, you.answered, answers, act]);
  if (you.answered || finished) {
    return <Waiting text="Answers locked in. Waiting for the others…" />;
  }
  const q = ph.questions[i];
  if (!q) return null;
  return (
    <Panel title={`Question ${i + 1} of ${ph.questions.length}`}>
      <h3>{q.text}</h3>
      <div className="stack">
        {q.options.map((o, k) => (
          <button key={k} onClick={() => setAnswers([...answers, k])}>
            {o}
          </button>
        ))}
      </div>
      <button className="ghost" onClick={() => setAnswers([...answers, null])}>
        Skip
      </button>
    </Panel>
  );
}

function PhysicalMission({ you, act, v }: Ctx) {
  const ph = v.phase as PhaseOf<'physicalMission'>;
  return (
    <Panel title={ph.title}>
      <p>{ph.text}</p>
      <p className="muted">
        Do it together. When it is over, vote in secret on whether the group pulled it off.
      </p>
      {you.physicalVote ? (
        <Waiting text="Your vote is cast. Waiting for the others…" />
      ) : (
        <div className="stack">
          <button className="primary" onClick={() => act({ type: 'physicalVote', pass: true })}>
            It passed
          </button>
          <button onClick={() => act({ type: 'physicalVote', pass: false })}>It failed</button>
        </div>
      )}
    </Panel>
  );
}

function Discussion({ you, act, v }: Ctx) {
  const ph = v.phase as PhaseOf<'discussion'>;
  const ready = ph.ready.includes(you.id);
  return (
    <Panel title="The Round Table">
      <p>Talk it out. When you are ready to vote, say so.</p>
      <button className="primary" disabled={ready} onClick={() => act({ type: 'ready' })}>
        {ready ? 'Ready' : 'Ready to vote'}
      </button>
      <p className="muted">
        {ph.ready.length} ready, {ph.needed} needed.
      </p>
    </Panel>
  );
}

function Vote({ code, you, act, v, others }: Ctx) {
  const ph = v.phase as PhaseOf<'voting'>;
  const [pick, setPick] = useDraft<string | null>(code, 'vote', v.epoch, null);
  if (!ph.eligible.includes(you.id))
    return <Waiting text="The tied players cannot vote. The rest of the table decides." />;
  if (you.voted) return <Waiting text="Your vote is cast. Watch the castle." />;
  const options = others.filter((p) => ph.candidates.includes(p.id));
  return (
    <Panel title={ph.stage === 'runoff' ? 'Run-off vote' : 'Cast your vote'}>
      <div className="chips">
        {options.map((p) => (
          <PlayerChip key={p.id} p={p} selected={pick === p.id} onClick={() => setPick(p.id)} />
        ))}
      </div>
      <button
        className="primary"
        disabled={!pick}
        onClick={() => act({ type: 'vote', target: pick })}
      >
        Lock in vote
      </button>
      <button className="ghost" onClick={() => act({ type: 'vote', target: null })}>
        Abstain
      </button>
    </Panel>
  );
}

function EndgameVote({ you, act }: Ctx) {
  if (you.endgameChoice) return <Waiting text="Your choice is made. Waiting…" />;
  return (
    <Panel title="The endgame">
      <p>End the game now? It only ends if every one of you agrees.</p>
      <div className="stack">
        <button className="primary" onClick={() => act({ type: 'endgameVote', choice: 'end' })}>
          End the game
        </button>
        <button onClick={() => act({ type: 'endgameVote', choice: 'continue' })}>
          Banish again
        </button>
      </div>
    </Panel>
  );
}

/** Every role sees this exact screen. Only the contents of the notes panel differ. */
function Night({ code, v, you, act, others }: Ctx) {
  const [text, setText] = useDraft(code, 'note', v.epoch, '');
  const notes = you.team
    ? you.chat.map((m) => ({ key: `${m.author}${m.text}`, text: m.text, author: m.author }))
    : you.journal.map((m) => ({ key: m.text + m.night, text: m.text, author: '' }));
  return (
    <>
      <Panel title="Night">
        <p>Choose a player.</p>
        <div className="chips">
          {others.map((p) => (
            <PlayerChip
              key={p.id}
              p={p}
              selected={you.pick === p.id}
              onClick={() => act({ type: 'nightPick', target: p.id })}
            />
          ))}
        </div>
      </Panel>
      <Panel title="Night notes">
        <ul className="notes">
          {notes.map((n, i) => (
            <li key={n.key + i}>{n.text}</li>
          ))}
        </ul>
        <div className="row">
          <input
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 200))}
            placeholder="Write a note"
          />
          <button
            disabled={!text.trim()}
            onClick={() => {
              act({ type: 'nightNote', text });
              setText('');
            }}
          >
            Send
          </button>
        </div>
      </Panel>
    </>
  );
}

function RecruitOffer({ you, act }: Ctx) {
  if (!you.offer)
    return (
      <Panel title="Night">
        <Waiting text="The night is not over yet…" />
      </Panel>
    );
  return (
    <Panel title="A dark invitation">
      <p>The Traitors want you. Join them, and you win with them.</p>
      {you.offer.ultimatum && <p className="error">Refuse, and you will be murdered tonight.</p>}
      <div className="stack">
        <button className="primary" onClick={() => act({ type: 'recruitReply', accept: true })}>
          Join the Traitors
        </button>
        <button onClick={() => act({ type: 'recruitReply', accept: false })}>Refuse</button>
      </div>
    </Panel>
  );
}

function Final({ you, v }: Ctx) {
  const [replay, setReplay] = useState(false);
  const ph = v.phase as PhaseOf<'finalReveal'>;
  const nameOf = (id: string) => v.players.find((p) => p.id === id)?.name ?? '?';
  const won =
    ph.roles[you.id] === (ph.winner === 'traitors' ? 'traitor' : 'faithful') &&
    (ph.payouts[you.id] ?? -1) >= 0;
  return (
    <Panel title={ph.winner === 'traitors' ? 'The Traitors win' : 'The Faithful win'}>
      <p>{won ? `You take ${ph.payouts[you.id]} from the pot.` : 'Better luck next time.'}</p>
      <table className="final">
        <tbody>
          {v.players.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td className={`role-${ph.roles[p.id]}`}>{ph.roles[p.id]}</td>
              <td>{ph.payouts[p.id] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ph.predictions.length > 0 && (
        <>
          <h3>Ghost guesses</h3>
          <ul className="muted">
            {ph.predictions.map((g) => (
              <li key={g.ghost}>
                {nameOf(g.ghost)}:{' '}
                {g.suspects.length ? g.suspects.map(nameOf).join(', ') : 'no guess'} ({g.hits}{' '}
                right)
              </li>
            ))}
          </ul>
        </>
      )}
      <button className="ghost" onClick={() => setReplay((r) => !r)}>
        {replay ? 'Hide the replay' : 'Replay the game'}
      </button>
      {replay && <Replay timeline={ph.timeline} />}
    </Panel>
  );
}

function Secrets({ you, v }: { you: YouView; v: GameView }) {
  const nameOf = (id: string) => v.players.find((p) => p.id === id)?.name ?? '?';
  const [open, setOpen] = useState(false);
  return (
    <button
      className="ghost peek"
      onPointerDown={() => setOpen(true)}
      onPointerUp={() => setOpen(false)}
      onPointerLeave={() => setOpen(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {open ? (
        <span>
          {you.shield ? 'You hold a Shield. ' : ''}
          {you.clues.length ? `A clue: ${you.clues.map(nameOf).join(', ')} is Faithful.` : ''}
          {!you.shield && !you.clues.length ? 'Nothing yet.' : ''}
        </span>
      ) : (
        'Hold to peek at your secrets'
      )}
    </button>
  );
}

function CardModal({ you, onClose }: { you: YouView; onClose: () => void }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="card">
        <small>This proves nothing.</small>
        <strong className="role-faithful">{you.card.role === 'faithful' ? 'FAITHFUL' : ''}</strong>
      </div>
    </div>
  );
}

function HostMenu({ conn, ctx, onClose }: { conn: Connection; ctx: Ctx; onClose: () => void }) {
  const paused = ctx.s.paused;
  const cmd = (c: Parameters<Connection['host']>[0]) => {
    conn.host(c);
    onClose();
  };
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Host menu</h2>
        <p className="muted">Every use is announced on the castle. Nothing here shows secrets.</p>
        <div className="stack">
          <button onClick={() => cmd({ cmd: paused ? 'resume' : 'pause' })}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button onClick={() => cmd({ cmd: 'addTime' })}>Add 60 seconds</button>
          <button onClick={() => cmd({ cmd: 'rerunVote' })}>Re-run the current vote</button>
          <label className="muted">Drop a disconnected player</label>
          <div className="chips">
            {ctx.others.map((p) => (
              <PlayerChip
                key={p.id}
                p={p}
                onClick={() => cmd({ cmd: 'dropPlayer', target: p.id })}
              />
            ))}
          </div>
          <button
            className="danger"
            onClick={() => window.confirm('End the game now?') && cmd({ cmd: 'endGame' })}
          >
            End the game
          </button>
        </div>
      </div>
    </div>
  );
}

/** Public phases: the castle's panel on the phone in phones-only mode, else a pointer to the castle. */
function Public({ ctx, text }: { ctx: Ctx; text: string }) {
  const pv = ctx.s.publicView;
  if (!pv) return <Waiting text={text} />;
  const byId = new Map(pv.players.map((p) => [p.id, p]));
  return <div className="public-feed">{phasePanel(pv, byId)}</div>;
}

/** R26: a ghost's private guess at the Traitors. It changes nothing in the game. */
function Guess({ you, v, act }: Ctx) {
  const options = v.players.filter((p) => p.id !== you.id && p.fate === 'alive');
  const full = you.prediction.length >= you.predictionLimit;
  const toggle = (id: string) => {
    const has = you.prediction.includes(id);
    if (!has && full) return;
    act({
      type: 'predict',
      suspects: has ? you.prediction.filter((x) => x !== id) : [...you.prediction, id],
    });
  };
  return (
    <Panel title="Who are the Traitors?">
      <p className="muted">
        Your private guess, up to {you.predictionLimit}. Nobody sees it until the end, when it is
        scored.
      </p>
      <div className="chips">
        {options.map((p) => (
          <PlayerChip
            key={p.id}
            p={p}
            selected={you.prediction.includes(p.id)}
            onClick={() => toggle(p.id)}
          />
        ))}
      </div>
    </Panel>
  );
}

function Body(ctx: Ctx) {
  const { v, you } = ctx;
  if (!you.alive && v.phase.kind !== 'finalReveal' && v.phase.kind !== 'lobby') {
    const publicPhase = ['voteReveal', 'speech', 'breakfast', 'physicalMission'].includes(
      v.phase.kind,
    );
    return (
      <>
        <Panel title="You are a ghost">
          <p>
            You can no longer act in the game.{' '}
            {ctx.s.phonesOnly ? 'Follow the table here' : 'Watch the castle'} and keep the secret of
            what you saw.
          </p>
        </Panel>
        <Guess {...ctx} />
        {publicPhase && ctx.s.publicView && <Public ctx={ctx} text="" />}
      </>
    );
  }
  switch (v.phase.kind) {
    case 'lobby':
      return <Lobby {...ctx} />;
    case 'roleReveal':
      return <Reveal {...ctx} />;
    case 'mission':
      return <Quiz {...ctx} />;
    case 'physicalMission':
      return <PhysicalMission {...ctx} />;
    case 'discussion':
      return <Discussion {...ctx} />;
    case 'voting':
      return <Vote {...ctx} />;
    case 'endgameVote':
      return <EndgameVote {...ctx} />;
    case 'night':
      return <Night {...ctx} />;
    case 'recruitOffer':
      return <RecruitOffer {...ctx} />;
    case 'finalReveal':
      return <Final {...ctx} />;
    case 'voteReveal':
      return <Public ctx={ctx} text="Watch the castle as the votes are revealed." />;
    case 'speech':
      return <Public ctx={ctx} text="Listen to the banished player's last words." />;
    case 'breakfast':
      return <Public ctx={ctx} text="Breakfast is being served. Watch the castle." />;
  }
}

export function Play({ code }: { code: string }) {
  const pending = useMemo(() => readPending(code), [code]);
  const seated = readToken(code) !== null;
  const conn = useGame(code, 'player', pending ?? {});
  const [card, setCard] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!seated && !pending) go(`/join/${code}`);
  }, [seated, pending, code]);
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

  const s = conn.state;
  if (conn.status === 'failed') {
    return (
      <main className="page center">
        <p className="error">{conn.error}</p>
        <button onClick={() => go(`/join/${code}`)}>Back</button>
      </main>
    );
  }
  if (!s || !s.view.you)
    return (
      <main className="page center">
        <p className="muted">Taking your seat…</p>
      </main>
    );
  const you = s.view.you;
  const ctx: Ctx = {
    code,
    conn,
    s,
    v: s.view,
    you,
    others: s.view.players.filter((p) => p.id !== you.id && p.fate === 'alive'),
    act: conn.act,
  };
  return (
    <main className="phone">
      <header>
        <strong>{s.view.players.find((p) => p.id === you.id)?.name}</strong>
        <Countdown conn={conn} />
        {s.isHost && (
          <button className="ghost" onClick={() => setMenu(true)}>
            Host
          </button>
        )}
      </header>
      <p className="narration small">{s.narration}</p>
      <Body {...ctx} />
      {conn.error && <p className="error">{conn.error}</p>}
      <footer>
        <Secrets you={you} v={s.view} />
        <button className="ghost" onClick={() => setCard(true)}>
          Show my card
        </button>
      </footer>
      {card && <CardModal you={you} onClose={() => setCard(false)} />}
      {menu && <HostMenu conn={conn} ctx={ctx} onClose={() => setMenu(false)} />}
      {s.paused && <div className="banner">Paused by the host</div>}
      {conn.status !== 'open' && <div className="banner">Reconnecting…</div>}
      <Notices conn={conn} />
    </main>
  );
}
