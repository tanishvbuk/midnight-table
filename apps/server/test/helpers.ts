import {
  createRng,
  type GameView,
  type Rng,
  type ServerMessage,
  type StateMessage,
} from '@midnight/engine';
import type { Client } from '../src/room';

export class FakeClient implements Client {
  messages: ServerMessage[] = [];
  closed = false;
  onMessage: ((m: ServerMessage) => void) | null = null;
  send(msg: ServerMessage): void {
    this.messages.push(msg);
    this.onMessage?.(msg);
  }
  close(): void {
    this.closed = true;
  }
  get last(): StateMessage | undefined {
    return [...this.messages].reverse().find((m): m is StateMessage => m.t === 'state');
  }
  get errors(): string[] {
    return this.messages.flatMap((m) => (m.t === 'error' ? [m.message] : []));
  }
}

/** A "human" that decides only from its own view, as a real phone would. */
export function viewPolicy(v: GameView, rng: Rng): Record<string, unknown> | null {
  const me = v.you;
  if (!me || !me.alive) return null;
  const p = v.phase;
  switch (p.kind) {
    case 'roleReveal':
      return p.acked.includes(me.id) ? null : { type: 'ackRole' };
    case 'mission':
      return me.answered
        ? null
        : { type: 'submitAnswers', answers: p.questions.map((q) => rng.int(q.options.length)) };
    case 'endgameVote':
      return me.endgameChoice
        ? null
        : { type: 'endgameVote', choice: rng.next() < 0.3 ? 'end' : 'continue' };
    case 'discussion':
      return p.ready.includes(me.id) ? null : { type: 'ready' };
    case 'voting': {
      if (!p.eligible.includes(me.id) || me.voted) return null;
      const options = p.candidates.filter((c) => c !== me.id);
      return { type: 'vote', target: options.length ? rng.pick(options) : null };
    }
    case 'night': {
      if (me.pick) return null;
      const options = v.players.filter((x) => x.fate === 'alive' && x.id !== me.id);
      return { type: 'nightPick', target: rng.pick(options).id };
    }
    case 'recruitOffer':
      return me.offer ? { type: 'recruitReply', accept: rng.next() < 0.5 } : null;
    default:
      return null;
  }
}

export const rngFor = (seed: number): Rng => createRng(seed);
