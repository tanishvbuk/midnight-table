import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Action, ConfigOverrides, PlayerId } from '@midnight/engine';

export type LogEntry =
  | { k: 'create'; code: string; seed: number; config?: ConfigOverrides; ts: number }
  | { k: 'seat'; playerId: PlayerId; token: string; bot: boolean }
  | { k: 'autopilot'; playerId: PlayerId }
  | { k: 'pause'; paused: boolean }
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

/**
 * Reads every room log. A crash can leave a torn last line, and appending after it would glue the
 * next entry onto the fragment and lose everything after it on the following replay. So when a log
 * has an unreadable tail, it is rewritten as just its valid prefix before anything appends to it.
 */
export function readLogs(dir: string): { code: string; entries: LogEntry[] }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const path = join(dir, f);
      const text = readFileSync(path, 'utf8');
      const entries: LogEntry[] = [];
      let clean = text === '' || text.endsWith('\n');
      for (const line of text.split('\n').filter(Boolean)) {
        try {
          entries.push(JSON.parse(line) as LogEntry);
        } catch {
          clean = false;
          break; // a torn line from a crash: replay up to here
        }
      }
      if (!clean) {
        writeFileSync(path, entries.map((e) => JSON.stringify(e) + '\n').join(''));
      }
      return { code: f.replace(/\.jsonl$/, ''), entries };
    });
}
