import type { MobileAppearance, MobileMachine } from '@core/features/mobile-remote/api/schemas';
import type { AgentStatus } from '@core/primitives/agents/api/agent-events';
import {
  rollupTaskStatus,
  taskAttentionRank,
} from '@core/primitives/agents/api/agent-status-rollup';
import {
  COLOR_CODE_VALUES,
  isColorCodeKey,
  resolveMachineColor,
  resolveProjectColor,
  type ColorCodeKey,
} from '@core/primitives/color-coding/api/color-coding';
import type { Conversation } from '@core/primitives/conversations/api';
import type { Project } from '@core/primitives/projects/api/projects';
import type { TaskListRow } from '@core/primitives/tasks/api/tasks';

export type MachineChip = {
  id: string;
  name: string;
  kind: 'local' | 'remote';
  /** CSS colour for the chip (dark-surface value). */
  color: string;
};

export type TaskBoardRow = {
  key: string;
  projectId: string;
  projectName: string;
  projectColor: string;
  taskId: string;
  taskName: string;
  status: AgentStatus | null;
  machine: MachineChip;
  /** Latest activity, epoch ms; 0 when unknown. */
  activityAt: number;
};

export type TaskBoardInput = {
  projects: readonly Project[];
  tasksByProject: ReadonlyMap<string, readonly TaskListRow[]>;
  conversationsForTask: (taskId: string) => readonly Conversation[];
  machines: readonly MobileMachine[];
  appearance: MobileAppearance | null;
};

const LOCAL_MACHINE_COLOR: ColorCodeKey = 'slate';

function colorValue(key: ColorCodeKey): string {
  return COLOR_CODE_VALUES[key].dark;
}

/** Chip for one machine the desktop manages (this computer or an SSH machine). */
export function machineChip(
  machine: MobileMachine,
  appearance: MobileAppearance | null
): MachineChip {
  if (machine.kind === 'local') {
    return {
      id: 'local',
      name: appearance?.localMachineName ?? machine.name,
      kind: 'local',
      color: colorValue(LOCAL_MACHINE_COLOR),
    };
  }
  const color = resolveMachineColor({
    connectionId: machine.id,
    override: appearance?.machineColors[machine.id],
  });
  return { id: machine.id, name: machine.name, kind: 'remote', color: colorValue(color) };
}

export function machineChipFor(
  project: Project,
  machines: readonly MobileMachine[],
  appearance: MobileAppearance | null
): MachineChip {
  if (project.type === 'local') {
    return machineChip({ id: 'local', kind: 'local', name: 'This Mac' }, appearance);
  }
  const machine = machines.find((entry) => entry.id === project.connectionId);
  return machineChip(
    { id: project.connectionId, kind: 'remote', name: machine?.name ?? 'SSH machine' },
    appearance
  );
}

export function projectColorFor(project: Project, appearance: MobileAppearance | null): string {
  const override = appearance?.projectColors[project.id];
  return colorValue(
    resolveProjectColor({
      projectId: project.id,
      path: project.path,
      override: isColorCodeKey(override) ? override : undefined,
    })
  );
}

function parseTime(value: string | null | undefined): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Every live task of every project and machine, one row each: questions waiting for a human
 * first (the agent grid's attention order), then most recent activity.
 */
export function buildTaskBoard(input: TaskBoardInput): TaskBoardRow[] {
  const rows: TaskBoardRow[] = [];
  for (const project of input.projects) {
    const tasks = input.tasksByProject.get(project.id) ?? [];
    const machine = machineChipFor(project, input.machines, input.appearance);
    const projectColor = projectColorFor(project, input.appearance);
    for (const task of tasks) {
      if (task.archivedAt || task.type === 'automation-run') continue;
      const conversations = input.conversationsForTask(task.id);
      const status = rollupTaskStatus(
        conversations.map((conversation) => ({
          status: conversation.agentStatus ?? 'idle',
          seen: conversation.agentStatusSeen ?? true,
        }))
      );
      const activityAt = Math.max(
        parseTime(task.lastInteractedAt),
        parseTime(task.updatedAt),
        ...conversations.map((conversation) => parseTime(conversation.lastInteractedAt))
      );
      rows.push({
        key: `${project.id}:${task.id}`,
        projectId: project.id,
        projectName: project.name,
        projectColor,
        taskId: task.id,
        taskName: task.name,
        status,
        machine,
        activityAt,
      });
    }
  }
  return rows.sort(
    (a, b) =>
      taskAttentionRank(a.status) - taskAttentionRank(b.status) || b.activityAt - a.activityAt
  );
}

export const STATUS_LABEL: Record<AgentStatus | 'none', string> = {
  'awaiting-input': 'Waiting for you',
  working: 'Working',
  error: 'Error',
  completed: 'Done',
  idle: 'Idle',
  none: 'Idle',
};
