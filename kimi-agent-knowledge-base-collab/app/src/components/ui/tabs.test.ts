import test from 'node:test';
import assert from 'node:assert/strict';

import { TabsContent } from './tabs';

test('TabsContent 默认允许在 flex 布局中收缩', () => {
  const element = TabsContent({ value: 'assistant' });
  const className = String(element.props.className);

  assert.match(className, /\bmin-w-0\b/);
  assert.match(className, /\bflex-1\b/);
});
