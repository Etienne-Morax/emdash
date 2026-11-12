import type { TaskListRow } from '@core/primitives/tasks/api/tasks';
import { useEffect, useMemo } from 'react';
import { machineChip, type TaskBoardRow } from '../model/task-board';
import { useTaskList } from '../wire/live';
import {
  EmptyState,
  LinkBanner,
  MachineAvailability,
  MachineChip,
  ScreenHeader,
  StatusPill,
} from './components';
import { navigate, routeHref } from './router';
import { useDesktopInfo, useTaskBoard } from './use-board';
import { useLinkState } from './use-link-state';

/** Subscribes to one project's task list and reports it upward. Renders nothing. */
function ProjectTasksLoader(props: {
  projectId: string;
  onTasks: (projectId: string, tasks: TaskListRow[]) => void;
}) {
  const { value } = useTaskList(props.projectId);
  const { projectId, onTasks } = props;
  useEffect(() => {
    if (value) onTasks(projectId, value.tasks);
  }, [value, projectId, onTasks]);
  return null;
}

export function HomeScreen() {
  const link = useLinkState();
  const info = useDesktopInfo();
  const board = useTaskBoard(info);
  const waiting = board.rows.filter((row) => row.status === 'awaiting-input').length;

  const machines = useMemo(
    () => info.machines.map((machine) => machineChip(machine, info.appearance)),
    [info]
  );

  return (
    <main className="screen">
      {board.projects.map((project) => (
        <ProjectTasksLoader key={project.id} projectId={project.id} onTasks={board.reportTasks} />
      ))}
      <ScreenHeader
        eyebrow={info.desktopName ? `Emdash · ${info.desktopName}` : 'Emdash'}
        title={waiting > 0 ? `${waiting} waiting` : 'Agents'}
        action={
          <a className="button-glass small" href={routeHref({ name: 'new' })}>
            New task
          </a>
        }
      />
      <LinkBanner link={link} />

      {machines.length > 0 && (
        <section aria-label="Machines">
          <ul className="machine-strip">
            {machines.map((machine) => (
              <MachineAvailability key={machine.id} machine={machine} link={link} />
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Tasks" className="task-list">
        {board.rows.length === 0 ? (
          <EmptyState title={board.isLoading ? 'Loading tasks…' : 'No tasks yet'}>
            {board.isLoading ? null : 'Start one with New task.'}
          </EmptyState>
        ) : (
          board.rows.map((row) => <TaskCard key={row.key} row={row} />)
        )}
      </section>
    </main>
  );
}

function TaskCard({ row }: { row: TaskBoardRow }) {
  const urgent = row.status === 'awaiting-input';
  return (
    <button
      type="button"
      className={`task-card morax-glass${urgent ? ' morax-tint-accent' : ''}`}
      style={{ ['--project-color' as string]: row.projectColor }}
      onClick={() => navigate({ name: 'task', projectId: row.projectId, taskId: row.taskId })}
    >
      <span className="task-card-stripe" aria-hidden="true" />
      <span className="task-card-body">
        <span className="task-card-top">
          <span className="task-card-project">{row.projectName}</span>
          <StatusPill status={row.status} />
        </span>
        <span className="task-card-name morax-headline">{row.taskName}</span>
        <MachineChip machine={row.machine} />
      </span>
    </button>
  );
}
