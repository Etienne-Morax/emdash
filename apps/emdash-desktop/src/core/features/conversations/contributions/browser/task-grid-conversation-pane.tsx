import { EmptyState } from '@emdash/ui/react/components';
import { Spinner } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo } from 'react';
import type { ConversationStore } from '@core/features/conversations/api/browser/conversation-manager';
import { getConversationsForTask } from '@core/features/conversations/api/browser/conversation-selectors';
import { getConversationSessionManager } from '@core/features/conversations/browser/stores/conversation-session-manager';
import { createConversationTerminalAttachments } from '@core/features/conversations/browser/terminal-attachments';
import { PtyPane } from '@core/features/terminals/contributions/browser/pty/pty-pane';
import { projectAvailabilityUi } from '@core/manifests/browser/project-availability-ui';

/**
 * Live terminal of one PTY conversation, mounted outside its task view (the cross-task
 * agent grid). Holds a hydration reference while mounted, exactly like an open
 * conversation tab; the task view's own tabs keep theirs independently.
 */
export const TaskGridConversationPane = observer(function TaskGridConversationPane({
  projectId,
  taskId,
  workspaceId,
  conversation,
}: {
  projectId: string;
  taskId: string;
  workspaceId: string;
  conversation: ConversationStore;
}) {
  const conversationId = conversation.data.id;

  useEffect(() => {
    const sessions = getConversationSessionManager(taskId);
    sessions.acquire(conversationId);
    return () => sessions.release(conversationId);
  }, [taskId, conversationId]);

  const attachments = useMemo(
    () => createConversationTerminalAttachments(conversationId),
    [conversationId]
  );
  const session = getConversationsForTask(taskId)?.sessions.get(conversationId);
  const disabledReason = projectAvailabilityUi.getLiveActionDisabledReason(projectId);

  if (session?.status !== 'ready' || !session.pty) {
    if (disabledReason) {
      return <EmptyState label="Conversation unavailable" description={disabledReason} />;
    }
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <PtyPane
      sessionId={session.sessionId}
      pty={session.pty}
      className="h-full w-full"
      onInterruptPress={() => conversation.clearWorking()}
      inputContext="agent"
      mapShiftEnterToCtrlJ
      readOnly={Boolean(disabledReason)}
      attachments={attachments}
      workspaceId={workspaceId}
    />
  );
});
