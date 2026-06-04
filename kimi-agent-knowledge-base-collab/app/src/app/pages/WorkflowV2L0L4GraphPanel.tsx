import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, ZoomIn, ZoomOut, RefreshCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { copyCodeToClipboard } from '@/components/assistant/AssistantMarkdown';
import { toast } from 'sonner';

import type { WorkflowV2L0L4Graph, WorkflowV2L0L4GraphEdge, WorkflowV2L0L4GraphNode } from './workflowV2L0L4View';

type WorkflowV2L0L4GraphPanelProps = {
  graph: WorkflowV2L0L4Graph;
  selectedNodeId?: string;
  onNodeSelect?: (nodeId: string) => void;
};

void React;

const LAYER_STYLES: Record<WorkflowV2L0L4GraphNode['layer'], { fill: string; stroke: string; text: string }> = {
  L0: { fill: 'rgba(245,158,11,0.10)', stroke: 'rgba(245,158,11,0.45)', text: '#92400e' },
  L1: { fill: 'rgba(14,165,233,0.10)', stroke: 'rgba(14,165,233,0.45)', text: '#0369a1' },
  L2: { fill: 'rgba(16,185,129,0.10)', stroke: 'rgba(16,185,129,0.42)', text: '#047857' },
  L3: { fill: 'rgba(168,85,247,0.10)', stroke: 'rgba(168,85,247,0.42)', text: '#7c3aed' },
  L4: { fill: 'rgba(244,63,94,0.10)', stroke: 'rgba(244,63,94,0.42)', text: '#be123c' },
};

const EDGE_STYLES: Record<WorkflowV2L0L4GraphEdge['type'], { stroke: string; dash?: string }> = {
  mapped_to_atom: { stroke: 'rgba(245,158,11,0.75)', dash: '6 6' },
  supports: { stroke: 'rgba(14,165,233,0.72)' },
};

const PENDING_EDGE_STYLE = {
  stroke: 'rgba(148,163,184,0.68)',
  dash: '8 8',
};

function buildEdgePath(source: WorkflowV2L0L4GraphNode, target: WorkflowV2L0L4GraphNode) {
  const sourceX = source.x + source.width / 2;
  const targetX = target.x + target.width / 2;
  const sourceIsAboveTarget = source.y <= target.y;
  const sourceY = sourceIsAboveTarget ? source.y + source.height : source.y;
  const targetY = sourceIsAboveTarget ? target.y : target.y + target.height;
  const bend = Math.max(48, Math.abs(targetY - sourceY) * 0.35);
  const controlY = sourceY + (targetY > sourceY ? bend : -bend);
  return `M ${sourceX} ${sourceY} C ${sourceX} ${controlY}, ${targetX} ${controlY}, ${targetX} ${targetY}`;
}

function getDirectIncomingEdges(nodeId: string, edges: WorkflowV2L0L4GraphEdge[]) {
  return edges.filter((edge) => edge.target === nodeId);
}

function getOutgoingEdges(nodeId: string, edges: WorkflowV2L0L4GraphEdge[]) {
  return edges.filter((edge) => edge.source === nodeId);
}

function getNodeDetailLabel(node: WorkflowV2L0L4GraphNode) {
  if (node.layer === 'L0') {
    return '固定本体原子';
  }
  if (!node.object_level) {
    return node.layer;
  }
  return node.status === 'pending' ? `${node.object_level} · 待补齐` : node.object_level;
}

