import { describe, expect, it } from 'vitest';
import type { AgentStatus } from '@core/primitives/agents/api/agent-events';
import {
  conversationIndicatorStatus,
  rollupTaskStatus,
  taskAttentionRank,
} from '@core/primitives/agents/api/agent-status-rollup';
import { pickTaskGridConversation } from './task-grid-layout';

/**
 * Fixture for the native iOS client (`apps/morax-code-ios`, fork-only): the agent-status rules
 * it ports to Swift, evaluated here by the desktop's own functions. Regenerate:
 * `pnpm exec vitest run --project node <this file> -u`.
 */

const FIXTURE = '../../../../../../../morax-code-ios/Fixtures/status-logic.json';

const STATUSES: AgentStatus[] = ['idle', 'working', 'awaiting-input', 'error', 'completed'];

/**
 * The agent-status rules the app ports to Swift (indicator, task rollup, attention order,
 * default conversation), evaluated by the desktop's own functions on every small case.
 */
function statusCases() {
  const facts = STATUSES.flatMap((status) => [true, false].map((seen) => ({ status, seen })));
  const pairs = facts.flatMap((a) => facts.map((b) => [a, b]));
  const times = [null, '2026-11-12T10:00:00.000Z', '2026-11-12T11:00:00.000Z'];
  const picks = pairs.flatMap(([a, b], index) => {
    const candidates = [
      { id: 'a', ...a!, lastInteractedAt: times[index % 3]!, isInitialConversation: true },
      {
        id: 'b',
        ...b!,
        lastInteractedAt: times[(index + 1) % 3]!,
        isInitialConversation: false,
      },
    ];
    return [{ candidates, picked: pickTaskGridConversation(candidates) ?? null }];
  });
  return {
    indicator: facts.map((fact) => ({ ...fact, result: conversationIndicatorStatus(fact) })),
    rollup: [[], ...facts.map((fact) => [fact]), ...pairs].map((conversations) => ({
      conversations,
      result: rollupTaskStatus(conversations),
    })),
    attentionRank: [...STATUSES, null].map((status) => ({
      status,
      rank: taskAttentionRank(status),
    })),
    picks,
  };
}

describe('status logic fixture for the native iOS client', () => {
  it('records the desktop status rules', async () => {
    await expect(`${JSON.stringify(statusCases(), null, 2)}\n`).toMatchFileSnapshot(FIXTURE);
  });
});
