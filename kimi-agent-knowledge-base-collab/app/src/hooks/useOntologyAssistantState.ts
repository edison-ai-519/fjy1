import * as React from 'react';

import {
  askOntologyAssistantStream,
  fetchOntologyAssistantState,
  saveOntologyAssistantState,
  type OntologyAssistantHistoryTurn,
  type OntologyAssistantSessionState,
} from '@/lib/api';
import type { Entity } from '@/types/ontology';
import type { ConversationExecutionStage, ConversationSession, ConversationToolRun } from '@/components/assistant/types';
import {
  buildExecutionFlowStages,
  normalizeAssistantMessageStages,
  upsertExecutionStage,
} from '@/components/assistant/executionStages';
import {
  createAssistantSession,
  removeAssistantSession,
} from '@/hooks/assistantSessionState';

const STORAGE_KEY = 'ontology-assistant-state-v1';

export const DEFAULT_MODEL = 'gpt-4.1-mini';
export const CUSTOM_MODEL_KEY = '__custom__';
export const MODEL_PRESETS = [
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'o4-mini', label: 'o4-mini' },
];

function readBrowserState() {
  if (typeof window === 'undefined') {
    return null;
  }

  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return null;
  }

  try {
    const parsed = JSON.parse(saved) as Partial<OntologyAssistantSessionState>;
    return {
      ...parsed,
      sessions: Array.isArray(parsed.sessions)
        ? parsed.sessions.map((session) => ({
          ...session,
          messages: Array.isArray(session.messages)
            ? session.messages.map((message) => normalizeAssistantMessageStages(message))
            : [],
        }))
        : [],
    } as Partial<OntologyAssistantSessionState>;
  } catch {
    return null;
  }
}

function createEmptyToolRun(callId: string): ConversationToolRun {
  return {
    callId,
    command: '',
    status: 'running',
    stdout: '',
    stderr: '',
    exitCode: null,
    cwd: null,
    durationMs: null,
    truncated: false,
    startedAt: null,
    finishedAt: null,
  };
}

function updateToolRun(
  runs: ConversationToolRun[],
  callId: string,
  updater: (run: ConversationToolRun) => ConversationToolRun,
): ConversationToolRun[] {
  const index = runs.findIndex((run) => run.callId === callId);
  if (index === -1) {
    return [...runs, updater(createEmptyToolRun(callId))];
  }

  const next = [...runs];
  next[index] = updater(next[index]);
  return next;
}

