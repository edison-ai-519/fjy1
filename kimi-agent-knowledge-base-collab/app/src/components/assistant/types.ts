import type {
  PersistedOntologyAssistantExecutionStage,
  PersistedOntologyAssistantMessage,
  PersistedOntologyAssistantSession,
  PersistedOntologyAssistantToolRun,
} from '@/lib/api';

export type ConversationToolRun = PersistedOntologyAssistantToolRun;
export type ConversationMessage = PersistedOntologyAssistantMessage;
export type ConversationSession = PersistedOntologyAssistantSession;
export type ConversationExecutionStage = PersistedOntologyAssistantExecutionStage & {
  toolRun?: PersistedOntologyAssistantToolRun | null;
};
