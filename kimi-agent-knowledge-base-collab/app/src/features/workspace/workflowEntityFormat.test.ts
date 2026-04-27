import assert from 'node:assert/strict';
import test from 'node:test';

import { validateWorkflowEntityFileData } from '@/features/workspace/workflowEntityFormat';

function createValidWorkflowSource(overrides: Record<string, unknown> = {}) {
  return {
    source: 'linear-workflow',
    ontology: {
      workflow_version: 'v1-linear-file-workflow',
      generated_at: '2026-04-25T00:00:00Z',
      project_id: 'demo',
      scope: 'entity',
      entity_id: 'entity_a',
      entity_name: '实体A',
      system_summary: {
        entity_count: 1,
        relation_count: 0,
        ablation_count: 0,
      },
      entity: {
        id: 'entity_a',
        name: '实体A',
        summary: '摘要',
        type: 'capability',
        level: 1,
        source: 'linear-workflow',
        properties: {},
        abilities: [],
        citations: [],
      },
      relations: [],
      ablation: null,
    },
    entity: {
      id: 'entity_a',
      name: '实体A',
      summary: '摘要',
      type: 'capability',
      level: 1,
      source: 'linear-workflow',
      properties: {},
      abilities: [],
      citations: [],
    },
    relations: [],
    ablation: null,
    precheck: null,
    ontology_summary: {
      entity_count: 1,
      relation_count: 0,
      ablation_count: 0,
    },
    ...overrides,
  };
}

test('validateWorkflowEntityFileData 允许可选 probability 字段', () => {
  const result = validateWorkflowEntityFileData(createValidWorkflowSource({
    probability: '97%',
  }));

  assert.deepEqual(result, { ok: true });
});

test('validateWorkflowEntityFileData 拒绝空 probability', () => {
  const result = validateWorkflowEntityFileData(createValidWorkflowSource({
    probability: '',
  }));

  assert.equal(result.ok, false);
  assert.equal(result.error, 'data.probability 必须是非空字符串');
});
