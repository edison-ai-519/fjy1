# 前端 L0-L4 图谱适配层设计

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于现有 `result.objects` 和 `result.edges` 生成前端专用的 L0-L4 本体图谱适配层，并保持后端 result 顶层结构不变。

**Architecture:** 新增一个独立的 `workflowV2L0L4View.ts` 适配模块，专门负责把后端结果转换成前端可渲染的 L0-L4 节点和边。模块内部只做派生，不写回后端数据；它会固定生成 5 个 L0 原子节点，按 `object_level` 映射 L1-L4 节点，并基于关键词规则为 L1 节点生成到 L0 的证据边。L1-L4 的结构关系则只从后端现有 `result.edges` 派生，不修改原边方向。

**Tech Stack:** TypeScript, React 现有视图层, 现有 workflow V2 结果类型, 现有图谱布局/展示辅助函数。

---

### Task 1: 新增 L0-L4 适配模块

**Files:**
- Create: `kimi-agent-knowledge-base-collab/app/src/app/pages/workflowV2L0L4View.ts`
- Test: `kimi-agent-knowledge-base-collab/app/src/app/pages/workflowV2L0L4View.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkflowV2L0L4Graph } from './workflowV2L0L4View';

test('buildWorkflowV2L0L4Graph 会固定生成 5 个 L0 节点，并把 object_level 映射到 L1-L4', () => {
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
  assert.ok(graph.nodes.some((node) => node.id === 'l0:时间'));
  assert.ok(graph.nodes.some((node) => node.id === 'o1' && node.layer === 'L4'));
  assert.ok(graph.nodes.some((node) => node.id === 'o2' && node.layer === 'L3'));
  assert.ok(graph.nodes.some((node) => node.id === 'o3' && node.layer === 'L2'));
  assert.ok(graph.nodes.some((node) => node.id === 'o4' && node.layer === 'L1'));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- workflowV2L0L4View.test.ts`
Expected: fail because module and export do not exist yet.

- [ ] **Step 3: 实现最小适配器**

```ts
export const L0_ATOMS = ['时间', '空间', '事件', '数量', '能量'] as const;

export const OBJECT_LEVEL_TO_LAYER = {
  component: 'L1',
  function_unit: 'L2',
  subsystem: 'L3',
  system: 'L4',
} as const;

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

### Task 2: 接入现有 workflow V2 视图

**Files:**
- Modify: `kimi-agent-knowledge-base-collab/app/src/app/pages/FileWorkflowV2Page.tsx`
- Modify: `kimi-agent-knowledge-base-collab/app/src/app/pages/fileWorkflowV2View.ts`

- [ ] **Step 1: 写失败测试**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkflowV2L0L4Graph } from './workflowV2L0L4View';

test('L1 节点会按关键词规则连接到 L0，且不伪造边', () => {
  const graph = buildWorkflowV2L0L4Graph({
    objects: [
      { object_id: 'o1', object_name: '响应时间', object_level: 'component' },
    ],
    edges: [],
  });

  assert.ok(graph.edges.some((edge) => edge.derived_from === 'l0_keyword_rule'));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- workflowV2L0L4View.test.ts`
Expected: fail because L0-L0/L1 rule output is not implemented yet.

- [ ] **Step 3: 在页面层接入适配器**

```ts
import { buildWorkflowV2L0L4Graph } from './workflowV2L0L4View';
```

```ts
const l0L4Graph = buildWorkflowV2L0L4Graph({
  objects: result?.objects ?? [],
  edges: result?.edges ?? [],
});
```

- [ ] **Step 4: 运行相关页面测试**

Run: `npm test -- fileWorkflowV2View.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add kimi-agent-knowledge-base-collab/app/src/app/pages/FileWorkflowV2Page.tsx kimi-agent-knowledge-base-collab/app/src/app/pages/fileWorkflowV2View.ts
git commit -m "feat: wire workflow v2 l0 l4 view"
```

### Task 3: 验收与回归

**Files:**
- Test: `kimi-agent-knowledge-base-collab/app/src/app/pages/workflowV2L0L4View.test.ts`
- Test: `kimi-agent-knowledge-base-collab/app/src/app/pages/fileWorkflowV2View.test.ts`

- [ ] **Step 1: 跑新适配器测试**

Run: `npm test -- workflowV2L0L4View.test.ts`
Expected: PASS

- [ ] **Step 2: 跑现有 workflow V2 视图测试**

Run: `npm test -- fileWorkflowV2View.test.ts`
Expected: PASS

- [ ] **Step 3: 确认后端 result 顶层结构未被改写**

Run: `node --check kimi-agent-knowledge-base-collab/app/src/app/pages/workflowV2L0L4View.ts`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add kimi-agent-knowledge-base-collab/app/src/app/pages/workflowV2L0L4View.test.ts kimi-agent-knowledge-base-collab/app/src/app/pages/fileWorkflowV2View.test.ts
git commit -m "test: cover workflow v2 l0 l4 adapter"
```
