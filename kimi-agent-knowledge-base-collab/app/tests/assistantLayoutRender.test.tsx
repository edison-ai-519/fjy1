import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ChatArea } from '../src/components/assistant/ChatArea';

test('ChatArea 采用固定输入区 + 独立消息滚动区结构', () => {
  const html = renderToStaticMarkup(
    <ChatArea
      activeSession={{
        title: '测试对话',
        messages: [
          { id: 'm1', question: '你好', answer: '你好', relatedNames: [] },
        ],
        draftQuestion: '',
        loading: false,
        error: null,
        statusMessage: null,
      }}
      onAsk={() => {}}
      onDraftChange={() => {}}
      isBusy={false}
      selectedEntityName="实体"
    />,
  );

  assert.match(html, /relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white/);
  assert.match(html, /data-slot="scroll-area"/);
  assert.match(html, /class="relative flex-1 min-h-0 overflow-hidden"/);
  assert.match(html, /class="shrink-0 border-t bg-white p-4"/);
  assert.match(html, /class="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b bg-white\/80 px-6 py-2 backdrop-blur-md"/);
  assert.match(html, /class="relative w-full px-6"/);
  assert.doesNotMatch(html, /max-w-4xl mx-auto/);
});
