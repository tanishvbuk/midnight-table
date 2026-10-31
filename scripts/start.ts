/**
 * Game-night launcher: `pnpm start`.
 *
 * Starts a Cloudflare quick tunnel (a free https URL, no account), waits for its address, then runs
 * the game server with PUBLIC_URL set so QR codes carry the https address. The server is restarted
 * if it crashes and replays its room logs, so phones rejoin by token. The tunnel is never restarted
 * on its own: a new tunnel means a new address, and a phone's seat token is tied to the old one.
 *
 * Environment:
 *   PORT          server port (default 8787)
 *   TUNNEL        "cloudflared" (default) or "none"
 *   PUBLIC_URL    use your own https address (Tailscale Funnel, ngrok, ...); no tunnel is started
 *   CLOUDFLARED_BIN  path to the cloudflared binary (default "cloudflared")
 *   DATA_DIR, TIME_SCALE, BOT_DELAY_MS  passed through to the server
 */
import { spawn, type ChildProcess } from 'node:child_process';

const port = Number(process.env.PORT ?? 8787);
const bin = process.env.CLOUDFLARED_BIN ?? 'cloudflared';
const wantTunnel = !process.env.PUBLIC_URL && (process.env.TUNNEL ?? 'cloudflared') !== 'none';
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

let tunnel: ChildProcess | null = null;
let server: ChildProcess | null = null;
let stopping = false;

/** Children run in their own process group so pnpm -> tsx -> node all go down together. */
function killGroup(child: ChildProcess | null): void {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill();
  }
}

function stop(code: number): never {
  stopping = true;
  killGroup(tunnel);
  killGroup(server);
  process.exit(code);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

function startTunnel(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    tunnel = child;
    let found = false;
    const onData = (buf: Buffer) => {
      const m = URL_RE.exec(buf.toString());
      if (m && !found) {
        found = true;
        resolve(m[0]);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e: NodeJS.ErrnoException) =>
      reject(
        new Error(
          e.code === 'ENOENT'
            ? `"${bin}" is not installed. Install cloudflared (see README, "Game night"), or run with TUNNEL=none for LAN-only.`
            : e.message,
        ),
      ),
    );
    child.on('exit', (code) => {
      if (!found) reject(new Error(`cloudflared exited (${code}) before giving a URL.`));
      else if (!stopping) {
        console.error(
          '\n!! The tunnel process died. Phones can no longer reach the game.\n' +
            '!! Restarting it would change the address and every seat token with it.\n' +
            '!! Finish this game on the same Wi-Fi at http://<laptop-ip>:' +
            port +
            ', or restart everything and rejoin.\n',
        );
      }
    });
    setTimeout(() => !found && reject(new Error('Timed out waiting for the tunnel URL.')), 30_000);
  });
}

let restarts = 0;
function startServer(publicUrl: string | undefined): void {
  const child = spawn('pnpm', ['exec', 'tsx', 'apps/server/src/main.ts'], {
    stdio: 'inherit',
    detached: true,
    env: { ...process.env, PORT: String(port), ...(publicUrl ? { PUBLIC_URL: publicUrl } : {}) },
  });
  server = child;
  child.on('exit', (code, signal) => {
    if (stopping) return;
    restarts++;
    const wait = Math.min(1000 * restarts, 5000);
    console.error(
      `Server exited (${signal ?? code}). Restarting in ${wait / 1000}s; rooms are replayed from their logs.`,
    );
    setTimeout(() => startServer(publicUrl), wait);
  });
}

async function main(): Promise<void> {
  let publicUrl = process.env.PUBLIC_URL?.replace(/\/+$/, '');
  if (wantTunnel) {
    console.log('Starting tunnel...');
    try {
      publicUrl = await startTunnel();
    } catch (e) {
      console.error(`\n${(e as Error).message}\n`);
      stop(1);
    }
  }
  startServer(publicUrl);
  const line = '='.repeat(64);
  console.log(
    `\n${line}\n` +
      (publicUrl
        ? ` Open this on the laptop / TV (it must be the https address):\n   ${publicUrl}\n`
        : ` No https address: Wake Lock and selfies will not work on phones.\n   Local: http://localhost:${port}\n`) +
      `${line}\n`,
  );
}

void main();
