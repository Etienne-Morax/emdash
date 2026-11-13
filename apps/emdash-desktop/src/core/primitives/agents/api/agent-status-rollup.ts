import type { AgentStatus } from './agent-events';

/** The status facts one conversation contributes to its task. */
export type ConversationStatusFacts = {
  status: AgentStatus;
  /** False once the agent asked, failed or finished and nobody has looked yet. */
  seen: boolean;
};

/**
 * The indicator a conversation shows: always while working, otherwise only until seen.
 * Shared by the desktop conversation store and the phone app.
 */
export function conversationIndicatorStatus(facts: ConversationStatusFacts): AgentStatus | null {
  if (facts.status === 'working') return 'working';
  if (facts.seen) return null;
  if (facts.status === 'awaiting-input') return 'awaiting-input';
  if (facts.status === 'error') return 'error';
  if (facts.status === 'completed') return 'completed';
  return null;
}

/**
 * A task's status from its conversations: an unseen question wins, then any working agent,
 * then an unseen error, then an unseen completion.
 */
export function rollupTaskStatus(
  conversations: Iterable<ConversationStatusFacts>
): AgentStatus | null {
  let hasWorking = false;
  let hasUnseenError = false;
  let hasUnseenCompleted = false;
  for (const conversation of conversations) {
    if (!conversation.seen && conversation.status === 'awaiting-input') return 'awaiting-input';
    if (conversation.status === 'working') hasWorking = true;
    if (!conversation.seen && conversation.status === 'error') hasUnseenError = true;
    if (!conversation.seen && conversation.status === 'completed') hasUnseenCompleted = true;
  }
  if (hasWorking) return 'working';
  if (hasUnseenError) return 'error';
  if (hasUnseenCompleted) return 'completed';
  return null;
}

/** Sort key putting tasks that need a human first: lower ranks come first. */
export function taskAttentionRank(status: AgentStatus | null): number {
  switch (status) {
    case 'awaiting-input':
      return 0;
    case 'error':
      return 1;
    case 'working':
      return 2;
    case 'completed':
      return 3;
    default:
      return 4;
  }
}
