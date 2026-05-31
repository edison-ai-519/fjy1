import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Activity,
  Blocks,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  Copy,
  FileJson,
  FileSearch,
  Gavel,
  GitBranchPlus,
  Loader2,
  Play,
  RefreshCcw,
  Route,
  ScissorsLineDashed,
  Settings2,
  Square,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import { copyCodeToClipboard } from '@/components/assistant/AssistantMarkdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  activateWorkflowV2Session,
  getAllWorkflowV2Sessions,
  getLatestWorkflowV2Session,
  getWorkflowV2Session,
  removeWorkflowV2Session,
  retryWorkflowV2RunFromStage,
  startWorkflowV2Run,
  subscribeWorkflowV2Session,
  subscribeWorkflowV2Sessions,
  terminateWorkflowV2Run,
  type WorkflowV2RunSession,
} from '@/features/workflow/runtimeV2';
import {
  fetchWorkflowV2Config,
  fetchXgProjects,
  updateWorkflowV2Config,
  writeWorkflowV2SessionToOntoGit,
  type WorkflowV2Config,
  type WorkflowV2WritebackResponse,
  type XgProject,
} from '@/features/workspace/api';
import {
  getStoredSelectedProjectId,
  setStoredSelectedProjectId,
  subscribeSelectedProjectIdChange,
} from '@/features/workspace/selectedProject';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { WORKFLOW_V2_STAGE_DEFINITIONS } from '../../shared/workflowV2Stages.js';
import {
  buildWorkflowV2GraphLayout,
  buildWorkflowV2GraphLayoutFromStageData,
  buildWorkflowV2Mermaid,
  buildWorkflowV2MermaidFromStageData,
  buildWorkflowV2SystemDecompositionView,
  canWriteWorkflowV2Session,
  extractWorkflowV2SiblingImpactEdges,
  extractWorkflowV2Summary,
  extractWorkflowV2WritebackSummary,
  getWorkflowV2ImpactEdgeStyle,
} from './fileWorkflowV2View';
import { extractWorkflowEnsembleView } from './fileWorkflowEnsemble';
import { WorkflowV2SystemDecompositionPanel } from './WorkflowV2SystemDecompositionPanel';

const STAGE_ICONS: Record<string, ReactNode> = {
  chunk_parse: <ScissorsLineDashed className="h-4 w-4" />,
  window_extract: <FileSearch className="h-4 w-4" />,
  object_fusion: <Blocks className="h-4 w-4" />,
  function_analysis: <BrainCircuit className="h-4 w-4" />,
  object_decompose: <GitBranchPlus className="h-4 w-4" />,
  graph_build: <Route className="h-4 w-4" />,
  ablation_analysis: <Activity className="h-4 w-4" />,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function statusClass(status: string) {
  if (status === 'success') return 'border-emerald-500/30 bg-emerald-500/10';
  if (status === 'failed') return 'border-red-500/30 bg-red-500/10';
  if (status === 'running') return 'border-sky-500/30 bg-sky-500/10';
  return 'border-border/60 bg-muted/20';
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function asCount(value: unknown, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? Math.floor(next) : fallback;
}

function streamStatusLabel(status: string | null | undefined) {
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'streaming') return '生成中';
  return '等待中';
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '未返回';
  }
  return `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`;
}

function getSessionStatusMeta(session: WorkflowV2RunSession | null, failedStages: number) {
  if (session?.isRunning) {
    return {
      label: '运行中',
      badgeClass: 'border-sky-500/30 bg-sky-500/10 text-sky-700',
      description: '工作流正在持续产出阶段结果',
    };
  }

  if (failedStages > 0) {
    return {
      label: '有失败',
      badgeClass: 'border-red-500/30 bg-red-500/10 text-red-700',
      description: '至少有一个阶段执行失败，可从时间线重试',
    };
  }

  if (session?.runResult) {
    return {
      label: '已完成',
      badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
      description: '当前会话已有可阅读结果，可继续写回 OntoGit',
    };
  }

  return {
    label: '待启动',
    badgeClass: 'border-border/60 bg-muted/30 text-muted-foreground',
    description: '先选择项目与文件，再启动一次完整 V2 流程',
  };
}

function WorkflowTrioPane({
  title,
  modelName,
  status,
  accent,
  data,
  rawText,
}: {
  title: string;
  modelName: string;
  status: string;
  accent: string;
  data: unknown;
  rawText: string;
}) {
  return (
    <div className={cn('min-w-0 overflow-hidden rounded-2xl border bg-background/85', accent)}>
      <div className="flex items-start justify-between gap-3 border-b border-border/50 bg-muted/20 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
          <div className="mt-1 break-all text-sm font-black">{modelName || title}</div>
        </div>
        <Badge variant="outline" className="rounded-full">{streamStatusLabel(status)}</Badge>
      </div>
      <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-all bg-slate-950/95 p-4 text-xs leading-6 text-slate-100">
        {data !== null && data !== undefined ? formatJson(data) : (rawText || '暂无数据')}
      </pre>
    </div>
  );
}

