import type { Conversation, ConversationEvent } from '@core/primitives/conversations/api';
import { useEffect, useSyncExternalStore } from 'react';
import { getLink } from './connection';

/**
 * Every conversation of the projects on screen, kept current from the desktop's
 * `conversations.events` stream (status changes, creations, deletions). A gap or a reconnect
 * reloads the loaded projects, since events may have been missed.
 */
class ConversationIndex {
  private readonly byId = new Map<string, Conversation>();
  private readonly loadedProjects = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private started = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  forTask(taskId: string): Conversation[] {
    return [...this.byId.values()]
      .filter((conversation) => conversation.taskId === taskId)
      .sort((a, b) => Number(b.isInitialConversation) - Number(a.isInitialConversation));
  }

  get(conversationId: string): Conversation | undefined {
    return this.byId.get(conversationId);
  }

  ensureProjects(projectIds: readonly string[]): void {
    this.start();
    for (const projectId of projectIds) {
      if (this.loadedProjects.has(projectId)) continue;
      this.loadedProjects.add(projectId);
      void this.loadProject(projectId);
    }
  }

  /** Optimistically clears the attention marker after the user opened a conversation. */
  markSeen(conversationId: string): void {
    const conversation = this.byId.get(conversationId);
    if (!conversation || conversation.agentStatusSeen !== false) return;
    this.byId.set(conversationId, { ...conversation, agentStatusSeen: true });
    this.emit();
    void getLink()
      .client.conversations.markConversationSeen({ conversationId })
      .catch(() => undefined);
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    const link = getLink();
    void link.client.conversations.events.subscribe(undefined, {
      onEvent: (event) => this.apply(event),
      onGap: () => this.reloadAll(),
    });
    link.onState((state) => {
      if (state === 'online') this.reloadAll();
    });
  }

  private reloadAll(): void {
    for (const projectId of this.loadedProjects) void this.loadProject(projectId);
  }

  private async loadProject(projectId: string): Promise<void> {
    try {
      const conversations = await getLink().client.conversations.getConversationsForProject({
        projectId,
      });
      for (const [id, conversation] of this.byId) {
        if (conversation.projectId === projectId) this.byId.delete(id);
      }
      for (const conversation of conversations) this.byId.set(conversation.id, conversation);
      this.emit();
    } catch {
      // Offline: the reconnect handler reloads.
    }
  }

  private apply(event: ConversationEvent): void {
    switch (event.type) {
      case 'created':
        this.byId.set(event.conversation.id, event.conversation);
        break;
      case 'deleted':
        this.byId.delete(event.conversationId);
        break;
      case 'changed': {
        const current = this.byId.get(event.conversationId);
        if (current) this.byId.set(event.conversationId, { ...current, ...event.changes });
        break;
      }
      case 'agent-status-changed': {
        const current = this.byId.get(event.conversationId);
        if (!current) return;
        this.byId.set(event.conversationId, {
          ...current,
          agentStatus: event.status,
          agentStatusSeen: event.seen,
        });
        break;
      }
    }
    this.emit();
  }

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

export const conversationIndex = new ConversationIndex();

/** Re-renders when any conversation of `projectIds` changes. */
export function useConversationIndex(projectIds: readonly string[]): ConversationIndex {
  const key = projectIds.join('|');
  useEffect(() => {
    conversationIndex.ensureProjects(key ? key.split('|') : []);
  }, [key]);
  useSyncExternalStore(conversationIndex.subscribe, conversationIndex.getVersion);
  return conversationIndex;
}
