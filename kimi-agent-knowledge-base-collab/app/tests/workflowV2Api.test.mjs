import assert from 'node:assert/strict';
import test from 'node:test';

const { writeWorkflowV2SessionToOntoGit } = await import('../src/features/workspace/api.ts');

test('writeWorkflowV2SessionToOntoGit 会请求 /api/workflow/v2/write 并返回解析结果', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (input, init = {}) => {
    requests.push({
      input: String(input),
      method: init.method || 'GET',
    });

    return new Response(JSON.stringify({
      ok: true,
      project_id: 'demo-project',
      conversation_id: 'conv-123',
      entity_files: [{ filename: 'engine.json' }],
      ingest_results: [
        {
          status: 'success',
          commit_id: 'deadbeef',
          version_id: 3,
          raw: {
            inference_result: {
              probability: 0.92,
              reason: '结构稳定',
            },
          },
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const result = await writeWorkflowV2SessionToOntoGit({
      conversationId: 'conv-123',
      projectId: 'demo-project',
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(
      requests[0].input,
      '/api/workflow/v2/write?conversationId=conv-123&projectId=demo-project',
    );
    assert.deepEqual(result, {
      ok: true,
      project_id: 'demo-project',
      conversation_id: 'conv-123',
      entity_files: [{ filename: 'engine.json' }],
      ingest_results: [
        {
          status: 'success',
          commit_id: 'deadbeef',
          version_id: 3,
          raw: {
            inference_result: {
              probability: 0.92,
              reason: '结构稳定',
            },
          },
        },
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
