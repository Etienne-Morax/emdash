import type { AcpPermissionRequest } from '@emdash/core/runtimes/acp/api/client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { chatLines, type ChatLine } from '../model/acp-transcript';
import { errorMessage } from '../model/errors';
import { getLink } from '../wire/connection';
import { useAcpSession } from '../wire/live';
import { provisionTask } from '../wire/provision';

const HISTORY_PAGE = 60;

/**
 * Chat conversation (ACP): recent transcript, pending permission requests with their options,
 * a prompt composer and Stop. A lighter view than the desktop chat, made for answering.
 */
export function AcpView(props: {
  conversationId: string;
  taskId: string;
  workspaceId: string | undefined;
}) {
  const { conversationId, taskId, workspaceId } = props;
  const session = useAcpSession(conversationId);
  const state = session.value;
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>();
  const client = getLink().client;

  const reload = useCallback(async () => {
    const page = await client.conversations.acp
      .loadHistory({ conversationId, limit: HISTORY_PAGE })
      .catch(() => null);
    if (page?.success && page.data.kind === 'available') setLines(chatLines(page.data.turns));
  }, [client, conversationId]);

  useEffect(() => {
    void (async () => {
      if (workspaceId) {
        const provisioned = await provisionTask(workspaceId, taskId);
        if (!provisioned.ok) {
          setError(provisioned.message);
          return;
        }
      }
      const result = await client.conversations.acp.attach({ conversationId });
      if (!result.success) setError(errorMessage(result.error, 'Could not open the conversation.'));
      void reload();
    })();
  }, [client, conversationId, reload, taskId, workspaceId]);

  // Refresh the transcript whenever a turn settles or the agent starts/stops working.
  const turnKey = `${state?.transcript?.lastCommittedTurnSeq ?? ''}:${state?.isGenerating ?? ''}`;
  useEffect(() => {
    void reload();
  }, [turnKey, reload]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    const result = await client.conversations.acp
      .sendPrompt({ conversationId, promptId: crypto.randomUUID(), prompt: { text } })
      .catch(() => null);
    if (!result?.success) setError('The message was not sent.');
  };

  const resolve = async (request: AcpPermissionRequest, optionId: string) => {
    const result = await client.conversations.acp
      .resolvePermission({ conversationId, requestId: request.requestId, optionId })
      .catch(() => null);
    if (!result?.success) setError('The answer was not delivered.');
  };

  const activeText =
    state?.transcript?.activeTurn?.items
      .filter((item) => 'kind' in item && item.kind === 'message' && item.role === 'assistant')
      .map((item) => ('text' in item ? item.text : ''))
      .join('') ?? '';

  return (
    <section className="acp-panel" aria-label="Agent chat">
      <ol className="chat-lines">
        {lines.map((line) =>
          line.kind === 'message' ? (
            <li key={line.key} className={`chat-message chat-${line.role}`}>
              {line.text}
            </li>
          ) : (
            <li key={line.key} className="chat-tool morax-caption">
              {line.title}
            </li>
          )
        )}
        {state?.isGenerating && activeText && (
          <li className="chat-message chat-assistant chat-live">{activeText}</li>
        )}
      </ol>

      {state?.pendingPermissions.map((request) => (
        <div key={request.requestId} className="permission-card morax-glass morax-tint-accent">
          <p className="morax-eyebrow">Permission</p>
          <p className="morax-headline">{request.toolCall.title}</p>
          <div className="permission-options">
            {request.options.map((option) => (
              <button
                key={option.optionId}
                type="button"
                className={option.kind.startsWith('allow') ? 'button-approve' : 'button-glass'}
                onClick={() => void resolve(request, option.optionId)}
              >
                {option.name}
              </button>
            ))}
          </div>
        </div>
      ))}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <form className="composer" onSubmit={(event) => void submit(event)}>
        <textarea
          className="composer-input"
          rows={1}
          value={draft}
          placeholder={state?.isGenerating ? 'Queue a message…' : 'Message the agent…'}
          enterKeyHint="send"
          onChange={(event) => setDraft(event.target.value)}
          aria-label="Message to the agent"
        />
        {state?.canCancel ? (
          <button
            type="button"
            className="button-glass"
            onClick={() => void client.conversations.acp.cancelTurn({ conversationId })}
          >
            Stop
          </button>
        ) : null}
        <button type="submit" className="button-accent" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
