import React, { useRef, useEffect } from 'react';
import {
  Sparkles,
  AlertCircle,
  Copy,
  Check,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  Square,
  Terminal,
  CheckCircle2,
  AlertTriangle,
  LoaderCircle,
  Paperclip,
  Eye,
  GitCompareArrows,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AssistantMarkdown, copyCodeToClipboard } from './AssistantMarkdown';
import { getExecutionTraceKind, getExecutionTraceTitle, groupAssistantContentBlocks } from './executionTrace';
import { cn } from '@/lib/utils';
import type {
  PersistedOntologyAssistantContentBlock,
  PersistedOntologyAssistantToolRun,
} from '@/features/assistant/api';

interface ChatAreaProps {
  activeSession: any;
  onAsk: (question?: string) => void;
  onStop: () => void;
  onDraftChange: (value: string) => void;
  onUploadFile: (file: File) => Promise<void>;
  isBusy: boolean;
  selectedEntityName?: string;
  renderSettings?: () => React.ReactNode;
  renderExtraActions?: () => React.ReactNode;
}

const TOOL_OUTPUT_PREVIEW_LIMIT = 4000;

function hasVisibleText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0;
}

function formatToolRunStatus(toolRun: PersistedOntologyAssistantToolRun) {
  switch (toolRun.status) {
    case 'success':
      return {
        label: '成功',
        className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      };
    case 'error':
      return {
        label: '失败',
        className: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
      };
    case 'timeout':
      return {
        label: '超时',
        className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
      };
    case 'cancelled':
      return {
        label: '已取消',
        className: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
      };
    case 'rejected':
      return {
        label: '已拒绝',
        className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
      };
    case 'running':
    default:
      return {
        label: '进行中',
        className: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
        icon: <LoaderCircle className="h-3.5 w-3.5 animate-spin" />,
      };
  }
}

function buildToolOutputPreview(content: string) {
  const normalized = content.replace(/\s+$/g, '');
  if (normalized.length <= TOOL_OUTPUT_PREVIEW_LIMIT) {
    return {
      content: normalized,
      truncated: false,
    };
  }

  return {
    content: `${normalized.slice(0, TOOL_OUTPUT_PREVIEW_LIMIT)}\n...`,
    truncated: true,
  };
}

function ToolOutputBlock({
  label,
  content,
  tone,
}: {
  label: string;
  content: string;
  tone: 'default' | 'danger';
}) {
  const preview = buildToolOutputPreview(content);

  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/70">
        {label}
      </div>
      <pre
        className={cn(
          'max-h-56 overflow-auto rounded-2xl border px-3 py-2.5 text-[12px] leading-5 shadow-sm whitespace-pre-wrap [overflow-wrap:anywhere]',
          tone === 'danger'
            ? 'border-rose-500/20 bg-rose-500/5 text-rose-950 dark:text-rose-100'
            : 'border-border/40 bg-muted/30 text-foreground/85'
        )}
      >
        {preview.content}
      </pre>
      {preview.truncated && (
        <div className="text-[11px] text-muted-foreground/70">
          输出较长，当前只展示前 {TOOL_OUTPUT_PREVIEW_LIMIT} 个字符。
        </div>
      )}
    </div>
  );
}

function ToolRunDetails({ toolRuns }: { toolRuns: PersistedOntologyAssistantToolRun[] }) {
  if (toolRuns.length === 0) {
    return null;
  }

  return (
    <div className="mb-5 space-y-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground/80">
        <Terminal className="h-3.5 w-3.5" />
        <span>本轮工具过程</span>
      </div>

      {toolRuns.map((toolRun, index) => {
        const callBlock = {
          id: `tool-run-call-${toolRun.callId || index}`,
          type: 'tool_call' as const,
          callId: toolRun.callId,
          command: toolRun.command,
          toolName: toolRun.status === 'running' ? 'running' : undefined,
          createdAt: toolRun.startedAt || toolRun.finishedAt || '',
        };

        const executionKind = getExecutionTraceKind(toolRun.command);

        const resultBlock = {
          id: `tool-run-result-${toolRun.callId || index}`,
          type: 'tool_result' as const,
          callId: toolRun.callId,
          command: toolRun.command,
          toolName: toolRun.status === 'running' ? 'running' : undefined,
          status: toolRun.status,
          stdout: toolRun.stdout,
          stderr: toolRun.stderr,
          exitCode: toolRun.exitCode,
          cwd: toolRun.cwd,
          durationMs: toolRun.durationMs,
          createdAt: toolRun.startedAt || toolRun.finishedAt || '',
          finishedAt: toolRun.finishedAt,
        };

        return (
          executionKind === 'cli' ? (
            <ExecutionTraceCard
              key={toolRun.callId || `tool-run-${index}`}
              callBlock={callBlock}
              resultBlock={resultBlock}
            />
          ) : (
            <PlainExecutionCard
              key={toolRun.callId || `tool-run-${index}`}
              callBlock={callBlock}
              resultBlock={resultBlock}
            />
          )
        );
      })}
    </div>
  );
}

