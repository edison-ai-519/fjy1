import test from 'node:test';
import assert from 'node:assert/strict';

import { ResizableHandle } from './resizable';

test('ResizableHandle 默认只保留很小的居中拖拽命中区', () => {
  const element = ResizableHandle({ withHandle: true });
  const className = String(element.props.className);

  assert.match(className, /\bw-px\b/);
  assert.match(className, /after:!w-2\.5/);
  assert.match(className, /after:!h-20/);
  assert.match(className, /after:!inset-y-auto/);
  assert.doesNotMatch(className, /after:w-12/);
  assert.doesNotMatch(className, /after:inset-y-0/);
});
