import assert from "node:assert/strict";
import test from "node:test";

import { KnowledgeBaseService } from "../services/knowledgeBaseService.mjs";

function createRepository() {
  let invalidated = 0;
  return {
    invalidated: () => invalidated,
    async ingestSource() {
      return {
        ref: "domain:kimi-demo/salinity-monitoring",
        layer: "domain",
        slug: "kimi-demo/salinity-monitoring",
        title: "盐度监测",
        markdown: "# 盐度监测\n\n## 定义与定位\n用于持续跟踪盐度变化。\n",
        warnings: [],
      };
    },
    invalidateCache() {
      invalidated += 1;
    },
    async loadDataset() {
      return {
        knowledgeGraph: {
          statistics: {
            total_entities: 12,
            total_relations: 28,
          },
        },
      };
    },
  };
}

test("KnowledgeBaseService commitEditorDraft writes source and wiki then refreshes dataset", async () => {
  const repository = createRepository();
  const calls = [];
  const service = new KnowledgeBaseService(repository, {
    sourceCommitter: async (input) => {
      calls.push({ kind: "source", input });
      return {
        filename: input.filename,
        version_id: 3,
        commit_id: "abc123",
      };
    },
    wikiWriter: async (input) => {
      calls.push({ kind: "wiki", input });
      return {
        path: input.path,
      };
    },
  });

  const result = await service.commitEditorDraft({
    mode: "json",
    projectId: "demo",
    layer: "domain",
    slug: "kimi-demo/salinity-monitoring",
    message: "新增盐度监测",
    source: {
      title: "盐度监测",
    },
  });

  assert.equal(result.status, "success");
  assert.equal(calls[0].kind, "source");
  assert.equal(calls[1].kind, "wiki");
  assert.equal(repository.invalidated(), 1);
  assert.equal(result.updatedEntityId, "domain:kimi-demo/salinity-monitoring");
  assert.equal(result.exportSummary.totalEntities, 12);
  assert.equal(result.exportSummary.totalRelations, 28);
});

test("KnowledgeBaseService commitEditorDraft reports partial when source succeeded but wiki write failed", async () => {
  const repository = createRepository();
  let sourceWrites = 0;
  const service = new KnowledgeBaseService(repository, {
    sourceCommitter: async () => {
      sourceWrites += 1;
      return {
        filename: "graph-source/domain/kimi-demo/salinity-monitoring.json",
        version_id: 4,
        commit_id: "def456",
      };
    },
    wikiWriter: async () => {
      throw new Error("disk full");
    },
  });

  const result = await service.commitEditorDraft({
    mode: "markdown",
    projectId: "demo",
    layer: "domain",
    slug: "kimi-demo/salinity-monitoring",
    message: "更新盐度监测",
    source: "# 盐度监测",
  });

  assert.equal(sourceWrites, 1);
  assert.equal(result.status, "partial");
  assert.equal(result.sourceWrite.version_id, 4);
  assert.match(result.error, /disk full/);
});
