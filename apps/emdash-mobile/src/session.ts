import { z } from 'zod';

const sessionSchema = z.object({ deviceId: z.string(), label: z.string() });

export type DeviceSession = z.infer<typeof sessionSchema>;

export type SessionCheck =
  | { kind: 'paired'; session: DeviceSession }
  | { kind: 'unpaired' }
  | { kind: 'unreachable' };

export type PairResult =
  | { kind: 'paired'; session: DeviceSession }
  | { kind: 'refused' }
  | { kind: 'rate-limited' }
  | { kind: 'unreachable' };

async function post(path: string, body?: unknown): Promise<Response> {
  return await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Asks the gateway whether this app holds a valid device token (an HttpOnly cookie). */
export async function checkSession(): Promise<SessionCheck> {
  let response: Response;
  try {
    response = await post('/api/session');
  } catch {
    return { kind: 'unreachable' };
  }
  if (response.status === 401) return { kind: 'unpaired' };
  if (!response.ok) return { kind: 'unreachable' };
  const parsed = sessionSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? { kind: 'paired', session: parsed.data } : { kind: 'unreachable' };
}

export async function pairDevice(code: string, label: string): Promise<PairResult> {
  let response: Response;
  try {
    response = await post('/api/pair', { code, label });
  } catch {
    return { kind: 'unreachable' };
  }
  if (response.status === 429) return { kind: 'rate-limited' };
  if (response.status === 401 || response.status === 400) return { kind: 'refused' };
  if (!response.ok) return { kind: 'unreachable' };
  const parsed = sessionSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? { kind: 'paired', session: parsed.data } : { kind: 'unreachable' };
}

/** Revokes this device on the desktop and drops its cookie. */
export async function unpairDevice(): Promise<void> {
  await post('/api/logout').catch(() => undefined);
}

/** A readable default name for this phone in the desktop's device list. */
export function defaultDeviceLabel(userAgent: string = navigator.userAgent): string {
  if (/iPad/.test(userAgent)) return 'iPad';
  if (/iPhone/.test(userAgent)) return 'iPhone';
  if (/Android/.test(userAgent)) return 'Android phone';
  return 'Browser';
}
