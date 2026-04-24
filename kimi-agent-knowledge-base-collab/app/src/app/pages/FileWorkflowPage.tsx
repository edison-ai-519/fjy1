import { useMemo, useState } from 'react';
import { FileUp, Play, RefreshCcw } from 'lucide-react';

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
import { buildApiUrl } from '@/shared/api/http';

interface WorkflowStageResult {
  stage: string;
  order: number;
  status: 'pending' | 'running' | 'success' | 'failed';
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
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function extractStageCount(
  stageResults: WorkflowStageResult[],
  stageName: string,
  field: string,
): number | null {
  const stage = stageResults.find((item) => item.stage === stageName);
  const value = stage?.output?.[field];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

export function FileWorkflowPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [projectId, setProjectId] = useState('demo');
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('等待文件输入');
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<FileWorkflowRunResponse | null>(null);

  const fileMeta = useMemo(() => {
    if (!selectedFile) {
      return null;
    }
    return {
      name: selectedFile.name,
      type: selectedFile.type || 'application/octet-stream',
      size: formatFileSize(selectedFile.size),
      updatedAt: new Date(selectedFile.lastModified).toLocaleString(),
    };
  }, [selectedFile]);

  const handleRunWorkflow = async () => {
    if (!selectedFile) {
      setStatusMessage('请先选择文件后再执行工作流');
      return;
    }
    if (!projectId.trim()) {
      setStatusMessage('请先填写 project_id');
      return;
    }

    setIsRunning(true);
    setStatusMessage('正在直传文件并执行六阶段线性工作流...');
    setRunResult(null);

    try {
      const response = await fetch(
        buildApiUrl(
          `/api/workflow/file/run?fileName=${encodeURIComponent(selectedFile.name)}&projectId=${encodeURIComponent(projectId.trim())}`,
        ),
        {
          method: 'POST',
          headers: {
            'Content-Type': selectedFile.type || 'application/octet-stream',
          },
          body: selectedFile,
        },
      );
      const rawText = await response.text();
      const payload = rawText ? JSON.parse(rawText) as FileWorkflowRunResponse : null;

      if (payload && typeof payload === 'object' && Array.isArray(payload.stage_results)) {
        setRunResult(payload);
        setLastRunAt(new Date().toLocaleString());
        if (payload.ok) {
          setStatusMessage('工作流执行完成，结果已生成。');
        } else {
          const firstError = payload.errors?.[0]?.message || '工作流失败';
          setStatusMessage(firstError);
        }
      } else if (!response.ok) {
        throw new Error(`请求失败：${response.status}`);
      } else {
        setStatusMessage('执行完成，但返回结果格式不符合预期。');
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '文件直传失败');
    } finally {
      setIsRunning(false);
    }
  };

  const entityCount = runResult ? extractStageCount(runResult.stage_results, 'observe', 'entity_count') : null;
  const relationCount = runResult ? extractStageCount(runResult.stage_results, 'relations', 'relation_count') : null;
  const ablationCount = runResult ? extractStageCount(runResult.stage_results, 'ablation', 'ablation_count') : null;
  const precheckStage = runResult?.stage_results?.find((item) => item.stage === 'probability_precheck');

  return (
    <div className="h-full w-full overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-5xl space-y-4">
        <Card className="border-border/60">
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileUp className="h-5 w-5 text-primary" />
              <CardTitle>文件直传六阶段工作流（线性）</CardTitle>
            </div>
            <CardDescription>
              文件将直接上传并按固定顺序执行：观察、关系、消融、本体、概率、入库。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-muted-foreground">目标 project_id</div>
                <Input
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  placeholder="demo"
                />
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-muted-foreground">输入文件</div>
                <Input
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    setSelectedFile(file);
                    setStatusMessage(file ? '文件已选择，等待执行' : '等待文件输入');
                  }}
                />
              </div>
            </div>

