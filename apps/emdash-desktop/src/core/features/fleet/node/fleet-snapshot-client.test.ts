import { secret } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  FLEET_MAX_RESPONSE_BYTES,
  fetchFleetSnapshot,
  parseFleetSnapshot,
} from './fleet-snapshot-client';
import { rawFleetSnapshot } from './testing/fleet-snapshot-fixture';

const ENDPOINT = 'http://fleet.test:3001';
const API_KEY = secret('test-key', 'fleet.api-key');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('parseFleetSnapshot', () => {
  it('maps the RPC rows to the camelCase read model and drops unknown columns', () => {
    const snapshot = parseFleetSnapshot(rawFleetSnapshot());

    expect(snapshot?.machines[0]).toEqual({
      name: 'mbp-m5',
      capabilities: ['q_mac', 'q_xcode'],
      mode: 'claim',
      isAvailable: false,
      unavailableReasons: ['user present', 'on battery'],
      idleSeconds: 12.5,
      isOnAcPower: false,
      executorVersion: 'fleet-executor/1',
      lastHeartbeatAt: '2026-11-07T19:10:00.000000+00:00',
      isAlive: true,
      activeJobs: 1,
    });
    expect(snapshot?.jobs[0]).toMatchObject({
      id: 12,
      repo: 'morax-os',
      state: 'running',
      machine: 'mbp-m5',
      wipBranch: 'wip/fleet-12',
      attempt: 1,
      maxAttempts: 3,
    });
    expect(JSON.stringify(snapshot)).not.toContain('must-never-surface');
    expect(snapshot?.isKillSwitchEngaged).toBe(false);
  });

  it('tolerates a missing kill switch row and empty lists', () => {
    const snapshot = parseFleetSnapshot(
      rawFleetSnapshot({ kill_switch: null, jobs: null, machines: [] })
    );

    expect(snapshot).toMatchObject({ isKillSwitchEngaged: null, jobs: [], machines: [] });
  });

  it('rejects payloads that do not follow the contract', () => {
    expect(parseFleetSnapshot({ machines: [] })).toBeUndefined();
    expect(parseFleetSnapshot(rawFleetSnapshot({ jobs: [{ id: 'x' }] }))).toBeUndefined();
    expect(parseFleetSnapshot('nope')).toBeUndefined();
  });
});

describe('fetchFleetSnapshot', () => {
  it('posts to the RPC with the key, without following redirects', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(rawFleetSnapshot()));

    const result = await fetchFleetSnapshot({ endpoint: ENDPOINT, apiKey: API_KEY, fetchImpl });

    expect(result.success).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('http://fleet.test:3001/rest/v1/rpc/fleet_snapshot');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.headers).toMatchObject({ apikey: 'test-key', Authorization: 'Bearer test-key' });
  });

  it('does not call the network for an invalid endpoint', async () => {
    const fetchImpl = vi.fn();

    const result = await fetchFleetSnapshot({ endpoint: 'nope', apiKey: API_KEY, fetchImpl });

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({ kind: 'invalid-endpoint' }),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a refused key with the gateway message', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: '42501', message: 'permission denied for function fleet_snapshot' }, 401)
    );

    const result = await fetchFleetSnapshot({ endpoint: ENDPOINT, apiKey: API_KEY, fetchImpl });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.kind).toBe('unauthorized');
    expect(result.error.message).toContain('permission denied for function fleet_snapshot');
    expect(result.error.message).not.toContain('test-key');
  });

  it('treats a redirect as an error instead of replaying the key', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 307, headers: { Location: 'http://elsewhere' } })
    );

    const result = await fetchFleetSnapshot({ endpoint: ENDPOINT, apiKey: API_KEY, fetchImpl });

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({ kind: 'http', message: expect.stringContaining('307') }),
    });
  });

  it('reports network failures as unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    const result = await fetchFleetSnapshot({ endpoint: ENDPOINT, apiKey: API_KEY, fetchImpl });

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({ kind: 'unreachable' }),
    });
  });

  it('rejects non-JSON, off-contract and oversized answers', async () => {
    const html = vi.fn(async () => new Response('<html></html>', { status: 200 }));
    const offContract = vi.fn(async () => jsonResponse({ hello: 'world' }));
    const huge = vi.fn(async () => new Response('x'.repeat(FLEET_MAX_RESPONSE_BYTES + 1)));

    for (const fetchImpl of [html, offContract, huge]) {
      const result = await fetchFleetSnapshot({ endpoint: ENDPOINT, apiKey: API_KEY, fetchImpl });
      expect(result).toEqual({
        success: false,
        error: expect.objectContaining({ kind: 'invalid-response' }),
      });
    }
  });
});
