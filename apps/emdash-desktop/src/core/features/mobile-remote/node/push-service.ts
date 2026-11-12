import { secret } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import { z } from 'zod';
import type { SecretStore } from '@core/primitives/secrets/api/secret-store';
import type { NotificationSink } from '@core/services/notifications/api/ports';
import type { MobilePushSubscription } from '../api/schemas';
import type { MobileDeviceRegistry } from './device-registry';
import {
  buildPushRequest,
  generateVapidKeys,
  isAllowedPushEndpoint,
  type PushRequest,
  type VapidKeys,
} from './web-push';

/** Encrypted secret-store keys: the VAPID key pair and the phones' push subscriptions. */
export const MOBILE_VAPID_SECRET = 'mobile-remote.vapid';
export const MOBILE_PUSH_SUBSCRIPTIONS_SECRET = 'mobile-remote.push-subscriptions';
const MAX_SUBSCRIPTIONS_PER_DEVICE = 4;
const SEND_TIMEOUT_MS = 10_000;
/** The push service forgot this subscription (uninstalled app, revoked permission). */
const GONE_STATUSES = new Set([404, 410]);

const vapidSchema = z.object({ publicKey: z.string(), privateKey: z.string() });
const storedSubscriptionSchema = z.object({
  deviceId: z.string(),
  endpoint: z.string(),
  p256dh: z.string(),
  auth: z.string(),
  createdAt: z.number().int(),
});
type StoredSubscription = z.infer<typeof storedSubscriptionSchema>;

/** What a notification on the phone shows and opens. */
export type MobilePushPayload = {
  title: string;
  body: string;
  /** In-app route to open, e.g. `/#/task/<project>/<task>`. */
  url: string;
  /** Collapses repeats for one conversation into one banner. */
  tag: string;
};

export type PushTransport = (request: PushRequest) => Promise<{ status: number }>;

export type MobilePushService = {
  publicKey(): Promise<string>;
  subscribe(deviceId: string, subscription: MobilePushSubscription): Promise<void>;
  unsubscribe(deviceId: string, endpoint: string): Promise<void>;
  removeDevice(deviceId: string): Promise<void>;
  send(payload: MobilePushPayload): Promise<{ sent: number; removed: number }>;
};

export const fetchPushTransport: PushTransport = async (request) => {
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: new Uint8Array(request.body),
    redirect: 'error',
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  await response.body?.cancel();
  return { status: response.status };
};

export function createMobilePushService(options: {
  secrets: SecretStore;
  devices: Pick<MobileDeviceRegistry, 'list'>;
  transport?: PushTransport;
  clock?: Clock;
  logger?: Logger;
}): MobilePushService {
  const clock = options.clock ?? systemClock;
  const transport = options.transport ?? fetchPushTransport;
  let keys: VapidKeys | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  }

  async function vapid(): Promise<VapidKeys> {
    if (keys) return keys;
    const stored = await options.secrets.getSecret(MOBILE_VAPID_SECRET);
    const parsed = stored ? vapidSchema.safeParse(safeJson(stored.expose())) : null;
    if (parsed?.success) {
      keys = parsed.data;
      return keys;
    }
    keys = generateVapidKeys();
    await options.secrets.setSecret(
      MOBILE_VAPID_SECRET,
      secret(JSON.stringify(keys), MOBILE_VAPID_SECRET)
    );
    return keys;
  }

  async function load(): Promise<StoredSubscription[]> {
    const stored = await options.secrets.getSecret(MOBILE_PUSH_SUBSCRIPTIONS_SECRET);
    if (!stored) return [];
    const parsed = z.array(storedSubscriptionSchema).safeParse(safeJson(stored.expose()));
    return parsed.success ? parsed.data : [];
  }

  async function save(subscriptions: StoredSubscription[]): Promise<void> {
    await options.secrets.setSecret(
      MOBILE_PUSH_SUBSCRIPTIONS_SECRET,
      secret(JSON.stringify(subscriptions), MOBILE_PUSH_SUBSCRIPTIONS_SECRET)
    );
  }

  return {
    async publicKey() {
      return (await vapid()).publicKey;
    },
    subscribe(deviceId, subscription) {
      if (!isAllowedPushEndpoint(subscription.endpoint)) {
        return Promise.reject(new Error('Push endpoint is not a known push service'));
      }
      return exclusive(async () => {
        const all = (await load()).filter((entry) => entry.endpoint !== subscription.endpoint);
        const others = all.filter((entry) => entry.deviceId !== deviceId);
        const mine = all
          .filter((entry) => entry.deviceId === deviceId)
          .slice(-(MAX_SUBSCRIPTIONS_PER_DEVICE - 1));
        await save([
          ...others,
          ...mine,
          {
            deviceId,
            endpoint: subscription.endpoint,
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
            createdAt: clock.now(),
          },
        ]);
      });
    },
    unsubscribe(deviceId, endpoint) {
      return exclusive(async () => {
        const all = await load();
        await save(
          all.filter((entry) => !(entry.deviceId === deviceId && entry.endpoint === endpoint))
        );
      });
    },
    removeDevice(deviceId) {
      return exclusive(async () => {
        await save((await load()).filter((entry) => entry.deviceId !== deviceId));
      });
    },
    async send(payload) {
      const [all, devices] = await Promise.all([load(), options.devices.list()]);
      const live = new Set(devices.map((device) => device.id));
      const targets = all.filter((entry) => live.has(entry.deviceId));
      const vapidKeys = await vapid();
      const gone: string[] = [];
      let sent = 0;
      await Promise.all(
        targets.map(async (target) => {
          try {
            const request = buildPushRequest(target, payload, vapidKeys, clock.now());
            const { status } = await transport(request);
            if (GONE_STATUSES.has(status)) gone.push(target.endpoint);
            else if (status >= 200 && status < 300) sent += 1;
            else options.logger?.warn('mobile-remote: push refused', { status });
          } catch (error) {
            options.logger?.warn('mobile-remote: push failed', { error: String(error) });
          }
        })
      );
      const orphaned = all.filter((entry) => !live.has(entry.deviceId)).map((e) => e.endpoint);
      const removed = new Set([...gone, ...orphaned]);
      if (removed.size > 0) {
        await exclusive(async () => {
          await save((await load()).filter((entry) => !removed.has(entry.endpoint)));
        });
      }
      return { sent, removed: removed.size };
    },
  };
}

/**
 * Forwards agent notifications (waiting for input, finished) to paired phones while Mobile
 * access is on. Every batch reaches it, whatever the desktop's focus: the point is to reach
 * someone who is away from the desk.
 */
export function createMobilePushSink(options: {
  push: Pick<MobilePushService, 'send'>;
  isEnabled: () => Promise<boolean>;
  logger?: Logger;
}): NotificationSink {
  return {
    id: 'mobile-push',
    async deliver({ notification, summary }) {
      if (notification.kind !== 'agent-attention' && notification.kind !== 'agent-complete') return;
      if (notification.target.kind !== 'task') return;
      if (!(await options.isEnabled())) return;
      const { projectId, taskId } = notification.target;
      try {
        await options.push.send({
          title: summary.title,
          body: summary.body,
          url: `/#/task/${encodeURIComponent(projectId)}/${encodeURIComponent(taskId)}`,
          tag: notification.groupKey,
        });
      } catch (error) {
        options.logger?.warn('mobile-remote: push delivery failed', { error: String(error) });
      }
    },
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
