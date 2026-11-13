import { describe, expect, it } from 'vitest';
import {
  conversationIndicatorStatus,
  rollupTaskStatus,
  taskAttentionRank,
} from './agent-status-rollup';

describe('agent status rollup', () => {
  it('shows working always and other states only until seen', () => {
    expect(conversationIndicatorStatus({ status: 'working', seen: true })).toBe('working');
    expect(conversationIndicatorStatus({ status: 'awaiting-input', seen: false })).toBe(
      'awaiting-input'
    );
    expect(conversationIndicatorStatus({ status: 'awaiting-input', seen: true })).toBeNull();
    expect(conversationIndicatorStatus({ status: 'idle', seen: false })).toBeNull();
  });

  it('lets an unseen question win over working agents in the same task', () => {
    expect(
      rollupTaskStatus([
        { status: 'working', seen: true },
        { status: 'awaiting-input', seen: false },
      ])
    ).toBe('awaiting-input');
    expect(
      rollupTaskStatus([
        { status: 'completed', seen: false },
        { status: 'error', seen: false },
      ])
    ).toBe('error');
    expect(rollupTaskStatus([])).toBeNull();
  });

  it('ranks tasks needing a human first', () => {
    const ranked = (['completed', null, 'working', 'awaiting-input', 'error'] as const)
      .slice()
      .sort((a, b) => taskAttentionRank(a) - taskAttentionRank(b));
    expect(ranked).toEqual(['awaiting-input', 'error', 'working', 'completed', null]);
  });
});
