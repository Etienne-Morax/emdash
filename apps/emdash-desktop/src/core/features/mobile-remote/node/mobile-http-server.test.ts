import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { secret, type Secret } from '@emdash/shared';
import {
  client,
  connect,
  createController,
  defineContract,
  procedure,
  webSocketTransport,
} from '@emdash/wire/rpc';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { z } from 'zod';
import type { SecretStore } from '@core/primitives/secrets/api/secret-store';
import { createMobileAuditLog, type MobileAuditLog } from './audit-log';
import { createMobileDeviceRegistry, type MobileDeviceRegistry } from './device-registry';
import { startMobileHttpServer, type MobileHttpServer } from './mobile-http-server';
import { createPairingManager, type PairingManager } from './pairing';

const LOGIN = 'me@example.com';
const ORIGIN = 'https://desk.tail1234.ts.net:8443';

const probeContract = defineContract({
  whoami: procedure({ input: z.void().optional(), output: z.string() }),
});

function memorySecrets(): SecretStore {
  const values = new Map<string, string>();
  return {
    getSecret: async (key) => {
      const value = values.get(key);
      return value === undefined ? null : secret(value, key);
    },
    setSecret: async (key, value: Secret<string>) => {
      values.set(key, value.expose());
    },
    deleteSecret: async (key) => {
      values.delete(key);
    },
  };
}

describe('mobile HTTP gateway', () => {
  let dir: string;
  let server: MobileHttpServer;
  let devices: MobileDeviceRegistry;
  let pairing: PairingManager;
  let audit: MobileAuditLog;
  let base: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'emdash-mobile-gateway-'));
    devices = createMobileDeviceRegistry({ secrets: memorySecrets() });
    pairing = createPairingManager();
    audit = createMobileAuditLog({ filePath: join(dir, 'audit.jsonl') });
    server = await startMobileHttpServer({
      host: '127.0.0.1',
      port: 0,
      identity: () => ({
        tailscaleLogin: LOGIN,
        allowedOrigins: [],
        magicDnsName: 'desk.tail1234.ts.net',
      }),
      devices,
      pairing,
      audit,
      createSessionController: (device) =>
        createController(probeContract, { whoami: () => device.label }),
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterEach(async () => {
    await server.close();
    await audit.flush();
    await rm(dir, { recursive: true, force: true });
  });

  const tailnet = { 'Tailscale-User-Login': LOGIN };
  const api = { ...tailnet, Origin: ORIGIN, 'Content-Type': 'application/json' };

  async function pair(label = 'Test phone'): Promise<string> {
    const { code } = pairing.start();
    const response = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: api,
      body: JSON.stringify({ code, label }),
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/);
    return /emdash_mobile_token=([^;]+)/.exec(cookie)?.[1] ?? '';
  }

  function openWire(headers: Record<string, string>): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}/wire`, { headers });
      socket.once('open', () => resolve(socket));
      socket.once('unexpected-response', (_request, response) =>
        reject(new Error(`HTTP ${response.statusCode}`))
      );
      socket.once('error', reject);
    });
  }

  it('serves no page, and answers only the tailnet user', async () => {
    const page = await fetch(`${base}/`, { headers: tailnet });
    expect(page.status).toBe(404);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect((await fetch(`${base}/index.html`, { headers: tailnet })).status).toBe(404);
    expect((await fetch(`${base}/`)).status).toBe(401);
    expect(
      (await fetch(`${base}/`, { headers: { 'Tailscale-User-Login': 'intruder@example.com' } }))
        .status
    ).toBe(401);
  });

  it('pairs a device with a one-time code and opens an authenticated Wire session', async () => {
    const token = await pair();

    const session = await fetch(`${base}/api/session`, {
      method: 'POST',
      headers: { ...api, Cookie: `emdash_mobile_token=${token}` },
    });
    expect(await session.json()).toMatchObject({ label: 'Test phone' });

    const socket = await openWire({
      ...tailnet,
      Origin: ORIGIN,
      Cookie: `emdash_mobile_token=${token}`,
    });
    const connection = connect(webSocketTransport(socket));
    try {
      await expect(client(probeContract, connection).whoami()).resolves.toBe('Test phone');
    } finally {
      connection.dispose();
      socket.close();
    }
  });

  it('refuses a reused or wrong pairing code', async () => {
    const { code } = pairing.start();
    const first = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: api,
      body: JSON.stringify({ code }),
    });
    expect(first.status).toBe(200);
    const again = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: api,
      body: JSON.stringify({ code }),
    });
    expect(again.status).toBe(401);
    expect(await again.text()).toBe('Unauthorized\n');
  });

  it.each([
    ['no token', (_token: string) => ({ ...tailnet, Origin: ORIGIN, token: '' })],
    ['a wrong token', () => ({ ...tailnet, Origin: ORIGIN, token: 'forged' })],
    [
      'a wrong Tailscale login',
      (token: string) => ({
        'Tailscale-User-Login': 'intruder@example.com',
        Origin: ORIGIN,
        token,
      }),
    ],
    ['no Tailscale login', (token: string) => ({ Origin: ORIGIN, token })],
    [
      'a foreign origin',
      (token: string) => ({ ...tailnet, Origin: 'https://evil.example.com', token }),
    ],
    ['no origin', (token: string) => ({ ...tailnet, token })],
  ])('refuses the Wire upgrade and the API with %s', async (_name, build) => {
    const valid = await pair();
    const { token, ...headers } = build(valid);
    const withToken: Record<string, string> = token
      ? { ...headers, Cookie: `emdash_mobile_token=${token}` }
      : headers;

    await expect(openWire(withToken)).rejects.toThrow('HTTP 401');
    const response = await fetch(`${base}/api/session`, { method: 'POST', headers: withToken });
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('Unauthorized\n');
  });

  it('refuses a revoked device and drops its open sockets', async () => {
    const token = await pair();
    const headers = { ...tailnet, Origin: ORIGIN, Cookie: `emdash_mobile_token=${token}` };
    const socket = await openWire(headers);
    const closed = new Promise<number>((resolve) => socket.once('close', resolve));

    const [device] = await devices.list();
    await devices.revoke(device!.id);
    server.disconnectDevice(device!.id);

    expect(await closed).toBe(4401);
    await expect(openWire(headers)).rejects.toThrow('HTTP 401');
  });

  it('records refusals in the audit log without secrets', async () => {
    const token = await pair();
    await fetch(`${base}/api/session`, {
      method: 'POST',
      headers: {
        ...tailnet,
        Origin: 'https://evil.example.com',
        Cookie: `emdash_mobile_token=${token}`,
      },
    });

    const entries = await audit.recent(10);
    expect(entries.map((entry) => [entry.action, entry.outcome, entry.detail])).toContainEqual([
      'session',
      'denied',
      'origin-mismatch',
    ]);
    expect(JSON.stringify(entries)).not.toContain(token);
  });
});
