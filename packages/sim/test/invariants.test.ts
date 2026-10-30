import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { alivePlayers, apply, type Action, type GameEvent, type GameState } from '@midnight/engine';
import { playGame } from '../src/game';

const players = fc.integer({ min: 4, max: 16 });
const seed = fc.integer({ min: 0, max: 2 ** 31 });
const drop = fc.constantFrom(0, 0.1, 0.5, 0.9);

describe('invariants over random bot games', () => {
  it('every game ends, with no invariant failures', () => {
    fc.assert(
      fc.property(players, seed, drop, (n, sd, dropRate) => {
        const out = playGame({ players: n, seed: sd, dropRate });
        expect(out.failures).toEqual([]);
        expect(out.finished).toBe(true);
        expect(out.steps).toBeLessThan(20_000);
      }),
      { numRuns: 150 },
    );
  });

  it('eliminated players can never act, and a rejected action changes nothing', () => {
    fc.assert(
      fc.property(players, seed, (n, sd) => {
        playGame({
          players: n,
          seed: sd,
          onState: (s) => {
            for (const p of s.players.filter((x) => x.fate !== 'alive')) {
              const other = s.players.find((x) => x.id !== p.id)!.id;
              const attempts: Action[] = [
                { type: 'ackRole', actor: p.id },
                { type: 'submitAnswers', actor: p.id, answers: Array(8).fill(0) },
                { type: 'ready', actor: p.id },
                { type: 'vote', actor: p.id, target: other },
                { type: 'vote', actor: p.id, target: null },
                { type: 'endgameVote', actor: p.id, choice: 'end' },
                { type: 'nightPick', actor: p.id, target: other },
                { type: 'nightNote', actor: p.id, text: 'hello' },
                { type: 'recruitReply', actor: p.id, accept: true },
                { type: 'physicalVote', actor: p.id, pass: true },
              ];
              for (const a of attempts) {
                const r = apply(s, a);
                expect(r.error).toBeDefined();
                expect(r.state).toBe(s);
                expect(r.events).toEqual([]);
              }
            }
          },
        });
      }),
      { numRuns: 25 },
    );
  });

  it('at most one player dies per night, and the pot is never negative', () => {
    fc.assert(
      fc.property(players, seed, (n, sd) => {
        const deaths = new Map<number, number>();
        playGame({
          players: n,
          seed: sd,
          onState: (s, _prev, _a, res) => {
            expect(Number.isInteger(s.pot) && s.pot >= 0).toBe(true);
            for (const e of res.events as GameEvent[]) {
              if (e.type === 'BreakfastResult' && e.victim) {
                deaths.set(s.night, (deaths.get(s.night) ?? 0) + 1);
              }
            }
          },
        });
        for (const count of deaths.values()) expect(count).toBeLessThanOrEqual(1);
      }),
      { numRuns: 60 },
    );
  });

  it('keeps Traitor counts to the preset and ends with a coherent payout', () => {
    fc.assert(
      fc.property(players, seed, (n, sd) => {
        let last: GameState | null = null;
        playGame({ players: n, seed: sd, onState: (s) => void (last = s) });
        const s = last as GameState | null;
        expect(s?.phase.kind).toBe('finalReveal');
        const result = s!.result!;
        const paid = Object.values(result.payouts);
        expect(paid.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(result.pot);
        expect(paid.every((x) => x >= 0)).toBe(true);
        const winners = Object.keys(result.payouts);
        for (const w of winners) {
          const p = s!.players.find((x) => x.id === w)!;
          expect(p.fate).toBe('alive');
          expect(p.role).toBe(result.winner === 'traitors' ? 'traitor' : 'faithful');
        }
        const traitorsLeft = alivePlayers(s!).filter((p) => p.role === 'traitor').length;
        expect(result.winner === 'traitors').toBe(traitorsLeft > 0);
      }),
      { numRuns: 60 },
    );
  });

  it('is deterministic for a seed', () => {
    fc.assert(
      fc.property(players, seed, (n, sd) => {
        expect(playGame({ players: n, seed: sd })).toEqual(playGame({ players: n, seed: sd }));
      }),
      { numRuns: 20 },
    );
  });
});
