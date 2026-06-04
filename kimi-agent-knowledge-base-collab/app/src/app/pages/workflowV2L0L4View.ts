export const L0_ATOMS = [
  '时间',
  '空间',
  '事件',
  '数量',
  '能量',
] as const;

const L0_FALLBACK_ATOM = '事件';

export const OBJECT_LEVEL_TO_LAYER = {
  component: 'L1',
  function_unit: 'L2',
  subsystem: 'L3',
  system: 'L4',
} as const;

export interface WorkflowV2L0L4GraphNode {
  id: string;
  label: string;
  layer: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  object_level?: keyof typeof OBJECT_LEVEL_TO_LAYER;
  source_object_id?: string;
  status?: 'normal' | 'pending';
  primary_atom?: string;
  evidence?: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkflowV2L0L4GraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'mapped_to_atom' | 'supports';
  derived_from: 'contains' | 'l0_keyword_rule';
  status?: 'normal' | 'pending';
  evidence?: string[];
  label?: string;
}

export interface WorkflowV2L0L4GraphSummary {
  layer_counts: Record<'L0' | 'L1' | 'L2' | 'L3' | 'L4', number>;
  total_nodes: number;
  total_edges: number;
  mapped_atom_edge_count: number;
  supports_edge_count: number;
  pending_node_count: number;
  recognized_object_level_count: number;
  empty_reason: string;
}

export interface WorkflowV2L0L4Graph {
  nodes: WorkflowV2L0L4GraphNode[];
  edges: WorkflowV2L0L4GraphEdge[];
  summary: WorkflowV2L0L4GraphSummary;
}

export interface BuildWorkflowV2L0L4GraphInput {
  objects: unknown[];
  edges: unknown[];
}

type WorkflowV2L0L4Object = {
  object_id: string;
  object_name: string;
  normalized_name: string;
  raw_object_level: string;
  object_level: keyof typeof OBJECT_LEVEL_TO_LAYER;
  core_function: string;
  citations: string[];
  citation: string[];
  reason: string;
  properties: Record<string, unknown>;
};

type WorkflowV2L0L4NodeDraft = {
  id: string;
  label: string;
  status?: 'normal' | 'pending';
  primary_atom?: string;
  evidence?: string[];
  object_level?: keyof typeof OBJECT_LEVEL_TO_LAYER;
  source_object_id?: string;
};

type WorkflowV2L0L4EdgeRecord = {
  edge_id: string;
  source_object_id: string;
  target_object_id: string;
  relation: string;
  citation: string;
  reason: string;
};

const L0_ATOM_KEYWORDS: Record<(typeof L0_ATOMS)[number], string[]> = {
  时间: ['时间', '日期', '周期', '阶段', '时刻', '频率', '延迟', '持续', '开始', '结束', '先后', '同步', '异步'],
  空间: ['空间', '区域', '范围', '位置', '坐标', '布局', '方向', '距离', '路径', '容量', '体积', '面积', '高度', '宽度', '长度'],
  事件: ['事件', '触发', '请求', '响应', '报警', '故障', '执行', '动作', '启动', '停止', '切换', '异常', '变化', '运行', '调用'],
  数量: ['数量', '数值', '阈值', '比例', '频率', '参数', '大小', '长度', '宽度', '高度', '重量', '个数', '次数', '速率', '精度'],
  能量: ['能量', '功率', '电压', '电流', '电能', '热量', '热能', '机械能', '动能', '势能', '压力', '温度', '流量', '负载', '消耗', '供能', '耗能', '转换效率'],
};

const OBJECT_LEVEL_RANK: Record<keyof typeof OBJECT_LEVEL_TO_LAYER, number> = {
  component: 0,
  function_unit: 1,
  subsystem: 2,
  system: 3,
};

export const LAYER_Y: Record<'L0' | 'L1' | 'L2' | 'L3' | 'L4', number> = {
  L0: 40,
  L1: 220,
  L2: 400,
  L3: 580,
  L4: 760,
};

