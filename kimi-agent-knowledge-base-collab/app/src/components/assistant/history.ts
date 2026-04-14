import type { ConversationSession } from './types';

function containsQuery(value: string | null | undefined, query: string) {
  return typeof value === 'string' && value.toLowerCase().includes(query);
}

export function filterAssistantSessions(
  sessions: ConversationSession[],
  rawQuery: string,
): ConversationSession[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) {
    return sessions;
  }

  return sessions.filter((session) => (
    containsQuery(session.title, query)
    || session.messages.some((message) => (
      containsQuery(message.question, query)
      || containsQuery(message.answer, query)
    ))
  ));
}

export function getAssistantSessionPreview(session: ConversationSession): string {
  const latestMessage = session.messages.at(-1);
  if (!latestMessage) {
    return '还没有消息';
  }

  return latestMessage.question || latestMessage.answer || '还没有消息';
}
