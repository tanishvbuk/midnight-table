import { describe, expect, it } from 'vitest';
import {
  apply,
  type Action,
  presetFor,
  view,
  type GameEvent,
  type GameState,
  type PlayerId,
} from '../src/index';
import {
  at,
  everyone,
  ids,
  kill,
  lobby,
  ok,
  patch,
  started,
  tick,
  tickTo,
  withRoles,
} from './harness';

const roleOf = (s: GameState, p: PlayerId) => s.players.find((x) => x.id === p)?.role;
const fateOf = (s: GameState, p: PlayerId) => s.players.find((x) => x.id === p)?.fate;
const types = (events: GameEvent[]) => events.map((e) => e.type);

describe('presets', () => {
  const table: [number, number, boolean, boolean, number][] = [
    [4, 1, false, false, 3],
    [5, 1, false, false, 3],
    [6, 1, true, false, 3],
    [7, 1, true, false, 3],
    [8, 2, true, true, 3],
    [9, 2, true, true, 4],
    [12, 2, true, true, 4],
    [13, 3, true, true, 5],
    [16, 3, true, true, 5],
  ];
  it.each(table)('%i players', (n, traitors, murders, recruitment, endgameAt) => {
    expect(presetFor(n)).toEqual({ traitors, murders, recruitment, endgameAt });
  });

  it('rejects counts outside 4-16', () => {
    expect(() => presetFor(3)).toThrow();
    expect(() => presetFor(17)).toThrow();
  });

  it.each([4, 5, 6, 8, 11, 16])('deals the preset number of Traitors with %i players', (n) => {
    const s = started(n);
    expect(s.players.filter((p) => p.role === 'traitor')).toHaveLength(presetFor(n).traitors);
  });
});

describe('lobby', () => {
  it('needs 4 to 16 players and the host to start', () => {
    expect(apply(lobby(3), { type: 'start', actor: 'p1' }).error).toBeDefined();
    expect(apply(lobby(5), { type: 'start', actor: 'p2' }).error).toBeDefined();
    expect(apply(lobby(16), { type: 'join', id: 'x', name: 'x' }).error).toBeDefined();
    expect(apply(lobby(4), { type: 'join', id: 'p1', name: 'again' }).error).toBeDefined();
  });

  it('deals roles privately, and tells Traitors their team', () => {
    const r = ok(lobby(8), { type: 'start', actor: 'p1' });
    const dealt = r.events.filter((e) => e.type === 'RoleDealt');
    expect(dealt).toHaveLength(8);
    for (const e of dealt) {
      expect(e.audience).not.toBe('public');
      if (e.type === 'RoleDealt' && e.role === 'traitor') expect(e.team).toHaveLength(2);
      if (e.type === 'RoleDealt' && e.role === 'faithful') expect(e.team).toBeNull();
    }
  });

  it('is deterministic for a seed', () => {
    expect(started(9, 7)).toEqual(started(9, 7));
    expect(started(9, 7).players.map((p) => p.role)).not.toEqual(
      started(9, 8).players.map((p) => p.role),
    );
  });
});

describe('secrecy', () => {
  it('shows a role only during the reveal, then a Faithful card to everyone', () => {
    let s = withRoles(started(6), ['p2']);
    expect(view(s, 'p1').you?.role).toBe('faithful');
    expect(view(s, 'p2').you?.role).toBe('traitor');
    s = everyone(s, (a) => ({ type: 'ackRole', actor: a }));
    expect(s.phase.kind).toBe('mission');
    for (const p of ids(6)) {
      const you = view(s, p).you;
      expect(you?.role).toBeNull();
      expect(you?.card).toEqual({ role: 'faithful' });
    }
    expect(JSON.stringify(view(s, 'p2').you?.card)).toBe(JSON.stringify(view(s, 'p1').you?.card));
  });

  it('only tells Traitors who the team is', () => {
    const s = withRoles(started(8), ['p2', 'p5']);
    expect(view(s, 'p2').you?.team).toEqual(['p2', 'p5']);
    expect(view(s, 'p1').you?.team).toBeNull();
    expect(view(s, 'castle').you).toBeNull();
  });

  it('gives Traitor and Faithful night screens the same shape', () => {
    const s = at(withRoles(started(8), ['p2', 'p5']), { kind: 'night', mode: 'murder', picks: {} });
    const keys = (p: PlayerId) => Object.keys(view(s, p).you ?? {}).sort();
    expect(keys('p2')).toEqual(keys('p1'));
    expect(view(s, 'p2').timerMs).toBe(90_000);
    expect(view(s, 'p1').timerMs).toBe(90_000);
    expect(view(s, 'p1').phase).toEqual(view(s, 'p2').phase);
  });

  it('routes Faithful notes to a private journal and Traitor notes to the chat', () => {
    let s = at(withRoles(started(8), ['p2', 'p5']), { kind: 'night', mode: 'murder', picks: {} });
    s = ok(s, { type: 'nightNote', actor: 'p1', text: 'I suspect p3' }).state;
    const r = ok(s, { type: 'nightNote', actor: 'p2', text: 'take p4' });
    s = r.state;
    expect(r.events[0]?.audience).toEqual({ players: ['p2', 'p5'] });
    expect(view(s, 'p1').you?.journal).toEqual([{ night: 0, text: 'I suspect p3' }]);
    expect(view(s, 'p1').you?.chat).toEqual([]);
    expect(view(s, 'p5').you?.chat.map((m) => m.text)).toEqual(['take p4']);
    expect(view(s, 'p3').you?.chat).toEqual([]);
    expect(view(s, 'p3').you?.journal).toEqual([]);
  });

  it('keeps votes out of every view until the castle reveals them', () => {
    let s = at(started(5), {
      kind: 'voting',
      stage: 'main',
      candidates: ids(5),
      eligible: ids(5),
      votes: {},
    });
    s = ok(s, { type: 'vote', actor: 'p1', target: 'p2' }).state;
    expect(JSON.stringify(view(s, 'castle'))).not.toContain('"target"');
    expect(view(s, 'p3').phase).toEqual(view(s, 'castle').phase);
    expect(view(s, 'p1').you?.vote).toBe('p2');
    expect(view(s, 'p3').you?.vote).toBeNull();
  });
});