            {fileMeta ? (
              <div className="rounded-lg border border-border/60 bg-muted/20 p-4 text-sm">
                <div><span className="text-muted-foreground">文件名：</span>{fileMeta.name}</div>
                <div><span className="text-muted-foreground">类型：</span>{fileMeta.type}</div>
                <div><span className="text-muted-foreground">大小：</span>{fileMeta.size}</div>
                <div><span className="text-muted-foreground">修改时间：</span>{fileMeta.updatedAt}</div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-6 text-sm text-muted-foreground">
                请选择一个文件作为工作流输入。
              </div>
            )}
          </CardContent>
          <CardFooter className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{statusMessage}</Badge>
              {lastRunAt ? <Badge variant="secondary">最近执行：{lastRunAt}</Badge> : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSelectedFile(null);
                  setStatusMessage('等待文件输入');
                  setRunResult(null);
                  setLastRunAt(null);
                  setProjectId('demo');
                }}
              >
                <RefreshCcw className="h-4 w-4" />
                重置
              </Button>
              <Button type="button" onClick={handleRunWorkflow} disabled={!selectedFile || !projectId.trim() || isRunning}>
                <Play className="h-4 w-4" />
                {isRunning ? '执行中...' : '执行工作流'}
              </Button>
            </div>
          </CardFooter>
        </Card>

        {runResult ? (
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle>执行结果</CardTitle>
              <CardDescription>
                工作流状态：{runResult.workflow.status}（模式：{runResult.workflow.mode}）
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <div className="rounded-lg border border-border/50 p-3">
                  <div className="text-xs text-muted-foreground">实体数</div>
                  <div className="text-xl font-bold">{entityCount ?? '-'}</div>
                </div>
                <div className="rounded-lg border border-border/50 p-3">
                  <div className="text-xs text-muted-foreground">关系数</div>
                  <div className="text-xl font-bold">{relationCount ?? '-'}</div>
                </div>
                <div className="rounded-lg border border-border/50 p-3">
                  <div className="text-xs text-muted-foreground">消融项</div>
                  <div className="text-xl font-bold">{ablationCount ?? '-'}</div>
                </div>
                <div className="rounded-lg border border-border/50 p-3">
                  <div className="text-xs text-muted-foreground">预判概率</div>
                  <div className="text-base font-bold truncate">
                    {typeof precheckStage?.output?.precheck_probability === 'string'
                      ? precheckStage.output.precheck_probability
                      : '-'}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border/50 p-3">
                <div className="mb-2 text-xs font-semibold text-muted-foreground">六阶段状态</div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {runResult.stage_results.map((stage) => (
                    <div key={stage.stage} className="rounded border border-border/40 p-2">
                      <div className="font-semibold">{stage.order}. {stage.stage}</div>
                      <div className="text-xs text-muted-foreground">状态：{stage.status}</div>
                      {stage.error ? <div className="text-xs text-red-500 mt-1">错误：{stage.error}</div> : null}
                    </div>
                  ))}
                </div>
              </div>

              {runResult.errors.length > 0 ? (
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                  <div className="mb-2 text-xs font-semibold text-red-500">错误定位</div>
                  {runResult.errors.map((item, index) => (
                    <div key={`${item.stage}-${index}`} className="text-xs text-red-500">
                      {item.stage}: {item.message}
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="rounded-lg border border-border/50 p-3">
                <div className="mb-2 text-xs font-semibold text-muted-foreground">入库结果</div>
                {runResult.ingest_results.length === 0 ? (
                  <div className="text-xs text-muted-foreground">暂无入库记录</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="py-1 pr-2">实体</th>
                          <th className="py-1 pr-2">文件</th>
                          <th className="py-1 pr-2">状态</th>
                          <th className="py-1 pr-2">commit_id</th>
                          <th className="py-1 pr-2">version_id</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runResult.ingest_results.map((item) => (
                          <tr key={`${item.entity_id}-${item.filename}`} className="border-t border-border/30">
                            <td className="py-1 pr-2">{item.entity_name}</td>
                            <td className="py-1 pr-2">{item.filename}</td>
                            <td className="py-1 pr-2">{item.status}</td>
                            <td className="py-1 pr-2">{item.commit_id || '-'}</td>
                            <td className="py-1 pr-2">{item.version_id ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
