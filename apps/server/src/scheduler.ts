export interface TimerHandle {
  cancel(): void;
}

/** All server time goes through this, so tests can run whole games on a virtual clock. */
export interface Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
}

export const realScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    return { cancel: () => clearTimeout(t) };
  },
};

export class VirtualScheduler implements Scheduler {
  private time = 0;
  private seq = 0;
  private queue: { at: number; seq: number; fn: () => void; live: boolean }[] = [];

  now(): number {
    return this.time;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const item = { at: this.time + Math.max(0, ms), seq: this.seq++, fn, live: true };
    this.queue.push(item);
    return {
      cancel: () => {
        item.live = false;
      },
    };
  }

  /** Runs due callbacks in time order until `done()` or the queue empties. Returns events run. */
  run(done: () => boolean, maxEvents = 1_000_000): number {
    let n = 0;
    while (!done() && n < maxEvents) {
      this.queue = this.queue.filter((i) => i.live);
      if (this.queue.length === 0) break;
      this.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.queue.shift();
      if (!next) break;
      this.time = Math.max(this.time, next.at);
      next.fn();
      n++;
    }
    return n;
  }
}
