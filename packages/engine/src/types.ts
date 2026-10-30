export type PlayerId = string;
export type Role = 'faithful' | 'traitor';
export type Fate = 'alive' | 'murdered' | 'banished';
export type Winner = 'traitors' | 'faithful';

export interface Preset {
  traitors: number;
  murders: boolean;
  recruitment: boolean;
  /** Alive count at or below which murders stop and Round Tables open with the endgame vote. */
  endgameAt: number;
}

export interface Timers {
  roleRevealMs: number;
  missionMs: number;
  discussionMs: number;
  votingMs: number;
  voteRevealStepMs: number;
  speechMs: number;
  endgameVoteMs: number;
  recruitMs: number;
  breakfastStepMs: number;
  /** How long a physical mission lasts: time to do the task and to vote. */
  physicalMs: number;
}

export interface Config {
  timers: Timers;
  /** 'until-endgame' stops banished players' roles being revealed once the endgame has started. */
  revealRoles: 'always' | 'until-endgame';
  questionsPerMission: number;
  potPerCorrect: number;
  /** Pot gained when the group passes a physical mission card (R25). */
  physicalPot: number;
}

export interface Question {
  text: string;
  options: string[];
  correct: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  avatar: string | null;
  role: Role;
  fate: Fate;
  /** The role has been publicly revealed (banishment reveal or final reveal). */
  revealed: boolean;
  recruited: boolean;
  shield: boolean;
  /** Players this player has privately been told are definitely Faithful. */
  clues: PlayerId[];
}

export interface Note {
  author: PlayerId;
  night: number;
  text: string;
  /** Decided by the author's role when written: Traitor notes are chat, Faithful notes a journal. */
  channel: 'chat' | 'journal';
}

export type VoteStage = 'main' | 'runoff';

export type Phase =
  | { kind: 'lobby' }
  | { kind: 'roleReveal'; acked: PlayerId[] }
  | {
      kind: 'mission';
      questions: Question[];
      answers: Record<PlayerId, (number | null)[]>;
    }
  | {
      kind: 'physicalMission';
      /** Index into MISSION_CARDS. */
      card: number;
      votes: Record<PlayerId, 'pass' | 'fail'>;
    }
  | { kind: 'endgameVote'; votes: Record<PlayerId, 'end' | 'continue'> }
  | { kind: 'discussion'; ready: PlayerId[] }
  | {
      kind: 'voting';
      stage: VoteStage;
      candidates: PlayerId[];
      eligible: PlayerId[];
      votes: Record<PlayerId, PlayerId | null>;
    }
  | {
      kind: 'voteReveal';
      stage: VoteStage;
      candidates: PlayerId[];
      order: PlayerId[];
      votes: Record<PlayerId, PlayerId | null>;
      revealed: number;
    }
  | { kind: 'speech'; player: PlayerId }
  | {
      kind: 'night';
      mode: 'murder' | 'recruit';
      picks: Record<PlayerId, PlayerId>;
    }
  | {
      kind: 'recruitOffer';
      recruit: PlayerId;
      ultimatum: boolean;
      /** True when a normal murder night follows the offer (two or more Traitors). */
      thenMurder: boolean;
    }
  | {
      kind: 'breakfast';
      order: PlayerId[];
      shown: number;
      victim: PlayerId | null;
      murderFailed: boolean;
      announced: boolean;
    }
  | { kind: 'finalReveal' };

export type PhaseKind = Phase['kind'];

export interface GameResult {
  winner: Winner;
  pot: number;
  payouts: Record<PlayerId, number>;
}

