import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildPushRequest,
  encryptPushPayload,
  generateVapidKeys,
  isAllowedPushEndpoint,
  vapidAuthorization,
} from './web-push';

// RFC 8291 Appendix A test vector.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** The user agent's side of RFC 8291, to prove what we send decrypts. */
function decrypt(body: Uint8Array, uaPrivate: string, auth: string): string {
  const buffer = Buffer.from(body);
  const salt = buffer.subarray(0, 16);
  const idLength = buffer.readUInt8(20);
  const serverPublic = buffer.subarray(21, 21 + idLength);
  const ciphertext = buffer.subarray(21 + idLength);
  const ua = createECDH('prime256v1');
  ua.setPrivateKey(Buffer.from(uaPrivate, 'base64url'));
  const shared = ua.computeSecret(serverPublic);
  const prkKey = hmac(Buffer.from(auth, 'base64url'), shared);
  const ikm = hmac(
    prkKey,
    Buffer.concat([
      Buffer.from('WebPush: info\0'),
      ua.getPublicKey(),
      serverPublic,
      Buffer.from([1]),
    ])
  );
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  expect(plain.at(-1)).toBe(0x02);
  return plain.subarray(0, -1).toString('utf8');
}

describe('web push', () => {
  it('matches the RFC 8291 test vector byte for byte', () => {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(RFC.asPrivate, 'base64url'));
    const body = encryptPushPayload(
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      Buffer.from(RFC.plaintext),
      { salt: Buffer.from(RFC.salt, 'base64url'), ecdh }
    );
    expect(Buffer.from(body).toString('base64url')).toBe(RFC.body);
  });

  it('produces payloads the subscriber can decrypt', () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const auth = Buffer.from('0123456789abcdef').toString('base64url');
    const body = encryptPushPayload(
      { p256dh: ua.getPublicKey().toString('base64url'), auth },
      Buffer.from('{"title":"Claude - fix-login","body":"waiting"}')
    );
    expect(decrypt(body, ua.getPrivateKey().toString('base64url'), auth)).toContain('waiting');
  });

  it('signs a VAPID JWT for the push service origin with the server key', () => {
    const keys = generateVapidKeys();
    const header = vapidAuthorization('https://web.push.apple.com/abc', keys, 1_700_000_000_000);
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, head, claims, signature, k] = match!;
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toMatchObject({
      aud: 'https://web.push.apple.com',
      exp: 1_700_000_000 + 12 * 3600,
    });
    const raw = Buffer.from(keys.publicKey, 'base64url');
    const publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: raw.subarray(1, 33).toString('base64url'),
        y: raw.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    });
    expect(
      verify(
        'sha256',
        Buffer.from(`${head}.${claims}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature!, 'base64url')
      )
    ).toBe(true);
  });

  it('only posts to known push services', () => {
    expect(isAllowedPushEndpoint('https://web.push.apple.com/QGx')).toBe(true);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    for (const endpoint of [
      'http://web.push.apple.com/x',
      'https://evil.example.com/push',
      'https://web.push.apple.com.evil.com/x',
      'https://user:pass@web.push.apple.com/x',
      'https://web.push.apple.com:8443/x',
      'https://127.0.0.1/x',
      'not a url',
    ]) {
      expect(isAllowedPushEndpoint(endpoint)).toBe(false);
    }
    const keys = generateVapidKeys();
    expect(() =>
      buildPushRequest(
        { endpoint: 'https://evil.example.com/x', p256dh: RFC.uaPublic, auth: RFC.auth },
        { title: 'x' },
        keys,
        0
      )
    ).toThrow(/not a known push service/);
  });
});
