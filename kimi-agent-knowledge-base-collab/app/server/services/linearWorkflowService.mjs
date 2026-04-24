import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_TEXT_LIMIT = 20_000;
const DEFAULT_FILE_MESSAGE = "Workflow ingest";
const DEFAULT_AGENT_NAME = "linear-workflow";
const DEFAULT_COMMITTER_NAME = "linear-workflow";

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function buildSlug(value, fallback = "session") {
  const normalized = asText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || fallback;
}

function sanitizeFileName(value) {
  const normalized = asText(value).replace(/[\\/]+/g, "_").replace(/\0/g, "");
  return normalized || "input.bin";
}

function normalizeEntity(raw, index) {
  const item = raw && typeof raw === "object" ? raw : {};
  const name = asText(item.name) || `实体-${index + 1}`;
  const summary = asText(item.summary) || `${name} 的概要`;
  const properties = item.properties && typeof item.properties === "object" && !Array.isArray(item.properties)
    ? item.properties
    : {};
  const abilities = Array.isArray(item.abilities)
    ? item.abilities.map((ability) => asText(ability)).filter(Boolean)
    : [];
  const citations = Array.isArray(item.citations)
    ? item.citations.map((citation) => asText(citation)).filter(Boolean)
    : [];

  return {
    id: asText(item.id) || `ent_${buildSlug(name, "entity")}_${index + 1}`,
    name,
    summary,
    properties,
    abilities,
    citations,
  };
}

function normalizeRelation(raw, entityByName) {
  const item = raw && typeof raw === "object" ? raw : {};
  const source = asText(item.source);
  const target = asText(item.target);
  if (!source || !target) {
    return null;
  }

  const sourceEntity = entityByName.get(source) || entityByName.get(asText(item.source_id));
  const targetEntity = entityByName.get(target) || entityByName.get(asText(item.target_id));
  if (!sourceEntity || !targetEntity) {
    return null;
  }

  return {
    source_entity_id: sourceEntity.id,
    source_name: sourceEntity.name,
    target_entity_id: targetEntity.id,
    target_name: targetEntity.name,
    relation_type: asText(item.relation_type) || "包含",
    evidence: asText(item.evidence),
  };
}

function normalizeAblation(raw, entityById) {
  const item = raw && typeof raw === "object" ? raw : {};
  const entityId = asText(item.entity_id) || asText(item.entityId);
  const entity = entityById.get(entityId);
  if (!entity) {
    return null;
  }

  return {
    entity_id: entity.id,
    entity_name: entity.name,
    impact_level: asText(item.impact_level) || "medium",
    impact_reason: asText(item.impact_reason) || `${entity.name} 缺失会影响系统完整性。`,
    system_risk: asText(item.system_risk) || "unknown",
  };
}

function createStageResult(stage, index) {
  return {
    stage,
    order: index + 1,
    status: "pending",
    started_at: null,
    finished_at: null,
    output: null,
    error: null,
  };
}

