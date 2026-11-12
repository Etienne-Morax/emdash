import type { Scope } from '@emdash/shared/concurrency';
import { createController, type Controller } from '@emdash/wire/rpc';
import { expose } from '@emdash/wire/state';
import { mobileRemoteContract } from '../api/contract';
import type { MobileRemoteSource } from './mobile-remote-service';

export function createMobileRemoteWireController(options: {
  scope: Scope;
  mobileRemote: MobileRemoteSource;
}): Controller {
  const status = expose(
    mobileRemoteContract.status,
    { current: (_key, owner) => options.mobileRemote.observe(owner) },
    { scope: options.scope, lingerMs: 0 }
  );

  return createController(mobileRemoteContract, {
    status,
    startPairing: () => options.mobileRemote.startPairing(),
    cancelPairing: () => options.mobileRemote.cancelPairing(),
    revokeDevice: ({ deviceId }) => options.mobileRemote.revokeDevice(deviceId),
    auditLog: ({ limit }) => options.mobileRemote.auditLog(limit),
    detectTailscale: () => options.mobileRemote.detectTailscale(),
  });
}
