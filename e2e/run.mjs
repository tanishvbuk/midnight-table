// Optional end-to-end run: real Chromium, phone-sized viewports, against `pnpm start`.
//   pnpm e2e                  # needs `playwright` resolvable from Node (it is preinstalled in the
//                             # cloud sandbox; elsewhere: npm i -g playwright && npx playwright install chromium)
//   E2E_URL=https://... pnpm e2e   # skip spawning a server and test an already-running one
// Not part of CI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('playwright is not installed. See the header of e2e/run.mjs.');
  process.exit(2);
}

const PORT = Number(process.env.E2E_PORT ?? 8799);
const SCALE = process.env.TIME_SCALE ?? '0.06';
const BOTS = Number(process.env.E2E_BOTS ?? 5);
const OUT = join(process.cwd(), 'e2e', 'out');
mkdirSync(OUT, { recursive: true });
const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};
const TV = { viewport: { width: 1920, height: 1080 } };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const results = [];
async function check(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    log(`ok   ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push({ name, ok: false, error: e });
    log(`FAIL ${name}: ${e.message}`);
    throw e;
  }
}

// ---------------------------------------------------------------- server

let server = null;
let dataDir = null;
let base = process.env.E2E_URL;
if (!base) {
  dataDir = mkdtempSync(join(tmpdir(), 'mt-e2e-'));
  base = `http://localhost:${PORT}`;
  server = spawn('pnpm', ['start'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      TIME_SCALE: SCALE,
      BOT_DELAY_MS: '150,900',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // own process group, so the whole pnpm/tsx tree can be stopped
  });
  server.stderr.on('data', (d) => process.stderr.write(d));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 90_000);
    server.stdout.on('data', (d) => {
      if (String(d).includes('Midnight Table server')) {
        clearTimeout(t);
        resolve();
      }
    });
    server.on('exit', (c) => reject(new Error(`server exited early (${c})`)));
  });
}
const stop = () => {
  if (server) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
};
process.on('exit', stop);

const browser = await chromium.launch();
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) }).catch(() => {});

// ---------------------------------------------------------------- helpers

const title = (page) =>
  page
    .evaluate(() => document.querySelector('main.phone .panel h2')?.textContent ?? null)
    .catch(() => null);
const phoneText = (page) =>
  page.evaluate(() => document.querySelector('main.phone')?.innerText ?? '');

/** Press and hold the role button, return what it showed, then let go. */
async function holdReveal(page) {
  const btn = page.locator('button.hold');
  const box = await btn.boundingBox();
  assert(box, 'hold button has a box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForFunction(() =>
    /TRAITOR|FAITHFUL/.test(document.querySelector('.hold')?.innerText ?? ''),
  );
  const shown = await btn.innerText();
  await page.mouse.up();
  await page.waitForFunction(() =>
    /Press and hold/.test(document.querySelector('.hold')?.innerText ?? ''),
  );
  return shown;
}

/** Kill every socket this page has open now, without telling either side: what a locked phone does. */
function zombieControl(page) {
  const live = new Set();
  let opened = 0;
  page.routeWebSocket(/\/ws$/, (ws) => {
    const entry = { dead: false };
    live.add(entry);
    opened++;
    const srv = ws.connectToServer();
    ws.onMessage((m) => !entry.dead && srv.send(m));
    srv.onMessage((m) => !entry.dead && ws.send(m));
  });
  return {
    kill: () => live.forEach((e) => (e.dead = true)),
    opened: () => opened,
    /** What the browser does when the tab wakes up. */
    wake: () => page.evaluate(() => document.dispatchEvent(new window.Event('visibilitychange'))),
  };
}

// ---------------------------------------------------------------- scenarios

let code;
const host = await browser.newContext(PHONE);
const hostPage = await host.newPage();
const zombie = zombieControl(hostPage);
const errors = [];
hostPage.on('pageerror', (e) => errors.push(String(e)));

