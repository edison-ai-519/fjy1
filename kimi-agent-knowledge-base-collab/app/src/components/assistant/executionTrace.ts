import type { PersistedOntologyAssistantContentBlock } from '@/features/assistant/api';

type AssistantBlock = Extract<PersistedOntologyAssistantContentBlock, { type: 'assistant' }>;
type ToolCallBlock = Extract<PersistedOntologyAssistantContentBlock, { type: 'tool_call' }>;
type ToolResultBlock = Extract<PersistedOntologyAssistantContentBlock, { type: 'tool_result' }>;

export type AssistantContentGroup =
  | { type: 'assistant'; block: AssistantBlock }
  | { type: 'paired_execution'; callBlock: ToolCallBlock; resultBlock?: ToolResultBlock }
  | { type: 'standalone_call'; block: ToolCallBlock }
  | { type: 'standalone_result'; block: ToolResultBlock };

export type ExecutionTraceKind = 'plain' | 'cli';

function isVisibleCallId(callId: string | null | undefined) {
  return typeof callId === 'string' && callId.trim().length > 0;
}

function stripQuotes(value: string) {
  return value.replace(/^['"]|['"]$/g, '');
}

function isCommandWrapperToken(token: string) {
  return /^(bash|sh|zsh|fish|python3?|node|tsx|bun|cmd|powershell|pwsh)$/i.test(token);
}

function tokenizeCommand(command: string) {
  const normalized = command.trim();
  if (!normalized) {
    return [];
  }

  const tokens = normalized.match(/(?:[^\s"'`]+|"[^"]*"|'[^']*')+/g);
  return (tokens || normalized.split(/\s+/)).map(stripQuotes).filter(Boolean);
}

function isScriptToken(token: string) {
  return /^[^\s"'`]+?\.(?:sh|py|ps1|js|ts|tsx|mjs|cjs)$/i.test(token.trim());
}

function getBaseName(token: string) {
  return token.split(/[\\/]/).filter(Boolean).pop() ?? token;
}

function getFirstExecutableToken(tokens: string[]) {
  for (const token of tokens) {
    if (!token) {
      continue;
    }
    if (token.startsWith('-')) {
      continue;
    }
    return token;
  }
  return '';
}

function extractCliScriptToken(command: string) {
  const tokens = tokenizeCommand(command);
  if (tokens.length === 0) {
    return '';
  }

  const firstToken = tokens[0];
  if (isScriptToken(firstToken)) {
    return getBaseName(firstToken);
  }

  if (!isCommandWrapperToken(firstToken)) {
    return '';
  }

  const executableToken = getFirstExecutableToken(tokens.slice(1));
  const executableHead = executableToken.split(/\s+/)[0] || '';
  if (!executableHead || !isScriptToken(executableHead)) {
    return '';
  }

  return getBaseName(executableHead);
}

export function getExecutionTraceTitle(command: string, toolName?: string) {
  if (toolName === 'query_agent') {
    return '封装 CLI';
  }

  const tokens = tokenizeCommand(command);
  if (tokens.length === 0) {
    return '命令行执行';
  }

  const scriptToken = extractCliScriptToken(command);
  if (scriptToken) {
    return scriptToken;
  }

  const firstToken = tokens[0];
  if (isCommandWrapperToken(firstToken)) {
    return firstToken;
  }

  return firstToken || '命令行执行';
}

export function getExecutionTraceKind(command: string, toolName?: string): ExecutionTraceKind {
  if (toolName === 'query_agent') {
    return 'cli';
  }

  return extractCliScriptToken(command) ? 'cli' : 'plain';
}

export function isCliExecutionTrace(command: string, toolName?: string) {
  return getExecutionTraceKind(command, toolName) === 'cli';
}

export function isToolRunFailure(status?: string | null, exitCode?: number | null) {
  if (status === 'error') {
    return true;
  }

  return typeof exitCode === 'number' && exitCode !== 0;
}

export function groupAssistantContentBlocks(blocks: PersistedOntologyAssistantContentBlock[]): AssistantContentGroup[] {
  if (blocks.length === 0) {
    return [];
  }

  const grouped: AssistantContentGroup[] = [];
  const resultMap = new Map<string, ToolResultBlock>();

  blocks.forEach((block) => {
    if (block.type === 'tool_result' && isVisibleCallId(block.callId)) {
      resultMap.set(block.callId, block);
    }
  });

  const consumedCallIds = new Set<string>();

  blocks.forEach((block) => {
    if (block.type === 'assistant') {
      grouped.push({ type: 'assistant', block });
      return;
    }

    if (block.type === 'tool_call') {
      const pairedResult = isVisibleCallId(block.callId) ? resultMap.get(block.callId) : undefined;
      if (pairedResult) {
        grouped.push({
          type: 'paired_execution',
          callBlock: block,
          resultBlock: pairedResult,
        });
        consumedCallIds.add(block.callId);
        return;
      }

      grouped.push({ type: 'standalone_call', block });
      return;
    }

    if (block.type === 'tool_result') {
      if (!isVisibleCallId(block.callId) || !consumedCallIds.has(block.callId)) {
        grouped.push({ type: 'standalone_result', block });
      }
    }
  });

  return grouped;
}