function WorkflowTrioPreview({
  title,
  ensemble,
  summary,
}: {
  title: string;
  ensemble: unknown;
  summary?: string;
}) {
  const view = extractWorkflowEnsembleView(ensemble);
  if (!view) {
    return null;
  }

  const detailContent = (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {view.modelA ? (
          <WorkflowTrioPane
            title="模型 A"
            modelName={view.modelA.modelName}
            status={view.modelA.status}
            accent="border-sky-500/20"
            data={view.modelA.data}
            rawText={view.modelA.rawText}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-4 text-sm text-muted-foreground">模型 A 暂无结果。</div>
        )}
        {view.modelB ? (
          <WorkflowTrioPane
            title="模型 B"
            modelName={view.modelB.modelName}
            status={view.modelB.status}
            accent="border-violet-500/20"
            data={view.modelB.data}
            rawText={view.modelB.rawText}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-4 text-sm text-muted-foreground">模型 B 暂无结果。</div>
        )}
        {view.judgeResult ? (
          <WorkflowTrioPane
            title="Judge"
            modelName={view.judgeResult.modelName}
            status={view.judgeResult.status}
            accent="border-amber-500/20"
            data={view.judgeResult.data}
            rawText={view.judgeResult.rawText}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-amber-500/20 bg-amber-500/5 p-4 text-sm text-muted-foreground">
            {view.conflictCount === 0 ? '这一轮没有冲突，shared 直接收敛，没有触发 judge。' : 'Judge 结果暂未返回。'}
          </div>
        )}
      </div>

      {view.rounds.length > 0 ? (
        <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
          <div className="flex items-center gap-2 text-sm font-black">
            <Bot className="h-4 w-4 text-primary" />
            互评轮次
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {view.rounds.map((round, index) => (
              <div key={`${round.reviewerModelKey}-${round.round}-${index}`} className="rounded-2xl border border-border/60 bg-muted/15 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-black">第 {round.round || index + 1} 轮 · {round.reviewerModel || round.reviewerModelKey}</div>
                  <Badge variant="outline" className="rounded-full">{streamStatusLabel(round.status)}</Badge>
                </div>
                <div className="mt-2 text-xs leading-5 text-muted-foreground">{round.roundSummary || '该轮未提供摘要。'}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {view.finalResult ? (
        <div className="min-w-0 overflow-hidden rounded-2xl border border-emerald-500/20 bg-emerald-500/5">
          <div className="flex items-center justify-between gap-3 border-b border-emerald-500/15 bg-emerald-500/10 px-4 py-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-800/80">Final</div>
              <div className="mt-1 text-sm font-black">最终保留结果</div>
            </div>
            <Badge variant="outline" className="rounded-full">{view.finalResult.source || 'final'}</Badge>
          </div>
          <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-all bg-slate-950/95 p-4 text-xs leading-6 text-slate-100">
            {view.finalResult.data !== null && view.finalResult.data !== undefined
              ? formatJson(view.finalResult.data)
              : (view.finalResult.rawText || '暂无数据')}
          </pre>
        </div>
      ) : null}
    </div>
  );

  return (
    <Dialog>
      <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary/80">A / B / Judge</div>
            <div className="mt-1 text-sm font-black">{title}</div>
            {summary ? (
              <div className="mt-1 text-xs leading-5 text-muted-foreground">{summary}</div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-full">Shared {view.sharedCount}</Badge>
            <Badge variant="outline" className="rounded-full">Conflict {view.conflictCount}</Badge>
            <Badge variant="outline" className="rounded-full">Rounds {view.rounds.length}</Badge>
            <Badge variant="secondary" className="rounded-full">{view.judgeResult ? 'Judge 已输出' : 'Judge 未触发/未完成'}</Badge>
            <DialogTrigger asChild>
              <Button type="button" size="sm" className="rounded-full">
                查看过程
              </Button>
            </DialogTrigger>
          </div>
        </div>
      </div>
      <DialogContent className="grid h-[min(90vh,960px)] w-[min(96vw,1400px)] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-[28px] border-border/60 bg-background/95 p-0 shadow-2xl">
        <DialogHeader className="border-b border-border/50 px-6 py-5">
          <DialogTitle className="text-2xl font-black tracking-tight">{title}</DialogTitle>
          <DialogDescription className="text-sm leading-6">
            {summary || '在这里查看该步骤的模型 A、模型 B、judge、互评轮次与最终保留结果。'}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1 px-6 py-5">
          <div className="pb-1">
            {detailContent}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function CitationPreview({ citation }: { citation: string }) {
  if (!citation) {
    return null;
  }
  return (
    <div className="mt-2 rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700/80">Citation</div>
      <div className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-foreground/85">{citation}</div>
    </div>
  );
}

function canRetryWorkflowV2Stage(session: WorkflowV2RunSession | null, stageKey: string, retryable: boolean) {
  if (!session || session.isRunning || !retryable) {
    return false;
  }
  const runResult = session.runResult;
  if (!runResult) {
    return false;
  }
  const targetIndex = WORKFLOW_V2_STAGE_DEFINITIONS.findIndex((stage) => stage.key === stageKey);
  if (targetIndex === -1) {
    return false;
  }
  const targetStage = runResult.stage_results.find((stage) => stage.stage === stageKey);
  if (!targetStage || !['success', 'failed'].includes(targetStage.status)) {
    return false;
  }
  for (let index = 0; index < targetIndex; index += 1) {
    const previousStage = runResult.stage_results.find((stage) => stage.stage === WORKFLOW_V2_STAGE_DEFINITIONS[index]?.key);
    if (!previousStage || previousStage.status !== 'success') {
      return false;
    }
  }
  return true;
}

function SectionCard({
  title,
  description,
  children,
  className,
  action,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className={cn('rounded-3xl border-border/60 bg-background/85 shadow-sm', className)}>
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg font-black tracking-tight">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function MetricCard({
  title,
  value,
  hint,
  accent,
}: {
  title: string;
  value: ReactNode;
  hint: string;
  accent?: string;
}) {
  return (
    <Card className={cn('rounded-[28px] border-border/60 bg-background/90 shadow-sm', accent)}>
      <CardContent className="p-5">
        <div className="text-[11px] font-black uppercase tracking-[0.24em] text-muted-foreground">{title}</div>
        <div className="mt-3 text-3xl font-black tracking-tight text-foreground">{value}</div>
        <div className="mt-2 text-xs leading-5 text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

type WorkflowV2ViewMode = 'overview' | 'analysis' | 'debug';

export function FileWorkflowV2Page() {
  const [projects, setProjects] = useState<XgProject[]>([]);
  const [selectedProjectId, setSelectedProjectIdState] = useState(() => getStoredSelectedProjectId() || 'demo');
  const [session, setSession] = useState<WorkflowV2RunSession | null>(null);
  const [sessions, setSessions] = useState<WorkflowV2RunSession[]>(() => getAllWorkflowV2Sessions());
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [config, setConfig] = useState<WorkflowV2Config>({
    workflowModel: 'deepseek/deepseek-v4-flash',
    workflowModelA: 'deepseek/deepseek-v4-flash',
    workflowModelB: 'deepseek/deepseek-v4-flash',
    workflowJudgeModel: 'deepseek/deepseek-v4-flash',
    chunkMaxChars: 600,
    chunkMinChars: 80,
    windowSize: 5,
    windowStep: 2,
    parallelWindows: 4,
  });
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configDirty, setConfigDirty] = useState(false);
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false);
  const [activeView, setActiveView] = useState<WorkflowV2ViewMode>('overview');
  const [hideIsolatedNodes, setHideIsolatedNodes] = useState(true);
  const [graphZoom, setGraphZoom] = useState(1);
  const [mermaidCopied, setMermaidCopied] = useState(false);
  const [writing, setWriting] = useState(false);
  const [writebackPayload, setWritebackPayload] = useState<WorkflowV2WritebackResponse | null>(null);
  const [writebackError, setWritebackError] = useState('');
  const configDirtyRef = useRef(false);

  useEffect(() => {
    configDirtyRef.current = configDirty;
  }, [configDirty]);

  const markConfigDirty = () => {
    configDirtyRef.current = true;
    setConfigDirty(true);
  };

  useEffect(() => {
    void fetchXgProjects()
      .then((items) => {
        setProjects(items);
        if (!selectedProjectId && items[0]?.id) {
          setSelectedProjectIdState(items[0].id);
        }
      })
      .catch(() => {});
  }, [selectedProjectId]);

  useEffect(() => {
    const unsubscribeSessionList = subscribeWorkflowV2Sessions(setSessions);
    const unsubscribeProject = subscribeSelectedProjectIdChange((projectId) => {
      if (projectId) {
        setSelectedProjectIdState(projectId);
      }
    });
    return () => {
      unsubscribeSessionList();
      unsubscribeProject();
    };
  }, []);

  const activeConversationId = session?.conversationId ?? '';
  useEffect(() => {
    if (!activeConversationId) return undefined;
    return subscribeWorkflowV2Session(activeConversationId, setSession);
  }, [activeConversationId]);

  useEffect(() => {
    if (!session) {
      return;
    }
    if (!sessions.some((item) => item.conversationId === session.conversationId)) {
      setSession(null);
    }
  }, [session, sessions]);

  useEffect(() => {
    let cancelled = false;

    const loadConfig = async () => {
      setConfigLoading(true);
      try {
        const next = await fetchWorkflowV2Config();
        if (cancelled || configDirtyRef.current) {
          return;
        }
        const primaryModel = next.workflowModelA || next.workflowModel || 'deepseek/deepseek-v4-flash';
        setConfig({
          ...next,
          workflowModel: next.workflowModel || primaryModel,
          workflowModelA: primaryModel,
          workflowModelB: next.workflowModelB || primaryModel,
          workflowJudgeModel: next.workflowJudgeModel || primaryModel,
        });
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : '读取 V2 配置失败');
        }
      } finally {
        if (!cancelled) {
          setConfigLoading(false);
        }
      }
    };

    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setActiveView('overview');
    setWritebackPayload(null);
    setWritebackError('');
  }, [session?.conversationId]);

  const stageResults = session?.runResult?.stage_results ?? [];
  const totalStages = WORKFLOW_V2_STAGE_DEFINITIONS.length;
  const completedStages = stageResults.filter((item) => item.status === 'success').length;
  const failedStages = stageResults.filter((item) => item.status === 'failed').length;
  const activeStage = stageResults.find((item) => item.status === 'running') ?? null;
  const latestFinishedStage = [...stageResults].reverse().find((item) => item.status === 'success' || item.status === 'failed') ?? null;
  const startedStages = stageResults.filter((item) => item.status === 'running' || item.status === 'success' || item.status === 'failed').length;
  const rawProgressValue = totalStages > 0
    ? Math.round((((completedStages + (activeStage ? 0.5 : 0)) / totalStages) * 100))
    : 0;
  const progressValue = Math.max(0, Math.min(100, rawProgressValue));
  const activeStageMeta = activeStage
    ? WORKFLOW_V2_STAGE_DEFINITIONS.find((item) => item.key === activeStage.stage) ?? null
    : null;
  const latestStageMeta = latestFinishedStage
    ? WORKFLOW_V2_STAGE_DEFINITIONS.find((item) => item.key === latestFinishedStage.stage) ?? null
    : null;
  const result = session?.runResult?.result ?? null;
  const summary = extractWorkflowV2Summary(result);

  const chunkOutput = asRecord(stageResults.find((item) => item.stage === 'chunk_parse')?.output);
  const windowOutput = asRecord(stageResults.find((item) => item.stage === 'window_extract')?.output);
  const fusionOutput = asRecord(stageResults.find((item) => item.stage === 'object_fusion')?.output);
  const functionOutput = asRecord(stageResults.find((item) => item.stage === 'function_analysis')?.output);
  const decomposeOutput = asRecord(stageResults.find((item) => item.stage === 'object_decompose')?.output);
  const graphOutput = asRecord(stageResults.find((item) => item.stage === 'graph_build')?.output);
  const ablationOutput = asRecord(stageResults.find((item) => item.stage === 'ablation_analysis')?.output);
  const chunkItems = Array.isArray(chunkOutput.chunks) ? chunkOutput.chunks : [];
  const windowItems = Array.isArray(windowOutput.window_results) ? windowOutput.window_results : [];
  const fusionJudgeItems = Array.isArray(fusionOutput.judge_results) ? fusionOutput.judge_results : [];
  const fusedObjectItems = Array.isArray(functionOutput.function_objects) && functionOutput.function_objects.length > 0
    ? functionOutput.function_objects
    : (Array.isArray(fusionOutput.fused_objects) ? fusionOutput.fused_objects : []);
  const decompositionGroups = Array.isArray(decomposeOutput.decomposition_results) ? decomposeOutput.decomposition_results : [];
  const failedObjectItems = Array.isArray(decomposeOutput.failed_objects) ? decomposeOutput.failed_objects : [];
  const removedCycleEdgeItems = Array.isArray(graphOutput.removed_cycle_edges) ? graphOutput.removed_cycle_edges : [];
  const ablationItems = Array.isArray(ablationOutput.parent_summaries) ? ablationOutput.parent_summaries : [];
  const shownDecompositionCount = decompositionGroups.reduce((sum, group) => {
    const record = asRecord(group);
    return sum + (Array.isArray(record.decompositions) ? record.decompositions.length : 0);
  }, 0);
  const stageGraphObjects = Array.isArray(functionOutput.function_objects) && functionOutput.function_objects.length > 0
    ? functionOutput.function_objects
    : (Array.isArray(fusionOutput.fused_objects) ? fusionOutput.fused_objects : []);
  const stageGraphEdges = Array.isArray(graphOutput.edges) ? graphOutput.edges : [];
  const prefersStageGraphData = stageGraphObjects.length > 0
    && (stageGraphEdges.length > 0 || stageResults.some((item) => item.stage === 'graph_build' && item.status === 'success'));

  const graphLayout = useMemo(() => {
    if (prefersStageGraphData) {
      return buildWorkflowV2GraphLayoutFromStageData({
        objects: stageGraphObjects,
        edges: stageGraphEdges,
        options: { hideIsolatedNodes },
      });
    }
    return buildWorkflowV2GraphLayout(result, { hideIsolatedNodes });
  }, [hideIsolatedNodes, prefersStageGraphData, result, stageGraphEdges, stageGraphObjects]);

  const mermaidCode = useMemo(() => {
    if (prefersStageGraphData) {
      return buildWorkflowV2MermaidFromStageData({
        objects: stageGraphObjects,
        edges: stageGraphEdges,
        options: { hideIsolatedNodes },
      });
    }
    return buildWorkflowV2Mermaid(result, { hideIsolatedNodes });
  }, [hideIsolatedNodes, prefersStageGraphData, result, stageGraphEdges, stageGraphObjects]);
  const systemDecompositionView = useMemo(() => (
    buildWorkflowV2SystemDecompositionView({
      objects: prefersStageGraphData ? stageGraphObjects : result?.objects,
      edges: prefersStageGraphData ? stageGraphEdges : result?.edges,
      maxDepth: 2,
    })
  ), [prefersStageGraphData, result?.edges, result?.objects, stageGraphEdges, stageGraphObjects]);

  const windowProgressRecord = asRecord(windowOutput.progress);
  const decomposeProgressRecord = asRecord(decomposeOutput.progress);
  const ablationProgressRecord = asRecord(ablationOutput.progress);
  const windowExtractProgress = session?.windowExtractProgress ?? (
    typeof windowProgressRecord.completed === 'number' && typeof windowProgressRecord.total === 'number'
      ? {
        completed: windowProgressRecord.completed,
        total: windowProgressRecord.total,
        parallel: typeof windowProgressRecord.parallel === 'number' ? windowProgressRecord.parallel : 1,
        lastWindowId: null,
      }
      : null
  );
  const objectDecomposeProgress = session?.objectDecomposeProgress ?? (
    typeof decomposeProgressRecord.completed === 'number' && typeof decomposeProgressRecord.total === 'number'
      ? {
        completed: decomposeProgressRecord.completed,
        total: decomposeProgressRecord.total,
        failed: typeof decomposeProgressRecord.failed === 'number' ? decomposeProgressRecord.failed : 0,
        lastObjectName: null,
        lastFailedObjectName: null,
      }
      : null
  );
  const ablationAnalysisProgress = session?.ablationAnalysisProgress ?? (
    typeof ablationProgressRecord.completed === 'number' && typeof ablationProgressRecord.total === 'number'
      ? {
        completed: ablationProgressRecord.completed,
        total: ablationProgressRecord.total,
        lastParentObjectId: null,
        lastParentObjectName: null,
        currentParentObjectId: null,
        currentParentObjectName: null,
        currentChildObjectId: null,
        currentChildObjectName: null,
        processedChildCount: 0,
        totalChildCount: 0,
      }
      : null
  );

  const objectDecomposeProgressValue = objectDecomposeProgress && objectDecomposeProgress.total > 0
    ? Math.round((objectDecomposeProgress.completed / objectDecomposeProgress.total) * 100)
    : 0;
  const ablationAnalysisProgressValue = ablationAnalysisProgress && ablationAnalysisProgress.total > 0
    ? Math.round((ablationAnalysisProgress.completed / ablationAnalysisProgress.total) * 100)
    : 0;
  const chunkTotalCount = asCount(chunkOutput.total_chunks, summary.chunkCount);
  const windowTotalCount = windowExtractProgress?.total ?? asCount(windowOutput.total_windows, summary.windowCount);
  const fusedObjectTotalCount = asCount(
    functionOutput.total_function_objects,
    asCount(fusionOutput.total_fused_objects, summary.objectCount),
  );
  const decompositionTotalCount = asCount(decomposeOutput.total_decompositions, shownDecompositionCount);
  const failedObjectTotalCount = asCount(decomposeOutput.total_failed_objects, failedObjectItems.length);
  const graphNodeTotalCount = Math.max(summary.objectCount, fusedObjectTotalCount);
  const graphEdgeTotalCount = asCount(graphOutput.total_edges, summary.edgeCount);
  const removedCycleEdgeTotalCount = asCount(graphOutput.total_removed_cycle_edges, removedCycleEdgeItems.length);
  const ablationTotalCount = ablationAnalysisProgress?.total ?? asCount(ablationOutput.total_parent_summaries, ablationItems.length);
  const siblingImpactEdges = useMemo(() => extractWorkflowV2SiblingImpactEdges(ablationItems), [ablationItems]);
  const sessionStatusMeta = getSessionStatusMeta(session, failedStages);
  const selectedProjectName = projects.find((item) => item.id === selectedProjectId)?.name || selectedProjectId || '未选择项目';
  const latestFocusTarget = ablationAnalysisProgress?.currentParentObjectName
    || ablationAnalysisProgress?.lastParentObjectName
    || objectDecomposeProgress?.lastObjectName
    || objectDecomposeProgress?.lastFailedObjectName
    || windowExtractProgress?.lastWindowId
    || '';
  const canWriteback = canWriteWorkflowV2Session(session) && !session?.isRunning && !writing;
  const writebackSummary = useMemo(
    () => (writebackPayload ? extractWorkflowV2WritebackSummary(writebackPayload) : null),
    [writebackPayload],
  );

  const handleStart = () => {
    if (!selectedFile) {
      toast.error('请先选择文件');
      return;
    }
    if (!selectedProjectId) {
      toast.error('请先选择 project_id');
      return;
    }
    try {
      const conversationId = startWorkflowV2Run({
        file: selectedFile,
        projectId: selectedProjectId,
      });
      activateWorkflowV2Session(conversationId);
      setSession(getLatestWorkflowV2Session());
      setActiveView('overview');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '启动 V2 工作流失败');
    }
  };

  const handleEnterFreshView = () => {
    setSession(null);
    setActiveView('overview');
    setWritebackPayload(null);
    setWritebackError('');
  };

  const handleSaveConfig = async () => {
    setConfigSaving(true);
    try {
      const next = await updateWorkflowV2Config(config);
      setConfig(next);
      configDirtyRef.current = false;
      setConfigDirty(false);
      toast.success('V2 配置已保存');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存 V2 配置失败');
    } finally {
      setConfigSaving(false);
    }
  };

  const handleProjectChange = (projectId: string) => {
    setSelectedProjectIdState(projectId);
    setStoredSelectedProjectId(projectId);
  };

  const handleRetryStage = (stageKey: string) => {
    if (!session) {
      return;
    }
    try {
      retryWorkflowV2RunFromStage({
        conversationId: session.conversationId,
        startStage: stageKey,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '触发 V2 阶段重试失败');
    }
  };

  const handleCopyMermaid = async () => {
    if (!mermaidCode.trim()) {
      toast.error('当前还没有可复制的 Mermaid 图');
      return;
    }
    try {
      await copyCodeToClipboard(mermaidCode);
      setMermaidCopied(true);
      toast.success('Mermaid 已复制到剪贴板');
      if (typeof window !== 'undefined') {
        window.setTimeout(() => setMermaidCopied(false), 1800);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '复制 Mermaid 失败');
    }
  };

  const handleWriteback = async () => {
    if (!session?.conversationId) {
      toast.error('当前没有可写回的 V2 会话');
      return;
    }

    setWriting(true);
    setWritebackPayload(null);
    setWritebackError('');

    try {
      const payload = await writeWorkflowV2SessionToOntoGit({
        conversationId: session.conversationId,
        projectId: selectedProjectId || session.projectId || undefined,
      });
      const summaryInfo = extractWorkflowV2WritebackSummary(payload);
      setWritebackPayload(payload);
      setActiveView('overview');
      toast.success(
        summaryInfo.lastCommitId
          ? `已写入 OntoGit，commit ${summaryInfo.lastCommitId}`
          : '已写入 OntoGit 并完成推理',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '写入 OntoGit 失败';
      setWritebackError(message);
      toast.error(message);
    } finally {
      setWriting(false);
    }
  };

  const graphCanvasWidth = graphLayout.nodes.length > 0
    ? Math.max(720, ...graphLayout.nodes.map((node) => node.x + 160))
    : 720;
  const graphCanvasHeight = graphLayout.nodes.length > 0
    ? Math.max(420, ...graphLayout.nodes.map((node) => node.y + 80))
    : 420;
  const graphScaledWidth = Math.round(graphCanvasWidth * graphZoom);
  const graphScaledHeight = Math.round(graphCanvasHeight * graphZoom);

  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.1),transparent_24%),linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,1))] p-4 sm:p-6">
      <div className="mx-auto flex max-w-[1680px] flex-col gap-6">
        <Card className="overflow-hidden rounded-[32px] border-border/60 bg-background/88 shadow-xl">
          <div className="border-b border-border/50 bg-[linear-gradient(135deg,rgba(14,165,233,0.08),rgba(16,185,129,0.08))]">
            <CardHeader className="gap-6 pb-6">
              <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-4xl">
                  <div className="text-xs font-black uppercase tracking-[0.24em] text-muted-foreground">Workflow V2</div>
                  <CardTitle className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">文件工作流 V2 驾驶舱</CardTitle>
                  <CardDescription className="mt-3 text-sm leading-7 text-foreground/75 sm:text-base">
                    先把结果读懂，再决定下一步动作。首页现在优先展示运行态、对象摘要、DAG 结构与写回闭环，A/B/Judge 过程仍然完整保留在各卡片内部的“查看过程”入口中。
                  </CardDescription>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge className={cn('rounded-full border px-4 py-1.5 font-semibold', sessionStatusMeta.badgeClass)}>
                      {sessionStatusMeta.label}
                    </Badge>
                    <Badge variant="outline" className="rounded-full px-4 py-1.5">项目 {selectedProjectName}</Badge>
                    <Badge variant="outline" className="rounded-full px-4 py-1.5">
                      {session?.conversationId ? `会话 ${session.conversationId.slice(-10)}` : '当前无会话'}
                    </Badge>
                    <Badge variant="outline" className="rounded-full px-4 py-1.5">
                      {selectedFile ? `文件 ${selectedFile.name}` : '尚未选择文件'}
                    </Badge>
                  </div>
                </div>

                <div className="grid w-full gap-3 sm:grid-cols-2 xl:max-w-[520px]">
                  <MetricCard
                    title="阶段进度"
                    value={`${progressValue}%`}
                    hint={`${completedStages}/${totalStages} 已完成，${failedStages} 个失败`}
                    accent="border-sky-500/20"
                  />
                  <MetricCard
                    title="对象图摘要"
                    value={`${summary.objectCount} / ${summary.edgeCount}`}
                    hint="Objects / Edges"
                    accent="border-emerald-500/20"
                  />
                  <MetricCard
                    title="最近阶段"
                    value={activeStageMeta?.title || latestStageMeta?.title || '待开始'}
                    hint={activeStage ? '当前正在执行' : (latestFinishedStage?.status === 'failed' ? '最近阶段失败' : '暂无进行中的阶段')}
                    accent="border-amber-500/20"
                  />
                  <MetricCard
                    title="写回状态"
                    value={writebackSummary?.lastCommitId || (writebackError ? '失败' : '未写回')}
                    hint={writebackSummary ? `版本 ${writebackSummary.lastVersionId ?? '未返回'}` : (writebackError || '当前会话尚未执行写回')}
                    accent="border-violet-500/20"
                  />
                </div>
              </div>
            </CardHeader>
          </div>

          <CardContent className="space-y-5 p-5 sm:p-6">
            <div className="rounded-[28px] border border-border/60 bg-muted/20 p-4 sm:p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div className="grid flex-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(240px,280px)_minmax(260px,1fr)]">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground">项目选择</div>
                    <Select value={selectedProjectId} onValueChange={handleProjectChange}>
                      <SelectTrigger className="rounded-2xl bg-background/90">
                        <SelectValue placeholder="选择 project_id" />
                      </SelectTrigger>
                      <SelectContent>
                        {(projects.length === 0 ? [{ id: 'demo', name: 'demo' } as XgProject] : projects).map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.name || project.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground">上传文件</div>
                    <Input
                      type="file"
                      className="rounded-2xl bg-background/90"
                      onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button type="button" onClick={handleStart} disabled={!selectedFile || !selectedProjectId || session?.isRunning} className="rounded-2xl">
                    {session?.isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                    启动
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => session && void terminateWorkflowV2Run(session.conversationId)}
                    disabled={!session?.isRunning}
                    className="rounded-2xl"
                  >
                    <Square className="mr-2 h-4 w-4" />
                    终止
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleWriteback()}
                    disabled={!canWriteback}
                    className="rounded-2xl"
                  >
                    {writing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitBranchPlus className="mr-2 h-4 w-4" />}
                    写入 OntoGit
                  </Button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{sessionStatusMeta.description}</span>
                <span>·</span>
                <span>{session?.statusMessage || '当前是全新界面，可直接启动工作流。'}</span>
                {session?.lastRunAt ? (
                  <>
                    <span>·</span>
                    <span>上次完成：{session.lastRunAt}</span>
                  </>
                ) : null}
              </div>
            </div>

            <Collapsible open={showAdvancedConfig} onOpenChange={setShowAdvancedConfig}>
              <Card className="rounded-[28px] border-border/60 bg-background/75 shadow-sm">
                <CardHeader className="pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-lg font-black tracking-tight">
                        <Settings2 className="h-4 w-4 text-primary" />
                        高级配置
                      </CardTitle>
                      <CardDescription className="mt-2">
                        首页只显示配置摘要；需要调整模型或 chunk/window 参数时再展开。
                      </CardDescription>
                    </div>
                    <CollapsibleTrigger asChild>
                      <Button type="button" variant="outline" className="rounded-full">
                        {configDirty ? '有未保存修改' : '查看配置'}
                        <ChevronDown className={cn('ml-2 h-4 w-4 transition-transform', showAdvancedConfig ? 'rotate-180' : '')} />
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Badge variant="outline" className="rounded-full">A {config.workflowModelA}</Badge>
                    <Badge variant="outline" className="rounded-full">B {config.workflowModelB}</Badge>
                    <Badge variant="outline" className="rounded-full">Judge {config.workflowJudgeModel}</Badge>
                    <Badge variant="secondary" className="rounded-full">
                      Chunk {config.chunkMinChars}-{config.chunkMaxChars}
                    </Badge>
                    <Badge variant="secondary" className="rounded-full">
                      Window {config.windowSize}/{config.windowStep}
                    </Badge>
                    <Badge variant="secondary" className="rounded-full">
                      Parallel {config.parallelWindows}
                    </Badge>
                  </div>
                </CardHeader>

                <CollapsibleContent>
                  <CardContent className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-muted-foreground">Workflow Model A</div>
                        <Input
                          value={config.workflowModelA}
                          onChange={(event) => {
                            markConfigDirty();
                            setConfig((prev) => ({
                              ...prev,
                              workflowModel: event.target.value,
                              workflowModelA: event.target.value,
                            }));
                          }}
                          className="rounded-2xl"
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-muted-foreground">Workflow Model B</div>
                        <Input
                          value={config.workflowModelB}
                          onChange={(event) => {
                            markConfigDirty();
                            setConfig((prev) => ({ ...prev, workflowModelB: event.target.value }));
                          }}
                          className="rounded-2xl"
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-muted-foreground">Judge Model</div>
                        <Input
                          value={config.workflowJudgeModel}
                          onChange={(event) => {
                            markConfigDirty();
                            setConfig((prev) => ({ ...prev, workflowJudgeModel: event.target.value }));
                          }}
                          className="rounded-2xl"
                        />
                      </div>
                      {[
                        ['chunkMaxChars', 'Chunk Max'],
                        ['chunkMinChars', 'Chunk Min'],
                        ['windowSize', 'Window Size'],
                        ['windowStep', 'Window Step'],
                        ['parallelWindows', 'Parallel Windows'],
                      ].map(([key, label]) => (
                        <div key={key} className="space-y-2">
                          <div className="text-xs font-semibold text-muted-foreground">{label}</div>
                          <Input
                            type="number"
                            value={config[key as keyof WorkflowV2Config] as number}
                            className="rounded-2xl"
                            onChange={(event) => {
                              markConfigDirty();
                              setConfig((prev) => ({
                                ...prev,
                                [key]: Number(event.target.value) || 0,
                              }));
                            }}
                          />
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <Button type="button" variant="outline" onClick={handleSaveConfig} disabled={configSaving || configLoading} className="rounded-2xl">
                        <RefreshCcw className={cn('mr-2 h-4 w-4', configSaving ? 'animate-spin' : '')} />
                        保存配置
                      </Button>
                      <Button type="button" variant="ghost" onClick={handleEnterFreshView} className="rounded-2xl">
                        <RefreshCcw className="mr-2 h-4 w-4" />
                        新建视图
                      </Button>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <MetricCard title="Chunks" value={summary.chunkCount} hint={`已切分 ${chunkTotalCount} 个自然段块`} accent="border-sky-500/20" />
          <MetricCard title="Windows" value={summary.windowCount} hint={`滑窗总数 ${windowTotalCount}`} accent="border-cyan-500/20" />
          <MetricCard title="Objects" value={summary.objectCount} hint={`功能对象展示 ${fusedObjectItems.length}`} accent="border-emerald-500/20" />
          <MetricCard title="Edges" value={summary.edgeCount} hint={`主边 ${graphEdgeTotalCount}，删环 ${removedCycleEdgeTotalCount}`} accent="border-amber-500/20" />
          <MetricCard title="DAG 状态" value={summary.isDag ? 'DAG' : '未确认'} hint={summary.isDag ? '当前结构已无环' : '请结合删环结果一起查看'} accent="border-violet-500/20" />
          <MetricCard title="消融父节点" value={ablationTotalCount} hint={`兄弟影响边 ${siblingImpactEdges.length}`} accent="border-fuchsia-500/20" />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <SectionCard title="当前运行态" description="把阶段进度、最近阶段、失败计数和当前处理对象聚合到同一张卡，方便首屏判断接下来做什么。">
            <div className="space-y-4">
              <div className="rounded-3xl border border-border/60 bg-muted/15 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.22em] text-muted-foreground">Workflow Pulse</div>
                    <div className="mt-2 text-3xl font-black tracking-tight">{progressValue}%</div>
                    <div className="mt-2 text-sm text-muted-foreground">{session?.statusMessage || '当前还没有运行中的会话。'}</div>
                  </div>
                  <div className="grid gap-2 text-sm text-muted-foreground sm:text-right">
                    <div>已启动 {startedStages} / {totalStages}</div>
                    <div>已完成 {completedStages} / {totalStages}</div>
                    <div>失败阶段 {failedStages}</div>
                  </div>
                </div>
                <Progress value={progressValue} className="mt-4 h-2.5 bg-primary/10" />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                  <div className="text-xs font-semibold text-muted-foreground">当前阶段</div>
                  <div className="mt-2 text-base font-black">
                    {activeStageMeta?.title || (session?.runResult ? (failedStages > 0 ? '执行失败' : '已完成') : '待开始')}
                  </div>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                  <div className="text-xs font-semibold text-muted-foreground">最近阶段</div>
                  <div className="mt-2 text-base font-black">{latestStageMeta?.title || '暂无'}</div>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                  <div className="text-xs font-semibold text-muted-foreground">当前处理对象</div>
                  <div className="mt-2 text-base font-black">{latestFocusTarget || '暂无'}</div>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-3">
                {windowExtractProgress ? (
                  <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4 text-sm text-sky-800">
                    <div className="font-black">窗口抽取</div>
                    <div className="mt-1 text-xs leading-5">
                      已完成 {windowExtractProgress.completed} / {windowExtractProgress.total}
                      {windowExtractProgress.parallel ? `，并发 ${windowExtractProgress.parallel}` : ''}
                      {windowExtractProgress.lastWindowId ? `，最近 ${windowExtractProgress.lastWindowId}` : ''}
                    </div>
                  </div>
                ) : null}
                {objectDecomposeProgress ? (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-800">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-black">对象拆解</div>
                      <div className="text-xs">{objectDecomposeProgressValue}%</div>
                    </div>
                    <Progress value={objectDecomposeProgressValue} className="mt-2 h-2 bg-amber-500/15" />
                    <div className="mt-2 text-xs leading-5">
                      已完成 {objectDecomposeProgress.completed} / {objectDecomposeProgress.total}，失败 {objectDecomposeProgress.failed}
                      {objectDecomposeProgress.lastObjectName ? `，最近 ${objectDecomposeProgress.lastObjectName}` : ''}
                    </div>
                  </div>
                ) : null}
                {ablationAnalysisProgress ? (
                  <div className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-4 text-sm text-fuchsia-800">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-black">子节点消融</div>
                      <div className="text-xs">{ablationAnalysisProgressValue}%</div>
                    </div>
                    <Progress value={ablationAnalysisProgressValue} className="mt-2 h-2 bg-fuchsia-500/15" />
                    <div className="mt-2 text-xs leading-5">
                      已完成 {ablationAnalysisProgress.completed} / {ablationAnalysisProgress.total}
                      {ablationAnalysisProgress.currentParentObjectName ? `，当前 ${ablationAnalysisProgress.currentParentObjectName}` : ''}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </SectionCard>

          <SectionCard title="写回结果" description="显式记录最近一次“写入 OntoGit 并推理”的 commit、version 与概率解释。">
            <div className="space-y-4">
              <div className="rounded-3xl border border-border/60 bg-muted/15 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.22em] text-muted-foreground">Write And Infer</div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      {canWriteWorkflowV2Session(session)
                        ? '当前结果已满足写回条件，可以直接入库并读取推理摘要。'
                        : '需要先让 V2 至少产出一轮有效结果，写回按钮才会可用。'}
                    </div>
                  </div>
                  <Badge variant={writebackSummary ? 'secondary' : 'outline'} className="rounded-full">
                    {writebackSummary ? '已有结果' : (writebackError ? '最近失败' : '尚未写回')}
                  </Badge>
                </div>
              </div>

              {writebackSummary ? (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                      <div className="text-xs font-semibold text-muted-foreground">Commit ID</div>
                      <div className="mt-2 break-all text-sm font-black">{writebackSummary.lastCommitId || '未返回'}</div>
                    </div>
                    <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                      <div className="text-xs font-semibold text-muted-foreground">Version ID</div>
                      <div className="mt-2 text-sm font-black">{writebackSummary.lastVersionId ?? '未返回'}</div>
                    </div>
                    <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                      <div className="text-xs font-semibold text-muted-foreground">推理概率</div>
                      <div className="mt-2 text-sm font-black">{formatPercent(writebackSummary.inferenceProbability)}</div>
                    </div>
                    <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                      <div className="text-xs font-semibold text-muted-foreground">写回结果</div>
                      <div className="mt-2 text-sm font-black">
                        成功 {writebackSummary.successCount} / {writebackSummary.totalCount}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700/80">Inference Reason</div>
                    <div className="mt-2 text-sm leading-6 text-foreground/85">
                      {writebackSummary.inferenceReason || '后端已返回写回结果，但没有提供概率理由。'}
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    项目 {writebackPayload?.project_id || selectedProjectId}，实体文件 {writebackPayload?.entity_files.length ?? 0} 个。
                  </div>
                </div>
              ) : writebackError ? (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-700">
                  <div className="font-black">写回失败</div>
                  <div className="mt-2 leading-6">{writebackError}</div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border/60 bg-background/60 p-6 text-sm text-muted-foreground">
                  最近还没有写回记录。完成一次 V2 会话后，可以从顶部主操作区直接写入 OntoGit。
                </div>
              )}
            </div>
          </SectionCard>
        </div>

        <Tabs value={activeView} onValueChange={(value) => setActiveView(value as WorkflowV2ViewMode)} className="space-y-5">
          <div className="rounded-[28px] border border-border/60 bg-background/75 p-2 shadow-sm">
            <TabsList className="grid h-auto w-full grid-cols-3 rounded-[22px] bg-muted/30 p-1">
              <TabsTrigger value="overview" className="rounded-2xl px-4 py-3 text-sm font-bold data-[state=active]:bg-background data-[state=active]:shadow-sm">
                总览
              </TabsTrigger>
              <TabsTrigger value="analysis" className="rounded-2xl px-4 py-3 text-sm font-bold data-[state=active]:bg-background data-[state=active]:shadow-sm">
                分析
              </TabsTrigger>
              <TabsTrigger value="debug" className="rounded-2xl px-4 py-3 text-sm font-bold data-[state=active]:bg-background data-[state=active]:shadow-sm">
                调试
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview" className="mt-0 space-y-6">
            <SectionCard title="阶段时间线" description="每个阶段都保留完整结构化 output，并支持从任意已完成阶段重新开始。">
              <div className="grid gap-4 xl:grid-cols-3">
                {WORKFLOW_V2_STAGE_DEFINITIONS.map((stage) => {
                  const resultItem = stageResults.find((item) => item.stage === stage.key);
                  const retryEnabled = canRetryWorkflowV2Stage(session, stage.key, stage.retryable !== false);
                  return (
                    <div key={stage.key} className={cn('rounded-3xl border p-4 transition-all', statusClass(resultItem?.status || 'pending'))}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="rounded-2xl border border-border/60 bg-background/80 p-2 text-primary">
                            {STAGE_ICONS[stage.key] ?? <Activity className="h-4 w-4" />}
                          </div>
                          <div>
                            <div className="text-xs font-black uppercase tracking-widest text-muted-foreground">{stage.short}</div>
                            <div className="text-sm font-black">{stage.title}</div>
                          </div>
                        </div>
                        <Badge variant="outline">{resultItem?.status || 'pending'}</Badge>
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">{stage.detail}</p>
                      {resultItem?.error ? (
                        <p className="mt-3 text-sm text-red-500">{resultItem.error}</p>
                      ) : null}
                      <div className="mt-4 flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={!retryEnabled}
                          onClick={() => handleRetryStage(stage.key)}
                          className="rounded-full"
                        >
                          <RefreshCcw className="mr-2 h-3.5 w-3.5" />
                          从此重试
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>

            <div className="grid gap-6 xl:grid-cols-[1.02fr_0.98fr]">
              <SectionCard title="对象概览" description="先看对象融合和核心功能摘要，专家决策过程按需展开查看。">
                <ScrollArea className="h-[520px] rounded-3xl border border-border/60 bg-muted/15 p-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-black">Fused Objects</div>
                      <Badge variant="outline">总 {fusedObjectTotalCount} / 展示 {fusedObjectItems.length}</Badge>
                    </div>

                    {fusionJudgeItems.length > 0 ? (
                      <div className="space-y-3 rounded-3xl border border-amber-500/20 bg-amber-500/5 p-4">
                        <div className="flex items-center gap-2 text-sm font-black">
                          <Gavel className="h-4 w-4 text-amber-600" />
                          Fusion Judge
                        </div>
                        {fusionJudgeItems.map((item, index) => {
                          const record = asRecord(item);
                          return (
                            <div key={`fusion-judge-${index}`} className="rounded-2xl border border-border/60 bg-background/80 p-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline">{asText(record.existing_object_name) || 'existing'}</Badge>
                                <span className="text-xs text-muted-foreground">vs</span>
                                <Badge variant="outline">{asText(record.candidate_object_name) || 'candidate'}</Badge>
                                <Badge variant="secondary">{asText(record.selected_action) || 'judge'}</Badge>
                              </div>
                              <div className="mt-2 text-xs text-muted-foreground">{asText(record.reason) || '未提供判定依据。'}</div>
                              <WorkflowTrioPreview
                                title={`${asText(record.existing_object_name) || '对象'} 与 ${asText(record.candidate_object_name) || '候选'} 的融合判定`}
                                ensemble={record.llm_ensemble}
                                summary="当 normalized_name 无法直接判定时，这里会展示 A/B/judge 的三方决策。"
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    {fusedObjectItems.length > 0 ? (
                      fusedObjectItems.map((object) => {
                        const record = asRecord(object);
                        return (
                          <div key={asText(record.object_id)} className="rounded-2xl border border-border/60 bg-background/80 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-base font-black">{asText(record.object_name)}</div>
                                <div className="text-xs text-muted-foreground">{asText(record.normalized_name)}</div>
                              </div>
                              <Badge variant="outline">{Number(record.confidence ?? 0).toFixed(2)}</Badge>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {asStringArray(record.aliases).map((alias) => (
                                <Badge key={`${asText(record.object_id)}-${alias}`} variant="secondary">{alias}</Badge>
                              ))}
                            </div>
                            {asText(record.core_function) ? (
                              <div className="mt-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700/80">Core Function</div>
                                <div className="mt-1 text-sm text-foreground/90">{asText(record.core_function)}</div>
                              </div>
                            ) : null}
                            <div className="mt-3 text-xs text-muted-foreground">{asText(record.reason)}</div>
                            <div className="mt-3 text-xs text-muted-foreground">引用数：{asCount(record.citation_count, asStringArray(record.citations).length)}</div>
                            {asStringArray(record.citations ?? record.citation).map((citation, index) => (
                              <CitationPreview key={`${asText(record.object_id)}-citation-${index}`} citation={citation} />
                            ))}
                            <WorkflowTrioPreview
                              title={`${asText(record.object_name) || '对象'} 的核心功能分析`}
                              ensemble={record.llm_ensemble ?? record.function_llm_ensemble}
                              summary="核心功能阶段会在这里并排展示模型 A、模型 B 和 judge 的结果。"
                            />
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-sm text-muted-foreground">对象融合结果会显示在这里。</div>
                    )}
                  </div>
                </ScrollArea>
              </SectionCard>

              <SectionCard
                title="系统拆解视图"
                description="首屏先回答“这个系统由什么组成”。主系统、子系统和子部件按层级展开，DAG 连线图下沉到分析区做结构校验。"
                action={(
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">主系统 {systemDecompositionView.root?.name || '待生成'}</Badge>
                    <Badge variant="outline">包含边 {systemDecompositionView.summary.containmentCount}</Badge>
                    <Badge variant="outline">叶子节点 {systemDecompositionView.summary.leafCount}</Badge>
                  </div>
                )}
              >
                <WorkflowV2SystemDecompositionPanel view={systemDecompositionView} />
              </SectionCard>
            </div>
          </TabsContent>

          <TabsContent value="analysis" className="mt-0 space-y-6">
            <Card className="rounded-[28px] border-primary/20 bg-primary/5 shadow-sm">
              <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.24em] text-primary/80">Expert Details</div>
                  <div className="mt-2 text-sm leading-6 text-foreground/80">
                    A/B/Judge 的深度推理没有消失，只是被折叠进各个卡片内部。看到“查看过程”按钮时，就可以按需展开完整专家过程。
                  </div>
                </div>
                <Badge variant="secondary" className="rounded-full whitespace-nowrap">
                  首屏先读摘要，细节按需展开
                </Badge>
              </CardContent>
            </Card>

            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <SectionCard title="Chunks / Windows" description="先看自然段分块，再看滑动窗口如何覆盖局部上下文。">
                <div className="grid gap-5 lg:grid-cols-2">
                  <ScrollArea className="h-[420px] rounded-3xl border border-border/60 bg-muted/15 p-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-black">Chunks</div>
                        <Badge variant="outline">总 {chunkTotalCount} / 展示 {chunkItems.length}</Badge>
                      </div>
                      {chunkItems.length > 0 ? (
                        chunkItems.map((chunk) => {
                          const record = asRecord(chunk);
                          return (
                            <div key={asText(record.chunk_id)} className="rounded-2xl border border-border/60 bg-background/80 p-3">
                              <div className="text-xs font-black uppercase tracking-widest text-muted-foreground">{asText(record.chunk_id)}</div>
                              <div className="mt-2 text-sm leading-6">{asText(record.text)}</div>
                              <div className="mt-2 text-xs text-muted-foreground">{asText(record.reason)}</div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-sm text-muted-foreground">启动后会在这里显示 chunk 列表。</div>
                      )}
                    </div>
                  </ScrollArea>

                  <ScrollArea className="h-[420px] rounded-3xl border border-border/60 bg-muted/15 p-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-black">Windows</div>
                        <Badge variant="outline">总 {windowTotalCount} / 展示 {windowItems.length}</Badge>
                      </div>
                      {windowExtractProgress ? (
                        <div className="text-xs text-muted-foreground">
                          第二阶段已完成 {windowExtractProgress.completed} / {windowTotalCount} 个滑动窗口
                          {windowExtractProgress.parallel ? `，当前并发上限 ${windowExtractProgress.parallel}` : ''}
                          {windowExtractProgress.lastWindowId ? `，最近完成 ${windowExtractProgress.lastWindowId}` : ''}
                        </div>
                      ) : null}
                      {windowItems.length > 0 ? (
                        windowItems.map((windowResult) => {
                          const record = asRecord(windowResult);
                          const objects = Array.isArray(record.objects) ? record.objects : [];
                          return (
                            <div key={asText(record.window_id)} className="rounded-2xl border border-border/60 bg-background/80 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-xs font-black uppercase tracking-widest text-muted-foreground">{asText(record.window_id)}</div>
                                <Badge variant="outline">{objects.length} objects</Badge>
                              </div>
                              <div className="mt-2 text-xs text-muted-foreground">{asText(record.reason)}</div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {objects.slice(0, 8).map((object, index) => (
                                  <Badge key={`${asText(record.window_id)}-${index}`} variant="secondary">{asText(asRecord(object).object_name)}</Badge>
                                ))}
                              </div>
                              <WorkflowTrioPreview
                                title={`窗口 ${asText(record.window_id) || '未命名'} 的对象抽取过程`}
                                ensemble={record.llm_ensemble}
                                summary="这里会同时展示模型 A、模型 B 和 judge 在该滑动窗口上的结构化输出。"
                              />
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-sm text-muted-foreground">启动后会在这里显示窗口抽取结果。</div>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </SectionCard>

              <SectionCard
                title="结构验证图"
                description="DAG 保留为技术校验视图。主结构树讲系统怎么拆，这里负责验证包含边、孤立节点和影响边。"
                action={(
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">节点 {graphNodeTotalCount}</Badge>
                    <Badge variant="outline">主边 {graphEdgeTotalCount}</Badge>
                    <Badge variant="outline">{hideIsolatedNodes ? '隐藏孤立节点' : '显示孤立节点'}</Badge>
                  </div>
                )}
              >
                <div className="rounded-3xl border border-border/60 bg-muted/15 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant={hideIsolatedNodes ? 'default' : 'outline'}
                        size="sm"
                        className="rounded-full"
                        onClick={() => setHideIsolatedNodes((current) => !current)}
                      >
                        {hideIsolatedNodes ? '显示孤立节点' : '隐藏孤立节点'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        onClick={() => setGraphZoom((current) => Math.max(0.6, Number((current - 0.2).toFixed(2))))}
                        disabled={graphLayout.nodes.length === 0}
                      >
                        <ZoomOut className="mr-2 h-4 w-4" />
                        缩小
                      </Button>
                      <Badge variant="outline" className="rounded-full px-3">
                        {Math.round(graphZoom * 100)}%
                      </Badge>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        onClick={() => setGraphZoom((current) => Math.min(2.4, Number((current + 0.2).toFixed(2))))}
                        disabled={graphLayout.nodes.length === 0}
                      >
                        <ZoomIn className="mr-2 h-4 w-4" />
                        放大
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        onClick={() => setGraphZoom(1)}
                        disabled={graphLayout.nodes.length === 0}
                      >
                        还原
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      onClick={() => void handleCopyMermaid()}
                      disabled={!mermaidCode.trim()}
                    >
                      {mermaidCopied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                      {mermaidCopied ? '已复制 Mermaid' : '复制 Mermaid'}
                    </Button>
                  </div>

                  {graphLayout.nodes.length > 0 ? (
                    <div className="overflow-auto rounded-2xl border border-border/50 bg-background/60">
                      <svg
                        viewBox={`0 0 ${graphCanvasWidth} ${graphCanvasHeight}`}
                        className="block"
                        style={{
                          width: `${graphScaledWidth}px`,
                          height: `${graphScaledHeight}px`,
                          minWidth: `${graphScaledWidth}px`,
                          minHeight: `${graphScaledHeight}px`,
                        }}
                      >
                        <defs>
                          <marker
                            id="workflow-v2-dag-arrow"
                            viewBox="0 0 10 10"
                            refX="8"
                            refY="5"
                            markerWidth="7"
                            markerHeight="7"
                            orient="auto-start-reverse"
                          >
                            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(14,165,233,0.75)" />
                          </marker>
                          <marker
                            id="workflow-v2-impact-arrow-high"
                            viewBox="0 0 10 10"
                            refX="8"
                            refY="5"
                            markerWidth="8"
                            markerHeight="8"
                            orient="auto-start-reverse"
                          >
                            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(239,68,68,0.9)" />
                          </marker>
                          <marker
                            id="workflow-v2-impact-arrow-medium"
                            viewBox="0 0 10 10"
                            refX="8"
                            refY="5"
                            markerWidth="8"
                            markerHeight="8"
                            orient="auto-start-reverse"
                          >
                            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(245,158,11,0.9)" />
                          </marker>
                          <marker
                            id="workflow-v2-impact-arrow-low"
                            viewBox="0 0 10 10"
                            refX="8"
                            refY="5"
                            markerWidth="8"
                            markerHeight="8"
                            orient="auto-start-reverse"
                          >
                            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(14,165,233,0.82)" />
                          </marker>
                          <marker
                            id="workflow-v2-impact-arrow-none"
                            viewBox="0 0 10 10"
                            refX="8"
                            refY="5"
                            markerWidth="8"
                            markerHeight="8"
                            orient="auto-start-reverse"
                          >
                            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(148,163,184,0.72)" />
                          </marker>
                        </defs>
                        {graphLayout.edges.map((edge) => {
                          const source = graphLayout.nodes.find((node) => node.id === edge.sourceId);
                          const target = graphLayout.nodes.find((node) => node.id === edge.targetId);
                          if (!source || !target) return null;
                          return (
                            <path
                              key={edge.id}
                              d={`M ${source.x + 90} ${source.y + 24} C ${source.x + 150} ${source.y + 24}, ${target.x - 60} ${target.y + 24}, ${target.x} ${target.y + 24}`}
                              fill="none"
                              stroke="rgba(14,165,233,0.45)"
                              strokeWidth="2.5"
                              markerEnd="url(#workflow-v2-dag-arrow)"
                            />
                          );
                        })}
                        {siblingImpactEdges.map((edge) => {
                          const source = graphLayout.nodes.find((node) => node.id === edge.sourceId);
                          const target = graphLayout.nodes.find((node) => node.id === edge.targetId);
                          if (!source || !target) return null;
                          const style = getWorkflowV2ImpactEdgeStyle(edge.impactLevel);
                          const impactArrowId = `workflow-v2-impact-arrow-${edge.impactLevel}`;
                          return (
                            <path
                              key={`impact-${edge.id}`}
                              d={`M ${source.x + 90} ${source.y + 24} C ${source.x + 150} ${source.y + 24}, ${target.x - 60} ${target.y + 24}, ${target.x} ${target.y + 24}`}
                              fill="none"
                              stroke={style.stroke}
                              strokeWidth={style.strokeWidth}
                              strokeDasharray={style.strokeDasharray}
                              strokeLinecap="round"
                              opacity="0.95"
                              markerEnd={`url(#${impactArrowId})`}
                            />
                          );
                        })}
                        {graphLayout.nodes.map((node) => (
                          <g key={node.id}>
                            <rect
                              x={node.x}
                              y={node.y}
                              rx="18"
                              width="120"
                              height="48"
                              fill={node.isIsolated ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.96)'}
                              stroke={node.isIsolated ? 'rgba(148,163,184,0.38)' : 'rgba(15,23,42,0.12)'}
                              strokeDasharray={node.isIsolated ? '6 6' : undefined}
                            />
                            <text
                              x={node.x + 60}
                              y={node.y + 26}
                              textAnchor="middle"
                              fontSize="14"
                              fontWeight="700"
                              fill={node.isIsolated ? 'rgba(71,85,105,0.72)' : '#0f172a'}
                            >
                              {node.label}
                            </text>
                            {node.isIsolated ? (
                              <text
                                x={node.x + 60}
                                y={node.y + 39}
                                textAnchor="middle"
                                fontSize="9"
                                fontWeight="700"
                                letterSpacing="0.08em"
                                fill="rgba(100,116,139,0.82)"
                              >
                                孤立
                              </text>
                            ) : null}
                          </g>
                        ))}
                      </svg>
                    </div>
                  ) : (
                    <div className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">
                      图构建阶段完成后，会在这里显示 DAG 校验图。
                    </div>
                  )}
                </div>
              </SectionCard>
            </div>

            <SectionCard title="拆解 / 被删环边" description="对象拆解的结构边候选单独展开，去环裁决也放在同一层做结构追踪。">
              <div className="grid gap-4">
                <ScrollArea className="h-[240px] rounded-3xl border border-border/60 bg-muted/15 p-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-black">Object Decompose</div>
                      <Badge variant="outline">边候选总 {decompositionTotalCount} / 展示 {shownDecompositionCount}</Badge>
                    </div>
                    {objectDecomposeProgress ? (
                      <div className="rounded-2xl border border-border/60 bg-background/70 p-3">
                        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                          <div>已完成 {objectDecomposeProgress.completed} / {objectDecomposeProgress.total}，失败 {objectDecomposeProgress.failed}</div>
                          <div>{objectDecomposeProgressValue}%</div>
                        </div>
                        <Progress value={objectDecomposeProgressValue} className="mt-2 h-2 bg-amber-500/15" />
                      </div>
                    ) : null}
                    {decompositionGroups.length > 0 ? (
                      decompositionGroups.map((group, groupIndex) => {
                        const record = asRecord(group);
                        const decompositions = Array.isArray(record.decompositions) ? record.decompositions : [];
                        return (
                          <div key={`${asText(record.object_id)}-${groupIndex}`} className="rounded-2xl border border-border/60 bg-background/80 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-black">Group {groupIndex + 1}</div>
                              <Badge variant="outline">候选边 {decompositions.length}</Badge>
                            </div>
                            <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                              <div>object_id：{asText(record.object_id) || '未提供'}</div>
                              <div>group reason：{asText(record.reason) || '未提供'}</div>
                            </div>
                            <div className="mt-3 space-y-3">
                              {decompositions.length > 0 ? decompositions.map((edge, index) => {
                                const edgeRecord = asRecord(edge);
                                const confidenceValue = Number(edgeRecord.confidence);
                                return (
                                  <div key={`${asText(record.object_id)}-${index}`} className="rounded-2xl border border-border/60 bg-muted/20 p-3 text-sm">
                                    <div className="flex items-center justify-between gap-3">
                                      <div className="font-semibold">
                                        {asText(edgeRecord.parent_object_name)} → {asText(edgeRecord.child_object_name)}
                                      </div>
                                      <Badge variant="secondary">{asText(edgeRecord.relation) || 'contains'}</Badge>
                                    </div>
                                    <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                                      <div>parent_object_name：{asText(edgeRecord.parent_object_name) || '未提供'}</div>
                                      <div>child_object_name：{asText(edgeRecord.child_object_name) || '未提供'}</div>
                                      <div>relation：{asText(edgeRecord.relation) || '未提供'}</div>
                                      <div>
                                        confidence：
                                        {Number.isFinite(confidenceValue) ? confidenceValue.toFixed(2) : '未提供'}
                                      </div>
                                      <div>reason：{asText(edgeRecord.reason) || '未提供'}</div>
                                    </div>
                                    <CitationPreview citation={asText(edgeRecord.citation)} />
                                  </div>
                                );
                              }) : (
                                <div className="text-xs text-muted-foreground">该组没有拆解出具体边。</div>
                              )}
                            </div>
                            <WorkflowTrioPreview
                              title={`${asText(record.object_id) || `Group ${groupIndex + 1}`} 的对象拆解`}
                              ensemble={record.llm_ensemble}
                              summary="对象拆解阶段会在这里显示 A/B 提案与 judge 的冲突裁决。"
                            />
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-sm text-muted-foreground">对象拆解结果会显示在这里。</div>
                    )}

                    {failedObjectItems.length > 0 ? (
                      <div className="space-y-3 pt-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-black text-amber-700">Failed Objects</div>
                          <Badge variant="outline">总 {failedObjectTotalCount} / 展示 {failedObjectItems.length}</Badge>
                        </div>
                        {failedObjectItems.map((item, index) => {
                          const record = asRecord(item);
                          const attempts = Array.isArray(record.attempts) ? record.attempts : [];
                          return (
                            <div key={`${asText(record.object_id)}-${index}`} className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3">
                              <div className="text-sm font-black">{asText(record.object_name)}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{asText(record.reason)}</div>
                              {attempts.map((attempt, attemptIndex) => {
                                const attemptRecord = asRecord(attempt);
                                return (
                                  <div key={`${asText(record.object_id)}-attempt-${attemptIndex}`} className="mt-2 rounded-xl border border-border/60 bg-background/80 p-2 text-xs">
                                    <div>第 {String(attemptRecord.attempt || attemptIndex + 1)} 次：{asText(attemptRecord.error)}</div>
                                    <div className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                                      {asText(attemptRecord.model_output) || '该次没有捕获到模型文本输出。'}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </ScrollArea>

                <ScrollArea className="h-[240px] rounded-3xl border border-border/60 bg-muted/15 p-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-black">Removed Cycle Edges</div>
                      <Badge variant="outline">总 {removedCycleEdgeTotalCount} / 展示 {removedCycleEdgeItems.length}</Badge>
                    </div>
                    {removedCycleEdgeItems.length > 0 ? (
                      removedCycleEdgeItems.map((edge) => {
                        const record = asRecord(edge);
                        return (
                          <div key={asText(record.edge_id)} className="rounded-2xl border border-border/60 bg-background/80 p-3">
                            <div className="text-sm font-black">{asText(record.edge_id)}</div>
                            <CitationPreview citation={asText(record.citation)} />
                            <div className="mt-2 text-xs text-muted-foreground">{asText(record.reason)}</div>
                            <WorkflowTrioPreview
                              title={`${asText(record.edge_id) || '边'} 的去环裁决`}
                              ensemble={record.llm_ensemble}
                              summary="如果环裁决经过 LLM，这里会并排展示 A/B 与 judge 对最弱边的选择。"
                            />
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-sm text-muted-foreground">如果图里出现环，被删除的弱边会显示在这里。</div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </SectionCard>

            <SectionCard title="结构作用关系 / Ablation" description="系统拆开以后，继续看“移除某子模块会影响谁”。兄弟影响和子节点重要性按父系统分组呈现。">
              <ScrollArea className="h-[500px] rounded-3xl border border-border/60 bg-muted/15 p-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-black">Structure Effects</div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">父系统 {ablationItems.length}</Badge>
                      <Badge variant="outline">兄弟影响边 {siblingImpactEdges.length}</Badge>
                      <Badge variant="outline">总 {ablationTotalCount}</Badge>
                    </div>
                  </div>
                  {ablationAnalysisProgress ? (
                    <div className="rounded-2xl border border-border/60 bg-background/70 p-3">
                      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <div>
                          已完成 {ablationAnalysisProgress.completed} / {ablationAnalysisProgress.total}
                          {ablationAnalysisProgress.currentParentObjectName
                            ? `，正在处理 ${ablationAnalysisProgress.currentParentObjectName}${
                              ablationAnalysisProgress.totalChildCount > 0
                                ? `（${ablationAnalysisProgress.processedChildCount} / ${ablationAnalysisProgress.totalChildCount}${
                                  ablationAnalysisProgress.currentChildObjectName ? `，当前 ${ablationAnalysisProgress.currentChildObjectName}` : ''
                                }）`
                                : ''
                            }`
                            : ablationAnalysisProgress.lastParentObjectName
                              ? `，最近完成 ${ablationAnalysisProgress.lastParentObjectName}`
                              : ''}
                        </div>
                        <div>{ablationAnalysisProgressValue}%</div>
                      </div>
                      <Progress value={ablationAnalysisProgressValue} className="mt-2 h-2 bg-fuchsia-500/15" />
                    </div>
                  ) : null}

                  {ablationItems.length > 0 ? (
                    ablationItems.map((item) => {
                      const record = asRecord(item);
                      const siblingDependencyTable = Array.isArray(record.sibling_dependency_table) ? record.sibling_dependency_table : [];
                      const childImportanceList = Array.isArray(record.child_importance_list) ? record.child_importance_list : [];
                      return (
                        <div key={asText(record.parent_object_id)} className="rounded-3xl border border-border/60 bg-background/80 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="text-base font-black">{asText(record.parent_object_name) || asText(record.parent_object_id)}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{asText(record.parent_object_id)}</div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Badge variant="outline">兄弟影响 {siblingDependencyTable.length}</Badge>
                              <Badge variant="secondary">重要性 {childImportanceList.length}</Badge>
                            </div>
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">{asText(record.reason)}</div>
                          <div className="mt-4 grid gap-4 lg:grid-cols-2">
                            <div className="space-y-2">
                              <div className="text-sm font-black">兄弟影响</div>
                              {siblingDependencyTable.map((impact, index) => {
                                const impactRecord = asRecord(impact);
                                return (
                                  <div key={`${asText(record.parent_object_id)}-sibling-${index}`} className="rounded-2xl border border-border/60 p-3 text-sm">
                                    <div className="font-semibold">
                                      移除 {asText(impactRecord.ablated_child_object_name) || asText(impactRecord.ablated_child_object_id)}
                                      {' -> '}
                                      影响 {asText(impactRecord.target_sibling_object_name) || asText(impactRecord.target_sibling_object_id)}
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">{asText(impactRecord.impact_level)} / {asText(impactRecord.reason)}</div>
                                    <WorkflowTrioPreview
                                      title={`${asText(impactRecord.ablated_child_object_id) || '子节点'} 对兄弟 ${asText(impactRecord.target_sibling_object_id) || '对象'} 的影响`}
                                      ensemble={impactRecord.llm_ensemble}
                                      summary="兄弟影响分析的 A/B/judge 三方过程。"
                                    />
                                  </div>
                                );
                              })}
                              {siblingDependencyTable.length === 0 ? (
                                <div className="rounded-2xl border border-dashed border-border/60 bg-background/60 p-3 text-xs text-muted-foreground">
                                  当前父系统下没有检测到可展示的兄弟影响关系。
                                </div>
                              ) : null}
                            </div>
                            <div className="space-y-2">
                              <div className="text-sm font-black">子节点重要性</div>
                              {childImportanceList.map((impact, index) => {
                                const impactRecord = asRecord(impact);
                                return (
                                  <div key={`${asText(record.parent_object_id)}-parent-${index}`} className="rounded-2xl border border-border/60 p-3 text-sm">
                                    <div className="font-semibold">
                                      {asText(impactRecord.ablated_child_object_name) || asText(impactRecord.ablated_child_object_id)}
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">{asText(impactRecord.importance_level)} / {asText(impactRecord.reason)}</div>
                                    <WorkflowTrioPreview
                                      title={`${asText(impactRecord.ablated_child_object_id) || '子节点'} 对父节点的重要性`}
                                      ensemble={impactRecord.llm_ensemble}
                                      summary="父节点消融分析的 A/B/judge 三方过程。"
                                    />
                                  </div>
                                );
                              })}
                              {childImportanceList.length === 0 ? (
                                <div className="rounded-2xl border border-dashed border-border/60 bg-background/60 p-3 text-xs text-muted-foreground">
                                  当前父系统下没有可展示的子节点重要性记录。
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-sm text-muted-foreground">消融结果会显示在这里。</div>
                  )}
                </div>
              </ScrollArea>
            </SectionCard>
          </TabsContent>

          <TabsContent value="debug" className="mt-0 space-y-6">
            <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
              <SectionCard title="Raw JSON" description="保留完整 runResult，便于比对结构化输出和页面摘要。">
                <ScrollArea className="h-[520px] rounded-3xl border border-border/60 bg-muted/15 p-4">
                  <pre className="whitespace-pre-wrap break-words text-xs leading-6 text-foreground/80">
                    {session?.runResult ? formatJson(session.runResult) : '运行完成后会在这里显示完整 JSON。'}
                  </pre>
                </ScrollArea>
              </SectionCard>

              <SectionCard title="历史会话" description="用于附着到过去会话、回看结果或清理本地缓存记录。">
                <ScrollArea className="h-[520px] rounded-3xl border border-border/60 bg-muted/15 p-4">
                  <div className="space-y-3">
                    {sessions.length > 0 ? sessions.map((item) => (
                      <div key={item.conversationId} className="rounded-2xl border border-border/60 bg-background/80 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-black">{item.projectId}</div>
                            <div className="truncate text-xs text-muted-foreground">{item.conversationId}</div>
                          </div>
                          <Badge variant="outline">{item.runResult?.workflow.status || 'idle'}</Badge>
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {item.lastRunAt ? `最近完成：${item.lastRunAt}` : (item.statusMessage || '暂无进度信息')}
                        </div>
                        <div className="mt-3 flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="rounded-full"
                            onClick={() => {
                              activateWorkflowV2Session(item.conversationId);
                              setSession(getWorkflowV2Session(item.conversationId) ?? item);
                            }}
                          >
                            <FileJson className="mr-2 h-3.5 w-3.5" />
                            查看
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="rounded-full"
                            onClick={() => {
                              removeWorkflowV2Session(item.conversationId);
                              setSession((current) => current?.conversationId === item.conversationId ? null : current);
                            }}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            删除
                          </Button>
                        </div>
                      </div>
                    )) : (
                      <div className="text-sm text-muted-foreground">还没有 V2 会话历史。</div>
                    )}
                  </div>
                </ScrollArea>
              </SectionCard>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
