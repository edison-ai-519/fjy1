import { buildApiUrl, parseJson, parseSseEvent, asObject } from '@/shared/api/http';
import type { Entity } from '@/types/ontology';

export interface OntologyAssistantContext {
  entity?: Entity | null;
  related?: Entity[];
  searchHits?: Entity[];
}

export interface OntologyAssistantResponse {
  answer: string;
  context?: OntologyAssistantContext;
  raw?: unknown;
  stderr?: string;
}

export interface OntologyAssistantHistoryTurn {
  question: string;
  answer: string;
}

export interface OntologyAssistantToolStartedEvent {
  callId: string;
  command: string;
  cwd: string | null;
  startedAt: string;
}

export interface OntologyAssistantToolOutputEvent {
  callId: string;
  command: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
  cwd: string | null;
  startedAt: string;
}

export interface OntologyAssistantToolFinishedEvent {
  callId: string;
  command: string;
  status: 'running' | 'success' | 'error' | 'timeout' | 'cancelled' | 'rejected';
  stdout: string;
  stderr: string;
  exitCode: number | null;
  cwd: string | null;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string;
}

export type OntologyAssistantSemanticStatus =
  | 'thinking'
  | 'executing'
  | 'reasoning'
  | 'observing'
  | 'interrupted'
  | 'completed';

export interface OntologyAssistantExecutionStageEvent {
  id: string;
  semanticStatus: OntologyAssistantSemanticStatus;
  label: string;
  phaseState: 'active' | 'completed';
  sourceEventType: string;
  detail: string;
  callId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface PersistedOntologyAssistantToolRun {
  callId: string;
  command: string;
  status: 'running' | 'success' | 'error' | 'timeout' | 'cancelled' | 'rejected';
  stdout: string;
  stderr: string;
  exitCode: number | null;
  cwd: string | null;
  durationMs: number | null;
  truncated: boolean;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface PersistedOntologyAssistantMessage {
  id: string;
  question: string;
  answer: string;
  relatedNames: string[];
  executionStages: PersistedOntologyAssistantExecutionStage[];
  toolRuns: PersistedOntologyAssistantToolRun[];
}

export type PersistedOntologyAssistantExecutionStage = OntologyAssistantExecutionStageEvent;

export interface PersistedOntologyAssistantSession {
  id: string;
  title: string;
  draftQuestion: string;
  messages: PersistedOntologyAssistantMessage[];
  error: string | null;
  loading: boolean;
  statusMessage: string | null;
}

export interface OntologyAssistantSessionState {
  sessions: PersistedOntologyAssistantSession[];
  activeSessionId: string;
  businessPrompt: string;
  modelName: string;
}

export interface OntologyAssistantStreamHandlers {
  onStatus?: (message: string) => void;
  onContext?: (context: OntologyAssistantContext) => void;
  onAnswerDelta?: (delta: string) => void;
  onExecutionStage?: (event: OntologyAssistantExecutionStageEvent) => void;
  onToolStarted?: (event: OntologyAssistantToolStartedEvent) => void;
  onToolOutput?: (event: OntologyAssistantToolOutputEvent) => void;
  onToolFinished?: (event: OntologyAssistantToolFinishedEvent) => void;
  onComplete?: (response: OntologyAssistantResponse) => void;
}

export async function askOntologyAssistant(input: {
  question: string;
  entityId?: string;
  conversationId?: string;
  businessPrompt?: string;
  modelName?: string;
  conversationHistory?: OntologyAssistantHistoryTurn[];
}): Promise<OntologyAssistantResponse> {
  const response = await fetch(buildApiUrl('/api/chat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  return parseJson(response);
}

export async function fetchOntologyAssistantState(): Promise<OntologyAssistantSessionState> {
  const response = await fetch(buildApiUrl('/api/chat/state'));
  return parseJson<OntologyAssistantSessionState>(response);
}

export async function saveOntologyAssistantState(
  input: OntologyAssistantSessionState,
): Promise<OntologyAssistantSessionState> {
  const response = await fetch(buildApiUrl('/api/chat/state'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  return parseJson<OntologyAssistantSessionState>(response);
}

export async function askOntologyAssistantStream(
  input: {
    question: string;
    entityId?: string;
    conversationId?: string;
    businessPrompt?: string;
    modelName?: string;
    conversationHistory?: OntologyAssistantHistoryTurn[];
  },
  handlers: OntologyAssistantStreamHandlers = {},
  options: {
    signal?: AbortSignal;
  } = {},
): Promise<OntologyAssistantResponse> {
  const response = await fetch(buildApiUrl('/api/chat/stream'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  if (!response.body) {
    throw new Error('Streaming response body is missing.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResponse: OntologyAssistantResponse | null = null;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseEvent(rawEvent);
      if (parsed) {
        const eventData = asObject(parsed.data);
        if (parsed.event === 'status') {
          handlers.onStatus?.(typeof eventData?.message === 'string' ? eventData.message : '');
        } else if (parsed.event === 'context') {
          handlers.onContext?.((parsed.data as OntologyAssistantResponse['context']) ?? {});
        } else if (parsed.event === 'answer_delta') {
          handlers.onAnswerDelta?.(typeof eventData?.delta === 'string' ? eventData.delta : '');
        } else if (parsed.event === 'execution_stage') {
          handlers.onExecutionStage?.(parsed.data as OntologyAssistantExecutionStageEvent);
        } else if (parsed.event === 'tool_started') {
          handlers.onToolStarted?.(parsed.data as OntologyAssistantToolStartedEvent);
        } else if (parsed.event === 'tool_output') {
          handlers.onToolOutput?.(parsed.data as OntologyAssistantToolOutputEvent);
        } else if (parsed.event === 'tool_finished') {
          handlers.onToolFinished?.(parsed.data as OntologyAssistantToolFinishedEvent);
        } else if (parsed.event === 'complete') {
          finalResponse = parsed.data as OntologyAssistantResponse;
          handlers.onComplete?.(finalResponse);
          return finalResponse;
        } else if (parsed.event === 'error') {
          throw new Error(typeof eventData?.message === 'string' ? eventData.message : 'Streaming request failed.');
        }
      }
      boundary = buffer.indexOf('\n\n');
    }

    if (done) {
      break;
    }
  }

  if (!finalResponse) {
    throw new Error('Question stream ended before completion.');
  }

  return finalResponse;
}

