import type {
  PersistedOntologyAssistantExecutionStage,
  PersistedOntologyAssistantMessage,
  PersistedOntologyAssistantSession,
  PersistedOntologyAssistantToolRun,
} from '@/features/assistant/api';

export type ConversationToolRun = PersistedOntologyAssistantToolRun;
export type ConversationMessage = PersistedOntologyAssistantMessage;
export type ConversationSession = PersistedOntologyAssistantSession;
export type ConversationExecutionStage = PersistedOntologyAssistantExecutionStage & {
  toolRun?: PersistedOntologyAssistantToolRun | null;
};

