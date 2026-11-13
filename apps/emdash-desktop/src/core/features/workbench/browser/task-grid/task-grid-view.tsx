import { EmptyState } from '@emdash/ui/react/components';
import { observer } from 'mobx-react-lite';
import { Fragment, useEffect, useRef, useState } from 'react';
import { getConversationsForTask } from '@core/features/conversations/api/browser/conversation-selectors';
import {
  asProvisioned,
  getTaskStore,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import { getSidebarStore } from '@core/features/workbench/contributions/browser/app-stores';
import { Titlebar } from '@core/features/workbench/contributions/browser/Titlebar';
import { taskGridViewDef } from '@core/features/workbench/contributions/views';
import { defineViewRuntime } from '@core/primitives/views/react';
import {
  buildTaskGridEntries,
  computeTaskGridDimensions,
  TASK_GRID_TILE_ASPECT,
  taskGridEntryKey,
  type TaskGridEntry,
} from './task-grid-layout';
import { TaskGridTile } from './task-grid-tile';
import './morax-grid.css';

/** A task earns a tile once its workspace is up and it has at least one conversation. */
function hasLiveConversations({ projectId, taskId }: TaskGridEntry): boolean {
  if (!asProvisioned(getTaskStore(projectId, taskId))) return false;
  return (getConversationsForTask(taskId)?.conversations.size ?? 0) > 0;
}

/** Call only inside `observer` components. */
function useTaskGridEntries(): { entries: TaskGridEntry[]; overflow: number } {
  const sidebar = getSidebarStore();
  const byProject = sidebar.orderedProjects.flatMap((project) =>
    sidebar
      .visibleTaskIdsForProject(project.id)
      .map((taskId) => ({ projectId: project.id, taskId }))
  );
  return buildTaskGridEntries(
    sidebar.pinnedSidebarEntries.filter(hasLiveConversations),
    byProject.filter(hasLiveConversations)
  );
}

function useContainerAspect(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [aspect, setAspect] = useState(TASK_GRID_TILE_ASPECT);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (width: number, height: number) => {
      if (width > 0 && height > 0) setAspect(width / height);
    };
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) measure(rect.width, rect.height);
    });
    observer.observe(element);
    const rect = element.getBoundingClientRect();
    measure(rect.width, rect.height);
    return () => observer.disconnect();
  }, []);
  return [ref, aspect];
}

export const TaskGridMainPanel = observer(function TaskGridMainPanel() {
  const { entries, overflow } = useTaskGridEntries();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [containerRef, containerAspect] = useContainerAspect();

  const expanded = entries.find((entry) => taskGridEntryKey(entry) === expandedKey);
  // Expanding unmounts the other tiles; their agents keep running on their Host and
  // the tiles reattach when the grid is restored.
  const visible = expanded ? [expanded] : entries;
  const { columns, rows } = computeTaskGridDimensions(visible.length, containerAspect);

  return (
    <div className="morax-grid morax-grid__surface flex h-full min-h-0 flex-col">
      <div ref={containerRef} className="min-h-0 flex-1 p-3">
        {visible.length === 0 ? (
          <EmptyState
            bare
            label="No running agents"
            description="Tasks with an agent conversation appear here, across all projects."
          />
        ) : (
          <div
            className="grid h-full w-full gap-3"
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            }}
          >
            {visible.map((entry) => {
              const key = taskGridEntryKey(entry);
              return (
                <TaskGridTile
                  key={key}
                  projectId={entry.projectId}
                  taskId={entry.taskId}
                  isExpanded={expanded !== undefined}
                  onToggleExpand={() => setExpandedKey((current) => (current === key ? null : key))}
                />
              );
            })}
          </div>
        )}
      </div>
      {overflow > 0 && !expanded && (
        <p className="morax-grid__note shrink-0 px-4 pb-3">
          {overflow} more {overflow === 1 ? 'task is' : 'tasks are'} hidden. Pin the tasks you want
          to keep in view.
        </p>
      )}
    </div>
  );
});

export const TaskGridTitlebar = observer(function TaskGridTitlebar() {
  const { entries } = useTaskGridEntries();
  return (
    <Titlebar
      leftSlot={
        <nav aria-label="Breadcrumb" className="morax-grid flex items-center gap-2 px-2">
          <span className="morax-grid__eyebrow px-1 py-0.5">Agent grid</span>
          <span className="morax-grid__count text-xs tabular-nums">{entries.length}</span>
        </nav>
      }
    />
  );
});

export const taskGridViewRuntime = defineViewRuntime(taskGridViewDef, {
  slots: {
    wrap: Fragment,
    titlebar: TaskGridTitlebar,
    main: TaskGridMainPanel,
  },
});
