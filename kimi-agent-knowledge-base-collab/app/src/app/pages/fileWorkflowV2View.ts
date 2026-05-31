import type { WorkflowV2Result, WorkflowV2RunSession, WorkflowV2StageResult } from '@/features/workflow/runtimeV2';

export interface WorkflowV2GraphNode {
  id: string;
  label: string;
  depth: number;
  x: number;
  y: number;
  isIsolated: boolean;
  structureStatus: string;
  structureReason: string;
}

export interface WorkflowV2GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
}

export interface WorkflowV2SiblingImpactEdge {
  id: string;
  sourceId: string;
  targetId: string;
  parentId: string;
  impactLevel: 'none' | 'low' | 'medium' | 'high';
}

export interface WorkflowV2ImpactEdgeStyle {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
}

export interface WorkflowV2WritebackSummary {
  totalCount: number;
  successCount: number;
  failedCount: number;
  lastCommitId: string;
  lastVersionId: number | null;
  inferenceProbability: number | null;
  inferenceReason: string;
}

export interface WorkflowV2GraphViewOptions {
  hideIsolatedNodes?: boolean;
}

export interface WorkflowV2SystemStructureNode {
  id: string;
  name: string;
  normalizedName: string;
  coreFunction: string;
  childCount: number;
  isLeaf: boolean;
  hiddenDescendantCount: number;
  depth: number;
  children: WorkflowV2SystemStructureNode[];
}

export interface WorkflowV2StructureSummary {
  containmentCount: number;
  leafCount: number;
  maxDepth: number;
  hiddenDescendantCount: number;
}

export interface WorkflowV2SystemDecompositionView {
  root: WorkflowV2SystemStructureNode | null;
  summary: WorkflowV2StructureSummary;
  emptyReason: string;
}

interface WorkflowV2SystemObject {
  id: string;
  name: string;
  normalizedName: string;
  coreFunction: string;
}

