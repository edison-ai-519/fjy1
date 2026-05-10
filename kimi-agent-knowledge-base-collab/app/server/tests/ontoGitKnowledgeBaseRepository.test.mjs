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

function createWorkflowEntitySource({
  projectId = "demo",
  entityId,
  entityName,
  relations = [],
  ablation = null,
  precheck = null,
}) {
  return {
    source: "linear-workflow",
    ontology: {
      workflow_version: "v1-linear-file-workflow",
      generated_at: "2026-04-25T00:00:00Z",
      project_id: projectId,
      scope: "entity",
      entity_id: entityId,
      entity_name: entityName,
      system_summary: {
        entity_count: 1,
        relation_count: relations.length,
        ablation_count: ablation ? 1 : 0,
      },
      entity: {
        id: entityId,
        name: entityName,
        summary: `${entityName} 概要`,
        type: "capability",
        level: 1,
        source: "linear-workflow",
        properties: {},
        abilities: [],
        citations: [],
      },
      relations,
      ablation: ablation ? [ablation] : [],
    },
    entity: {
      id: entityId,
      name: entityName,
      summary: `${entityName} 概要`,
      type: "capability",
      level: 1,
      source: "linear-workflow",
      properties: {},
      abilities: [],
      citations: [],
    },
    relations,
    ablation,
    precheck,
    ontology_summary: {
      entity_count: 1,
      relation_count: relations.length,
      ablation_count: ablation ? 1 : 0,
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

test("OntoGitKnowledgeBaseRepository writeWorkflowEntity 在跳过推理时只写入", async () => {
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
    skipInference: true,
  });

  assert.equal(result.pathname, "/xg/write");
  assert.deepEqual(calls, ["auth", "/xg/write"]);
  assert.equal(Object.hasOwn(result.payload, "inference_message"), false);
  assert.equal(Object.hasOwn(result.payload, "inference_agent_name"), false);
  assert.equal(Object.hasOwn(result.payload, "inference_committer_name"), false);
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

test("OntoGitKnowledgeBaseRepository 会保留首个实体并显式暴露重复 id 冲突", async () => {
  const repository = new OntoGitKnowledgeBaseRepository();
  const first = createWorkflowEntitySource({
    entityId: "ent_entity_1",
    entityName: "鱼家——智能养鱼系统",
  });
  const second = createWorkflowEntitySource({
    entityId: "ent_entity_1",
    entityName: "微信小程序",
  });

  repository.getJsonFileTimelines = async () => ([
    { filename: "a.json" },
    { filename: "b.json" },
  ]);
  repository.readProjectFile = async (projectId, filename) => (filename === "a.json" ? first : second);

  const graph = await repository.getKnowledgeGraph("demo");

  assert.equal(graph.statistics.total_entities, 1);
  assert.equal(graph.statistics.duplicate_entity_groups, 1);
  assert.equal(graph.statistics.duplicate_entity_records, 1);
  assert.equal(graph.entity_index["demo:ent_entity_1"].name, "鱼家——智能养鱼系统");
  assert.deepEqual(graph.entity_id_conflicts[0].filenames, ["a.json", "b.json"]);
  assert.deepEqual(graph.entity_id_conflicts[0].entity_names, ["鱼家——智能养鱼系统", "微信小程序"]);
});

test("OntoGitKnowledgeBaseRepository 扫描工作流实体时会限流并重试瞬时失败", async () => {
  const repository = new OntoGitKnowledgeBaseRepository();
  const attempts = new Map();
  let active = 0;
  let maxActive = 0;

  repository.getJsonFileTimelines = async () => ([
    { filename: "a.json" },
    { filename: "b.json" },
    { filename: "c.json" },
    { filename: "d.json" },
    { filename: "e.json" },
  ]);

  repository.readProjectFile = async (projectId, filename) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const count = attempts.get(filename) || 0;
      attempts.set(filename, count + 1);
      if ((filename === "b.json" || filename === "d.json") && count === 0) {
        throw new Error("transient fetch failed");
      }
      return createWorkflowEntitySource({
        projectId,
        entityId: `entity_${filename[0]}`,
        entityName: `实体${filename[0]}`,
      });
    } finally {
      active -= 1;
    }
  };

  const records = await repository.scanWorkflowEntityRecords("demo", null, {
    concurrency: 2,
    retryCount: 1,
    retryDelayMs: 0,
  });

  assert.equal(records.length, 5);
  assert.ok(maxActive <= 2);
  assert.equal(attempts.get("b.json"), 2);
  assert.equal(attempts.get("d.json"), 2);
});

test("OntoGitKnowledgeBaseRepository 会把不存在项目的 timelines 视为空列表", async () => {
  const repository = new OntoGitKnowledgeBaseRepository();
  repository.fetchGatewayJson = async () => {
    const error = new Error("project not found");
    error.status = 404;
    throw error;
  };

  const timelines = await repository.getJsonFileTimelines("missing-project");
  assert.deepEqual(timelines, []);
});

test("OntoGitKnowledgeBaseRepository 会在版本签名变化时自动失效缓存", async () => {
  const repository = new OntoGitKnowledgeBaseRepository();
  let revision = 1;
  let readCount = 0;

  repository.getJsonFileTimelines = async () => [
    {
      filename: "graph-source/domain/demo-entity.json",
      latest_commit_id: `commit-${revision}`,
      latest_version_id: revision,
      commits: [
        {
          commit_id: `commit-${revision}`,
          version_id: revision,
        },
      ],
    },
  ];

  repository.readProjectFile = async () => {
    readCount += 1;
    return {
      source: "linear-workflow",
      ontology: {
        workflow_version: "v1-linear-file-workflow",
        generated_at: "2026-04-25T00:00:00Z",
        project_id: "demo",
        scope: "entity",
        entity_id: "entity_a",
        entity_name: revision === 1 ? "实体A-旧版" : "实体A-新版",
        system_summary: {
          entity_count: 1,
          relation_count: 0,
          ablation_count: 0,
        },
        entity: {
          id: "entity_a",
          name: revision === 1 ? "实体A-旧版" : "实体A-新版",
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
        name: revision === 1 ? "实体A-旧版" : "实体A-新版",
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
    };
  };

  const firstGraph = await repository.getKnowledgeGraph("demo");
  revision = 2;
  const secondGraph = await repository.getKnowledgeGraph("demo");

  assert.equal(readCount, 2);
  assert.equal(firstGraph.entity_index["demo:entity_a"].name, "实体A-旧版");
  assert.equal(secondGraph.entity_index["demo:entity_a"].name, "实体A-新版");
});
