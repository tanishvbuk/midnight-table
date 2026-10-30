import { alivePlayers, getPlayer, readyThreshold, timerMs } from './engine';
import { buildTimeline, type TimelineEntry } from './timeline';
import type { Fate, GameState, PlayerId, Role, VoteStage, Winner } from './types';

export type Viewer = 'castle' | PlayerId;

export interface PublicPlayer {
  id: PlayerId;
  name: string;
  avatar: string | null;
  fate: Fate;
  /** Null unless the role has been publicly revealed. */
  role: Role | null;
}

export type PhaseView =
  | { kind: 'lobby'; hostId: PlayerId | null }
  | { kind: 'roleReveal'; acked: PlayerId[] }
  | { kind: 'mission'; questions: { text: string; options: string[] }[]; submitted: PlayerId[] }
  | { kind: 'endgameVote'; submitted: PlayerId[] }
  | { kind: 'discussion'; ready: PlayerId[]; needed: number }
  | {
      kind: 'voting';
      stage: VoteStage;
      candidates: PlayerId[];
      eligible: PlayerId[];
      submitted: PlayerId[];
    }
  | {
      kind: 'voteReveal';
      stage: VoteStage;
      candidates: PlayerId[];
      revealed: { voter: PlayerId; target: PlayerId | null }[];
      total: number;
    }
  | { kind: 'speech'; player: PlayerId }
  | { kind: 'night' }
  | { kind: 'recruitOffer' }
  | { kind: 'breakfast'; arrived: PlayerId[]; announced: boolean; victim: PlayerId | null }
  | {
      kind: 'finalReveal';
      winner: Winner;
      pot: number;
      payouts: Record<PlayerId, number>;
      roles: Record<PlayerId, Role>;
      /** The replay (R27). Present only now, because it names every role. */
      timeline: TimelineEntry[];
    };

/** What the "Show my card" button displays. Identical for every player, whatever their role. */
export const SHOWN_CARD = { role: 'faithful' } as const;

export interface YouView {
  id: PlayerId;
  alive: boolean;
  /** Only present during the role reveal (and for your own publicly revealed role). */
  role: Role | null;
  card: typeof SHOWN_CARD;
  /** The Traitor team, for Traitors only. */
  team: PlayerId[] | null;
  shield: boolean;
  clues: PlayerId[];
  answered: boolean;
  /** Your ballot while voting, `undefined`-free: null means abstained or not yet voted. */
  voted: boolean;
  vote: PlayerId | null;
  endgameChoice: 'end' | 'continue' | null;
  pick: PlayerId | null;
  /** Your own notes from the night box, as a private journal. */
  journal: { night: number; text: string }[];
  /** Traitor chat. Always present, empty for Faithfuls, so every night screen has one layout. */
  chat: { author: PlayerId; night: number; text: string }[];
  offer: { ultimatum: boolean } | null;
  /** Traitors only: last night's murder failed. */
  murderFailed: boolean;
}

export interface GameView {
  viewer: Viewer;
  epoch: number;
  day: number;
  pot: number;
  players: PublicPlayer[];
  timerMs: number | null;
  phase: PhaseView;
  you: YouView | null;
}

function phaseView(s: GameState): PhaseView {
  const p = s.phase;
  switch (p.kind) {
    case 'lobby':
      return { kind: 'lobby', hostId: s.hostId };
    case 'roleReveal':
      return { kind: 'roleReveal', acked: [...p.acked] };
    case 'mission':
      return {
        kind: 'mission',
        questions: p.questions.map((q) => ({ text: q.text, options: [...q.options] })),
        submitted: Object.keys(p.answers),
      };
    case 'endgameVote':
      return { kind: 'endgameVote', submitted: Object.keys(p.votes) };
    case 'discussion':
      return {
        kind: 'discussion',
        ready: [...p.ready],
        needed: readyThreshold(alivePlayers(s).length),
      };
    case 'voting':
      return {
        kind: 'voting',
        stage: p.stage,
        candidates: [...p.candidates],
        eligible: [...p.eligible],
        submitted: Object.keys(p.votes),
      };
    case 'voteReveal':
      return {
        kind: 'voteReveal',
        stage: p.stage,
        candidates: [...p.candidates],
        revealed: p.order
          .slice(0, p.revealed)
          .map((voter) => ({ voter, target: p.votes[voter] ?? null })),
        total: p.order.length,
      };
    case 'speech':
      return { kind: 'speech', player: p.player };
    case 'night':
      return { kind: 'night' };
    case 'recruitOffer':
      return { kind: 'recruitOffer' };
    case 'breakfast':
      return {
        kind: 'breakfast',
        arrived: p.order.slice(0, p.shown),
        announced: p.announced,
        victim: p.announced ? p.victim : null,
      };
    case 'finalReveal': {
      const result = s.result;
      const roles: Record<PlayerId, Role> = {};
      for (const pl of s.players) roles[pl.id] = pl.role;
      return {
        kind: 'finalReveal',
        winner: result?.winner ?? 'faithful',
        pot: result?.pot ?? 0,
        payouts: { ...(result?.payouts ?? {}) },
        roles,
        timeline: buildTimeline(s),
      };
    }
  }
}

function youView(s: GameState, id: PlayerId): YouView | null {
  const me = getPlayer(s, id);
  if (!me) return null;
  const p = s.phase;
  const alive = me.fate === 'alive';
  const traitor = alive && me.role === 'traitor';
  const isTraitorChatReader = traitor;
  const view: YouView = {
    id,
    alive,
    role: me.revealed || (alive && p.kind === 'roleReveal') ? me.role : null,
    card: SHOWN_CARD,
    team:
      traitor && s.preset
        ? s.players.filter((x) => x.fate === 'alive' && x.role === 'traitor').map((x) => x.id)
        : null,
    shield: alive && me.shield,
    clues: alive ? [...me.clues] : [],
    answered: false,
    voted: false,
    vote: null,
    endgameChoice: null,
    pick: null,
    journal: alive
      ? s.notes
          .filter((n) => n.author === id && n.channel === 'journal')
          .map((n) => ({ night: n.night, text: n.text }))
      : [],
    chat: isTraitorChatReader
      ? s.notes
          .filter((n) => n.channel === 'chat')
          .map((n) => ({ author: n.author, night: n.night, text: n.text }))
      : [],
    offer: null,
    murderFailed: traitor && p.kind === 'breakfast' && p.announced && p.murderFailed,
  };
  if (!alive) return view;
  switch (p.kind) {
    case 'mission':
      view.answered = id in p.answers;
      break;
    case 'endgameVote':
      view.endgameChoice = p.votes[id] ?? null;
      break;
    case 'voting':
      view.voted = id in p.votes;
      view.vote = p.votes[id] ?? null;
      break;
    case 'night':
      view.pick = p.picks[id] ?? null;
      break;
    case 'recruitOffer':
      view.offer = p.recruit === id ? { ultimatum: p.ultimatum } : null;
      break;
    default:
      break;
  }
  return view;
}

/**
 * Projects the state down to what one viewer may see. Built from an allow-list: nothing is copied
 * across unless it is named here, so new hidden state can't leak by default.
 */
export function view(s: GameState, viewer: Viewer): GameView {
  return {
    viewer,
    epoch: s.epoch,
    day: s.day,
    pot: s.pot,
    players: s.players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      fate: p.fate,
      role: p.revealed ? p.role : null,
    })),
    timerMs: timerMs(s),
    phase: phaseView(s),
    you: viewer === 'castle' ? null : youView(s, viewer),
  };
}