function PlainExecutionCard({
  callBlock,
  resultBlock,
  assistantAnswer,
}: {
  callBlock: Extract<PersistedOntologyAssistantContentBlock, { type: 'tool_call' }>;
  resultBlock?: Extract<PersistedOntologyAssistantContentBlock, { type: 'tool_result' }>;
  assistantAnswer?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const statusMeta = resultBlock
    ? formatToolRunStatus({
        callId: resultBlock.callId,
        command: resultBlock.command,
        status: resultBlock.status,
        stdout: resultBlock.stdout,
        stderr: resultBlock.stderr,
        exitCode: resultBlock.exitCode,
        cwd: resultBlock.cwd,
        durationMs: resultBlock.durationMs,
        truncated: false,
        startedAt: resultBlock.createdAt,
        finishedAt: resultBlock.finishedAt,
      })
    : {
        label: '进行中',
        className: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
        icon: <LoaderCircle className="h-3.5 w-3.5 animate-spin" />,
      };

  const title = getExecutionTraceTitle(callBlock.command || '', callBlock.toolName);
  const timeLabel = callBlock.createdAt ? new Date(callBlock.createdAt).toLocaleTimeString([], { hour12: false }) : '';
  const durationLabel = typeof resultBlock?.durationMs === 'number'
    ? `${(resultBlock.durationMs / 1000).toFixed(2)}s`
    : '';
  const hasStdout = hasVisibleText(resultBlock?.stdout);
  const hasStderr = hasVisibleText(resultBlock?.stderr);
  const answerText = typeof assistantAnswer === 'string' ? assistantAnswer.trim() : '';
  const formattedAnswer = formatAnswerAsJson(answerText);
  const answerIsJson = Boolean(answerText && formattedAnswer && formattedAnswer !== answerText);
  const cardTone =
    resultBlock?.status === 'error'
      ? 'border-rose-200/80 bg-rose-50/80 dark:border-rose-900/40 dark:bg-rose-950/20'
      : resultBlock?.status === 'running'
        ? 'border-amber-200/80 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-950/20'
        : 'border-slate-200/80 bg-white/75 dark:border-slate-800/70 dark:bg-slate-950/35';
  const titleTone =
    resultBlock?.status === 'error'
      ? 'text-rose-950 dark:text-rose-100'
      : resultBlock?.status === 'running'
        ? 'text-amber-950 dark:text-amber-100'
        : 'text-slate-950 dark:text-slate-100';
  const badgeTone =
    resultBlock?.status === 'error'
      ? 'ring-rose-500/10'
      : resultBlock?.status === 'running'
        ? 'ring-amber-500/10'
        : 'ring-slate-500/10';

  return (
    <div className={cn('group my-3 overflow-hidden rounded-[18px] border backdrop-blur-sm shadow-[0_10px_24px_-20px_rgba(15,23,42,0.35)] transition-shadow hover:shadow-[0_14px_28px_-18px_rgba(15,23,42,0.45)]', cardTone)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-900/40"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-slate-100/90 text-slate-600 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/80 dark:text-slate-300">
          <Terminal className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('truncate text-[15px] font-semibold', titleTone)}>
              {title}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground/75">
            {timeLabel && <span>开始 {timeLabel}</span>}
            {durationLabel && <span>· 耗时 {durationLabel}</span>}
            {callBlock.reasoning && (
              <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                reason
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm ring-1 ring-inset',
              statusMeta.className,
              badgeTone,
            )}
          >
            {statusMeta.icon}
            <span>{statusMeta.label}</span>
          </div>
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground/70 transition-transform',
              open && 'rotate-180',
            )}
          />
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-200/70 px-4 pb-4 pt-3 dark:border-slate-800/70">
          <div className="space-y-4">
            {/* 命令区 */}
            <div className="max-h-[120px] overflow-auto rounded-xl border border-slate-200/75 bg-slate-50/90 px-3 py-2 font-mono text-[12px] leading-5 text-foreground/90 [overflow-wrap:anywhere] dark:border-slate-800/80 dark:bg-slate-950/50 custom-scrollbar">
              {callBlock.command || '等待工具参数...'}
            </div>

            {hasVisibleText(callBlock.reasoning) && (
              <div className="rounded-2xl border border-amber-500/15 bg-amber-500/[0.05] px-3 py-2 text-[12px] leading-5 text-foreground/85 [overflow-wrap:anywhere]">
                <span className="mr-2 text-[10px] font-black uppercase tracking-[0.22em] text-amber-600 dark:text-amber-300">
                  reason
                </span>
                {callBlock.reasoning}
              </div>
            )}

            {resultBlock ? (
              <div className="max-h-[300px] overflow-auto space-y-3 custom-scrollbar">
                {hasStdout && (
                  <ToolOutputBlock label="stdout" content={resultBlock.stdout} tone="default" />
                )}
                {hasStderr && (
                  <ToolOutputBlock label="stderr" content={resultBlock.stderr} tone="danger" />
                )}
                {answerText && (
                  <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-3 dark:border-slate-800/70 dark:bg-slate-950/50">
                    <div className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-muted-foreground/70">
                      回复
                    </div>
                    {answerIsJson ? (
                      <pre className="max-h-60 overflow-auto rounded-2xl border border-slate-200/80 bg-background/80 p-3 font-mono text-[12px] leading-6 text-foreground/90 whitespace-pre-wrap [overflow-wrap:anywhere] dark:border-slate-800/70 dark:bg-slate-950/45 custom-scrollbar">
                        {formattedAnswer}
                      </pre>
                    ) : (
                      <AssistantMarkdown content={answerText} />
                    )}
                  </div>
                )}
                {!hasStdout && !hasStderr && !answerText && (
                  <div className="text-[12px] text-muted-foreground/80 italic">
                    本次工具调用没有可展示的输出。
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300/70 bg-slate-50/70 px-4 py-5 text-center text-xs text-muted-foreground dark:border-slate-700/70 dark:bg-slate-950/30">
                工具正在运行，等待回执...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolCallBlock({
  block,
}: {
  block?: Extract<PersistedOntologyAssistantContentBlock, { type: 'tool_call' }>;
}) {
  if (!block) {
    return null;
  }

  const isNer = block.toolName === 'ner';
  const isRe = block.toolName === 're';

  if (isNer || isRe) {
    return (
      <div className="relative overflow-hidden rounded-[28px] border border-border/30 bg-card/80 p-4 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.55)] backdrop-blur-sm">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.14),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(99,102,241,0.10),transparent_38%)]" />
        <div className="relative flex items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black tracking-[0.24em] uppercase text-white shadow-sm',
                  isNer ? 'bg-cyan-600' : 'bg-indigo-600',
                )}
              >
                {isNer ? <Eye className="h-3.5 w-3.5" /> : <GitCompareArrows className="h-3.5 w-3.5" />}
                {isNer ? '观察中' : '对比分析中'}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {block.createdAt ? new Date(block.createdAt).toLocaleTimeString([], { hour12: false }) : ''}
              </span>
            </div>
            <div className="max-w-[30rem] text-[13px] leading-6 text-foreground/80">
              {isNer
                ? '正在识别实体并把它们整理进图谱，右侧会同步出现可连接的节点。'
                : '正在对照实体关系与上下文，准备把对比结果连成一条可读的关系链。'}
            </div>
          </div>
          <div className={cn(
            'rounded-2xl border px-3 py-2 text-[11px] font-bold',
            isNer
              ? 'border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
              : 'border-indigo-500/20 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
          )}>
            {isNer ? 'NER' : 'RE'}
          </div>
        </div>
        <div className="relative mt-4 rounded-2xl border border-dashed border-border/40 bg-background/60 px-4 py-3 text-[12px] leading-6 text-muted-foreground">
          {isNer ? '观察实体抽取过程，并等待节点落图。' : '观察关系对照过程，并等待关系落线。'}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[16px] border border-slate-200/70 bg-white/70 p-3 shadow-[0_8px_18px_-16px_rgba(15,23,42,0.35)] backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-950/35">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-white dark:bg-slate-200 dark:text-slate-900">
          tool_call
        </span>
        <span className="text-[11px] text-muted-foreground">
          {block.createdAt ? new Date(block.createdAt).toLocaleTimeString([], { hour12: false }) : ''}
        </span>
      </div>
      <div className="rounded-2xl bg-muted/40 px-3 py-2 font-mono text-[12px] leading-5 text-foreground/90 [overflow-wrap:anywhere]">
        {block.command || '等待工具参数...'}
      </div>
      {hasVisibleText(block.reasoning) && (
        <div className="mt-2 text-[12px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
          reason: {block.reasoning}
        </div>
      )}
    </div>
  );
}

function ToolResultBlock({
  block,
}: {
  block?: Extract<PersistedOntologyAssistantContentBlock, { type: 'tool_result' }>;
}) {
  if (!block) {
    return null;
  }

  const isNer = block.toolName === 'ner';
  const isRe = block.toolName === 're';
  const statusMeta = formatToolRunStatus({
    callId: block.callId,
    command: block.command,
    status: block.status,
    stdout: block.stdout,
    stderr: block.stderr,
    exitCode: block.exitCode,
    cwd: block.cwd,
    durationMs: block.durationMs,
    truncated: false,
    startedAt: block.createdAt,
    finishedAt: block.finishedAt,
  });
  const hasStdout = hasVisibleText(block.stdout);
  const hasStderr = hasVisibleText(block.stderr);

  if (isNer || isRe) {
    return (
      <div className="rounded-[28px] border border-border/30 bg-card/80 p-4 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.55)]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black tracking-[0.24em] uppercase text-white shadow-sm',
                isNer ? 'bg-cyan-600' : 'bg-indigo-600',
              )}
            >
              {isNer ? <Eye className="h-3.5 w-3.5" /> : <GitCompareArrows className="h-3.5 w-3.5" />}
              {isNer ? '观察完成' : '对比完成'}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {typeof block.durationMs === 'number' ? `${(block.durationMs / 1000).toFixed(2)}s` : '已结束'}
            </span>
          </div>
          <div
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
              statusMeta.className,
            )}
          >
            {statusMeta.icon}
            <span>{statusMeta.label}</span>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-border/40 bg-background/70 p-3">
            <div className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/70">
              {isNer ? '抽取结果' : '关系对照'}
            </div>
            {hasStdout ? (
              <ToolOutputBlock label="stdout" content={block.stdout} tone="default" />
            ) : (
              <div className="text-[12px] text-muted-foreground/80">
                本次没有可直接渲染的结构化输出。
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-dashed border-border/40 bg-muted/20 p-3">
            <div className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/70">
              图谱联动
            </div>
            <div className="space-y-2 text-[12px] leading-6 text-muted-foreground">
              <div>
                {isNer ? '左侧已转为观察卡，右侧图谱会追加新节点。' : '左侧已转为对比卡，右侧图谱会尝试连出关系线。'}
              </div>
              <div className="rounded-xl bg-background/70 px-3 py-2 text-foreground/80">
                {isNer ? '节点正在落图' : '关系正在成线'}
              </div>
            </div>
          </div>
        </div>
        {hasStderr && (
          <div className="mt-3">
            <ToolOutputBlock label="stderr" content={block.stderr} tone="danger" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-[16px] border border-slate-200/70 bg-white/70 p-3 shadow-[0_8px_18px_-16px_rgba(15,23,42,0.35)] backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-950/35">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-blue-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-white">
          tool_result
        </span>
        <div
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
            statusMeta.className
          )}
        >
          {statusMeta.icon}
          <span>{statusMeta.label}</span>
          {typeof block.exitCode === 'number' && (
            <span className="font-mono opacity-80">exit {block.exitCode}</span>
          )}
          {typeof block.durationMs === 'number' && (
            <span className="font-mono opacity-80">{(block.durationMs / 1000).toFixed(2)}s</span>
          )}
        </div>
      </div>

      {hasStdout && (
        <ToolOutputBlock label="stdout" content={block.stdout} tone="default" />
      )}
      {hasStderr && (
        <ToolOutputBlock label="stderr" content={block.stderr} tone="danger" />
      )}
      {!hasStdout && !hasStderr && (
        <div className="text-[12px] text-muted-foreground/80">
          本次工具调用没有可展示的输出。
        </div>
      )}
    </div>
  );
}

