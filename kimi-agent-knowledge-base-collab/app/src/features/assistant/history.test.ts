import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConversationHistory } from './history';
import type { ConversationMessage } from '@/components/assistant/types';

function buildMessage(id: string, question: string, answer: string): ConversationMessage {
  return {
    id,
    question,
    answer,
    relatedNames: [],
    executionStages: [],
    toolRuns: [],
  };
}

test('buildConversationHistory 只保留截断点之前的历史', () => {
  const messages: ConversationMessage[] = [
    buildMessage('m1', '第一问', '第一答'),
    buildMessage('m2', '第二问', '第二答'),
    buildMessage('m3', '第三问', '第三答'),
  ];

  const history = buildConversationHistory(messages, {
    historyCutoffMessageId: 'm2',
  });

  assert.deepEqual(history, [
    { question: '第一问', answer: '第一答' },
    { question: '第二问', answer: '第二答' },
  ]);
});

test('buildConversationHistory 默认只返回最近六轮', () => {
  const messages: ConversationMessage[] = Array.from({ length: 8 }, (_, index) => (
    buildMessage(`m${index + 1}`, `问题${index + 1}`, `回答${index + 1}`)
  ));

  const history = buildConversationHistory(messages);

  assert.equal(history.length, 6);
  assert.deepEqual(history[0], { question: '问题3', answer: '回答3' });
  assert.deepEqual(history.at(-1), { question: '问题8', answer: '回答8' });
});
