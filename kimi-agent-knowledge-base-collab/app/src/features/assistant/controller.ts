import type {
  OntologyAssistantToolFinishedEvent,
  OntologyAssistantToolOutputEvent,
  OntologyAssistantToolStartedEvent,
  PersistedOntologyAssistantToolRun,
} from '@/features/assistant/api';

export function createEmptyToolRun(callId: string): PersistedOntologyAssistantToolRun {
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
  runs: PersistedOntologyAssistantToolRun[],
  callId: string,
  updater: (run: PersistedOntologyAssistantToolRun) => PersistedOntologyAssistantToolRun,
): PersistedOntologyAssistantToolRun[] {
  const index = runs.findIndex((run) => run.callId === callId);
  if (index === -1) {
    return [...runs, updater(createEmptyToolRun(callId))];
  }

  const next = [...runs];
  next[index] = updater(next[index]);
  return next;
}

export function applyToolStarted(
  runs: PersistedOntologyAssistantToolRun[],
  event: OntologyAssistantToolStartedEvent,
): PersistedOntologyAssistantToolRun[] {
  return updateToolRun(runs, event.callId, (run) => ({
    ...run,
    command: event.command,
    cwd: event.cwd,
    startedAt: event.startedAt,
    status: 'running',
  }));
}

export function applyToolOutput(
  runs: PersistedOntologyAssistantToolRun[],
  event: OntologyAssistantToolOutputEvent,
): PersistedOntologyAssistantToolRun[] {
  return updateToolRun(runs, event.callId, (run) => ({
    ...run,
    stdout: event.stream === 'stdout' ? run.stdout + event.chunk : run.stdout,
    stderr: event.stream === 'stderr' ? run.stderr + event.chunk : run.stderr,
  }));
}

export function applyToolFinished(
  runs: PersistedOntologyAssistantToolRun[],
  event: OntologyAssistantToolFinishedEvent,
): PersistedOntologyAssistantToolRun[] {
  return updateToolRun(runs, event.callId, (run) => ({
    ...run,
    status: event.status,
    exitCode: event.exitCode,
    durationMs: event.durationMs,
    finishedAt: event.finishedAt,
    stdout: run.stdout || event.stdout,
    stderr: run.stderr || event.stderr,
  }));
}