describe('mission', () => {
  const mission = (n: number) => tickTo(withRoles(started(n), ['p2']), 'mission');

  it('adds a fixed amount per correct answer to the pot and shows only the total', () => {
    let s = mission(6);
    if (s.phase.kind !== 'mission') throw new Error();
    const answers = s.phase.questions.map((q) => q.correct);
    s = ok(s, { type: 'submitAnswers', actor: 'p1', answers }).state;
    s = ok(s, { type: 'submitAnswers', actor: 'p3', answers }).state;
    for (const p of ['p2', 'p4', 'p5', 'p6'])
      s = ok(s, { type: 'submitAnswers', actor: p, answers: answers.map(() => null) }).state;
    expect(s.pot).toBe(2 * 8 * 100);
    expect(JSON.stringify(view(s, 'castle'))).not.toContain('score');
  });

  it('never sends the correct answers to anyone', () => {
    const s = mission(6);
    expect(JSON.stringify(view(s, 'p1'))).not.toContain('correct');
  });

  it('gives the top scorer a Shield in a murder game', () => {
    let s = mission(8);
    if (s.phase.kind !== 'mission') throw new Error();
    const right = s.phase.questions.map((q) => q.correct);
    const blank = right.map(() => null);
    for (const p of ids(8)) {
      s = ok(s, { type: 'submitAnswers', actor: p, answers: p === 'p3' ? right : blank }).state;
    }
    expect(s.players.find((p) => p.id === 'p3')?.shield).toBe(true);
    expect(s.players.filter((p) => p.shield)).toHaveLength(1);
    expect(view(s, 'p3').you?.shield).toBe(true);
    expect(view(s, 'p1').you?.shield).toBe(false);
  });

  it('gives a Faithful clue instead in a 4-5 player game, never about the winner', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      let s = tickTo(withRoles(started(5, seed), ['p2']), 'mission');
      if (s.phase.kind !== 'mission') throw new Error();
      const right = s.phase.questions.map((q) => q.correct);
      const blank = right.map(() => null);
      for (const p of ids(5)) {
        s = ok(s, { type: 'submitAnswers', actor: p, answers: p === 'p2' ? right : blank }).state;
      }
      const winner = s.players.find((p) => p.id === 'p2');
      expect(winner?.shield).toBe(false);
      expect(winner?.clues).toHaveLength(1);
      expect(winner?.clues[0]).not.toBe('p2');
      expect(roleOf(s, winner?.clues[0] as string)).toBe('faithful');
    }
  });

  it('gives no reward when nobody scores', () => {
    let s = mission(8);
    if (s.phase.kind !== 'mission') throw new Error();
    s = tick(s).state;
    expect(s.players.some((p) => p.shield)).toBe(false);
    expect(s.pot).toBe(0);
  });

  it('rejects malformed answers', () => {
    const s = mission(6);
    expect(apply(s, { type: 'submitAnswers', actor: 'p1', answers: [0] }).error).toBeDefined();
    expect(
      apply(s, { type: 'submitAnswers', actor: 'p1', answers: Array(8).fill(9) }).error,
    ).toBeDefined();
  });
});

describe('phase loop', () => {
  it('has no murder before the first Round Table', () => {
    let s = tickTo(started(8), 'mission');
    s = tick(s).state;
    expect(s.phase.kind).toBe('discussion');
    expect(s.players.every((p) => p.fate === 'alive')).toBe(true);
  });

  it('runs Mission -> Round Table -> Night -> Breakfast -> Mission', () => {
    let s = tickTo(started(8), 'discussion');
    const seen: string[] = [];
    for (let i = 0; i < 200 && s.phase.kind !== 'mission'; i++) {
      s = tick(s).state;
      if (seen.at(-1) !== s.phase.kind) seen.push(s.phase.kind);
    }
    expect(seen).toEqual([
      'voting',
      'voteReveal', // everyone abstains, so all tie and nobody is left to vote: random draw
      'speech',
      'night',
      'breakfast',
      'mission',
    ]);
  });

  it('skips the night entirely in 4-5 player games', () => {
    let s = tickTo(started(5), 'speech');
    s = tick(s).state;
    expect(s.phase.kind).toBe('mission');
  });

  it('ignores stale timeouts and unknown players', () => {
    const s = started(6);
    expect(apply(s, { type: 'timeout', epoch: s.epoch - 1 }).error).toBe('stale timeout');
    expect(apply(s, { type: 'ackRole', actor: 'nobody' }).error).toBeDefined();
  });
});

