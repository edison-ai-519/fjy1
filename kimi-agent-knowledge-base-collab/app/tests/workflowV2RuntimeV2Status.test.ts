import assert from 'node:assert/strict';
import test from 'node:test';

import { alignWorkflowV2StageProgression, markWorkflowV2StageRunning } from '../src/features/workflow/runtimeV2';

test('markWorkflowV2StageRunning 只把 pending 阶段推入 running，不覆盖已完成状态', () => {
  const stageResults = [
    { stage: 'chunk_parse', order: 1, status: 'success', started_at: '2026-06-02T10:00:00.000Z', finished_at: '2026-06-02T10:00:01.000Z', output: {}, error: null },
    { stage: 'chunk_filter', order: 2, status: 'pending', started_at: null, finished_at: null, output: null, error: null },
    { stage: 'window_extract', order: 3, status: 'failed', started_at: '2026-06-02T10:00:02.000Z', finished_at: '2026-06-02T10:00:03.000Z', output: {}, error: 'boom' },
  ] as const;

  const updated = markWorkflowV2StageRunning(stageResults as never, 'chunk_filter');

  assert.equal(updated[0].status, 'success');
  assert.equal(updated[1].status, 'running');
  assert.equal(updated[2].status, 'failed');
  assert.ok(typeof updated[1].started_at === 'string' && updated[1].started_at.length > 0);
});

test('alignWorkflowV2StageProgression 会把更早的 pending 阶段收口成 success', () => {
  const updated = alignWorkflowV2StageProgression([
    { stage: 'object_fusion', order: 4, status: 'success', started_at: '2026-06-02T10:00:00.000Z', finished_at: '2026-06-02T10:00:01.000Z', output: {}, error: null },
    { stage: 'granularity_align', order: 5, status: 'pending', started_at: null, finished_at: null, output: null, error: null },
    { stage: 'function_analysis', order: 6, status: 'running', started_at: null, finished_at: null, output: null, error: null },
  ] as never, 'function_analysis', 'running');

  assert.equal(updated[0].status, 'success');
  assert.equal(updated[1].status, 'success');
  assert.equal(updated[2].status, 'running');
  assert.ok(typeof updated[1].started_at === 'string' && updated[1].started_at.length > 0);
  assert.ok(typeof updated[1].finished_at === 'string' && updated[1].finished_at.length > 0);
});
