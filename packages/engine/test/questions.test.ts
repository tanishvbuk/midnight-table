import { describe, expect, it } from 'vitest';
import { QUESTION_BANK, QUESTION_SETS, view } from '../src/index';
import { ids, ok, patch, started, tickTo } from './harness';

describe('question bank', () => {
  it('is large, mixed and well formed', () => {
    expect(QUESTION_BANK.length).toBeGreaterThanOrEqual(120);
    const categories = Object.values(QUESTION_SETS);
    expect(categories.length).toBeGreaterThanOrEqual(8);
    for (const set of categories) expect(set.length).toBeGreaterThanOrEqual(10);
    const texts = new Set<string>();
    for (const q of QUESTION_BANK) {
      expect(texts.has(q.text), `duplicate: ${q.text}`).toBe(false);
      texts.add(q.text);
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options).size, q.text).toBe(4);
      expect(q.options[q.correct]).toBeTruthy();
      expect(q.text.trim().length).toBeGreaterThan(10);
    }
  });

  it('puts the right answer in every position about equally often', () => {
    const counts = [0, 0, 0, 0];
    for (const q of QUESTION_BANK) counts[q.correct] = (counts[q.correct] ?? 0) + 1;
    const mean = QUESTION_BANK.length / 4;
    for (const n of counts) expect(Math.abs(n - mean)).toBeLessThan(mean * 0.15);
  });

  it('never repeats a question within a game, and keeps answers out of every view', () => {
    let s = tickTo(started(6, 5), 'mission');
    const seen = new Set<string>();
    const rounds = Math.floor(QUESTION_BANK.length / 8) + 1; // enough to wrap the bank once
    for (let round = 0; round < rounds; round++) {
      if (s.phase.kind !== 'mission') throw new Error('expected a mission');
      const wrapped = s.asked.length <= 8 && round > 0;
      if (wrapped) seen.clear();
      for (const q of s.phase.questions) {
        expect(seen.has(q.text), `repeated: ${q.text}`).toBe(false);
        seen.add(q.text);
      }
      for (const v of ['castle', ...ids(6)] as const) {
        expect(JSON.stringify(view(s, v))).not.toContain('"correct"');
      }
      // start the next mission the same way the engine does after a role reveal
      s = patch(s, (d) => void (d.phase = { kind: 'roleReveal', acked: ids(5) }));
      s = ok(s, { type: 'ackRole', actor: 'p6' }).state;
    }
  });
});
