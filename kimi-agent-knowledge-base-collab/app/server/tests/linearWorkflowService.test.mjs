import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";

import { LinearWorkflowService } from "../services/linearWorkflowService.mjs";

function createService(overrides = {}) {
  return new LinearWorkflowService({
    runtimeRoot: overrides.runtimeRoot,
    gatewayBaseUrl: "http://127.0.0.1:8080",
    llmJsonInvoker: overrides.llmJsonInvoker,
    probabilityInvoker: overrides.probabilityInvoker,
    baseVersionLoader: overrides.baseVersionLoader,
    ingestInvoker: overrides.ingestInvoker,
    workflowTimeoutMs: 5_000,
  });
}

test("LinearWorkflowService executes 6-stage workflow and generates unique filenames", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-success-"));
  const ingestPayloads = [];

  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage }) => {
      if (stage.includes("节点1")) {
        return {
          entities: [
            {
              name: "设备管理",
              summary: "管理设备信息",
              properties: { kind: "module" },
              abilities: ["注册", "查询"],
              citations: ["设备管理负责设备台账维护"],
            },
            {
              name: "设备管理",
              summary: "重复名实体用于测试冲突命名",
              properties: { kind: "module" },
              abilities: ["变更"],
              citations: ["设备管理还负责变更"],
            },
          ],
        };
      }
      if (stage.includes("节点2")) {
        return {
          relations: [
            {
              source: "设备管理",
              target: "设备管理",
              relation_type: "组成",
              evidence: "二者共同完成设备全生命周期管理",
            },
          ],
        };
      }
      return {
        ablation: [
          {
            entity_id: "ent_-1", // intentionally invalid, service should normalize by map filter
            impact_level: "high",
            impact_reason: "缺失后会导致流程中断",
            system_risk: "high",
          },
          {
            entity_id: "ent_entity_1",
            impact_level: "medium",
            impact_reason: "影响部分能力",
            system_risk: "medium",
          },
          {
            entity_id: "ent_entity_2",
            impact_level: "low",
            impact_reason: "可降级运行",
            system_risk: "low",
          },
        ],
      };
    },
    probabilityInvoker: async () => ({ probability: "86%", reason: "结构完整，风险可控" }),
    baseVersionLoader: async () => new Map(),
    ingestInvoker: async (payload) => {
      ingestPayloads.push(payload);
      return {
        status: "success",
        write_result: {
          commit_id: `commit-${ingestPayloads.length}`,
          version_id: ingestPayloads.length,
        },
      };
    },
  });

  const result = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "doc.md",
    mimeType: "text/markdown",
    content: Buffer.from("# 设备管理\n设备管理负责设备台账维护\n", "utf8"),
    conversationId: "case-success",
  });

  assert.equal(result.ok, true);
  assert.equal(result.workflow.status, "success");
  assert.equal(result.stage_results.length, 6);
  assert.equal(result.errors.length, 0);
  assert.equal(result.ingest_results.length, 2);
  assert.equal(new Set(result.entity_files.map((item) => item.filename)).size, 2);
});

test("LinearWorkflowService stops when stage-1 returns empty entities", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-empty-"));
  let calledProbability = false;

  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage }) => {
      if (stage.includes("节点1")) {
        return { entities: [] };
      }
      return {};
    },
    probabilityInvoker: async () => {
      calledProbability = true;
      return { probability: "99%", reason: "unused" };
    },
    ingestInvoker: async () => ({ status: "success", write_result: { commit_id: "c", version_id: 1 } }),
  });

  const result = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "doc.md",
    mimeType: "text/markdown",
    content: Buffer.from("文档内容", "utf8"),
  });

  assert.equal(result.ok, false);
  assert.equal(result.stage_results[0].status, "failed");
  assert.equal(result.stage_results[1].status, "pending");
  assert.equal(calledProbability, false);
});

test("LinearWorkflowService fails fast when stage-1 LLM is unavailable", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-llm-down-"));
  let calledProbability = false;
  let calledIngest = false;

  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage }) => {
      if (stage.includes("节点1")) {
        throw new Error("workflow LLM is not configured");
      }
      return {};
    },
    probabilityInvoker: async () => {
      calledProbability = true;
      return { probability: "88%", reason: "unused" };
    },
    ingestInvoker: async () => {
      calledIngest = true;
      return { status: "success", write_result: { commit_id: "c", version_id: 1 } };
    },
  });

  const result = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "doc.md",
    mimeType: "text/markdown",
    content: Buffer.from("文档内容", "utf8"),
  });

  assert.equal(result.ok, false);
  assert.equal(result.stage_results[0].status, "failed");
  assert.equal(result.stage_results[1].status, "pending");
  assert.equal(result.stage_results[2].status, "pending");
  assert.equal(calledProbability, false);
  assert.equal(calledIngest, false);
  assert.equal(result.errors.some((item) => item.stage === "observe"), true);
});

test("LinearWorkflowService marks stage-6 as failed when ingest fails", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-ingest-fail-"));
  let ingestCount = 0;

  const service = createService({
    runtimeRoot,
    llmJsonInvoker: async ({ stage }) => {
      if (stage.includes("节点1")) {
        return {
          entities: [
            {
              name: "实体A",
              summary: "A",
              properties: {},
              abilities: [],
              citations: ["A 引用"],
            },
            {
              name: "实体B",
              summary: "B",
              properties: {},
              abilities: [],
              citations: ["B 引用"],
            },
          ],
        };
      }
      if (stage.includes("节点2")) {
        return { relations: [] };
      }
      return {
        ablation: [
          { entity_id: "ent_a_1", impact_level: "high", impact_reason: "A", system_risk: "high" },
          { entity_id: "ent_b_2", impact_level: "low", impact_reason: "B", system_risk: "low" },
        ],
      };
    },
    probabilityInvoker: async () => ({ probability: "75%", reason: "ok" }),
    baseVersionLoader: async () => new Map(),
    ingestInvoker: async () => {
      ingestCount += 1;
      if (ingestCount === 2) {
        throw new Error("mock ingest failure");
      }
      return { status: "success", write_result: { commit_id: "ok", version_id: 1 } };
    },
  });

  const result = await service.runFileWorkflow({
    projectId: "demo",
    fileName: "doc.md",
    mimeType: "text/markdown",
    content: Buffer.from("实体A\n实体B\n", "utf8"),
  });

  assert.equal(result.ok, false);
  assert.equal(result.stage_results[5].status, "failed");
  assert.equal(result.errors.some((item) => item.stage === "ingest"), true);
  assert.equal(result.ingest_results.length >= 1, true);
});
