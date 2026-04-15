import type { ConversationSession } from '@/components/assistant/types';

export function createAssistantSession(index = 1): ConversationSession {
  return {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: `新对话 ${index}`,
    draftQuestion: '',
    messages: [],
    error: null,
    loading: false,
    statusMessage: null,
  };
}

export function removeAssistantSession(
  sessions: ConversationSession[],
  sessionId: string,
  activeSessionId: string,
) {
  const filteredSessions = sessions.filter((session) => session.id !== sessionId);
  const nextSessions = filteredSessions.length > 0
    ? filteredSessions
    : [createAssistantSession()];
  const nextActiveSessionId = sessionId === activeSessionId
    ? nextSessions[0]?.id || ''
    : activeSessionId;

  return {
    sessions: nextSessions,
    activeSessionId: nextActiveSessionId,
  };
}
