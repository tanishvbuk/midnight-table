import { DEFAULT_CONFIG, MAX_PLAYERS, MIN_PLAYERS, NIGHT_MS, presetFor } from './presets';
import { QUESTION_BANK } from './questions';
import { rngOver, type Rng } from './rng';
import type {
  Action,
  ApplyResult,
  Audience,
  Config,
  EventBody,
  GameEvent,
  GameState,
  Phase,
  PlayerId,
  PlayerState,
  Preset,
  Role,
  Winner,
} from './types';

const MAX_NAME = 24;
const MAX_NOTE = 200;
const MAX_AVATAR = 80_000;
const MAX_NOTES_PER_NIGHT = 20;

export interface CreateGameOptions {
  seed: number;
  config?: Partial<Omit<Config, 'timers'>> & { timers?: Partial<Config['timers']> };
}

export function createGame(options: CreateGameOptions): GameState {
  const base = DEFAULT_CONFIG;
  const config: Config = {
    ...base,
    ...options.config,
    timers: { ...base.timers, ...options.config?.timers },
  };
  return {
    rng: options.seed >>> 0,
    epoch: 0,
    config,
    preset: null,
    hostId: null,
    initialTraitors: 0,
    players: [],
    day: 0,
    night: 0,
    pot: 0,
    recruitPending: false,
    phase: { kind: 'lobby' },
    notes: [],
    result: null,
  };
}

interface Ctx {
  s: GameState;
  events: GameEvent[];
  rng: Rng;
}

class Reject extends Error {}

function reject(message: string): never {
  throw new Reject(message);
}

/**
 * The whole rules engine. Pure: the input state is never mutated, randomness comes from the
 * seeded generator stored in the state, and time only exists as `timeout` actions.
 */
export function apply(state: GameState, action: Action): ApplyResult {
  const s = structuredClone(state);
  const c: Ctx = {
    s,
    events: [],
    rng: rngOver(
      () => s.rng,
      (v) => (s.rng = v),
    ),
  };
  try {
    handle(c, action);
  } catch (e) {
    if (e instanceof Reject) return { state, events: [], error: e.message };
    throw e;
  }
  return { state: s, events: c.events };
}

// ---------------------------------------------------------------- queries

export function alivePlayers(s: GameState): PlayerState[] {
  return s.players.filter((p) => p.fate === 'alive');
}

function aliveCount(s: GameState): number {
  return alivePlayers(s).length;
}

function traitorsAlive(s: GameState): PlayerState[] {
  return alivePlayers(s).filter((p) => p.role === 'traitor');
}

function faithfulsAlive(s: GameState): PlayerState[] {
  return alivePlayers(s).filter((p) => p.role === 'faithful');
}

export function getPlayer(s: GameState, id: PlayerId): PlayerState | undefined {
  return s.players.find((p) => p.id === id);
}

function presetOf(s: GameState): Preset {
  if (!s.preset) throw new Error('game has not started');
  return s.preset;
}

export function inEndgame(s: GameState): boolean {
  return s.preset !== null && aliveCount(s) <= s.preset.endgameAt;
}

// ---------------------------------------------------------------- plumbing

function emit(c: Ctx, body: EventBody, audience: Audience = 'public'): void {
  c.events.push({ ...body, audience } as GameEvent);
}

function bump(c: Ctx): void {
  c.s.epoch++;
}

function enter(c: Ctx, phase: Phase): void {
  c.s.phase = phase;
  bump(c);
  emit(c, { type: 'PhaseStarted', phase: phase.kind, epoch: c.s.epoch, day: c.s.day });
}

function toPlayers(ids: PlayerId[]): Audience {
  return { players: ids };
}

function ids(players: PlayerState[]): PlayerId[] {
  return players.map((p) => p.id);
}

function plurality(c: Ctx, counts: Map<PlayerId, number>): PlayerId | null {
  let max = 0;
  for (const n of counts.values()) max = Math.max(max, n);
  if (max === 0) return null;
  const tied = [...counts].filter(([, n]) => n === max).map(([id]) => id);
  return tied.length === 1 ? (tied[0] as PlayerId) : c.rng.pick(tied);
}

// ---------------------------------------------------------------- dispatch

