import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWorkflowV2SystemDecompositionView,
  buildWorkflowV2GraphLayout,
  canWriteWorkflowV2Session,
  extractWorkflowV2SiblingImpactEdges,
  extractWorkflowV2Summary,
  extractWorkflowV2WritebackSummary,
  getWorkflowV2ImpactEdgeStyle,
  pickWorkflowV2PrimaryRoot,
} from './fileWorkflowV2View';

test('extractWorkflowV2Summary 会读取 meta 统计信息', () => {
  const summary = extractWorkflowV2Summary({
    document: null,
    chunks: [],
    windows: [],
    objects: [],
    edges: [],
    ablation: [],
    meta: {
      total_chunks: 3,
      total_windows: 2,
      total_objects: 5,
      total_edges: 4,
      is_dag: true,
    },
  });

  assert.deepEqual(summary, {
    chunkCount: 3,
    windowCount: 2,
    objectCount: 5,
    edgeCount: 4,
    isDag: true,
  });
});

test('canWriteWorkflowV2Session 只有在会话已有结果且未运行时才允许写回', () => {
  assert.equal(canWriteWorkflowV2Session(null), false);
  assert.equal(canWriteWorkflowV2Session({
    conversationId: 'running',
    projectId: 'demo',
    statusMessage: 'running',
    isRunning: true,
    runResult: null,
    windowExtractProgress: null,
    objectDecomposeProgress: null,
    ablationAnalysisProgress: null,
    logs: [],
    lastRunAt: null,
    updatedAt: '2026-05-31T00:00:00.000Z',
  }), false);

  assert.equal(canWriteWorkflowV2Session({
    conversationId: 'done-with-objects',
    projectId: 'demo',
    statusMessage: 'done',
    isRunning: false,
    runResult: {
      ok: true,
      workflow: { mode: 'file', status: 'completed', steps: [] },
      stage_results: [],
      errors: [],
      runtime_root: '/tmp/demo',
      result: {
        document: null,
        chunks: [],
        windows: [],
        objects: [{ object_id: 'obj-1', object_name: '发动机' }],
        edges: [],
        ablation: [],
        meta: {},
      },
    },
    windowExtractProgress: null,
    objectDecomposeProgress: null,
    ablationAnalysisProgress: null,
    logs: [],
    lastRunAt: '2026-05-31T00:01:00.000Z',
    updatedAt: '2026-05-31T00:01:00.000Z',
  }), true);

  assert.equal(canWriteWorkflowV2Session({
    conversationId: 'done-with-stage',
    projectId: 'demo',
    statusMessage: 'done',
    isRunning: false,
    runResult: {
      ok: true,
      workflow: { mode: 'file', status: 'completed', steps: [] },
      stage_results: [
        {
          stage: 'chunk_parse',
          order: 1,
          status: 'success',
          output: { total_chunks: 2 },
          error: null,
        },
      ],
      errors: [],
      runtime_root: '/tmp/demo',
      result: {
        document: null,
        chunks: [],
        windows: [],
        objects: [],
        edges: [],
        ablation: [],
        meta: {},
      },
    },
    windowExtractProgress: null,
    objectDecomposeProgress: null,
    ablationAnalysisProgress: null,
    logs: [],
    lastRunAt: '2026-05-31T00:02:00.000Z',
    updatedAt: '2026-05-31T00:02:00.000Z',
  }), true);
});

test('extractWorkflowV2WritebackSummary 会提取最近成功写回的 commit、version 和推理摘要', () => {
  const summary = extractWorkflowV2WritebackSummary({
    ingest_results: [
      {
        status: 'success',
        commit_id: 'commit-1',
        version_id: 7,
        raw: {
          inference_result: {
            probability: 0.61,
            reason: '第一轮推理',
          },
        },
      },
      {
        status: 'failed',
        commit_id: '',
        version_id: null,
      },
      {
        status: 'success',
        commit_id: 'commit-2',
        version_id: 8,
        raw: {
          inference: {
            probability: 0.87,
            reason: '最新推理',
          },
        },
      },
    ],
  });

  assert.deepEqual(summary, {
    totalCount: 3,
    successCount: 2,
    failedCount: 1,
    lastCommitId: 'commit-2',
    lastVersionId: 8,
    inferenceProbability: 0.87,
    inferenceReason: '最新推理',
  });
});

test('pickWorkflowV2PrimaryRoot 会优先选择可达后代更多的主系统', () => {
  const rootId = pickWorkflowV2PrimaryRoot(
    [
      { object_id: 'root-b', object_name: 'B系统' },
      { object_id: 'root-a', object_name: 'A系统' },
      { object_id: 'a-1', object_name: 'A-1' },
      { object_id: 'a-2', object_name: 'A-2' },
      { object_id: 'b-1', object_name: 'B-1' },
    ],
    [
      { source_object_id: 'root-a', target_object_id: 'a-1' },
      { source_object_id: 'root-a', target_object_id: 'a-2' },
      { source_object_id: 'root-b', target_object_id: 'b-1' },
    ],
  );

  assert.equal(rootId, 'root-a');
});