interface WorkflowV2SystemEdge {
  sourceId: string;
  targetId: string;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asArray<T = Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function normalizeWorkflowV2SystemObjects(objects: unknown): WorkflowV2SystemObject[] {
  return asArray(objects)
    .map((item) => asRecord(item))
    .map((item) => ({
      id: asText(item.object_id),
      name: asText(item.object_name) || asText(item.object_id),
      normalizedName: asText(item.normalized_name),
      coreFunction: asText(item.core_function),
    }))
    .filter((item) => item.id);
}

function normalizeWorkflowV2SystemEdges(edges: unknown, objectIds: Set<string>): WorkflowV2SystemEdge[] {
  const edgeMap = new Map<string, WorkflowV2SystemEdge>();

  for (const item of asArray(edges)) {
    const edge = asRecord(item);
    const sourceId = asText(edge.source_object_id);
    const targetId = asText(edge.target_object_id);
    if (!sourceId || !targetId || sourceId === targetId) {
      continue;
    }
    if (!objectIds.has(sourceId) || !objectIds.has(targetId)) {
      continue;
    }
    const key = `${sourceId}->${targetId}`;
    if (!edgeMap.has(key)) {
      edgeMap.set(key, { sourceId, targetId });
    }
  }

  return [...edgeMap.values()];
}

function createWorkflowV2Adjacency(edges: WorkflowV2SystemEdge[], objectIds: Set<string>) {
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  const degree = new Map<string, number>();

  for (const objectId of objectIds) {
    adjacency.set(objectId, []);
    indegree.set(objectId, 0);
    degree.set(objectId, 0);
  }

  for (const edge of edges) {
    adjacency.get(edge.sourceId)?.push(edge.targetId);
    indegree.set(edge.targetId, (indegree.get(edge.targetId) ?? 0) + 1);
    degree.set(edge.sourceId, (degree.get(edge.sourceId) ?? 0) + 1);
    degree.set(edge.targetId, (degree.get(edge.targetId) ?? 0) + 1);
  }

  return { adjacency, indegree, degree };
}

function collectWorkflowV2ReachableDescendants(
  nodeId: string,
  adjacency: Map<string, string[]>,
  path: Set<string>,
): Set<string> {
  const collected = new Set<string>();
  const nextPath = new Set(path);
  nextPath.add(nodeId);

  for (const childId of adjacency.get(nodeId) ?? []) {
    if (nextPath.has(childId)) {
      continue;
    }
    collected.add(childId);
    for (const descendantId of collectWorkflowV2ReachableDescendants(childId, adjacency, nextPath)) {
      collected.add(descendantId);
    }
  }

  return collected;
}

function countWorkflowV2LeafNodes(
  rootId: string,
  adjacency: Map<string, string[]>,
): number {
  const visited = new Set<string>();
  let leafCount = 0;

  const visit = (nodeId: string) => {
    if (visited.has(nodeId)) {
      return;
    }
    visited.add(nodeId);
    const children = adjacency.get(nodeId) ?? [];
    if (children.length === 0) {
      leafCount += 1;
      return;
    }
    for (const childId of children) {
      visit(childId);
    }
  };

  visit(rootId);
  return leafCount;
}

function normalizeImpactLevel(value: unknown): WorkflowV2SiblingImpactEdge['impactLevel'] {
  const normalized = asText(value).trim().toLowerCase();
  if (normalized === 'none' || normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }
  return 'none';
}

function getImpactLevelRank(level: WorkflowV2SiblingImpactEdge['impactLevel']) {
  if (level === 'high') return 3;
  if (level === 'medium') return 2;
  if (level === 'low') return 1;
  return 0;
}

export function getWorkflowV2StageOutput<T extends Record<string, unknown> = Record<string, unknown>>(
  stageResults: WorkflowV2StageResult[],
  stageName: string,
): T {
  const stage = stageResults.find((item) => item.stage === stageName);
  return asRecord(stage?.output) as T;
}

export function extractWorkflowV2Summary(result: WorkflowV2Result | null) {
  const meta = asRecord(result?.meta);
  return {
    chunkCount: Number(meta.total_chunks ?? 0) || 0,
    windowCount: Number(meta.total_windows ?? 0) || 0,
    objectCount: Number(meta.total_objects ?? 0) || 0,
    edgeCount: Number(meta.total_edges ?? 0) || 0,
    isDag: Boolean(meta.is_dag),
  };
}

export function canWriteWorkflowV2Session(session: WorkflowV2RunSession | null): boolean {
  if (!session || session.isRunning || !session.runResult) {
    return false;
  }

  const runResult = session.runResult;
  const objects = Array.isArray(runResult.result?.objects) ? runResult.result.objects : [];
  if (objects.length > 0) {
    return true;
  }

  return Array.isArray(runResult.stage_results) && runResult.stage_results.some((item) => item.status === 'success');
}

export function extractWorkflowV2WritebackSummary(payload: unknown): WorkflowV2WritebackSummary {
  const root = asRecord(payload);
  const ingestResults = asArray(root.ingest_results).map((item) => asRecord(item));
  const successItems = ingestResults.filter((item) => asText(item.status) !== 'failed');
  const failedCount = ingestResults.length - successItems.length;
  const latestSuccess = successItems.at(-1) ?? null;
  const inferenceSource = latestSuccess
    ? asRecord(asRecord(latestSuccess.raw).inference_result || asRecord(latestSuccess.raw).inference)
    : {};

  return {
    totalCount: ingestResults.length,
    successCount: successItems.length,
    failedCount,
    lastCommitId: asText(latestSuccess?.commit_id),
    lastVersionId: asNumber(latestSuccess?.version_id),
    inferenceProbability: asNumber(inferenceSource.probability),
    inferenceReason: asText(inferenceSource.reason),
  };
}

export function pickWorkflowV2PrimaryRoot(objects: unknown, edges: unknown): string {
  const normalizedObjects = normalizeWorkflowV2SystemObjects(objects);
  if (normalizedObjects.length === 0) {
    return '';
  }

  const objectIds = new Set(normalizedObjects.map((item) => item.id));
  const normalizedEdges = normalizeWorkflowV2SystemEdges(edges, objectIds);
  const { adjacency, indegree, degree } = createWorkflowV2Adjacency(normalizedEdges, objectIds);
  const objectById = new Map(normalizedObjects.map((item) => [item.id, item] as const));

  const rootCandidates = normalizedEdges.length > 0
    ? normalizedObjects.filter((item) => (indegree.get(item.id) ?? 0) === 0)
    : [];

  const descendantCountCache = new Map<string, number>();
  const getDescendantCount = (nodeId: string) => {
    if (descendantCountCache.has(nodeId)) {
      return descendantCountCache.get(nodeId) ?? 0;
    }
    const count = collectWorkflowV2ReachableDescendants(nodeId, adjacency, new Set()).size;
    descendantCountCache.set(nodeId, count);
    return count;
  };

  const compareObjects = (leftId: string, rightId: string) => {
    const left = objectById.get(leftId);
    const right = objectById.get(rightId);
    const descendantDiff = getDescendantCount(rightId) - getDescendantCount(leftId);
    if (descendantDiff !== 0) {
      return descendantDiff;
    }

    const childDiff = (adjacency.get(rightId)?.length ?? 0) - (adjacency.get(leftId)?.length ?? 0);
    if (childDiff !== 0) {
      return childDiff;
    }

    const degreeDiff = (degree.get(rightId) ?? 0) - (degree.get(leftId) ?? 0);
    if (degreeDiff !== 0) {
      return degreeDiff;
    }

    return (left?.name || leftId).localeCompare(right?.name || rightId, 'zh-Hans-CN');
  };

  if (rootCandidates.length > 0) {
    return [...rootCandidates].sort((left, right) => compareObjects(left.id, right.id))[0]?.id ?? '';
  }

  return [...normalizedObjects].sort((left, right) => compareObjects(left.id, right.id))[0]?.id ?? '';
}

export function buildWorkflowV2SystemDecompositionView(input: {
  objects: unknown;
  edges: unknown;
  maxDepth?: number;
}): WorkflowV2SystemDecompositionView {
  const normalizedObjects = normalizeWorkflowV2SystemObjects(input.objects);
  const depthLimit = Number.isFinite(input.maxDepth) ? Math.max(0, Math.floor(input.maxDepth as number)) : 2;

  if (normalizedObjects.length === 0) {
    return {
      root: null,
      summary: {
        containmentCount: 0,
        leafCount: 0,
        maxDepth: 0,
        hiddenDescendantCount: 0,
      },
      emptyReason: '当前还没有可展示的对象，待前置阶段产出对象后会在这里生成系统拆解视图。',
    };
  }

  const objectIds = new Set(normalizedObjects.map((item) => item.id));
  const normalizedEdges = normalizeWorkflowV2SystemEdges(input.edges, objectIds);
  const objectById = new Map(normalizedObjects.map((item) => [item.id, item] as const));
  const { adjacency } = createWorkflowV2Adjacency(normalizedEdges, objectIds);
  const rootId = pickWorkflowV2PrimaryRoot(input.objects, input.edges);

  if (!rootId) {
    return {
      root: null,
      summary: {
        containmentCount: 0,
        leafCount: 0,
        maxDepth: 0,
        hiddenDescendantCount: 0,
      },
      emptyReason: '当前还没有形成稳定的系统结构根节点，请等待图构建完成后再查看。',
    };
  }

  let deepestVisibleDepth = 0;
  const buildNode = (
    nodeId: string,
    depth: number,
    path: Set<string>,
  ): { node: WorkflowV2SystemStructureNode; visibleIds: Set<string> } | null => {
    if (path.has(nodeId)) {
      return null;
    }

    const object = objectById.get(nodeId);
    if (!object) {
      return null;
    }

    deepestVisibleDepth = Math.max(deepestVisibleDepth, depth);
    const nextPath = new Set(path);
    nextPath.add(nodeId);
    const directChildIds = (adjacency.get(nodeId) ?? []).filter((childId) => !nextPath.has(childId));
    const totalDescendantIds = collectWorkflowV2ReachableDescendants(nodeId, adjacency, path);

    if (depth >= depthLimit || directChildIds.length === 0) {
      return {
        node: {
          id: nodeId,
          name: object.name,
          normalizedName: object.normalizedName,
          coreFunction: object.coreFunction,
          childCount: directChildIds.length,
          isLeaf: directChildIds.length === 0,
          hiddenDescendantCount: totalDescendantIds.size,
          depth,
          children: [],
        },
        visibleIds: new Set<string>(),
      };
    }

    const children: WorkflowV2SystemStructureNode[] = [];
    const visibleIds = new Set<string>();
    for (const childId of directChildIds) {
      const builtChild = buildNode(childId, depth + 1, nextPath);
      if (!builtChild) {
        continue;
      }
      children.push(builtChild.node);
      visibleIds.add(childId);
      for (const visibleId of builtChild.visibleIds) {
        visibleIds.add(visibleId);
      }
    }

    return {
      node: {
        id: nodeId,
        name: object.name,
        normalizedName: object.normalizedName,
        coreFunction: object.coreFunction,
        childCount: directChildIds.length,
        isLeaf: directChildIds.length === 0,
        hiddenDescendantCount: Math.max(totalDescendantIds.size - visibleIds.size, 0),
        depth,
        children,
      },
      visibleIds,
    };
  };

  const builtRoot = buildNode(rootId, 0, new Set());
  const reachableNodeIds = new Set<string>([rootId, ...collectWorkflowV2ReachableDescendants(rootId, adjacency, new Set())]);
  const containmentCount = normalizedEdges.filter((edge) => (
    reachableNodeIds.has(edge.sourceId) && reachableNodeIds.has(edge.targetId)
  )).length;
  const leafCount = countWorkflowV2LeafNodes(rootId, adjacency);
  const emptyReason = normalizedEdges.length === 0
    ? '当前还没有形成可展示的系统拆解结构，待图构建阶段产出包含关系后会在这里显示。'
    : '';

  return {
    root: builtRoot?.node ?? null,
    summary: {
      containmentCount,
      leafCount,
      maxDepth: deepestVisibleDepth + 1,
      hiddenDescendantCount: builtRoot?.node.hiddenDescendantCount ?? 0,
    },
    emptyReason,
  };
}

export function extractWorkflowV2SiblingImpactEdges(parentSummaries: unknown): WorkflowV2SiblingImpactEdge[] {
  const edgeMap = new Map<string, WorkflowV2SiblingImpactEdge>();

  for (const summary of asArray(parentSummaries)) {
    const summaryRecord = asRecord(summary);
    const parentId = asText(summaryRecord.parent_object_id);
    for (const impact of asArray(summaryRecord.sibling_dependency_table)) {
      const impactRecord = asRecord(impact);
      const sourceId = asText(impactRecord.ablated_child_object_id);
      const targetId = asText(impactRecord.target_sibling_object_id);
      if (!sourceId || !targetId || sourceId === targetId) {
        continue;
      }
      const impactLevel = normalizeImpactLevel(impactRecord.impact_level);
      const nextEdge: WorkflowV2SiblingImpactEdge = {
        id: `${parentId || 'parent'}:${sourceId}->${targetId}`,
        sourceId,
        targetId,
        parentId,
        impactLevel,
      };
      const edgeKey = `${sourceId}->${targetId}`;
      const existing = edgeMap.get(edgeKey);
      if (!existing || getImpactLevelRank(impactLevel) > getImpactLevelRank(existing.impactLevel)) {
        edgeMap.set(edgeKey, nextEdge);
      }
    }
  }

  return [...edgeMap.values()];
}

export function getWorkflowV2ImpactEdgeStyle(impactLevel: string): WorkflowV2ImpactEdgeStyle {
  const level = normalizeImpactLevel(impactLevel);
  if (level === 'high') {
    return {
      stroke: 'rgba(239,68,68,0.8)',
      strokeWidth: 4,
    };
  }
  if (level === 'medium') {
    return {
      stroke: 'rgba(245,158,11,0.78)',
      strokeWidth: 3.25,
    };
  }
  if (level === 'low') {
    return {
      stroke: 'rgba(14,165,233,0.72)',
      strokeWidth: 2.5,
      strokeDasharray: '8 6',
    };
  }
  return {
    stroke: 'rgba(148,163,184,0.58)',
    strokeWidth: 1.75,
    strokeDasharray: '4 8',
  };
}

function getConnectedObjectIds(edges: Record<string, unknown>[]) {
  const connectedIds = new Set<string>();
  for (const edge of edges) {
    const sourceId = asText(edge.source_object_id);
    const targetId = asText(edge.target_object_id);
    if (sourceId) {
      connectedIds.add(sourceId);
    }
    if (targetId) {
      connectedIds.add(targetId);
    }
  }
  return connectedIds;
}

function filterGraphObjects(
  objects: Record<string, unknown>[],
  edges: Record<string, unknown>[],
  options?: WorkflowV2GraphViewOptions,
) {
  if (options?.hideIsolatedNodes !== false) {
    const connectedIds = getConnectedObjectIds(edges);
    return objects.filter((item) => connectedIds.has(asText(item.object_id)));
  }
  return objects;
}

function buildWorkflowV2GraphLayoutFromParts(input: {
  objects: unknown;
  edges: unknown;
  options?: WorkflowV2GraphViewOptions;
}): {
  nodes: WorkflowV2GraphNode[];
  edges: WorkflowV2GraphEdge[];
} {
  const edges = asArray(input.edges).map((item) => asRecord(item));
  const objects = filterGraphObjects(
    asArray(input.objects).map((item) => asRecord(item)),
    edges,
    input.options,
  );
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const depthMap = new Map<string, number>();

  for (const object of objects) {
    const objectId = asText(object.object_id);
    if (!objectId) continue;
    indegree.set(objectId, 0);
    adjacency.set(objectId, []);
    depthMap.set(objectId, 0);
  }

  const normalizedEdges: WorkflowV2GraphEdge[] = [];
  for (const edge of edges) {
    const sourceId = asText(edge.source_object_id);
    const targetId = asText(edge.target_object_id);
    if (!sourceId || !targetId || !indegree.has(sourceId) || !indegree.has(targetId)) {
      continue;
    }
    normalizedEdges.push({
      id: asText(edge.edge_id) || `${sourceId}-${targetId}`,
      sourceId,
      targetId,
    });
    indegree.set(targetId, (indegree.get(targetId) ?? 0) + 1);
    adjacency.get(sourceId)?.push(targetId);
  }

  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([objectId]) => objectId);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const nextDepth = depthMap.get(current) ?? 0;
    for (const target of adjacency.get(current) ?? []) {
      depthMap.set(target, Math.max(depthMap.get(target) ?? 0, nextDepth + 1));
      indegree.set(target, (indegree.get(target) ?? 1) - 1);
      if ((indegree.get(target) ?? 0) === 0) {
        queue.push(target);
      }
    }
  }

  const columns = new Map<number, string[]>();
  for (const object of objects) {
    const objectId = asText(object.object_id);
    if (!objectId) continue;
    const depth = depthMap.get(objectId) ?? 0;
    const current = columns.get(depth) ?? [];
    current.push(objectId);
    columns.set(depth, current);
  }

  const nodes: WorkflowV2GraphNode[] = [];
  const sortedColumns = [...columns.entries()].sort((a, b) => a[0] - b[0]);
  for (const [depth, columnNodes] of sortedColumns) {
    columnNodes.forEach((nodeId, index) => {
      const object = objects.find((item) => asText(item.object_id) === nodeId);
      nodes.push({
        id: nodeId,
        label: asText(object?.object_name) || nodeId,
        depth,
        x: 140 + depth * 220,
        y: 90 + index * 120,
        isIsolated: asBoolean(object?.is_isolated),
        structureStatus: asText(object?.structure_status),
        structureReason: asText(object?.structure_reason),
      });
    });
  }

  return {
    nodes,
    edges: normalizedEdges,
  };
}

