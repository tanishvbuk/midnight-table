import {
  pendingActors,
  targetsFor,
  type Action,
  type GameState,
  type PlayerId,
  type Rng,
} from '@midnight/engine';

const NOTES = ['sus', 'not sure', 'trust me', 'watching you', 'quiet one', 'lets go'];

/** A bot choosing a uniformly random legal action for the actor's pending input. */
export function botAction(s: GameState, actor: PlayerId, rng: Rng): Action | null {
  const p = s.phase;
  switch (p.kind) {
    case 'roleReveal':
      return { type: 'ackRole', actor };
    case 'mission':
      return {
        type: 'submitAnswers',
        actor,
        answers: p.questions.map((q) => (rng.next() < 0.1 ? null : rng.int(q.options.length))),
      };
    case 'endgameVote':
      return { type: 'endgameVote', actor, choice: rng.next() < 0.3 ? 'end' : 'continue' };
    case 'discussion':
      return { type: 'ready', actor };
    case 'voting': {
      const targets = targetsFor(s, actor);
      const abstain = targets.length === 0 || rng.next() < 0.08;
      return { type: 'vote', actor, target: abstain ? null : rng.pick(targets) };
    }
    case 'night': {
      const targets = targetsFor(s, actor);
      return targets.length === 0 ? null : { type: 'nightPick', actor, target: rng.pick(targets) };
    }
    case 'recruitOffer':
      return { type: 'recruitReply', actor, accept: rng.next() < 0.5 };
    default:
      return null;
  }
}

export function noteAction(actor: PlayerId, rng: Rng): Action {
  return { type: 'nightNote', actor, text: rng.pick(NOTES) };
}

export { pendingActors };
