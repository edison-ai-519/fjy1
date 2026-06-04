import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { resolveAppPath } from './testPaths.mjs';
import { WorkflowV2Service } from '../server/services/workflowV2Service.mjs';
import {
  L0_ATOMS,
  LAYER_Y,
  buildWorkflowV2L0L4Graph,
  OBJECT_LEVEL_TO_LAYER,
} from '../src/app/pages/workflowV2L0L4View.ts';

test('workflow V2 验收清单：阶段顺序、粒度对齐、拆解约束、图谱切换与 L0-L4 约束', async () => {
  const stagesSource = await fs.readFile(resolveAppPath('src', 'shared', 'workflowV2Stages.js'), 'utf8');
  assert.match(stagesSource, /granularity_align/);
  assert.match(stagesSource, /short:\s*"05"/);
  assert.match(stagesSource, /short:\s*"06"/);
  assert.match(stagesSource, /short:\s*"07"/);
  assert.match(stagesSource, /short:\s*"08"/);
  assert.match(stagesSource, /short:\s*"09"/);

  const pageSource = await fs.readFile(resolveAppPath('src', 'app', 'pages', 'FileWorkflowV2Page.tsx'), 'utf8');
  assert.match(pageSource, /graphMode/);
  assert.match(pageSource, /结构图/);
  assert.match(pageSource, /L0-L4 本体图/);
  assert.match(pageSource, /WorkflowV2L0L4GraphPanel/);
  assert.match(pageSource, /buildWorkflowV2L0L4Graph/);

  const serviceSource = await fs.readFile(resolveAppPath('server', 'services', 'workflowV2Service.mjs'), 'utf8');
  const fusionRunIndex = serviceSource.indexOf('await runStage("object_fusion"');
  const granularityRunIndex = serviceSource.indexOf('await runStage("granularity_align"');
  const functionRunIndex = serviceSource.indexOf('await runStage("function_analysis"');
  assert.ok(fusionRunIndex >= 0 && granularityRunIndex >= 0 && functionRunIndex >= 0);
  assert.ok(fusionRunIndex < granularityRunIndex);
  assert.ok(granularityRunIndex < functionRunIndex);
  assert.match(serviceSource, /function_unit/);
  assert.match(serviceSource, /isAllowedContainsEdge/);
  assert.match(serviceSource, /derived_from: "object_decompose"/);

  const service = new WorkflowV2Service({});
  service.invokeStageJson = async ({ stage, payload }) => {
    if (stage === 'function_analysis') {
      throw new Error('stubbed llm');
    }
    if (stage === 'object_decompose') {
      const objectId = payload?.object?.object_id;
      if (objectId === 'sys') {
        return {
          data: {
            decompositions: [
              { parent_object_name: '系统', child_object_name: '子系统', citation: '系统包含子系统', confidence: 0.9, reason: '合法' },
              { parent_object_name: '系统', child_object_name: '组件', citation: '系统包含组件', confidence: 0.9, reason: '非法跨层' },
            ],
            reason: 'ok',
          },
          llm_ensemble: null,
        };
      }
      if (objectId === 'sub') {
        return {
          data: {
            decompositions: [
              { parent_object_name: '子系统', child_object_name: '功能单元', citation: '子系统包含功能单元', confidence: 0.9, reason: '合法' },
              { parent_object_name: '子系统', child_object_name: '组件', citation: '子系统包含组件', confidence: 0.9, reason: '非法跨层' },
            ],
            reason: 'ok',
          },
          llm_ensemble: null,
        };
      }
      if (objectId === 'fn') {
        return {
          data: {
            decompositions: [
              { parent_object_name: '功能单元', child_object_name: '组件', citation: '功能单元包含组件', confidence: 0.9, reason: '合法' },
              { parent_object_name: '组件', child_object_name: '功能单元', citation: '反向关系', confidence: 0.9, reason: '非法反向' },
            ],
            reason: 'ok',
          },
          llm_ensemble: null,
        };
      }
      return {
        data: { decompositions: [], reason: 'ok' },
        llm_ensemble: null,
      };
    }
    throw new Error('stubbed llm');
  };

  const analyzed = await service.functionAnalysisStage([
    {
      object_id: 'obj-system',
      object_name: '总系统',
      normalized_name: '总系统',
      object_level: 'module',
      citations: ['总系统'],
      citation: ['总系统'],
      core_function: '统筹全局',
      reason: '',
    },
    {
      object_id: 'obj-component',
      object_name: '输入组件',
      normalized_name: '输入组件',
      object_level: 'sub_system',
      citations: ['输入'],
      citation: ['输入'],
      core_function: '接收输入',
      reason: '',
    },
  ], {
    signal: undefined,
    onProgress: () => {},
  });

  assert.deepEqual(analyzed.function_objects.map((item) => item.object_level), ['function_unit', 'subsystem']);
  assert.equal(analyzed.total_function_objects, 2);
  assert.equal(analyzed.failed_function_objects.length, 2);

  const decomposition = await service.objectDecomposeStage([
    {
      object_id: 'sys',
      object_name: '系统',
      object_level: 'system',
      citations: ['系统包含子系统'],
      citation: ['系统包含子系统'],
      core_function: '统筹',
      reason: '',
    },
    {
      object_id: 'sub',
      object_name: '子系统',
      object_level: 'subsystem',
      citations: ['子系统包含模块'],
      citation: ['子系统包含模块'],
      core_function: '分解',
      reason: '',
    },
    {
      object_id: 'fn',
      object_name: '功能单元',
      object_level: 'function_unit',
      citations: ['功能单元包含组件'],
      citation: ['功能单元包含组件'],
      core_function: '执行',
      reason: '',
    },
    {
      object_id: 'cmp',
      object_name: '组件',
      object_level: 'component',
      citations: ['组件'],
      citation: ['组件'],
      core_function: '响应',
      reason: '',
    },
  ], {
    signal: undefined,
    onProgress: () => {},
  });

  assert.equal(decomposition.total_decomposition_groups, 4);
  assert.equal(decomposition.valid_decomposition_edge_count, 3);
  assert.equal(decomposition.skipped_decomposition_edge_count, 3);
  assert.equal(decomposition.pending_decomposition_edge_count, 3);
  assert.ok(decomposition.decomposition_results.every((group) => group.decompositions.every((edge) => edge.relation === 'contains')));

  const graph = await service.graphBuildStage([
    { object_id: 'sys', object_name: '系统', object_level: 'system' },
    { object_id: 'sub', object_name: '子系统', object_level: 'subsystem' },
    { object_id: 'fn', object_name: '功能单元', object_level: 'function_unit' },
    { object_id: 'cmp', object_name: '组件', object_level: 'component' },
  ], [
    {
      object_id: 'sys',
      object_name: '系统',
      decompositions: [
        { source_object_id: 'sys', target_object_id: 'sub', relation: 'contains', citation: '系统包含子系统', confidence: 0.9, reason: '合法' },
        { source_object_id: 'sys', target_object_id: 'fn', relation: 'contains', citation: '系统包含功能单元', confidence: 0.9, reason: '非法跨层' },
      ],
    },
    {
      object_id: 'sub',
      object_name: '子系统',
      decompositions: [
        { source_object_id: 'sub', target_object_id: 'fn', relation: 'contains', citation: '子系统包含功能单元', confidence: 0.9, reason: '合法' },
        { source_object_id: 'sub', target_object_id: 'cmp', relation: 'contains', citation: '子系统包含组件', confidence: 0.9, reason: '非法跨层' },
      ],
    },
    {
      object_id: 'fn',
      object_name: '功能单元',
      decompositions: [
        { source_object_id: 'fn', target_object_id: 'cmp', relation: 'contains', citation: '功能单元包含组件', confidence: 0.9, reason: '合法' },
        { source_object_id: 'cmp', target_object_id: 'fn', relation: 'contains', citation: '反向关系', confidence: 0.9, reason: '非法反向' },
      ],
    },
  ], {
    signal: undefined,
  });

  assert.equal(graph.edges.length, 3);
  assert.ok(graph.edges.every((edge) => edge.relation === 'contains'));
  assert.ok(graph.edges.some((edge) => edge.source_object_id === 'sys' && edge.target_object_id === 'sub'));
  assert.ok(graph.edges.some((edge) => edge.source_object_id === 'sub' && edge.target_object_id === 'fn'));
  assert.ok(graph.edges.some((edge) => edge.source_object_id === 'fn' && edge.target_object_id === 'cmp'));
  assert.equal(graph.removed_cycle_edges.length, 0);

  const workflowStagesSource = await fs.readFile(resolveAppPath('src', 'shared', 'workflowV2Stages.js'), 'utf8');
  assert.match(workflowStagesSource, /granularity_align/);
  assert.ok(workflowStagesSource.indexOf('"05"') < workflowStagesSource.indexOf('"06"'));
  assert.ok(workflowStagesSource.indexOf('"08"') < workflowStagesSource.indexOf('"09"'));

  assert.deepEqual(L0_ATOMS, ['时间', '空间', '事件', '数量', '能量']);
  assert.deepEqual(OBJECT_LEVEL_TO_LAYER, {
    component: 'L1',
    function_unit: 'L2',
    subsystem: 'L3',
    system: 'L4',
  });

  const l0l4Graph = buildWorkflowV2L0L4Graph({
    objects: [
      { object_id: 'sys', object_name: '系统', object_level: 'system', core_function: '统筹全局', citation: ['系统'], citations: ['系统'] },
      { object_id: 'sub', object_name: '子系统', object_level: 'subsystem', core_function: '协调处理', citation: ['子系统'], citations: ['子系统'] },
      { object_id: 'fn', object_name: '功能单元', object_level: 'function_unit', core_function: '响应请求', citation: ['请求'], citations: ['请求'] },
      { object_id: 'cmp', object_name: '组件', object_level: 'component', core_function: '处理时间信号', citation: ['时间'], citations: ['时间'] },
    ],
    edges: [
      { source_object_id: 'sys', target_object_id: 'sub', relation: 'contains', citation: '系统包含子系统', reason: '' },
      { source_object_id: 'sub', target_object_id: 'fn', relation: 'contains', citation: '子系统包含功能单元', reason: '' },
      { source_object_id: 'fn', target_object_id: 'cmp', relation: 'contains', citation: '功能单元包含组件', reason: '' },
    ],
  });

  assert.equal(l0l4Graph.nodes.filter((node) => node.layer === 'L0').length, 5);
  assert.ok(l0l4Graph.nodes.every((node) => typeof node.layer === 'string'));
  assert.equal(l0l4Graph.nodes.find((node) => node.layer === 'L0')?.y, LAYER_Y.L0);
  assert.equal(l0l4Graph.nodes.find((node) => node.layer === 'L1')?.y, LAYER_Y.L1);
  assert.equal(l0l4Graph.nodes.find((node) => node.layer === 'L2')?.y, LAYER_Y.L2);
  assert.equal(l0l4Graph.nodes.find((node) => node.layer === 'L3')?.y, LAYER_Y.L3);
  assert.equal(l0l4Graph.nodes.find((node) => node.layer === 'L4')?.y, LAYER_Y.L4);
  assert.equal(l0l4Graph.summary.pending_node_count, 0);
  assert.equal(l0l4Graph.summary.empty_reason, '');
  assert.equal(l0l4Graph.summary.recognized_object_level_count, 4);
});
