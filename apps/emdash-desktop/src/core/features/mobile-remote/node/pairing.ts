import { randomInt, timingSafeEqual } from 'node:crypto';
import { err, ok, type Result } from '@emdash/shared';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import type { MobilePairing } from '../api/schemas';

/** A pairing code lives ten minutes. */
export const PAIRING_TTL_MS = 10 * 60_000;
/** Wrong guesses that burn the pending code. */
export const PAIRING_MAX_ATTEMPTS = 5;
/** Claims accepted per rolling minute, across all callers. */
export const PAIRING_MAX_CLAIMS_PER_MINUTE = 10;
const MINUTE_MS = 60_000;
/** No 0/O, 1/I/L: easy to read aloud and type on a phone. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_LENGTH = 8;

export type PairingClaimError = 'no-pending-code' | 'expired' | 'invalid' | 'rate-limited';

export type PairingManager = {
  /** Issues a new code, replacing any pending one. */
  start(): MobilePairing;
  cancel(): void;
  pending(): MobilePairing | null;
  /** Consumes the pending code on success; burns it after too many wrong guesses. */
  claim(code: string): Result<void, PairingClaimError>;
  onChange(listener: () => void): () => void;
};

export function normalizePairingCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function createPairingManager(options: { clock?: Clock } = {}): PairingManager {
  const clock = options.clock ?? systemClock;
  const listeners = new Set<() => void>();
  let current: { code: string; expiresAt: number; failures: number } | null = null;
  let recentClaims: number[] = [];

  const notify = () => {
    for (const listener of listeners) listener();
  };

  function live(): typeof current {
    if (current && clock.now() >= current.expiresAt) {
      current = null;
      notify();
    }
    return current;
  }

  return {
    start() {
      let code = '';
      for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
        code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      }
      current = { code, expiresAt: clock.now() + PAIRING_TTL_MS, failures: 0 };
      notify();
      return { code, expiresAt: current.expiresAt };
    },
    cancel() {
      if (!current) return;
      current = null;
      notify();
    },
    pending() {
      const pending = live();
      return pending ? { code: pending.code, expiresAt: pending.expiresAt } : null;
    },
    claim(input) {
      const now = clock.now();
      recentClaims = recentClaims.filter((at) => now - at < MINUTE_MS);
      if (recentClaims.length >= PAIRING_MAX_CLAIMS_PER_MINUTE) return err('rate-limited');
      recentClaims.push(now);

      const pending = current;
      if (!pending) return err('no-pending-code');
      if (now >= pending.expiresAt) {
        current = null;
        notify();
        return err('expired');
      }
      const given = Buffer.from(normalizePairingCode(input).padEnd(PAIRING_CODE_LENGTH, '\0'));
      const expected = Buffer.from(pending.code);
      const matches = given.length === expected.length && timingSafeEqual(given, expected);
      if (!matches) {
        pending.failures += 1;
        if (pending.failures >= PAIRING_MAX_ATTEMPTS) {
          current = null;
          notify();
        }
        return err('invalid');
      }
      current = null;
      notify();
      return ok();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
