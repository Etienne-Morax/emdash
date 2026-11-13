import type { ContractClient } from '@emdash/wire/rpc';
import { remote, type RemoteModel } from '@emdash/wire/state';
import { domainClient } from '@core/primitives/wire/browser/connection';
import {
  useRemoteModelState,
  type UseRemoteModelStateResult,
} from '@core/primitives/wire/browser/use-remote-model-state';
import { mobileRemoteContract, mobileRemoteDomain } from '../contract';
import type { MobileRemoteStatus } from '../schemas';

export function getMobileRemoteClient(): Promise<ContractClient<typeof mobileRemoteContract>> {
  return domainClient(mobileRemoteDomain, mobileRemoteContract);
}

let modelPromise: Promise<RemoteModel<typeof mobileRemoteContract.status>> | undefined;

function getModel() {
  modelPromise ??= getMobileRemoteClient().then((client) =>
    remote(mobileRemoteContract.status, client.status)
  );
  return modelPromise;
}

/** Live Mobile access status: gateway state, pending pairing code, paired devices. */
export function useMobileRemoteStatus(): UseRemoteModelStateResult<MobileRemoteStatus> {
  return useRemoteModelState(mobileRemoteContract.status, getModel, undefined, 'current');
}
