import { EmptyState } from '@emdash/ui/react/components';
import { Button, Dialog, RelativeTime, Spinner } from '@emdash/ui/react/primitives';
import { useQuery } from '@tanstack/react-query';
import { GitBranch, History } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { getConversationsClient } from '@core/features/conversations/api/browser/client';
import { getConversationsForTask } from '@core/features/conversations/api/browser/conversation-selectors';
import { getTaskManagerStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { getTaskComposition } from '@core/features/workbench/api/browser/task-composition-selectors';
import { useModalController } from '@core/manifests/browser/modal-api';
import { PRODUCT_NAME } from '@core/primitives/app-identity/api/app-identity';
import type { ResumableClaudeSession } from '@core/primitives/claude-sessions/api/claude-sessions';
import { defineModal } from '@core/primitives/modals/react';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';

const BYTES_PER_KB = 1024;
const TASK_NAME_MAX_CHARS = 60;

function formatSize(bytes: number): string {
  const kb = bytes / BYTES_PER_KB;
  return kb < BYTES_PER_KB
    ? `${Math.max(1, Math.round(kb))} KB`
    : `${(kb / BYTES_PER_KB).toFixed(1)} MB`;
}

function unavailableReason(session: ResumableClaudeSession): string | null {
  if (session.isActive) return 'Open in another app right now — close it there first.';
  if (!session.workspaceId) {
    return 'Its worktree no longer exists here, so Claude cannot find the session.';
  }
  return null;
}

/** Creates a task on the session's directory and resumes the session in it. */
async function resumeInNewTask(projectId: string, session: ResumableClaudeSession) {
  const taskManager = getTaskManagerStore(projectId);
  if (!taskManager || !session.workspaceId) throw new Error('This project is not available.');
  const taskId = crypto.randomUUID();
  const name =
    session.title.length > TASK_NAME_MAX_CHARS
      ? `${session.title.slice(0, TASK_NAME_MAX_CHARS - 1)}…`
      : session.title;
  await taskManager.createTask({
    id: taskId,
    projectId,
    taskConfig: { version: '1', name },
    workspaceConfig: {
      version: '2',
      git: { kind: 'none' },
      workspace: { kind: 'repository-instance', workspaceId: session.workspaceId },
    },
  });
  const conversations = getConversationsForTask(taskId);
  if (!conversations) throw new Error('The task was created but its workspace is not ready.');
  const conversationId = crypto.randomUUID();
  await conversations.createConversation({
    id: conversationId,
    projectId,
    taskId,
    provider: 'claude',
    title: 'Claude (resumed)',
    type: 'pty',
    // Imported sessions never skip permission prompts by default.
    autoApprove: false,
    isInitialConversation: true,
    resumeProviderSessionId: session.sessionId,
  });
  return { taskId, conversationId };
}

const TAB_OPEN_ATTEMPTS = 20;
const TAB_OPEN_INTERVAL_MS = 100;

/** Opens the resumed conversation once the task view has mounted its composition. */
async function openConversationTab(projectId: string, taskId: string, conversationId: string) {
  for (let attempt = 0; attempt < TAB_OPEN_ATTEMPTS; attempt++) {
    const composition = getTaskComposition(projectId, taskId);
    if (composition) {
      composition.paneLayout.open('conversation', { conversationId }, { preview: false });
      composition.setFocusedRegion('main');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, TAB_OPEN_INTERVAL_MS));
  }
}

export const ResumeClaudeSessionModal = observer(function ResumeClaudeSessionModal({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const { complete, dismiss } = useModalController('resumeClaudeSessionModal');
  const { navigate } = useNavigate();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['conversations', 'claude-sessions', projectId],
    queryFn: async () => (await getConversationsClient()).listClaudeSessions({ projectId }),
  });

  const resume = async (session: ResumableClaudeSession) => {
    setPendingId(session.sessionId);
    setError(null);
    try {
      const { taskId, conversationId } = await resumeInNewTask(projectId, session);
      complete();
      navigate(taskViewDef({ projectId, taskId }));
      await openConversationTab(projectId, taskId, conversationId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resume the session.');
      setPendingId(null);
    }
  };

  const sessions = data?.kind === 'ok' ? data.sessions : [];
  return (
    <>
      <Dialog.Header>
        <Dialog.Title>Resume a Claude session</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body className="flex flex-col gap-3 pt-0">
        <p className="text-sm text-foreground-muted">
          Claude Code sessions for {projectName} started outside {PRODUCT_NAME} (Claude Desktop, a
          terminal). Resuming opens a task in the session&apos;s folder and runs{' '}
          <code>claude --resume</code> there.
        </p>
        <ul className="list-disc pl-5 text-xs text-foreground-passive">
          <li>
            Tools that only exist in Claude Desktop (browser, computer use, session tools) are not
            available in the CLI.
          </li>
          <li>
            A session resumes only on the machine that holds its transcript; it is not copied
            between machines.
          </li>
          <li>Permission prompts stay on: imported sessions never auto-approve.</li>
        </ul>
        <div className="max-h-[50vh] min-h-24 overflow-y-auto rounded-md border border-border">
          {isLoading ? (
            <div className="flex justify-center p-6">
              <Spinner />
            </div>
          ) : data?.kind === 'unavailable' ? (
            <EmptyState bare label="Sessions unavailable" description={data.message} />
          ) : sessions.length === 0 ? (
            <EmptyState
              bare
              label="No Claude sessions found"
              description="Nothing was recorded for this repository or its .claude/worktrees."
            />
          ) : (
            <ul className="divide-y divide-border">
              {sessions.map((session) => {
                const reason = unavailableReason(session);
                const isPending = pendingId === session.sessionId;
                return (
                  <li key={session.sessionId}>
                    <button
                      type="button"
                      disabled={Boolean(reason) || pendingId !== null}
                      onClick={() => void resume(session)}
                      className={cn(
                        'flex w-full flex-col gap-1 px-3 py-2 text-left',
                        reason ? 'cursor-not-allowed opacity-60' : 'hover:bg-background-1'
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <History className="size-3.5 shrink-0 text-foreground-passive" />
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                          {session.title}
                        </span>
                        {isPending ? (
                          <Spinner />
                        ) : (
                          <RelativeTime
                            value={new Date(session.lastActivityMs).toISOString()}
                            className="shrink-0 text-xs text-foreground-passive"
                            compact
                          />
                        )}
                      </span>
                      <span className="flex items-center gap-3 pl-5 text-xs text-foreground-passive">
                        {session.gitBranch && (
                          <span className="flex min-w-0 items-center gap-1">
                            <GitBranch className="size-3 shrink-0" />
                            <span className="truncate">{session.gitBranch}</span>
                          </span>
                        )}
                        {session.worktreeName && <span>worktree {session.worktreeName}</span>}
                        <span>{formatSize(session.size)}</span>
                      </span>
                      {reason && (
                        <span className="pl-5 text-xs text-foreground-warning">{reason}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {error && <p className="text-xs text-foreground-destructive">{error}</p>}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onClick={dismiss}>
          Close
        </Button>
      </Dialog.Footer>
    </>
  );
});

export const resumeClaudeSessionModal = defineModal<void>()({
  id: 'resumeClaudeSessionModal',
  component: ResumeClaudeSessionModal,
  size: 'md',
});
