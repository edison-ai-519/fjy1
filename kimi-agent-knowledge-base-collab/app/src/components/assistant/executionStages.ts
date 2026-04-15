import type {
  PersistedOntologyAssistantExecutionStage,
  PersistedOntologyAssistantMessage,
  PersistedOntologyAssistantToolRun,
} from '@/lib/api';

export interface ExecutionFlowStage extends PersistedOntologyAssistantExecutionStage {
  toolRun?: PersistedOntologyAssistantToolRun | null;
}

function mapToolRunStatusToSemanticStatus(
  status: PersistedOntologyAssistantToolRun['status'],
): PersistedOntologyAssistantExecutionStage['semanticStatus'] {
  switch (status) {
    case 'success':
      return 'completed';
    case 'cancelled':
    case 'rejected':
    case 'timeout':
      return 'interrupted';
    case 'error':
      return 'failed';
    case 'running':
      return 'executing';
    default:
      return 'thinking';
  }
}

export function semanticStatusLabel(
  status: PersistedOntologyAssistantExecutionStage['semanticStatus'],
): string {
  switch (status) {
    case 'thinking':
      return '思考中...';
    case 'executing':
      return '执行中...';
    case 'reasoning':
      return '推理中...';
    case 'observing':
      return '观察中...';
    case 'interrupted':
      return '执行中断...';
    case 'failed':
      return '执行失败...';
    case 'completed':
      return '执行结束...';
    default:
      return '思考中...';
  }
}

function normalizeExecutionStage(
  stage: Partial<PersistedOntologyAssistantExecutionStage>,
): PersistedOntologyAssistantExecutionStage {
  const semanticStatus = stage.semanticStatus ?? 'thinking';

  return {
    id: stage.id ?? `stage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    semanticStatus,
    label: stage.label ?? semanticStatusLabel(semanticStatus),
    phaseState: stage.phaseState === 'completed' ? 'completed' : 'active',
    sourceEventType: stage.sourceEventType ?? 'request.started',
    detail: stage.detail ?? '',
    callId: stage.callId ?? null,
    startedAt: stage.startedAt ?? null,
    finishedAt: stage.finishedAt ?? null,
  };
}

export function deriveExecutionStagesFromToolRuns(
  toolRuns: PersistedOntologyAssistantToolRun[],
): PersistedOntologyAssistantExecutionStage[] {
  if (!Array.isArray(toolRuns) || toolRuns.length === 0) {
    return [];
  }

  return toolRuns.map((toolRun, index) => {
    const semanticStatus = mapToolRunStatusToSemanticStatus(toolRun.status);
    return normalizeExecutionStage({
      id: `legacy-stage-${toolRun.callId || index}`,
      semanticStatus,
      label: semanticStatusLabel(semanticStatus),
      phaseState: toolRun.finishedAt ? 'completed' : 'active',
      sourceEventType: 'legacy.tool_run',
      detail: toolRun.command,
      callId: toolRun.callId,
      startedAt: toolRun.startedAt,
      finishedAt: toolRun.finishedAt,
    });
  });
}

export function upsertExecutionStage(
  stages: PersistedOntologyAssistantExecutionStage[],
  incomingStage: Partial<PersistedOntologyAssistantExecutionStage>,
): PersistedOntologyAssistantExecutionStage[] {
  const normalizedStage = normalizeExecutionStage(incomingStage);
  const existingIndex = stages.findIndex((stage) => stage.id === normalizedStage.id);

  if (existingIndex !== -1) {
    const nextStages = [...stages];
    nextStages[existingIndex] = {
      ...nextStages[existingIndex],
      ...normalizedStage,
    };
    return nextStages;
  }

  const nextStages: PersistedOntologyAssistantExecutionStage[] = stages.map((stage, index) => {
    if (index !== stages.length - 1 || stage.phaseState === 'completed') {
      return stage;
    }

    return {
      ...stage,
      phaseState: 'completed' as const,
      finishedAt: normalizedStage.startedAt ?? stage.finishedAt,
    };
  });

  nextStages.push(normalizedStage);
  return nextStages;
}

export function normalizeAssistantMessageStages<T extends Pick<PersistedOntologyAssistantMessage, 'toolRuns'> & {
  executionStages?: PersistedOntologyAssistantExecutionStage[];
}>(message: T): T & { executionStages: PersistedOntologyAssistantExecutionStage[] } {
  const executionStages = Array.isArray(message.executionStages) && message.executionStages.length > 0
    ? message.executionStages.map(normalizeExecutionStage)
    : deriveExecutionStagesFromToolRuns(message.toolRuns);

  return {
    ...message,
    executionStages,
  };
}

export function buildExecutionFlowStages(messages: PersistedOntologyAssistantMessage[]): ExecutionFlowStage[] {
  return messages.flatMap((message) => {
    const normalizedMessage = normalizeAssistantMessageStages(message);
    return normalizedMessage.executionStages.map((stage) => ({
      ...stage,
      toolRun: stage.callId
        ? normalizedMessage.toolRuns.find((toolRun) => toolRun.callId === stage.callId) ?? null
        : null,
    }));
  });
}
