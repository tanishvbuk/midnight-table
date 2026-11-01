/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Game-night rehearsal against the real launcher (`scripts/start.ts`), in a separate process:
 *
 *   pnpm build && pnpm rehearsal
 *
 * A 6-player game, one human (this script, clicking real buttons in Chromium on a phone-sized
 * viewport) and five bots, is played from the home page to the final reveal. Part-way through,
 * the server process is killed with SIGKILL. The launcher restarts it, the room is rebuilt from
 * its log, and the phone must come back by its token without the human doing anything.
 *
 * The tunnel is a stand-in (scripts/fake-cloudflared.mjs): it prints a trycloudflare-style address
 * but does not carry traffic, so the browser talks to localhost. What this proves is the launcher,
 * the public-URL plumbing and the crash path; it cannot prove how a real tunnel behaves.
 *
 * Playwright is not a repo dependency (the cloud image ships it), so it is resolved at runtime.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BUDGET = 5000;

async function freePort(): Promise<number> {
  return new Promise((res) => {
    const s = netServer().listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });
}

async function until(pred: () => boolean | Promise<boolean>, ms: number, what: string) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred()) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Public state of the room as the castle sees it. Reconnects by itself when the server dies. */
class Observer {
  phase = '';
  day = 0;
  names: string[] = [];
  stateCount = 0;
  private ws: WebSocket | null = null;
  private closed = false;
  constructor(
    private url: string,
    private room: string,
  ) {
    this.connect();
  }
  private lastMsg = Date.now();
  private connect() {
    if (this.closed) return;
    this.ws?.close();
    const ws = new WebSocket(this.url);
    this.ws = ws;
    this.lastMsg = Date.now();
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', room: this.room, kind: 'castle' }));
    ws.onmessage = (e) => {
      this.lastMsg = Date.now();
      const m = JSON.parse(String(e.data));
      if (m.t !== 'state') return;
      this.stateCount++;
      this.phase = m.view.phase.kind;
      this.day = m.view.day;
      this.names = m.view.players.map((p: any) => p.name);
    };
    ws.onclose = () => {
      if (this.ws === ws) setTimeout(() => this.connect(), 300);
    };
    ws.onerror = () => {}; // onclose follows and reconnects
  }
  /** After a SIGKILL a socket can look open forever, so ping it and rebuild it if it goes quiet. */
  private watchdog = setInterval(() => {
    if (this.closed) return;
    if (Date.now() - this.lastMsg > 2500) return this.connect();
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'ping' }));
  }, 1000);
  close() {
    this.closed = true;
    clearInterval(this.watchdog);
    this.ws?.close();
  }
}