try {
  await check('create a room from the home page', async () => {
    await hostPage.goto(base);
    await hostPage.getByRole('button', { name: 'Create a room' }).click();
    await hostPage.waitForURL(/\/join\/[A-Z]{4}$/);
    code = hostPage.url().slice(-4);
    await shot(hostPage, '01-join');
  });

  const tv = await browser.newContext(TV);
  const tvPage = await tv.newPage();
  tvPage.on('pageerror', (e) => errors.push(String(e)));

  await check('the castle shows the code and a QR', async () => {
    await tvPage.goto(`${base}/castle/${code}`);
    await tvPage.waitForSelector('.bigcode');
    assert.equal((await tvPage.locator('.bigcode').innerText()).trim(), code);
    await tvPage.waitForSelector('.join-box img');
    await shot(tvPage, '02-castle-lobby');
  });

  await check('join with a name; the creator becomes host', async () => {
    await hostPage.getByPlaceholder('Your name').fill('Tanish');
    await hostPage.getByRole('button', { name: 'Take a seat' }).click();
    await hostPage.waitForSelector('text=You are the host');
    await hostPage.waitForSelector('img.qr');
    await shot(hostPage, '03-lobby-host');
  });

  await check('a second phone joins and the castle shows both', async () => {
    const ctx = await browser.newContext(PHONE);
    const p = await ctx.newPage();
    await p.goto(`${base}/join/${code}`);
    await p.getByPlaceholder('Your name').fill('Guest');
    await p.getByRole('button', { name: 'Take a seat' }).click();
    await p.waitForSelector('text=Waiting for the host to start');
    assert.equal(
      await p.getByRole('button', { name: 'Host' }).count(),
      0,
      'guest has no host menu',
    );
    await tvPage.waitForFunction(() => document.querySelectorAll('.seat').length === 2);
    await ctx.close();
  });

  await check('rejoin after a reload within 5 s, same player, same state', async () => {
    const t = Date.now();
    await hostPage.reload();
    await hostPage.waitForSelector('text=You are the host');
    const ms = Date.now() - t;
    assert(ms < 5000, `rejoin took ${ms} ms`);
    assert.match(await phoneText(hostPage), /Tanish/);
    // the guest who left is still a seat, and we did not take a second one
    await tvPage.waitForFunction(() => document.querySelectorAll('.seat').length === 2);
  });

  await check('a dead socket (phone lock) is replaced within 5 s', async () => {
    const before = zombie.opened();
    zombie.kill();
    await sleep(300);
    const t = Date.now();
    await zombie.wake();
    await hostPage.waitForFunction(() => true);
    for (;;) {
      if (zombie.opened() > before) break;
      assert(Date.now() - t < 5000, 'no new socket within 5 s');
      await sleep(50);
    }
    await hostPage.waitForSelector('text=You are the host');
    await hostPage.waitForFunction(() => !document.querySelector('.banner'));
    const ms = Date.now() - t;
    assert(ms < 5000, `recovered in ${ms} ms`);
    log(`     lock to rejoined: ${ms} ms`);
  });

  await check('host menu in the lobby: add bots, Start is disabled below 4', async () => {
    assert(await hostPage.getByRole('button', { name: /Need \d more/ }).isDisabled());
    await hostPage.getByRole('button', { name: 'Add bots' }).click(); // default 3
    await tvPage.waitForFunction((n) => document.querySelectorAll('.seat').length === n, 5);
  });

  await check('start a game', async () => {
    // The guest context is closed but its seat stays. Drop them so the table is 1 human + bots.
    await hostPage.getByRole('button', { name: 'Host' }).click();
    await hostPage.waitForSelector('text=Drop a disconnected player');
    await hostPage.locator('.sheet .chip', { hasText: 'Guest' }).click();
    await hostPage.waitForSelector('text=You are the host');
    const have = await tvPage.locator('.seat').count();
    const want = BOTS + 1;
    if (have < want) {
      await hostPage.locator('input[type=number]').fill(String(want - have));
      await hostPage.getByRole('button', { name: 'Add bots' }).click();
    }
    await tvPage.waitForFunction((n) => document.querySelectorAll('.seat').length === n, want);
    // R25: switch physical task cards on; the box only ticks once the server confirms.
    const physicalBox = hostPage.getByLabel(/Physical tasks/);
    await physicalBox.click(); // check() would fail: the box ticks only after the server confirms
    await hostPage.waitForFunction(
      () => document.querySelector('input[type=checkbox]:checked') !== null,
    );
    await hostPage.getByRole('button', { name: /Start with/ }).click();
    await hostPage.waitForSelector('text=Your role');
    await shot(tvPage, '04-castle-role-reveal');
  });

  let myRole = null;
  let sawPhysical = false;
  await check('hold to reveal shows the role only while held', async () => {
    assert(!/TRAITOR|FAITHFUL/.test(await phoneText(hostPage)), 'role visible before holding');
    const shown = await holdReveal(hostPage);
    myRole = /TRAITOR/.test(shown) ? 'traitor' : 'faithful';
    assert(
      !/TRAITOR|FAITHFUL/.test(
        (await hostPage.locator('.hold').innerText()).replace(/Press and hold to reveal/, ''),
      ),
    );
    log(`     this run's role: ${myRole}`);
  });

  await check('Show my card is the same Faithful card for everyone', async () => {
    await hostPage.getByRole('button', { name: 'Show my card' }).click();
    await hostPage.waitForSelector('.card');
    const card = await hostPage.locator('.card').innerText();
    assert.match(card, /FAITHFUL/);
    assert.doesNotMatch(card, /TRAITOR/);
    await shot(hostPage, '05-card');
    await hostPage.locator('.modal').click({ position: { x: 5, y: 5 } });
    await hostPage.waitForSelector('.card', { state: 'detached' });
  });

  await check('host menu: pause, add time and resume are announced on the castle', async () => {
    const open = async (name) => {
      await hostPage.getByRole('button', { name: 'Host', exact: true }).click();
      await hostPage.getByRole('button', { name }).click();
    };
    await open('Pause');
    await hostPage.waitForSelector('text=Paused by the host');
    await tvPage.waitForSelector('text=The host paused the game.');
    await tvPage.waitForSelector('.timer.paused');
    await shot(tvPage, '05b-castle-paused');
    await open('Resume');
    await hostPage.waitForSelector('text=Paused by the host', { state: 'detached' });
    await open('Add 60 seconds');
    await tvPage.waitForSelector('text=The host added 60 seconds.');
    const text = await phoneText(hostPage);
    assert.doesNotMatch(text, /TRAITOR/);
  });

  // ---- a full game, driven through the UI like a person would
  let reloadedMidQuiz = false;
  let zombieNight = false;
  let sawNightNote = null;
  const phasesSeen = new Set();
  const snapped = new Set();
  const nightScreens = [];
  const deadline = Date.now() + Number(process.env.E2E_GAME_MS ?? 8 * 60_000);

  await check('a full game with bots plays to the final reveal', async () => {
    await hostPage.getByRole('button', { name: 'I have seen it' }).click();
    for (;;) {
      assert(Date.now() < deadline, `game did not finish; last panel: ${await title(hostPage)}`);
      for (const [name, sel] of [
        ['10-castle-vote-reveal', '.vote-stage'],
        ['11-castle-breakfast-arrival', '.arriving'],
        ['12-castle-breakfast-verdict', '.verdict'],
        ['13-castle-speech', '.spotlight'],
      ]) {
        if (!snapped.has(name) && (await tvPage.locator(sel).count()) > 0) {
          snapped.add(name);
          if (!/breakfast/.test(name)) await sleep(900); // let the entrance animation finish
          await shot(tvPage, name);
        }
      }
      const t = await title(hostPage);
      if (t) phasesSeen.add(t.replace(/\d+/g, 'N'));
      if (t && /win/i.test(t)) break;
      try {
        if ((await hostPage.getByRole('button', { name: 'It passed' }).count()) > 0) {
          if (!sawPhysical) {
            sawPhysical = true;
            await shot(tvPage, '14-castle-physical-mission');
            await shot(hostPage, '15-physical-mission');
          }
          await hostPage.getByRole('button', { name: 'It passed' }).click({ timeout: 800 });
        } else if (t?.startsWith('Question')) {
          const n = Number(/Question (\d+)/.exec(t)[1]);
          if (n === 4 && !reloadedMidQuiz) {
            reloadedMidQuiz = true;
            const start = Date.now();
            await hostPage.reload();
            await hostPage.waitForFunction(() =>
              /Question/.test(document.querySelector('main.phone .panel h2')?.textContent ?? ''),
            );
            const ms = Date.now() - start;
            assert(ms < 5000, `mid-quiz rejoin took ${ms} ms`);
            assert.equal(await title(hostPage), t, 'quiz progress lost on reload');
            log(`     mid-quiz reload kept "${t}" in ${ms} ms`);
          }
          await hostPage.locator('.stack button').first().click({ timeout: 800 });
        } else if (t === 'The Round Table') {
          await hostPage.getByRole('button', { name: 'Ready to vote' }).click({ timeout: 800 });
        } else if (t === 'Cast your vote' || t === 'Run-off vote') {
          await hostPage.locator('.chips .chip').first().click({ timeout: 800 });
          await hostPage.getByRole('button', { name: 'Lock in vote' }).click({ timeout: 800 });
        } else if (t === 'The endgame') {
          await hostPage
            .getByRole('button', { name: Math.random() < 0.5 ? 'End the game' : 'Banish again' })
            .click({ timeout: 800 });
        } else if (t === 'Night') {
          nightScreens.push(await phoneText(hostPage));
          const chips = hostPage.locator('.chips .chip');
          if (!zombieNight) {
            zombieNight = true;
            // The phone locks: the socket dies silently, then the player taps a pick, then wakes up.
            await shot(tvPage, '06-castle-night');
            await shot(hostPage, '07-night');
            const before = zombie.opened();
            zombie.kill();
            await chips.nth(1).click({ timeout: 800 });
            await hostPage.getByPlaceholder('Write a note').fill('draft survives');
            const start = Date.now();
            await zombie.wake();
            await hostPage.waitForFunction(
              () => document.querySelectorAll('.chip.selected').length === 1,
              null,
              { timeout: 5000 },
            );
            const ms = Date.now() - start;
            assert(zombie.opened() > before, 'a new socket was opened');
            assert(ms < 5000, `pick resent too slowly: ${ms} ms`);
            log(`     pick made while the socket was dead was resent and applied in ${ms} ms`);
            await hostPage.reload();
            await hostPage.waitForSelector('.chip.selected', { timeout: 5000 });
            assert.equal(
              await hostPage.getByPlaceholder('Write a note').inputValue(),
              'draft survives',
              'note draft lost',
            );
            sawNightNote = true;
          } else if ((await hostPage.locator('.chip.selected').count()) === 0) {
            await chips.first().click({ timeout: 800 });
          }
        } else if (t === 'A dark invitation') {
          await hostPage
            .getByRole('button', { name: Math.random() < 0.5 ? 'Join the Traitors' : 'Refuse' })
            .click({ timeout: 800 });
        }
      } catch {
        /* the phase moved on while we were clicking: look again */
      }
      await sleep(120);
    }
    log(`     physical mission card seen: ${sawPhysical}; phases: ${[...phasesSeen].join(' / ')}`);
    await shot(hostPage, '08-final-phone');
    await shot(tvPage, '09-final-castle');
  });

  await check('the phone never showed a role outside the reveal and the final screen', async () => {
    for (const text of nightScreens) assert.doesNotMatch(text, /TRAITOR|FAITHFUL/);
    assert(sawNightNote || BOTS < 5, 'night was exercised');
  });

  await check('the castle shows the final reveal with every role', async () => {
    await tvPage.waitForSelector('table.final');
    const roles = await tvPage.locator('table.final tr').count();
    assert.equal(roles, BOTS + 1);
  });

  await check('no uncaught page errors', async () => {
    assert.deepEqual(errors, []);
  });
} catch {
  log('stopping after failure');
  await shot(hostPage, 'failure-phone');
  process.exitCode = 1;
} finally {
  await browser.close();
  log(`${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  stop();
  process.exit(process.exitCode ?? 0);
}
