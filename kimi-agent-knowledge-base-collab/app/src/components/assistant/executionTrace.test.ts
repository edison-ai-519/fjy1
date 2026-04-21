import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getExecutionTraceTitle,
  getExecutionTraceKind,
  isCliExecutionTrace,
  groupAssistantContentBlocks,
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

test('普通指令会被识别为 plain', () => {
  assert.equal(getExecutionTraceKind('Get-Content D:\\code\\FJY\\OntoGit\\README.md'), 'plain');
  assert.equal(isCliExecutionTrace('Get-Content D:\\code\\FJY\\OntoGit\\README.md'), false);
  assert.equal(getExecutionTraceTitle('Get-Content D:\\code\\FJY\\OntoGit\\README.md'), 'Get-Content');
});

test('脚本调用会被识别为 cli', () => {
  assert.equal(
    getExecutionTraceKind('bash D:\\code\\FJY\\OntoGit\\probability.sh "车载充电机冷却泵"'),
    'cli',
  );
  assert.equal(isCliExecutionTrace('bash D:\\code\\FJY\\OntoGit\\probability.sh "车载充电机冷却泵"'), true);
});

test('bash -lc 这类内联命令保持 plain', () => {
  assert.equal(getExecutionTraceKind('bash -lc "echo hello"'), 'plain');
  assert.equal(getExecutionTraceTitle('bash -lc "echo hello"'), 'bash');
});