async function main() {
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), 'mt-rehearsal-'));
  const fakeUrl = 'https://fake-night-table.trycloudflare.com';
  const log: string[] = [];
  const launcher = spawn(resolve('node_modules/.bin/tsx'), ['scripts/start.ts'], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      CLOUDFLARED_BIN: resolve('scripts/fake-cloudflared.mjs'),
      TIME_SCALE: '0.08',
      BOT_DELAY_MS: '50,400',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  launcher.stdout.on('data', (d) => log.push(String(d)));
  launcher.stderr.on('data', (d) => log.push(String(d)));
  const base = `http://127.0.0.1:${port}`;
  const stopAll = () => {
    try {
      process.kill(-(launcher.pid as number), 'SIGTERM');
    } catch {
      /* already gone */
    }
  };

  let browser: any;
  let failed = false;
  let observer: Observer | null = null;
  try {
    await until(
      async () => {
        try {
          return (await fetch(`${base}/api/config`)).ok;
        } catch {
          return false;
        }
      },
      30_000,
      'the launcher to serve',
    );
    const cfg = (await (await fetch(`${base}/api/config`)).json()) as { publicUrl: string | null };
    if (cfg.publicUrl !== fakeUrl) throw new Error(`publicUrl was ${cfg.publicUrl}`);
    if (!log.join('').includes(fakeUrl)) throw new Error('launcher did not print the address');
    console.log(`launcher up on :${port}, public address ${cfg.publicUrl}`);

    browser = await chromium.launch();
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const phone = await ctx.newPage();
    const click = (name: string | RegExp, timeout = 3000) =>
      phone.getByRole('button', { name }).first().click({ timeout });

    await phone.goto(base + '/');
    await click('Create a room');
    await phone.waitForURL(/\/join\/[A-Z]{4}$/);
    const code = phone.url().split('/').pop() as string;
    await phone.getByPlaceholder('Your name').fill('Mira');
    await click('Take a seat');
    await phone.waitForURL(/\/play\//);
    // the host's QR code must carry the public address, not localhost
    const qrOk = await phone.evaluate(
      async () => (await (await fetch('/api/config')).json()).publicUrl !== null,
    );
    if (!qrOk) throw new Error('config endpoint did not offer a public url');
    await phone.locator('input[type=number]').fill('5');
    await click('Add bots');
    await phone.getByRole('button', { name: /Start with 6/ }).waitFor();
    observer = new Observer(`ws://127.0.0.1:${port}/ws`, code);
    await until(() => observer!.names.length === 6, 5000, 'six seats');
    const tokenKey = `mt:token:${code}`;
    const tokenBefore = await phone.evaluate((k: string) => localStorage.getItem(k), tokenKey);
    await click(/Start with 6/);

    const done = new Set<string>();
    const once = (key: string) => (done.has(key) ? false : (done.add(key), true));
    let killedAt = 0;
    let killPhase = '';
    let upAgainAt = 0;
    let rejoinedAt = 0;
    let before = { day: 0, names: [] as string[] };
    const end = Date.now() + 4 * 60_000;
    let seatGone = false;

    while (Date.now() < end) {
      const o = observer;
      const kind = o.phase;
      const key = `${o.day}:${kind}`;
      if (await phone.getByText(/seat is gone/i).count()) seatGone = true;

      // Chaos: the first time a vote opens, kill the server hard.
      if (!killedAt && kind === 'voting') {
        before = { day: o.day, names: [...o.names] };
        killPhase = kind;
        const countBefore = o.stateCount;
        killedAt = Date.now();
        execFileSync('pkill', ['-9', '-f', 'apps/server/src/main.ts']);
        console.log(`killed the server during "${kind}" (day ${o.day}); watching the phone...`);
        // Server back = the castle observer receives a state again.
        const up = async () => {
          try {
            return (await fetch(`${base}/api/rooms/${code}`, { signal: AbortSignal.timeout(500) }))
              .ok;
          } catch {
            return false;
          }
        };
        await until(async () => !(await up()), 10_000, 'the server to go down');
        await until(up, 30_000, 'the server to come back');
        await until(() => o.stateCount > countBefore, 10_000, 'the castle to reconnect');
        upAgainAt = Date.now();
        // Phone back = it shows a game screen again and no seat error.
        await until(
          async () =>
            (await phone.locator('main.phone').count()) > 0 &&
            (await phone.locator('.banner').count()) === 0,
          BUDGET,
          'the phone to rejoin within the 5 s budget',
        );
        rejoinedAt = Date.now();
        console.log(
          `outage ${((upAgainAt - killedAt) / 1000).toFixed(1)} s (kill -> server serving), ` +
            `phone rejoined ${rejoinedAt - upAgainAt} ms after the server came back`,
        );
        continue;
      }

      try {
        if (kind === 'finalReveal') {
          await sleep(500);
          break;
        }
        if (kind === 'roleReveal' && once(key)) {
          await click('I have seen it', 8000);
        } else if (kind === 'mission' && once(key)) {
          for (let i = 0; i < 8; i++) {
            await phone
              .getByRole('heading', { name: new RegExp(`Question ${i + 1} of`) })
              .waitFor();
            const options = phone.locator('.panel .stack button');
            await options.nth(i % (await options.count())).click();
          }
        } else if (kind === 'discussion' && once(key)) {
          await click('Ready to vote', 8000);
        } else if (kind === 'voting' && once(key)) {
          const chips = phone.locator('.panel .chips .chip');
          await chips.first().waitFor({ timeout: 3000 });
          await chips.first().click();
          await click('Lock in vote');
        } else if (kind === 'night' && once(key)) {
          await phone
            .getByRole('heading', { name: 'Night', exact: true })
            .waitFor({ timeout: 3000 });
          await phone.locator('.panel .chips .chip').first().click();
        } else if (kind === 'endgameVote' && once(key)) {
          await click('Banish again');
        }
      } catch {
        done.delete(key); // between screens, or this seat is a ghost with nothing to press; retry
      }
      await sleep(150);
    }

    if (observer.phase !== 'finalReveal') {
      const text = (
        await phone
          .locator('main.phone')
          .innerText()
          .catch(() => '?')
      ).slice(0, 300);
      throw new Error(
        `game did not reach the final reveal: castle sees phase=${observer.phase} day=${observer.day}; phone shows: ${text.replace(/\s+/g, ' ')}`,
      );
    }
    if (!killedAt) throw new Error('the server was never killed (no vote opened)');
    if (seatGone) throw new Error('the phone showed "seat is gone" after the restart');
    const tokenAfter = await phone.evaluate((k: string) => localStorage.getItem(k), tokenKey);
    if (tokenAfter !== tokenBefore) throw new Error('the phone token changed');
    if (observer.names.join() !== before.names.join()) throw new Error('the seats changed');
    if (observer.day < before.day) throw new Error('the game went back in time');
    if (rejoinedAt - upAgainAt > BUDGET) throw new Error('rejoin exceeded the budget');

    console.log(
      `PASS: 6 players (1 human) finished on day ${observer.day} through the launcher; ` +
        `server killed during "${killPhase}" and the room came back from its log.`,
    );
  } catch (e) {
    failed = true;
    throw e;
  } finally {
    observer?.close();
    await browser?.close().catch(() => {});
    stopAll();
    await sleep(500);
    let alive = false;
    try {
      alive = (await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(1000) })).ok;
    } catch {
      /* good: nothing is listening */
    }
    if (alive) console.log('WARNING: the server was still answering after shutdown');
    if (failed) console.log(log.join('').split('\n').slice(-25).join('\n'));
  }
}

main().catch((e) => {
  console.error(`FAIL: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
