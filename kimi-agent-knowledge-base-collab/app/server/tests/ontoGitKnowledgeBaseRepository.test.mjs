import assert from "node:assert/strict";
import test from "node:test";

import { OntoGitKnowledgeBaseRepository } from "../repositories/ontoGitKnowledgeBaseRepository.mjs";

function createValidWorkflowSource() {
  return {
    source: "linear-workflow",
    ontology: {
      workflow_version: "v1-linear-file-workflow",
      generated_at: "2026-04-25T00:00:00Z",
      project_id: "demo",
      scope: "entity",
      entity_id: "entity_a",
      entity_name: "实体A",
      system_summary: {
        entity_count: 1,
        relation_count: 0,
        ablation_count: 0,
      },
      entity: {
        id: "entity_a",
        name: "实体A",
        summary: "摘要",
        type: "capability",
        level: 1,
        source: "linear-workflow",
        properties: {},
        abilities: [],
        citations: [],
      },
      relations: [],
      ablation: null,
    },
    entity: {
      id: "entity_a",
      name: "实体A",
      summary: "摘要",
      type: "capability",
      level: 1,
      source: "linear-workflow",
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
    probability: "95%",
  };
}

test("OntoGitKnowledgeBaseRepository writeWorkflowEntity 会先登录再写入", async () => {
  const calls = [];
  const repository = new OntoGitKnowledgeBaseRepository({
    gatewayBaseUrl: "http://127.0.0.1:8080",
    authUsername: "mogong",
    authPassword: "123456",
  });

  repository.ensureGatewayLogin = async () => {
    calls.push("auth");
  };
  repository.invokeGatewayJson = async (pathname, payload) => {
    calls.push(pathname);
    return { pathname, payload };
  };

  const result = await repository.writeWorkflowEntity({
    projectId: "demo",
    filename: "graph-source/domain/entity_a.json",
    data: createValidWorkflowSource(),
    message: "写入实体",
    basevision: 7,
  });

  assert.equal(result.pathname, "/xg/write-and-infer");
  assert.deepEqual(calls, ["auth", "/xg/write-and-infer"]);
});

test("OntoGitKnowledgeBaseRepository 已登录后只携带 Authorization", async () => {
  const headersSeen = [];
  const repository = new OntoGitKnowledgeBaseRepository({
    gatewayBaseUrl: "http://127.0.0.1:8080",
    gatewayApiKey: "service-key",
    authUsername: "mogong",
    authPassword: "123456",
  });

  repository.gatewayAccessToken = "login-token";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    if (pathname === "/xg/projects") {
      headersSeen.push(init.headers);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async text() {
          return JSON.stringify({ projects: [] });
        },
        async json() {
          return { projects: [] };
        },
      };
    }
    throw new Error(`unexpected fetch: ${pathname}`);
  };

  try {
    await repository.listProjects();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(headersSeen.length, 1);
  assert.equal(headersSeen[0].Authorization, "Bearer login-token");
  assert.equal("X-API-Key" in headersSeen[0], false);
});

test("OntoGitKnowledgeBaseRepository 仅扫描指定项目的工作流 JSON", async () => {
  const repository = new OntoGitKnowledgeBaseRepository();
  const template = createValidWorkflowSource();

  repository.getJsonFileTimelines = async (projectId) => {
    if (projectId === "demo") {
      return [{ filename: "graph-source/domain/demo-entity.json" }];
    }
    if (projectId === "kimi") {
      return [{ filename: "graph-source/domain/kimi-entity.json" }];
    }
    return [];
  };

  repository.readProjectFile = async (projectId, filename) => {
    const entityId = filename.includes("kimi") ? "entity_kimi" : "entity_demo";
    const entityName = filename.includes("kimi") ? "实体Kimi" : "实体Demo";
    return {
      ...template,
      ontology: {
        ...template.ontology,
        project_id: projectId,
        entity_id: entityId,
        entity_name: entityName,
      },
      entity: {
        ...template.entity,
        id: entityId,
        name: entityName,
      },
    };
  };

  const demoGraph = await repository.getKnowledgeGraph("demo");
  const kimiGraph = await repository.getKnowledgeGraph("kimi");

  assert.deepEqual(Object.keys(demoGraph.entity_index), ["demo:entity_demo"]);
  assert.deepEqual(Object.keys(kimiGraph.entity_index), ["kimi:entity_kimi"]);
});
