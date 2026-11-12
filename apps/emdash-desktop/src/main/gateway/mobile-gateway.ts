import { execFile } from 'node:child_process';
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
import { resolveMobileColors } from '@core/features/mobile-remote/node/colors';
import { createMobileDeviceRegistry } from '@core/features/mobile-remote/node/device-registry';
import { startMobileHttpServer } from '@core/features/mobile-remote/node/mobile-http-server';
import {
  createMobileRemoteService,
  createMobileRemoteSettingsPort,
  type MobileRemoteSource,
} from '@core/features/mobile-remote/node/mobile-remote-service';
import { createPairingManager } from '@core/features/mobile-remote/node/pairing';
import { createMobilePullRequestOperations } from '@core/features/mobile-remote/node/pull-requests';
import {
  createMobilePushService,
  createMobilePushSink,
} from '@core/features/mobile-remote/node/push-service';
import {
  createMobileSessionController,
  type MobileLocalOperations,
} from '@core/features/mobile-remote/node/session-controller';
import { detectTailscaleIdentity } from '@core/features/mobile-remote/node/tailscale';
import { repositoryContract } from '@core/features/repository/api/contract';
import { shortComputerName } from '@core/primitives/color-coding/api/color-coding';
import type { SecretStore } from '@core/primitives/secrets/api/secret-store';
import type { NotificationSink } from '@core/services/notifications/api/ports';
import { pullRequestsContract } from '@core/services/pull-requests/api/contract';
import type { AppSettingsService } from '@core/services/settings/node';
import { createLazyRoutingController } from './desktop-wire';

const execFileAsync = promisify(execFile);
const AUDIT_LOG_FILE = 'mobile-remote-audit.jsonl';

/** The desktop endpoints the gateway itself calls, outside the phone's contract. */
const gatewayDesktopContract = defineContract({
  machines: defineContract({ getMachines: machinesContract.getMachines }),
  repository: defineContract({ resolveProvider: repositoryContract.resolveProvider }),
  pullRequests: defineContract({
    getPullRequestsForBranch: pullRequestsContract.getPullRequestsForBranch,
    createPullRequest: pullRequestsContract.createPullRequest,
  }),
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
}): { source: MobileRemoteSource; pushSink: NotificationSink } {
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
  const push = createMobilePushService({
    secrets: options.secrets,
    devices,
    logger: options.logger,
  });
  // A revoked phone stops receiving notifications at once.
  let knownDeviceIds = new Set<string>();
  scope.add(
    devices.onChange(() => {
      void devices.list().then((list) => {
        const current = new Set(list.map((device) => device.id));
        for (const id of knownDeviceIds) if (!current.has(id)) void push.removeDevice(id);
        knownDeviceIds = current;
      });
    })
  );
  void devices.list().then((list) => {
    knownDeviceIds = new Set(list.map((device) => device.id));
  });

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
    pullRequests: createMobilePullRequestOperations({
      resolveProvider: (input) => desktop.repository.resolveProvider(input),
      getPullRequestsForBranch: (input) => desktop.pullRequests.getPullRequestsForBranch(input),
      createPullRequest: (input) => desktop.pullRequests.createPullRequest(input),
    }),
    push: {
      publicKey: () => push.publicKey(),
      subscribe: (deviceId, subscription) => push.subscribe(deviceId, subscription),
      unsubscribe: (deviceId, endpoint) => push.unsubscribe(deviceId, endpoint),
    },
    async taskDefaults() {
      const [defaultAgent, project] = await Promise.all([
        options.appSettings.get('defaultAgent'),
        options.appSettings.get('project'),
      ]);
      return {
        defaultAgent,
        branchPrefix: project.branchPrefix,
        appendRandomBranchSuffix: project.appendRandomBranchSuffix,
      };
    },
    async colors(request) {
      const [settings, remote] = await Promise.all([
        options.appSettings.get('interface'),
        desktop.machines.getMachines(),
      ]);
      return resolveMobileColors({
        request,
        machineIds: remote.map((machine) => machine.id),
        overrides: { projectColors: settings.projectColors, machineColors: settings.machineColors },
      });
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

  const source = createMobileRemoteService({
    scope,
    settings: createMobileRemoteSettingsPort(options.appSettings),
    devices,
    pairing: createPairingManager(),
    audit,
    createSessionController: (device) =>
      createMobileSessionController({ upstream: upstream.client, device, local, audit }),
    detectTailscale: detectTailscaleIdentity,
    startServer: startMobileHttpServer,
    logger: options.logger,
  });
  const pushSink = createMobilePushSink({
    push,
    isEnabled: async () => (await options.appSettings.get('mobileRemote')).enabled,
    logger: options.logger,
  });
  return { source, pushSink };
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
