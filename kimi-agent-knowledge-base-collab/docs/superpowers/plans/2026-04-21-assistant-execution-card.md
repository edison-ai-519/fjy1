# 问答助手执行卡片重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把“问答助手”里普通工具调用的 `tool_call` / `tool_result` 合并成一张更醒目的执行卡，并在有 `message.answer` 时把 LLM/agent 回复也放进高亮卡片中展示。

**Architecture:** 保持消息来源和协议不变，只改 `app/src/components/assistant/ChatArea.tsx` 的渲染层与一个小型纯函数辅助模块。先把 `tool_call` 和 `tool_result` 的配对逻辑抽出来，确保普通 CLI 调用能稳定合并成单卡，再在卡片内部增加命令、状态、stdout/stderr 和可选回复区块的分层展示。特殊的 `query_agent` / `run_git_query_agent.py` 继续保留现有超级卡样式，避免影响已有高亮路径。

**Tech Stack:** React 19、TypeScript、Tailwind CSS、`node:test`、`tsx`。

---

### Task 1: 提取工具调用分组与标题提取逻辑

**Files:**
- Create: `app/src/components/assistant/executionTrace.ts`
- Create: `app/src/components/assistant/executionTrace.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  groupAssistantContentBlocks,
  getExecutionTraceTitle,
} from './executionTrace';

test('普通 tool_call 与 tool_result 会被合并成一张执行卡', () => {
  const groups = groupAssistantContentBlocks([
    {
      id: 'call-1',
      type: 'tool_call',
      callId: 'call-1',
      command: 'bash D:\\code\\FJY\\OntoGit\\probability.sh "车载充电机冷却泵"',
      toolName: undefined,
      createdAt: '2026-04-21T08:00:00.000Z',
    },
    {
      id: 'result-1',
      type: 'tool_result',
      callId: 'call-1',
      command: 'bash D:\\code\\FJY\\OntoGit\\probability.sh "车载充电机冷却泵"',
      toolName: undefined,
      status: 'success',
      stdout: '{"probability":"95%"}',
      stderr: '',
      exitCode: 0,
      cwd: null,
      durationMs: 9380,
      createdAt: '2026-04-21T08:00:03.000Z',
      finishedAt: '2026-04-21T08:00:03.000Z',
    },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.type, 'paired_execution');
  if (groups[0]?.type === 'paired_execution') {
    assert.equal(groups[0].callBlock.callId, 'call-1');
    assert.equal(groups[0].resultBlock?.status, 'success');
  }
});

test('执行卡标题会优先显示脚本文件名', () => {
  assert.equal(
    getExecutionTraceTitle('bash D:\\code\\FJY\\OntoGit\\probability.sh "车载充电机冷却泵"'),
    'probability.sh',
  );
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm test -- src/components/assistant/executionTrace.test.ts`
Expected: 失败，提示模块或导出尚未实现。

- [ ] **Step 3: 写最小实现**

实现 `groupAssistantContentBlocks()` 和 `getExecutionTraceTitle()`，只覆盖测试里需要的行为。

- [ ] **Step 4: 运行测试验证通过**

Run: `npm test -- src/components/assistant/executionTrace.test.ts`
Expected: PASS。

### Task 2: 接入统一执行卡渲染

**Files:**
- Modify: `app/src/components/assistant/ChatArea.tsx`

- [ ] **Step 1: 把 `MessageContentBlocks` 接到新的分组结果上**

把普通 `tool_call` / `tool_result` 改成单张执行卡渲染，保留 `query_agent` 的超级卡和 `ner` / `re` 的特殊样式。

- [ ] **Step 2: 增加更醒目的执行卡 UI**

在卡片里展示命令、状态、stdout、stderr，以及可选的 `message.answer` 高亮回复区块。

- [ ] **Step 3: 运行局部构建与测试**

Run: `npm test -- src/components/assistant/executionTrace.test.ts`
Run: `npm run build`
Expected: 通过，无新增类型或样式报错。

