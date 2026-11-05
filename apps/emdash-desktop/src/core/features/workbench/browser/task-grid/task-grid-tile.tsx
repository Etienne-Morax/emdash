import { AgentStatus, EmptyState } from '@emdash/ui/react/components';
import { Button, Select, Tooltip } from '@emdash/ui/react/primitives';
import { ArrowUpRight, Maximize2, Minimize2, Server } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import type { ConversationStore } from '@core/features/conversations/api/browser/conversation-manager';
import { getConversationsForTask } from '@core/features/conversations/api/browser/conversation-selectors';
import { TaskGridConversationPane } from '@core/features/conversations/contributions/browser/task-grid-conversation-pane';
import {
  getProjectSshConnectionId,
  getProjectStore,
  projectDisplayName,
} from '@core/features/projects/api/browser/stores/project-selectors';
import {
  asProvisioned,
  getTaskStore,
  taskDisplayName,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { pickTaskGridConversation } from './task-grid-layout';

type TaskGridTileProps = {
  projectId: string;
  taskId: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
};

function sortedConversations(conversations: Iterable<ConversationStore>): ConversationStore[] {
  return [...conversations].sort((a, b) => (a.data.title ?? '').localeCompare(b.data.title ?? ''));
}

/**
 * One cell of the cross-task grid: a header with the task's identity and agent status,
 * and the live terminal of one of its conversations.
 */
export const TaskGridTile = observer(function TaskGridTile({
  projectId,
  taskId,
  isExpanded,
  onToggleExpand,
}: TaskGridTileProps) {
  const { navigate } = useNavigate();
  const task = getTaskStore(projectId, taskId);
  const provisioned = asProvisioned(task);
  const manager = getConversationsForTask(taskId);
  const conversations = manager ? sortedConversations(manager.conversations.values()) : [];

  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const preferredId = pickTaskGridConversation(
    conversations.map((conversation) => ({
      id: conversation.data.id,
      status: conversation.status,
      seen: conversation.seen,
      lastInteractedAt: conversation.data.lastInteractedAt,
      isInitialConversation: conversation.isInitialConversation,
    }))
  );
  const conversationId =
    selectedId && manager?.conversations.has(selectedId) ? selectedId : preferredId;
  const conversation = conversationId ? manager?.conversations.get(conversationId) : undefined;

  const projectName = projectDisplayName(getProjectStore(projectId)) ?? 'Project';
  const isRemote = getProjectSshConnectionId(projectId) !== undefined;
  const status = conversation?.indicatorStatus ?? manager?.taskStatus ?? null;

  return (
    <section
      aria-label={`${projectName} / ${taskDisplayName(task) ?? 'Task'}`}
      data-task-grid-tile={`${projectId}:${taskId}`}
      data-attention={status ?? undefined}
      className="morax-grid__tile flex min-h-0 min-w-0 flex-col overflow-hidden"
      onMouseDown={() => {
        if (conversation && !conversation.seen) conversation.markSeen();
      }}
    >
      <header className="morax-grid__header flex h-9 shrink-0 items-center">
        <span className="flex size-5 shrink-0 items-center justify-center">
          <AgentStatus status={status} size={16} tooltip />
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="morax-grid__project max-w-[40%] truncate">{projectName}</span>
          <span className="morax-grid__project">/</span>
          <span className="morax-grid__task truncate">{taskDisplayName(task) ?? 'Task'}</span>
        </span>
        {isRemote && (
          <Tooltip.Root>
            <Tooltip.Trigger className="morax-grid__project flex shrink-0 items-center">
              <Server className="size-3.5" aria-label="Remote host" />
            </Tooltip.Trigger>
            <Tooltip.Content>Runs on a remote host</Tooltip.Content>
          </Tooltip.Root>
        )}
        {conversations.length > 1 && conversationId && (
          <Select.Root
            value={conversationId}
            onValueChange={(next) => setSelectedId(next ?? undefined)}
          >
            <Select.Trigger size="xs" className="max-w-[10rem] shrink-0">
              <Select.Value>{conversation?.data.title ?? 'Conversation'}</Select.Value>
            </Select.Trigger>
            <Select.Content align="end" className="min-w-max">
              {conversations.map((item) => (
                <Select.Item key={item.data.id} value={item.data.id}>
                  {item.data.title}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        )}
        <Button
          variant="ghost"
          size="xs"
          icon
          aria-label={isExpanded ? 'Restore grid' : 'Expand tile'}
          onClick={onToggleExpand}
        >
          {isExpanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          icon
          aria-label="Open task"
          onClick={() => navigate(taskViewDef({ projectId, taskId }))}
        >
          <ArrowUpRight className="size-3.5" />
        </Button>
      </header>
      {/* Absolutely positioned so the terminal measures the tile, never its own content. */}
      <div className="morax-grid__body relative min-h-0 min-w-0 flex-1 bg-(--xterm-bg)">
        <div className="absolute inset-0 overflow-hidden">
          {!provisioned ? (
            <EmptyState bare
              label="Workspace not running"
              description="Open the task to start its workspace."
            />
          ) : !conversation ? (
            <EmptyState bare label="No conversation" description="This task has no agent yet." />
          ) : conversation.data.type === 'acp' ? (
            <EmptyState bare
              label={conversation.data.title}
              description="Chat conversations are shown in the task view."
            />
          ) : (
            <TaskGridConversationPane
              projectId={projectId}
              taskId={taskId}
              workspaceId={provisioned.workspaceId}
              conversation={conversation}
            />
          )}
        </div>
      </div>
    </section>
  );
});