const KNOWN_OBJECT_LEVELS = new Set<keyof typeof OBJECT_LEVEL_TO_LAYER>([
  'component',
  'function_unit',
  'subsystem',
  'system',
]);

const OBJECT_LEVEL_ALIASES: Record<string, keyof typeof OBJECT_LEVEL_TO_LAYER> = {
  sub_system: 'subsystem',
  subsystem_level: 'subsystem',
  module: 'function_unit',
  function: 'function_unit',
  function_module: 'function_unit',
  unit: 'function_unit',
  part: 'component',
  element: 'component',
  device: 'component',
  entity: 'component',
  object: 'component',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asTextArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => asText(item)).filter(Boolean) : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeWhitespace(value: unknown) {
  return asText(value).replace(/\s+/g, ' ');
}

function normalizeObjectLevel(value: unknown): keyof typeof OBJECT_LEVEL_TO_LAYER {
  const text = String(value ?? '').trim().toLowerCase();
  if (KNOWN_OBJECT_LEVELS.has(text as keyof typeof OBJECT_LEVEL_TO_LAYER)) {
    return text as keyof typeof OBJECT_LEVEL_TO_LAYER;
  }

  return OBJECT_LEVEL_ALIASES[text] ?? 'component';
}

function isRecognizedObjectLevel(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase();
  return KNOWN_OBJECT_LEVELS.has(text as keyof typeof OBJECT_LEVEL_TO_LAYER)
    || Boolean(OBJECT_LEVEL_ALIASES[text]);
}

function getObjectLevelRank(value: unknown) {
  return OBJECT_LEVEL_RANK[normalizeObjectLevel(value)] ?? 0;
}

function buildObjectText(record: WorkflowV2L0L4Object) {
  return [
    record.object_name,
    record.normalized_name,
    record.core_function,
    ...record.citations,
    ...record.citation,
    record.reason,
  ]
    .join(' ')
    .toLowerCase();
}

function extractObjectRecord(item: unknown): WorkflowV2L0L4Object | null {
  const record = asRecord(item);
  const objectId = asText(record.object_id);
  if (!objectId) {
    return null;
  }

  const rawObjectLevel = asText(record.object_level).trim().toLowerCase();

  return {
    object_id: objectId,
    object_name: asText(record.object_name) || objectId,
    normalized_name: asText(record.normalized_name),
    raw_object_level: rawObjectLevel,
    object_level: normalizeObjectLevel(record.object_level),
    core_function: asText(record.core_function),
    citations: uniqueStrings([...asTextArray(record.citations), ...asTextArray(record.citation)]),
    citation: uniqueStrings(asTextArray(record.citation)),
    reason: asText(record.reason),
    properties: asRecord(record.properties),
  };
}

function extractEdgeRecord(item: unknown): WorkflowV2L0L4EdgeRecord | null {
  const record = asRecord(item);
  const sourceObjectId = asText(record.source_object_id);
  const targetObjectId = asText(record.target_object_id);
  if (!sourceObjectId || !targetObjectId || sourceObjectId === targetObjectId) {
    return null;
  }

  return {
    edge_id: asText(record.edge_id) || `${sourceObjectId}->${targetObjectId}->contains`,
    source_object_id: sourceObjectId,
    target_object_id: targetObjectId,
    relation: asText(record.relation) || 'contains',
    citation: asText(record.citation),
    reason: asText(record.reason),
  };
}

function detectAtomMatches(record: WorkflowV2L0L4Object) {
  const text = normalizeWhitespace(buildObjectText(record)).toLowerCase();
  const matches = L0_ATOMS.map((atom) => {
    const keywords = L0_ATOM_KEYWORDS[atom];
    const matchedKeywords = uniqueStrings(keywords.filter((keyword) => text.includes(keyword.toLowerCase())));
    return {
      atom,
      keywords: matchedKeywords,
      score: matchedKeywords.length,
    };
  }).filter((item) => item.score > 0);

  return matches.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return L0_ATOMS.indexOf(left.atom) - L0_ATOMS.indexOf(right.atom);
  });
}