test('pickWorkflowV2PrimaryRoot 在无结构边时会稳定回退到对象名称更靠前的节点', () => {
  const rootId = pickWorkflowV2PrimaryRoot(
    [
      { object_id: 'node-b', object_name: '制动系统' },
      { object_id: 'node-a', object_name: '车身系统' },
    ],
    [],
  );

  assert.equal(rootId, 'node-a');
});

test('buildWorkflowV2SystemDecompositionView 会生成有深度上限的系统拆解树', () => {
  const view = buildWorkflowV2SystemDecompositionView({
    objects: [
      { object_id: 'root', object_name: '整车', normalized_name: 'vehicle', core_function: '承载并协调所有子系统' },
      { object_id: 'power', object_name: '动力系统', normalized_name: 'powertrain', core_function: '提供驱动力' },
      { object_id: 'control', object_name: '控制系统', normalized_name: 'control', core_function: '协调整车控制' },
      { object_id: 'engine', object_name: '发动机', normalized_name: 'engine', core_function: '输出机械能' },
      { object_id: 'ecu', object_name: 'ECU', normalized_name: 'ecu', core_function: '执行控制逻辑' },
      { object_id: 'sensor', object_name: '传感器', normalized_name: 'sensor', core_function: '采集状态' },
    ],
    edges: [
      { source_object_id: 'root', target_object_id: 'power' },
      { source_object_id: 'root', target_object_id: 'control' },
      { source_object_id: 'power', target_object_id: 'engine' },
      { source_object_id: 'control', target_object_id: 'ecu' },
      { source_object_id: 'ecu', target_object_id: 'sensor' },
    ],
    maxDepth: 2,
  });

  assert.equal(view.root?.name, '整车');
  assert.equal(view.summary.containmentCount, 5);
  assert.equal(view.summary.leafCount, 2);
  assert.equal(view.summary.maxDepth, 3);
  assert.equal(view.root?.children.length, 2);
  assert.equal(view.root?.children[1]?.children[0]?.name, 'ECU');
  assert.equal(view.root?.children[1]?.children[0]?.hiddenDescendantCount, 1);
});

test('buildWorkflowV2SystemDecompositionView 在没有结构边时返回明确空态原因', () => {
  const view = buildWorkflowV2SystemDecompositionView({
    objects: [
      { object_id: 'root', object_name: '整车', normalized_name: 'vehicle', core_function: '承载系统' },
    ],
    edges: [],
    maxDepth: 2,
  });

  assert.equal(view.root?.name, '整车');
  assert.equal(view.summary.containmentCount, 0);
  assert.match(view.emptyReason, /没有形成可展示的系统拆解结构/);
});

test('buildWorkflowV2SystemDecompositionView 遇到环时不会无限展开重复节点', () => {
  const view = buildWorkflowV2SystemDecompositionView({
    objects: [
      { object_id: 'a', object_name: '系统A' },
      { object_id: 'b', object_name: '系统B' },
      { object_id: 'c', object_name: '系统C' },
    ],
    edges: [
      { source_object_id: 'a', target_object_id: 'b' },
      { source_object_id: 'b', target_object_id: 'c' },
      { source_object_id: 'c', target_object_id: 'a' },
    ],
    maxDepth: 3,
  });

  assert.ok(view.root);
  assert.equal(view.root?.children.some((child) => child.id === view.root?.id), false);
});

test('buildWorkflowV2GraphLayout 会按拓扑深度生成简单 DAG 布局', () => {
  const layout = buildWorkflowV2GraphLayout({
    document: null,
    chunks: [],
    windows: [],
    objects: [
      { object_id: 'obj-computer', object_name: '电脑' },
      { object_id: 'obj-cpu', object_name: 'CPU' },
      { object_id: 'obj-gpu', object_name: 'GPU' },
      { object_id: 'obj-alu', object_name: 'ALU' },
    ],
    edges: [
      { edge_id: 'edge-1', source_object_id: 'obj-computer', target_object_id: 'obj-cpu' },
      { edge_id: 'edge-2', source_object_id: 'obj-computer', target_object_id: 'obj-gpu' },
      { edge_id: 'edge-3', source_object_id: 'obj-cpu', target_object_id: 'obj-alu' },
    ],
    ablation: [],
    meta: {},
  });

  const computer = layout.nodes.find((node) => node.id === 'obj-computer');
  const cpu = layout.nodes.find((node) => node.id === 'obj-cpu');
  const alu = layout.nodes.find((node) => node.id === 'obj-alu');

  assert.equal(layout.edges.length, 3);
  assert.equal(computer?.depth, 0);
  assert.equal(cpu?.depth, 1);
  assert.equal(alu?.depth, 2);
});

