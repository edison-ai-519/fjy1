import type {
  PersistedOntologyAssistantMessage,
  PersistedOntologyAssistantSession,
  PersistedOntologyAssistantToolRun,
} from '@/lib/api';

export type ConversationToolRun = PersistedOntologyAssistantToolRun;
export type ConversationMessage = PersistedOntologyAssistantMessage;
export type ConversationSession = PersistedOntologyAssistantSession;
