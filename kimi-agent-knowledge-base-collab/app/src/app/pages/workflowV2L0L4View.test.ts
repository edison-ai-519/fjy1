import assert from 'node:assert/strict';
import test from 'node:test';

import {
  L0_ATOMS,
  LAYER_Y,
  buildWorkflowV2L0L4Graph,
  OBJECT_LEVEL_TO_LAYER,
} from './workflowV2L0L4View';

test('buildWorkflowV2L0L4Graph 会固定生成 5 个 L0 节点并映射 object_level', () => {
  assert.deepEqual(L0_ATOMS, ['时间', '空间', '事件', '数量', '能量']);
  assert.deepEqual(OBJECT_LEVEL_TO_LAYER, {
    component: 'L1',
    function_unit: 'L2',
    subsystem: 'L3',
    system: 'L4',
  });

  const graph = buildWorkflowV2L0L4Graph({
    objects: [
      { object_id: 'o1', object_name: '系统A', object_level: 'system', core_function: '统筹整体运行' },
      { object_id: 'o2', object_name: '子系统B', object_level: 'subsystem', core_function: '负责处理流程' },
      { object_id: 'o3', object_name: '功能模块C', object_level: 'function_unit', core_function: '执行响应请求' },
      { object_id: 'o4', object_name: '组件D', object_level: 'component', core_function: '监测时间变化' },
    ],
    edges: [
      { source_object_id: 'o1', target_object_id: 'o2', relation: 'contains', citation: '系统A包含子系统B' },
      { source_object_id: 'o2', target_object_id: 'o3', relation: 'contains', citation: '子系统B包含功能模块C' },
      { source_object_id: 'o3', target_object_id: 'o4', relation: 'contains', citation: '功能模块C包含组件D' },
    ],
  });

  assert.equal(graph.nodes.filter((node) => node.layer === 'L0').length, 5);
  assert.ok(graph.nodes.some((node) => node.id === 'l0:时间'));
  assert.ok(graph.nodes.some((node) => node.id === 'o1' && node.layer === 'L4'));
  assert.ok(graph.nodes.some((node) => node.id === 'o2' && node.layer === 'L3'));
  assert.ok(graph.nodes.some((node) => node.id === 'o3' && node.layer === 'L2'));
  assert.ok(graph.nodes.some((node) => node.id === 'o4' && node.layer === 'L1'));
  assert.equal(graph.nodes.find((node) => node.id === 'l0:时间')?.y, LAYER_Y.L0);
  assert.equal(graph.nodes.find((node) => node.id === 'o4')?.y, LAYER_Y.L1);
  assert.equal(graph.summary.supports_edge_count, 3);
  assert.equal(graph.summary.mapped_atom_edge_count, 2);
  assert.equal(graph.summary.empty_reason, '');
});

test('buildWorkflowV2L0L4Graph 会为缺少 L0 证据的 L1 节点标记 pending', () => {
  const graph = buildWorkflowV2L0L4Graph({
    objects: [
      { object_id: 'o1', object_name: '基础组件', object_level: 'component', core_function: '普通实现' },
    ],
    edges: [],
  });

  const node = graph.nodes.find((item) => item.id === 'o1');
  assert.ok(node);
  assert.equal(node?.status, 'pending');
  assert.equal(graph.summary.pending_node_count, 1);
  assert.equal(graph.summary.recognized_object_level_count, 1);
  assert.equal(graph.summary.empty_reason, '');
  assert.equal(graph.edges.length, 0);
});