function stripJsonCodeFence(value: string) {
  const trimmed = value.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function formatAnswerAsJson(value: string) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return '';
  }

  try {
    const parsed = JSON.parse(stripJsonCodeFence(normalized));
    return JSON.stringify(parsed, null, 2);
  } catch {
    return normalized;
  }
}

function CliAnswerPanel({ answer }: { answer: string }) {
  const normalizedAnswer = answer.trim();
  const formattedAnswer = formatAnswerAsJson(normalizedAnswer);
  const answerIsJson = Boolean(normalizedAnswer && formattedAnswer && formattedAnswer !== normalizedAnswer);

  return (
    <div className="relative overflow-hidden rounded-[26px] border border-indigo-500/25 bg-gradient-to-br from-indigo-500/12 via-cyan-500/8 to-white/90 p-4 shadow-[0_24px_60px_-36px_rgba(79,70,229,0.75)] dark:from-indigo-500/15 dark:via-cyan-500/10 dark:to-slate-950/80">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.16),transparent_40%),radial-gradient(circle_at_bottom_left,rgba(34,211,238,0.12),transparent_34%)]" />
      <div className="relative mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-indigo-700 dark:text-indigo-300">
          <Sparkles className="h-3.5 w-3.5" />
          智能回复
        </div>
        <div className="rounded-full border border-indigo-500/15 bg-white/75 px-2.5 py-1 text-[10px] font-semibold text-indigo-700 dark:bg-slate-950/65 dark:text-indigo-300">
          LLM / Agent
        </div>
      </div>
      {answerIsJson ? (
        <pre className="relative max-h-80 overflow-auto rounded-[22px] border border-indigo-500/15 bg-white/85 p-4 font-mono text-[13px] leading-6 text-foreground/90 whitespace-pre-wrap [overflow-wrap:anywhere] dark:bg-slate-950/70">
          {formattedAnswer}
        </pre>
      ) : (
        <div className="relative rounded-[22px] border border-indigo-500/15 bg-white/80 p-3 dark:bg-slate-950/60">
          <AssistantMarkdown content={normalizedAnswer} />
        </div>
      )}
    </div>
  );
}

