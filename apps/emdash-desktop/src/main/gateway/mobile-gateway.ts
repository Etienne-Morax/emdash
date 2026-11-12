import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Scope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import { client, createInProcessWire, defineContract } from '@emdash/wire/rpc';
import { app } from 'electron';
import { machinesContract } from '@core/features/machines/api/contract';
import { mobileWireContract } from '@core/features/mobile-remote/api/mobile-contract';
import type { MobileAppearance, MobileMachine } from '@core/features/mobile-remote/api/schemas';
import { createMobileAuditLog } from '@core/features/mobile-remote/node/audit-log';
import { createMobileDeviceRegistry } from '@core/features/mobile-remote/node/device-registry';
import { startMobileHttpServer } from '@core/features/mobile-remote/node/mobile-http-server';
import {
  createMobileRemoteService,
  createMobileRemoteSettingsPort,
  type MobileRemoteSource,
} from '@core/features/mobile-remote/node/mobile-remote-service';
import { createPairingManager } from '@core/features/mobile-remote/node/pairing';
import {
  createMobileSessionController,
  type MobileLocalOperations,
} from '@core/features/mobile-remote/node/session-controller';
import { detectTailscaleIdentity } from '@core/features/mobile-remote/node/tailscale';
import { shortComputerName } from '@core/primitives/color-coding/api/color-coding';
import type { SecretStore } from '@core/primitives/secrets/api/secret-store';
import type { AppSettingsService } from '@core/services/settings/node';
import { createLazyRoutingController } from './desktop-wire';

const execFileAsync = promisify(execFile);
const AUDIT_LOG_FILE = 'mobile-remote-audit.jsonl';

/** The one desktop endpoint the gateway itself reads, outside the phone's contract. */
const gatewayDesktopContract = defineContract({
  machines: defineContract({ getMachines: machinesContract.getMachines }),
});

/**
 * Wires the Mobile access gateway into the desktop: phone sessions reach the same desktop
 * controllers a renderer window does, through the lazy routing controller, but only via the
 * allowlisted mobile contract.
 */
export function createMobileGateway(options: {
  scope: Scope;
  appSettings: AppSettingsService;
  secrets: SecretStore;
  logger: Logger;
}): MobileRemoteSource {
  const scope = options.scope.child('mobile-gateway');
  const upstream = createInProcessWire(mobileWireContract, createLazyRoutingController());
  scope.add(() => upstream.dispose());
  const desktop = client(gatewayDesktopContract, upstream.connection);

  const devices = createMobileDeviceRegistry({ secrets: options.secrets });
  const audit = createMobileAuditLog({
    filePath: join(app.getPath('userData'), AUDIT_LOG_FILE),
    onError: (error) =>
      options.logger.warn('mobile-remote: audit write failed', { error: String(error) }),
  });
  const computerName = readComputerName();

  const local: MobileLocalOperations = {
    desktopName: () => computerName.current,
    async machines(): Promise<MobileMachine[]> {
      const remote = await desktop.machines.getMachines();
      return [
        { id: 'local', kind: 'local', name: computerName.current },
        ...remote.map((machine) => ({
          id: machine.id,
          kind: 'remote' as const,
          name: machine.name,
        })),
      ];
    },
    async appearance(): Promise<MobileAppearance> {
      const settings = await options.appSettings.get('interface');
      return {
        projectColors: settings.projectColors,
        machineColors: settings.machineColors,
        localMachineName: computerName.current,
      };
    },
  };

  return createMobileRemoteService({
    scope,
    settings: createMobileRemoteSettingsPort(options.appSettings),
    devices,
    pairing: createPairingManager(),
    audit,
    staticRoot: resolveMobileAppRoot,
    createSessionController: (device) =>
      createMobileSessionController({ upstream: upstream.client, device, local, audit }),
    detectTailscale: detectTailscaleIdentity,
    startServer: startMobileHttpServer,
    logger: options.logger,
  });
}

/**
 * Built PWA location: `EMDASH_MOBILE_APP_DIR`, then the copy bundled next to the desktop
 * build (`out/mobile`), then the workspace build in development.
 */
function resolveMobileAppRoot(): string | null {
  const candidates = [
    process.env['EMDASH_MOBILE_APP_DIR'],
    join(app.getAppPath(), 'out', 'mobile'),
    join(app.getAppPath(), '..', 'emdash-mobile', 'dist'),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(join(candidate, 'index.html'))) return candidate;
  }
  return null;
}

function readComputerName(): { current: string } {
  const state = { current: shortComputerName(hostname()) };
  if (process.platform === 'darwin') {
    void execFileAsync('scutil', ['--get', 'ComputerName'])
      .then(({ stdout }) => {
        const name = stdout.trim();
        if (name) state.current = shortComputerName(name);
      })
      .catch(() => {});
  }
  return state;
}
