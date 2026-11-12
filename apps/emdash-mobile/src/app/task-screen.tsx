import { pickTaskGridConversation } from '@core/features/workbench/browser/task-grid/task-grid-layout';
import { conversationIndicatorStatus } from '@core/primitives/agents/api/agent-status-rollup';
import { useEffect, useMemo, useState } from 'react';
import { buildTaskBoard } from '../model/task-board';
import { getLink } from '../wire/connection';
import { useConversationIndex } from '../wire/conversation-index';
import { useProjects, useTaskList } from '../wire/live';
import { AcpView } from './acp-view';
import { EmptyState, LinkBanner, MachineChip, ScreenHeader, StatusPill } from './components';
import { routeHref } from './router';
import { TerminalView } from './terminal-view';
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
  const [selectedId, setSelectedId] = useState<string>();
  /** Bumped to remount the terminal, which re-hydrates (resumes) the agent. */
  const [generation, setGeneration] = useState(0);

  // Default to the conversation that needs attention most: the agent grid's rule.
  const defaultId = useMemo(
    () =>
      pickTaskGridConversation(
        taskConversations.map((conversation) => ({
          id: conversation.id,
          status: conversation.agentStatus ?? 'idle',
          seen: conversation.agentStatusSeen ?? true,
          lastInteractedAt: conversation.lastInteractedAt,
          isInitialConversation: conversation.isInitialConversation === true,
        }))
      ),
    [taskConversations]
  );
  const activeId =
    selectedId && taskConversations.some((entry) => entry.id === selectedId)
      ? selectedId
      : defaultId;
  const active = taskConversations.find((entry) => entry.id === activeId);

  useEffect(() => {
    if (activeId) conversations.markSeen(activeId);
  }, [activeId, conversations]);

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

  const stop = async () => {
    if (!active) return;
    await getLink()
      .client.conversations.tui.stop({ conversationId: active.id })
      .catch(() => undefined);
  };

  return (
    <main className="screen task-screen">
      <ScreenHeader
        back={
          <a className="back-link" href={routeHref({ name: 'home' })} aria-label="Back to tasks">
            ‹
          </a>
        }
        eyebrow={project?.name ?? 'Task'}
        title={task?.name ?? (tasks.isLoading ? 'Loading…' : 'Task not found')}
        action={
          task?.workspaceId ? (
            <a
              className="button-glass small"
              href={routeHref({ name: 'review', projectId, taskId })}
            >
              Changes
            </a>
          ) : undefined
        }
      />
      <LinkBanner link={link} />
      {row && (
        <div className="task-meta">
          <StatusPill status={row.status} />
          <MachineChip machine={row.machine} />
        </div>
      )}

      {taskConversations.length > 1 && (
        <div className="conversation-tabs" role="tablist" aria-label="Conversations">
          {taskConversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              role="tab"
              aria-selected={conversation.id === activeId}
              className={`conversation-tab${conversation.id === activeId ? ' is-active' : ''}`}
              onClick={() => setSelectedId(conversation.id)}
            >
              {conversation.title}
              <StatusPill
                status={conversationIndicatorStatus({
                  status: conversation.agentStatus ?? 'idle',
                  seen: conversation.agentStatusSeen ?? true,
                })}
              />
            </button>
          ))}
        </div>
      )}

      {!task ? (
        <EmptyState title="Loading…" />
      ) : !active ? (
        <EmptyState title={conversations.forTask(taskId).length ? 'Loading…' : 'No conversation'} />
      ) : active.type === 'acp' ? (
        <AcpView
          key={active.id}
          conversationId={active.id}
          taskId={taskId}
          workspaceId={task?.workspaceId}
        />
      ) : (
        <>
          <div className="session-actions">
            <button type="button" className="button-glass small" onClick={() => void stop()}>
              Stop agent
            </button>
            <button
              type="button"
              className="button-glass small"
              onClick={() => setGeneration((value) => value + 1)}
            >
              Resume
            </button>
          </div>
          <TerminalView
            key={`${active.id}:${generation}`}
            location={{
              projectId,
              taskId,
              conversationId: active.id,
              workspaceId: task?.workspaceId,
            }}
          />
        </>
      )}
    </main>
  );
}
