# 前端 L0-L4 图谱适配层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立的 L0-L4 图谱适配层，把后端 `result.objects` / `result.edges` 转换为前端专用的 L0-L4 节点与边，并接入现有 workflow V2 页面。

**Architecture:** 新建一个专用的 `workflowV2L0L4View.ts` 模块，所有 L0 固定原子、`object_level -> layer` 映射、L1 到 L0 的关键词规则、L1-L4 supports 派生逻辑都集中在这里。页面层只负责消费这个 adapter 的输出，不改后端数据，也不修改原有结构验证图的来源与方向。

**Tech Stack:** TypeScript, React, 现有 workflow V2 页面和测试体系。

---

### Task 1: 新增 L0-L4 适配模块

**Files:**
- Create: `kimi-agent-knowledge-base-collab/app/src/app/pages/workflowV2L0L4View.ts`
- Create: `kimi-agent-knowledge-base-collab/app/src/app/pages/workflowV2L0L4View.test.ts`

- [ ] **Step 1: 写测试，先定义图谱约束**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkflowV2L0L4Graph, L0_ATOMS } from './workflowV2L0L4View';

test('buildWorkflowV2L0L4Graph 会固定生成 5 个 L0 节点并映射 object_level', () => {
  assert.deepEqual(L0_ATOMS, ['时间', '空间', '事件', '数量', '能量']);

  const graph = buildWorkflowV2L0L4Graph({
    objects: [
      { object_id: 'o1', object_name: '系统A', object_level: 'system' },
      { object_id: 'o2', object_name: '子系统B', object_level: 'subsystem' },
      { object_id: 'o3', object_name: '功能模块C', object_level: 'function_unit' },
      { object_id: 'o4', object_name: '组件D', object_level: 'component' },
    ],
    edges: [
      { source_object_id: 'o1', target_object_id: 'o2', relation: 'contains' },
      { source_object_id: 'o2', target_object_id: 'o3', relation: 'contains' },
      { source_object_id: 'o3', target_object_id: 'o4', relation: 'contains' },
    ],
  });

  assert.equal(graph.nodes.filter((node) => node.layer === 'L0').length, 5);
  assert.ok(graph.nodes.some((node) => node.id === 'o1' && node.layer === 'L4'));
  assert.ok(graph.nodes.some((node) => node.id === 'o2' && node.layer === 'L3'));
  assert.ok(graph.nodes.some((node) => node.id === 'o3' && node.layer === 'L2'));
  assert.ok(graph.nodes.some((node) => node.id === 'o4' && node.layer === 'L1'));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- workflowV2L0L4View.test.ts`
Expected: fail because file and export do not exist yet.

- [ ] **Step 3: 实现 adapter**

```ts
export const L0_ATOMS = ['时间', '空间', '事件', '数量', '能量'] as const;
export const OBJECT_LEVEL_TO_LAYER = { component: 'L1', function_unit: 'L2', subsystem: 'L3', system: 'L4' } as const;
export function buildWorkflowV2L0L4Graph(input: { objects: any[]; edges: any[] }) {
  return { nodes: [], edges: [] };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- workflowV2L0L4View.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add kimi-agent-knowledge-base-collab/app/src/app/pages/workflowV2L0L4View.ts kimi-agent-knowledge-base-collab/app/src/app/pages/workflowV2L0L4View.test.ts
git commit -m "feat: add workflow v2 l0 l4 adapter"
```

### Task 2: 接入页面与现有视图

**Files:**
- Modify: `kimi-agent-knowledge-base-collab/app/src/app/pages/FileWorkflowV2Page.tsx`
- Modify: `kimi-agent-knowledge-base-collab/app/src/app/pages/fileWorkflowV2View.ts`
- Modify: `kimi-agent-knowledge-base-collab/app/src/app/pages/workflowV2L0L4View.ts`

- [ ] **Step 1: 写测试，覆盖 L0 关键词边与 supports 派生**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkflowV2L0L4Graph } from './workflowV2L0L4View';

test('L1 节点会连接到 L0，并从 result.edges 派生 supports 边', () => {
  const graph = buildWorkflowV2L0L4Graph({
    objects: [
      { object_id: 'o1', object_name: '响应时间', object_level: 'component', core_function: '控制响应时间与持续时长' },
    ],
    edges: [],
  });

  assert.ok(graph.edges.some((edge) => edge.derived_from === 'l0_keyword_rule'));
  assert.ok(graph.edges.some((edge) => edge.derived_from === 'contains' || edge.type === 'supports'));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- workflowV2L0L4View.test.ts`
Expected: fail because L0 keyword rules and supports derivation are not implemented yet.

- [ ] **Step 3: 在页面中消费 adapter**

```ts
import { buildWorkflowV2L0L4Graph } from './workflowV2L0L4View';
```

```ts
const l0L4Graph = useMemo(() => buildWorkflowV2L0L4Graph({
  objects: result?.objects ?? [],
  edges: result?.edges ?? [],
}), [result?.edges, result?.objects]);
```

- [ ] **Step 4: 运行页面相关测试**

Run: `npm test -- fileWorkflowV2View.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add kimi-agent-knowledge-base-collab/app/src/app/pages/FileWorkflowV2Page.tsx kimi-agent-knowledge-base-collab/app/src/app/pages/fileWorkflowV2View.ts kimi-agent-knowledge-base-collab/app/src/app/pages/workflowV2L0L4View.ts
git commit -m "feat: wire workflow v2 l0 l4 view"
```

### Task 3: 验收与回归

**Files:**
- Test: `kimi-agent-knowledge-base-collab/app/src/app/pages/workflowV2L0L4View.test.ts`
- Test: `kimi-agent-knowledge-base-collab/app/src/app/pages/fileWorkflowV2View.test.ts`

- [ ] **Step 1: 跑新适配器测试**

Run: `npm test -- workflowV2L0L4View.test.ts`
Expected: PASS

- [ ] **Step 2: 跑现有视图测试**

Run: `npm test -- fileWorkflowV2View.test.ts`
Expected: PASS

- [ ] **Step 3: 核对语法**

Run: `node --check kimi-agent-knowledge-base-collab/app/src/app/pages/workflowV2L0L4View.ts`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add kimi-agent-knowledge-base-collab/app/src/app/pages/workflowV2L0L4View.test.ts kimi-agent-knowledge-base-collab/app/src/app/pages/fileWorkflowV2View.test.ts
git commit -m "test: cover workflow v2 l0 l4 adapter"
```
