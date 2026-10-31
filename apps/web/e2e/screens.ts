/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Browser-driven walkthrough that photographs every key screen on a phone (390px) and on the
 * castle (1280px).
 *
 *   pnpm build && pnpm screens --out docs/screens/after
 *
 * Playwright is not a repo dependency (the cloud image ships it), so it is resolved at runtime.
 *
 * Two kinds of run:
 *  - LIVE: a 6-player game, one human (this script, clicking real buttons on the real page) plus
 *    five bots, played from the home page to the final reveal on a shortened clock.
 *  - SEEDED: screens that depend on chance (being offered recruitment, being murdered) are reached
 *    by replaying an engine log that stops right at that moment, then letting the browser rejoin
 *    by device token. Real clock, real UI, but the road there was not clicked.
 */
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from '../../server/src/server';
import type { Room } from '../../server/src/room';
import { findFixture, humanMurdered, recruitOfferedToHuman, type Fixture } from './fixtures';

const { chromium } = createRequire(import.meta.url)('playwright');

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
};
const OUT = resolve(arg('out', 'docs/screens/before'));
const WEB_DIR = resolve('apps/web/dist');
const PHONE = { width: 390, height: 844 };
const CASTLE = { width: 1280, height: 720 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(pred: () => boolean | Promise<boolean>, ms = 60_000, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred()) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

interface Rig {
  base: string;
  room: (code: string) => Room;
  phone: any;
  castle: any;
}

const taken: string[] = [];
async function shoot(rig: Rig, name: string, which: 'both' | 'phone' | 'castle' = 'both') {
  const jobs: Promise<unknown>[] = [];
  if (which !== 'castle') jobs.push(rig.phone.screenshot({ path: join(OUT, `phone-${name}.png`) }));
  if (which !== 'phone')
    jobs.push(rig.castle.screenshot({ path: join(OUT, `castle-${name}.png`) }));
  await Promise.all(jobs);
  taken.push(name);
  console.log(`  shot ${name}`);
}

const click = (page: any, role: 'button', name: string | RegExp, timeout = 3000) =>
  page.getByRole(role, { name }).first().click({ timeout });

// ---------------------------------------------------------------- the human, driven by the DOM

async function revealScreens(rig: Rig) {
  const { phone } = rig;
  await phone.locator('.hold').waitFor();
  await shoot(rig, '1-role-reveal-before');
  const box = await phone.locator('.hold').boundingBox();
  await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await phone.mouse.down();
  await sleep(250);
  await shoot(rig, '2-role-reveal-held');
  await phone.mouse.up();
  await click(phone, 'button', 'I have seen it');
  await sleep(150);
  await click(phone, 'button', 'Show my card');
  await phone.locator('.card').waitFor();
  await sleep(150);
  await shoot(rig, '3-show-my-card', 'phone');
  await phone.locator('.modal').click({ position: { x: 5, y: 5 } });
}

async function playQuiz(rig: Rig, firstTime: boolean) {
  const { phone } = rig;
  for (let i = 0; i < 8; i++) {
    await phone.getByRole('heading', { name: new RegExp(`Question ${i + 1} of`) }).waitFor();
    if (firstTime && i === 0) await shoot(rig, '4-quiz');
    const options = phone.locator('.panel .stack button');
    await options.nth(i % (await options.count())).click();
  }
}

async function castVote(rig: Rig, shotName: string | null, avoid: string[]) {
  const { phone } = rig;
  const chips = phone.locator('.panel .chips .chip');
  await chips.first().waitFor({ timeout: 3000 });
  // Keep the only Traitor alive on day 1 so the game reaches a night. The script peeks at roles
  // for this one choice; every click is still a real click on the page.
  const names: string[] = await chips.allInnerTexts();
  const i = Math.max(
    0,
    names.findIndex((n) => !avoid.some((a) => n.includes(a))),
  );
  await chips.nth(i).click();
  if (shotName) await shoot(rig, shotName);
  await click(phone, 'button', 'Lock in vote');
}

async function playNight(rig: Rig, shotName: string | null) {
  const { phone } = rig;
  await phone.getByRole('heading', { name: 'Night', exact: true }).waitFor({ timeout: 3000 });
  await phone.locator('.panel .chips .chip').first().click();
  await phone.getByPlaceholder('Write a note').fill('Something feels off about the quiet ones.');
  await click(phone, 'button', 'Send');
  await sleep(200);
  if (shotName) await shoot(rig, shotName);
}

/** Plays the human's seat to the end of the game by looking at the page and clicking. */
async function driveHuman(rig: Rig, code: string, want: Set<string>) {
  const room = rig.room(code);
  const done = new Set<string>();
  const once = (key: string) => (done.has(key) ? false : (done.add(key), true));
  const humanId = room.state.hostId as string;
  let quizShot = true;
  const end = Date.now() + 15 * 60_000;
  while (Date.now() < end) {
    const s = room.state;
    const kind = s.phase.kind;
    const key = `${s.epoch}:${kind}`;
    const me = s.players.find((p) => p.id === humanId);
    try {
      if (kind === 'finalReveal') {
        await sleep(600);
        if (want.has('final')) await shoot(rig, '9-final-reveal');
        return;
      }
      if (me && me.fate !== 'alive' && kind !== 'lobby') {
        if (once('ghost') && want.has('ghost')) {
          await sleep(300);
          await shoot(rig, '7-ghost');
        }
        await sleep(300);
        continue;
      }
      if (kind === 'roleReveal' && once(key)) await revealScreens(rig);
      else if (kind === 'mission' && once(key)) {
        await playQuiz(rig, quizShot);
        quizShot = false;
      } else if (kind === 'discussion' && once(key)) {
        if (once('discussion-shot')) await shoot(rig, '5-discussion');
        await click(rig.phone, 'button', 'Ready to vote');
      } else if (kind === 'voting' && once(key)) {
        if (s.phase.kind === 'voting' && s.phase.eligible.includes(humanId))
          await castVote(
            rig,
            once('vote-shot') ? '6-vote' : null,
            s.players.filter((p) => p.role === 'traitor').map((p) => p.name),
          );
      } else if (kind === 'night' && once(key)) {
        await playNight(rig, once('night-shot') ? '6b-night-pick' : null);
      } else if (kind === 'endgameVote' && once(key)) {
        if (once('endgame-shot')) await shoot(rig, '6e-endgame-vote');
        await click(rig.phone, 'button', 'Banish again');
      } else if (kind === 'voteReveal' && once(key)) {
        await sleep(2200);
        if (once('reveal-shot')) await shoot(rig, '6c-vote-reveal', 'castle');
      } else if (kind === 'breakfast' && s.phase.kind === 'breakfast' && s.phase.announced) {
        if (once('breakfast-shot')) await shoot(rig, '6d-breakfast', 'castle');
      }
    } catch (e) {
      // The page was between screens; undo the "done" mark so the next tick retries this step.
      done.delete(key);
      console.log(`  retry ${key}: ${(e as Error).message.split('\n')[0]}`);
    }
    await sleep(150);
  }
  throw new Error('live game did not finish in 15 minutes');
}

// ---------------------------------------------------------------- scenarios

async function liveGame(rig: Rig) {
  console.log('LIVE: 6 players, human + 5 bots');
  const { phone, castle } = rig;
  await phone.goto(rig.base + '/');
  await shoot(rig, '0-home', 'phone');
  await click(phone, 'button', 'Create a room');
  await phone.waitForURL(/\/join\/[A-Z]{4}$/);
  const code = phone.url().split('/').pop() as string;
  await phone.getByPlaceholder('Your name').fill('Mira');
  await shoot(rig, '0-join', 'phone');
  await click(phone, 'button', 'Take a seat');
  await phone.waitForURL(/\/play\//);
  await castle.goto(`${rig.base}/castle/${code}`);
  await phone.locator('input[type=number]').fill('5');
  await click(phone, 'button', 'Add bots');
  await until(() => rig.room(code).state.players.length === 6, 5000, 'bots to sit');
  await sleep(500);
  await shoot(rig, '0-lobby');
  await click(phone, 'button', /Start with 6/);
  await driveHuman(rig, code, new Set(['final', 'ghost']));
}

/** The biggest table the game allows must still fit on the castle and read on the phone. */
async function bigTable(rig: Rig) {
  console.log('BIG: 16 players, lobby and role reveal');
  const { phone, castle } = rig;
  await phone.goto(rig.base + '/');
  await click(phone, 'button', 'Create a room');
  await phone.waitForURL(/\/join\/[A-Z]{4}$/);
  const code = phone.url().split('/').pop() as string;
  await phone.getByPlaceholder('Your name').fill('Mira');
  await click(phone, 'button', 'Take a seat');
  await phone.waitForURL(/\/play\//);
  await castle.goto(`${rig.base}/castle/${code}`);
  await phone.locator('input[type=number]').fill('15');
  await click(phone, 'button', 'Add bots');
  await until(() => rig.room(code).state.players.length === 16, 5000, 'bots to sit');
  await sleep(500);
  await shoot(rig, 'b1-16-lobby');
  await click(phone, 'button', /Start with 16/);
  await until(() => rig.room(code).state.phase.kind === 'roleReveal', 5000, 'role reveal');
  await sleep(2500);
  await shoot(rig, 'b2-16-role-reveal');
}

async function seeded(
  rig: Rig,
  name: string,
  fx: Fixture,
  code: string,
  then: () => Promise<void>,
) {
  console.log(`SEEDED ${name}: seed ${fx.seed}, ${fx.entries.length} log entries`);
  const { phone, castle } = rig;
  await phone.goto(rig.base + '/');
  await phone.evaluate(
    ([c, t]: string[]) => localStorage.setItem(`mt:token:${c}`, t),
    [code, fx.humanToken],
  );
  await castle.goto(`${rig.base}/castle/${code}`);
  await phone.goto(`${rig.base}/play/${code}`); // rejoins by token
  await sleep(800);
  await then();
}

function writeLog(dir: string, code: string, fx: Fixture) {
  const lines = fx.entries.map((e) => (e.k === 'create' ? { ...e, code } : e));
  writeFileSync(join(dir, `${code}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const mk = async (viewport: { width: number; height: number }, mobile: boolean) => {
    const ctx = await browser.newContext({
      viewport,
      deviceScaleFactor: mobile ? 2 : 1,
      isMobile: mobile,
      hasTouch: mobile,
    });
    return ctx.newPage();
  };

  // --- seeded fixtures are found first (pure engine, fast)
  console.log('searching for seeds…');
  const recruit = findFixture({ players: 8, goal: recruitOfferedToHuman });
  const ghost = findFixture({ players: 6, goal: humanMurdered });
  const dataDir = mkdtempSync(join(tmpdir(), 'mt-shots-'));
  writeLog(dataDir, 'RCRT', recruit);
  writeLog(dataDir, 'GHST', ghost);

  // --- LIVE run on a shortened clock
  const fast = createServer({
    port: 0,
    webDir: WEB_DIR,
    timeScale: 0.1,
    botDelayMs: [400, 1800],
    config: {
      timers: {
        roleRevealMs: 100_000,
        missionMs: 150_000,
        discussionMs: 60_000,
        votingMs: 100_000,
        voteRevealStepMs: 15_000,
        speechMs: 40_000,
        breakfastStepMs: 12_000,
      },
    },
  });
  const fastPort = await fast.listen();
  const rigFast: Rig = {
    base: `http://127.0.0.1:${fastPort}`,
    room: (c) => fast.manager.get(c) as Room,
    phone: await mk(PHONE, true),
    castle: await mk(CASTLE, false),
  };
  for (let attempt = 1; attempt <= 4 && !taken.includes('6b-night-pick'); attempt++) {
    if (attempt > 1) console.log('no night reached; playing another live game');
    await liveGame(rigFast);
  }
  await bigTable(rigFast);
  await fast.close();

  // --- SEEDED runs on the real clock
  const slow = createServer({ port: 0, webDir: WEB_DIR, dataDir, botDelayMs: [400, 1800] });
  const slowPort = await slow.listen();
  const rigSlow: Rig = {
    base: `http://127.0.0.1:${slowPort}`,
    room: (c) => slow.manager.get(c) as Room,
    phone: await mk(PHONE, true),
    castle: await mk(CASTLE, false),
  };
  await seeded(rigSlow, 'ghost', ghost, 'GHST', async () => {
    await shoot(rigSlow, '7-ghost');
  });
  await seeded(rigSlow, 'recruit', recruit, 'RCRT', async () => {
    await rigSlow.phone.getByRole('heading', { name: 'A dark invitation' }).waitFor();
    await shoot(rigSlow, '8-recruit-offer');
  });
  await slow.close();
  await browser.close();
  console.log(`done: ${taken.length} shots in ${OUT}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
