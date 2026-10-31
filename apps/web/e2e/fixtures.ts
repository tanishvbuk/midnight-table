import {
  apply,
  createGame,
  createRng,
  getPlayer,
  pendingActors,
  type Action,
  type GameState,
  type PlayerId,
} from '@midnight/engine';
import { botAction, noteAction } from '../../../packages/sim/src/index';
import type { LogEntry } from '../../server/src/log';

export interface Fixture {
  seed: number;
  entries: LogEntry[];
  humanId: PlayerId;
  humanToken: string;
  state: GameState;
}

export type Goal = (s: GameState, human: PlayerId) => boolean;

/** The human is offered recruitment (as a Faithful). */
export const recruitOfferedToHuman: Goal = (s, human) =>
  s.phase.kind === 'recruitOffer' && s.phase.recruit === human;

/** The human has just been announced as the night's victim at breakfast. */
export const humanMurdered: Goal = (s, human) =>
  s.phase.kind === 'breakfast' && s.phase.announced && getPlayer(s, human)?.fate === 'murdered';

/**
 * Plays random-bot games on the pure engine until `goal` holds, and returns the room log that
 * reaches that state. `Room.restore` can rebuild a live room from it, so the browser then joins
 * a game that is genuinely paused at the screen we want to photograph.
 */
export function findFixture(opts: {
  players: number;
  goal: Goal;
  fromSeed?: number;
  tries?: number;
}): Fixture {
  const humanId = 'hu000001';
  const humanToken = 'e2e-human-token-0123456789abcdef0123456789';
  const ids = [humanId, ...Array.from({ length: opts.players - 1 }, (_, i) => `b${i + 1}`)];
  const first = opts.fromSeed ?? 1;
  for (let seed = first; seed < first + (opts.tries ?? 20_000); seed++) {
    const entries: LogEntry[] = [{ k: 'create', code: 'XXXX', seed, ts: 0 }];
    let state = createGame({ seed });
    const rng = createRng(seed ^ 0x77);
    const play = (action: Action): boolean => {
      const res = apply(state, action);
      if (res.error) return false;
      state = res.state;
      entries.push({ k: 'act', action });
      return true;
    };
    ids.forEach((id, i) => {
      play({ type: 'join', id, name: i === 0 ? 'Mira' : `Bot ${i}`, avatar: null });
      entries.push({
        k: 'seat',
        playerId: id,
        token: i === 0 ? humanToken : `bot-token-${seed}-${i}`,
        bot: i !== 0,
      });
    });
    play({ type: 'start', actor: humanId });
    let steps = 0;
    while (state.phase.kind !== 'finalReveal' && steps++ < 4000) {
      if (opts.goal(state, humanId)) {
        return { seed, entries, humanId, humanToken, state };
      }
      const epoch = state.epoch;
      for (const actor of pendingActors(state)) {
        if (state.epoch !== epoch) break;
        if (opts.goal(state, humanId)) break;
        if (state.phase.kind === 'night' && rng.next() < 0.5) play(noteAction(actor, rng));
        const a = botAction(state, actor, rng);
        if (a) play(a);
      }
      if (opts.goal(state, humanId)) return { seed, entries, humanId, humanToken, state };
      if (state.epoch === epoch) play({ type: 'timeout', epoch });
    }
  }
  throw new Error('no seed reached the goal');
}
