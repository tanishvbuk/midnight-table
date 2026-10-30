import type { GameView } from './view';

/**
 * One line of castle narration for the current phase, written from the public view only, so it
 * cannot leak anything a castle screen shouldn't know.
 */
export function narrate(v: GameView): string {
  const name = (id: string | null): string =>
    id === null ? 'nobody' : (v.players.find((p) => p.id === id)?.name ?? 'someone');
  const alive = v.players.filter((p) => p.fate === 'alive').length;
  const ph = v.phase;
  switch (ph.kind) {
    case 'lobby':
      return `Gather round the table. ${v.players.length} ${v.players.length === 1 ? 'guest has' : 'guests have'} arrived.`;
    case 'roleReveal':
      return 'Look at your phones. Hold to learn your fate, then tell no one.';
    case 'mission':
      return `A mission awaits. Every correct answer feeds the pot, now at ${v.pot}.`;
    case 'endgameVote':
      return 'The endgame is here. In secret: end the game now, or banish again?';
    case 'discussion':
      return `The Round Table is open. ${alive} remain, and at least one of you is lying.`;
    case 'voting':
      return ph.stage === 'runoff'
        ? 'A tie! The rest of you must now choose between the tied.'
        : 'Cast your votes in secret.';
    case 'voteReveal': {
      const last = ph.revealed.at(-1);
      if (!last) return 'The votes are in. Let us see them.';
      return last.target === null
        ? `${name(last.voter)} abstains.`
        : `${name(last.voter)} votes for ${name(last.target)}.`;
    }
    case 'speech': {
      const p = v.players.find((x) => x.id === ph.player);
      const role = p?.role
        ? ` They were ${p.role === 'traitor' ? 'a Traitor' : 'a Faithful'}.`
        : '';
      return `${name(ph.player)} has been banished. Any last words?${role}`;
    }
    case 'night':
      return 'Night falls. Every phone is busy, and no one can tell why.';
    case 'recruitOffer':
      return 'The night is not over yet.';
    case 'breakfast': {
      if (!ph.announced) {
        const last = ph.arrived.at(-1);
        return last
          ? `${name(last)} arrives at the breakfast table.`
          : 'Dawn breaks. Breakfast is served.';
      }
      return ph.victim === null
        ? 'Everyone is here. Nobody died in the night.'
        : `${name(ph.victim)} did not come to breakfast. They were murdered.`;
    }
    case 'finalReveal':
      return ph.winner === 'traitors'
        ? `The Traitors win and take the pot of ${ph.pot}.`
        : `The Faithful win and share the pot of ${ph.pot}.`;
  }
}
