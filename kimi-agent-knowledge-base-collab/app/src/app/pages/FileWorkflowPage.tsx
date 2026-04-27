import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Database,
  Eye,
  FileJson,
  GitBranchPlus,
  Loader2,
  Play,
  Radar,
  RefreshCcw,
  Sparkles,
  TriangleAlert,
  Waves,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchKnowledgeGraph } from '@/features/ontology/api';
import {
  getLatestWorkflowSession,
  removeWorkflowSession,
  retryWorkflowRunFromStage,
  startWorkflowRun,
  subscribeWorkflowSession,
} from '@/features/workflow/runtime';
import { fetchWorkflowConfig, updateWorkflowConfig } from '@/features/workspace/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface WorkflowStageResult {
  stage: string;
  order: number;
  status: 'pending' | 'running' | 'success' | 'failed';
  started_at?: string | null;
  finished_at?: string | null;
  output: Record<string, unknown> | null;
  error: string | null;
}

interface IngestResult {
  entity_id: string;
  entity_name: string;
  filename: string;
  status: string;
  commit_id: string;
  version_id: number | null;
  error?: string;
}

interface FileWorkflowRunResponse {
  ok: boolean;
  workflow: {
    mode: string;
    status: string;
    steps: string[];
  };
  input_file?: {
    originalName?: string;
    storedName?: string;
    size?: number;
    path?: string;
  };
  stage_results: WorkflowStageResult[];
  ingest_results: IngestResult[];
  errors: Array<{ stage: string; message: string }>;
  runtime_root: string;
  started_at?: string;
  finished_at?: string;
}

interface WorkflowEntity {
  id: string;
  name: string;
  summary: string;
  citations: string[];
  properties: Record<string, unknown>;
}

interface WorkflowRelation {
  source_name: string;
  target_name: string;
  relation_type: string;
  evidence: string;
}

interface WorkflowAblation {
  entity_name: string;
  impact_level: string;
  impact_reason: string;
  system_risk: string;
}

interface WorkflowLogItem {
  id: string;
  level: 'info' | 'success' | 'error';
  message: string;
  stage?: string;
  createdAt: string;
}

type StageMeta = {
  key: string;
  short: string;
  title: string;
  detail: string;
  icon: ReactNode;
};

