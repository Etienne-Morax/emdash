import {
  createECDH,
  createHmac,
  createPrivateKey,
  createCipheriv,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';

/**
 * Web Push (RFC 8030) with VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291),
 * on `node:crypto` only. Implemented here rather than with the `web-push` package to avoid
 * five transitive dependencies for ~150 lines of well-specified crypto.
 */

export type VapidKeys = {
  /** Uncompressed P-256 public key (65 bytes), base64url: the `applicationServerKey`. */
  publicKey: string;
  /** PKCS#8 DER private key, base64url. */
  privateKey: string;
};

export type PushTarget = {
  endpoint: string;
  /** Subscription's P-256 public key, base64url (65 bytes uncompressed). */
  p256dh: string;
  /** Subscription's auth secret, base64url (16 bytes). */
  auth: string;
};

export type PushRequest = {
  url: string;
  headers: Record<string, string>;
  body: Uint8Array;
};

/** Contact claim Apple and Mozilla require; deliberately not a personal address. */
export const VAPID_SUBJECT = 'https://github.com/generalaction/emdash';
const VAPID_TTL_SECONDS = 12 * 60 * 60;
/** Undelivered pushes expire after a day: a stale "agent waiting" is noise. */
const PUSH_TTL_SECONDS = 24 * 60 * 60;
const RECORD_SIZE = 4096;
const MAX_PAYLOAD_BYTES = 3_000;

/**
 * Push services the desktop may POST to. A phone supplies the endpoint, so without this list
 * a paired device could make the desktop send requests to any URL (SSRF).
 */
const ALLOWED_PUSH_HOST_SUFFIXES = [
  '.push.apple.com',
  'fcm.googleapis.com',
  '.push.services.mozilla.com',
  '.notify.windows.com',
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_PUSH_HOST_SUFFIXES.some((suffix) =>
    suffix.startsWith('.') ? host.endsWith(suffix) : host === suffix
  );
}

export function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x ?? '', 'base64url'),
    Buffer.from(jwk.y ?? '', 'base64url'),
  ]);
  return {
    publicKey: raw.toString('base64url'),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'),
  };
}

function vapidPrivateKey(keys: VapidKeys): KeyObject {
  return createPrivateKey({
    key: Buffer.from(keys.privateKey, 'base64url'),
    format: 'der',
    type: 'pkcs8',
  });
}

/** `Authorization: vapid t=<JWT>, k=<public key>` for one push service origin. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, nowMs: number): string {
  const audience = new URL(endpoint).origin;
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({
      aud: audience,
      exp: Math.floor(nowMs / 1000) + VAPID_TTL_SECONDS,
      sub: VAPID_SUBJECT,
    })
  ).toString('base64url');
  const unsigned = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: vapidPrivateKey(keys),
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `vapid t=${unsigned}.${signature}, k=${keys.publicKey}`;
}

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** RFC 8291 §3.4 + RFC 8188: one aes128gcm record carrying `payload`. */
export function encryptPushPayload(
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  payload: Uint8Array,
  options: { salt?: Buffer; ecdh?: ReturnType<typeof createECDH> } = {}
): Uint8Array {
  const userAgentPublic = Buffer.from(target.p256dh, 'base64url');
  const authSecret = Buffer.from(target.auth, 'base64url');
  if (userAgentPublic.length !== 65 || authSecret.length !== 16) {
    throw new Error('Invalid push subscription keys');
  }
  const ecdh = options.ecdh ?? createECDH('prime256v1');
  if (!options.ecdh) ecdh.generateKeys();
  const serverPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(userAgentPublic);

  const prkKey = hmac(authSecret, sharedSecret);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    userAgentPublic,
    serverPublic,
    Buffer.from([0x01]),
  ]);
  const ikm = hmac(prkKey, keyInfo);

  const salt = options.salt ?? randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);

  // A single, final record: payload followed by the 0x02 delimiter, no padding.
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(serverPublic.length, 20);
  return Buffer.concat([header, serverPublic, ciphertext]);
}

export function buildPushRequest(
  target: PushTarget,
  payload: unknown,
  keys: VapidKeys,
  nowMs: number
): PushRequest {
  if (!isAllowedPushEndpoint(target.endpoint)) {
    throw new Error('Push endpoint is not a known push service');
  }
  const json = Buffer.from(JSON.stringify(payload));
  if (json.length > MAX_PAYLOAD_BYTES) throw new Error('Push payload too large');
  return {
    url: target.endpoint,
    headers: {
      Authorization: vapidAuthorization(target.endpoint, keys, nowMs),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(PUSH_TTL_SECONDS),
      Urgency: 'high',
    },
    body: encryptPushPayload(target, json),
  };
}
