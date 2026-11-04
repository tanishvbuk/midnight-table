import type { Action, HostCommand, PlayerId } from '@midnight/engine';

const isStr = (v: unknown, max = 100): v is string => typeof v === 'string' && v.length <= max;

/**
 * Turns an untrusted client message into an engine action for a known player. The actor is always
 * the authenticated player, never something the client supplies.
 */
export function parsePlayerAction(raw: Record<string, unknown>, actor: PlayerId): Action | null {
  switch (raw.type) {
    case 'start':
    case 'ackRole':
    case 'ready':
    case 'leave':
      return { type: raw.type, actor };
    case 'submitAnswers': {
      const a = raw.answers;
      if (!Array.isArray(a) || a.length > 30) return null;
      if (!a.every((x) => x === null || Number.isInteger(x))) return null;
      return { type: 'submitAnswers', actor, answers: a as (number | null)[] };
    }
    case 'vote':
      if (raw.target !== null && !isStr(raw.target)) return null;
      return { type: 'vote', actor, target: raw.target as string | null };
    case 'endgameVote':
      if (raw.choice !== 'end' && raw.choice !== 'continue') return null;
      return { type: 'endgameVote', actor, choice: raw.choice };
    case 'nightPick':
      if (!isStr(raw.target)) return null;
      return { type: 'nightPick', actor, target: raw.target };
    case 'nightNote':
      if (!isStr(raw.text, 500)) return null;
      return { type: 'nightNote', actor, text: raw.text };
    case 'recruitReply':
      if (typeof raw.accept !== 'boolean') return null;
      return { type: 'recruitReply', actor, accept: raw.accept };
    default:
      return null;
  }
}

/** Turns an untrusted client message into a host command, or null if it isn't one. */
export function parseHostCommand(raw: unknown): HostCommand | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Record<string, unknown>;
  switch (c.cmd) {
    case 'pause':
    case 'resume':
    case 'addTime':
    case 'rerunVote':
    case 'endGame':
      return { cmd: c.cmd };
    case 'dropPlayer':
      if (!isStr(c.target)) return null;
      return { cmd: 'dropPlayer', target: c.target };
    case 'addBots':
      if (typeof c.count !== 'number' || !Number.isFinite(c.count)) return null;
      return { cmd: 'addBots', count: c.count };
    default:
      return null;
  }
}