describe('night', () => {
  const night = (n: number, traitors: PlayerId[]) =>
    at(withRoles(started(n), traitors), { kind: 'night', mode: 'murder', picks: {} });

  it('only ends on the timer, never early', () => {
    let s = night(8, ['p2', 'p5']);
    for (const p of ids(8))
      s = ok(s, { type: 'nightPick', actor: p, target: p === 'p1' ? 'p2' : 'p1' }).state;
    expect(s.phase.kind).toBe('night');
    expect(tick(s).state.phase.kind).toBe('breakfast');
  });

  it('murders the plurality pick of the Traitors, ignoring Faithful picks', () => {
    let s = night(8, ['p2', 'p5']);
    s = ok(s, { type: 'nightPick', actor: 'p2', target: 'p3' }).state;
    s = ok(s, { type: 'nightPick', actor: 'p5', target: 'p3' }).state;
    for (const p of ['p1', 'p3', 'p4', 'p6', 'p7', 'p8'])
      s = ok(s, { type: 'nightPick', actor: p, target: p === 'p4' ? 'p1' : 'p4' }).state;
    s = tickTo(tick(s).state, 'mission');
    expect(fateOf(s, 'p3')).toBe('murdered');
    expect(fateOf(s, 'p4')).toBe('alive');
  });

  it('draws among tied picks', () => {
    const victims = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      let s = patch(night(8, ['p2', 'p5']), (d) => void (d.rng = seed));
      s = ok(s, { type: 'nightPick', actor: 'p2', target: 'p3' }).state;
      s = ok(s, { type: 'nightPick', actor: 'p5', target: 'p4' }).state;
      s = tickTo(tick(s).state, 'mission');
      const dead = s.players.filter((p) => p.fate === 'murdered');
      expect(dead).toHaveLength(1);
      victims.add(dead[0]?.id as string);
    }
    expect([...victims].sort()).toEqual(['p3', 'p4']);
  });

  it('falls back to a random Faithful when nobody picks, and never kills a Traitor', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s0 = patch(night(8, ['p2', 'p5']), (d) => void (d.rng = seed));
      const s = tickTo(tick(s0).state, 'mission');
      const dead = s.players.filter((p) => p.fate === 'murdered');
      expect(dead).toHaveLength(1);
      expect(dead[0]?.role).toBe('faithful');
    }
  });

  it('ignores a Traitor pick on a fellow Traitor', () => {
    let s = night(8, ['p2', 'p5']);
    s = ok(s, { type: 'nightPick', actor: 'p2', target: 'p5' }).state;
    s = ok(s, { type: 'nightPick', actor: 'p5', target: 'p2' }).state;
    s = tickTo(tick(s).state, 'mission');
    expect(s.players.filter((p) => p.fate === 'murdered' && p.role === 'traitor')).toHaveLength(0);
  });

  it('keeps the victim alive and unannounced until breakfast says so', () => {
    let s = night(8, ['p2', 'p5']);
    s = ok(s, { type: 'nightPick', actor: 'p2', target: 'p3' }).state;
    s = ok(s, { type: 'nightPick', actor: 'p5', target: 'p3' }).state;
    s = tick(s).state;
    expect(s.phase.kind).toBe('breakfast');
    expect(fateOf(s, 'p3')).toBe('alive');
    expect(JSON.stringify(view(s, 'castle'))).not.toContain('"victim":"p3"');
    const arrivals = s.phase.kind === 'breakfast' ? s.phase.order.length : 0;
    expect(arrivals).toBe(7);
    for (let i = 0; i < arrivals; i++) s = tick(s).state;
    expect(fateOf(s, 'p3')).toBe('alive');
    const r = tick(s);
    expect(fateOf(r.state, 'p3')).toBe('murdered');
    expect(r.events.find((e) => e.type === 'BreakfastResult')).toMatchObject({ victim: 'p3' });
    expect(r.state.players.find((p) => p.id === 'p3')?.revealed).toBe(false);
  });

  it('lets a Shield block the murder silently, telling only the Traitors', () => {
    let s = night(8, ['p2', 'p5']);
    s = patch(s, (d) => void (d.players.find((p) => p.id === 'p3')!.shield = true));
    s = ok(s, { type: 'nightPick', actor: 'p2', target: 'p3' }).state;
    s = ok(s, { type: 'nightPick', actor: 'p5', target: 'p3' }).state;
    s = tick(s).state;
    let events: GameEvent[] = [];
    for (let i = 0; i < 9; i++) {
      const r = tick(s);
      s = r.state;
      events = events.concat(r.events);
    }
    expect(s.players.every((p) => p.fate === 'alive')).toBe(true);
    expect(events.find((e) => e.type === 'BreakfastResult')).toMatchObject({ victim: null });
    const failed = events.filter((e) => e.type === 'MurderFailed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.audience).toEqual({ players: ['p2', 'p5'] });
    expect(JSON.stringify(events.filter((e) => e.audience === 'public'))).not.toContain('Shield');
    expect(s.players.some((p) => p.shield)).toBe(false);
  });

  it('turns a dead player into a ghost who cannot act', () => {
    const s = kill(night(8, ['p2', 'p5']), ['p3'], 'murdered');
    expect(apply(s, { type: 'nightPick', actor: 'p3', target: 'p1' }).error).toBeDefined();
    expect(view(s, 'p3').you?.alive).toBe(false);
    expect(view(s, 'p3').you?.chat).toEqual([]);
  });
});

