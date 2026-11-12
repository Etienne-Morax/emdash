import { secret, type Secret } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import type { SecretStore } from '@core/primitives/secrets/api/secret-store';
import {
  createMobileDeviceRegistry,
  hashDeviceToken,
  MOBILE_DEVICES_SECRET,
  sanitizeDeviceLabel,
} from './device-registry';

function memorySecrets(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const store: SecretStore = {
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
  return { store, values };
}

describe('mobile device registry', () => {
  it('issues a 256-bit token and stores only its hash', async () => {
    const { store, values } = memorySecrets();
    const registry = createMobileDeviceRegistry({ secrets: store });

    const { device, token } = await registry.issue('Etienne iPhone');

    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    const stored = values.get(MOBILE_DEVICES_SECRET) ?? '';
    expect(stored).not.toContain(token);
    expect(stored).toContain(hashDeviceToken(token));
    expect(await registry.authenticate(token)).toMatchObject({ id: device.id });
    expect(await registry.list()).toEqual([
      expect.not.objectContaining({ tokenHash: expect.anything() }),
    ]);
  });

  it('refuses unknown, empty and revoked tokens', async () => {
    const { store } = memorySecrets();
    const registry = createMobileDeviceRegistry({ secrets: store });
    const { device, token } = await registry.issue('phone');

    expect(await registry.authenticate('')).toBeNull();
    expect(await registry.authenticate(`${token}x`)).toBeNull();
    expect(await registry.revoke(device.id)).toBe(true);
    expect(await registry.authenticate(token)).toBeNull();
  });

  it('pairs nothing when the stored record is corrupt', async () => {
    const { store } = memorySecrets({ [MOBILE_DEVICES_SECRET]: '{not json' });
    const registry = createMobileDeviceRegistry({ secrets: store });

    expect(await registry.list()).toEqual([]);
    expect(await registry.authenticate('anything')).toBeNull();
  });

  it('strips control characters from labels', () => {
    expect(sanitizeDeviceLabel('  my\u0000 phone\n ')).toBe('my phone');
    expect(sanitizeDeviceLabel('\u0007')).toBe('iPhone');
  });
});
