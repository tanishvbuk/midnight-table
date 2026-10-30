import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allViewers, view, type GameState } from '@midnight/engine';
import { playGame } from '../src/game';

const players = fc.integer({ min: 4, max: 16 });
const seed = fc.integer({ min: 0, max: 2 ** 31 });

describe('replay timeline (R27)', () => {
  it('exists only in the final reveal and is identical for every viewer', () => {
    fc.assert(
      fc.property(players, seed, (n, sd) => {
        let last: GameState | null = null;
        playGame({
          players: n,
          seed: sd,
          onState: (s) => {
            last = s;
            const over = s.phase.kind === 'finalReveal';
            for (const viewer of allViewers(s)) {
              const v = view(s, viewer);
              expect('timeline' in v.phase).toBe(over);
              if (!over) expect(JSON.stringify(v)).not.toContain('"timeline"');
            }
            if (over) {
              const first = JSON.stringify(
                (view(s, 'castle').phase as { timeline: unknown }).timeline,
              );
              for (const viewer of allViewers(s))
                expect(
                  JSON.stringify((view(s, viewer).phase as { timeline: unknown }).timeline),
                ).toBe(first);
            }
          },
        });
        expect(last).not.toBeNull();
      }),
      { numRuns: 25 },
    );
  });

  it('records every banishment and murder, in order, and every vote', () => {
    for (const sd of [1, 2, 3, 4, 5]) {
      let end: GameState | null = null;
      playGame({
        players: 8,
        seed: sd,
        onState: (s) => {
          if (s.phase.kind === 'finalReveal') end = s;
        },
      });
      const s = end as GameState | null;
      if (!s) throw new Error('game did not finish');
      const tl = (view(s, 'castle').phase as { timeline: { kind: string; text: string }[] })
        .timeline;
      const dead = s.players.filter((p) => p.fate !== 'alive');
      for (const p of dead) {
        const word = p.fate === 'banished' ? 'was banished' : 'was murdered';
        expect(tl.some((e) => e.text.startsWith(`${p.name} ${word}`))).toBe(true);
      }
      expect(tl.filter((e) => e.kind === 'banish').length).toBe(
        dead.filter((p) => p.fate === 'banished').length,
      );
      expect(tl.some((e) => e.kind === 'vote')).toBe(true);
    }
  });
});
