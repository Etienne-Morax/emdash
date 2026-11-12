import type { Conversation } from '@core/primitives/conversations/api';
import type { Project } from '@core/primitives/projects/api/projects';
import type { TaskListRow } from '@core/primitives/tasks/api/tasks';
import { describe, expect, it } from 'vitest';
import { buildTaskBoard } from './task-board';

const localProject: Project = {
  type: 'local',
  id: 'p-local',
  name: 'emdash',
  path: '/Users/me/emdash',
  baseRef: 'main',
  repositoryWorkspaceId: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const sshProject: Project = {
  type: 'ssh',
  id: 'p-ssh',
  name: 'morax-os',
  path: '/home/me/morax-os',
  baseRef: 'main',
  connectionId: 'imac',
  repositoryWorkspaceId: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function task(id: string, projectId: string, extra: Partial<TaskListRow> = {}): TaskListRow {
  return {
    id,
    projectId,
    name: `Task ${id}`,
    status: 'in_progress',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    statusChangedAt: '2026-01-01T00:00:00Z',
    isPinned: false,
    conversations: {},
    type: 'task',
    ...extra,
  };
}

function conversation(
  taskId: string,
  status: Conversation['agentStatus'],
  seen: boolean
): Conversation {
  return {
    id: `c-${taskId}`,
    projectId: 'x',
    taskId,
    providerId: 'claude',
    title: 'Claude',
    lastInteractedAt: null,
    isInitialConversation: true,
    agentStatus: status,
    agentStatusSeen: seen,
  };
}

describe('buildTaskBoard', () => {
  it('puts tasks waiting for an answer first, across projects and machines', () => {
    const conversations: Record<string, Conversation[]> = {
      a: [conversation('a', 'working', true)],
      b: [conversation('b', 'awaiting-input', false)],
      c: [conversation('c', 'completed', false)],
    };
    const rows = buildTaskBoard({
      projects: [localProject, sshProject],
      tasksByProject: new Map([
        ['p-local', [task('a', 'p-local', { lastInteractedAt: '2026-03-01T00:00:00Z' })]],
        [
          'p-ssh',
          [task('b', 'p-ssh'), task('c', 'p-ssh'), task('d', 'p-ssh', { archivedAt: 'x' })],
        ],
      ]),
      conversationsForTask: (taskId) => conversations[taskId] ?? [],
      machines: [{ id: 'imac', kind: 'remote', name: 'iMac' }],
      appearance: { projectColors: {}, machineColors: {}, localMachineName: 'MacBook Pro' },
    });

    expect(rows.map((row) => [row.taskId, row.status])).toEqual([
      ['b', 'awaiting-input'],
      ['a', 'working'],
      ['c', 'completed'],
    ]);
    expect(rows[0]?.machine).toMatchObject({ name: 'iMac', kind: 'remote' });
    expect(rows[1]?.machine).toMatchObject({ name: 'MacBook Pro', kind: 'local' });
  });

  it('treats a question already seen as no longer urgent', () => {
    const rows = buildTaskBoard({
      projects: [localProject],
      tasksByProject: new Map([['p-local', [task('a', 'p-local')]]]),
      conversationsForTask: () => [conversation('a', 'awaiting-input', true)],
      machines: [],
      appearance: null,
    });

    expect(rows[0]?.status).toBeNull();
  });
});
