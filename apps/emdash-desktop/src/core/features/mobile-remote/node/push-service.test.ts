import { createECDH } from 'node:crypto';
import { secret, type Secret } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { SecretStore } from '@core/primitives/secrets/api/secret-store';
import type { AppNotification } from '@core/services/notifications/api/schemas';
import type { MobileDevice } from '../api/schemas';
import { createMobilePushService, createMobilePushSink, type PushTransport } from './push-service';

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

function subscriptionFor(endpoint: string) {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  return {
    endpoint,
    keys: {
      p256dh: ua.getPublicKey().toString('base64url'),
      auth: Buffer.from('0123456789abcdef').toString('base64url'),
    },
  };
}

const phone: MobileDevice = { id: 'phone', label: 'iPhone', createdAt: 0, lastSeenAt: null };

describe('mobile push service', () => {
  it('sends encrypted VAPID pushes to the subscriptions of paired devices only', async () => {
    let devices: MobileDevice[] = [phone, { ...phone, id: 'old-phone' }];
    const transport = vi.fn<PushTransport>(async () => ({ status: 201 }));
    const push = createMobilePushService({
      secrets: memorySecrets(),
      devices: { list: async () => devices },
      transport,
    });
    await push.subscribe('phone', subscriptionFor('https://web.push.apple.com/a'));
    await push.subscribe('old-phone', subscriptionFor('https://web.push.apple.com/b'));
    devices = [phone];

    const result = await push.send({ title: 'Claude', body: 'waiting', url: '/#/', tag: 't' });

    expect(result).toEqual({ sent: 1, removed: 1 });
    const request = transport.mock.calls[0]![0];
    expect(request.url).toBe('https://web.push.apple.com/a');
    expect(request.headers['Authorization']).toMatch(/^vapid t=.+, k=.+$/);
    expect(request.headers['Content-Encoding']).toBe('aes128gcm');
    expect(Buffer.from(request.body).toString()).not.toContain('waiting');
  });

  it('forgets subscriptions the push service reports gone', async () => {
    const transport = vi.fn<PushTransport>(async () => ({ status: 410 }));
    const push = createMobilePushService({
      secrets: memorySecrets(),
      devices: { list: async () => [phone] },
      transport,
    });
    await push.subscribe('phone', subscriptionFor('https://web.push.apple.com/a'));

    expect(await push.send({ title: 'x', body: 'y', url: '/', tag: 't' })).toEqual({
      sent: 0,
      removed: 1,
    });
    await push.send({ title: 'x', body: 'y', url: '/', tag: 't' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('refuses endpoints that are not push services', async () => {
    const push = createMobilePushService({
      secrets: memorySecrets(),
      devices: { list: async () => [phone] },
      transport: async () => ({ status: 201 }),
    });

    await expect(
      push.subscribe('phone', subscriptionFor('https://attacker.example.com/collect'))
    ).rejects.toThrow(/not a known push service/);
  });

  it('keeps one stable VAPID key', async () => {
    const secrets = memorySecrets();
    const first = createMobilePushService({ secrets, devices: { list: async () => [] } });
    const second = createMobilePushService({ secrets, devices: { list: async () => [] } });

    expect(await second.publicKey()).toBe(await first.publicKey());
  });
});

describe('mobile push sink', () => {
  const notification = (kind: string): AppNotification => ({
    id: 'n1',
    kind,
    groupKey: 'conversation:c1',
    title: 'Claude Code - fix-login',
    body: 'Your agent is waiting for input',
    target: { kind: 'task', projectId: 'p1', taskId: 't1', conversationId: 'c1' },
    source: { kind: 'conversation', projectId: 'p1', taskId: 't1', conversationId: 'c1' },
    sound: 'needs_attention',
    count: 1,
    createdAt: 0,
    readAt: null,
  });

  it('pushes agent questions and completions with a link to the task', async () => {
    const send = vi.fn(async () => ({ sent: 1, removed: 0 }));
    const sink = createMobilePushSink({ push: { send }, isEnabled: async () => true });
    const batch = (kind: string) => ({
      notification: notification(kind),
      items: [notification(kind)],
      summary: { title: 'Claude Code - fix-login', body: 'Your agent is waiting for input' },
    });

    await sink.deliver(batch('agent-attention'));
    await sink.deliver(batch('update-available'));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      title: 'Claude Code - fix-login',
      body: 'Your agent is waiting for input',
      url: '/#/task/p1/t1',
      tag: 'conversation:c1',
    });
  });

  it('stays silent while Mobile access is off', async () => {
    const send = vi.fn(async () => ({ sent: 1, removed: 0 }));
    const sink = createMobilePushSink({ push: { send }, isEnabled: async () => false });

    await sink.deliver({
      notification: notification('agent-complete'),
      items: [],
      summary: { title: 'x', body: 'y' },
    });

    expect(send).not.toHaveBeenCalled();
  });
});
