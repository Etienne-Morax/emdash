import { describe, expect, it } from 'vitest';
import { describeError } from './errors';

describe('describeError', () => {
  it('uses the message an error carries', () => {
    expect(describeError({ type: 'rejected', message: 'non-fast-forward' }, 'x')).toBe(
      'non-fast-forward'
    );
  });

  it('falls back when there is no usable message', () => {
    expect(describeError(undefined, 'Could not push.')).toBe('Could not push.');
    expect(describeError({ message: '' }, 'Could not push.')).toBe('Could not push.');
  });
});
