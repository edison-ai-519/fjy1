import test from 'node:test';
import assert from 'node:assert/strict';

import { ASSISTANT_PANEL_LAYOUT } from './panelLayout';

test('执行流面板宽度被限制在紧凑范围内', () => {
  assert.equal(ASSISTANT_PANEL_LAYOUT.chat.minSize, '16rem');
  assert.equal(ASSISTANT_PANEL_LAYOUT.flow.defaultSize, '18rem');
  assert.equal(ASSISTANT_PANEL_LAYOUT.flow.minSize, '14rem');
  assert.equal(ASSISTANT_PANEL_LAYOUT.flow.maxSize, '22rem');
  assert.equal(ASSISTANT_PANEL_LAYOUT.chat.defaultSize, 'calc(100% - 18rem)');
});
