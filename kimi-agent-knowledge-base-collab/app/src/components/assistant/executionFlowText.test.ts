import test from 'node:test';
import assert from 'node:assert/strict';

import { clampExecutionFlowText } from './executionFlowText';

test('超长执行流文案会被截断并追加省略号', () => {
  const input = '正在分析问题：搜索整个FJY目录，并继续递归扫描多个子目录';
  const output = clampExecutionFlowText(input, 18);

  assert.equal(output, '正在分析问题：搜索整个FJY目...');
});

test('短文本保持原样', () => {
  assert.equal(clampExecutionFlowText('执行中...', 18), '执行中...');
});