describe('recruitment', () => {
  const afterBanish = (n: number, traitors: PlayerId[], banished: PlayerId) => {
    let s = withRoles(started(n), traitors);
    s = at(s, { kind: 'voting', stage: 'main', candidates: ids(n), eligible: ids(n), votes: {} });
    s = everyone(s, (a) => ({ type: 'vote', actor: a, target: a === banished ? 'p1' : banished }));
    s = tickTo(s, 'speech');
    return s;
  };

  it('opens a recruitment night after a Traitor is banished, when 2+ Traitors started', () => {
    let s = afterBanish(9, ['p2', 'p5'], 'p2');
    expect(s.recruitPending).toBe(true);
    s = tick(s).state;
    expect(s.phase).toMatchObject({ kind: 'night', mode: 'recruit' });
    expect(view(s, 'p1').phase).toEqual({ kind: 'night' });
  });

  it('never recruits in games that started with one Traitor', () => {
    // the Traitor is banished, so the game ends; the point is that no recruitment is queued
    const s = afterBanish(7, ['p2'], 'p2');
    expect(s.recruitPending).toBe(false);
    expect(tick(s).state.phase.kind).toBe('finalReveal');
    const faithful = tick(afterBanish(7, ['p2'], 'p3')).state;
    expect(faithful.recruitPending).toBe(false);
    expect(faithful.phase).toMatchObject({ kind: 'night', mode: 'murder' });
  });

  it('does not recruit after a Faithful is banished', () => {
    const s = tick(afterBanish(9, ['p2', 'p5'], 'p3')).state;
    expect(s.phase).toMatchObject({ kind: 'night', mode: 'murder' });
  });

  it('lets the recruit accept or decline when 2+ Traitors remain, then murders anyway', () => {
    for (const accept of [true, false]) {
      let s = tick(afterBanish(12, ['p2', 'p5'], 'p2')).state;
      s = patch(s, (d) => void (d.players.find((p) => p.id === 'p5')!.role = 'traitor'));
      s = patch(s, (d) => void (d.players.find((p) => p.id === 'p6')!.role = 'traitor'));
      s = ok(s, { type: 'nightPick', actor: 'p5', target: 'p3' }).state;
      s = ok(s, { type: 'nightPick', actor: 'p6', target: 'p3' }).state;
      s = tick(s).state;
      expect(s.phase).toMatchObject({
        kind: 'recruitOffer',
        recruit: 'p3',
        ultimatum: false,
        thenMurder: true,
      });
      expect(view(s, 'p3').you?.offer).toEqual({ ultimatum: false });
      expect(view(s, 'p1').you?.offer).toBeNull();
      expect(apply(s, { type: 'recruitReply', actor: 'p1', accept: true }).error).toBeDefined();
      s = ok(s, { type: 'recruitReply', actor: 'p3', accept }).state;
      expect(roleOf(s, 'p3')).toBe(accept ? 'traitor' : 'faithful');
      expect(s.phase).toMatchObject({ kind: 'night', mode: 'murder' });
      s = tickTo(tick(s).state, 'mission');
      expect(s.players.filter((p) => p.fate === 'murdered')).toHaveLength(1);
    }
  });

  it('sets an ultimatum with one Traitor left: decline and the recruit is the victim', () => {
    let s = tick(afterBanish(8, ['p2', 'p5'], 'p2')).state;
    s = ok(s, { type: 'nightPick', actor: 'p5', target: 'p3' }).state;
    s = tick(s).state;
    expect(s.phase).toMatchObject({
      kind: 'recruitOffer',
      recruit: 'p3',
      ultimatum: true,
      thenMurder: false,
    });
    const declined = ok(s, { type: 'recruitReply', actor: 'p3', accept: false }).state;
    expect(declined.phase).toMatchObject({ kind: 'breakfast', victim: 'p3' });
    expect(roleOf(declined, 'p3')).toBe('faithful');
    const accepted = ok(s, { type: 'recruitReply', actor: 'p3', accept: true });
    expect(accepted.state.phase).toMatchObject({ kind: 'breakfast', victim: null });
    expect(roleOf(accepted.state, 'p3')).toBe('traitor');
    expect(accepted.state.players.find((p) => p.id === 'p3')?.recruited).toBe(true);
    const told = accepted.events.find((e) => e.type === 'Recruited');
    expect(told?.audience).toEqual({ players: ['p5', 'p3'] });
    expect(accepted.events.filter((e) => e.audience === 'public').map((e) => e.type)).toEqual([
      'PhaseStarted',
    ]);
    expect(view(accepted.state, 'p3').you?.team).toEqual(['p3', 'p5'].sort());
  });

  it('treats a missing answer as a decline', () => {
    let s = tick(afterBanish(8, ['p2', 'p5'], 'p2')).state;
    s = ok(s, { type: 'nightPick', actor: 'p5', target: 'p3' }).state;
    s = tick(tick(s).state).state;
    expect(s.phase).toMatchObject({ kind: 'breakfast', victim: 'p3' });
  });

  it('lets a Shield block the ultimatum kill', () => {
    let s = tick(afterBanish(8, ['p2', 'p5'], 'p2')).state;
    s = patch(s, (d) => void (d.players.find((p) => p.id === 'p3')!.shield = true));
    s = ok(s, { type: 'nightPick', actor: 'p5', target: 'p3' }).state;
    s = ok(tick(s).state, { type: 'recruitReply', actor: 'p3', accept: false }).state;
    expect(s.phase).toMatchObject({ kind: 'breakfast', victim: null, murderFailed: true });
  });
});

