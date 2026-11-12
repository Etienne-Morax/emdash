import type { Scope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import { systemClock, type Clock, type TimerHandle } from '@emdash/shared/scheduling';
import type { Controller } from '@emdash/wire/rpc';
import { cell, peek, type Readable } from '@emdash/wire/state';
import type { AppSettingsService } from '@core/services/settings/node';
import type {
  MobileAuditEntry,
  MobileDevice,
  MobilePairing,
  MobileRemoteStatus,
} from '../api/schemas';
import type { MobileRemoteSettings } from '../contributions/settings';
import type { MobileAuditLog } from './audit-log';
import type { MobileDeviceRegistry } from './device-registry';
import type { MobileHttpServer, MobileHttpServerOptions } from './mobile-http-server';
import type { PairingManager } from './pairing';
import type { GatewayIdentity } from './request-auth';
import type { TailscaleIdentity } from './tailscale';

/** The gateway only ever binds loopback; `tailscale serve` is the ingress. */
export const MOBILE_GATEWAY_HOST = '127.0.0.1';

export type MobileRemoteSettingsPort = {
  read(): Promise<MobileRemoteSettings>;
  onChange(listener: () => void): () => void;
};

export function createMobileRemoteSettingsPort(
  settings: Pick<AppSettingsService, 'get' | 'on' | 'off'>
): MobileRemoteSettingsPort {
  return {
    read: () => settings.get('mobileRemote'),
    onChange(listener) {
      const handler = (key: string) => {
        if (key === 'mobileRemote') listener();
      };
      settings.on('app-settings:changed', handler);
      return () => settings.off('app-settings:changed', handler);
    },
  };
}

export type MobileRemoteSource = {
  observe(owner: Scope): Readable<MobileRemoteStatus>;
  startPairing(): Promise<MobilePairing>;
  cancelPairing(): void;
  revokeDevice(deviceId: string): Promise<void>;
  auditLog(limit: number): Promise<MobileAuditEntry[]>;
  detectTailscale(): Promise<TailscaleIdentity>;
};

type Options = {
  scope: Scope;
  settings: MobileRemoteSettingsPort;
  devices: MobileDeviceRegistry;
  pairing: PairingManager;
  audit: MobileAuditLog;
  staticRoot: () => string | null;
  createSessionController(device: MobileDevice): Controller;
  detectTailscale(): Promise<TailscaleIdentity>;
  startServer(options: MobileHttpServerOptions): Promise<MobileHttpServer>;
  logger?: Logger;
  clock?: Clock;
};

const INITIAL_STATUS: MobileRemoteStatus = {
  state: 'disabled',
  port: 0,
  tailscaleLogin: null,
  allowedOrigins: [],
  error: null,
  pairing: null,
  devices: [],
};

/**
 * Owns the Mobile access lifecycle: starts the loopback gateway while the setting is on,
 * stops it (and drops every phone session) when it is turned off, and publishes status,
 * pending pairing code and paired devices to the desktop settings UI.
 */
export function createMobileRemoteService(options: Options): MobileRemoteSource {
  const scope = options.scope.child('mobile-remote');
  const clock = options.clock ?? systemClock;
  const status = cell<MobileRemoteStatus>(INITIAL_STATUS);
  let identity: GatewayIdentity = { tailscaleLogin: null, allowedOrigins: [], magicDnsName: null };
  let server: MobileHttpServer | null = null;
  let running: { port: number } | null = null;
  let reconcileQueue: Promise<void> = Promise.resolve();
  let pairingTimer: TimerHandle | undefined;

  const patch = (next: Partial<MobileRemoteStatus>) => status.set({ ...peek(status), ...next });

  async function refreshDevices(): Promise<void> {
    patch({ devices: await options.devices.list() });
  }

  function refreshPairing(): void {
    void pairingTimer?.dispose();
    pairingTimer = undefined;
    const pending = options.pairing.pending();
    patch({ pairing: pending });
    if (pending) {
      pairingTimer = clock.schedule(Math.max(0, pending.expiresAt - clock.now()), refreshPairing, {
        unref: true,
      });
    }
  }

  async function stopServer(): Promise<void> {
    const current = server;
    server = null;
    running = null;
    options.pairing.cancel();
    if (current) await current.close();
  }

  async function reconcile(): Promise<void> {
    const settings = await options.settings.read();
    if (!settings.enabled) {
      await stopServer();
      patch({ state: 'disabled', port: settings.port, error: null });
      return;
    }

    const detected = await options.detectTailscale().catch(() => ({ login: null, dnsName: null }));
    identity = {
      tailscaleLogin: settings.tailscaleLogin.trim() || detected.login,
      allowedOrigins: settings.allowedOrigins,
      magicDnsName: detected.dnsName,
    };
    const allowedOrigins = [
      ...(identity.magicDnsName ? [`https://${identity.magicDnsName}`] : []),
      ...settings.allowedOrigins,
    ];
    patch({ tailscaleLogin: identity.tailscaleLogin, allowedOrigins });

    if (server && running?.port === settings.port) {
      patch({ state: 'listening', port: server.port, error: null });
      return;
    }
    await stopServer();
    patch({ state: 'starting', port: settings.port, error: null });
    try {
      server = await options.startServer({
        host: MOBILE_GATEWAY_HOST,
        port: settings.port,
        identity: () => identity,
        devices: options.devices,
        pairing: options.pairing,
        audit: options.audit,
        staticRoot: options.staticRoot(),
        createSessionController: options.createSessionController,
        onError: (error) =>
          options.logger?.warn('mobile-remote: gateway error', { error: String(error) }),
      });
      running = { port: settings.port };
      patch({ state: 'listening', port: server.port, error: null });
      options.logger?.info('mobile-remote: gateway listening', {
        port: server.port,
        login: identity.tailscaleLogin ?? 'none',
      });
    } catch (error) {
      server = null;
      running = null;
      const message =
        (error as NodeJS.ErrnoException)?.code === 'EADDRINUSE'
          ? `Port ${settings.port} is already in use.`
          : 'Could not start the mobile gateway.';
      options.logger?.warn('mobile-remote: gateway failed to start', { error: String(error) });
      patch({ state: 'error', error: message });
    }
  }

  function scheduleReconcile(): Promise<void> {
    reconcileQueue = reconcileQueue.then(reconcile, reconcile).catch((error: unknown) => {
      options.logger?.warn('mobile-remote: reconcile failed', { error: String(error) });
      patch({ state: 'error', error: 'Could not read the Mobile access settings.' });
    });
    return reconcileQueue;
  }

  scope.add(options.settings.onChange(() => void scheduleReconcile()));
  scope.add(options.devices.onChange(() => void refreshDevices()));
  scope.add(options.pairing.onChange(refreshPairing));
  scope.add(async () => {
    void pairingTimer?.dispose();
    await reconcileQueue;
    await stopServer();
  });
  void scheduleReconcile();
  void refreshDevices().catch(() => {});

  return {
    observe: () => status,
    async startPairing() {
      await reconcileQueue;
      if (!server) throw new Error('Turn on Mobile access before pairing a phone.');
      const pairing = options.pairing.start();
      options.audit.record({
        deviceId: null,
        deviceLabel: null,
        action: 'pairing code issued',
        outcome: 'ok',
      });
      return pairing;
    },
    cancelPairing: () => options.pairing.cancel(),
    async revokeDevice(deviceId) {
      const device = (await options.devices.list()).find((entry) => entry.id === deviceId);
      await options.devices.revoke(deviceId);
      server?.disconnectDevice(deviceId);
      options.audit.record({
        deviceId,
        deviceLabel: device?.label ?? null,
        action: 'device revoked',
        outcome: 'ok',
      });
    },
    auditLog: (limit) => options.audit.recent(limit),
    detectTailscale: () => options.detectTailscale(),
  };
}
