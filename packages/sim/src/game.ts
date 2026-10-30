import {
  allViewers,
  apply,
  createGame,
  createRng,
  InvariantTracker,
  pendingActors,
  viewProblems,
  type Action,
  type ApplyResult,
  type GameState,
  type PlayerId,
  type Rng,
  type Winner,
} from '@midnight/engine';
import { botAction, noteAction } from './bots';

export interface GameOutcome {
  players: number;
  finished: boolean;
  winner: Winner | null;
  rounds: number;
  steps: number;
  pot: number;
  failures: string[];
}

export interface PlayOptions {
  seed: number;
  players: number;
  maxSteps?: number;
  /** Probability that a bot with a pending input skips it, leaving the timer default to apply. */
  dropRate?: number;
  /** Called with every state reached, including the first, along with the action that led to it. */
  onState?: (state: GameState, prev: GameState, action: Action, res: ApplyResult) => void;
}

/** Plays one game of random bots to the end, checking every invariant along the way. */
export function playGame(opts: PlayOptions): GameOutcome {
  const maxSteps = opts.maxSteps ?? 20_000;
  const dropRate = opts.dropRate ?? 0.1;
  const rng = createRng(opts.seed ^ 0x9e3779b9);
  const tracker = new InvariantTracker();
  const failures: string[] = [];
  let state = createGame({ seed: opts.seed });
  let steps = 0;

  const step = (action: Action): ApplyResult => {
    const res = apply(state, action);
    for (const f of tracker.check(state, action, res)) failures.push(`step ${steps}: ${f}`);
    steps++;
    return res;
  };
  const play = (action: Action): void => {
    const prev = state;
    const res = step(action);
    state = res.state;
    opts.onState?.(state, prev, action, res);
    checkViews(state, rng, failures, steps);
  };

  const ids: PlayerId[] = Array.from({ length: opts.players }, (_, i) => `p${i + 1}`);
  ids.forEach((id) => play({ type: 'join', id, name: id }));
  play({ type: 'start', actor: ids[0] as PlayerId });

  while (state.phase.kind !== 'finalReveal' && steps < maxSteps && failures.length === 0) {
    const epoch = state.epoch;
    for (const actor of pendingActors(state)) {
      if (state.epoch !== epoch) break;
      if (rng.next() < dropRate) continue;
      if (state.phase.kind === 'night' && rng.next() < 0.5) play(noteAction(actor, rng));
      const action = botAction(state, actor, rng);
      if (action) play(action);
    }
    ghostGuesses(state, rng, play);
    injectNoise(state, rng, step);
    if (state.epoch === epoch) play({ type: 'timeout', epoch });
  }

  const finished = state.phase.kind === 'finalReveal';
  if (!finished && failures.length === 0) failures.push(`game did not finish in ${maxSteps} steps`);
  return {
    players: opts.players,
    finished,
    winner: state.result?.winner ?? null,
    rounds: state.day,
    steps,
    pot: state.pot,
    failures,
  };
}

/** Ghosts occasionally change their R26 guess. It must never change the course of the game. */
function ghostGuesses(s: GameState, rng: Rng, play: (a: Action) => void): void {
  for (const g of s.players.filter((p) => p.fate !== 'alive')) {
    if (rng.next() > 0.3) continue;
    const others = s.players.filter((p) => p.id !== g.id);
    const suspects: PlayerId[] = [];
    for (let i = rng.int(s.initialTraitors + 1); i > 0; i--) {
      const pick = rng.pick(others).id;
      if (!suspects.includes(pick)) suspects.push(pick);
    }
    play({ type: 'predict', actor: g.id, suspects });
  }
}

/** Throws illegal actions at the engine; every one must be rejected with no change. */
function injectNoise(s: GameState, rng: Rng, step: (a: Action) => ApplyResult): void {
  if (rng.next() > 0.15) return;
  const dead = s.players.filter((p) => p.fate !== 'alive');
  const anyone = s.players[rng.int(s.players.length)];
  if (!anyone) return;
  const target = rng.pick(s.players).id;
  const candidates: Action[] = [
    { type: 'timeout', epoch: s.epoch - 1 },
    { type: 'start', actor: anyone.id },
    { type: 'join', id: 'late', name: 'late' },
    { type: 'vote', actor: anyone.id, target: anyone.id },
    { type: 'nightPick', actor: anyone.id, target: anyone.id },
  ];
  if (dead.length > 0) {
    const d = rng.pick(dead).id;
    candidates.push(
      { type: 'ackRole', actor: d },
      { type: 'ready', actor: d },
      { type: 'vote', actor: d, target },
      { type: 'nightPick', actor: d, target },
      { type: 'nightNote', actor: d, text: 'boo' },
      { type: 'endgameVote', actor: d, choice: 'end' },
      { type: 'recruitReply', actor: d, accept: true },
      { type: 'submitAnswers', actor: d, answers: [] },
      { type: 'predict', actor: d, suspects: [d] },
      { type: 'predict', actor: d, suspects: [target, target] },
    );
  }
  candidates.push({ type: 'predict', actor: anyone.id, suspects: [] });
  step(rng.pick(candidates));
}

function checkViews(s: GameState, rng: Rng, failures: string[], steps: number): void {
  const viewers = allViewers(s);
  const sample = ['castle', rng.pick(viewers), rng.pick(viewers)];
  for (const v of new Set(sample)) {
    for (const p of viewProblems(s, v)) failures.push(`step ${steps}: ${p}`);
  }
}