export function buildWorkflowV2GraphLayout(result: WorkflowV2Result | null, options?: WorkflowV2GraphViewOptions): {
  nodes: WorkflowV2GraphNode[];
  edges: WorkflowV2GraphEdge[];
} {
  return buildWorkflowV2GraphLayoutFromParts({
    objects: result?.objects,
    edges: result?.edges,
    options,
  });
}

export function buildWorkflowV2GraphLayoutFromStageData(input: {
  objects: unknown;
  edges: unknown;
  options?: WorkflowV2GraphViewOptions;
}): {
  nodes: WorkflowV2GraphNode[];
  edges: WorkflowV2GraphEdge[];
} {
  return buildWorkflowV2GraphLayoutFromParts(input);
}

function escapeMermaidLabel(value: string) {
  return value.replace(/"/g, '\\"');
}

function buildWorkflowV2MermaidFromParts(input: {
  objects: unknown;
  edges: unknown;
  options?: WorkflowV2GraphViewOptions;
}) {
  const edges = asArray(input.edges).map((item) => asRecord(item));
  const objects = filterGraphObjects(
    asArray(input.objects).map((item) => asRecord(item)),
    edges,
    input.options,
  );
  if (objects.length === 0) {
    return '';
  }

  const idMap = new Map<string, string>();
  const lines = ['flowchart LR'];

  objects.forEach((object, index) => {
    const objectId = asText(object.object_id);
    if (!objectId) {
      return;
    }
    const mermaidId = `n${index + 1}`;
    idMap.set(objectId, mermaidId);
    lines.push(`  ${mermaidId}["${escapeMermaidLabel(asText(object.object_name) || objectId)}"]`);
  });

  edges.forEach((edge) => {
    const sourceId = idMap.get(asText(edge.source_object_id));
    const targetId = idMap.get(asText(edge.target_object_id));
    if (!sourceId || !targetId) {
      return;
    }
    lines.push(`  ${sourceId} --> ${targetId}`);
  });

  return lines.join('\n');
}

export function buildWorkflowV2Mermaid(result: WorkflowV2Result | null, options?: WorkflowV2GraphViewOptions) {
  return buildWorkflowV2MermaidFromParts({
    objects: result?.objects,
    edges: result?.edges,
    options,
  });
}

export function buildWorkflowV2MermaidFromStageData(input: {
  objects: unknown;
  edges: unknown;
  options?: WorkflowV2GraphViewOptions;
}) {
  return buildWorkflowV2MermaidFromParts(input);
}