function handle(c: Ctx, a: Action): void {
  const { s } = c;
  switch (a.type) {
    case 'join':
      return join(c, a);
    case 'leave':
      return leave(c, a.actor);
    case 'start':
      return start(c, a.actor);
    case 'timeout':
      if (a.epoch !== s.epoch) reject('stale timeout');
      return onTimeout(c);
    case 'rerunVote':
      return rerunVote(c);
    case 'endGame':
      if (s.phase.kind === 'lobby' || s.phase.kind === 'finalReveal') reject('no game to end');
      return finish(c);
    default:
      break;
  }
  const actor = getPlayer(s, a.actor);
  if (!actor) reject('unknown player');
  if (actor.fate !== 'alive') reject('eliminated players cannot act');
  switch (a.type) {
    case 'ackRole':
      return ackRole(c, a.actor);
    case 'submitAnswers':
      return submitAnswers(c, a.actor, a.answers);
    case 'ready':
      return ready(c, a.actor);
    case 'vote':
      return castVote(c, a.actor, a.target);
    case 'endgameVote':
      return castEndgameVote(c, a.actor, a.choice);
    case 'nightPick':
      return nightPick(c, a.actor, a.target);
    case 'nightNote':
      return nightNote(c, actor, a.text);
    case 'recruitReply':
      return recruitReply(c, a.actor, a.accept);
  }
}

function onTimeout(c: Ctx): void {
  const p = c.s.phase;
  switch (p.kind) {
    case 'lobby':
    case 'finalReveal':
      return reject('phase has no timer');
    case 'roleReveal':
      return startMission(c);
    case 'mission':
      return resolveMission(c);
    case 'endgameVote':
      return resolveEndgameVote(c);
    case 'discussion':
      return openVoting(c);
    case 'voting':
      return closeVoting(c);
    case 'voteReveal':
      return stepVoteReveal(c);
    case 'speech':
      return afterBanish(c);
    case 'night':
      return resolveNight(c);
    case 'recruitOffer':
      return resolveRecruit(c, false);
    case 'breakfast':
      return stepBreakfast(c);
  }
}

// ---------------------------------------------------------------- lobby

function join(c: Ctx, a: Extract<Action, { type: 'join' }>): void {
  const { s } = c;
  if (s.phase.kind !== 'lobby') reject('game already started');
  if (s.players.length >= MAX_PLAYERS) reject('room is full');
  if (s.players.some((p) => p.id === a.id)) reject('already joined');
  const name = a.name.trim();
  if (name.length < 1 || name.length > MAX_NAME) reject('invalid name');
  if (a.avatar && a.avatar.length > MAX_AVATAR) reject('avatar too large');
  s.players.push({
    id: a.id,
    name,
    avatar: a.avatar ?? null,
    role: 'faithful',
    fate: 'alive',
    revealed: false,
    recruited: false,
    shield: false,
    clues: [],
  });
  s.hostId ??= a.id;
  emit(c, { type: 'PlayerJoined', id: a.id, name });
}

function leave(c: Ctx, id: PlayerId): void {
  const { s } = c;
  if (s.phase.kind !== 'lobby') reject('game already started');
  if (!getPlayer(s, id)) reject('unknown player');
  s.players = s.players.filter((p) => p.id !== id);
  if (s.hostId === id) s.hostId = s.players[0]?.id ?? null;
  emit(c, { type: 'PlayerLeft', id });
}

