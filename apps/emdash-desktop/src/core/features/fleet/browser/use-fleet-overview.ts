import { remote, type RemoteModel } from '@emdash/wire/state';
import {
  useRemoteModelState,
  type UseRemoteModelStateResult,
} from '@core/primitives/wire/browser/use-remote-model-state';
import { getFleetClient } from '../api/browser/client';
import { fleetContract } from '../api/contract';
import type { FleetOverview } from '../api/schemas';

/** Keeps the main-process poll alive briefly when the view is left and reopened. */
const FLEET_MODEL_LINGER_MS = 15_000;

let modelPromise: Promise<RemoteModel<typeof fleetContract.overview>> | undefined;

function getModel() {
  modelPromise ??= getFleetClient().then((client) =>
    remote(fleetContract.overview, client.overview, { lingerMs: FLEET_MODEL_LINGER_MS })
  );
  return modelPromise;
}

/** Live fleet overview; the main process polls `fleet_snapshot()` while this is mounted. */
export function useFleetOverview(): UseRemoteModelStateResult<FleetOverview> {
  return useRemoteModelState(fleetContract.overview, getModel, undefined, 'current');
}
