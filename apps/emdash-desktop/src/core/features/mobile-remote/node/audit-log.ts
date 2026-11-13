import { appendFile, mkdir, readFile, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import { mobileAuditEntrySchema, type MobileAuditEntry } from '../api/schemas';

/** Rotates the log once it passes this size; one previous file is kept. */
const MAX_LOG_BYTES = 5 * 1024 * 1024;
/** High-frequency actions are logged at most once per device per window. */
const THROTTLE_WINDOW_MS = 60_000;
const MAX_ACTION_LENGTH = 120;
const THROTTLED_ACTIONS = new Set([
  'call conversations.tui.sendInput',
  'call conversations.tui.resize',
  'call conversations.markConversationSeen',
]);

export type MobileAuditLog = {
  record(entry: Omit<MobileAuditEntry, 'ts'>): void;
  recent(limit: number): Promise<MobileAuditEntry[]>;
  /** Resolves when queued writes have reached the file. */
  flush(): Promise<void>;
};

/**
 * Append-only JSONL audit trail of remote actions: who (device), what (action path), when,
 * and the outcome. It never holds inputs, tokens, codes or terminal data.
 */
export function createMobileAuditLog(options: {
  filePath: string;
  clock?: Clock;
  onError?: (error: unknown) => void;
}): MobileAuditLog {
  const clock = options.clock ?? systemClock;
  const lastLogged = new Map<string, number>();
  const suppressed = new Map<string, number>();
  let writes: Promise<void> = Promise.resolve();

  function enqueue(line: string): void {
    writes = writes
      .then(async () => {
        await mkdir(dirname(options.filePath), { recursive: true });
        await rotateIfNeeded(options.filePath);
        await appendFile(options.filePath, line, { encoding: 'utf8', mode: 0o600 });
      })
      .catch((error: unknown) => options.onError?.(error));
  }

  return {
    record(entry) {
      const ts = clock.now();
      const action = entry.action.slice(0, MAX_ACTION_LENGTH);
      const detail = entry.detail?.slice(0, MAX_ACTION_LENGTH);
      // Routine calls and refusals from unknown callers are logged at most once per window
      // each, so neither a chatty phone nor a flood of forged requests can rotate real
      // device activity out of the log. Suppressed refusals are counted on the next line.
      const anonymousDenial = entry.outcome === 'denied' && entry.deviceId === null;
      if ((THROTTLED_ACTIONS.has(action) && entry.outcome === 'ok') || anonymousDenial) {
        const key = `${entry.deviceId ?? '-'}|${action}|${detail ?? ''}`;
        const last = lastLogged.get(key);
        if (last !== undefined && ts - last < THROTTLE_WINDOW_MS) {
          suppressed.set(key, (suppressed.get(key) ?? 0) + 1);
          return;
        }
        lastLogged.set(key, ts);
        const count = suppressed.get(key);
        suppressed.delete(key);
        if (count && anonymousDenial) {
          enqueue(
            `${JSON.stringify({ ts, ...entry, action, detail: `${detail ?? 'denied'} (+${count} more)` })}\n`
          );
          return;
        }
      }
      enqueue(`${JSON.stringify({ ts, ...entry, action, ...(detail ? { detail } : {}) })}\n`);
    },
    async recent(limit) {
      await writes;
      let text: string;
      try {
        text = await readFile(options.filePath, 'utf8');
      } catch {
        return [];
      }
      const entries: MobileAuditEntry[] = [];
      const lines = text.split('\n');
      for (let i = lines.length - 1; i >= 0 && entries.length < limit; i -= 1) {
        const line = lines[i]?.trim();
        if (!line) continue;
        const parsed = mobileAuditEntrySchema.safeParse(safeJson(line));
        if (parsed.success) entries.push(parsed.data);
      }
      return entries;
    },
    flush: () => writes,
  };
}

async function rotateIfNeeded(filePath: string): Promise<void> {
  try {
    const info = await stat(filePath);
    if (info.size >= MAX_LOG_BYTES) await rename(filePath, `${filePath}.1`);
  } catch {
    // No log yet.
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
