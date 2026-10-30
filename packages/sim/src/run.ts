import { playGame, type GameOutcome } from './game';

export interface SimOptions {
  games: number;
  playerCounts: number[];
  seed: number;
  onProgress?: (done: number, total: number) => void;
}

export interface CountReport {
  players: number;
  games: number;
  finished: number;
  failedGames: number;
  avgRounds: number;
  traitorWins: number;
  faithfulWins: number;
}

export interface SimReport {
  games: number;
  finished: number;
  failedGames: number;
  byCount: CountReport[];
  failures: { seed: number; players: number; messages: string[] }[];
}

export function runSimulation(opts: SimOptions): SimReport {
  const outcomes: { seed: number; outcome: GameOutcome }[] = [];
  for (let i = 0; i < opts.games; i++) {
    const players = opts.playerCounts[i % opts.playerCounts.length] as number;
    const seed = (opts.seed * 1_000_003 + i) >>> 0;
    outcomes.push({ seed, outcome: playGame({ seed, players }) });
    opts.onProgress?.(i + 1, opts.games);
  }
  const byCount: CountReport[] = [...new Set(opts.playerCounts)]
    .sort((a, b) => a - b)
    .map((players) => {
      const mine = outcomes.filter((o) => o.outcome.players === players).map((o) => o.outcome);
      const done = mine.filter((o) => o.finished);
      return {
        players,
        games: mine.length,
        finished: done.length,
        failedGames: mine.filter((o) => o.failures.length > 0).length,
        avgRounds: done.length ? done.reduce((n, o) => n + o.rounds, 0) / done.length : 0,
        traitorWins: done.filter((o) => o.winner === 'traitors').length,
        faithfulWins: done.filter((o) => o.winner === 'faithful').length,
      };
    });
  const bad = outcomes.filter((o) => o.outcome.failures.length > 0);
  return {
    games: outcomes.length,
    finished: outcomes.filter((o) => o.outcome.finished).length,
    failedGames: bad.length,
    byCount,
    failures: bad.slice(0, 10).map((o) => ({
      seed: o.seed,
      players: o.outcome.players,
      messages: o.outcome.failures.slice(0, 5),
    })),
  };
}
