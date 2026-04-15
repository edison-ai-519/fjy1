import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAssistantSession,
  removeAssistantSession,
} from './assistantSessionState';
import type { ConversationSession } from '@/components/assistant/types';

function buildSession(id: string, title: string): ConversationSession {
  return {
    id,
    title,
    draftQuestion: '',
    messages: [],
    error: null,
    loading: false,
    statusMessage: null,
  };
}

test('removeAssistantSession 删除当前会话后切换到剩余首个会话', () => {
  const sessions = [
    buildSession('session-1', '会话 1'),
    buildSession('session-2', '会话 2'),
    buildSession('session-3', '会话 3'),
  ];

  const next = removeAssistantSession(sessions, 'session-2', 'session-2');

  assert.deepEqual(next.sessions.map((session) => session.id), ['session-1', 'session-3']);
  assert.equal(next.activeSessionId, 'session-1');
});

test('removeAssistantSession 删除非当前会话时保持当前激活会话', () => {
  const sessions = [
    buildSession('session-1', '会话 1'),
    buildSession('session-2', '会话 2'),
    buildSession('session-3', '会话 3'),
  ];

  const next = removeAssistantSession(sessions, 'session-3', 'session-1');

  assert.deepEqual(next.sessions.map((session) => session.id), ['session-1', 'session-2']);
  assert.equal(next.activeSessionId, 'session-1');
});

test('removeAssistantSession 删除最后一个会话时自动补一个空白会话', () => {
  const sessions = [buildSession('session-1', '会话 1')];

  const next = removeAssistantSession(sessions, 'session-1', 'session-1');

  assert.equal(next.sessions.length, 1);
  assert.notEqual(next.sessions[0].id, 'session-1');
  assert.equal(next.sessions[0].title, '新对话 1');
  assert.equal(next.activeSessionId, next.sessions[0].id);
});

test('createAssistantSession 默认生成中文标题', () => {
  const session = createAssistantSession();

  assert.match(session.id, /^session-/);
  assert.equal(session.title, '新对话 1');
});
