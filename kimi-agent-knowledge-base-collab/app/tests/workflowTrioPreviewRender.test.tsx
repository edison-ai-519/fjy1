import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { WorkflowTrioConversationBody, WorkflowTrioPreview } from '../src/app/pages/WorkflowTrioPreview';
import { extractWorkflowEnsembleView } from '../src/app/pages/fileWorkflowEnsemble';

test('WorkflowTrioPreview 会把专家过程渲染成群聊式结构化视图', () => {
  const ensemble = {
    strategy: 'shared-review-judge-pick',
    shared_items: [],
    conflicts: [{ item_key: '机械狗' }],
    models: {
      model_a: {
        model: 'deepseek-v4-flash',
        single_result: {
          status: 'completed',
          data: {
            object_id: 'obj-object-1',
            relations: [
              {
                relation: 'contains',
                target_object_name: '外壳',
              },
            ],
          },
          raw_text: '{"object_id":"obj-object-1","relations":[{"relation":"contains","target_object_name":"外壳"}]}',
        },
      },
      model_b: {
        model: 'deepseek-v4-flash',
        single_result: {
          status: 'completed',
          data: {
            relations: [
              {
                source_id: 'obj-object-1',
                target_id: 'obj-object-1-sub-1',
                relation: 'contains',
                target_name: '外壳',
                confidence: 0.95,
              },
            ],
          },
          raw_text: '{"relations":[{"source_id":"obj-object-1","target_id":"obj-object-1-sub-1","relation":"contains","target_name":"外壳","confidence":0.95}]}',
        },
      },
    },
    cross_rounds: [
      {
        round: 1,
        reviewer_model: 'deepseek-v4-flash',
        reviewer_model_key: 'model_a',
        status: 'completed',
        data: {
          round_summary: '模型 A 认为关系项需要补齐 target_id。',
          object: '模型 A 认为关系项需要补齐 target_id。',
          resolved_conflicts: [
            {
              item_key: '机械狗-外壳',
              decision: '补齐字段',
              summary: '保留 contains，并补齐 target_id。',
              final_value: {
                relation: 'contains',
                target_name: '外壳',
              },
              citations: [
                {
                  target_model: 'model_a',
                  stance: '同意',
                  reason: '组成关系明确',
                  suggestion: '增加 target_id',
                },
              ],
            },
          ],
        },
        raw_text: '{"round_summary":"模型 A 认为关系项需要补齐 target_id。"}',
      },
    ],
    judge_result: {
      model: 'deepseek-v4-flash',
      status: 'completed',
      data: {
        resolved_conflicts: [
          {
            item_key: '机械狗-外壳',
            selected_model: 'model_b',
            reason: '字段更完整',
          },
        ],
      },
      raw_text: '{"resolved_conflicts":[{"item_key":"机械狗-外壳","selected_model":"model_b","reason":"字段更完整"}]}',
    },
    final_result: {
      source: 'judge',
      status: 'completed',
      data: {
        relations: [
          {
            relation: 'contains',
            target_object_name: '外壳',
          },
        ],
      },
      raw_text: '{"relations":[{"relation":"contains","target_object_name":"外壳"}]}',
    },
  };

  const previewMarkup = renderToStaticMarkup(
    <WorkflowTrioPreview
      title="obj-object-1 的对象拆解"
      summary="对象拆解阶段的 A/B/judge 过程。"
      ensemble={ensemble}
    />,
  );
  const view = extractWorkflowEnsembleView(ensemble);
  assert.ok(view);
  const conversationMarkup = renderToStaticMarkup(
    <WorkflowTrioConversationBody view={view} />,
  );

  assert.match(previewMarkup, /查看群聊/);
  assert.match(conversationMarkup, /群聊式对话流/);
  assert.match(conversationMarkup, /查看原始文本/);
  assert.match(conversationMarkup, /第 1 轮互评/);
  assert.match(conversationMarkup, /最终保留结果/);
  assert.match(conversationMarkup, /目标对象/);
  assert.match(conversationMarkup, /裁决结果/);
  assert.match(conversationMarkup, /模型 A 的互评意见/);
  assert.doesNotMatch(conversationMarkup, />Object</i);
  assert.doesNotMatch(conversationMarkup, />Round Summary</i);
});
