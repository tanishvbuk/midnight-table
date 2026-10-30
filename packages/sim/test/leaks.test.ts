import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { view, viewProblems, allViewers, type GameState, type PlayerId } from '@midnight/engine';
import { playGame } from '../src/game';

const players = fc.integer({ min: 4, max: 16 });
const seed = fc.integer({ min: 0, max: 2 ** 31 });

function clone(s: GameState, fn: (d: GameState) => void): GameState {
  const d = structuredClone(s);
  fn(d);
  return d;
}

/** Everything a viewer is legitimately allowed to learn about other players' roles. */
function knownTo(s: GameState, viewer: string): Set<PlayerId> {
  const known = new Set<PlayerId>();
  for (const p of s.players) if (p.revealed) known.add(p.id);
  const me = s.players.find((p) => p.id === viewer);
  if (me) {
    known.add(me.id);
    for (const c of me.clues) known.add(c);
    if (me.fate === 'alive' && me.role === 'traitor') {
      for (const p of s.players) if (p.fate === 'alive' && p.role === 'traitor') known.add(p.id);
    }
  }
  return known;
}

describe('secrecy over every state reached by random games', () => {
  it('every view of every reachable state passes the structural leak checks', () => {
    fc.assert(
      fc.property(players, seed, (n, sd) => {
        playGame({
          players: n,
          seed: sd,
          onState: (s) => {
            for (const v of allViewers(s)) expect(viewProblems(s, v)).toEqual([]);
          },
        });
      }),
      { numRuns: 40 },
    );
  });

  it('views do not depend on hidden roles: swapping them changes nothing', () => {
    fc.assert(
      fc.property(players, seed, (n, sd) => {
        playGame({
          players: n,
          seed: sd,
          onState: (s) => {
            for (const viewer of allViewers(s)) {
              const known = knownTo(s, viewer);
              const hidden = s.players.filter((p) => !known.has(p.id));
              const t = hidden.find((p) => p.role === 'traitor');
              const f = hidden.find((p) => p.role === 'faithful');
              if (!t || !f) continue;
              const swapped = clone(s, (d) => {
                d.players.find((p) => p.id === t.id)!.role = 'faithful';
                d.players.find((p) => p.id === f.id)!.role = 'traitor';
              });
              expect(view(swapped, viewer)).toEqual(view(s, viewer));
            }
          },
        });
      }),
      { numRuns: 30 },
    );
  });

  it('views do not depend on other players hidden inputs (votes, picks, answers)', () => {
    fc.assert(
      fc.property(players, seed, (n, sd) => {
        playGame({
          players: n,
          seed: sd,
          onState: (s) => {
            const owners: PlayerId[] = [];
            const p = s.phase;
            if (p.kind === 'voting') owners.push(...Object.keys(p.votes));
            if (p.kind === 'night') owners.push(...Object.keys(p.picks));
            if (p.kind === 'mission') owners.push(...Object.keys(p.answers));
            if (p.kind === 'endgameVote') owners.push(...Object.keys(p.votes));
            if (owners.length === 0) return;
            const owner = owners[0] as PlayerId;
            const mutated = clone(s, (d) => {
              const q = d.phase;
              if (q.kind === 'voting') {
                const options = [null, ...q.candidates.filter((c) => c !== owner)];
                q.votes[owner] = options.find((o) => o !== q.votes[owner]) ?? null;
              }
              if (q.kind === 'night') {
                const others = d.players.filter((x) => x.id !== owner).map((x) => x.id);
                q.picks[owner] = others.find((o) => o !== q.picks[owner]) as PlayerId;
              }
              if (q.kind === 'mission') {
                q.answers[owner] = (q.answers[owner] ?? []).map((a) => ((a ?? 0) + 1) % 2);
              }
              if (q.kind === 'endgameVote') {
                q.votes[owner] = q.votes[owner] === 'end' ? 'continue' : 'end';
              }
            });
            for (const viewer of allViewers(s)) {
              if (viewer === owner) continue;
              expect(view(mutated, viewer)).toEqual(view(s, viewer));
            }
          },
        });
      }),
      { numRuns: 30 },
    );
  });

  it('the shown card is identical for Traitors and Faithfuls in every state', () => {
    fc.assert(
      fc.property(players, seed, (n, sd) => {
        playGame({
          players: n,
          seed: sd,
          onState: (s) => {
            const cards = new Set(s.players.map((p) => JSON.stringify(view(s, p.id).you?.card)));
            expect(cards.size).toBe(1);
          },
        });
      }),
      { numRuns: 20 },
    );
  });

  it('public events never carry private information', () => {
    fc.assert(
      fc.property(players, seed, (n, sd) => {
        playGame({
          players: n,
          seed: sd,
          onState: (s, _prev, _action, res) => {
            for (const e of res.events) {
              if (e.audience !== 'public') continue;
              const text = JSON.stringify(e);
              if (e.type !== 'Banished' && e.type !== 'GameEnded') {
                expect(text).not.toMatch(/"(role|roles|team|clue|correct)"/);
              }
              if (e.type === 'Banished' && e.role !== null) {
                expect(s.players.find((p) => p.id === e.player)?.revealed).toBe(true);
              }
              if (e.type === 'GameEnded') expect(s.phase.kind).toBe('finalReveal');
            }
          },
        });
      }),
      { numRuns: 30 },
    );
  });
});
