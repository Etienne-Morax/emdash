import { err, ok, secret, type Secret } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { createManualClock, waitFor } from '@emdash/shared/testing';
import { peek } from '@emdash/wire/state';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { SecretStore } from '@core/primitives/secrets/api/secret-store';
import type { FleetSnapshot } from '../api/schemas';
import type { FleetSettings } from '../contributions/settings';
import {
  createFleetOverview,
  createFleetSettingsPort,
  FLEET_API_KEY_SECRET,
  FLEET_POLL_INTERVAL_MS,
} from './fleet-overview';
import type { fetchFleetSnapshot } from './fleet-snapshot-client';

const ENDPOINT = 'http://fleet.test:3001';

function snapshotAt(generatedAt: string): FleetSnapshot {
  return { machines: [], jobs: [], isKillSwitchEngaged: false, generatedAt };
}

function createFixture(options: { endpoint?: string; apiKey?: string | null } = {}) {
  const scope = createScope({ label: 'fleet-overview-test' });
  const clock = createManualClock(Date.parse('2026-11-07T20:00:00Z'));
  let settings: FleetSettings = { showInSidebar: true, endpoint: options.endpoint ?? ENDPOINT };
  let notifyChange: (() => void) | undefined;
  const unsubscribe = vi.fn();
  const stored = new Map<string, Secret<string>>();
  const initialKey = options.apiKey === undefined ? 'test-key' : options.apiKey;
  if (initialKey !== null) stored.set(FLEET_API_KEY_SECRET, secret(initialKey));
  const secrets: SecretStore = {
    getSecret: vi.fn(async (key: string) => stored.get(key) ?? null),
    setSecret: vi.fn(async (key: string, value: Secret<string>) => {
      stored.set(key, value);
    }),
    deleteSecret: vi.fn(async (key: string) => {
      stored.delete(key);
    }),
  };
  let reads = 0;
  const fetchSnapshot = vi.fn<typeof fetchFleetSnapshot>(async () =>
    ok(snapshotAt(`read-${++reads}`))
  );
  const fleet = createFleetOverview({
    scope,
    clock,
    secrets,
    fetchSnapshot,
    settings: {
      read: async () => settings,
      onChange: (listener) => {
        notifyChange = listener;
        return unsubscribe;
      },
    },
  });
  onTestFinished(() => scope.dispose());
  return {
    scope,
    clock,
    fleet,
    secrets,
    stored,
    fetchSnapshot,
    unsubscribe,
    setSettings(next: Partial<FleetSettings>) {
      settings = { ...settings, ...next };
      notifyChange?.();
    },
  };
}

