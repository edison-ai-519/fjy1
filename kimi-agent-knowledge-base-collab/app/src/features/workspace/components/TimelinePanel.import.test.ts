import assert from 'node:assert/strict';
import test from 'node:test';

test('TimelinePanel 模块可以被正常导入', async () => {
  const module = await import('./TimelinePanel.tsx');

  assert.equal(typeof module.TimelinePanel, 'function');
});