export function useOntologyAssistantState(selectedEntity: Entity | null) {
  const initialState = React.useMemo(() => readBrowserState(), []);

  const [sessions, setSessions] = React.useState<ConversationSession[]>(() => (
    initialState?.sessions && initialState.sessions.length > 0
      ? initialState.sessions as ConversationSession[]
      : [createAssistantSession()]
  ));
  const [activeSessionId, setActiveSessionId] = React.useState<string>(() => (
    initialState?.activeSessionId || ''
  ));
  const [businessPrompt, setBusinessPrompt] = React.useState<string>(() => (
    initialState?.businessPrompt || ''
  ));
  const [modelName, setModelName] = React.useState<string>(() => (
    initialState?.modelName || DEFAULT_MODEL
  ));
  const [hydrated, setHydrated] = React.useState(false);

  const activeSession = React.useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || sessions[0] || null,
    [activeSessionId, sessions],
  );
  const isBusy = React.useMemo(
    () => sessions.some((session) => session.loading),
    [sessions],
  );
  const currentToolRuns = React.useMemo(
    () => buildExecutionFlowStages(activeSession?.messages || []),
    [activeSession],
  );

  React.useEffect(() => {
    if (!activeSessionId && sessions[0]) {
      setActiveSessionId(sessions[0].id);
      return;
    }

    if (activeSessionId && !sessions.some((session) => session.id === activeSessionId) && sessions[0]) {
      setActiveSessionId(sessions[0].id);
    }
  }, [activeSessionId, sessions]);

  React.useEffect(() => {
    const init = async () => {
      try {
        const state = await fetchOntologyAssistantState();
        if (state?.sessions?.length) {
          setSessions(
            state.sessions.map((session) => ({
              ...session,
              messages: session.messages.map((message) => normalizeAssistantMessageStages(message)),
            })) as ConversationSession[],
          );
          setActiveSessionId(state.activeSessionId || state.sessions[0]?.id || '');
          setBusinessPrompt(state.businessPrompt || '');
          setModelName(state.modelName || DEFAULT_MODEL);
        }
      } catch (error) {
        console.warn('Backend state recovery failed:', error);
      } finally {
        setHydrated(true);
      }
    };

    init();
  }, []);

  React.useEffect(() => {
    if (!hydrated) {
      return;
    }

    const snapshot: OntologyAssistantSessionState = {
      sessions,
      activeSessionId,
      businessPrompt,
      modelName,
    };

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    }

    const persistTask = window.setTimeout(() => {
      saveOntologyAssistantState(snapshot).catch(() => {});
    }, 1000);

    return () => window.clearTimeout(persistTask);
  }, [sessions, activeSessionId, businessPrompt, modelName, hydrated]);

  const updateActiveSession = React.useCallback((updater: (session: ConversationSession) => ConversationSession) => {
    setSessions((previous) => previous.map((session) => (
      session.id === activeSessionId ? updater(session) : session
    )));
  }, [activeSessionId]);

  const onNewSession = React.useCallback(() => {
    const session = createAssistantSession(sessions.length + 1);
    setSessions((previous) => [session, ...previous]);
    setActiveSessionId(session.id);
  }, [sessions.length]);

  const onDeleteSession = React.useCallback((sessionId: string) => {
    setSessions((previous) => {
      const nextState = removeAssistantSession(previous, sessionId, activeSessionId);
      if (nextState.activeSessionId !== activeSessionId) {
        setActiveSessionId(nextState.activeSessionId);
      }
      return nextState.sessions;
    });
  }, [activeSessionId]);

  const onDraftChange = React.useCallback((value: string) => {
    updateActiveSession((session) => ({
      ...session,
      draftQuestion: value,
      error: null,
    }));
  }, [updateActiveSession]);

  const onAsk = React.useCallback(async (question?: string) => {
    if (!activeSession) {
      return;
    }

    const query = (question || activeSession.draftQuestion).trim();
    if (!query || isBusy) {
      return;
    }

    const messageId = `msg-${Date.now()}`;
    const conversationId = activeSession.id;

    if (activeSession.messages.length === 0) {
      updateActiveSession((session) => ({
        ...session,
        title: query.slice(0, 18),
      }));
    }

    const conversationHistory: OntologyAssistantHistoryTurn[] = activeSession.messages
      .slice(-6)
      .map((message) => ({
        question: message.question,
        answer: message.answer,
      }));

    updateActiveSession((session) => ({
      ...session,
      loading: true,
      error: null,
      statusMessage: 'AI 思考中...',
          messages: [
            ...session.messages,
            normalizeAssistantMessageStages({
              id: messageId,
              question: query,
              answer: '',
              relatedNames: [],
              executionStages: [],
              toolRuns: [],
            }),
          ],
        }));

    try {
      let accumulatedAnswer = '';
      let relatedNames: string[] = [];

      await askOntologyAssistantStream(
        {
          question: query,
          entityId: selectedEntity?.id,
          conversationId,
          businessPrompt: businessPrompt || undefined,
          modelName: modelName || DEFAULT_MODEL,
          conversationHistory,
        },
        {
          onStatus: (statusMessage) => {
            updateActiveSession((session) => ({
              ...session,
              statusMessage,
            }));
          },
          onContext: (context) => {
            relatedNames = context.related?.map((entity) => entity.name) || [];
            updateActiveSession((session) => ({
              ...session,
              messages: session.messages.map((message) => (
                message.id === messageId
                  ? { ...message, relatedNames }
                  : message
              )),
            }));
          },
          onAnswerDelta: (delta) => {
            accumulatedAnswer += delta;
            updateActiveSession((session) => ({
              ...session,
              messages: session.messages.map((message) => (
                message.id === messageId
                  ? { ...message, answer: accumulatedAnswer }
                  : message
              )),
            }));
          },
          onExecutionStage: (event) => {
            updateActiveSession((session) => ({
              ...session,
              statusMessage: event.label,
              messages: session.messages.map((message) => (
                message.id === messageId
                  ? {
                    ...message,
                    executionStages: upsertExecutionStage(message.executionStages || [], event),
                  }
                  : message
              )),
            }));
          },
          onToolStarted: (event) => {
            updateActiveSession((session) => ({
              ...session,
              messages: session.messages.map((message) => (
                message.id === messageId
                  ? {
                    ...message,
                    toolRuns: updateToolRun(message.toolRuns, event.callId, (run) => ({
                      ...run,
                      command: event.command,
                      cwd: event.cwd,
                      startedAt: event.startedAt,
                      status: 'running',
                    })),
                  }
                  : message
              )),
            }));
          },
          onToolOutput: (event) => {
            updateActiveSession((session) => ({
              ...session,
              messages: session.messages.map((message) => (
                message.id === messageId
                  ? {
                    ...message,
                    toolRuns: updateToolRun(message.toolRuns, event.callId, (run) => ({
                      ...run,
                      stdout: event.stream === 'stdout' ? run.stdout + event.chunk : run.stdout,
                      stderr: event.stream === 'stderr' ? run.stderr + event.chunk : run.stderr,
                    })),
                  }
                  : message
              )),
            }));
          },
          onToolFinished: (event) => {
            updateActiveSession((session) => ({
              ...session,
              messages: session.messages.map((message) => (
                message.id === messageId
                  ? {
                    ...message,
                    toolRuns: updateToolRun(message.toolRuns, event.callId, (run) => ({
                      ...run,
                      status: event.status,
                      exitCode: event.exitCode,
                      durationMs: event.durationMs,
                      finishedAt: event.finishedAt,
                      stdout: run.stdout || event.stdout,
                      stderr: run.stderr || event.stderr,
                    })),
                  }
                  : message
              )),
            }));
          },
          onComplete: (response) => {
            updateActiveSession((session) => ({
              ...session,
              loading: false,
              error: null,
              statusMessage: null,
              draftQuestion: '',
              messages: session.messages.map((message) => (
                message.id === messageId
                  ? {
                    ...message,
                    answer: response.answer || accumulatedAnswer,
                    relatedNames: response.context?.related?.map((entity) => entity.name) || relatedNames,
                  }
                  : message
              )),
            }));
          },
        },
      );
    } catch (error) {
      updateActiveSession((session) => ({
        ...session,
        loading: false,
        statusMessage: null,
        error: error instanceof Error ? error.message : '推理中断',
      }));
    }
  }, [activeSession, businessPrompt, isBusy, modelName, selectedEntity?.id, updateActiveSession]);

  return {
    sessions,
    activeSession,
    activeSessionId,
    businessPrompt,
    currentExecutionStages: currentToolRuns as ConversationExecutionStage[],
    isBusy,
    modelName,
    onAsk,
    onDraftChange,
    onNewSession,
    onDeleteSession,
    setActiveSessionId,
    setBusinessPrompt,
    setModelName,
  };
}
