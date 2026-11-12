import { createScope } from '@emdash/shared/concurrency';
import { waitFor } from '@emdash/shared/testing';
import { peek } from '@emdash/wire/state';
import { describe, expect, it, vi } from 'vitest';
import type { MobileRemoteSettings } from '../contributions/settings';
import type { MobileAuditLog } from './audit-log';
import type { MobileDeviceRegistry } from './device-registry';
import type { MobileHttpServer, MobileHttpServerOptions } from './mobile-http-server';
import { createMobileRemoteService, MOBILE_GATEWAY_HOST } from './mobile-remote-service';
import { createPairingManager } from './pairing';

function settingsPort(initial: MobileRemoteSettings) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    port: {
      read: async () => value,
      onChange: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    set(next: Partial<MobileRemoteSettings>) {
      value = { ...value, ...next };
      for (const listener of listeners) listener();
    },
  };
}

const devices: MobileDeviceRegistry = {
  list: async () => [],
  issue: async () => {
    throw new Error('unused');
  },
  authenticate: async () => null,
  revoke: async () => false,
  onChange: () => () => {},
};

const audit: MobileAuditLog = { record: () => {}, recent: async () => [], flush: async () => {} };

describe('mobile remote service', () => {
  it('runs the loopback gateway only while the setting is on', async () => {
    const scope = createScope({ label: 'mobile-remote-test' });
    const settings = settingsPort({
      enabled: false,
      port: 7781,
      tailscaleLogin: '',
      allowedOrigins: [],
    });
    const close = vi.fn(async () => {});
    const started: MobileHttpServerOptions[] = [];
    const startServer = vi.fn(
      async (options: MobileHttpServerOptions): Promise<MobileHttpServer> => {
        started.push(options);
        return { port: options.port, disconnectDevice: () => {}, close };
      }
    );
    const service = createMobileRemoteService({
      scope,
      settings: settings.port,
      devices,
      pairing: createPairingManager(),
      audit,
      staticRoot: () => null,
      createSessionController: () => {
        throw new Error('unused');
      },
      detectTailscale: async () => ({ login: 'me@example.com', dnsName: 'desk.tail.ts.net' }),
      startServer,
    });
    const status = service.observe(scope);
    try {
      await waitFor(() => peek(status).state === 'disabled');
      expect(startServer).not.toHaveBeenCalled();
      await expect(service.startPairing()).rejects.toThrow(/Turn on Mobile access/);

      settings.set({ enabled: true });
      await waitFor(() => peek(status).state === 'listening');
      expect(started[0]).toMatchObject({ host: MOBILE_GATEWAY_HOST, port: 7781 });
      expect(started[0]?.identity()).toMatchObject({
        tailscaleLogin: 'me@example.com',
        magicDnsName: 'desk.tail.ts.net',
      });
      expect(peek(status).allowedOrigins).toEqual(['https://desk.tail.ts.net']);
      const pairing = await service.startPairing();
      expect(peek(status).pairing?.code).toBe(pairing.code);

      settings.set({ enabled: false });
      await waitFor(() => peek(status).state === 'disabled');
      expect(close).toHaveBeenCalledTimes(1);
      expect(peek(status).pairing).toBeNull();
    } finally {
      await scope.dispose();
    }
  });

  it('reports a busy port as an error instead of failing open', async () => {
    const scope = createScope({ label: 'mobile-remote-port-test' });
    const settings = settingsPort({
      enabled: true,
      port: 7781,
      tailscaleLogin: 'me@example.com',
      allowedOrigins: [],
    });
    const service = createMobileRemoteService({
      scope,
      settings: settings.port,
      devices,
      pairing: createPairingManager(),
      audit,
      staticRoot: () => null,
      createSessionController: () => {
        throw new Error('unused');
      },
      detectTailscale: async () => ({ login: null, dnsName: null }),
      startServer: async () => {
        throw Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
      },
    });
    const status = service.observe(scope);
    try {
      await waitFor(() => peek(status).state === 'error');
      expect(peek(status).error).toBe('Port 7781 is already in use.');
    } finally {
      await scope.dispose();
    }
  });
});