describe('round table', () => {
  const voting = (n: number) =>
    at(started(n), {
      kind: 'voting',
      stage: 'main',
      candidates: ids(n),
      eligible: ids(n),
      votes: {},
    });

  it('opens voting at two thirds ready', () => {
    let s = at(started(6), { kind: 'discussion', ready: [] });
    for (const p of ['p1', 'p2', 'p3']) s = ok(s, { type: 'ready', actor: p }).state;
    expect(s.phase.kind).toBe('discussion');
    s = ok(s, { type: 'ready', actor: 'p4' }).state;
    expect(s.phase.kind).toBe('voting');
  });

  it('rejects self-votes and votes for non-candidates, and double votes', () => {
    const s = voting(6);
    expect(apply(s, { type: 'vote', actor: 'p1', target: 'p1' }).error).toBeDefined();
    expect(apply(s, { type: 'vote', actor: 'p1', target: 'nobody' }).error).toBeDefined();
    const once = ok(s, { type: 'vote', actor: 'p1', target: 'p2' }).state;
    expect(apply(once, { type: 'vote', actor: 'p1', target: 'p3' }).error).toBeDefined();
  });

  it('reveals votes one at a time in the castle, then banishes the plurality', () => {
    let s = voting(6);
    s = everyone(s, (a) => ({ type: 'vote', actor: a, target: a === 'p1' ? 'p2' : 'p1' }));
    expect(s.phase.kind).toBe('voteReveal');
    const events: GameEvent[] = [];
    for (let i = 1; i <= 6; i++) {
      const r = tick(s);
      s = r.state;
      events.push(...r.events);
      const shown = view(s, 'castle').phase;
      expect(shown.kind === 'voteReveal' && shown.revealed.length).toBe(i);
    }
    expect(types(events).filter((t) => t === 'VoteRevealed')).toHaveLength(6);
    s = tick(s).state;
    expect(s.phase).toMatchObject({ kind: 'speech', player: 'p1' });
    expect(fateOf(s, 'p1')).toBe('banished');
    expect(s.players.find((p) => p.id === 'p1')?.revealed).toBe(true);
  });

  it('sends ties to a run-off between the tied, who do not vote', () => {
    let s = voting(6);
    const picks: Record<string, string> = {
      p1: 'p2',
      p2: 'p1',
      p3: 'p1',
      p4: 'p2',
      p5: 'p6',
      p6: 'p5',
    };
    s = everyone(s, (a) => ({ type: 'vote', actor: a, target: picks[a] as string }));
    s = tickTo(s, 'voting');
    expect(s.phase).toMatchObject({ kind: 'voting', stage: 'runoff' });
    if (s.phase.kind !== 'voting') throw new Error();
    expect(s.phase.candidates.sort()).toEqual(['p1', 'p2']);
    expect(s.phase.eligible.sort()).toEqual(['p3', 'p4', 'p5', 'p6']);
    expect(apply(s, { type: 'vote', actor: 'p1', target: 'p2' }).error).toBeDefined();
    expect(apply(s, { type: 'vote', actor: 'p3', target: 'p5' }).error).toBeDefined();
    for (const p of ['p3', 'p4', 'p5', 'p6'])
      s = ok(s, { type: 'vote', actor: p, target: 'p2' }).state;
    expect(tickTo(s, 'speech').phase).toMatchObject({ kind: 'speech', player: 'p2' });
  });

  it('draws at random when the run-off ties too', () => {
    const banished = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      let s = patch(voting(6), (d) => void (d.rng = seed));
      const picks: Record<string, string> = {
        p1: 'p2',
        p2: 'p1',
        p3: 'p1',
        p4: 'p2',
        p5: 'p6',
        p6: 'p5',
      };
      s = everyone(s, (a) => ({ type: 'vote', actor: a, target: picks[a] as string }));
      s = tickTo(s, 'voting');
      s = ok(s, { type: 'vote', actor: 'p3', target: 'p1' }).state;
      s = ok(s, { type: 'vote', actor: 'p4', target: 'p2' }).state;
      s = tickTo(s, 'speech');
      const r = banishedOf(s);
      banished.add(r);
    }
    expect([...banished].sort()).toEqual(['p1', 'p2']);
  });

  it('draws immediately when everyone is tied and nobody is left to vote', () => {
    let s = voting(4);
    s = everyone(s, (a) => ({ type: 'vote', actor: a, target: null }));
    const events: GameEvent[] = [];
    let cur = s;
    while (cur.phase.kind !== 'speech') {
      const r = tick(cur);
      cur = r.state;
      events.push(...r.events);
    }
    expect(types(events)).toContain('RandomDraw');
    expect(cur.players.filter((p) => p.fate === 'banished')).toHaveLength(1);
  });

  it('treats missing votes as abstentions', () => {
    let s = voting(6);
    s = ok(s, { type: 'vote', actor: 'p1', target: 'p2' }).state;
    s = tickTo(tick(s).state, 'speech');
    expect(banishedOf(s)).toBe('p2');
  });

  it('reveals the banished role, unless the setting stops it in the endgame', () => {
    const run = (setting: 'always' | 'until-endgame', n: number, alive: PlayerId[]) => {
      let s = patch(started(n), (d) => void (d.config.revealRoles = setting));
      s = kill(
        s,
        ids(n).filter((p) => !alive.includes(p)),
      );
      s = at(s, { kind: 'voting', stage: 'main', candidates: alive, eligible: alive, votes: {} });
      s = everyone(s, (a) => ({ type: 'vote', actor: a, target: a === 'p1' ? 'p2' : 'p1' }));
      return tickTo(s, 'speech');
    };
    expect(run('until-endgame', 8, ids(8)).players.find((p) => p.id === 'p1')?.revealed).toBe(true);
    expect(
      run('until-endgame', 8, ['p1', 'p2', 'p3']).players.find((p) => p.id === 'p1')?.revealed,
    ).toBe(false);
    expect(run('always', 8, ['p1', 'p2', 'p3']).players.find((p) => p.id === 'p1')?.revealed).toBe(
      true,
    );
  });
});

