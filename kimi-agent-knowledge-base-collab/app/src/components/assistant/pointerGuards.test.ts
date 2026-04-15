import test from 'node:test';
import assert from 'node:assert/strict';

import { stopPointerEventPropagation } from './pointerGuards';

test('stopPointerEventPropagation 会阻止事件继续冒泡', () => {
  let stopped = false;

  stopPointerEventPropagation({
    stopPropagation() {
      stopped = true;
    },
  });

  assert.equal(stopped, true);
});
