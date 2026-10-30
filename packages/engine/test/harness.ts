import {
  apply,
  createGame,
  type Action,
  type ApplyResult,
  type GameState,
  type Phase,
  type PlayerId,
} from '../src/index';

export const id = (i: number): PlayerId => `p${i}`;
export const ids = (n: number): PlayerId[] => Array.from({ length: n }, (_, i) => id(i + 1));

export function ok(s: GameState, a: Action): ApplyResult {
  const r = apply(s, a);
  if (r.error) throw new Error(`${a.type} rejected: ${r.error}`);
  return r;
}

export function lobby(n: number, seed = 1): GameState {
  let s = createGame({ seed });
  for (const p of ids(n)) s = ok(s, { type: 'join', id: p, name: p }).state;
  return s;
}

export function started(n: number, seed = 1): GameState {
  return ok(lobby(n, seed), { type: 'start', actor: 'p1' }).state;
}

export function tick(s: GameState): ApplyResult {
  return ok(s, { type: 'timeout', epoch: s.epoch });
}

/** Ticks the timer until the phase kind matches, returning the state. */
export function tickTo(s: GameState, kind: Phase['kind'], max = 400): GameState {
  let cur = s;
  for (let i = 0; i < max && cur.phase.kind !== kind; i++) cur = tick(cur).state;
  if (cur.phase.kind !== kind) throw new Error(`never reached ${kind}`);
  return cur;
}

/** Test scaffolding: rewrites a state directly so a scenario can start exactly where it needs to. */
export function patch(s: GameState, fn: (draft: GameState) => void): GameState {
  const draft = structuredClone(s);
  fn(draft);
  return draft;
}

export function withRoles(s: GameState, traitors: PlayerId[]): GameState {
  return patch(s, (d) => {
    for (const p of d.players) p.role = traitors.includes(p.id) ? 'traitor' : 'faithful';
  });
}

export function at(s: GameState, phase: Phase, day = 1): GameState {
  return patch(s, (d) => {
    d.phase = phase;
    d.day = day;
    d.epoch++;
  });
}

export function kill(
  s: GameState,
  victims: PlayerId[],
  fate: 'murdered' | 'banished' = 'banished',
) {
  return patch(s, (d) => {
    for (const p of d.players) if (victims.includes(p.id)) p.fate = fate;
  });
}

export function everyone(s: GameState, make: (actor: PlayerId) => Action): GameState {
  let cur = s;
  for (const p of s.players) if (p.fate === 'alive') cur = ok(cur, make(p.id)).state;
  return cur;
}
