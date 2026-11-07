import type { ContractClient } from '@emdash/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { fleetContract, fleetDomain } from '../contract';

export function getFleetClient(): Promise<ContractClient<typeof fleetContract>> {
  return domainClient(fleetDomain, fleetContract);
}