function buildLayerNodes(
  layer: 'L0' | 'L1' | 'L2' | 'L3' | 'L4',
  items: WorkflowV2L0L4NodeDraft[],
  yOffset: number,
  centerX: number,
  width = 180,
  height = 56,
) {
  const totalWidth = items.length > 0 ? (items.length - 1) * 240 + width : 0;
  const xOffset = centerX - totalWidth / 2;

  return items.map((item, index) => ({
    id: item.id,
    label: item.label,
    layer,
    object_level: item.object_level,
    source_object_id: item.source_object_id,
    status: item.status ?? 'normal',
    primary_atom: item.primary_atom,
    evidence: item.evidence ?? [],
    x: xOffset + index * 220,
    y: yOffset,
    width,
    height,
  }));
}

export function buildWorkflowV2L0L4Graph(input: BuildWorkflowV2L0L4GraphInput): WorkflowV2L0L4Graph {
  const objects = (Array.isArray(input.objects) ? input.objects : [])
    .map((item) => extractObjectRecord(item))
    .filter((item): item is WorkflowV2L0L4Object => Boolean(item));
  const edges = (Array.isArray(input.edges) ? input.edges : [])
    .map((item) => extractEdgeRecord(item))
    .filter((item): item is WorkflowV2L0L4EdgeRecord => Boolean(item));

  const objectById = new Map(objects.map((item) => [item.object_id, item] as const));
  const objectNodes: WorkflowV2L0L4GraphNode[] = [];
  const nodeByObjectId = new Map<string, WorkflowV2L0L4GraphNode>();
  const recognizedObjectCount = objects.filter((object) => isRecognizedObjectLevel(object.raw_object_level)).length;
  const shouldRenderObjectLayers = recognizedObjectCount > 0;

  const layerBuckets: Record<'L1' | 'L2' | 'L3' | 'L4', WorkflowV2L0L4Object[]> = {
    L1: [],
    L2: [],
    L3: [],
    L4: [],
  };

  if (shouldRenderObjectLayers) {
    for (const object of objects) {
      const layer = OBJECT_LEVEL_TO_LAYER[object.object_level];
      layerBuckets[layer].push(object);
    }
  }

  const layerOrder: Array<'L1' | 'L2' | 'L3' | 'L4'> = ['L1', 'L2', 'L3', 'L4'];
  layerOrder.forEach((layer) => {
    const layerObjects = layerBuckets[layer].slice().sort((left, right) => left.object_name.localeCompare(right.object_name, 'zh-Hans-CN'));
    const y = LAYER_Y[layer];
    const nodes = buildLayerNodes(
      layer,
      layerObjects.map((object) => {
        const atomMatches = layer === 'L1' ? detectAtomMatches(object) : [];
        const primaryMatch = atomMatches[0] ?? null;
        return {
          id: object.object_id,
          label: object.object_name,
          object_level: object.object_level,
          source_object_id: object.object_id,
          status: layer === 'L1' && atomMatches.length === 0 ? 'pending' : 'normal',
          primary_atom: primaryMatch?.atom,
          evidence: layer === 'L1' ? uniqueStrings(atomMatches.flatMap((item) => item.keywords)) : [],
        };
      }),
      y,
      720,
      180,
      58,
    );

    nodes.forEach((node) => {
      objectNodes.push(node);
      nodeByObjectId.set(node.id, node);
    });
  });

  const l0Nodes: WorkflowV2L0L4GraphNode[] = buildLayerNodes(
    'L0',
    L0_ATOMS.map((atom) => ({
      id: `l0:${atom}`,
      label: atom,
      status: 'normal' as const,
      evidence: [atom],
    })),
    40,
    720,
    180,
    54,
  );

  const l0NodeMap = new Map(l0Nodes.map((node) => [node.id, node] as const));
  const nodes = [...l0Nodes, ...objectNodes];
  const supportEdges: WorkflowV2L0L4GraphEdge[] = [];
  const atomEdges: WorkflowV2L0L4GraphEdge[] = [];

  for (const object of objects) {
    if (OBJECT_LEVEL_TO_LAYER[object.object_level] !== 'L1') {
      continue;
    }
    const matches = detectAtomMatches(object);
    if (matches.length > 0) {
      for (const match of matches) {
        const atomNode = l0NodeMap.get(`l0:${match.atom}`);
        if (!atomNode) {
          continue;
        }
        atomEdges.push({
          id: `${object.object_id}->l0:${match.atom}->mapped_to_atom`,
          source: atomNode.id,
          target: object.object_id,
          type: 'mapped_to_atom',
          derived_from: 'l0_keyword_rule',
          status: 'normal',
          evidence: match.keywords,
          label: match.atom,
        });
      }
    } else {
      const fallbackAtomNode = l0NodeMap.get(`l0:${L0_FALLBACK_ATOM}`) ?? l0Nodes[0] ?? null;
      if (fallbackAtomNode) {
        atomEdges.push({
          id: `${object.object_id}->${fallbackAtomNode.id}->mapped_to_atom_fallback`,
          source: fallbackAtomNode.id,
          target: object.object_id,
          type: 'mapped_to_atom',
          derived_from: 'l0_keyword_rule',
          status: 'pending',
          evidence: [],
          label: '未命中证据',
        });
      }
    }
    const node = nodeByObjectId.get(object.object_id);
    if (node) {
      node.primary_atom = matches[0]?.atom ?? L0_FALLBACK_ATOM;
      node.evidence = uniqueStrings(matches.flatMap((item) => item.keywords));
      node.status = node.evidence.length > 0 ? 'normal' : 'pending';
    }
  }

  for (const edge of edges) {
    const sourceObject = objectById.get(edge.source_object_id);
    const targetObject = objectById.get(edge.target_object_id);
    if (!sourceObject || !targetObject) {
      continue;
    }

    const sourceLayer = OBJECT_LEVEL_TO_LAYER[sourceObject.object_level];
    const targetLayer = OBJECT_LEVEL_TO_LAYER[targetObject.object_level];
    if (!sourceLayer || !targetLayer) {
      continue;
    }

    if (getObjectLevelRank(sourceObject.object_level) !== getObjectLevelRank(targetObject.object_level) + 1) {
      continue;
    }

    const sourceNode = nodeByObjectId.get(targetObject.object_id);
    const targetNode = nodeByObjectId.get(sourceObject.object_id);
    if (!sourceNode || !targetNode) {
      continue;
    }

    supportEdges.push({
      id: `${targetObject.object_id}->${sourceObject.object_id}->supports`,
      source: sourceNode.id,
      target: targetNode.id,
      type: 'supports',
      derived_from: 'contains',
      status: 'normal',
      evidence: uniqueStrings([edge.citation, edge.reason, `${sourceObject.object_name} contains ${targetObject.object_name}`]),
      label: 'supports',
    });
  }

  const layerCounts = nodes.reduce((acc, node) => {
    acc[node.layer] += 1;
    return acc;
  }, {
    L0: 0,
    L1: 0,
    L2: 0,
    L3: 0,
    L4: 0,
  } as Record<'L0' | 'L1' | 'L2' | 'L3' | 'L4', number>);

  const emptyReason = objects.length === 0
    ? 'L0-L4 本体图暂无对象数据'
    : (!shouldRenderObjectLayers ? '暂无可分层对象，请先完成粒度对齐' : '');

  return {
    nodes,
    edges: [...atomEdges, ...supportEdges],
    summary: {
      layer_counts: layerCounts,
      total_nodes: nodes.length,
      total_edges: atomEdges.length + supportEdges.length,
      mapped_atom_edge_count: atomEdges.length,
      supports_edge_count: supportEdges.length,
      pending_node_count: nodes.filter((node) => node.status === 'pending').length,
      recognized_object_level_count: recognizedObjectCount,
      empty_reason: emptyReason,
    },
  };
}