function createStageEvent(stageResult, semanticStatus, detail, phaseState = "completed") {
  return {
    id: `stage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    semanticStatus,
    label: semanticStatus === "thinking"
      ? "思考中..."
      : semanticStatus === "executing"
        ? "执行中..."
        : semanticStatus === "reasoning"
          ? "推理中..."
          : semanticStatus === "observing"
            ? "观察中..."
            : semanticStatus === "completed"
              ? "执行结束..."
              : "执行中断...",
    phaseState,
    sourceEventType: `workflow.${stageResult.stage}`,
    detail,
    callId: null,
    startedAt: stageResult.started_at,
    finishedAt: stageResult.finished_at,
  };
}

function decodeDocumentText(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : "";
  return text.replace(/\u0000/g, "").trim();
}

function makeEntityFilename(entityName, usedNames) {
  const base = buildSlug(entityName, "entity");
  let candidate = `${base}.json`;
  if (!usedNames.has(candidate)) {
    usedNames.add(candidate);
    return candidate;
  }

  const hash = crypto.createHash("sha1").update(entityName).digest("hex").slice(0, 6);
  candidate = `${base}-${hash}.json`;
  usedNames.add(candidate);
  return candidate;
}

async function withTimeout(promise, timeoutMs, label) {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timeout (${timeoutMs}ms)`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export class LinearWorkflowService {
  constructor(options) {
    this.runtimeRoot = options.runtimeRoot;
    this.gatewayBaseUrl = asText(options.gatewayBaseUrl);
    this.gatewayApiKey = asText(options.gatewayApiKey);
    this.workflowTimeoutMs = asNumber(options.workflowTimeoutMs, DEFAULT_TIMEOUT_MS);
    this.workflowModel = asText(options.workflowModel)
      || process.env.WORKFLOW_MODEL
      || process.env.OPENROUTER_MODEL
      || process.env.DMXAPI_MODEL
      || "openai/gpt-4o-mini";
    this.workflowLlmBaseUrl = asText(options.workflowLlmBaseUrl)
      || process.env.WORKFLOW_LLM_BASE_URL
      || process.env.OPENROUTER_BASE_URL
      || process.env.DMXAPI_BASE_URL
      || "https://openrouter.ai/api/v1";
    this.workflowLlmApiKey = asText(options.workflowLlmApiKey)
      || process.env.WORKFLOW_LLM_API_KEY
      || process.env.OPENROUTER_API_KEY
      || process.env.DMXAPI_API_KEY
      || "";

    this.llmJsonInvoker = options.llmJsonInvoker || ((input) => this.invokeWorkflowLlmJson(input));
    this.probabilityInvoker = options.probabilityInvoker || ((payload) => this.invokeProbability(payload));
    this.baseVersionLoader = options.baseVersionLoader || ((projectId) => this.loadBaseVersionMap(projectId));
    this.ingestInvoker = options.ingestInvoker || ((payload) => this.invokeWriteAndInfer(payload));
  }

  getConversationRuntimeRoot(conversationId) {
    const runtimeParent = path.join(this.runtimeRoot, ".workflow-runs");
    return path.join(runtimeParent, `conversation-${buildSlug(conversationId)}`);
  }

  async ensureConversationRuntime(conversationId) {
    const root = this.getConversationRuntimeRoot(conversationId || "session");
    await mkdir(root, { recursive: true });
    await mkdir(path.join(root, "uploads"), { recursive: true });
    return root;
  }

  async invokeWorkflowLlmJson({ stage, instruction, payload }) {
    const userPrompt = [
      `你在执行线性工作流的 ${stage} 节点。`,
      instruction,
      "请仅返回 JSON，不要输出 markdown。",
      "输入数据如下：",
      JSON.stringify(payload, null, 2),
    ].join("\n\n");

    if (!this.workflowLlmApiKey || !this.workflowLlmBaseUrl) {
      throw new Error("workflow LLM is not configured");
    }

    const response = await fetch(`${this.workflowLlmBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.workflowLlmApiKey}`,
      },
      body: JSON.stringify({
        model: this.workflowModel,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: "你是本体工程助手。你只能返回合法 JSON。",
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`workflow LLM request failed: ${response.status} ${text}`);
    }

    const json = await response.json();
    const content = asText(json?.choices?.[0]?.message?.content);
    const parsed = safeJsonParse(content);
    if (!parsed) {
      throw new Error("workflow LLM returned invalid JSON");
    }
    return parsed;
  }

  async invokeGatewayJson(pathname, payload) {
    if (!this.gatewayBaseUrl) {
      throw new Error("gateway base url is not configured");
    }

    const headers = {
      "Content-Type": "application/json",
    };
    if (this.gatewayApiKey) {
      headers["X-API-Key"] = this.gatewayApiKey;
    }

    const response = await fetch(`${this.gatewayBaseUrl.replace(/\/$/, "")}${pathname}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    const parsed = text ? safeJsonParse(text) : {};

    if (!response.ok) {
      throw new Error(`${pathname} failed: ${response.status} ${text}`);
    }

    return parsed ?? {};
  }

  async invokeProbability(payload) {
    return this.invokeGatewayJson("/probability/api/llm/probability-reason", payload);
  }

  async loadBaseVersionMap(projectId) {
    if (!this.gatewayBaseUrl) {
      return new Map();
    }

    const headers = {};
    if (this.gatewayApiKey) {
      headers["X-API-Key"] = this.gatewayApiKey;
    }

    const url = `${this.gatewayBaseUrl.replace(/\/$/, "")}/xg/timelines/${encodeURIComponent(projectId)}`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      return new Map();
    }

    const payload = safeJsonParse(await response.text()) || {};
    const timelines = Array.isArray(payload?.timelines) ? payload.timelines : [];
    const map = new Map();

    for (const timeline of timelines) {
      const filename = asText(timeline?.filename);
      if (!filename) {
        continue;
      }
      const commits = Array.isArray(timeline?.commits) ? timeline.commits : [];
      const latest = commits.at(-1);
      const versionId = Number(latest?.versionId ?? 0);
      map.set(filename, Number.isFinite(versionId) && versionId > 0 ? versionId : 0);
    }

    return map;
  }

  async invokeWriteAndInfer(payload) {
    return this.invokeGatewayJson("/xg/write-and-infer", payload);
  }

  async runFileWorkflow(input) {
    const startedAt = nowIso();
    const conversationId = asText(input?.conversationId) || "file-workflow";
    const projectId = asText(input?.projectId);
    const runtimeRoot = await this.ensureConversationRuntime(conversationId);
    const uploadsDir = path.join(runtimeRoot, "uploads");
    await mkdir(uploadsDir, { recursive: true });

    if (!projectId) {
      return {
        ok: false,
        workflow: {
          mode: "linear",
          status: "failed",
          steps: ["observe", "relations", "ablation", "ontology", "probability_precheck", "ingest"],
        },
        stage_results: [],
        entity_files: [],
        ingest_results: [],
        errors: [{ stage: "request", message: "projectId is required" }],
        runtime_root: runtimeRoot,
      };
    }

    const rawName = sanitizeFileName(input?.fileName);
    const storedName = `${Date.now().toString(36)}-${rawName}`;
    const filePath = path.join(uploadsDir, storedName);
    const content = Buffer.isBuffer(input?.content) ? input.content : Buffer.alloc(0);
    await writeFile(filePath, content);

    const documentText = decodeDocumentText(content).slice(0, DEFAULT_TEXT_LIMIT);
    if (!documentText) {
      return {
        ok: false,
        workflow: {
          mode: "linear",
          status: "failed",
          steps: ["observe", "relations", "ablation", "ontology", "probability_precheck", "ingest"],
        },
        stage_results: [],
        entity_files: [],
        ingest_results: [],
        errors: [{ stage: "observe", message: "document text is empty or unreadable" }],
        runtime_root: runtimeRoot,
        input_file: {
          originalName: rawName,
          storedName,
          mimeType: asText(input?.mimeType) || "application/octet-stream",
          size: content.byteLength,
          path: filePath,
        },
      };
    }

    const timeoutMs = asNumber(input?.timeoutMs, this.workflowTimeoutMs);
    const stageKeys = [
      "observe",
      "relations",
      "ablation",
      "ontology",
      "probability_precheck",
      "ingest",
    ];
    const stageResults = stageKeys.map((stage, index) => createStageResult(stage, index));
    const errors = [];
    const entityFiles = [];
    const ingestResults = [];

    const state = {
      entities: [],
      relations: [],
      ablation: [],
      ontology: null,
      probabilityPrecheck: null,
      projectId,
      documentText,
    };

    const runStage = async (stageIndex, executor) => {
      const stage = stageResults[stageIndex];
      stage.started_at = nowIso();
      stage.status = "running";
      try {
        const output = await withTimeout(executor(), timeoutMs, `stage:${stage.stage}`);
        stage.output = output;
        stage.status = "success";
        stage.finished_at = nowIso();
        return output;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stage.status = "failed";
        stage.error = message;
        stage.finished_at = nowIso();
        errors.push({ stage: stage.stage, message });
        throw error;
      }
    };

    try {
      await runStage(0, async () => {
        const llmResult = await this.llmJsonInvoker({
          stage: "节点1-观察",
          instruction: "把文档拆分为实体数组 entities。每个实体必须有 name、summary、properties、abilities、citations（文本片段数组）。",
          payload: { document_text: documentText },
        });

        const rawEntities = Array.isArray(llmResult?.entities) ? llmResult.entities : [];
        const entities = rawEntities.map(normalizeEntity).filter((item) => asText(item.name));
        if (entities.length === 0) {
          throw new Error("节点1失败：未提取到实体");
        }
        state.entities = entities;
        return { entity_count: entities.length, entities };
      });

      await runStage(1, async () => {
        const llmResult = await this.llmJsonInvoker({
          stage: "节点2-操作",
          instruction: "根据 entities 提取 relations 数组。每条关系需包含 source、target、relation_type、evidence。",
          payload: { entities: state.entities, document_text: documentText },
        });

        const entityByName = new Map(state.entities.map((entity) => [entity.name, entity]));
        const rawRelations = Array.isArray(llmResult?.relations) ? llmResult.relations : [];
        const relations = rawRelations
          .map((item) => normalizeRelation(item, entityByName))
          .filter(Boolean);
        state.relations = relations;
        return { relation_count: relations.length, relations };
      });

      await runStage(2, async () => {
        const llmResult = await this.llmJsonInvoker({
          stage: "节点3-消融",
          instruction: "对每个实体做消融评估，返回 ablation 数组，字段：entity_id、impact_level、impact_reason、system_risk。",
          payload: { entities: state.entities, relations: state.relations },
        });

        const entityById = new Map(state.entities.map((entity) => [entity.id, entity]));
        const rawAblation = Array.isArray(llmResult?.ablation) ? llmResult.ablation : [];
        const ablation = rawAblation
          .map((item) => normalizeAblation(item, entityById))
          .filter(Boolean);
        if (ablation.length === 0) {
          throw new Error("节点3失败：未生成有效消融评估");
        }
        state.ablation = ablation;
        return { ablation_count: ablation.length, ablation };
      });

      await runStage(3, async () => {
        const ontology = {
          workflow_version: "v1-linear-file-workflow",
          generated_at: nowIso(),
          project_id: state.projectId,
          system_summary: {
            entity_count: state.entities.length,
            relation_count: state.relations.length,
            ablation_count: state.ablation.length,
          },
          entities: state.entities,
          relations: state.relations,
          ablation: state.ablation,
        };
        state.ontology = ontology;
        return ontology;
      });

      await runStage(4, async () => {
        const precheck = await this.probabilityInvoker(state.ontology);
        state.probabilityPrecheck = {
          precheck_probability: asText(precheck?.text) || asText(precheck?.probability) || "",
          precheck_reason: asText(precheck?.reason)
            || asText(precheck?.raw?.reason)
            || asText(precheck?.text),
          raw: precheck,
        };
        return state.probabilityPrecheck;
      });

      await runStage(5, async () => {
        const baseVersionMap = await this.baseVersionLoader(state.projectId);
        const usedNames = new Set();

        for (const entity of state.entities) {
          const filename = makeEntityFilename(entity.name, usedNames);
          const relatedRelations = state.relations.filter((relation) => (
            relation.source_entity_id === entity.id || relation.target_entity_id === entity.id
          ));
          const relatedAblation = state.ablation.find((item) => item.entity_id === entity.id) || null;
          const entityFilePayload = {
            source: "linear-workflow",
            entity,
            relations: relatedRelations,
            ablation: relatedAblation,
            precheck: state.probabilityPrecheck,
            ontology_summary: state.ontology?.system_summary || {},
          };

          entityFiles.push({
            entity_id: entity.id,
            entity_name: entity.name,
            filename,
            data: entityFilePayload,
          });

          const basevision = Number(baseVersionMap.get(filename) || 0);
          const ingestPayload = {
            project_id: state.projectId,
            filename,
            data: entityFilePayload,
            message: DEFAULT_FILE_MESSAGE,
            agent_name: DEFAULT_AGENT_NAME,
            committer_name: DEFAULT_COMMITTER_NAME,
            basevision,
            inference_message: "Workflow inference update",
            inference_agent_name: DEFAULT_AGENT_NAME,
            inference_committer_name: DEFAULT_COMMITTER_NAME,
          };

          try {
            const result = await this.ingestInvoker(ingestPayload);
            ingestResults.push({
              entity_id: entity.id,
              entity_name: entity.name,
              filename,
              status: asText(result?.status) || "success",
              commit_id: asText(result?.write_result?.commit_id) || "",
              version_id: result?.write_result?.version_id ?? null,
              raw: result,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ingestResults.push({
              entity_id: entity.id,
              entity_name: entity.name,
              filename,
              status: "failed",
              commit_id: "",
              version_id: null,
              error: message,
            });
            throw new Error(`节点6失败：${message}`);
          }
        }

        return {
          ingest_count: ingestResults.length,
          success_count: ingestResults.filter((item) => item.status !== "failed").length,
          ingest_results: ingestResults,
        };
      });
    } catch {
      return {
        ok: false,
        workflow: {
          mode: "linear",
          status: "failed",
          steps: stageKeys,
        },
        input_file: {
          originalName: rawName,
          storedName,
          mimeType: asText(input?.mimeType) || "application/octet-stream",
          size: content.byteLength,
          path: filePath,
        },
        stage_results: stageResults,
        entity_files: entityFiles,
        ingest_results: ingestResults,
        errors,
        runtime_root: runtimeRoot,
        started_at: startedAt,
        finished_at: nowIso(),
      };
    }

    return {
      ok: true,
      workflow: {
        mode: "linear",
        status: "success",
        steps: stageKeys,
      },
      input_file: {
        originalName: rawName,
        storedName,
        mimeType: asText(input?.mimeType) || "application/octet-stream",
        size: content.byteLength,
        path: filePath,
      },
      stage_results: stageResults,
      entity_files: entityFiles,
      ingest_results: ingestResults,
      errors,
      runtime_root: runtimeRoot,
      started_at: startedAt,
      finished_at: nowIso(),
    };
  }

  async ask(question, context, options = {}) {
    const runtimeRoot = await this.ensureConversationRuntime(options.conversationId || "session");
    const answer = [
      "固定线性工作流回答",
      `问题：${question}`,
      `上下文实体：${asText(context?.entity?.name) || "未指定"}`,
      `关联数量：${Array.isArray(context?.related) ? context.related.length : 0}`,
    ].join("\n");

    return {
      ok: true,
      answer,
      raw: {
        status: "success",
        code: "workflow.completed",
        payload: {
          mode: "linear",
          runtimeRoot,
          steps: ["read_input", "summarize_context", "compose_answer", "finalize_output"],
        },
      },
      stderr: "",
    };
  }

  async askStream(question, context, handlers = {}, options = {}) {
    if (options.signal?.aborted) {
      return {
        ok: false,
        error: "Workflow stream aborted",
        raw: { status: "runtime_error", code: "workflow.aborted" },
        stderr: "",
      };
    }

    const runtimeRoot = await this.ensureConversationRuntime(options.conversationId || "session");
    const stages = [
      { status: "thinking", text: "固定工作流步骤 1/4：读取输入" },
      { status: "executing", text: "固定工作流步骤 2/4：汇总上下文" },
      { status: "reasoning", text: "固定工作流步骤 3/4：生成回答" },
      { status: "completed", text: "固定工作流步骤 4/4：输出完成" },
    ];

    for (const [index, stage] of stages.entries()) {
      const started = nowIso();
      handlers.onStatus?.(stage.text);
      handlers.onExecutionStage?.(createStageEvent({
        stage: `chat_${index + 1}`,
        started_at: started,
        finished_at: nowIso(),
      }, stage.status, stage.text));
    }

    const answer = [
      "固定线性工作流回答",
      `问题：${question}`,
      `上下文实体：${asText(context?.entity?.name) || "未指定"}`,
    ].join("\n");

    const chars = Array.from(answer);
    for (let i = 0; i < chars.length; i += 24) {
      const delta = chars.slice(i, i + 24).join("");
      handlers.onAnswerDelta?.(delta);
    }

    handlers.onAssistantCompleted?.({
      assistantMessageId: `assistant-${Date.now().toString(36)}`,
      content: answer,
      createdAt: nowIso(),
    });

    return {
      ok: true,
      answer,
      raw: {
        status: "success",
        code: "workflow.completed",
        payload: {
          mode: "linear",
          runtimeRoot,
          steps: ["read_input", "summarize_context", "compose_answer", "finalize_output"],
        },
      },
      stderr: "",
    };
  }
}