export interface GameState {
  rng: number;
  /** Indices into the question bank already used this game, so missions do not repeat. Never in a view. */
  asked: number[];
  /** Mission cards used so far this game, so none repeats until the deck is used up. */
  askedCards: number[];
  /** The creator switched physical missions on in the lobby (R25). */
  physicalMissions: boolean;
  /** Timer epoch: bumps on every phase change and every sub-step. A stale timeout is ignored. */
  epoch: number;
  config: Config;
  preset: Preset | null;
  hostId: PlayerId | null;
  initialTraitors: number;
  players: PlayerState[];
  day: number;
  night: number;
  pot: number;
  /** A Traitor was banished since the last night, so the next night is a recruitment night. */
  recruitPending: boolean;
  phase: Phase;
  notes: Note[];
  /** Events kept for the post-game replay (R27). Never in a view before the final reveal. */
  history: GameEvent[];
  /** Ghost guesses (R26): ghost id -> players they think are Traitors. Private to the ghost until the final reveal. */
  predictions: Record<PlayerId, PlayerId[]>;
  result: GameResult | null;
}

export type Action =
  | { type: 'join'; id: PlayerId; name: string; avatar?: string | null }
  | { type: 'leave'; actor: PlayerId }
  | { type: 'start'; actor: PlayerId }
  | { type: 'ackRole'; actor: PlayerId }
  | { type: 'submitAnswers'; actor: PlayerId; answers: (number | null)[] }
  | { type: 'ready'; actor: PlayerId }
  | { type: 'vote'; actor: PlayerId; target: PlayerId | null }
  | { type: 'endgameVote'; actor: PlayerId; choice: 'end' | 'continue' }
  | { type: 'nightPick'; actor: PlayerId; target: PlayerId }
  | { type: 'nightNote'; actor: PlayerId; text: string }
  | { type: 'recruitReply'; actor: PlayerId; accept: boolean }
  | { type: 'physicalVote'; actor: PlayerId; pass: boolean }
  /** Ghosts only: replaces the ghost's guess at who the Traitors are. Has no effect on the game. */
  | { type: 'predict'; actor: PlayerId; suspects: PlayerId[] }
  | { type: 'timeout'; epoch: number }
  /** Lobby only, server-authenticated: whether every other mission is a physical card. */
  | { type: 'setPhysicalMissions'; on: boolean }
  /** Host escape hatch (server-authenticated): clears the ballots of the current vote and reopens it. */
  | { type: 'rerunVote' }
  /** Host escape hatch (server-authenticated): ends the game now with the usual payout. */
  | { type: 'endGame' };

export type Audience = 'public' | { players: PlayerId[] };

export type EventBody =
  | { type: 'PlayerJoined'; id: PlayerId; name: string }
  | { type: 'PlayerLeft'; id: PlayerId }
  | { type: 'GameStarted'; players: number; traitors: number }
  | { type: 'RoleDealt'; role: Role; team: PlayerId[] | null }
  | { type: 'PhaseStarted'; phase: PhaseKind; epoch: number; day: number }
  | { type: 'PotChanged'; pot: number }
  | { type: 'PhysicalResult'; card: number; passed: boolean }
  | { type: 'ShieldGranted' }
  | { type: 'ClueGranted'; faithful: PlayerId }
  | { type: 'NoteAdded'; author: PlayerId; text: string; channel: 'chat' | 'journal' }
  | { type: 'VoteRevealed'; voter: PlayerId; target: PlayerId | null }
  | { type: 'RunoffStarted'; candidates: PlayerId[] }
  | { type: 'RandomDraw'; candidates: PlayerId[]; chosen: PlayerId }
  | { type: 'Banished'; player: PlayerId; role: Role | null }
  | { type: 'EndgameVoteResult'; outcome: 'end' | 'continue' }
  | { type: 'RecruitOffered'; ultimatum: boolean }
  | { type: 'RecruitResponded'; recruit: PlayerId; accepted: boolean }
  | { type: 'Recruited'; player: PlayerId; team: PlayerId[] }
  | { type: 'MurderFailed' }
  | { type: 'BreakfastArrival'; player: PlayerId }
  | { type: 'BreakfastResult'; victim: PlayerId | null }
  | {
      type: 'GameEnded';
      winner: Winner;
      pot: number;
      payouts: Record<PlayerId, number>;
      roles: Record<PlayerId, Role>;
    };

export type GameEvent = EventBody & { audience: Audience };

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
  /** Set when the action was rejected; `state` is then the input state, untouched. */
  error?: string;
}