test('buildWorkflowV2GraphLayout 默认不会把孤立节点放进 DAG 布局', () => {
  const layout = buildWorkflowV2GraphLayout({
    document: null,
    chunks: [],
    windows: [],
    objects: [
      { object_id: 'obj-computer', object_name: '电脑', is_isolated: false, structure_status: 'structured' },
      { object_id: 'obj-cpu', object_name: 'CPU', is_isolated: false, structure_status: 'structured' },
      {
        object_id: 'obj-note',
        object_name: '注释对象',
        is_isolated: true,
        structure_status: 'isolated',
        structure_reason: '没有进入任何结构边。',
      },
    ],
    edges: [
      { edge_id: 'edge-1', source_object_id: 'obj-computer', target_object_id: 'obj-cpu' },
    ],
    ablation: [],
    meta: {},
  });

  const isolated = layout.nodes.find((node) => node.id === 'obj-note');
  assert.equal(isolated, undefined);
});

test('buildWorkflowV2GraphLayout 在关闭隐藏开关后会显示孤立节点', () => {
  const layout = buildWorkflowV2GraphLayout({
    document: null,
    chunks: [],
    windows: [],
    objects: [
      { object_id: 'obj-computer', object_name: '电脑', is_isolated: false, structure_status: 'structured' },
      { object_id: 'obj-cpu', object_name: 'CPU', is_isolated: false, structure_status: 'structured' },
      {
        object_id: 'obj-note',
        object_name: '注释对象',
        is_isolated: true,
        structure_status: 'isolated',
        structure_reason: '没有进入任何结构边。',
      },
    ],
    edges: [
      { edge_id: 'edge-1', source_object_id: 'obj-computer', target_object_id: 'obj-cpu' },
    ],
    ablation: [],
    meta: {},
  }, {
    hideIsolatedNodes: false,
  });

  const isolated = layout.nodes.find((node) => node.id === 'obj-note');
  assert.equal(isolated?.isIsolated, true);
  assert.equal(isolated?.structureStatus, 'isolated');
  assert.equal(isolated?.structureReason, '没有进入任何结构边。');
});

test('buildWorkflowV2GraphLayout 会隐藏所有无边节点', () => {
  const layout = buildWorkflowV2GraphLayout({
    document: null,
    chunks: [],
    windows: [],
    objects: [
      { object_id: 'obj-computer', object_name: '电脑' },
      { object_id: 'obj-cpu', object_name: 'CPU' },
      { object_id: 'obj-note', object_name: '注释对象', is_isolated: true },
    ],
    edges: [
      { edge_id: 'edge-1', source_object_id: 'obj-computer', target_object_id: 'obj-cpu' },
    ],
    ablation: [],
    meta: {},
  });

  assert.deepEqual(layout.nodes.map((node) => node.id), ['obj-computer', 'obj-cpu']);
  assert.equal(layout.nodes.some((node) => node.id === 'obj-note'), false);
});

test('extractWorkflowV2SiblingImpactEdges 会提取兄弟消融边并保留更高 impact_level', () => {
  const edges = extractWorkflowV2SiblingImpactEdges([
    {
      parent_object_id: 'obj-computer',
      sibling_dependency_table: [
        {
          ablated_child_object_id: 'obj-cpu',
          target_sibling_object_id: 'obj-gpu',
          impact_level: 'low',
        },
        {
          ablated_child_object_id: 'obj-cpu',
          target_sibling_object_id: 'obj-gpu',
          impact_level: 'high',
        },
        {
          ablated_child_object_id: 'obj-gpu',
          target_sibling_object_id: 'obj-cpu',
          impact_level: 'medium',
        },
      ],
    },
  ]);

  assert.deepEqual(edges, [
    {
      id: 'obj-computer:obj-cpu->obj-gpu',
      sourceId: 'obj-cpu',
      targetId: 'obj-gpu',
      parentId: 'obj-computer',
      impactLevel: 'high',
    },
    {
      id: 'obj-computer:obj-gpu->obj-cpu',
      sourceId: 'obj-gpu',
      targetId: 'obj-cpu',
      parentId: 'obj-computer',
      impactLevel: 'medium',
    },
  ]);
});

test('getWorkflowV2ImpactEdgeStyle 会按 impact_level 返回不同边样式', () => {
  assert.deepEqual(getWorkflowV2ImpactEdgeStyle('high'), {
    stroke: 'rgba(239,68,68,0.8)',
    strokeWidth: 4,
  });
  assert.deepEqual(getWorkflowV2ImpactEdgeStyle('medium'), {
    stroke: 'rgba(245,158,11,0.78)',
    strokeWidth: 3.25,
  });
  assert.deepEqual(getWorkflowV2ImpactEdgeStyle('low'), {
    stroke: 'rgba(14,165,233,0.72)',
    strokeWidth: 2.5,
    strokeDasharray: '8 6',
  });
  assert.deepEqual(getWorkflowV2ImpactEdgeStyle('unknown'), {
    stroke: 'rgba(148,163,184,0.58)',
    strokeWidth: 1.75,
    strokeDasharray: '4 8',
  });
});
