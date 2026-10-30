import { runSimulation } from './run';

function parseCounts(raw: string): number[] {
  const out: number[] = [];
  for (const part of raw.split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) throw new Error(`bad --players value: ${raw}`);
    const lo = Number(m[1]);
    const hi = m[2] ? Number(m[2]) : lo;
    for (let n = lo; n <= hi; n++) out.push(n);
  }
  if (out.length === 0 || out.some((n) => n < 4 || n > 16)) {
    throw new Error('--players must be within 4-16');
  }
  return out;
}

function main(): void {
  const args = process.argv.slice(2);
  const get = (name: string, fallback: string): string => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] !== undefined ? (args[i + 1] as string) : fallback;
  };
  const games = Number(get('games', '1000'));
  const seed = Number(get('seed', '1'));
  const playerCounts = parseCounts(get('players', '4-16'));
  const started = Date.now();
  const report = runSimulation({ games, seed, playerCounts });

  const pct = (n: number, d: number): string => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');
  console.log(
    `games: ${report.games}  seed: ${seed}  players: ${playerCounts[0]}-${playerCounts.at(-1)}`,
  );
  console.log('players  games  finished  failures  avg rounds  traitor wins  faithful wins');
  for (const r of report.byCount) {
    console.log(
      [
        String(r.players).padStart(7),
        String(r.games).padStart(6),
        String(r.finished).padStart(9),
        String(r.failedGames).padStart(9),
        r.avgRounds.toFixed(1).padStart(11),
        pct(r.traitorWins, r.finished).padStart(13),
        pct(r.faithfulWins, r.finished).padStart(14),
      ].join('  '),
    );
  }
  console.log(
    `\nfinished: ${report.finished}/${report.games}  invariant failures: ${report.failedGames}  (${((Date.now() - started) / 1000).toFixed(1)}s)`,
  );
  for (const f of report.failures) {
    console.log(`\nFAIL seed=${f.seed} players=${f.players}`);
    for (const m of f.messages) console.log(`  ${m}`);
  }
  if (report.failedGames > 0 || report.finished < report.games) process.exitCode = 1;
}

main();
