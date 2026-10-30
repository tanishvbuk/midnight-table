import type { GameEvent, PlayerId } from './types';
import type { GameView } from './view';

export type HostCommand =
  | { cmd: 'pause' }
  | { cmd: 'resume' }
  | { cmd: 'addTime' }
  | { cmd: 'rerunVote' }
  | { cmd: 'dropPlayer'; target: PlayerId }
  | { cmd: 'endGame' }
  | { cmd: 'addBots'; count: number };

export type ClientMessage =
  | { t: 'hello'; room: string; kind: 'castle' }
  | {
      t: 'hello';
      room: string;
      kind: 'player';
      token?: string;
      name?: string;
      avatar?: string | null;
    }
  /** `cid` makes an action safe to resend: the server applies each cid once and always acks it. */
  | { t: 'act'; action: Record<string, unknown>; cid?: string }
  | { t: 'host'; command: HostCommand }
  | { t: 'ping' };

export interface StateMessage {
  t: 'state';
  view: GameView;
  narration: string;
  /** Server clock, so clients can show countdowns without trusting their own. */
  now: number;
  deadlineAt: number | null;
  paused: boolean;
  hostId: PlayerId | null;
  isHost: boolean;
  /** Public events from the latest step. Sent to the castle only. */
  events: GameEvent[];
}

export type ServerMessage =
  | {
      t: 'welcome';
      room: string;
      kind: 'castle' | 'player';
      playerId: PlayerId | null;
      token: string | null;
    }
  | StateMessage
  | { t: 'notice'; text: string }
  | { t: 'error'; message: string; fatal?: boolean; cid?: string }
  | { t: 'ack'; cid: string }
  | { t: 'pong' };