function isQueryAgentToolCall(command?: string, toolName?: string) {
  return Boolean(
    command?.includes('run_git_query_agent.py') || toolName === 'query_agent',
  );
}

function ExecutionTraceCard({
  callBlock,
  resultBlock,
  assistantAnswer,
}: {
  callBlock: Extract<PersistedOntologyAssistantContentBlock, { type: 'tool_call' }>;
  resultBlock?: Extract<PersistedOntologyAssistantContentBlock, { type: 'tool_result' }>;
  assistantAnswer?: string;
}) {
  const [isExpanded, setIsExpanded] = React.useState(true);
  
  const statusMeta = resultBlock
    ? formatToolRunStatus({
        callId: resultBlock.callId,
        command: resultBlock.command,
        status: resultBlock.status,
        stdout: resultBlock.stdout,
        stderr: resultBlock.stderr,
        exitCode: resultBlock.exitCode,
        cwd: resultBlock.cwd,
        durationMs: resultBlock.durationMs,
        truncated: false,
        startedAt: resultBlock.createdAt,
        finishedAt: resultBlock.finishedAt,
      })
    : {
        label: '进行中',
        className: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
        icon: <LoaderCircle className="h-3.5 w-3.5 animate-spin" />,
      };

  const title = getExecutionTraceTitle(callBlock.command || '', callBlock.toolName);
  const timeLabel = callBlock.createdAt ? new Date(callBlock.createdAt).toLocaleTimeString([], { hour12: false }) : '';
  const durationLabel = typeof resultBlock?.durationMs === 'number'
    ? `${(resultBlock.durationMs / 1000).toFixed(2)}s`
    : '';
  const hasStdout = hasVisibleText(resultBlock?.stdout);
  const hasStderr = hasVisibleText(resultBlock?.stderr);
  const answerText = typeof assistantAnswer === 'string' ? assistantAnswer.trim() : '';
  const isRunning = !resultBlock || resultBlock.status === 'running';
  const cardTone =
    resultBlock?.status === 'error'
      ? 'border-rose-200/80 bg-gradient-to-br from-rose-50 via-white to-white dark:border-rose-500/20 dark:from-rose-950/35 dark:via-slate-950 dark:to-rose-950/15'
      : isRunning
        ? 'border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-cyan-50 dark:border-amber-500/20 dark:from-amber-950/30 dark:via-slate-950 dark:to-cyan-950/15'
        : 'border-cyan-200/80 bg-gradient-to-br from-cyan-50 via-white to-indigo-50 dark:border-cyan-500/20 dark:from-slate-950 dark:via-slate-950 dark:to-cyan-950/18';

  return (
    <div className={cn('group relative my-6 overflow-hidden rounded-[30px] border shadow-[0_12px_36px_-18px_rgba(14,165,233,0.4)] backdrop-blur-xl dark:shadow-[0_12px_36px_-18px_rgba(8,145,178,0.3)]', cardTone)}>
      <div className="pointer-events-none absolute inset-0 opacity-90 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.20),transparent_38%),radial-gradient(circle_at_top_right,rgba(99,102,241,0.14),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.10),transparent_30%)]" />
      <div className="pointer-events-none absolute left-0 top-0 h-full w-2 bg-gradient-to-b from-cyan-400 via-blue-500 to-indigo-500" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/80 to-transparent" />

      <button
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
        className="relative flex w-full items-center gap-4 px-5 py-5 text-left transition-colors hover:bg-white/45 dark:hover:bg-slate-950/35"
      >
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] bg-gradient-to-br from-cyan-500 via-blue-500 to-indigo-600 text-white shadow-[0_18px_35px_-14px_rgba(14,165,233,0.95)] ring-1 ring-white/35 dark:ring-white/10">
          <Terminal className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[18px] font-extrabold tracking-[-0.02em] text-slate-950 dark:text-white">
              {title}
            </span>
            {isQueryAgentToolCall(callBlock.command, callBlock.toolName) && (
              <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.22em] text-indigo-700 dark:text-indigo-300">
                AGENT
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground/80">
            {timeLabel && <span>开始 {timeLabel}</span>}
            {durationLabel && <span>· 耗时 {durationLabel}</span>}
            {callBlock.reasoning && <span>· 有 reason</span>}
            {resultBlock?.cwd && <span>· cwd 已记录</span>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-semibold shadow-[0_10px_18px_-12px_rgba(15,23,42,0.25)] ring-1 ring-inset ring-white/25 dark:ring-white/10',
              statusMeta.className,
            )}
          >
            {statusMeta.icon}
            <span>{statusMeta.label}</span>
            {typeof resultBlock?.exitCode === 'number' && (
              <span className="font-mono opacity-80">exit {resultBlock.exitCode}</span>
            )}
            {typeof resultBlock?.durationMs === 'number' && (
              <span className="font-mono opacity-80">{(resultBlock.durationMs / 1000).toFixed(2)}s</span>
            )}
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-cyan-500/15 bg-white/70 text-cyan-700 shadow-sm transition-colors group-hover:bg-white dark:bg-slate-950/45 dark:text-cyan-300">
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="relative border-t border-cyan-500/10 px-5 pb-5 pt-4 lg:px-6 lg:pb-6 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="space-y-6">
            {/* 上部分：命令区 (固定高度滚动) */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-600 dark:text-cyan-300">
                <ArrowUp className="h-3.5 w-3.5" />
                执行命令
              </div>
              <div className="max-h-[160px] overflow-auto rounded-[20px] bg-slate-950 px-4 py-3 shadow-inner custom-scrollbar">
                <div className="font-mono text-[12px] leading-6 text-slate-100 [overflow-wrap:anywhere]">
                  {callBlock.command || '等待工具参数...'}
                </div>
              </div>
            </div>

            {/* 中部分：Reason (如果有) */}
            {hasVisibleText(callBlock.reasoning) && (
              <div className="rounded-[22px] border border-amber-500/20 bg-amber-500/[0.06] p-4 text-[12px] leading-6 text-foreground/85">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-amber-600 dark:text-amber-300">
                  <Sparkles className="h-3.5 w-3.5" />
                  执行原因 (REASON)
                </div>
                {callBlock.reasoning}
              </div>
            )}

            {/* 下部分：回执与输出 (固定高度滚动) */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-emerald-600 dark:text-emerald-400">
                <ArrowDown className="h-3.5 w-3.5" />
                执行回执与输出
              </div>
              
              {resultBlock ? (
                <div className="max-h-[380px] overflow-auto space-y-4 rounded-[24px] border border-slate-200/80 bg-white/60 p-4 dark:border-slate-800/80 dark:bg-slate-950/45 custom-scrollbar">
                  {/* 状态统计小条 */}
                  <div className="flex flex-wrap items-center gap-4 border-b border-border/20 pb-3">
                    <div className="text-[11px] font-bold text-muted-foreground/70 uppercase tracking-tighter">Status: {statusMeta.label}</div>
                    <div className="text-[11px] font-bold text-muted-foreground/70 uppercase tracking-tighter">Exit: {resultBlock.exitCode ?? 'N/A'}</div>
                    <div className="text-[11px] font-bold text-muted-foreground/70 uppercase tracking-tighter">Time: {typeof resultBlock.durationMs === 'number' ? `${(resultBlock.durationMs / 1000).toFixed(2)}s` : 'N/A'}</div>
                  </div>

                  {hasStdout && <ToolOutputBlock label="stdout" content={resultBlock.stdout} tone="default" />}
                  {hasStderr && <ToolOutputBlock label="stderr" content={resultBlock.stderr} tone="danger" />}
                  {!hasStdout && !hasStderr && (
                    <div className="py-4 text-center text-xs text-muted-foreground italic">本次执行无标准输出。</div>
                  )}
                </div>
              ) : (
                <div className="rounded-[24px] border border-dashed border-cyan-500/20 bg-cyan-500/[0.05] p-8 text-center text-sm text-muted-foreground italic">
                  正在等待工具返回回执内容...
                </div>
              )}
            </div>

            {/* 智能回复面板 (如果有且已完成) */}
            {answerText && resultBlock && (
              <CliAnswerPanel answer={answerText} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function QAgentSuperCard({
  callBlock,
  resultBlock,
  assistantAnswer,
}: {
  callBlock: Extract<PersistedOntologyAssistantContentBlock, { type: 'tool_call' }>;
  resultBlock?: Extract<PersistedOntologyAssistantContentBlock, { type: 'tool_result' }>;
  assistantAnswer?: string;
}) {
  const [isExpanded, setIsExpanded] = React.useState(true);

  // 提取查询内容：从 --query '内容' 中提取出内容
  const extractQuery = (cmd: string) => {
    const match = cmd.match(/--query\s+['"](.+?)['"]/);
    return match ? match[1] : cmd;
  };

  const queryText = extractQuery(callBlock.command || '');
  const isError = resultBlock?.status === 'error' || Boolean(resultBlock?.stderr);
  const answerText = typeof assistantAnswer === 'string' ? assistantAnswer.trim() : '';

  return (
    <div className="group relative my-6 max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="relative flex flex-col bg-slate-100 dark:bg-zinc-900 rounded-[20px] border-2 border-slate-400/60 dark:border-zinc-700 shadow-2xl overflow-hidden">
        {/* 左侧状态色轴 */}
        <div className={cn(
          "absolute left-0 top-0 bottom-0 w-1.5 z-10",
          resultBlock ? (isError ? "bg-red-500" : "bg-emerald-500") : "bg-amber-500 animate-pulse"
        )} />
        
        {/* Header: 点击此处切换展开/折叠 */}
        <div 
          className="flex items-center justify-between px-6 py-4 pl-8 bg-slate-300/70 dark:bg-black/40 border-b-2 border-slate-400/40 dark:border-zinc-700 cursor-pointer hover:bg-slate-300 dark:hover:bg-black/60 transition-all"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-indigo-500 shadow-md">
              <Terminal className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.15em] text-indigo-600 dark:text-indigo-400">Query Agent</div>
              <div className="text-[13px] font-bold text-foreground/90 leading-none">
                {queryText.length > 30 ? `${queryText.slice(0, 30)}...` : queryText}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={cn(
              "px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1",
              resultBlock ? (isError ? "bg-red-500/10 text-red-600" : "bg-emerald-500/10 text-emerald-600") : "bg-amber-500/10 text-amber-600 animate-pulse"
            )}>
              {resultBlock ? (isError ? "Error" : "Success") : "Running"}
            </div>
            <div className="text-muted-foreground/40">
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </div>
        </div>

        {/* Body: 仅在展开时显示 */}
        {isExpanded && (
          <div className="animate-in slide-in-from-top-2 duration-300">
            {/* 内容 */}
            <div className="p-5 space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">
                  <ArrowUp className="w-3 h-3 text-emerald-500" />
                  Full Command
                </div>
                <div className="max-h-[140px] overflow-auto rounded-xl bg-zinc-950/5 dark:bg-black/40 p-3 border border-border/20 custom-scrollbar">
                  <div className="font-mono text-[11px] text-zinc-500 break-all leading-relaxed whitespace-pre-wrap">
                    <span className="text-zinc-600 mr-2 select-none font-bold">CMD {'>'}</span>
                    {callBlock.command}
                  </div>
                </div>
              </div>

              <div className="relative h-px w-full bg-border/20" />

              <div className={cn(
                "space-y-2 transition-all",
                !resultBlock && "opacity-40"
              )}>
                <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">
                  <ArrowDown className="w-3 h-3 text-indigo-500" />
                  Execution Result
                </div>

                {resultBlock ? (
                  <div className="max-h-[300px] overflow-auto space-y-3 rounded-xl border border-indigo-500/10 bg-indigo-500/[0.02] p-3 custom-scrollbar">
                    {resultBlock.stderr && (
                      <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-2 text-[11px] font-mono text-red-600">
                        {resultBlock.stderr}
                      </div>
                    )}
                    {resultBlock.stdout ? (
                      <pre className="text-[12px] font-mono leading-relaxed text-foreground/80 whitespace-pre-wrap">
                        {resultBlock.stdout}
                      </pre>
                    ) : (
                      <div className="text-[12px] text-muted-foreground italic">No output.</div>
                    )}
              </div>
            ) : (
              <div className="flex items-center gap-3 py-4 text-muted-foreground justify-center">
                    <LoaderCircle className="w-4 h-4 animate-spin text-indigo-500" />
                    <span className="text-xs italic">Executing...</span>
                  </div>
                )}
              </div>
            </div>

            {answerText && resultBlock && (
              <div className="px-5 pb-4">
                <CliAnswerPanel answer={answerText} />
              </div>
            )}
            
            {/* Footer */}
            <div className="px-5 py-2 bg-zinc-50/50 dark:bg-zinc-900/30 flex items-center justify-between border-t border-border/10">
              <span className="text-[9px] font-mono text-zinc-400">
                {callBlock.createdAt ? new Date(callBlock.createdAt).toLocaleString() : ''}
              </span>
              {resultBlock && (
                <span className="text-[9px] font-mono text-zinc-400">
                  {resultBlock.callId?.slice(-8).toUpperCase()}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function MessageContentBlocks({
  blocks,
  answer,
}: {
  blocks: PersistedOntologyAssistantContentBlock[];
  answer?: string;
}) {
  if (blocks.length === 0) {
    return null;
  }

  const processedGroups = groupAssistantContentBlocks(blocks);

  return (
    <div className="space-y-3">
      {processedGroups.map((group, idx) => {
        const key = `group-${idx}`;
        switch (group.type) {
          case 'assistant':
            if (!hasVisibleText(group.block.content)) return null;
            return (
              <div key={key} className="group/msg flex flex-col items-start">
                <div className="flex-1 min-w-0 w-full text-foreground/90">
                  <AssistantMarkdown content={group.block.content} />
                </div>
                {group.block.phase === 'completed' && (
                  <div className="mt-1 animate-in fade-in duration-500">
                    <MessageCopyButton content={group.block.content} />
                  </div>
                )}
              </div>
            );
          case 'paired_execution':
            if (isQueryAgentToolCall(group.callBlock.command, group.callBlock.toolName)) {
              return (
                <QAgentSuperCard
                  key={key}
                  callBlock={group.callBlock}
                  resultBlock={group.resultBlock}
                  assistantAnswer={answer}
                />
              );
            }
            if (getExecutionTraceKind(group.callBlock.command, group.callBlock.toolName) === 'cli') {
              return (
                <ExecutionTraceCard
                  key={key}
                  callBlock={group.callBlock}
                  resultBlock={group.resultBlock}
                  assistantAnswer={answer}
                />
              );
            }
            return (
              <PlainExecutionCard
                key={key}
                callBlock={group.callBlock}
                resultBlock={group.resultBlock}
                assistantAnswer={answer}
              />
            );
          case 'standalone_call':
            if (getExecutionTraceKind(group.block.command, group.block.toolName) === 'cli') {
              return <ExecutionTraceCard key={key} callBlock={group.block} />;
            }
            return <ToolCallBlock key={key} block={group.block} />;
          case 'standalone_result':
            return <ToolResultBlock key={key} block={group.block} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

function MessageCopyButton({ content }: { content: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    await copyCodeToClipboard(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "opacity-0 group-hover/msg:opacity-100 transition-all p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground",
        copied && "opacity-100 text-green-500"
      )}
      title={copied ? "已复制" : "复制"}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export function ChatArea({
  activeSession,
  onAsk,
  onStop,
  onDraftChange,
  onUploadFile,
  isBusy,
  renderSettings,
  renderExtraActions
}: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showScrollButton, setShowScrollButton] = React.useState(false);
  const { messages, draftQuestion, loading, error, statusMessage } = activeSession;
  const lastMessage = messages[messages.length - 1];

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      // Show button if we are more than one viewport away from bottom
      const isScrolledUp = scrollHeight - scrollTop - clientHeight > clientHeight;
      setShowScrollButton(isScrolledUp);
    }
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  };

  // Auto-scroll logic
  useEffect(() => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 150;
      const isInitial = messages.length > 0 && scrollTop === 0;

      if (isNearBottom || isInitial) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }
  }, [messages, loading, statusMessage]);

  // Auto-resize logic
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const newHeight = Math.min(textarea.scrollHeight, 200);
      textarea.style.height = `${newHeight}px`;
    }
  }, [draftQuestion]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isBusy) {
      e.preventDefault();
      onAsk();
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      await onUploadFile(file);
    } finally {
      event.target.value = '';
    }
  };

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground">
      {/* Floating Header for Settings/Flow Toggle */}
      <div className="absolute top-0 left-0 right-0 z-20 h-14 flex items-center justify-between px-6 pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          {renderSettings?.()}
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          {renderExtraActions?.()}
        </div>
      </div>

      {/* Messages Area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scroll-smooth"
      >
        <div className="flex min-h-full flex-col justify-end">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4 my-auto">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <Sparkles className="w-7 h-7" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-foreground/90">有什么可以帮你的？</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  可以询问关于本体知识库中任何概念、定义或关系的问题
                </p>
              </div>
            </div>
          )}

          <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 pt-16 pb-[55vh]">
            {messages.map((message: any, index: number) => {
              const prevMessage = index > 0 ? messages[index - 1] : null;
              const nextMessage = index < messages.length - 1 ? messages[index + 1] : null;
              const contentBlocks = Array.isArray(message.contentBlocks) ? message.contentBlocks : [];
              const toolRuns = Array.isArray(message.toolRuns) ? message.toolRuns : [];
              const hasAssistantAnswer = hasVisibleText(message.answer);
              const hasContentBlocks = contentBlocks.length > 0;
              const hasAssistantContent = hasContentBlocks || hasAssistantAnswer || toolRuns.length > 0;

              const isUserFollowUp = prevMessage && !prevMessage.answer;
              const hasConsecutiveUser = nextMessage && !message.answer;

              return (
                <React.Fragment key={message.id}>
                  {/* User Message */}
                  <div className={cn(
                    "group/msg flex flex-col items-end",
                    isUserFollowUp ? "mt-3" : (index === 0 ? "mt-0" : "mt-10")
                  )}>
                    <div className="bg-muted/50 dark:bg-muted/40 rounded-3xl px-5 py-3.5 text-[17px] leading-[1.6] text-foreground break-words [overflow-wrap:anywhere] max-w-[85%] border border-border/20 shadow-sm transition-colors">
                      {message.question}
                    </div>
                    {!hasConsecutiveUser && (
                      <div className="mt-1 px-1">
                        <MessageCopyButton content={message.question} />
                      </div>
                    )}
                  </div>

                  {/* Agent Message — Show answer and inline tool trace for the same round */}
                  {hasAssistantContent && (
                    <div className="group/msg flex flex-col items-start px-1 mt-8 transition-all">
                      <div className="flex-1 min-w-0 w-full text-foreground/90">
                        {hasContentBlocks ? (
                          <MessageContentBlocks blocks={contentBlocks} answer={message.answer} />
                        ) : (
                          <ToolRunDetails toolRuns={toolRuns} />
                        )}
                        {!hasContentBlocks && hasAssistantAnswer && (
                          <AssistantMarkdown content={message.answer} />
                        )}
                      </div>
                      {!hasContentBlocks && hasAssistantAnswer && (!loading || index < messages.length - 1) && (
                        <div className="mt-1 animate-in fade-in duration-500">
                          <MessageCopyButton content={message.answer} />
                        </div>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}

            {/* Status & Typing Indicator (GPT style pulsing dot) */}
            {loading && (statusMessage || (lastMessage && !lastMessage?.answer)) && (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 mt-6">
                <div className="flex items-center gap-2.5 px-1">
                  <div className="w-5 h-5 flex items-center justify-center">
                    <div className="w-2 bg-foreground rounded-full h-2 animate-pulse" />
                  </div>
                  {statusMessage && (
                    <span className="text-sm font-medium text-muted-foreground">{statusMessage}</span>
                  )}
                </div>
              </div>
            )}

            {/* Error state */}
            {error && (
              <div className="flex items-center gap-3 p-4 rounded-xl border border-red-100 dark:border-red-900/30 bg-red-50/50 dark:bg-red-900/10 text-red-600 dark:text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="break-words [overflow-wrap:anywhere] font-medium">{error}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 pointer-events-none">
        {/* Scroll to Bottom Button */}
        <div className="absolute bottom-[190px] left-1/2 -translate-x-1/2 z-30 flex justify-center pointer-events-auto">
          <Button
            size="icon"
            variant="outline"
            onClick={scrollToBottom}
            className={cn(
              "w-10 h-10 rounded-full bg-background/80 backdrop-blur-md border border-border shadow-xl transition-all duration-300 transform",
              showScrollButton ? "translate-y-0 opacity-100 scale-100" : "translate-y-4 opacity-0 scale-90"
            )}
          >
            <ArrowDown className="w-4 h-4 text-muted-foreground" />
          </Button>
        </div>

        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background via-background/80 to-transparent z-10" />
        <div className="relative w-full max-w-3xl mx-auto px-4 sm:px-6 pb-6 pt-0 text-center z-20">
          <div className="relative flex flex-col bg-background/95 backdrop-blur-xl rounded-[28px] border border-border p-1.5 shadow-2xl pointer-events-auto transition-all">
            {/* Input Row */}
            <div className="flex-1 w-full px-2">
              <Textarea
                ref={textareaRef}
                placeholder="有问必答..."
                value={draftQuestion}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full min-h-[32px] max-h-[200px] px-2 pt-2.5 pb-1 resize-none border-none bg-transparent dark:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-[17px] leading-[1.6] text-foreground placeholder:text-muted-foreground/50 shadow-none outline-none"
              />
            </div>

            {/* Toolbar Row */}
            <div className="flex items-center justify-end px-1">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(event) => {
                    void handleFileChange(event);
                  }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-10 h-10 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                  title="上传文件到当前会话 runtime"
                >
                  <Paperclip className="w-4 h-4" />
                </Button>
                <Button
                  size="icon"
                  onClick={() => (loading ? onStop() : onAsk())}
                  disabled={(!loading && !draftQuestion.trim()) || isBusy && !loading}
                  className={cn(
                    "w-10 h-10 rounded-full transition-all active:scale-95 shadow-md",
                    loading
                      ? "bg-muted text-foreground hover:bg-muted/80"
                      : "bg-foreground hover:bg-foreground/90 text-background"
                  )}
                >
                  {loading ? <Square className="w-4 h-4 fill-slate-900" /> : <ArrowUp className="w-5 h-5" />}
                </Button>
              </div>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground/60 italic tracking-wider">
            ENTER 发送 · SHIFT+ENTER 换行
          </div>
        </div>
      </div>
    </div>
  );
}
