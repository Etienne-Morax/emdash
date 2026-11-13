import { secret } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import { createController, type Controller } from '@emdash/wire/rpc';
import { expose } from '@emdash/wire/state';
import { fleetContract } from '../api/contract';
import { FLEET_API_KEY_SECRET, type FleetOverviewSource } from './fleet-overview';

export function createFleetWireController(options: {
  scope: Scope;
  fleet: FleetOverviewSource;
}): Controller {
  const overview = expose(
    fleetContract.overview,
    { current: (_key, owner) => options.fleet.observe(owner) },
    { scope: options.scope, lingerMs: 0 }
  );

  return createController(fleetContract, {
    overview,
    refresh: () => options.fleet.refresh(),
    // The key is wrapped as soon as it crosses the wire and stays wrapped down to the request.
    setApiKey: ({ apiKey }) => options.fleet.setApiKey(secret(apiKey, FLEET_API_KEY_SECRET)),
    clearApiKey: () => options.fleet.clearApiKey(),
  });
}