const STAGE_META: StageMeta[] = [
  { key: 'auth_precheck', short: '01', title: '验证', detail: '登录校验与上下文准备', icon: <Radar className="h-4 w-4" /> },
  { key: 'observe', short: '02', title: '观察', detail: '抽取实体与证据片段', icon: <Eye className="h-4 w-4" /> },
  { key: 'relations', short: '03', title: '关系', detail: '组织结构边与依赖', icon: <GitBranchPlus className="h-4 w-4" /> },
  { key: 'ablation', short: '04', title: '消融', detail: '逐实体影响评估', icon: <Waves className="h-4 w-4" /> },
  { key: 'ontology', short: '05', title: '本体', detail: '组装实体 JSON 与汇总', icon: <FileJson className="h-4 w-4" /> },
  { key: 'probability_precheck', short: '06', title: '概率', detail: '预判分数与解释', icon: <BrainCircuit className="h-4 w-4" /> },
  { key: 'ingest', short: '07', title: '入库', detail: '提交 OntoGit 与写回', icon: <Database className="h-4 w-4" /> },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asPlainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getStageOutput(stageResults: WorkflowStageResult[], stageName: string): Record<string, unknown> {
  const stage = stageResults.find((item) => item.stage === stageName);
  return asRecord(stage?.output);
}

function extractEntities(stageResults: WorkflowStageResult[]): WorkflowEntity[] {
  const output = getStageOutput(stageResults, 'observe');
  const entities = Array.isArray(output.entities) ? output.entities : [];
  return entities.map((item) => {
    const record = asRecord(item);
    return {
      id: asText(record.id),
      name: asText(record.name),
      summary: asText(record.summary),
      citations: asStringArray(record.citations),
      properties: asPlainObject(record.properties),
    };
  }).filter((item) => item.id && item.name);
}

function extractRelations(stageResults: WorkflowStageResult[]): WorkflowRelation[] {
  const output = getStageOutput(stageResults, 'relations');
  const relations = Array.isArray(output.relations) ? output.relations : [];
  return relations.map((item) => {
    const record = asRecord(item);
    return {
      source_name: asText(record.source_name),
      target_name: asText(record.target_name),
      relation_type: asText(record.relation_type),
      evidence: asText(record.evidence),
    };
  }).filter((item) => item.source_name && item.target_name && item.relation_type);
}

function extractAblations(stageResults: WorkflowStageResult[]): WorkflowAblation[] {
  const output = getStageOutput(stageResults, 'ablation');
  const ablations = Array.isArray(output.ablation) ? output.ablation : [];
  return ablations.map((item) => {
    const record = asRecord(item);
    return {
      entity_name: asText(record.entity_name),
      impact_level: asText(record.impact_level),
      impact_reason: asText(record.impact_reason),
      system_risk: asText(record.system_risk),
    };
  }).filter((item) => item.entity_name);
}

function extractStageCount(
  stageResults: WorkflowStageResult[],
  stageName: string,
  field: string,
): number | null {
  const stage = stageResults.find((item) => item.stage === stageName);
  const value = stage?.output?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function formatDuration(startedAt?: string | null, finishedAt?: string | null): string {
  if (!startedAt) return '--';
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '--';
  const duration = end - start;
  if (duration < 1000) return `${duration} ms`;
  return `${(duration / 1000).toFixed(1)} s`;
}

function statusTone(status: WorkflowStageResult['status']): string {
  if (status === 'success') return 'text-emerald-500';
  if (status === 'failed') return 'text-red-500';
  if (status === 'running') return 'text-sky-500';
  return 'text-muted-foreground';
}

function stageSurfaceClass(status: WorkflowStageResult['status']): string {
  if (status === 'success') return 'border-emerald-500/30 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.12)]';
  if (status === 'failed') return 'border-red-500/30 bg-red-500/10 shadow-[0_0_0_1px_rgba(239,68,68,0.12)]';
  if (status === 'running') return 'border-sky-500/35 bg-sky-500/10 shadow-[0_0_24px_rgba(14,165,233,0.16)]';
  return 'border-border/50 bg-background/60';
}

function renderJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getStageLlmRaw(stageResults: WorkflowStageResult[], stageName: string): unknown {
  const output = getStageOutput(stageResults, stageName);
  return output.llm_raw;
}

function getStageLlmRawText(stageResults: WorkflowStageResult[], stageName: string): string {
  const output = getStageOutput(stageResults, stageName);
  return asText(output.llm_raw_text);
}

export function FileWorkflowPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(() => getLatestWorkflowSession()?.conversationId ?? null);
  const [projectId, setProjectId] = useState('demo');
  const [workflowModel, setWorkflowModel] = useState('openai/gpt-4o-mini');
  const [workflowConfigLoading, setWorkflowConfigLoading] = useState(false);
  const [workflowConfigSaving, setWorkflowConfigSaving] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('等待文件输入');
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<FileWorkflowRunResponse | null>(null);
  const [logs, setLogs] = useState<WorkflowLogItem[]>([]);
  const completedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    const loadWorkflowConfig = async () => {
      setWorkflowConfigLoading(true);
      try {
        const config = await fetchWorkflowConfig();
        if (config.workflowModel) {
          setWorkflowModel(config.workflowModel);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '读取工作流模型失败');
      } finally {
        setWorkflowConfigLoading(false);
      }
    };

    void loadWorkflowConfig();
  }, []);

  useEffect(() => {
    const latestSession = getLatestWorkflowSession();
    if (!latestSession) return;
    setConversationId(latestSession.conversationId);
    setProjectId(latestSession.projectId || 'demo');
    setLastRunAt(latestSession.lastRunAt);
    setStatusMessage(latestSession.statusMessage);
    setIsRunning(latestSession.isRunning);
    setRunResult(latestSession.runResult);
    setLogs(latestSession.logs);
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    return subscribeWorkflowSession(conversationId, (session) => {
      setProjectId(session.projectId || 'demo');
      setLastRunAt(session.lastRunAt);
      setStatusMessage(session.statusMessage);
      setIsRunning(session.isRunning);
      setRunResult(session.runResult);
      setLogs(session.logs);
    });
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || !runResult || isRunning) return;
    if (completedSessionRef.current === conversationId) return;
    completedSessionRef.current = conversationId;
    if (runResult.ok && projectId.trim()) {
      void fetchKnowledgeGraph({ refresh: true, projectId: projectId.trim() }).catch(() => undefined);
    }
  }, [conversationId, isRunning, projectId, runResult]);

  const fileMeta = useMemo(() => {
    if (selectedFile) {
      return {
        name: selectedFile.name,
        type: selectedFile.type || 'application/octet-stream',
        size: formatFileSize(selectedFile.size),
        updatedAt: new Date(selectedFile.lastModified).toLocaleString(),
      };
    }
    if (!runResult?.input_file?.originalName) return null;
    return {
      name: runResult.input_file.originalName,
      type: 'application/octet-stream',
      size: formatFileSize(Number(runResult.input_file.size || 0)),
      updatedAt: '--',
    };
  }, [runResult?.input_file?.originalName, runResult?.input_file?.size, selectedFile]);

  const resetState = () => {
    if (conversationId && !isRunning) {
      removeWorkflowSession(conversationId);
    }
    setSelectedFile(null);
    setProjectId('demo');
    setLastRunAt(null);
    setStatusMessage('等待文件输入');
    setRunResult(null);
    setLogs([]);
    if (!isRunning) {
      setConversationId(null);
      completedSessionRef.current = null;
    }
  };

  const handleRunWorkflow = async () => {
    if (!selectedFile) {
      setStatusMessage('请先选择文件后再执行工作流');
      return;
    }
    if (!projectId.trim()) {
      setStatusMessage('请先填写 project_id');
      return;
    }

    try {
      completedSessionRef.current = null;
      const nextConversationId = startWorkflowRun({
        file: selectedFile,
        projectId: projectId.trim(),
      });
      setConversationId(nextConversationId);
    } catch (error) {
      const message = error instanceof Error ? error.message : '文件直传失败';
      setStatusMessage(message);
    }
  };

  const handleRetryFromStage = async (startStage: string) => {
    if (!runResult || !projectId.trim() || !conversationId) {
      return;
    }

    try {
      completedSessionRef.current = null;
      retryWorkflowRunFromStage({
        startStage,
        conversationId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '阶段重试失败';
      setStatusMessage(message);
    }
  };

  const handleSaveWorkflowModel = async () => {
    const nextModel = workflowModel.trim();
    if (!nextModel) {
      toast.error('请先填写 workflow 模型名称');
      return;
    }

    setWorkflowConfigSaving(true);
    try {
      const config = await updateWorkflowConfig(nextModel);
      setWorkflowModel(config.workflowModel);
      toast.success(`工作流模型已更新为 ${config.workflowModel}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新工作流模型失败');
    } finally {
      setWorkflowConfigSaving(false);
    }
  };

  const currentResult = runResult;
  const stageResults = currentResult?.stage_results ?? [];
  const entityCount = currentResult ? extractStageCount(stageResults, 'observe', 'entity_count') : null;
  const relationCount = currentResult ? extractStageCount(stageResults, 'relations', 'relation_count') : null;
  const ablationCount = currentResult ? extractStageCount(stageResults, 'ablation', 'ablation_count') : null;
  const precheckStage = currentResult?.stage_results.find((item) => item.stage === 'probability_precheck');
  const precheckItems = Array.isArray(precheckStage?.output?.prechecks) ? precheckStage.output.prechecks : [];
  const firstPrecheck = precheckItems[0] as Record<string, unknown> | undefined;
  const entities = useMemo(() => extractEntities(stageResults), [stageResults]);
  const relations = useMemo(() => extractRelations(stageResults), [stageResults]);
  const ablations = useMemo(() => extractAblations(stageResults), [stageResults]);
  const observeLlmRaw = useMemo(() => getStageLlmRaw(stageResults, 'observe'), [stageResults]);
  const observeLlmRawText = useMemo(() => getStageLlmRawText(stageResults, 'observe'), [stageResults]);
  const relationsLlmRaw = useMemo(() => getStageLlmRaw(stageResults, 'relations'), [stageResults]);
  const relationsLlmRawText = useMemo(() => getStageLlmRawText(stageResults, 'relations'), [stageResults]);
  const ablationLlmRaw = useMemo(() => getStageLlmRaw(stageResults, 'ablation'), [stageResults]);
  const ablationLlmRawText = useMemo(() => getStageLlmRawText(stageResults, 'ablation'), [stageResults]);
  const completedStages = stageResults.filter((stage) => stage.status === 'success').length;
  const failedStages = stageResults.filter((stage) => stage.status === 'failed').length;
  const activeStage = stageResults.find((stage) => stage.status === 'running') ?? null;
  const progressValue = stageResults.length > 0 ? Math.round((completedStages / stageResults.length) * 100) : 0;

  return (
    <div className="h-full w-full overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.12),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] p-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <Card className="overflow-hidden border-border/60 bg-card/80 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur-xl">
          <CardHeader className="border-b border-border/40 bg-[linear-gradient(135deg,rgba(59,130,246,0.12),rgba(139,92,246,0.08),transparent)]">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  实时工作流驾驶舱
                </div>
                <div>
                  <CardTitle className="text-2xl font-black tracking-tight">文件直传七阶段工作流</CardTitle>
                  <CardDescription className="mt-2 max-w-2xl text-sm leading-6">
                    现在不再等待最终结果统一渲染，而是按阶段实时显示抽取进度、状态变化和中间结果，便于观察实体、关系、消融和入库全过程。
                  </CardDescription>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:min-w-[320px]">
                <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">总进度</div>
                  <div className="mt-2 text-2xl font-black">{progressValue}%</div>
                  <Progress value={progressValue} className="mt-3 h-2.5 bg-primary/10" />
                </div>
                <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">当前阶段</div>
                  <div className="mt-2 flex items-center gap-2 text-base font-black">
                    {activeStage ? <Loader2 className="h-4 w-4 animate-spin text-sky-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                    <span>{activeStage ? activeStage.stage : currentResult ? '已完成' : '待开始'}</span>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">{statusMessage}</div>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="grid gap-5 p-6 lg:grid-cols-[1.5fr_1fr]">
            <div className="space-y-5">
              <div className="rounded-2xl border border-border/50 bg-background/80 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground">工作流模型</div>
                    <div className="text-[11px] text-muted-foreground/70">修改后会影响本页与后端的工作流 LLM 调用</div>
                  </div>
                  <Badge variant="outline">{workflowConfigLoading ? '加载中' : '已连接'}</Badge>
                </div>
                <div className="flex flex-col gap-3 md:flex-row">
                  <Input
                    value={workflowModel}
                    onChange={(event) => setWorkflowModel(event.target.value)}
                    placeholder="openai/gpt-4o-mini"
                    className="h-11 rounded-xl border-border/50 bg-background/80 md:flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 rounded-xl"
                    onClick={() => void handleSaveWorkflowModel()}
                    disabled={workflowConfigLoading || workflowConfigSaving}
                  >
                    {workflowConfigSaving ? '保存中...' : '保存模型'}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground">目标 project_id</div>
                  <Input
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                    placeholder="demo"
                    className="h-11 rounded-xl border-border/50 bg-background/80"
                  />
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground">输入文件</div>
                  <Input
                    type="file"
                    className="h-11 rounded-xl border-border/50 bg-background/80"
                    onChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      setSelectedFile(file);
                      setStatusMessage(file ? '文件已选择，可开始流式执行' : '等待文件输入');
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">实体</div>
                  <div className="mt-2 text-2xl font-black">{entityCount ?? 0}</div>
                  <div className="mt-1 text-xs text-muted-foreground">观察阶段实时累积</div>
                </div>
                <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">关系</div>
                  <div className="mt-2 text-2xl font-black">{relationCount ?? 0}</div>
                  <div className="mt-1 text-xs text-muted-foreground">结构边与证据</div>
                </div>
                <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">消融</div>
                  <div className="mt-2 text-2xl font-black">{ablationCount ?? 0}</div>
                  <div className="mt-1 text-xs text-muted-foreground">系统影响评估</div>
                </div>
                <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">预判概率</div>
                  <div className="mt-2 truncate text-lg font-black">
                    {typeof firstPrecheck?.precheck_probability === 'string' ? firstPrecheck.precheck_probability : '--'}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">第一个实体评分快照</div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-border/50 bg-background/75 p-5 shadow-inner">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black">运行摘要</div>
                  <div className="mt-1 text-xs leading-6 text-muted-foreground">
                    展示当前活跃阶段、失败告警和最近一次运行时间。
                  </div>
                </div>
                <Badge variant="outline" className="rounded-full">
                  {currentResult?.workflow.status || 'idle'}
                </Badge>
              </div>

              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-border/50 bg-muted/20 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {failedStages > 0 ? <TriangleAlert className="h-4 w-4 text-red-500" /> : activeStage ? <Loader2 className="h-4 w-4 animate-spin text-sky-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                    {failedStages > 0 ? '存在失败阶段' : activeStage ? '流程正在推进' : currentResult ? '流程已结束' : '等待启动'}
                  </div>
                  <div className="mt-2 text-xs leading-6 text-muted-foreground">{statusMessage}</div>
                </div>

                <div className="rounded-2xl border border-border/50 bg-muted/20 p-4 text-xs leading-7">
                  <div><span className="text-muted-foreground">最近执行：</span>{lastRunAt ?? '--'}</div>
                  <div><span className="text-muted-foreground">成功阶段：</span>{completedStages}/{STAGE_META.length}</div>
                  <div><span className="text-muted-foreground">失败阶段：</span>{failedStages}</div>
                  <div><span className="text-muted-foreground">输入文件：</span>{fileMeta?.name ?? '--'}</div>
                </div>
              </div>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col items-start gap-4 border-t border-border/40 bg-muted/10 px-6 py-5 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-full">{statusMessage}</Badge>
              {fileMeta ? <Badge variant="secondary" className="rounded-full">{fileMeta.size}</Badge> : null}
              {lastRunAt ? <Badge variant="secondary" className="rounded-full">最近执行：{lastRunAt}</Badge> : null}
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" className="rounded-xl" onClick={resetState}>
                <RefreshCcw className="mr-2 h-4 w-4" />
                重置
              </Button>
              <Button
                type="button"
                className="rounded-xl px-5 shadow-lg shadow-primary/20"
                onClick={handleRunWorkflow}
                disabled={!selectedFile || !projectId.trim() || isRunning}
              >
                {isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                {isRunning ? '流式执行中...' : '启动实时工作流'}
              </Button>
            </div>
          </CardFooter>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[1.65fr_1fr]">
          <div className="space-y-6">
            <Card className="border-border/60 bg-card/90 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
              <CardHeader>
                <CardTitle className="text-lg font-black">阶段进度总览</CardTitle>
                <CardDescription>每个阶段都会在开始与完成时即时刷新，支持中间结果先展示、最终结果后补全。</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                  {STAGE_META.map((meta) => {
                    const stage = stageResults.find((item) => item.stage === meta.key) ?? {
                      stage: meta.key,
                      order: Number(meta.short),
                      status: 'pending' as const,
                      started_at: null,
                      finished_at: null,
                      output: null,
                      error: null,
                    };
                    return (
                      <div
                        key={meta.key}
                        className={cn(
                          'group relative overflow-hidden rounded-3xl border p-4 transition-all duration-300',
                          'before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-primary/50 before:to-transparent',
                          stageSurfaceClass(stage.status),
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground">
                              <span>{meta.short}</span>
                              <span className={cn('inline-flex items-center gap-1', statusTone(stage.status))}>
                                {meta.icon}
                                {meta.title}
                              </span>
                            </div>
                            <div className="text-sm font-semibold">{meta.detail}</div>
                          </div>
                          <div className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-full border',
                            stage.status === 'running' && 'border-sky-500/40 bg-sky-500/15',
                            stage.status === 'success' && 'border-emerald-500/40 bg-emerald-500/15',
                            stage.status === 'failed' && 'border-red-500/40 bg-red-500/15',
                            stage.status === 'pending' && 'border-border/50 bg-background/80',
                          )}>
                            {stage.status === 'running' ? <Loader2 className="h-4 w-4 animate-spin text-sky-500" /> : null}
                            {stage.status === 'success' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : null}
                            {stage.status === 'failed' ? <TriangleAlert className="h-4 w-4 text-red-500" /> : null}
                            {stage.status === 'pending' ? <Activity className="h-4 w-4 text-muted-foreground" /> : null}
                          </div>
                        </div>

                        <div className="mt-4 flex items-center justify-between text-xs">
                          <span className={cn('font-semibold', statusTone(stage.status))}>状态：{stage.status}</span>
                          <span className="text-muted-foreground">耗时：{formatDuration(stage.started_at, stage.finished_at)}</span>
                        </div>

                        {stage.error ? (
                          <div className="mt-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-xs leading-6 text-red-600">
                            {stage.error}
                          </div>
                        ) : null}

                        {stage.output ? (
                          <div className="mt-3 rounded-2xl border border-border/40 bg-background/60 p-3 text-xs text-muted-foreground">
                            <div className="line-clamp-4 whitespace-pre-wrap break-all">
                              {renderJson(stage.output)}
                            </div>
                          </div>
                        ) : null}

                        {!isRunning && currentResult && (stage.status === 'failed' || (failedStages > 0 && stage.status === 'pending')) ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="mt-3 rounded-xl"
                            onClick={() => void handleRetryFromStage(stage.stage)}
                          >
                            从这一步重试
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/90">
              <CardHeader>
                <CardTitle className="text-lg font-black">中间结果面板</CardTitle>
                <CardDescription>观察、关系、消融、本体和入库结果会在阶段完成后立即出现在这里。</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="entities" className="space-y-4">
                  <TabsList className="grid h-auto w-full grid-cols-6 rounded-2xl border border-border/40 bg-muted/30 p-1">
                    <TabsTrigger value="entities" className="rounded-xl text-xs">实体</TabsTrigger>
                    <TabsTrigger value="relations" className="rounded-xl text-xs">关系</TabsTrigger>
                    <TabsTrigger value="ablation" className="rounded-xl text-xs">消融</TabsTrigger>
                    <TabsTrigger value="ingest" className="rounded-xl text-xs">入库</TabsTrigger>
                    <TabsTrigger value="debug" className="rounded-xl text-xs">LLM Debug</TabsTrigger>
                    <TabsTrigger value="raw" className="rounded-xl text-xs">原始 JSON</TabsTrigger>
                  </TabsList>

                  <TabsContent value="entities" className="mt-0">
                    {entities.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-8 text-sm text-muted-foreground">
                        观察阶段尚未完成，实体抽取结果会实时出现在这里。
                      </div>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2">
                        {entities.map((entity) => (
                          <div key={entity.id} className="rounded-3xl border border-border/50 bg-background/80 p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-base font-black">{entity.name}</div>
                                <div className="mt-1 text-xs leading-6 text-muted-foreground">{entity.summary || '无摘要'}</div>
                              </div>
                              <Badge variant="outline" className="rounded-full">{Object.keys(entity.properties).length} 属性</Badge>
                            </div>
                            <div className="mt-4 space-y-2">
                              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">引用片段</div>
                              {entity.citations.length === 0 ? (
                                <div className="text-xs text-muted-foreground">暂无引用</div>
                              ) : (
                                <div className="space-y-2 text-xs leading-6">
                                  {entity.citations.slice(0, 3).map((citation, index) => (
                                    <div key={`${entity.id}-${index}`} className="rounded-2xl border border-border/40 bg-muted/20 p-3">
                                      {citation}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="relations" className="mt-0">
                    {relations.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-8 text-sm text-muted-foreground">
                        关系阶段尚未完成，结构边与证据会在这里更新。
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {relations.map((relation, index) => (
                          <div key={`${relation.source_name}-${relation.target_name}-${index}`} className="rounded-3xl border border-border/50 bg-background/80 p-4">
                            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                              <span>{relation.source_name}</span>
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              <Badge variant="secondary" className="rounded-full">{relation.relation_type}</Badge>
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              <span>{relation.target_name}</span>
                            </div>
                            <div className="mt-3 text-xs leading-6 text-muted-foreground">
                              {relation.evidence || '暂无证据说明'}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="ablation" className="mt-0">
                    {ablations.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-8 text-sm text-muted-foreground">
                        消融阶段尚未完成，风险和影响评估会在这里出现。
                      </div>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2">
                        {ablations.map((item, index) => (
                          <div key={`${item.entity_name}-${index}`} className="rounded-3xl border border-border/50 bg-background/80 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-base font-black">{item.entity_name}</div>
                              <Badge variant="outline" className="rounded-full">{item.impact_level || 'unknown'}</Badge>
                            </div>
                            <div className="mt-3 text-xs leading-6 text-muted-foreground">{item.impact_reason}</div>
                            <div className="mt-3 rounded-2xl border border-border/40 bg-muted/20 px-3 py-2 text-xs">
                              系统风险：{item.system_risk || 'unknown'}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="ingest" className="mt-0">
                    {currentResult?.ingest_results.length ? (
                      <div className="overflow-hidden rounded-3xl border border-border/50">
                        <div className="grid grid-cols-[1.2fr_1.2fr_0.8fr_1fr_0.8fr] bg-muted/20 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                          <div>实体</div>
                          <div>文件</div>
                          <div>状态</div>
                          <div>commit</div>
                          <div>version</div>
                        </div>
                        {currentResult.ingest_results.map((item) => (
                          <div
                            key={`${item.entity_id}-${item.filename}`}
                            className="grid grid-cols-[1.2fr_1.2fr_0.8fr_1fr_0.8fr] items-center border-t border-border/40 bg-background/80 px-4 py-3 text-xs"
                          >
                            <div>{item.entity_name}</div>
                            <div className="truncate">{item.filename}</div>
                            <div className={cn(item.status === 'failed' ? 'text-red-500' : 'text-emerald-600')}>{item.status}</div>
                            <div className="truncate">{item.commit_id || '-'}</div>
                            <div>{item.version_id ?? '-'}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-8 text-sm text-muted-foreground">
                        入库阶段尚未完成，写入结果会在这里出现。
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="debug" className="mt-0">
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/8 p-4 text-xs leading-6 text-amber-700 dark:text-amber-300">
                        这里显示工作流各阶段拿到的 LLM 原始回复；即使阶段失败，也会尽量保留原始文本和解析后的 JSON，方便排查字段名、格式和后处理过滤问题。
                      </div>

                      {[
                        { key: 'observe', title: '节点1-观察 原始返回', value: observeLlmRaw, rawText: observeLlmRawText },
                        { key: 'relations', title: '节点2-操作 原始返回', value: relationsLlmRaw, rawText: relationsLlmRawText },
                        { key: 'ablation', title: '节点3-消融 原始返回', value: ablationLlmRaw, rawText: ablationLlmRawText },
                      ].map((item) => (
                        <div key={item.key} className="overflow-hidden rounded-3xl border border-border/50">
                          <div className="border-b border-border/40 bg-muted/20 px-4 py-3 text-sm font-bold">
                            {item.title}
                          </div>
                          <div className="space-y-0">
                            <div className="border-b border-border/20 bg-slate-900 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                              原始文本回复
                            </div>
                            <pre className="max-h-[220px] overflow-auto bg-slate-950/95 p-4 text-xs leading-6 text-slate-100">
                              {item.rawText || '该阶段尚未记录原始文本回复。'}
                            </pre>
                            <div className="border-b border-t border-border/20 bg-slate-900 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                              解析后 JSON
                            </div>
                            <pre className="max-h-[320px] overflow-auto bg-slate-950/95 p-4 text-xs leading-6 text-slate-100">
                              {item.value === undefined ? '该阶段尚未返回可展示的 JSON。' : renderJson(item.value)}
                            </pre>
                          </div>
                        </div>
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="raw" className="mt-0">
                    <pre className="max-h-[520px] overflow-auto rounded-3xl border border-border/50 bg-slate-950/95 p-4 text-xs leading-6 text-slate-100">
                      {renderJson(currentResult || { empty: true })}
                    </pre>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="border-border/60 bg-card/90">
              <CardHeader>
                <CardTitle className="text-lg font-black">实时控制台</CardTitle>
                <CardDescription>状态消息、阶段开始/完成与异常信息都会按时间顺序落在这里。</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[420px] pr-4">
                  <div className="space-y-3">
                    {logs.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-6 text-sm text-muted-foreground">
                        启动工作流后，这里会出现实时日志。
                      </div>
                    ) : (
                      logs.map((log) => (
                        <div key={log.id} className="rounded-2xl border border-border/50 bg-background/80 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              {log.level === 'success' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : null}
                              {log.level === 'error' ? <TriangleAlert className="h-4 w-4 text-red-500" /> : null}
                              {log.level === 'info' ? <Activity className="h-4 w-4 text-sky-500" /> : null}
                              <span className="text-xs font-semibold">{log.stage || 'system'}</span>
                            </div>
                            <span className="text-[11px] text-muted-foreground">{log.createdAt}</span>
                          </div>
                          <div className="mt-2 text-xs leading-6 text-muted-foreground">{log.message}</div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/90">
              <CardHeader>
                <CardTitle className="text-lg font-black">文件侧写</CardTitle>
                <CardDescription>执行前后的输入信息、项目目标和基本元数据。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {fileMeta ? (
                  <>
                    <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                      <div className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">文件名</div>
                      <div className="mt-2 font-semibold">{fileMeta.name}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                        <div className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">类型</div>
                        <div className="mt-2 break-all text-xs">{fileMeta.type}</div>
                      </div>
                      <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                        <div className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">大小</div>
                        <div className="mt-2 font-semibold">{fileMeta.size}</div>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                      <div className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">修改时间</div>
                      <div className="mt-2 text-xs">{fileMeta.updatedAt}</div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-6 text-sm text-muted-foreground">
                    请选择文件后查看元数据侧写。
                  </div>
                )}

                <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">目标项目</div>
                  <div className="mt-2 font-semibold">{projectId || '--'}</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