describe('endgame', () => {
  const endgame = (n: number, alive: PlayerId[], traitors: PlayerId[]) =>
    at(
      kill(
        withRoles(started(n), traitors),
        ids(n).filter((p) => !alive.includes(p)),
      ),
      {
        kind: 'endgameVote',
        votes: {},
      },
    );

  it('opens each Round Table with the secret vote once the threshold is reached', () => {
    const s = tickTo(kill(withRoles(started(5), ['p2']), ['p4', 'p5']), 'mission');
    const r = patch(s, (d) => void (d.phase = { kind: 'mission', questions: [], answers: {} }));
    expect(tick(r).state.phase.kind).toBe('endgameVote');
  });

  it('ends the game on a unanimous vote to end, and the Traitors take the pot', () => {
    let s = endgame(5, ['p1', 'p2', 'p3'], ['p2']);
    s = patch(s, (d) => void (d.pot = 1000));
    s = everyone(s, (a) => ({ type: 'endgameVote', actor: a, choice: 'end' }));
    expect(s.phase.kind).toBe('finalReveal');
    expect(s.result).toEqual({ winner: 'traitors', pot: 1000, payouts: { p2: 1000 } });
    expect(view(s, 'castle').phase).toMatchObject({ roles: { p1: 'faithful', p2: 'traitor' } });
  });

  it('splits the pot between surviving Faithfuls when every Traitor is gone', () => {
    let s = endgame(5, ['p1', 'p3', 'p4'], ['p2']);
    s = patch(s, (d) => void (d.pot = 1000));
    s = everyone(s, (a) => ({ type: 'endgameVote', actor: a, choice: 'end' }));
    expect(s.result?.winner).toBe('faithful');
    expect(s.result?.payouts).toEqual({ p1: 333, p3: 333, p4: 333 });
  });

  it('continues to a normal banishment unless the vote is unanimous', () => {
    let s = endgame(5, ['p1', 'p2', 'p3'], ['p2']);
    s = ok(s, { type: 'endgameVote', actor: 'p1', choice: 'end' }).state;
    s = ok(s, { type: 'endgameVote', actor: 'p2', choice: 'end' }).state;
    expect(apply(s, { type: 'endgameVote', actor: 'p2', choice: 'continue' }).error).toBeDefined();
    s = ok(s, { type: 'endgameVote', actor: 'p3', choice: 'continue' }).state;
    expect(s.phase.kind).toBe('discussion');
  });

  it('treats a missing endgame vote as a vote to continue', () => {
    let s = endgame(5, ['p1', 'p2', 'p3'], ['p2']);
    s = ok(s, { type: 'endgameVote', actor: 'p1', choice: 'end' }).state;
    expect(tick(s).state.phase.kind).toBe('discussion');
  });

  it('ends at 2 players and when the last Traitor is banished', () => {
    const banishOne = (alive: PlayerId[], traitors: PlayerId[], out: PlayerId) => {
      let s = withRoles(started(5), traitors);
      s = kill(
        s,
        ids(5).filter((p) => !alive.includes(p)),
      );
      s = at(s, { kind: 'voting', stage: 'main', candidates: alive, eligible: alive, votes: {} });
      s = everyone(s, (a) => ({
        type: 'vote',
        actor: a,
        target: a === out ? alive.find((x) => x !== out)! : out,
      }));
      return tick(tickTo(s, 'speech')).state;
    };
    expect(banishOne(['p1', 'p2', 'p3'], ['p2'], 'p3').phase.kind).toBe('finalReveal');
    const last = banishOne(['p1', 'p2', 'p3', 'p4'], ['p2'], 'p2');
    expect(last.phase.kind).toBe('finalReveal');
    expect(last.result?.winner).toBe('faithful');
  });

  it('stops murders in the endgame (no night when alive is at the threshold)', () => {
    let s = withRoles(started(9), ['p2', 'p5']);
    s = kill(s, ['p6', 'p7', 'p8', 'p9']);
    s = at(s, { kind: 'voting', stage: 'main', candidates: ids(5), eligible: ids(5), votes: {} });
    s = everyone(s, (a) => ({ type: 'vote', actor: a, target: a === 'p1' ? 'p3' : 'p1' }));
    s = tick(tickTo(s, 'speech')).state;
    expect(s.phase.kind).toBe('mission');
    expect(s.players.filter((p) => p.fate === 'alive')).toHaveLength(4);
  });
});