function start(c: Ctx, actor: PlayerId): void {
  const { s } = c;
  if (s.phase.kind !== 'lobby') reject('game already started');
  if (actor !== s.hostId) reject('only the host can start');
  const n = s.players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) reject(`need ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
  const preset = presetFor(n);
  s.preset = preset;
  s.initialTraitors = preset.traitors;
  const traitorIds = new Set(c.rng.shuffle(ids(s.players)).slice(0, preset.traitors));
  for (const p of s.players) p.role = traitorIds.has(p.id) ? 'traitor' : 'faithful';
  emit(c, { type: 'GameStarted', players: n, traitors: preset.traitors });
  const team = [...traitorIds];
  for (const p of s.players) {
    emit(
      c,
      { type: 'RoleDealt', role: p.role, team: p.role === 'traitor' ? team : null },
      toPlayers([p.id]),
    );
  }
  enter(c, { kind: 'roleReveal', acked: [] });
}

// ---------------------------------------------------------------- role reveal

function ackRole(c: Ctx, actor: PlayerId): void {
  const p = c.s.phase;
  if (p.kind !== 'roleReveal') reject('not in role reveal');
  if (!p.acked.includes(actor)) p.acked.push(actor);
  if (alivePlayers(c.s).every((x) => p.acked.includes(x.id))) startMission(c);
}

// ---------------------------------------------------------------- mission

function startMission(c: Ctx): void {
  const { s } = c;
  s.day++;
  for (const p of s.players) p.shield = false;
  const questions = c.rng
    .shuffle(QUESTION_BANK)
    .slice(0, s.config.questionsPerMission)
    .map((q) => structuredClone(q));
  enter(c, { kind: 'mission', questions, answers: {} });
}

function submitAnswers(c: Ctx, actor: PlayerId, answers: (number | null)[]): void {
  const p = c.s.phase;
  if (p.kind !== 'mission') reject('not in a mission');
  if (p.answers[actor]) reject('already answered');
  if (!Array.isArray(answers) || answers.length !== p.questions.length) {
    reject('wrong number of answers');
  }
  answers.forEach((ans, i) => {
    const q = p.questions[i];
    if (ans !== null && (!Number.isInteger(ans) || ans < 0 || ans >= (q?.options.length ?? 0))) {
      reject('invalid answer');
    }
  });
  p.answers[actor] = answers.slice();
  if (alivePlayers(c.s).every((x) => p.answers[x.id])) resolveMission(c);
}

function resolveMission(c: Ctx): void {
  const { s } = c;
  const p = s.phase;
  if (p.kind !== 'mission') return;
  const scores = new Map<PlayerId, number>();
  let correct = 0;
  for (const pl of alivePlayers(s)) {
    const given = p.answers[pl.id] ?? [];
    const score = p.questions.reduce((n, q, i) => n + (given[i] === q.correct ? 1 : 0), 0);
    scores.set(pl.id, score);
    correct += score;
  }
  s.pot += correct * s.config.potPerCorrect;
  emit(c, { type: 'PotChanged', pot: s.pot });

  const top = Math.max(0, ...scores.values());
  if (top > 0) {
    const winners = [...scores].filter(([, n]) => n === top).map(([id]) => id);
    const winner = getPlayer(s, c.rng.pick(winners));
    if (winner) grantReward(c, winner);
  }
  enterRoundTable(c);
}

function grantReward(c: Ctx, winner: PlayerState): void {
  const { s } = c;
  const preset = presetOf(s);
  if (!preset.murders) {
    const options = faithfulsAlive(s).filter((p) => p.id !== winner.id);
    if (options.length === 0) return;
    const clue = c.rng.pick(options);
    if (!winner.clues.includes(clue.id)) winner.clues.push(clue.id);
    emit(c, { type: 'ClueGranted', faithful: clue.id }, toPlayers([winner.id]));
  } else if (!inEndgame(s)) {
    winner.shield = true;
    emit(c, { type: 'ShieldGranted' }, toPlayers([winner.id]));
  }
}

// ---------------------------------------------------------------- round table

function enterRoundTable(c: Ctx): void {
  if (inEndgame(c.s)) enter(c, { kind: 'endgameVote', votes: {} });
  else enter(c, { kind: 'discussion', ready: [] });
}

function castEndgameVote(c: Ctx, actor: PlayerId, choice: 'end' | 'continue'): void {
  const p = c.s.phase;
  if (p.kind !== 'endgameVote') reject('not in the endgame vote');
  if (choice !== 'end' && choice !== 'continue') reject('invalid choice');
  if (p.votes[actor]) reject('already voted');
  p.votes[actor] = choice;
  if (alivePlayers(c.s).every((x) => p.votes[x.id])) resolveEndgameVote(c);
}

function resolveEndgameVote(c: Ctx): void {
  const p = c.s.phase;
  if (p.kind !== 'endgameVote') return;
  const unanimous = alivePlayers(c.s).every((x) => p.votes[x.id] === 'end');
  emit(c, { type: 'EndgameVoteResult', outcome: unanimous ? 'end' : 'continue' });
  if (unanimous) finish(c);
  else enter(c, { kind: 'discussion', ready: [] });
}

export function readyThreshold(alive: number): number {
  return Math.ceil((alive * 2) / 3);
}

function ready(c: Ctx, actor: PlayerId): void {
  const p = c.s.phase;
  if (p.kind !== 'discussion') reject('not in discussion');
  if (!p.ready.includes(actor)) p.ready.push(actor);
  if (p.ready.length >= readyThreshold(aliveCount(c.s))) openVoting(c);
}

function openVoting(c: Ctx): void {
  const all = ids(alivePlayers(c.s));
  enter(c, { kind: 'voting', stage: 'main', candidates: all, eligible: all, votes: {} });
}

function castVote(c: Ctx, actor: PlayerId, target: PlayerId | null): void {
  const p = c.s.phase;
  if (p.kind !== 'voting') reject('not in a vote');
  if (!p.eligible.includes(actor)) reject('not eligible to vote');
  if (actor in p.votes) reject('already voted');
  if (target !== null) {
    if (target === actor) reject('cannot vote for yourself');
    if (!p.candidates.includes(target)) reject('not a candidate');
  }
  p.votes[actor] = target;
  if (p.eligible.every((id) => id in p.votes)) closeVoting(c);
}

function rerunVote(c: Ctx): void {
  const p = c.s.phase;
  if (p.kind === 'voting') {
    enter(c, { ...p, votes: {} });
  } else if (p.kind === 'voteReveal') {
    enter(c, {
      kind: 'voting',
      stage: p.stage,
      candidates: p.candidates,
      eligible: [...p.order],
      votes: {},
    });
  } else if (p.kind === 'endgameVote') {
    enter(c, { kind: 'endgameVote', votes: {} });
  } else {
    reject('no vote to re-run');
  }
}

function closeVoting(c: Ctx): void {
  const p = c.s.phase;
  if (p.kind !== 'voting') return;
  const votes: Record<PlayerId, PlayerId | null> = {};
  for (const id of p.eligible) votes[id] = p.votes[id] ?? null;
  enter(c, {
    kind: 'voteReveal',
    stage: p.stage,
    candidates: p.candidates,
    order: c.rng.shuffle(p.eligible),
    votes,
    revealed: 0,
  });
}

function stepVoteReveal(c: Ctx): void {
  const p = c.s.phase;
  if (p.kind !== 'voteReveal') return;
  if (p.revealed < p.order.length) {
    const voter = p.order[p.revealed] as PlayerId;
    emit(c, { type: 'VoteRevealed', voter, target: p.votes[voter] ?? null });
    p.revealed++;
    bump(c);
    return;
  }
  tally(c, p);
}

function tally(c: Ctx, p: Extract<Phase, { kind: 'voteReveal' }>): void {
  const counts = new Map<PlayerId, number>(p.candidates.map((id) => [id, 0]));
  for (const target of Object.values(p.votes)) {
    if (target !== null) counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  const max = Math.max(...counts.values());
  const tied = [...counts].filter(([, n]) => n === max).map(([id]) => id);
  if (tied.length === 1) return banish(c, tied[0] as PlayerId);
  if (p.stage === 'runoff') return draw(c, tied);

  emit(c, { type: 'RunoffStarted', candidates: tied });
  const eligible = ids(alivePlayers(c.s)).filter((id) => !tied.includes(id));
  if (eligible.length === 0) return draw(c, tied);
  enter(c, { kind: 'voting', stage: 'runoff', candidates: tied, eligible, votes: {} });
}

function draw(c: Ctx, tied: PlayerId[]): void {
  const chosen = c.rng.pick(tied);
  emit(c, { type: 'RandomDraw', candidates: tied, chosen });
  banish(c, chosen);
}

function banish(c: Ctx, id: PlayerId): void {
  const { s } = c;
  const preset = presetOf(s);
  const player = getPlayer(s, id);
  if (!player) return;
  const wasEndgame = inEndgame(s);
  player.fate = 'banished';
  const reveal = s.config.revealRoles === 'always' || !wasEndgame;
  player.revealed = reveal;
  emit(c, { type: 'Banished', player: id, role: reveal ? player.role : null });
  if (player.role === 'traitor' && preset.recruitment && s.initialTraitors >= 2) {
    s.recruitPending = true;
  }
  enter(c, { kind: 'speech', player: id });
}

function afterBanish(c: Ctx): void {
  const { s } = c;
  const preset = presetOf(s);
  if (traitorsAlive(s).length === 0 || aliveCount(s) <= 2) return finish(c);
  if (preset.murders && aliveCount(s) > preset.endgameAt) return startNight(c);
  s.recruitPending = false;
  startMission(c);
}

// ---------------------------------------------------------------- night

function startNight(c: Ctx): void {
  const { s } = c;
  s.night++;
  const mode =
    s.recruitPending && traitorsAlive(s).length >= 1 && faithfulsAlive(s).length >= 1
      ? 'recruit'
      : 'murder';
  s.recruitPending = false;
  enter(c, { kind: 'night', mode, picks: {} });
}

function nightPick(c: Ctx, actor: PlayerId, target: PlayerId): void {
  const p = c.s.phase;
  if (p.kind !== 'night') reject('not night');
  const t = getPlayer(c.s, target);
  if (!t || t.fate !== 'alive') reject('invalid target');
  if (target === actor) reject('cannot pick yourself');
  p.picks[actor] = target;
}

function nightNote(c: Ctx, author: PlayerState, raw: string): void {
  const { s } = c;
  if (s.phase.kind !== 'night') reject('not night');
  const text = raw.trim();
  if (text.length < 1 || text.length > MAX_NOTE) reject('invalid note');
  const mine = s.notes.filter((n) => n.author === author.id && n.night === s.night).length;
  if (mine >= MAX_NOTES_PER_NIGHT) reject('too many notes');
  const channel = author.role === 'traitor' ? 'chat' : 'journal';
  s.notes.push({ author: author.id, night: s.night, text, channel });
  const audience = channel === 'chat' ? toPlayers(ids(traitorsAlive(s))) : toPlayers([author.id]);
  emit(c, { type: 'NoteAdded', author: author.id, text, channel }, audience);
}

function resolveNight(c: Ctx): void {
  const { s } = c;
  const p = s.phase;
  if (p.kind !== 'night') return;
  const faithfuls = faithfulsAlive(s);
  // Missing picks get a random default. Traitors default to a Faithful, as a real pick would.
  for (const pl of alivePlayers(s)) {
    if (p.picks[pl.id]) continue;
    const pool =
      pl.role === 'traitor' && faithfuls.length > 0
        ? faithfuls
        : alivePlayers(s).filter((x) => x.id !== pl.id);
    if (pool.length > 0) p.picks[pl.id] = c.rng.pick(pool).id;
  }
  const counts = new Map<PlayerId, number>();
  for (const t of traitorsAlive(s)) {
    const target = p.picks[t.id];
    if (target && faithfuls.some((f) => f.id === target)) {
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
  }
  const target = plurality(c, counts) ?? (faithfuls.length > 0 ? c.rng.pick(faithfuls).id : null);

  if (p.mode === 'murder') return resolveVictim(c, target);
  if (!target) return resolveVictim(c, null);
  const remaining = traitorsAlive(s).length;
  enter(c, {
    kind: 'recruitOffer',
    recruit: target,
    ultimatum: remaining === 1,
    thenMurder: remaining >= 2,
  });
  emit(c, { type: 'RecruitOffered', ultimatum: remaining === 1 }, toPlayers([target]));
}

function recruitReply(c: Ctx, actor: PlayerId, accept: boolean): void {
  const p = c.s.phase;
  if (p.kind !== 'recruitOffer') reject('no recruitment offer');
  if (p.recruit !== actor) reject('not the recruit');
  resolveRecruit(c, accept);
}

function resolveRecruit(c: Ctx, accept: boolean): void {
  const { s } = c;
  const p = s.phase;
  if (p.kind !== 'recruitOffer') return;
  const recruit = getPlayer(s, p.recruit);
  if (!recruit) return;
  const team = ids(traitorsAlive(s));
  emit(c, { type: 'RecruitResponded', recruit: recruit.id, accepted: accept }, toPlayers(team));
  if (accept) {
    recruit.role = 'traitor';
    recruit.recruited = true;
    const all = [...team, recruit.id];
    emit(c, { type: 'Recruited', player: recruit.id, team: all }, toPlayers(all));
  }
  if (p.thenMurder) return startMurderNight(c);
  resolveVictim(c, !accept ? recruit.id : null);
}

function startMurderNight(c: Ctx): void {
  c.s.night++;
  enter(c, { kind: 'night', mode: 'murder', picks: {} });
}

function resolveVictim(c: Ctx, target: PlayerId | null): void {
  const { s } = c;
  let victim: PlayerId | null = null;
  let murderFailed = false;
  if (target) {
    if (getPlayer(s, target)?.shield) murderFailed = true;
    else victim = target;
  }
  for (const p of s.players) p.shield = false;
  const order = c.rng.shuffle(ids(alivePlayers(s)).filter((id) => id !== victim));
  enter(c, { kind: 'breakfast', order, shown: 0, victim, murderFailed, announced: false });
}

// ---------------------------------------------------------------- breakfast

function stepBreakfast(c: Ctx): void {
  const { s } = c;
  const p = s.phase;
  if (p.kind !== 'breakfast') return;
  if (p.shown < p.order.length) {
    emit(c, { type: 'BreakfastArrival', player: p.order[p.shown] as PlayerId });
    p.shown++;
    return bump(c);
  }
  if (!p.announced) {
    p.announced = true;
    if (p.victim) {
      const v = getPlayer(s, p.victim);
      if (v) v.fate = 'murdered';
    }
    emit(c, { type: 'BreakfastResult', victim: p.victim });
    if (p.murderFailed) emit(c, { type: 'MurderFailed' }, toPlayers(ids(traitorsAlive(s))));
    return bump(c);
  }
  if (traitorsAlive(s).length === 0 || aliveCount(s) <= 2) return finish(c);
  startMission(c);
}

// ---------------------------------------------------------------- end

function finish(c: Ctx): void {
  const { s } = c;
  const winner: Winner = traitorsAlive(s).length > 0 ? 'traitors' : 'faithful';
  const role: Role = winner === 'traitors' ? 'traitor' : 'faithful';
  const winners = alivePlayers(s).filter((p) => p.role === role);
  const share = winners.length > 0 ? Math.floor(s.pot / winners.length) : 0;
  const payouts: Record<PlayerId, number> = {};
  for (const w of winners) payouts[w.id] = share;
  const roles: Record<PlayerId, Role> = {};
  for (const p of s.players) {
    p.revealed = true;
    roles[p.id] = p.role;
  }
  s.result = { winner, pot: s.pot, payouts };
  emit(c, { type: 'GameEnded', winner, pot: s.pot, payouts, roles });
  enter(c, { kind: 'finalReveal' });
}

// ---------------------------------------------------------------- helpers for servers and bots

/** Who still owes an input in the current phase. */
export function pendingActors(s: GameState): PlayerId[] {
  const p = s.phase;
  const alive = ids(alivePlayers(s));
  switch (p.kind) {
    case 'roleReveal':
      return alive.filter((id) => !p.acked.includes(id));
    case 'mission':
      return alive.filter((id) => !p.answers[id]);
    case 'endgameVote':
      return alive.filter((id) => !p.votes[id]);
    case 'discussion':
      return alive.filter((id) => !p.ready.includes(id));
    case 'voting':
      return p.eligible.filter((id) => !(id in p.votes));
    case 'night':
      return alive.filter((id) => !p.picks[id]);
    case 'recruitOffer':
      return [p.recruit];
    default:
      return [];
  }
}

/** Timer length for the current phase, or null when the phase waits for nobody's clock. */
export function timerMs(s: GameState): number | null {
  const t = s.config.timers;
  switch (s.phase.kind) {
    case 'roleReveal':
      return t.roleRevealMs;
    case 'mission':
      return t.missionMs;
    case 'endgameVote':
      return t.endgameVoteMs;
    case 'discussion':
      return t.discussionMs;
    case 'voting':
      return t.votingMs;
    case 'voteReveal':
      return t.voteRevealStepMs;
    case 'speech':
      return t.speechMs;
    case 'night':
      return NIGHT_MS;
    case 'recruitOffer':
      return t.recruitMs;
    case 'breakfast':
      return t.breakfastStepMs;
    default:
      return null;
  }
}

/** Players an actor may legally pick or vote for right now. */
export function targetsFor(s: GameState, actor: PlayerId): PlayerId[] {
  const p = s.phase;
  if (p.kind === 'voting') return p.candidates.filter((id) => id !== actor);
  if (p.kind === 'night') return ids(alivePlayers(s)).filter((id) => id !== actor);
  return [];
}
