import type * as React from 'react';

export function stopPointerEventPropagation(
  event: Pick<React.PointerEvent, 'stopPropagation'>,
) {
  event.stopPropagation();
}
