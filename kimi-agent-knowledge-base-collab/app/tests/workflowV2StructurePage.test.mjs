import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { resolveAppPath } from './testPaths.mjs';

test('V2 页面在总览区优先展示系统拆解视图，并把 DAG 下沉到分析区', async () => {
  const source = await fs.readFile(resolveAppPath('src', 'app', 'pages', 'FileWorkflowV2Page.tsx'), 'utf8');

  assert.match(source, /当前会话/);
  assert.match(source, /graphMode/);
  assert.match(source, /图谱幕布/);
  assert.match(source, /打开图谱幕布/);
  assert.match(source, /结构图/);
  assert.match(source, /L0-L4 本体图/);
  assert.match(source, /title="系统拆解视图"/);
  assert.match(source, /结构验证图/);
  assert.match(source, /title="对象库"/);
  assert.match(source, /高级配置/);
  assert.match(source, /WorkflowV2SystemDecompositionPanel/);
  assert.doesNotMatch(source, /主系统/);
  assert.doesNotMatch(source, /<TabsTrigger value="overview"/);
});
