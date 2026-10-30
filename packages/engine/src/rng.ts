/** mulberry32 over a uint32 held in the game state, so the engine stays pure and replayable. */
export function nextUint(seed: number): { value: number; seed: number } {
  const s = (seed + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: (t ^ (t >>> 14)) >>> 0, seed: s };
}

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  int(n: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
}

/** An Rng over a seed cell; `get`/`set` let the caller keep the seed wherever it lives. */
export function rngOver(get: () => number, set: (seed: number) => void): Rng {
  const next = (): number => {
    const r = nextUint(get());
    set(r.seed);
    return r.value / 4294967296;
  };
  const int = (n: number): number => Math.floor(next() * n);
  return {
    next,
    int,
    pick: (items) => items[int(items.length)] as never,
    shuffle: (items) => {
      const a = items.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [a[i], a[j]] = [a[j] as never, a[i] as never];
      }
      return a;
    },
  };
}

/** Standalone seeded Rng, for bots and tests. */
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return rngOver(
    () => s,
    (v) => {
      s = v;
    },
  );
}
