import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import type { GameView, PublicPlayer, StateMessage, YouView } from '@midnight/engine';
import { readToken, useGame, usePublicOrigin, type Connection } from '../net';
import { Countdown, Notices, Panel, PlayerChip, Portrait, go } from '../ui';

type PhaseOf<K extends GameView['phase']['kind']> = Extract<GameView['phase'], { kind: K }>;

interface Ctx {
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

function Lobby({ conn, s, v }: Ctx) {
  const [bots, setBots] = useState(3);
  const [qr, setQr] = useState('');
  const code = location.pathname.split('/').pop() ?? '';
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

function Quiz({ you, act, v }: Ctx) {
  const ph = v.phase as PhaseOf<'mission'>;
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const i = answers.length;
  const finished = i >= ph.questions.length;
  useEffect(() => {
    if (finished && !you.answered) act({ type: 'submitAnswers', answers });
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

function Vote({ you, act, v, others }: Ctx) {
  const ph = v.phase as PhaseOf<'voting'>;
  const [pick, setPick] = useState<string | null>(null);
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
function Night({ you, act, others }: Ctx) {
  const [text, setText] = useState('');
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
    <section className="panel offer">
      <h2>A dark invitation</h2>
      <p className="offer-lead">The Traitors want you.</p>
      <p>Join them, and you win with them. Tell no one, whatever you choose.</p>
      {you.offer.ultimatum && <p className="warning">Refuse, and you will be murdered tonight.</p>}
      <div className="stack">
        <button className="primary big" onClick={() => act({ type: 'recruitReply', accept: true })}>
          Join the Traitors
        </button>
        <button className="big" onClick={() => act({ type: 'recruitReply', accept: false })}>
          Refuse
        </button>
      </div>
    </section>
  );
}

function Final({ you, v }: Ctx) {
  const ph = v.phase as PhaseOf<'finalReveal'>;
  const winnerRole = ph.winner === 'traitors' ? 'traitor' : 'faithful';
  const myPay = ph.payouts[you.id] ?? 0;
  const myRole = ph.roles[you.id];
  const sideWon = myRole === winnerRole;
  const rows = [...v.players].sort(
    (a, b) => (ph.payouts[b.id] ?? 0) - (ph.payouts[a.id] ?? 0) || a.name.localeCompare(b.name),
  );
  return (
    <>
      <section className={`panel verdict ${sideWon ? 'win' : 'lose'}`}>
        <small>{ph.winner === 'traitors' ? 'The Traitors win' : 'The Faithful win'}</small>
        <strong>
          {myPay > 0 ? myPay.toLocaleString() : sideWon ? 'Your side won' : 'Not this time'}
        </strong>
        <p>
          {myPay > 0
            ? 'is your share of the pot.'
            : sideWon
              ? 'Only those still standing share the pot.'
              : 'The pot went to the other side.'}
        </p>
      </section>
      <Panel title="Everyone's cards">
        <div className="board compact">
          {rows.map((p) => (
            <div key={p.id} className={`board-row ${(ph.payouts[p.id] ?? 0) > 0 ? 'won' : ''}`}>
              <Portrait p={p} size={36} />
              <div className="board-name">{p.name}</div>
              <div className={`board-role role-${ph.roles[p.id]}`}>{ph.roles[p.id]}</div>
              <div className="board-pay">
                {(ph.payouts[p.id] ?? 0) > 0 ? (ph.payouts[p.id] as number).toLocaleString() : '—'}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </>
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
        'Hold to peek'
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
        <small className="tap">Tap anywhere to close</small>
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

function Ghost({ you, v }: Ctx) {
  const me = v.players.find((p) => p.id === you.id);
  const living = v.players.filter((p) => p.fate === 'alive');
  return (
    <>
      <section className="panel ghost-card">
        {me && <Portrait p={me} size={88} />}
        <h2>You are a ghost</h2>
        <p className="muted">
          {me?.fate === 'murdered' ? 'Murdered in the night.' : 'Banished from the table.'} You can
          no longer act, and you must not help the living.
        </p>
      </section>
      <Panel title={`Still at the table (${living.length})`}>
        <div className="chips">
          {living.map((p) => (
            <PlayerChip key={p.id} p={p} />
          ))}
        </div>
        <p className="muted">Pot: {v.pot.toLocaleString()}. Watch the castle.</p>
      </Panel>
    </>
  );
}

function Body(ctx: Ctx) {
  const { v, you } = ctx;
  if (!you.alive && v.phase.kind !== 'finalReveal' && v.phase.kind !== 'lobby') {
    return <Ghost {...ctx} />;
  }
  switch (v.phase.kind) {
    case 'lobby':
      return <Lobby {...ctx} />;
    case 'roleReveal':
      return <Reveal {...ctx} />;
    case 'mission':
      return <Quiz {...ctx} />;
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
      return <Waiting text="Watch the castle as the votes are revealed." />;
    case 'speech':
      return <Waiting text="Listen to the banished player's last words." />;
    case 'breakfast':
      return <Waiting text="Breakfast is being served. Watch the castle." />;
  }
}

export function Play({ code }: { code: string }) {
  const pending = useMemo(() => {
    try {
      return JSON.parse(sessionStorage.getItem(`mt:pending:${code}`) ?? 'null') as {
        name: string;
        avatar: string | null;
      } | null;
    } catch {
      return null;
    }
  }, [code]);
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
      {you.alive && s.view.phase.kind !== 'lobby' && s.view.phase.kind !== 'finalReveal' && (
        <footer>
          <Secrets you={you} v={s.view} />
          <button className="ghost" onClick={() => setCard(true)}>
            Show my card
          </button>
        </footer>
      )}
      {card && <CardModal you={you} onClose={() => setCard(false)} />}
      {menu && <HostMenu conn={conn} ctx={ctx} onClose={() => setMenu(false)} />}
      {s.paused && <div className="banner">Paused by the host</div>}
      {conn.status !== 'open' && <div className="banner">Reconnecting…</div>}
      <Notices conn={conn} />
    </main>
  );
}
