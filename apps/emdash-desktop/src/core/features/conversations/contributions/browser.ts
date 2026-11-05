import { createConversationModal } from '../browser/create-conversation-modal';
import { resumeClaudeSessionModal } from '../browser/resume-claude-session-modal';

export const conversationsBrowserContributions = {
  modalDefs: [createConversationModal, resumeClaudeSessionModal],
} as const;
