import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManualClock } from '@emdash/shared/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createMobileAuditLog } from './audit-log';

describe('mobile audit log', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function setup() {
    const dir = await mkdtemp(join(tmpdir(), 'emdash-mobile-audit-'));
    dirs.push(dir);
    const clock = createManualClock(1_000);
    return { clock, audit: createMobileAuditLog({ filePath: join(dir, 'audit.jsonl'), clock }) };
  }

  it('collapses floods of anonymous refusals so device activity survives', async () => {
    const { clock, audit } = await setup();
    audit.record({
      deviceId: 'd1',
      deviceLabel: 'phone',
      action: 'call tasks.createTask',
      outcome: 'ok',
    });
    for (let i = 0; i < 500; i += 1) {
      audit.record({
        deviceId: null,
        deviceLabel: null,
        action: 'http',
        outcome: 'denied',
        detail: 'login-mismatch',
      });
    }
    await clock.advanceBy(60_000);
    audit.record({
      deviceId: null,
      deviceLabel: null,
      action: 'http',
      outcome: 'denied',
      detail: 'login-mismatch',
    });

    const entries = await audit.recent(100);
    expect(entries).toHaveLength(3);
    expect(entries[0]?.detail).toBe('login-mismatch (+499 more)');
    expect(entries.at(-1)?.action).toBe('call tasks.createTask');
  });

  it('truncates long actions', async () => {
    const { audit } = await setup();
    audit.record({
      deviceId: 'd',
      deviceLabel: 'x',
      action: `call ${'a'.repeat(5_000)}`,
      outcome: 'ok',
    });

    const [entry] = await audit.recent(1);
    expect(entry?.action.length).toBeLessThanOrEqual(120);
  });
});
