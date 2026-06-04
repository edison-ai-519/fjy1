import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { WorkflowV2L0L4GraphPanel } from '../src/app/pages/WorkflowV2L0L4GraphPanel';
import { buildWorkflowV2L0L4Graph } from '../src/app/pages/workflowV2L0L4View';

test('WorkflowV2L0L4GraphPanel 会渲染五层布局和边详情', () => {
  const markup = renderToStaticMarkup(
    <WorkflowV2L0L4GraphPanel
      selectedNodeId="o1"
      graph={{
        nodes: [
          { id: 'l0:时间', label: '时间', layer: 'L0', status: 'normal', x: 120, y: 40, width: 180, height: 54, evidence: ['时间'] },
          { id: 'o1', label: '时钟组件', layer: 'L1', object_level: 'component', status: 'pending', primary_atom: '时间', x: 120, y: 190, width: 180, height: 58, evidence: ['时间'] },
        ],
        edges: [
          {
            id: 'o1->l0:时间->mapped_to_atom',
            source: 'l0:时间',
            target: 'o1',
            type: 'mapped_to_atom',
            derived_from: 'l0_keyword_rule',
            status: 'pending',
            evidence: ['时间'],
            label: '时间',
          },
        ],
        summary: {
          layer_counts: { L0: 1, L1: 1, L2: 0, L3: 0, L4: 0 },
          total_nodes: 2,
          total_edges: 1,
          mapped_atom_edge_count: 1,
          supports_edge_count: 0,
          pending_node_count: 1,
          recognized_object_level_count: 1,
          empty_reason: '',
        },
      }}
    />,
  );

  assert.match(markup, /L0/);
  assert.match(markup, /L1/);
  assert.match(markup, /L0 固定 5 原子/);
  assert.match(markup, /关联摘要/);
  assert.match(markup, /直接关系/);
  assert.match(markup, /时钟组件/);
  assert.match(markup, /component/);
  assert.match(markup, /mapped_to_atom/);
  assert.match(markup, /l0_keyword_rule/);
  assert.match(markup, /待补齐/);
  assert.match(markup, /缩小/);
  assert.match(markup, /放大/);
  assert.match(markup, /还原/);
  assert.match(markup, /清除聚焦/);
  assert.match(markup, /复制 Mermaid/);
});

test('WorkflowV2L0L4GraphPanel 会展示空态提示', () => {
  const markup = renderToStaticMarkup(
    <WorkflowV2L0L4GraphPanel
      graph={{
        nodes: [
          { id: 'l0:时间', label: '时间', layer: 'L0', status: 'normal', x: 120, y: 40, width: 180, height: 54, evidence: ['时间'] },
        ],
        edges: [],
        summary: {
          layer_counts: { L0: 1, L1: 0, L2: 0, L3: 0, L4: 0 },
          total_nodes: 1,
          total_edges: 0,
          mapped_atom_edge_count: 0,
          supports_edge_count: 0,
          pending_node_count: 0,
          recognized_object_level_count: 0,
          empty_reason: '暂无可分层对象，请先完成粒度对齐',
        },
      }}
    />,
  );

  assert.match(markup, /暂无可分层对象，请先完成粒度对齐/);
});

test('WorkflowV2L0L4GraphPanel 会为左侧超界内容自动平移画布', () => {
  const markup = renderToStaticMarkup(
    <WorkflowV2L0L4GraphPanel
      graph={{
        nodes: [
          { id: 'l0:时间', label: '时间', layer: 'L0', status: 'normal', x: 120, y: 40, width: 180, height: 54, evidence: ['时间'] },
          { id: 'o-left', label: '左侧节点', layer: 'L1', object_level: 'component', status: 'normal', primary_atom: '时间', x: -210, y: 190, width: 180, height: 58, evidence: ['时间'] },
          { id: 'o-right', label: '右侧节点', layer: 'L2', object_level: 'function_unit', status: 'normal', primary_atom: '事件', x: 210, y: 340, width: 180, height: 58, evidence: ['事件'] },
        ],
        edges: [],
        summary: {
          layer_counts: { L0: 1, L1: 1, L2: 1, L3: 0, L4: 0 },
          total_nodes: 3,
          total_edges: 0,
          mapped_atom_edge_count: 0,
          supports_edge_count: 0,
          pending_node_count: 0,
          recognized_object_level_count: 2,
          empty_reason: '',
        },
      }}
    />,
  );

  assert.match(markup, /transform="translate\(330, 0\)"/);
  assert.match(markup, /style="width:960px;height:720px;min-width:960px;min-height:720px"/);
});

test('buildWorkflowV2L0L4Graph 会为未命中的 L1 节点补一条灰色锚点边', () => {
  const graph = buildWorkflowV2L0L4Graph({
    objects: [
      {
        object_id: 'obj-1',
        object_name: '普通组件',
        normalized_name: 'normal-component',
        raw_object_level: 'component',
        object_level: 'component',
        core_function: '',
        citations: ['普通组件'],
        citation: ['普通组件'],
        reason: '',
        properties: {},
      },
    ],
    edges: [],
  });

  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0]?.status, 'pending');
  assert.equal(graph.edges[0]?.label, '未命中证据');
  assert.equal(graph.edges[0]?.source, 'l0:事件');
  assert.equal(graph.edges[0]?.target, 'obj-1');
});

test('buildWorkflowV2L0L4Graph 会把 contains 结构边转成低层指向高层的 supports 边', () => {
  const graph = buildWorkflowV2L0L4Graph({
    objects: [
      {
        object_id: 'obj-parent',
        object_name: '上层系统',
        normalized_name: 'parent-system',
        raw_object_level: 'system',
        object_level: 'system',
        core_function: '',
        citations: ['上层系统包含下层模块'],
        citation: ['上层系统包含下层模块'],
        reason: '',
        properties: {},
      },
      {
        object_id: 'obj-child',
        object_name: '下层模块',
        normalized_name: 'child-module',
        raw_object_level: 'subsystem',
        object_level: 'subsystem',
        core_function: '',
        citations: ['上层系统包含下层模块'],
        citation: ['上层系统包含下层模块'],
        reason: '',
        properties: {},
      },
    ],
    edges: [
      {
        edge_id: 'obj-parent->obj-child->contains',
        source_object_id: 'obj-parent',
        target_object_id: 'obj-child',
        relation: 'contains',
        citation: '上层系统包含下层模块',
        reason: '直接组成关系',
      },
    ],
  });

  const supportsEdge = graph.edges.find((edge) => edge.type === 'supports');
  assert.equal(supportsEdge?.source, 'obj-child');
  assert.equal(supportsEdge?.target, 'obj-parent');
});
