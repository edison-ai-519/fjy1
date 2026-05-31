import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { WorkflowV2SystemDecompositionPanel } from '../src/app/pages/WorkflowV2SystemDecompositionPanel';

test('WorkflowV2SystemDecompositionPanel 会渲染系统拆解树和隐藏下级提示', () => {
  const markup = renderToStaticMarkup(
    <WorkflowV2SystemDecompositionPanel
      view={{
        root: {
          id: 'root',
          name: '整车',
          normalizedName: 'vehicle',
          coreFunction: '承载整车系统',
          childCount: 2,
          isLeaf: false,
          hiddenDescendantCount: 1,
          depth: 0,
          children: [
            {
              id: 'power',
              name: '动力系统',
              normalizedName: 'powertrain',
              coreFunction: '提供驱动力',
              childCount: 0,
              isLeaf: true,
              hiddenDescendantCount: 0,
              depth: 1,
              children: [],
            },
          ],
        },
        summary: {
          containmentCount: 2,
          leafCount: 1,
          maxDepth: 2,
          hiddenDescendantCount: 1,
        },
        emptyReason: '',
      }}
    />,
  );

  assert.match(markup, /结构树优先/);
  assert.match(markup, /整车/);
  assert.match(markup, /动力系统/);
  assert.match(markup, /还有 1 个下级未展开/);
});

test('WorkflowV2SystemDecompositionPanel 在没有结构边时显示空态', () => {
  const markup = renderToStaticMarkup(
    <WorkflowV2SystemDecompositionPanel
      view={{
        root: null,
        summary: {
          containmentCount: 0,
          leafCount: 0,
          maxDepth: 0,
          hiddenDescendantCount: 0,
        },
        emptyReason: '当前还没有形成可展示的系统拆解结构。',
      }}
    />,
  );

  assert.match(markup, /当前还没有形成可展示的系统拆解结构/);
});
