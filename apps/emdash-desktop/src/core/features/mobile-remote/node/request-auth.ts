import { err, ok, type Result } from '@emdash/shared';

/** HttpOnly cookie the pairing response sets; the app reads it once and then sends `Bearer`. */
export const DEVICE_TOKEN_COOKIE = 'emdash_mobile_token';
/** Header `tailscale serve` adds with the tailnet user's login name. */
export const TAILSCALE_USER_LOGIN_HEADER = 'tailscale-user-login';
/** ~400 days: the longest cookie lifetime browsers honour. Revocation is the real expiry. */
export const DEVICE_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export type RequestHeaders = Record<string, string | string[] | undefined>;

/** Why a request was refused. Logged in the audit trail; never sent to the client. */
export type DenyReason =
  | 'no-login-configured'
  | 'login-mismatch'
  | 'origin-mismatch'
  | 'no-token'
  | 'invalid-token';

export type GatewayIdentity = {
  /** Tailscale login the gateway accepts; null refuses every request. */
  tailscaleLogin: string | null;
  /** Exact `https://host[:port]` origins accepted. */
  allowedOrigins: readonly string[];
  /** MagicDNS name of this machine; any https origin on that host is accepted. */
  magicDnsName: string | null;
};

export function headerValue(headers: RequestHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}

/** The request came through `tailscale serve` from the configured tailnet user. */
export function checkTailnetLogin(
  headers: RequestHeaders,
  identity: GatewayIdentity
): Result<void, DenyReason> {
  const expected = identity.tailscaleLogin?.trim().toLowerCase();
  if (!expected) return err('no-login-configured');
  const given = headerValue(headers, TAILSCALE_USER_LOGIN_HEADER)?.trim().toLowerCase();
  return given === expected ? ok() : err('login-mismatch');
}

/** The browser origin is this machine's tailnet HTTPS name (or an explicitly allowed one). */
export function checkOrigin(
  headers: RequestHeaders,
  identity: GatewayIdentity
): Result<void, DenyReason> {
  const origin = headerValue(headers, 'origin');
  if (!origin) return err('origin-mismatch');
  if (identity.allowedOrigins.includes(origin)) return ok();
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return err('origin-mismatch');
  }
  const dnsName = identity.magicDnsName?.toLowerCase();
  if (
    dnsName &&
    parsed.protocol === 'https:' &&
    parsed.hostname.toLowerCase() === dnsName &&
    `${parsed.protocol}//${parsed.host}` === origin
  ) {
    return ok();
  }
  return err('origin-mismatch');
}

/** Reads the device token from the cookie, or from `Authorization: Bearer` for scripts. */
export function readDeviceToken(headers: RequestHeaders): string | null {
  const authorization = headerValue(headers, 'authorization');
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim();
    if (token.length > 0) return token;
  }
  const cookie = headerValue(headers, 'cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === DEVICE_TOKEN_COOKIE) {
      const value = part.slice(index + 1).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

export function deviceTokenCookie(token: string): string {
  return [
    `${DEVICE_TOKEN_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${DEVICE_COOKIE_MAX_AGE_SECONDS}`,
  ].join('; ');
}

export function clearedDeviceTokenCookie(): string {
  return `${DEVICE_TOKEN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
