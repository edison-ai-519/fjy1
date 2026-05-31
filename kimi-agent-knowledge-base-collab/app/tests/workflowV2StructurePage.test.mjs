import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { resolveAppPath } from './testPaths.mjs';

test('V2 页面在总览区优先展示系统拆解视图，并把 DAG 下沉到分析区', async () => {
  const source = await fs.readFile(resolveAppPath('src', 'app', 'pages', 'FileWorkflowV2Page.tsx'), 'utf8');

  assert.match(source, /title="系统拆解视图"/);
  assert.match(source, /title="结构验证图"/);
  assert.match(source, /WorkflowV2SystemDecompositionPanel/);
});