function banishedOf(s: GameState): string {
  const dead = s.players.filter((p) => p.fate === 'banished');
  expect(dead).toHaveLength(1);
  return dead[0]?.id as string;
}

describe('determinism', () => {
  it('apply never mutates its input', () => {
    const s = started(8);
    const frozen = JSON.stringify(s);
    apply(s, { type: 'ackRole', actor: 'p1' });
    apply(s, { type: 'timeout', epoch: s.epoch });
    expect(JSON.stringify(s)).toBe(frozen);
  });

  it('replays identically from the same seed and actions', () => {
    const play = () => {
      let s = started(10, 42);
      for (let i = 0; i < 80 && s.phase.kind !== 'finalReveal'; i++) s = tick(s).state;
      return s;
    };
    expect(play()).toEqual(play());
  });
});

describe('host escape hatch actions', () => {
  it('re-runs the current vote with clean ballots', () => {
    let s = at(started(6), {
      kind: 'voting',
      stage: 'main',
      candidates: ids(6),
      eligible: ids(6),
      votes: {},
    });
    s = ok(s, { type: 'vote', actor: 'p1', target: 'p2' }).state;
    const r = ok(s, { type: 'rerunVote' });
    expect(r.state.phase).toMatchObject({ kind: 'voting', votes: {} });
    expect(r.state.epoch).toBeGreaterThan(s.epoch);
    let rev = everyone(r.state, (a) => ({
      type: 'vote',
      actor: a,
      target: a === 'p1' ? 'p2' : 'p1',
    }));
    expect(rev.phase.kind).toBe('voteReveal');
    rev = ok(rev, { type: 'rerunVote' }).state;
    expect(rev.phase).toMatchObject({ kind: 'voting', votes: {} });
    expect(apply(started(6), { type: 'rerunVote' }).error).toBeDefined();
  });

  it('ends the game on demand with the usual payout', () => {
    const s = patch(at(withRoles(started(6), ['p2']), { kind: 'discussion', ready: [] }), (d) => {
      d.pot = 500;
    });
    const r = ok(s, { type: 'endGame' });
    expect(r.state.phase.kind).toBe('finalReveal');
    expect(r.state.result).toEqual({ winner: 'traitors', pot: 500, payouts: { p2: 500 } });
    expect(apply(lobby(5), { type: 'endGame' }).error).toBeDefined();
  });
});

