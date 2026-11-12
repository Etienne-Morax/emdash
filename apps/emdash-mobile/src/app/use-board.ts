import type { MobileAppearance, MobileMachine } from '@core/features/mobile-remote/api/schemas';
import type { Project } from '@core/primitives/projects/api/projects';
import type { TaskListRow } from '@core/primitives/tasks/api/tasks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildTaskBoard, type TaskBoardRow } from '../model/task-board';
import { getLink } from '../wire/connection';
import { useConversationIndex } from '../wire/conversation-index';
import { useProjects } from '../wire/live';
import { useLinkState } from './use-link-state';

export type DesktopInfo = {
  machines: MobileMachine[];
  appearance: MobileAppearance | null;
  desktopName: string;
};

/** Machines, colours and the desktop's name; refreshed on every reconnect. */
export function useDesktopInfo(): DesktopInfo {
  const link = useLinkState();
  const [info, setInfo] = useState<DesktopInfo>({
    machines: [],
    appearance: null,
    desktopName: '',
  });
  useEffect(() => {
    if (link !== 'online') return;
    let cancelled = false;
    const client = getLink().client;
    void Promise.all([
      client.mobile.machines(),
      client.mobile.appearance(),
      client.mobile.session(),
    ])
      .then(([machines, appearance, session]) => {
        if (!cancelled) setInfo({ machines, appearance, desktopName: session.desktopName });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [link]);
  return info;
}

/** Projects plus the task list of each, fed by one loader component per project. */
export function useTaskBoard(info: DesktopInfo) {
  const projects = useProjects();
  const projectList: Project[] = useMemo(() => projects.value?.projects ?? [], [projects.value]);
  const [tasksByProject, setTasksByProject] = useState<Map<string, TaskListRow[]>>(new Map());
  const reportTasks = useCallback((projectId: string, tasks: TaskListRow[]) => {
    setTasksByProject((current) => {
      if (current.get(projectId) === tasks) return current;
      const next = new Map(current);
      next.set(projectId, tasks);
      return next;
    });
  }, []);
  const projectIds = useMemo(() => projectList.map((project) => project.id), [projectList]);
  const conversations = useConversationIndex(projectIds);

  const rows: TaskBoardRow[] = buildTaskBoard({
    projects: projectList,
    tasksByProject,
    conversationsForTask: (taskId) => conversations.forTask(taskId),
    machines: info.machines,
    appearance: info.appearance,
  });

  return {
    projects: projectList,
    rows,
    isLoading: projects.isLoading,
    reportTasks,
  };
}
