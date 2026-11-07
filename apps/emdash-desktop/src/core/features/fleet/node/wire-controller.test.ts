import type { Secret } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { waitFor } from '@emdash/shared/testing';
import { cell, observe, peek, remote } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { describe, expect, it, vi } from 'vitest';
import { fleetContract } from '../api/contract';
import type { FleetOverview } from '../api/schemas';
import { INITIAL_FLEET_OVERVIEW } from './fleet-overview';
import { createFleetWireController } from './wire-controller';

describe('Fleet Wire controller', () => {
  it('exposes the overview, keeps the key wrapped and releases demand on close', async () => {
    const scope = createScope({ label: 'fleet-controller-test' });
    const value = cell<FleetOverview>(INITIAL_FLEET_OVERVIEW);
    const release = vi.fn();
    const fleet = {
      observe: vi.fn((owner: Scope) => {
        owner.add(release);
        return value;
      }),
      refresh: vi.fn(async () => {}),
      setApiKey: vi.fn(async (_apiKey: Secret<string>) => {}),
      clearApiKey: vi.fn(async () => {}),
    };
    const wire = createTestWire(fleetContract, createFleetWireController({ scope, fleet }));
    const view = scope.child('view');
    const model = remote(fleetContract.overview, wire.client.overview, { scope: view });
    const overview = model(undefined).states.current;
    observe(overview, () => {}, { scope: view });
    try {
      await waitFor(() => peek(overview) !== undefined);
      value.set({ ...INITIAL_FLEET_OVERVIEW, status: 'unconfigured', endpoint: 'http://x.test' });
      await waitFor(() => peek(overview)?.status === 'unconfigured');

      await wire.client.setApiKey({ apiKey: '  pasted-key  ' });
      const saved = fleet.setApiKey.mock.calls[0]?.[0];
      expect(saved?.expose()).toBe('pasted-key');
      expect(JSON.stringify({ saved })).not.toContain('pasted-key');

      await wire.client.refresh();
      await wire.client.clearApiKey();
      expect(fleet.refresh).toHaveBeenCalledTimes(1);
      expect(fleet.clearApiKey).toHaveBeenCalledTimes(1);

      await view.dispose();
      await waitFor(() => release.mock.calls.length === 1);
    } finally {
      await scope.dispose();
      await wire.dispose();
    }
  });

  it('rejects an empty key before it reaches the store', async () => {
    const scope = createScope({ label: 'fleet-controller-validation-test' });
    const fleet = {
      observe: vi.fn(() => cell<FleetOverview>(INITIAL_FLEET_OVERVIEW)),
      refresh: vi.fn(async () => {}),
      setApiKey: vi.fn(async () => {}),
      clearApiKey: vi.fn(async () => {}),
    };
    const wire = createTestWire(fleetContract, createFleetWireController({ scope, fleet }));
    try {
      await expect(wire.client.setApiKey({ apiKey: '   ' })).rejects.toBeDefined();
      expect(fleet.setApiKey).not.toHaveBeenCalled();
    } finally {
      await scope.dispose();
      await wire.dispose();
    }
  });
});
