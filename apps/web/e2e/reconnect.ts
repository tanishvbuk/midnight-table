/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * R3 in a real browser: refresh, a dropped socket and an offline blip, each timed against the
 * 5-second budget, with the phone parked in the Round Table after pressing "Ready to vote".
 *
 *   pnpm build && pnpm reconnect
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createServer } from '../../server/src/server';

const { chromium } = createRequire(import.meta.url)('playwright');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BUDGET = 5000;

async function main() {
  const server = createServer({ port: 0, webDir: resolve('apps/web/dist'), botDelayMs: [50, 300] });
  const base = `http://127.0.0.1:${await server.listen()}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  // Keep a handle on every socket the page opens, so a test can kill one from the inside.
  await page.addInitScript(() => {
    const Native = window.WebSocket;
    (window as any).__sockets = [];
    (window as any).WebSocket = class extends Native {
      constructor(url: string) {
        super(url);
        (window as any).__sockets.push(this);
      }
    };
  });
  const click = (name: string | RegExp) =>
    page.getByRole('button', { name }).first().click({ timeout: 5000 });

  await page.goto(base + '/');
  await click('Create a room');
  await page.getByPlaceholder('Your name').fill('Mira');
  await click('Take a seat');
  await page.locator('input[type=number]').fill('5');
  await click('Add bots');
  await page.getByRole('button', { name: /Start with 6/ }).waitFor();
  await click(/Start with 6/);
  await click('I have seen it');
  for (let i = 0; i < 8; i++) {
    await page.getByRole('heading', { name: new RegExp(`Question ${i + 1} of`) }).waitFor();
    await page.locator('.panel .stack button').first().click();
  }
  await page.getByRole('button', { name: 'Ready to vote' }).click({ timeout: 30_000 });
  await page.getByText(/^1 ready, \d+ needed/).waitFor();
  const marker = async () =>
    (await page.locator('main.phone').innerText()).replace(/\d+:\d\d/g, '');
  const before = await marker();
  const results: string[] = [];

  const settled = async (label: string, t0: number) => {
    await page.locator('.banner').waitFor({ state: 'detached', timeout: BUDGET });
    await page.getByText(/^1 ready, \d+ needed/).waitFor({ timeout: BUDGET });
    const took = Date.now() - t0;
    const intact = (await marker()) === before;
    results.push(`${label}: ${took} ms, state ${intact ? 'intact' : 'CHANGED'}`);
    if (took >= BUDGET || !intact) process.exitCode = 1;
  };

  // 1. Refresh
  let t0 = Date.now();
  await page.reload();
  await settled('refresh', t0);

  // 2. The socket dies under the page (what a locked phone looks like once it wakes)
  await sleep(500);
  t0 = Date.now();
  await page.evaluate(() => (window as any).__sockets.at(-1).close());
  await settled('socket dropped', t0);

  // 3. Offline for 3 seconds, then back (Wi-Fi hop)
  await sleep(500);
  await ctx.setOffline(true);
  await page.evaluate(() => (window as any).__sockets.at(-1).close());
  await sleep(3000);
  await ctx.setOffline(false);
  t0 = Date.now();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await settled('offline 3 s, then online', t0);

  console.log(results.join('\n'));
  await browser.close();
  await server.close();
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
