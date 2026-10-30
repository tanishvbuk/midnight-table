import type { GameEvent, GameState, PlayerId } from './types';

/** One line of the post-game replay (R27). */
export interface TimelineEntry {
  /** "Day 2" or "Night 2": when it happened. */
  when: string;
  kind: 'vote' | 'banish' | 'murder' | 'shield' | 'recruit' | 'endgame' | 'note';
  text: string;
}

/** Event types the replay needs. Only these are kept in `GameState.history`. */
export const HISTORY_EVENTS: ReadonlySet<GameEvent['type']> = new Set([
  'PhaseStarted',
  'VoteRevealed',
  'RunoffStarted',
  'RandomDraw',
  'Banished',
  'EndgameVoteResult',
  'ShieldGranted',
  'ClueGranted',
  'NoteAdded',
  'RecruitOffered',
  'RecruitResponded',
  'Recruited',
  'BreakfastResult',
  'MurderFailed',
]);

/**
 * Builds the replay from the recorded events. It names every role, so a view may carry it only
 * once the game is over.
 */
export function buildTimeline(s: GameState): TimelineEntry[] {
  const name = (id: PlayerId | null | undefined): string =>
    id ? (s.players.find((p) => p.id === id)?.name ?? '?') : 'nobody';
  const role = (id: PlayerId): string => s.players.find((p) => p.id === id)?.role ?? '?';
  const out: TimelineEntry[] = [];
  let when = 'Day 1';
  const add = (kind: TimelineEntry['kind'], text: string): void =>
    void out.push({ when, kind, text });

  for (const e of s.history) {
    switch (e.type) {
      case 'PhaseStarted':
        when = `${e.phase === 'night' || e.phase === 'recruitOffer' ? 'Night' : 'Day'} ${e.day}`;
        break;
      case 'VoteRevealed':
        add(
          'vote',
          e.target
            ? `${name(e.voter)} voted for ${name(e.target)}.`
            : `${name(e.voter)} abstained.`,
        );
        break;
      case 'RunoffStarted':
        add('vote', `Tie. Run-off between ${e.candidates.map(name).join(' and ')}.`);
        break;
      case 'RandomDraw':
        add('vote', `Still tied. ${name(e.chosen)} was drawn at random.`);
        break;
      case 'Banished':
        add('banish', `${name(e.player)} was banished. They were a ${role(e.player)}.`);
        break;
      case 'EndgameVoteResult':
        add(
          'endgame',
          e.outcome === 'end'
            ? 'The endgame vote was unanimous: end the game.'
            : 'The endgame vote said continue.',
        );
        break;
      case 'ShieldGranted': {
        const to = e.audience === 'public' ? undefined : e.audience.players[0];
        add('shield', `${name(to)} won a Shield.`);
        break;
      }
      case 'ClueGranted': {
        const to = e.audience === 'public' ? undefined : e.audience.players[0];
        add('shield', `${name(to)} learned that ${name(e.faithful)} is Faithful.`);
        break;
      }
      case 'RecruitOffered': {
        const to = e.audience === 'public' ? undefined : e.audience.players[0];
        add(
          'recruit',
          `${name(to)} was offered a place with the Traitors${e.ultimatum ? ' (join or die)' : ''}.`,
        );
        break;
      }
      case 'RecruitResponded':
        add('recruit', `${name(e.recruit)} ${e.accepted ? 'accepted' : 'refused'}.`);
        break;
      case 'Recruited':
        add('recruit', `${name(e.player)} became a Traitor.`);
        break;
      case 'BreakfastResult':
        add('murder', e.victim ? `${name(e.victim)} was murdered.` : 'Nobody was murdered.');
        break;
      case 'MurderFailed':
        add('murder', 'The murder failed: the target had a Shield.');
        break;
      case 'NoteAdded':
        add(
          'note',
          `${name(e.author)} (${e.channel === 'chat' ? 'Traitor chat' : 'journal'}): ${e.text}`,
        );
        break;
    }
  }
  return out;
}
