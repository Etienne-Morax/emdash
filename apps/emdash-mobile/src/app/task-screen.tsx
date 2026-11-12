import { conversationIndicatorStatus } from '@core/primitives/agents/api/agent-status-rollup';
import { useMemo } from 'react';
import { buildTaskBoard } from '../model/task-board';
import { useConversationIndex } from '../wire/conversation-index';
import { useProjects, useTaskList } from '../wire/live';
import { EmptyState, LinkBanner, MachineChip, ScreenHeader, StatusPill } from './components';
import { routeHref } from './router';
import { useDesktopInfo } from './use-board';
import { useLinkState } from './use-link-state';

export function TaskScreen({ projectId, taskId }: { projectId: string; taskId: string }) {
  const link = useLinkState();
  const info = useDesktopInfo();
  const projects = useProjects();
  const tasks = useTaskList(projectId);
  const conversations = useConversationIndex([projectId]);
  const project = projects.value?.projects.find((entry) => entry.id === projectId);
  const task = tasks.value?.tasks.find((entry) => entry.id === taskId);
  const taskConversations = conversations.forTask(taskId);

  const row = useMemo(() => {
    if (!project || !task) return undefined;
    return buildTaskBoard({
      projects: [project],
      tasksByProject: new Map([[projectId, [task]]]),
      conversationsForTask: () => taskConversations,
      machines: info.machines,
      appearance: info.appearance,
    })[0];
  }, [project, task, projectId, taskConversations, info]);

  return (
    <main className="screen">
      <ScreenHeader
        back={
          <a className="back-link" href={routeHref({ name: 'home' })} aria-label="Back to tasks">
            ‹
          </a>
        }
        eyebrow={project?.name ?? 'Task'}
        title={task?.name ?? (tasks.isLoading ? 'Loading…' : 'Task not found')}
      />
      <LinkBanner link={link} />
      {row && (
        <div className="task-meta">
          <StatusPill status={row.status} />
          <MachineChip machine={row.machine} />
        </div>
      )}
      <section aria-label="Conversations" className="conversation-list">
        {taskConversations.length === 0 ? (
          <EmptyState title="No conversation" />
        ) : (
          taskConversations.map((conversation) => (
            <div key={conversation.id} className="conversation-row morax-glass">
              <span className="morax-headline">{conversation.title}</span>
              <span className="morax-caption">
                {conversation.providerId} · {conversation.type === 'acp' ? 'chat' : 'terminal'}
              </span>
              <StatusPill
                status={conversationIndicatorStatus({
                  status: conversation.agentStatus ?? 'idle',
                  seen: conversation.agentStatusSeen ?? true,
                })}
              />
            </div>
          ))
        )}
      </section>
    </main>
  );
}
