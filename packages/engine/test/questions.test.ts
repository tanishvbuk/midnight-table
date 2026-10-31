import { describe, expect, it } from 'vitest';
import { QUESTION_BANK, apply, createGame, createRng, drawQuestions, view } from '../src';
import type { Category } from '../src';

describe('quiz bank', () => {
  it('is big enough for the longest game without a repeat', () => {
    // 16 players: roughly a dozen missions of 8 questions.
    expect(QUESTION_BANK.length).toBeGreaterThanOrEqual(150);
  });

  it('is mixed: every category has real depth', () => {
    const counts = new Map<Category, number>();
    for (const b of QUESTION_BANK) counts.set(b.category, (counts.get(b.category) ?? 0) + 1);
    expect(counts.size).toBe(8);
    for (const [cat, n] of counts) expect(n, cat).toBeGreaterThanOrEqual(10);
  });

  it('has well-formed questions', () => {
    const texts = new Set<string>();
    for (const b of QUESTION_BANK) {
      const where = `"${b.text}"`;
      expect(b.text.trim(), where).toBe(b.text);
      expect(b.text.length, where).toBeLessThanOrEqual(100);
      expect(texts.has(b.text.toLowerCase()), `duplicate ${where}`).toBe(false);
      texts.add(b.text.toLowerCase());
      const options = [b.answer, ...b.wrong];
      expect(new Set(options.map((o) => o.toLowerCase())).size, `${where} options`).toBe(4);
      for (const o of options) {
        expect(o.trim().length, where).toBeGreaterThan(0);
        expect(o.length, `${where} option "${o}"`).toBeLessThanOrEqual(60);
        expect(/all of the above|none of the above/i.test(o), where).toBe(false);
      }
    }
  });
});

describe('drawQuestions', () => {
  it('returns the asked number, each with its answer at the index marked correct', () => {
    const { questions, used } = drawQuestions(createRng(1), [], 8);
    expect(questions).toHaveLength(8);
    expect(new Set(used).size).toBe(8);
    questions.forEach((q, i) => {
      const src = QUESTION_BANK[used[i] as number]!;
      expect(q.text).toBe(src.text);
      expect([...q.options].sort()).toEqual([src.answer, ...src.wrong].sort());
      expect(q.options[q.correct]).toBe(src.answer);
    });
  });

  it('never repeats a question within a game until the bank runs out', () => {
    const rng = createRng(7);
    let used: number[] = [];
    const per = 8;
    const missions = Math.floor(QUESTION_BANK.length / per);
    for (let m = 0; m < missions; m++) {
      const drawn = drawQuestions(rng, used, per);
      used = drawn.used;
    }
    expect(used).toHaveLength(missions * per);
    expect(new Set(used).size).toBe(used.length);
  });

  it('starts over instead of stalling when the bank is nearly spent', () => {
    const rng = createRng(3);
    const nearlyAll = QUESTION_BANK.map((_, i) => i).slice(0, QUESTION_BANK.length - 3);
    const { questions, used } = drawQuestions(rng, nearlyAll, 8);
    expect(questions).toHaveLength(8);
    expect(new Set(used).size).toBe(8);
  });

  it('spreads a mission across categories', () => {
    const rng = createRng(11);
    for (let i = 0; i < 200; i++) {
      const { used } = drawQuestions(rng, [], 8);
      const counts = new Map<string, number>();
      for (const u of used) {
        const c = QUESTION_BANK[u]!.category;
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      expect(Math.max(...counts.values())).toBeLessThanOrEqual(3);
    }
  });

  it('puts the right answer in every position about equally often', () => {
    const rng = createRng(5);
    const hits = [0, 0, 0, 0];
    for (let i = 0; i < 500; i++) {
      for (const q of drawQuestions(rng, [], 8).questions) hits[q.correct]!++;
    }
    const total = hits.reduce((a, b) => a + b, 0);
    for (const h of hits) expect(h / total).toBeGreaterThan(0.2);
    for (const h of hits) expect(h / total).toBeLessThan(0.3);
  });
});

describe('quiz in a game', () => {
  it('records asked questions in state and never sends the answer key to any screen', () => {
    let s = createGame({ seed: 4 });
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (const id of ids) s = apply(s, { type: 'join', id, name: id }).state;
    s = apply(s, { type: 'start', actor: 'a' }).state;
    for (const id of ids) s = apply(s, { type: 'ackRole', actor: id }).state;
    expect(s.phase.kind).toBe('mission');
    expect(s.usedQuestions).toHaveLength(8);
    for (const viewer of ['castle', ...ids]) {
      const json = JSON.stringify(view(s, viewer));
      expect(json).not.toContain('"correct"');
      expect(json).not.toContain('"answer"');
    }
  });
});
