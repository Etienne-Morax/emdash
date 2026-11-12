import { createManualClock } from '@emdash/shared/testing';
import { describe, expect, it } from 'vitest';
import {
  createPairingManager,
  PAIRING_CODE_LENGTH,
  PAIRING_MAX_ATTEMPTS,
  PAIRING_MAX_CLAIMS_PER_MINUTE,
  PAIRING_TTL_MS,
} from './pairing';

describe('pairing manager', () => {
  it('issues an 8-character unambiguous code that is consumed by one claim', () => {
    const pairing = createPairingManager({ clock: createManualClock(1_000) });
    const { code, expiresAt } = pairing.start();

    expect(code).toMatch(new RegExp(`^[A-HJ-NP-Z2-9]{${PAIRING_CODE_LENGTH}}$`));
    expect(expiresAt).toBe(1_000 + PAIRING_TTL_MS);
    expect(pairing.claim(`${code.slice(0, 4).toLowerCase()} ${code.slice(4)}`)).toEqual({
      success: true,
      data: undefined,
    });
    expect(pairing.claim(code)).toEqual({ success: false, error: 'no-pending-code' });
  });

  it('refuses a code after its ten minutes', async () => {
    const clock = createManualClock(0);
    const pairing = createPairingManager({ clock });
    const { code } = pairing.start();

    await clock.advanceBy(PAIRING_TTL_MS);

    expect(pairing.claim(code)).toEqual({ success: false, error: 'expired' });
    expect(pairing.pending()).toBeNull();
  });

  it('burns the code after five wrong guesses', () => {
    const clock = createManualClock(0);
    const pairing = createPairingManager({ clock });
    const { code } = pairing.start();

    for (let attempt = 0; attempt < PAIRING_MAX_ATTEMPTS; attempt += 1) {
      expect(pairing.claim('WRONGCOD')).toEqual({ success: false, error: 'invalid' });
    }

    expect(pairing.claim(code)).toEqual({ success: false, error: 'no-pending-code' });
  });

  it('rate-limits claims per minute across codes', async () => {
    const clock = createManualClock(0);
    const pairing = createPairingManager({ clock });
    for (let attempt = 0; attempt < PAIRING_MAX_CLAIMS_PER_MINUTE; attempt += 1) {
      pairing.start();
      pairing.claim('WRONGCOD');
    }
    const { code } = pairing.start();

    expect(pairing.claim(code)).toEqual({ success: false, error: 'rate-limited' });
    await clock.advanceBy(60_000);
    expect(pairing.claim(code).success).toBe(true);
  });
});
