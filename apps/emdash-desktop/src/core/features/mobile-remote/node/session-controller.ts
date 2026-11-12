import {
  createController,
  forwardContractImpl,
  WireError,
  type ContractClient,
  type Controller,
} from '@emdash/wire/rpc';
import { mobileWireContract, type MobileWireContract } from '../api/mobile-contract';
import type {
  MobileAppearance,
  MobileDevice,
  MobileDeviceSession,
  MobileMachine,
  MobileTaskDefaults,
} from '../api/schemas';
import type { MobileAuditLog } from './audit-log';

/** Gateway-local operations behind the `mobile.*` endpoints. */
export type MobileLocalOperations = {
  desktopName(): string;
  machines(): Promise<MobileMachine[]>;
  appearance(): Promise<MobileAppearance>;
  taskDefaults(): Promise<MobileTaskDefaults>;
};

/**
 * Builds the controller one phone session talks to.
 *
 * `createController(mobileWireContract, …)` is the allowlist: it only routes paths and live
 * topics the mobile contract declares, and validates every input against the mobile
 * contract's (stricter) schemas before forwarding to `upstream`, a client of the same
 * contract connected to the desktop controllers. Every call is written to the audit log.
 */
export function createMobileSessionController(options: {
  upstream: ContractClient<MobileWireContract>;
  device: MobileDevice;
  local: MobileLocalOperations;
  audit: MobileAuditLog;
}): Controller {
  const { device, local, audit } = options;
  const forwarded = forwardContractImpl(mobileWireContract, options.upstream);
  const controller = createController(
    mobileWireContract,
    {
      ...forwarded,
      mobile: {
        session: (): MobileDeviceSession => ({
          deviceId: device.id,
          label: device.label,
          desktopName: local.desktopName(),
        }),
        machines: () => local.machines(),
        appearance: () => local.appearance(),
        taskDefaults: () => local.taskDefaults(),
      },
    },
    // Inputs are always validated, in every environment: they come from the network.
    { validate: 'inputs' }
  );

  return {
    async call(path, input, meta) {
      const action = `call ${path}`;
      try {
        const output = await controller.call(path, input, meta);
        audit.record({
          deviceId: device.id,
          deviceLabel: device.label,
          action,
          outcome: isFailedResult(output) ? 'error' : 'ok',
        });
        return output;
      } catch (error) {
        audit.record({
          deviceId: device.id,
          deviceLabel: device.label,
          action,
          outcome: isRefusal(error) ? 'denied' : 'error',
          detail: error instanceof WireError ? error.code : undefined,
        });
        throw error;
      }
    },
    resolveLive: (topic) => controller.resolveLive(topic),
    acquireLive: (topic) => controller.acquireLive(topic),
    dispose: () => controller.dispose?.() ?? Promise.resolve(),
  };
}

function isFailedResult(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    (value as { success: unknown }).success === false
  );
}

/** Paths outside the allowlist and inputs the strict schemas reject. */
function isRefusal(error: unknown): boolean {
  if (error instanceof WireError) return error.code === 'UNKNOWN_PROCEDURE';
  return error instanceof Error && error.name === 'ZodError';
}
