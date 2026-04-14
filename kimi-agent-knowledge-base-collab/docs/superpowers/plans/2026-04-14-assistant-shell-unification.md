# Assistant Shell Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“问答助手”复用主应用侧栏风格，在左侧统一承载功能切换与可滚动对话历史，并移除助手内部独立左栏。

**Architecture:** 把会话与配置状态从 `OntologyAssistant` 内部抽到共享 hook，由 `App` 左侧历史区和助手主内容共同消费。`App` 负责统一壳层与历史侧栏，`OntologyAssistant` 退化为“聊天区 + 执行流”内容组件。

**Tech Stack:** React 19、TypeScript、Radix Tabs、react-resizable-panels、现有 shadcn/ui 组件

---

### Task 1: 抽出共享的助手状态层

**Files:**
- Create: `app/src/hooks/useOntologyAssistantState.ts`
- Create: `app/src/components/assistant/types.ts`
- Modify: `app/src/components/OntologyAssistant.tsx`
- Test: `app/tests/assistantShellLayout.test.mjs`

- [ ] 写一个会先失败的测试，约束助手内容区只保留聊天区与执行流两栏。
- [ ] 抽出会话、配置、持久化与流式问答逻辑，避免 `App` 与 `OntologyAssistant` 各自维护一份状态。
- [ ] 运行目标测试，确认新状态层被主内容复用。

### Task 2: 把主侧栏扩成“导航在上、历史在下”

**Files:**
- Modify: `app/src/App.tsx`
- Modify: `app/src/components/assistant/Sidebar.tsx`
- Create: `app/src/components/assistant/history.ts`
- Test: `app/tests/assistantHistory.test.mjs`

- [ ] 写一个会先失败的测试，约束历史搜索只返回标题或消息内容命中的会话。
- [ ] 在 `App` 左侧保留现有功能切换按钮，并在助手标签激活时渲染新对话、搜索框、历史列表和滚动区。
- [ ] 去掉激活助手时的宽度/样式过渡，让壳层切换立即生效。

### Task 3: 收口助手主内容并验证整体构建

**Files:**
- Modify: `app/src/components/OntologyAssistant.tsx`
- Modify: `app/src/components/assistant/panelLayout.ts`
- Modify: `app/tests/assistantPanelLayout.test.mjs`
- Test: `app/tests/ontologyAssistant.typecheck.test.mjs`

- [ ] 把助手内部左栏删掉，只保留聊天区和执行流的可拖拽布局。
- [ ] 运行新增测试、助手独立类型检查和完整 `npm run build`，确认 UI 结构与构建都通过。
