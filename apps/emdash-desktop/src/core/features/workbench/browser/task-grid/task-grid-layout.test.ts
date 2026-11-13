import { describe, expect, it } from 'vitest';
import {
  buildTaskGridEntries,
  computeTaskGridDimensions,
  pickTaskGridConversation,
  type TaskGridConversationCandidate,
} from './task-grid-layout';

describe('computeTaskGridDimensions', () => {
  it('returns a single cell when there are no tiles', () => {
    expect(computeTaskGridDimensions(0)).toEqual({ columns: 1, rows: 1 });
  });

  it('produces the familiar layouts on a 16:10 container', () => {
    expect(computeTaskGridDimensions(1)).toEqual({ columns: 1, rows: 1 });
    expect(computeTaskGridDimensions(2)).toEqual({ columns: 2, rows: 1 });
    expect(computeTaskGridDimensions(4)).toEqual({ columns: 2, rows: 2 });
    expect(computeTaskGridDimensions(6)).toEqual({ columns: 3, rows: 2 });
    expect(computeTaskGridDimensions(10)).toEqual({ columns: 4, rows: 3 });
    expect(computeTaskGridDimensions(12)).toEqual({ columns: 4, rows: 3 });
    expect(computeTaskGridDimensions(16)).toEqual({ columns: 4, rows: 4 });
  });

  it('adds columns on a wide container and rows on a tall one', () => {
    expect(computeTaskGridDimensions(6, 3.2)).toEqual({ columns: 4, rows: 2 });
    expect(computeTaskGridDimensions(6, 0.8)).toEqual({ columns: 2, rows: 3 });
  });

  it('falls back to the tile aspect for an unmeasured container', () => {
    expect(computeTaskGridDimensions(4, 0)).toEqual({ columns: 2, rows: 2 });
    expect(computeTaskGridDimensions(4, Number.NaN)).toEqual({ columns: 2, rows: 2 });
  });
});

function candidate(
  overrides: Partial<TaskGridConversationCandidate> & { id: string }
): TaskGridConversationCandidate {
  return {
    status: 'idle',
    seen: true,
    lastInteractedAt: null,
    isInitialConversation: false,
    ...overrides,
  };
}

describe('pickTaskGridConversation', () => {
  it('returns undefined when the task has no conversation', () => {
    expect(pickTaskGridConversation([])).toBeUndefined();
  });

  it('prefers an unseen prompt for input over a working agent', () => {
    expect(
      pickTaskGridConversation([
        candidate({ id: 'working', status: 'working' }),
        candidate({ id: 'waiting', status: 'awaiting-input', seen: false }),
      ])
    ).toBe('waiting');
  });

  it('prefers a working agent over an idle one used more recently', () => {
    expect(
      pickTaskGridConversation([
        candidate({ id: 'idle', lastInteractedAt: '2026-11-05T10:00:00Z' }),
        candidate({ id: 'working', status: 'working' }),
      ])
    ).toBe('working');
  });

  it('falls back to the most recent interaction, then the initial conversation', () => {
    expect(
      pickTaskGridConversation([
        candidate({ id: 'old', lastInteractedAt: '2026-11-01T10:00:00Z' }),
        candidate({ id: 'new', lastInteractedAt: '2026-11-05T10:00:00Z' }),
      ])
    ).toBe('new');
    expect(
      pickTaskGridConversation([
        candidate({ id: 'other' }),
        candidate({ id: 'initial', isInitialConversation: true }),
      ])
    ).toBe('initial');
  });
});

describe('buildTaskGridEntries', () => {
  it('puts pinned tasks first and drops duplicates', () => {
    const { entries, overflow } = buildTaskGridEntries(
      [{ projectId: 'b', taskId: 'b2' }],
      [
        { projectId: 'a', taskId: 'a1' },
        { projectId: 'b', taskId: 'b2' },
        { projectId: 'b', taskId: 'b1' },
      ]
    );
    expect(entries.map((entry) => entry.taskId)).toEqual(['b2', 'a1', 'b1']);
    expect(overflow).toBe(0);
  });

  it('caps the grid and reports how many tasks were left out', () => {
    const byProject = Array.from({ length: 5 }, (_, index) => ({
      projectId: 'p',
      taskId: `t${index}`,
    }));
    const { entries, overflow } = buildTaskGridEntries([], byProject, 3);
    expect(entries).toHaveLength(3);
    expect(overflow).toBe(2);
  });
});
