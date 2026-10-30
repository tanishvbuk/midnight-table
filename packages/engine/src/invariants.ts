import type { Action, ApplyResult, GameState, PlayerId } from './types';
import { view, type Viewer } from './view';

/** Event types that carry private information and must never be addressed to everyone. */
const PRIVATE_EVENTS = new Set([
  'RoleDealt',
  'ShieldGranted',
  'ClueGranted',
  'NoteAdded',
  'RecruitOffered',
  'RecruitResponded',
  'Recruited',
  'MurderFailed',
]);

/** State field names that must never appear anywhere in a view. */
const FORBIDDEN_KEYS = new Set(['correct', 'rng', 'picks', 'votes', 'answers', 'order', 'notes']);

function walk(value: unknown, path: string, visit: (key: string, path: string) => void): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, visit));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      visit(k, `${path}.${k}`);
      walk(v, `${path}.${k}`, visit);
    }
  }
}

/** Structural secrecy checks on one view. Returns a list of problems, empty when safe. */
export function viewProblems(s: GameState, viewer: Viewer): string[] {
  const v = view(s, viewer);
  const problems: string[] = [];
  const fail = (m: string): void => void problems.push(`${viewer}: ${m}`);

  try {
    JSON.parse(JSON.stringify(v));
  } catch {
    fail('view is not JSON-serialisable');
  }
  walk(v, 'view', (key, path) => {
    if (FORBIDDEN_KEYS.has(key)) fail(`forbidden key at ${path}`);
  });

  for (const pv of v.players) {
    const real = s.players.find((p) => p.id === pv.id);
    if (!real) {
      fail(`unknown player ${pv.id}`);
      continue;
    }
    if (pv.role !== null && !real.revealed) fail(`role of ${pv.id} shown but not revealed`);
    if (pv.role !== null && pv.role !== real.role) fail(`wrong role shown for ${pv.id}`);
  }
  if (v.phase.kind === 'finalReveal' && s.phase.kind !== 'finalReveal') fail('premature reveal');
  if (v.phase.kind === 'breakfast' && !v.phase.announced && v.phase.victim !== null) {
    fail('victim shown before announcement');
  }

  if (viewer === 'castle') {
    if (v.you !== null) fail('castle view has a private section');
    return problems;
  }
  const me = s.players.find((p) => p.id === viewer);
  const you = v.you;
  if (!me || !you) {
    fail('no private section for a known player');
    return problems;
  }
  const alive = me.fate === 'alive';
  if (you.role !== null) {
    const allowed = me.revealed || (alive && s.phase.kind === 'roleReveal');
    if (!allowed) fail('own role shown outside the reveal');
    if (you.role !== me.role) fail('wrong own role');
  }
  if (JSON.stringify(you.card) !== JSON.stringify({ role: 'faithful' })) fail('card differs');
  if (you.team !== null) {
    const expected = s.players.filter((p) => p.fate === 'alive' && p.role === 'traitor');
    if (!alive || me.role !== 'traitor') fail('team shown to a non-Traitor');
    if (
      you.team.slice().sort().join() !==
      expected
        .map((p) => p.id)
        .sort()
        .join()
    ) {
      fail('team is wrong');
    }
  }
  if (you.chat.length > 0 && !(alive && me.role === 'traitor')) fail('chat shown to a non-Traitor');
  for (const c of you.clues) {
    if (s.players.find((p) => p.id === c)?.role !== 'faithful') fail('clue names a Traitor');
  }
  if (!alive && (you.shield || you.clues.length || you.chat.length || you.journal.length)) {
    fail('ghost sees private information');
  }
  return problems;
}

/** Checks every transition of a game as it is played. Stateful: tracks murders per day. */
export class InvariantTracker {
  private murdersByDay = new Map<number, number>();
  private maxPot = 0;

  check(prev: GameState, action: Action, res: ApplyResult): string[] {
    const out: string[] = [];
    const fail = (m: string): void => void out.push(m);
    const next = res.state;

    if (res.error !== undefined) {
      if (next !== prev) fail('rejected action returned a different state');
      if (res.events.length > 0) fail('rejected action produced events');
      return out;
    }
    if ('actor' in action) {
      const actor = prev.players.find((p) => p.id === action.actor);
      if (actor && actor.fate !== 'alive')
        fail(`eliminated player ${actor.id} acted: ${action.type}`);
    }
    if (!Number.isInteger(next.pot) || next.pot < 0) fail(`bad pot ${next.pot}`);
    if (next.pot < this.maxPot) fail('pot decreased');
    this.maxPot = Math.max(this.maxPot, next.pot);

    if (prev.phase.kind !== 'lobby') {
      if (next.players.length !== prev.players.length) fail('player count changed');
      let murdered = 0;
      for (const p of next.players) {
        const before = prev.players.find((x) => x.id === p.id);
        if (!before) {
          fail('player appeared');
          continue;
        }
        if (before.fate !== 'alive' && p.fate !== before.fate)
          fail(`${p.id} came back or changed fate`);
        if (before.fate === 'alive' && p.fate === 'murdered') murdered++;
        if (before.role !== p.role && !(before.role === 'faithful' && p.recruited)) {
          fail(`${p.id} changed role outside recruitment`);
        }
        if (before.revealed && !p.revealed) fail(`${p.id} was un-revealed`);
      }
      if (murdered > 1) fail('more than one murder in a single step');
      const day = next.day;
      this.murdersByDay.set(day, (this.murdersByDay.get(day) ?? 0) + murdered);
      if ((this.murdersByDay.get(day) ?? 0) > 1) fail(`more than one murder in day ${day}`);
      const traitors = next.players.filter(
        (p) => p.fate === 'alive' && p.role === 'traitor',
      ).length;
      if (traitors > next.initialTraitors) fail('more Traitors than the preset');
      const original = next.players.filter((p) => p.role === 'traitor' && !p.recruited).length;
      if (original !== next.initialTraitors) fail('original Traitor count drifted');
    }

    for (const e of res.events) {
      if (e.audience === 'public' && PRIVATE_EVENTS.has(e.type)) fail(`public ${e.type} event`);
      if (e.type === 'Banished' && e.role !== null) {
        if (!next.players.find((p) => p.id === e.player)?.revealed)
          fail('unrevealed role in Banished');
      }
      if (e.audience === 'public' && e.type !== 'Banished' && e.type !== 'GameEnded') {
        walk(e, e.type, (key) => {
          if (key === 'role' || key === 'roles' || key === 'team') fail(`${e.type} leaks ${key}`);
        });
      }
    }
    return out;
  }
}

export function allViewers(s: GameState): Viewer[] {
  return ['castle', ...s.players.map((p): PlayerId => p.id)];
}
