import { getLink } from './wire/connection';

export type PushState =
  | 'unsupported'
  /** iOS only offers Web Push to apps added to the Home Screen. */
  | 'needs-install'
  | 'prompt'
  | 'enabled'
  | 'denied';

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export async function readPushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  if (!('PushManager' in window) || !('Notification' in window)) {
    return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'prompt';
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription ? 'enabled' : 'prompt';
}

function urlBase64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Must run from a tap: iOS only shows the permission prompt for a user gesture. */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'prompt';
  await syncPushSubscription();
  return readPushState();
}

/**
 * Makes sure the desktop holds this phone's current subscription. Subscriptions rotate
 * (browser updates, key changes), so the app re-sends it on every start.
 */
export async function syncPushSubscription(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission !== 'granted') return;
  const client = getLink().client;
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const { publicKey } = await client.mobile.push.publicKey();
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(publicKey),
    });
  }
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.['p256dh'] || !json.keys['auth']) return;
  await client.mobile.push.subscribe({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys['p256dh'], auth: json.keys['auth'] },
  });
}
