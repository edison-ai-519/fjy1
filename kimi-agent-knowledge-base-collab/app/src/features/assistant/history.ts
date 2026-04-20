import type { OntologyAssistantHistoryTurn, PersistedOntologyAssistantMessage } from './api';

type ConversationMessage = PersistedOntologyAssistantMessage;

export function buildConversationHistory(
  messages: ConversationMessage[],
  options: {
    historyCutoffMessageId?: string;
    limit?: number;
  } = {},
): OntologyAssistantHistoryTurn[] {
  const limit = typeof options.limit === 'number' && options.limit > 0 ? options.limit : 6;
  const cutoffMessageId = typeof options.historyCutoffMessageId === 'string'
    ? options.historyCutoffMessageId.trim()
    : '';
  const cutoffIndex = cutoffMessageId
    ? messages.findIndex((message) => message.id === cutoffMessageId)
    : messages.length - 1;
  const endIndex = cutoffIndex >= 0 ? cutoffIndex + 1 : messages.length;

  return messages
    .slice(0, endIndex)
    .filter((message) => typeof message.answer === 'string' && message.answer.trim().length > 0)
    .slice(-limit)
    .map((message) => ({
      question: message.question,
      answer: message.answer,
    }));
}