describe('Fleet overview', () => {
  it('reads the snapshot while observed and polls every interval', async () => {
    const f = createFixture();
    const overview = f.fleet.observe(f.scope.child('view'));

    await waitFor(() => peek(overview).status === 'ready');
    expect(peek(overview)).toMatchObject({
      endpoint: ENDPOINT,
      hasApiKey: true,
      error: null,
      snapshot: { generatedAt: 'read-1' },
    });
    const [request] = f.fetchSnapshot.mock.calls[0] ?? [];
    expect(request?.endpoint).toBe(ENDPOINT);
    expect(request?.apiKey.expose()).toBe('test-key');

    await f.clock.advanceBy(FLEET_POLL_INTERVAL_MS);
    await waitFor(() => peek(overview).snapshot?.generatedAt === 'read-2');
  });

  it('stays unconfigured without an endpoint or a key and never calls the network', async () => {
    const noEndpoint = createFixture({ endpoint: '' });
    const first = noEndpoint.fleet.observe(noEndpoint.scope.child('view'));
    await waitFor(() => peek(first).status === 'unconfigured');
    expect(peek(first).hasApiKey).toBe(true);

    const noKey = createFixture({ apiKey: null });
    const second = noKey.fleet.observe(noKey.scope.child('view'));
    await waitFor(() => peek(second).status === 'unconfigured');
    expect(peek(second)).toMatchObject({ endpoint: ENDPOINT, hasApiKey: false });

    expect(noEndpoint.fetchSnapshot).not.toHaveBeenCalled();
    expect(noKey.fetchSnapshot).not.toHaveBeenCalled();
  });

  it('keeps the last good snapshot when a read fails', async () => {
    const f = createFixture();
    const overview = f.fleet.observe(f.scope.child('view'));
    await waitFor(() => peek(overview).status === 'ready');

    f.fetchSnapshot.mockResolvedValueOnce(
      err({ kind: 'unreachable', message: 'Could not reach the fleet endpoint.' })
    );
    await f.clock.advanceBy(FLEET_POLL_INTERVAL_MS);

    await waitFor(() => peek(overview).status === 'error');
    expect(peek(overview)).toMatchObject({
      snapshot: { generatedAt: 'read-1' },
      error: { kind: 'unreachable' },
    });
  });

  it('stops polling once the last observer leaves', async () => {
    const f = createFixture();
    const view = f.scope.child('view');
    const overview = f.fleet.observe(view);
    await waitFor(() => peek(overview).status === 'ready');

    await view.dispose();
    const calls = f.fetchSnapshot.mock.calls.length;
    await f.clock.advanceBy(FLEET_POLL_INTERVAL_MS * 3);
    await f.fleet.refresh();

    expect(f.fetchSnapshot).toHaveBeenCalledTimes(calls);
  });

  it('rereads at once when the endpoint changes and drops the other fleet snapshot', async () => {
    const f = createFixture();
    const overview = f.fleet.observe(f.scope.child('view'));
    await waitFor(() => peek(overview).status === 'ready');

    f.fetchSnapshot.mockImplementationOnce(async () => err({ kind: 'http', message: 'HTTP 500' }));
    f.setSettings({ endpoint: 'http://other.test:3001' });

    await waitFor(() => peek(overview).status === 'error');
    expect(peek(overview)).toMatchObject({ endpoint: 'http://other.test:3001', snapshot: null });
  });

  it('saves a new key in the secret store and rereads with it', async () => {
    const f = createFixture({ apiKey: null });
    const overview = f.fleet.observe(f.scope.child('view'));
    await waitFor(() => peek(overview).status === 'unconfigured');

    await f.fleet.setApiKey(secret('new-key'));

    expect(f.stored.get(FLEET_API_KEY_SECRET)?.expose()).toBe('new-key');
    await waitFor(() => peek(overview).status === 'ready');
    expect(f.fetchSnapshot.mock.calls.at(-1)?.[0].apiKey.expose()).toBe('new-key');
  });

  it('forgets the key and the snapshot when the key is removed', async () => {
    const f = createFixture();
    const overview = f.fleet.observe(f.scope.child('view'));
    await waitFor(() => peek(overview).status === 'ready');

    await f.fleet.clearApiKey();

    expect(f.secrets.deleteSecret).toHaveBeenCalledWith(FLEET_API_KEY_SECRET);
    expect(peek(overview)).toMatchObject({
      status: 'unconfigured',
      hasApiKey: false,
      snapshot: null,
      endpoint: ENDPOINT,
    });
  });

  it('reports unreadable secure storage without crashing the poll loop', async () => {
    const f = createFixture();
    vi.mocked(f.secrets.getSecret).mockRejectedValueOnce(new Error('keychain locked'));
    const overview = f.fleet.observe(f.scope.child('view'));

    await waitFor(() => peek(overview).status === 'error');
    expect(peek(overview).error?.kind).toBe('storage');

    await f.clock.advanceBy(FLEET_POLL_INTERVAL_MS);
    await waitFor(() => peek(overview).status === 'ready');
  });

  it('unsubscribes from settings changes when its scope ends', async () => {
    const f = createFixture();
    await f.scope.dispose();
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('createFleetSettingsPort', () => {
  it('reads the fleet settings and only forwards changes of the fleet key', () => {
    const listeners = new Set<(key: string) => void>();
    const settings = {
      get: vi.fn(async () => ({ showInSidebar: true, endpoint: ENDPOINT })),
      on: vi.fn((_event: string, listener: (key: string) => void) => listeners.add(listener)),
      off: vi.fn((_event: string, listener: (key: string) => void) => listeners.delete(listener)),
    };
    const port = createFleetSettingsPort(
      settings as unknown as Parameters<typeof createFleetSettingsPort>[0]
    );
    const onChange = vi.fn();

    const stop = port.onChange(onChange);
    for (const listener of listeners) {
      listener('interface');
      listener('fleet');
    }
    stop();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });
});
