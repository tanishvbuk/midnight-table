import { describe, expect, it } from 'vitest';
import { narrate, view } from '../src/index';
import { at, ids, started, tick, withRoles } from './harness';

describe('narration', () => {
  it('has a line for every phase and never names a hidden role', () => {
    let s = withRoles(started(8), ['p2', 'p5']);
    const seen = new Set<string>();
    for (let i = 0; i < 300 && s.phase.kind !== 'finalReveal'; i++) {
      const line = narrate(view(s, 'castle'));
      expect(line.length).toBeGreaterThan(5);
      if (s.players.every((p) => !p.revealed)) expect(line).not.toMatch(/Traitor|Faithful/);
      seen.add(s.phase.kind);
      s = tick(s).state;
    }
    expect(seen.size).toBeGreaterThan(3);
  });

  it('announces the victim and the banished', () => {
    const s = at(started(6), {
      kind: 'breakfast',
      order: ids(6),
      shown: 0,
      victim: 'p3',
      murderFailed: false,
      announced: true,
    });
    expect(narrate(view(s, 'castle'))).toContain('p3 did not come to breakfast');
  });
});
