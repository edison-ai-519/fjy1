import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('upsertExecutionStage 会在插入新阶段时自动收口上一阶段', async () => {
  const appRoot = "C:/Users/14011/.config/superpowers/worktrees/FJY/codex/semantic-execution-flow/kimi-agent-knowledge-base-collab/app";
  const modulePath = path.join(appRoot, 'src/components/assistant/executionStages.ts');
  const { upsertExecutionStage } = await import(pathToFileURL(modulePath).href);

  const stages = upsertExecutionStage([], {
    id: 'stage-1',
    semanticStatus: 'thinking',
    label: '思考中...',
    phaseState: 'active',
    sourceEventType: 'request.started',
    detail: '准备连接 Agent',
    callId: null,
    startedAt: '2026-04-15T02:00:00.000Z',
    finishedAt: null,
  });
  const next = upsertExecutionStage(stages, {
    id: 'stage-2',
    semanticStatus: 'executing',
    label: '执行中...',
    phaseState: 'active',
    sourceEventType: 'tool.started',
    detail: 'dir',
    callId: 'tool-1',
    startedAt: '2026-04-15T02:00:02.000Z',
    finishedAt: null,
  });

  assert.equal(next.length, 2);
  assert.equal(next[0].phaseState, 'completed');
  assert.equal(next[0].finishedAt, '2026-04-15T02:00:02.000Z');
  assert.equal(next[1].semanticStatus, 'executing');
});

test('deriveExecutionStagesFromToolRuns 会为旧 toolRuns 生成可展示的阶段时间线', async () => {
  const appRoot = "C:/Users/14011/.config/superpowers/worktrees/FJY/codex/semantic-execution-flow/kimi-agent-knowledge-base-collab/app";
  const modulePath = path.join(appRoot, 'src/components/assistant/executionStages.ts');
  const { deriveExecutionStagesFromToolRuns } = await import(pathToFileURL(modulePath).href);

  const stages = deriveExecutionStagesFromToolRuns([
    {
      callId: 'tool-1',
      command: 'dir',
      status: 'success',
      stdout: 'file-a\n',
      stderr: '',
      exitCode: 0,
      cwd: 'D:\\code\\FJY',
      durationMs: 32,
      truncated: false,
      startedAt: '2026-04-15T02:00:00.000Z',
      finishedAt: '2026-04-15T02:00:01.000Z',
    },
  ]);

  assert.equal(stages.length, 1);
  assert.equal(stages[0].semanticStatus, 'completed');
  assert.equal(stages[0].detail, 'dir');
  assert.equal(stages[0].callId, 'tool-1');
});
