import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Action, ConfigOverrides, PlayerId } from '@midnight/engine';

export type LogEntry =
  | { k: 'create'; code: string; seed: number; config?: ConfigOverrides; ts: number }
  | { k: 'seat'; playerId: PlayerId; token: string; bot: boolean }
  | { k: 'autopilot'; playerId: PlayerId }
  | { k: 'phonesOnly'; on: boolean }
  | { k: 'act'; action: Action };

export interface RoomLog {
  append(entry: LogEntry): void;
}

export const nullLog: RoomLog = { append: () => {} };

/** Append-only JSONL per room: enough to rebuild the room exactly, since the engine is replayable. */
export class FileLog implements RoomLog {
  constructor(private path: string) {}
  append(entry: LogEntry): void {
    appendFileSync(this.path, JSON.stringify(entry) + '\n');
  }
}

export function logPath(dir: string, code: string): string {
  return join(dir, `${code}.jsonl`);
}

export function openLog(dir: string, code: string): FileLog {
  mkdirSync(dir, { recursive: true });
  return new FileLog(logPath(dir, code));
}

export function readLogs(dir: string): { code: string; entries: LogEntry[] }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const lines = readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean);
      const entries: LogEntry[] = [];
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line) as LogEntry);
        } catch {
          break; // a torn last line from a crash: replay up to here
        }
      }
      return { code: f.replace(/\.jsonl$/, ''), entries };
    });
}