function escapeMermaidLabel(value: string) {
  return value.replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function buildWorkflowV2L0L4Mermaid(graph: WorkflowV2L0L4Graph) {
  const nodeIds = new Map(graph.nodes.map((node, index) => [node.id, `n${index}`] as const));
  const lines = ['flowchart TD'];

  for (const node of graph.nodes) {
    const mermaidId = nodeIds.get(node.id);
    if (!mermaidId) {
      continue;
    }
    lines.push(`  ${mermaidId}["${escapeMermaidLabel(node.label)}"]`);
  }

  for (const edge of graph.edges) {
    const sourceId = nodeIds.get(edge.source);
    const targetId = nodeIds.get(edge.target);
    if (!sourceId || !targetId) {
      continue;
    }
    const connector = edge.status === 'pending' ? '-.->' : '-->';
    lines.push(`  ${sourceId} ${connector} ${targetId}`);
  }

  return lines.join('\n');
}

function renderNode({
  node,
  selected,
  dimmed,
  onSelect,
}: {
  node: WorkflowV2L0L4GraphNode;
  selected: boolean;
  dimmed: boolean;
  onSelect: (nodeId: string) => void;
}) {
  const style = LAYER_STYLES[node.layer];
  const pending = node.status === 'pending';

  return (
    <g
      key={node.id}
      className="cursor-pointer"
      onClick={() => onSelect(node.id)}
    >
      <rect
        x={node.x}
        y={node.y}
        rx="18"
        width={node.width}
        height={node.height}
        fill={selected ? 'rgba(14,165,233,0.16)' : pending ? 'rgba(148,163,184,0.12)' : style.fill}
        stroke={selected ? 'rgba(14,165,233,0.88)' : pending ? 'rgba(148,163,184,0.48)' : style.stroke}
        strokeWidth={selected ? 2.4 : 1.4}
        strokeDasharray={pending ? '6 6' : undefined}
        opacity={dimmed ? 0.22 : 1}
      />
      <text
        x={node.x + node.width / 2}
        y={node.y + 24}
        textAnchor="middle"
        fontSize="14"
        fontWeight="700"
        fill={selected ? '#0369a1' : pending ? 'rgba(71,85,105,0.75)' : style.text}
        opacity={dimmed ? 0.3 : 1}
      >
        {node.label}
      </text>
      <text
        x={node.x + node.width / 2}
        y={node.y + 42}
        textAnchor="middle"
        fontSize="9"
        fontWeight="700"
        letterSpacing="0.08em"
        fill="rgba(100,116,139,0.78)"
        opacity={dimmed ? 0.3 : 1}
      >
        {`${node.layer} · ${getNodeDetailLabel(node)}`}
      </text>
      {pending ? (
        <text
          x={node.x + node.width / 2}
          y={node.y + 53}
          textAnchor="middle"
          fontSize="8"
          fontWeight="700"
          letterSpacing="0.08em"
          fill="rgba(100,116,139,0.78)"
          opacity={dimmed ? 0.3 : 1}
        >
          待补齐
        </text>
      ) : null}
    </g>
  );
}

export function WorkflowV2L0L4GraphPanel({ graph, selectedNodeId, onNodeSelect }: WorkflowV2L0L4GraphPanelProps) {
  const [internalSelectedNodeId, setInternalSelectedNodeId] = useState('');
  const [graphZoom, setGraphZoom] = useState(1);
  const [mermaidCopied, setMermaidCopied] = useState(false);

  useEffect(() => {
    if (selectedNodeId !== undefined) {
      return;
    }
    setInternalSelectedNodeId((current) => (
      current && graph.nodes.some((node) => node.id === current) ? current : ''
    ));
  }, [graph.nodes, selectedNodeId]);

  const activeNodeId = selectedNodeId ?? internalSelectedNodeId;
  const handleSelectNode = (nodeId: string) => {
    onNodeSelect?.(nodeId);
    if (selectedNodeId === undefined) {
      setInternalSelectedNodeId(nodeId);
    }
  };

  const nodesById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node] as const)), [graph.nodes]);
  const incomingEdges = useMemo(
    () => graph.edges.filter((edge) => edge.target === activeNodeId),
    [activeNodeId, graph.edges],
  );
  const outgoingEdges = useMemo(
    () => graph.edges.filter((edge) => edge.source === activeNodeId),
    [activeNodeId, graph.edges],
  );

  const selectedNode = activeNodeId ? nodesById.get(activeNodeId) ?? null : null;
  const focusedNodeIds = useMemo(() => {
    if (!activeNodeId) {
      return new Set<string>();
    }

    const nodeIds = new Set<string>([activeNodeId]);
    const upwardQueue: string[] = [activeNodeId];
    const downwardQueue: string[] = [activeNodeId];
    const visitedUpward = new Set<string>();
    const visitedDownward = new Set<string>();

    while (upwardQueue.length > 0) {
      const currentNodeId = upwardQueue.shift();
      if (!currentNodeId || visitedUpward.has(currentNodeId)) {
        continue;
      }
      visitedUpward.add(currentNodeId);

      for (const edge of getDirectIncomingEdges(currentNodeId, graph.edges)) {
        nodeIds.add(edge.source);
        upwardQueue.push(edge.source);
      }
    }

    while (downwardQueue.length > 0) {
      const currentNodeId = downwardQueue.shift();
      if (!currentNodeId || visitedDownward.has(currentNodeId)) {
        continue;
      }
      visitedDownward.add(currentNodeId);

      for (const edge of getOutgoingEdges(currentNodeId, graph.edges)) {
        nodeIds.add(edge.target);
        downwardQueue.push(edge.target);
      }
    }

    return nodeIds;
  }, [activeNodeId, graph.edges]);
  const focusedEdgeIds = useMemo(() => {
    if (!activeNodeId) {
      return new Set<string>();
    }

    const edgeIds = new Set<string>();
    const upwardQueue: string[] = [activeNodeId];
    const downwardQueue: string[] = [activeNodeId];
    const visitedUpward = new Set<string>();
    const visitedDownward = new Set<string>();

    while (upwardQueue.length > 0) {
      const currentNodeId = upwardQueue.shift();
      if (!currentNodeId || visitedUpward.has(currentNodeId)) {
        continue;
      }
      visitedUpward.add(currentNodeId);

      for (const edge of getDirectIncomingEdges(currentNodeId, graph.edges)) {
        edgeIds.add(edge.id);
        upwardQueue.push(edge.source);
      }
    }

    while (downwardQueue.length > 0) {
      const currentNodeId = downwardQueue.shift();
      if (!currentNodeId || visitedDownward.has(currentNodeId)) {
        continue;
      }
      visitedDownward.add(currentNodeId);

      for (const edge of getOutgoingEdges(currentNodeId, graph.edges)) {
        edgeIds.add(edge.id);
        downwardQueue.push(edge.target);
      }
    }

    return edgeIds;
  }, [activeNodeId, graph.edges]);
  const nodeBounds = useMemo(() => {
    if (graph.nodes.length === 0) {
      return {
        minX: 0,
        minY: 0,
        maxX: 960,
        maxY: 720,
      };
    }
    const minX = Math.min(...graph.nodes.map((node) => node.x));
    const minY = Math.min(...graph.nodes.map((node) => node.y));
    const maxX = Math.max(...graph.nodes.map((node) => node.x + node.width));
    const maxY = Math.max(...graph.nodes.map((node) => node.y + node.height));
    return { minX, minY, maxX, maxY };
  }, [graph.nodes]);
  const canvasWidth = Math.max(960, Math.ceil(nodeBounds.maxX - nodeBounds.minX + 240));
  const canvasHeight = Math.max(720, Math.ceil(nodeBounds.maxY - nodeBounds.minY + 180));
  const contentShiftX = graph.nodes.length > 0 ? (120 - nodeBounds.minX) : 0;
  const contentShiftY = graph.nodes.length > 0 ? (40 - nodeBounds.minY) : 0;
  const pendingNodes = graph.nodes.filter((node) => node.status === 'pending');
  const selectedNodeEvidence = selectedNode?.evidence ?? [];
  const mermaidCode = useMemo(() => buildWorkflowV2L0L4Mermaid(graph), [graph]);

  const handleClearFocus = () => {
    handleSelectNode('');
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

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
          <div className="text-xs font-semibold text-muted-foreground">节点总数</div>
          <div className="mt-2 text-sm font-black">{graph.summary.total_nodes}</div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
          <div className="text-xs font-semibold text-muted-foreground">L0 原子</div>
          <div className="mt-2 text-sm font-black">{graph.summary.layer_counts.L0}</div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
          <div className="text-xs font-semibold text-muted-foreground">supports 边</div>
          <div className="mt-2 text-sm font-black">{graph.summary.supports_edge_count}</div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
          <div className="text-xs font-semibold text-muted-foreground">pending 节点</div>
          <div className="mt-2 text-sm font-black">{graph.summary.pending_node_count}</div>
        </div>
      </div>

      {graph.summary.empty_reason ? (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm leading-6 text-amber-950/80">
          {graph.summary.empty_reason}
        </div>
      ) : null}

      <div className="rounded-[30px] border border-primary/20 bg-gradient-to-b from-primary/5 to-background/80 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="rounded-full">L0 固定 5 原子</Badge>
          <Badge variant="outline" className="rounded-full">L1-L4 按 object_level 映射</Badge>
          <Badge variant="outline" className="rounded-full">supports 由 contains 反向派生</Badge>
          {pendingNodes.length > 0 ? (
            <Badge variant="secondary" className="rounded-full">
              {pendingNodes.length} 个 L1 节点待补齐 L0 证据
            </Badge>
          ) : null}
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="relative">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setGraphZoom((current) => Math.max(0.6, Number((current - 0.2).toFixed(2))))}
                  disabled={graph.nodes.length === 0}
                >
                  <ZoomOut className="mr-2 h-4 w-4" />
                  缩小
                </Button>
                <Badge variant="outline" className="rounded-full px-3">{Math.round(graphZoom * 100)}%</Badge>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setGraphZoom((current) => Math.min(2.4, Number((current + 0.2).toFixed(2))))}
                  disabled={graph.nodes.length === 0}
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
                  disabled={graph.nodes.length === 0}
                >
                  还原
                </Button>
                {selectedNode ? (
                  <Badge variant="secondary" className="rounded-full px-3">
                    已聚焦 {selectedNode.label}
                  </Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selectedNode ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={handleClearFocus}
                  >
                    <RefreshCcw className="mr-2 h-4 w-4" />
                    清除聚焦
                  </Button>
                ) : null}
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
            </div>
            <div className="overflow-auto rounded-2xl border border-border/50 bg-background/60">
              <svg
                viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
                className="block"
                style={{
                  width: `${Math.round(canvasWidth * graphZoom)}px`,
                  height: `${Math.round(canvasHeight * graphZoom)}px`,
                  minWidth: `${Math.round(canvasWidth * graphZoom)}px`,
                  minHeight: `${Math.round(canvasHeight * graphZoom)}px`,
                }}
              >
                <defs>
                  <marker id="workflow-v2-l0l4-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(14,165,233,0.72)" />
                  </marker>
                  <marker id="workflow-v2-l0l4-atom-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(245,158,11,0.76)" />
                  </marker>
                </defs>

                <g transform={`translate(${contentShiftX}, ${contentShiftY})`}>
                  {graph.edges.map((edge) => {
                    const source = nodesById.get(edge.source);
                    const target = nodesById.get(edge.target);
                    if (!source || !target) {
                      return null;
                    }
                    const style = edge.status === 'pending' ? PENDING_EDGE_STYLE : EDGE_STYLES[edge.type];
                    const isFocusedEdge = activeNodeId ? focusedEdgeIds.has(edge.id) : false;
                    const edgeOpacity = activeNodeId
                      ? (isFocusedEdge ? 1 : edge.status === 'pending' ? 0.16 : 0.08)
                      : edge.status === 'pending' ? 0.30 : 0.22;
                    return (
                      <path
                        key={edge.id}
                        d={buildEdgePath(source, target)}
                        fill="none"
                        stroke={style.stroke}
                        strokeWidth={edge.type === 'supports' ? 2.8 : 2.1}
                        strokeDasharray={style.dash}
                        strokeLinecap="round"
                        markerEnd={edge.status === 'pending' ? 'url(#workflow-v2-l0l4-arrow)' : edge.type === 'supports' ? 'url(#workflow-v2-l0l4-arrow)' : 'url(#workflow-v2-l0l4-atom-arrow)'}
                        opacity={edgeOpacity}
                      />
                    );
                  })}

                  {graph.nodes.map((node) => renderNode({
                    node,
                    selected: node.id === activeNodeId,
                    dimmed: Boolean(activeNodeId) && !focusedNodeIds.has(node.id),
                    onSelect: handleSelectNode,
                  }))}
                </g>
              </svg>
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
            {selectedNode ? (
              <div className="space-y-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-lg font-black">{selectedNode.label}</div>
                    <Badge variant="secondary">{selectedNode.layer}</Badge>
                    {selectedNode.object_level ? <Badge variant="outline">{selectedNode.object_level}</Badge> : null}
                    <Badge variant={selectedNode.status === 'pending' ? 'outline' : 'default'}>
                      {selectedNode.status === 'pending' ? '待补齐' : '已识别'}
                    </Badge>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {selectedNode.primary_atom ? `主 L0 原子：${selectedNode.primary_atom}` : '当前节点暂无主 L0 原子。'}
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm leading-6 text-foreground/90">
                  {selectedNode.layer === 'L0'
                    ? '这是固定的本体原子，位于图谱最上层，用于支撑上层对象的关键词映射。'
                    : selectedNode.status === 'pending'
                      ? '该 L1 节点暂未找到足够的关键词证据，需要后续补齐。'
                      : '该对象已进入 L0-L4 本体图，图中会展示它与 L0 原子以及上层支撑关系。'}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                    <div className="text-xs font-semibold text-muted-foreground">图层状态</div>
                    <div className="mt-2 text-sm font-black text-foreground">
                      {selectedNode.layer} · {getNodeDetailLabel(selectedNode)}
                    </div>
                    <div className="mt-2 text-xs leading-5 text-muted-foreground">
                      坐标 {Math.round(selectedNode.x)}, {Math.round(selectedNode.y)}，尺寸 {selectedNode.width} × {selectedNode.height}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                    <div className="text-xs font-semibold text-muted-foreground">关联摘要</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="outline">入边 {incomingEdges.length}</Badge>
                      <Badge variant="outline">出边 {outgoingEdges.length}</Badge>
                      <Badge variant="outline">链路节点 {focusedNodeIds.size}</Badge>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                  <div className="text-xs font-semibold text-muted-foreground">证据</div>
                  <div className="mt-3 space-y-2 text-sm text-foreground/85">
                    {selectedNodeEvidence.length > 0 ? selectedNodeEvidence.slice(0, 5).map((item, index) => (
                      <div key={`l0l4-evidence-${index}`} className="rounded-xl border border-border/50 bg-background/70 px-3 py-3">
                        {item}
                      </div>
                    )) : (
                      <div className="text-sm text-muted-foreground">当前节点暂无证据。</div>
                    )}
                  </div>
                </div>

                {incomingEdges.length > 0 || outgoingEdges.length > 0 ? (
                  <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                    <div className="text-xs font-semibold text-muted-foreground">直接关系</div>
                    <div className="mt-3 space-y-2 text-sm text-foreground/85">
                      {[...incomingEdges, ...outgoingEdges].slice(0, 6).map((edge, index) => {
                        const source = nodesById.get(edge.source);
                        const target = nodesById.get(edge.target);
                        if (!source || !target) {
                          return null;
                        }
                        const direction = edge.target === selectedNode.id ? '支撑该节点' : '由该节点支撑';
                        return (
                          <div key={`l0l4-edge-${index}`} className="rounded-xl border border-border/50 bg-background/70 px-3 py-3">
                            <div className="font-medium text-foreground/90">{source.label} → {target.label}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {edge.type} · {edge.derived_from} · {direction}
                            </div>
                            {edge.label ? <div className="mt-2 text-xs text-muted-foreground">标签：{edge.label}</div> : null}
                            {edge.evidence?.length ? <div className="mt-2 text-xs leading-5 text-muted-foreground">证据：{edge.evidence.slice(0, 3).join(' / ')}</div> : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {pendingNodes.length > 0 ? (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3">
                    <div className="text-xs font-semibold text-amber-900/80">待补齐证据的 L1 节点</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {pendingNodes.map((node) => (
                        <Badge key={node.id} variant="outline" className={cn('rounded-full border-amber-500/30 bg-white/70 text-amber-900')}>
                          {node.label}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex h-full min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-border/60 bg-muted/10 p-6 text-center text-sm leading-6 text-muted-foreground">
                点击图中的节点后，这里会显示该节点的层级、证据和直接关系。
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
