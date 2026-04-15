import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ASSISTANT_SPLIT_LAYOUT_BREAKPOINT,
  getAssistantLayoutMode,
} from './assistantLayout';

test('问答助手始终保持左右布局', () => {
  assert.equal(ASSISTANT_SPLIT_LAYOUT_BREAKPOINT, 0);
  assert.equal(getAssistantLayoutMode(480), 'split');
  assert.equal(getAssistantLayoutMode(960), 'split');
  assert.equal(getAssistantLayoutMode(1600), 'split');
  assert.equal(getAssistantLayoutMode(2600), 'split');
});
