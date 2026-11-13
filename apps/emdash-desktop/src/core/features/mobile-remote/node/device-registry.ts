import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { secret } from '@emdash/shared';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import { z } from 'zod';
import type { SecretStore } from '@core/primitives/secrets/api/secret-store';
import type { MobileDevice } from '../api/schemas';

/** Encrypted secret-store key holding the paired devices and their token hashes. */
export const MOBILE_DEVICES_SECRET = 'mobile-remote.devices';
/** 256 bits of entropy per device token. */
const TOKEN_BYTES = 32;
/** `lastSeenAt` is persisted at most this often per device. */
const LAST_SEEN_PERSIST_INTERVAL_MS = 60_000;
const LABEL_MAX_LENGTH = 64;
const MAX_DEVICES = 32;

const storedDeviceSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** sha256 of the token, hex. The token itself is never stored. */
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.number().int(),
  lastSeenAt: z.number().int().nullable(),
});

type StoredDevice = z.infer<typeof storedDeviceSchema>;

export type IssuedDevice = { device: MobileDevice; token: string };

export type MobileDeviceRegistry = {
  list(): Promise<MobileDevice[]>;
  /** Creates a device and returns its token. The token is shown to the phone once. */
  issue(label: string): Promise<IssuedDevice>;
  /** Resolves the device holding `token`, or null. Constant-time per stored hash. */
  authenticate(token: string): Promise<MobileDevice | null>;
  /** Returns true when a device was removed. */
  revoke(deviceId: string): Promise<boolean>;
  onChange(listener: () => void): () => void;
};

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function sanitizeDeviceLabel(label: string): string {
  const cleaned = label
    .replace(/[\p{C}]/gu, '')
    .trim()
    .slice(0, LABEL_MAX_LENGTH);
  return cleaned.length > 0 ? cleaned : 'iPhone';
}

export function createMobileDeviceRegistry(options: {
  secrets: SecretStore;
  clock?: Clock;
}): MobileDeviceRegistry {
  const clock = options.clock ?? systemClock;
  const listeners = new Set<() => void>();
  let cache: StoredDevice[] | undefined;
  /** Serializes read-modify-write cycles on the secret. */
  let queue: Promise<unknown> = Promise.resolve();

  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  }

  async function load(): Promise<StoredDevice[]> {
    if (cache) return cache;
    const stored = await options.secrets.getSecret(MOBILE_DEVICES_SECRET);
    if (!stored) {
      cache = [];
      return cache;
    }
    const parsed = z.array(storedDeviceSchema).safeParse(safeJson(stored.expose()));
    // A corrupt record pairs nothing: every phone must pair again. Never fail open.
    cache = parsed.success ? parsed.data : [];
    return cache;
  }

  async function save(devices: StoredDevice[]): Promise<void> {
    cache = devices;
    await options.secrets.setSecret(
      MOBILE_DEVICES_SECRET,
      secret(JSON.stringify(devices), MOBILE_DEVICES_SECRET)
    );
  }

  function notify(): void {
    for (const listener of listeners) listener();
  }

  return {
    async list() {
      return (await load()).map(toPublicDevice);
    },
    issue(label) {
      return exclusive(async () => {
        const devices = await load();
        const token = randomBytes(TOKEN_BYTES).toString('base64url');
        const device: StoredDevice = {
          id: randomUUID(),
          label: sanitizeDeviceLabel(label),
          tokenHash: hashDeviceToken(token),
          createdAt: clock.now(),
          lastSeenAt: null,
        };
        // Oldest devices fall off rather than letting the list grow without bound.
        await save([...devices, device].slice(-MAX_DEVICES));
        notify();
        return { device: toPublicDevice(device), token };
      });
    },
    async authenticate(token) {
      if (token.length === 0 || token.length > 256) return null;
      const devices = await load();
      const candidate = Buffer.from(hashDeviceToken(token), 'hex');
      let match: StoredDevice | undefined;
      for (const device of devices) {
        const stored = Buffer.from(device.tokenHash, 'hex');
        if (stored.length === candidate.length && timingSafeEqual(stored, candidate)) {
          match = device;
        }
      }
      if (!match) return null;
      const now = clock.now();
      if (match.lastSeenAt === null || now - match.lastSeenAt > LAST_SEEN_PERSIST_INTERVAL_MS) {
        const id = match.id;
        void exclusive(async () => {
          const current = await load();
          await save(
            current.map((device) => (device.id === id ? { ...device, lastSeenAt: now } : device))
          );
          notify();
        }).catch(() => {});
        match = { ...match, lastSeenAt: now };
      }
      return toPublicDevice(match);
    },
    revoke(deviceId) {
      return exclusive(async () => {
        const devices = await load();
        const remaining = devices.filter((device) => device.id !== deviceId);
        if (remaining.length === devices.length) return false;
        await save(remaining);
        notify();
        return true;
      });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function toPublicDevice(device: StoredDevice): MobileDevice {
  return {
    id: device.id,
    label: device.label,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