describe('ghost predictions (R26)', () => {
  const ghosted = () => kill(withRoles(started(8), ['p2', 'p5']), ['p3'], 'murdered');

  it('lets a ghost set and replace a private guess, and nobody else sees it', () => {
    let s = ghosted();
    s = ok(s, { type: 'predict', actor: 'p3', suspects: ['p2'] }).state;
    s = ok(s, { type: 'predict', actor: 'p3', suspects: ['p5', 'p1'] }).state;
    expect(view(s, 'p3').you?.prediction).toEqual(['p5', 'p1']);
    for (const viewer of ['castle', 'p1', 'p2', 'p4'] as const) {
      expect(JSON.stringify(view(s, viewer))).not.toContain('"predictions"');
      expect(view(s, viewer).you?.prediction ?? []).toEqual([]);
    }
  });

  it('rejects living players, bad suspects and too many suspects, changing nothing', () => {
    const s = ghosted();
    const bad: Action[] = [
      { type: 'predict', actor: 'p1', suspects: ['p2'] },
      { type: 'predict', actor: 'p3', suspects: ['p3'] },
      { type: 'predict', actor: 'p3', suspects: ['nobody'] },
      { type: 'predict', actor: 'p3', suspects: ['p2', 'p2'] },
      { type: 'predict', actor: 'p3', suspects: ['p1', 'p2', 'p4'] },
    ];
    for (const a of bad) {
      const r = apply(s, a);
      expect(r.error).toBeDefined();
      expect(r.state).toBe(s);
    }
  });

  it('never changes the game, and is scored in the final reveal only', () => {
    const base = ghosted();
    const guessed = ok(base, { type: 'predict', actor: 'p3', suspects: ['p2', 'p1'] }).state;
    expect(tick(guessed).state.rng).toBe(tick(base).state.rng);
    expect(tick(guessed).state.phase).toEqual(tick(base).state.phase);

    const end = ok(guessed, { type: 'endGame' }).state;
    const ph = view(end, 'p1').phase;
    expect(ph.kind === 'finalReveal' && ph.predictions).toEqual([
      { ghost: 'p3', suspects: ['p2', 'p1'], hits: 1 },
    ]);
    expect(apply(end, { type: 'predict', actor: 'p3', suspects: [] }).error).toBeDefined();
  });
});

describe('physical mission cards (R25)', () => {
  const N = 12;
  const physical = () => {
    let s = lobby(N);
    s = ok(s, { type: 'setPhysicalMissions', on: true }).state;
    return ok(s, { type: 'start', actor: 'p1' }).state;
  };
  /** Ticks on to the next mission screen of either kind. */
  const nextMission = (s: GameState): GameState => {
    let cur = tick(s).state;
    for (let i = 0; i < 400; i++) {
      if (cur.phase.kind === 'mission' || cur.phase.kind === 'physicalMission') return cur;
      cur = tick(cur).state;
    }
    throw new Error('no mission');
  };
  const atPhysical = (): GameState => {
    const next = nextMission(tickTo(physical(), 'mission'));
    expect(next.phase.kind).toBe('physicalMission');
    return next;
  };

  it('is off by default and can only be changed in the lobby', () => {
    expect(started(6).physicalMissions).toBe(false);
    expect(apply(physical(), { type: 'setPhysicalMissions', on: false }).error).toBeDefined();
  });

  it('alternates quiz and physical missions, starting with the quiz', () => {
    let s = tickTo(physical(), 'mission');
    expect(s.day).toBe(1);
    s = nextMission(s);
    expect([s.phase.kind, s.day]).toEqual(['physicalMission', 2]);
    s = nextMission(s);
    expect([s.phase.kind, s.day]).toEqual(['mission', 3]);
  });

  const living = (s: GameState) => s.players.filter((p) => p.fate === 'alive').map((p) => p.id);

  it('needs a strict majority of the living to pass, and counts missing votes as fail', () => {
    const base = atPhysical();
    const pot = base.pot;
    const who = living(base);
    const run = (passes: number, missing = 0) => {
      let s = base;
      who.forEach((p, i) => {
        if (i < passes) s = ok(s, { type: 'physicalVote', actor: p, pass: true }).state;
        else if (i < who.length - missing) {
          s = ok(s, { type: 'physicalVote', actor: p, pass: false }).state;
        }
      });
      return s.phase.kind === 'physicalMission' ? tick(s) : { state: s };
    };
    const half = Math.floor(who.length / 2);
    const win = run(half + 1);
    expect(win.state.pot).toBe(pot + 400);
    expect(win.state.phase.kind).not.toBe('physicalMission');
    expect(win.state.history.some((e) => e.type === 'PhysicalResult' && e.passed)).toBe(true);
    if (who.length % 2 === 0) expect(run(half).state.pot).toBe(pot); // exactly half is not enough
    expect(run(half, who.length - half).state.pot).toBe(pot); // missing votes are fails
    expect(run(0).state.pot).toBe(pot);
  });

  it('keeps votes secret, gives no Shield or clue, and rejects repeats', () => {
    let s = atPhysical();
    const [first, second, ...rest] = living(s) as [string, string, ...string[]];
    s = ok(s, { type: 'physicalVote', actor: first, pass: false }).state;
    expect(apply(s, { type: 'physicalVote', actor: first, pass: true }).error).toBeDefined();
    expect(view(s, first).you?.physicalVote).toBe('fail');
    expect(view(s, second).you?.physicalVote).toBeNull();
    expect(JSON.stringify(view(s, 'castle'))).not.toContain('"fail"');
    for (const p of [second, ...rest]) {
      s = ok(s, { type: 'physicalVote', actor: p, pass: true }).state;
    }
    expect(s.players.some((p) => p.shield || p.clues.length > 0)).toBe(false);
  });

  it('never repeats a card within a game', () => {
    let s = atPhysical();
    for (let i = 0; i < 3; i++) {
      try {
        s = nextMission(nextMission(s));
      } catch {
        break; // the game ended
      }
    }
    expect(new Set(s.askedCards).size).toBe(s.askedCards.length);
  });
});
