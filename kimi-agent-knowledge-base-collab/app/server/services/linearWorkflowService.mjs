import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateWorkflowEntityFileData } from "../workflowEntityFormat.mjs";
import { WORKFLOW_STAGE_KEYS } from "../../src/shared/workflowStages.js";
import { SystemAdapter } from "./systemAdapter.mjs";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_TEXT_LIMIT = 20_000;
const DEFAULT_FILE_MESSAGE = "Workflow ingest";
const DEFAULT_AGENT_NAME = "linear-workflow";
const DEFAULT_COMMITTER_NAME = "linear-workflow";
const ABLATION_SMALL_REASON_THRESHOLD = 10;
const WORKFLOW_SNAPSHOT_FILE = "latest-run.json";

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function asStringSet(value) {
  if (value instanceof Set) {
    return new Set([...value].map((item) => asText(item)).filter(Boolean));
  }

  if (Array.isArray(value)) {
    return new Set(value.map((item) => asText(item)).filter(Boolean));
  }

  return new Set();
}

function normalizeEntityIdState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const sequenceSeed = Number(value.sequenceSeed);
  return {
    usedEntityIds: asStringSet(value.usedEntityIds),
    sequenceSeed: Number.isFinite(sequenceSeed) ? Math.max(0, Math.floor(sequenceSeed)) : null,
  };
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function createStageDebugOutput(debug = {}) {
  const output = {};
  if (debug.llm_raw !== undefined) {
    output.llm_raw = debug.llm_raw;
  }
  if (typeof debug.llm_raw_text === "string" && debug.llm_raw_text.trim()) {
    output.llm_raw_text = debug.llm_raw_text;
  }
  if (debug.llm_response !== undefined) {
    output.llm_response = debug.llm_response;
  }
  if (typeof debug.debug_error === "string" && debug.debug_error.trim()) {
    output.debug_error = debug.debug_error;
  }
  return output;
}

function attachStageDebug(error, debug = {}) {
  const baseError = error instanceof Error ? error : new Error(String(error));
  const stageOutput = createStageDebugOutput(debug);
  if (Object.keys(stageOutput).length > 0) {
    baseError.stageOutput = {
      ...(baseError.stageOutput && typeof baseError.stageOutput === "object" ? baseError.stageOutput : {}),
      ...stageOutput,
    };
  }
  return baseError;
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

function buildEntityFileStem(value) {
  const normalized = asText(value)
    .replace(/[\\/]+/g, "_")
    .replace(/[\0<>:"|?*]/g, "_")
    .trim();
  return normalized || "未命名实体";
}

function buildSequentialEntityId(name, sequence) {
  return `ent_${buildSlug(name, "entity")}_${sequence}`;
}

function createEntityIdAllocator({ usedEntityIds, sequenceSeed }) {
  const taken = usedEntityIds instanceof Set
    ? new Set([...usedEntityIds].map((item) => asText(item)).filter(Boolean))
    : new Set();
  let sequence = Math.max(0, Math.floor(Number(sequenceSeed) || 0));

  return (name) => {
    let candidate = "";
    do {
      sequence += 1;
      candidate = buildSequentialEntityId(name, sequence);
    } while (taken.has(candidate));
    taken.add(candidate);
    return {
      entity_id: candidate,
      sequence,
    };
  };
}

function normalizeEntity(raw, index, entityIdAllocator) {
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
  const allocated = typeof entityIdAllocator === "function"
    ? entityIdAllocator(name)
    : null;

  return {
    id: asText(allocated?.entity_id) || buildSequentialEntityId(name, index + 1),
    name,
    summary,
    type: asText(item.type) || asText(properties.kind) || "workflow-entity",
    level: asNumber(item.level, 1),
    source: asText(item.source) || "linear-workflow",
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

function resolveAblationEntity(item, entityById, entityByName) {
  const entityId = asText(item.entity_id);
  const entityName = asText(item.entity_name);
  return entityById.get(entityId) || entityByName.get(entityName) || null;
}

function normalizeAblation(raw, entityById, entityByName = new Map()) {
  const item = raw && typeof raw === "object" ? raw : {};
  const entity = resolveAblationEntity(item, entityById, entityByName);
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

function normalizeAblationCandidate(raw, entityById, entityByName = new Map()) {
  const item = raw && typeof raw === "object" ? raw : {};
  const entity = resolveAblationEntity(item, entityById, entityByName);
  if (!entity) {
    return null;
  }

  const fallbackEvidence = Array.isArray(entity.citations) && entity.citations.length > 0
    ? asText(entity.citations[0])
    : entity.summary;

  return {
    entity_id: entity.id,
    entity_name: entity.name,
    remove_target: asText(item.remove_target) || entity.name,
    retain_target: asText(item.retain_target) || entity.name,
    keep_role: asText(item.keep_role) || entity.summary || `${entity.name} 负责关键能力承接`,
    remove_impact: asText(item.remove_impact) || `${entity.name} 被去除后会影响关键能力稳定性`,
    observation: asText(item.observation),
    evidence: asText(item.evidence) || fallbackEvidence,
  };
}

function normalizeAblationJudge(raw, entityById, entityByName = new Map()) {
  const item = raw && typeof raw === "object" ? raw : {};
  const entity = resolveAblationEntity(item, entityById, entityByName);
  if (!entity) {
    return null;
  }

  const normalized = {
    entity_id: entity.id,
    entity_name: entity.name,
    keep_probability: asText(item.keep_probability),
    remove_probability: asText(item.remove_probability),
    probability_gap: asText(item.probability_gap),
    judge_reason: asText(item.judge_reason) || `${entity.name} 的保留版与去除版差异需要继续观察`,
  };

  if (item.small_reason === true) {
    normalized.small_reason = true;
  }

  return normalized;
}

function parseProbabilityValue(value) {
  const text = asText(value);
  const matched = text.match(/-?\d+(?:\.\d+)?/);
  if (!matched) {
    return null;
  }
  const parsed = Number(matched[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatProbabilityValue(value) {
  if (!Number.isFinite(value)) {
    return "";
  }
  const rounded = Math.round(value);
  return `${rounded}%`;
}

function normalizeProbabilityDecision(raw, entity, label) {
  const item = raw && typeof raw === "object" ? raw : {};
  const probability = asText(item.probability);
  const probabilityValue = parseProbabilityValue(probability);
  if (probabilityValue === null) {
    throw new Error(`${label} 未返回可解析的 probability`);
  }

  return {
    entity_id: entity.id,
    entity_name: entity.name,
    probability,
    reason: asText(item.reason),
    probability_value: probabilityValue,
  };
}

function buildJudgeReason(keepDecision, removeDecision, probabilityGap, isHit) {
  const summary = isHit
    ? `差值 ${probabilityGap} 大于等于 10%，判定命中小故`
    : `差值 ${probabilityGap} 小于 10%，继续观察`;
  const keepReason = asText(keepDecision?.reason)
    ? `保留版：${asText(keepDecision.reason)}`
    : "";
  const removeReason = asText(removeDecision?.reason)
    ? `去除版：${asText(removeDecision.reason)}`
    : "";
  return [summary, keepReason, removeReason].filter(Boolean).join("；");
}

function buildAblationJudgeFromProbabilities(entity, keepDecision, removeDecision) {
  const gapValue = keepDecision.probability_value - removeDecision.probability_value;
  const probabilityGap = formatProbabilityValue(gapValue);
  const isHit = gapValue >= ABLATION_SMALL_REASON_THRESHOLD;
  const normalized = {
    entity_id: entity.id,
    entity_name: entity.name,
    keep_probability: keepDecision.probability,
    remove_probability: removeDecision.probability,
    probability_gap: probabilityGap,
    judge_reason: buildJudgeReason(keepDecision, removeDecision, probabilityGap, isHit),
  };

  if (isHit) {
    normalized.small_reason = true;
  }

  return normalized;
}

function buildResponseFormat(responseSchema) {
  if (!responseSchema || typeof responseSchema !== "object") {
    return null;
  }
  const name = asText(responseSchema.name);
  const schema = responseSchema.schema;
  if (!name || !schema || typeof schema !== "object" || Array.isArray(schema)) {
    return null;
  }
  return {
    type: "json_schema",
    json_schema: {
      name,
      strict: responseSchema.strict !== false,
      schema,
    },
  };
}

function mergeAblationResult(candidate, judge) {
  const merged = {
    entity_id: asText(candidate?.entity_id) || asText(judge?.entity_id),
    entity_name: asText(candidate?.entity_name) || asText(judge?.entity_name),
    impact_level: judge?.small_reason ? "high" : "medium",
    impact_reason: asText(candidate?.remove_impact) || asText(judge?.judge_reason),
    system_risk: judge?.small_reason ? "high" : "observed",
    remove_target: asText(candidate?.remove_target),
    retain_target: asText(candidate?.retain_target),
    keep_role: asText(candidate?.keep_role),
    remove_impact: asText(candidate?.remove_impact),
    observation: asText(candidate?.observation),
    evidence: asText(candidate?.evidence),
    keep_probability: asText(judge?.keep_probability),
    remove_probability: asText(judge?.remove_probability),
    probability_gap: asText(judge?.probability_gap),
    judge_reason: asText(judge?.judge_reason),
  };

  if (judge?.small_reason === true) {
    merged.small_reason = true;
  }

  return merged;
}

function extractRelationCandidates(llmResult) {
  if (Array.isArray(llmResult)) {
    return llmResult;
  }
  if (Array.isArray(llmResult?.relations)) {
    return llmResult.relations;
  }
  if (Array.isArray(llmResult?.data)) {
    return llmResult.data;
  }
  if (Array.isArray(llmResult?.items)) {
    return llmResult.items;
  }
  return [];
}

function extractEntityCandidates(llmResult) {
  if (Array.isArray(llmResult)) {
    return llmResult;
  }
  if (Array.isArray(llmResult?.entities)) {
    return llmResult.entities;
  }
  if (Array.isArray(llmResult?.data)) {
    return llmResult.data;
  }
  if (Array.isArray(llmResult?.items)) {
    return llmResult.items;
  }
  return [];
}

function extractAblationCandidates(llmResult) {
  if (Array.isArray(llmResult)) {
    return llmResult;
  }
  if (Array.isArray(llmResult?.ablation_candidates)) {
    return llmResult.ablation_candidates;
  }
  if (Array.isArray(llmResult?.ablation)) {
    return llmResult.ablation;
  }
  if (Array.isArray(llmResult?.data)) {
    return llmResult.data;
  }
  if (Array.isArray(llmResult?.items)) {
    return llmResult.items;
  }
  return [];
}

function extractAblationJudgeCandidates(llmResult) {
  if (Array.isArray(llmResult?.ablation_judges)) {
    return llmResult.ablation_judges;
  }
  if (Array.isArray(llmResult?.ablation)) {
    return llmResult.ablation;
  }
  return [];
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
  const base = buildEntityFileStem(entityName);
  let candidate = `${base}.json`;
  if (!usedNames.has(candidate)) {
    usedNames.add(candidate);
    return candidate;
  }

  let suffix = 2;
  while (usedNames.has(candidate)) {
    candidate = `${base}-${suffix}.json`;
    suffix += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function cloneJsonValue(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  return JSON.parse(JSON.stringify(value));
}

function ensureStagePrerequisite(condition, stageName, message) {
  if (!condition) {
    throw new Error(`${stageName}前置条件不满足：${message}`);
  }
}

function validateStageOutputShape(stageKey, output) {
  const record = asRecord(output);
  switch (stageKey) {
    case "auth_precheck":
      if (typeof record.authenticated !== "boolean" && record.skipped !== true) {
        throw new Error("auth_precheck 输出缺少 authenticated/skipped");
      }
      return;
    case "observe":
      if (!Array.isArray(record.entities)) {
        throw new Error("observe 输出缺少 entities");
      }
      if (typeof record.entity_count !== "number") {
        throw new Error("observe 输出缺少 entity_count");
      }
      return;
    case "relations":
      if (!Array.isArray(record.relations)) {
        throw new Error("relations 输出缺少 relations");
      }
      if (typeof record.relation_count !== "number") {
        throw new Error("relations 输出缺少 relation_count");
      }
      return;
    case "ablation_candidate":
      if (!Array.isArray(record.candidates) && !Array.isArray(record.ablation_candidates)) {
        throw new Error("ablation_candidate 输出缺少 candidates");
      }
      if (typeof record.candidate_count !== "number") {
        throw new Error("ablation_candidate 输出缺少 candidate_count");
      }
      return;
    case "ablation_judge":
      if (!Array.isArray(record.ablation_judges)) {
        throw new Error("ablation_judge 输出缺少 ablation_judges");
      }
      if (!Array.isArray(record.ablation)) {
        throw new Error("ablation_judge 输出缺少 ablation");
      }
      if (typeof record.ablation_count !== "number") {
        throw new Error("ablation_judge 输出缺少 ablation_count");
      }
      return;
    case "ontology":
      if (!record.ontology || !Array.isArray(record.ontologies)) {
        throw new Error("ontology 输出缺少 ontology 或 ontologies");
      }
      if (typeof record.ontology_count !== "number") {
        throw new Error("ontology 输出缺少 ontology_count");
      }
      return;
    case "probability_precheck":
      if (!Array.isArray(record.prechecks)) {
        throw new Error("probability_precheck 输出缺少 prechecks");
      }
      if (typeof record.precheck_count !== "number") {
        throw new Error("probability_precheck 输出缺少 precheck_count");
      }
      return;
    case "ingest":
      if (!Array.isArray(record.ingest_results)) {
        throw new Error("ingest 输出缺少 ingest_results");
      }
      if (typeof record.ingest_count !== "number") {
        throw new Error("ingest 输出缺少 ingest_count");
      }
      return;
    default:
      return;
  }
}

export class LinearWorkflowService {
  constructor(options) {
    this.runtimeRoot = options.runtimeRoot;
    this.gatewayBaseUrl = asText(options.gatewayBaseUrl);
    this.gatewayApiKey = asText(options.gatewayApiKey);
    this.gatewayLoginInvoker = typeof options.gatewayLoginInvoker === "function" ? options.gatewayLoginInvoker : null;
    this.gatewayRequestInvoker = typeof options.gatewayRequestInvoker === "function" ? options.gatewayRequestInvoker : null;
    this.gatewayWriteInvoker = typeof options.gatewayWriteInvoker === "function" ? options.gatewayWriteInvoker : null;
    this.gatewayAuthUsername = asText(options.gatewayAuthUsername)
      || process.env.ONTOGIT_AUTH_USERNAME
      || process.env.XG_AUTH_USERNAME
      || "";
    this.gatewayAuthPassword = asText(options.gatewayAuthPassword)
      || process.env.ONTOGIT_AUTH_PASSWORD
      || process.env.XG_AUTH_PASSWORD
      || "";
    this.gatewayAccessToken = "";
    this.gatewayLoginPromise = null;
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
    this.workflowEnvResolver = typeof options.workflowEnvResolver === "function" ? options.workflowEnvResolver : null;
    this.entityIdSeedLoader = typeof options.entityIdSeedLoader === "function"
      ? options.entityIdSeedLoader
      : async () => 0;
    this.entityIdStateLoader = typeof options.entityIdStateLoader === "function"
      ? options.entityIdStateLoader
      : null;
    this.projectWorkflowLocks = new Map();

    this.llmJsonInvokerBase = options.llmJsonInvoker || ((input) => this.invokeWorkflowLlmJson(input));
    this.llmJsonInvoker = (input) => this.invokeWorkflowLlmJsonWithRetry(input);
    this.systemAdapter = options.systemAdapter || new SystemAdapter({
      llmJsonInvoker: (input) => this.llmJsonInvoker(input),
    });
    this.probabilityInvoker = options.probabilityInvoker || ((payload) => this.invokeProbability(payload));
    this.baseVersionLoader = options.baseVersionLoader || ((projectId) => this.loadBaseVersionMap(projectId));
    this.ingestInvoker = options.ingestInvoker || ((payload) => this.invokeWrite(payload));
  }

  getWorkflowConfig() {
    return {
      workflowModel: this.workflowModel,
    };
  }

  setWorkflowModel(modelName) {
    const nextModel = asText(modelName);
    if (!nextModel) {
      throw new Error("workflow model cannot be empty");
    }
    this.workflowModel = nextModel;
    return this.getWorkflowConfig();
  }

  async acquireProjectWorkflowLock(projectId) {
    const lockKey = asText(projectId) || "demo";
    const previousTail = this.projectWorkflowLocks.get(lockKey) || Promise.resolve();
    let releaseCurrent = null;
    const currentLock = new Promise((resolve) => {
      releaseCurrent = resolve;
    });
    const nextTail = previousTail.then(() => currentLock);
    this.projectWorkflowLocks.set(lockKey, nextTail);
    await previousTail;

    let released = false;
    return async () => {
      if (released) {
        return;
      }
      released = true;
      if (typeof releaseCurrent === "function") {
        releaseCurrent();
      }
      if (this.projectWorkflowLocks.get(lockKey) === nextTail) {
        this.projectWorkflowLocks.delete(lockKey);
      }
    };
  }

  async refreshWorkflowConfigFromResolver() {
    if (!this.workflowEnvResolver) {
      return;
    }

    const resolved = await this.workflowEnvResolver();
    const config = resolved && typeof resolved === "object" && !Array.isArray(resolved) ? resolved : {};
    const nextModel = asText(config.workflowModel);
    const nextBaseUrl = asText(config.workflowLlmBaseUrl);
    const nextApiKey = asText(config.workflowLlmApiKey);

    if (nextModel) {
      this.workflowModel = nextModel;
    }
    if (nextBaseUrl) {
      this.workflowLlmBaseUrl = nextBaseUrl;
    }
    if (nextApiKey) {
      this.workflowLlmApiKey = nextApiKey;
    }
  }

  getConversationRuntimeRoot(conversationId) {
    const runtimeParent = path.join(this.runtimeRoot, ".workflow-runs");
    return path.join(runtimeParent, `conversation-${buildSlug(conversationId)}`);
  }

  async ensureConversationRuntime(conversationId) {
    const conversationKey = conversationId || "session";
    const root = this.getConversationRuntimeRoot(conversationKey);
    try {
      await mkdir(root, { recursive: true });
      await mkdir(path.join(root, "uploads"), { recursive: true });
      return root;
    } catch {
      const fallbackBase = path.join(process.cwd(), ".workflow-runs");
      const fallbackRoot = path.join(fallbackBase, `conversation-${buildSlug(conversationKey)}`);
      await mkdir(fallbackRoot, { recursive: true });
      await mkdir(path.join(fallbackRoot, "uploads"), { recursive: true });
      this.runtimeRoot = process.cwd();
      return fallbackRoot;
    }
  }

  getWorkflowSnapshotPath(conversationId) {
    return path.join(this.getConversationRuntimeRoot(conversationId || "session"), WORKFLOW_SNAPSHOT_FILE);
  }

  async writeWorkflowSnapshot(conversationId, snapshot) {
    const runtimeRoot = await this.ensureConversationRuntime(conversationId || "session");
    const snapshotPath = path.join(runtimeRoot, WORKFLOW_SNAPSHOT_FILE);
    await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");
  }

  async readWorkflowSnapshot(conversationId) {
    const snapshotPath = this.getWorkflowSnapshotPath(conversationId || "session");
    const content = await readFile(snapshotPath, "utf8");
    const parsed = safeJsonParse(content);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("workflow snapshot is invalid");
    }
    return parsed;
  }

  buildInitialWorkflowState(projectId) {
    return {
      entities: [],
      relations: [],
      ablation: [],
      ablationCandidates: [],
      ablationJudges: [],
      ontology: null,
      ontologies: [],
      probabilityPrecheck: null,
      projectId,
      documentText: "",
    };
  }

  async retryFileWorkflowFromStage(input) {
    const conversationId = asText(input?.conversationId) || "file-workflow";
    const projectId = asText(input?.projectId);
    const startStage = asText(input?.startStage);
    const handlers = input?.handlers && typeof input.handlers === "object" ? input.handlers : {};
    const runtimeRoot = this.getConversationRuntimeRoot(conversationId);

    if (!projectId) {
      return {
        ok: false,
        workflow: {
          mode: "linear",
          status: "failed",
          steps: WORKFLOW_STAGE_KEYS,
        },
        stage_results: [],
        entity_files: [],
        ingest_results: [],
        errors: [{ stage: "request", message: "projectId is required" }],
        runtime_root: runtimeRoot,
      };
    }

    if (!startStage || !WORKFLOW_STAGE_KEYS.includes(startStage)) {
      return {
        ok: false,
        workflow: {
          mode: "linear",
          status: "failed",
          steps: WORKFLOW_STAGE_KEYS,
        },
        stage_results: [],
        entity_files: [],
        ingest_results: [],
        errors: [{ stage: "request", message: "startStage is invalid" }],
        runtime_root: runtimeRoot,
      };
    }

    const snapshot = await this.readWorkflowSnapshot(conversationId);
    const snapshotProjectId = asText(snapshot?.state?.projectId) || asText(snapshot?.project_id);
    if (snapshotProjectId && snapshotProjectId !== projectId) {
      throw new Error("workflow snapshot project_id mismatch");
    }

    const stageIndex = WORKFLOW_STAGE_KEYS.indexOf(startStage);
    if (stageIndex === -1) {
      throw new Error("workflow retry stage not found");
    }

    return this.runFileWorkflow({
      conversationId,
      projectId,
      fileName: asText(snapshot?.input_file?.originalName) || asText(snapshot?.input_file?.storedName) || "upload.bin",
      mimeType: asText(snapshot?.input_file?.mimeType) || "application/octet-stream",
      resumeFromStageIndex: stageIndex,
      resumeSnapshot: snapshot,
      handlers,
    });
  }

  async invokeWorkflowLlmJson({ stage, instruction, payload, temperature = 0, responseSchema = null }) {
    const userPrompt = [
      `你在执行线性工作流的 ${stage} 节点。`,
      instruction,
      "请仅返回 JSON，不要输出任何非 JSON 文本。",
      "输入数据如下：",
      JSON.stringify(payload, null, 2),
    ].join("\n\n");

    if (!this.workflowLlmApiKey || !this.workflowLlmBaseUrl) {
      await this.refreshWorkflowConfigFromResolver();
    }

    if (!this.workflowLlmApiKey || !this.workflowLlmBaseUrl) {
      throw new Error("workflow LLM is not configured");
    }

    const requestBody = {
      model: this.workflowModel,
      temperature,
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
    };
    const responseFormat = buildResponseFormat(responseSchema);
    if (responseFormat) {
      requestBody.response_format = responseFormat;
    }

    const response = await fetch(`${this.workflowLlmBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.workflowLlmApiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`workflow LLM request failed: ${response.status} ${text}`);
    }

    const json = await response.json();
    const content = asText(json?.choices?.[0]?.message?.content);
    const parsed = safeJsonParse(content);
    if (!parsed) {
      throw attachStageDebug(new Error("workflow LLM returned invalid JSON"), {
        llm_raw_text: content,
        llm_response: json,
        debug_error: "workflow LLM returned invalid JSON",
      });
    }
    return {
      llm_raw: parsed,
      llm_raw_text: content,
      llm_response: json,
      data: parsed,
    };
  }

  async invokeWorkflowLlmJsonWithRetry({ stage, instruction, payload, responseSchema = null }) {
    const temperatures = [0, 0.3, 0.7];
    let lastError = null;

    for (let index = 0; index < temperatures.length; index += 1) {
      const temperature = temperatures[index];
      try {
        return await this.llmJsonInvokerBase({
          stage,
          instruction,
          payload,
          responseSchema,
          temperature,
          attempt: index + 1,
          maxAttempts: temperatures.length,
        });
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("workflow LLM returned invalid JSON")) {
          throw error;
        }
        if (index < temperatures.length - 1) {
          continue;
        }
      }
    }

    const fallbackMessage = lastError instanceof Error ? lastError.message : "workflow LLM returned invalid JSON";
    throw attachStageDebug(
      new Error(`${fallbackMessage} after ${temperatures.length} attempts`),
      lastError && typeof lastError === "object" && lastError.stageOutput && typeof lastError.stageOutput === "object"
        ? lastError.stageOutput
        : {},
    );
  }

  async buildGatewayHeaders(forceRefresh = false) {
    if (forceRefresh) {
      this.gatewayAccessToken = "";
    }

    if (!this.gatewayAccessToken && this.gatewayAuthUsername && this.gatewayAuthPassword && this.gatewayBaseUrl) {
      await this.ensureGatewayLogin(true).catch(() => null);
    }

    const headers = {
      "Content-Type": "application/json",
    };
    if (this.gatewayAccessToken) {
      headers.Authorization = `Bearer ${this.gatewayAccessToken}`;
      return headers;
    }
    if (this.gatewayApiKey) {
      headers["X-API-Key"] = this.gatewayApiKey;
      return headers;
    }

    throw new Error("gateway auth is not configured");
  }

  async invokeGatewayJson(pathname, payload) {
    if (this.gatewayRequestInvoker) {
      return this.gatewayRequestInvoker(pathname, {
        method: "POST",
        payload,
      });
    }

    if (!this.gatewayBaseUrl) {
      throw new Error("gateway base url is not configured");
    }

    const headers = await this.buildGatewayHeaders();

    const response = await fetch(`${this.gatewayBaseUrl.replace(/\/$/, "")}${pathname}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    const parsed = text ? safeJsonParse(text) : {};

    if (!response.ok) {
      if (response.status === 401 && this.gatewayAuthUsername && this.gatewayAuthPassword) {
        this.gatewayAccessToken = "";
        await this.ensureGatewayLogin().catch(() => null);
        if (this.gatewayAccessToken) {
          return this.invokeGatewayJson(pathname, payload);
        }
      }
      throw new Error(`${pathname} failed: ${response.status} ${text}`);
    }

    return parsed ?? {};
  }

  async invokeProbability(payload) {
    return this.invokeGatewayJson("/probability/api/llm/probability-reason", payload);
  }

  async loadBaseVersionMap(projectId) {
    if (this.gatewayRequestInvoker) {
      const payload = await this.gatewayRequestInvoker(`/xg/timelines/${encodeURIComponent(projectId)}`, {
        method: "GET",
      });
      const timelines = Array.isArray(payload?.timelines) ? payload.timelines : [];
      const map = new Map();
      for (const timeline of timelines) {
        const filename = asText(timeline?.filename);
        if (!filename) {
          continue;
        }
        const commits = Array.isArray(timeline?.commits) ? timeline.commits : [];
        const latest = commits.at(-1);
        const versionId = Number(latest?.versionId ?? latest?.version_id ?? 0);
        map.set(filename, Number.isFinite(versionId) && versionId > 0 ? versionId : 0);
      }
      return map;
    }

    if (!this.gatewayBaseUrl) {
      return new Map();
    }

    const headers = await this.buildGatewayHeaders();

    const url = `${this.gatewayBaseUrl.replace(/\/$/, "")}/xg/timelines/${encodeURIComponent(projectId)}`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      if (response.status === 401 && this.gatewayAuthUsername && this.gatewayAuthPassword) {
        this.gatewayAccessToken = "";
        await this.ensureGatewayLogin().catch(() => null);
        if (this.gatewayAccessToken) {
          return this.loadBaseVersionMap(projectId);
        }
      }
      if (response.status === 401) {
        throw new Error(`/xg/timelines/${projectId} unauthorized`);
      }
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
    if (!Number.isFinite(Number(payload?.basevision))) {
      throw new Error("/xg/write-and-infer failed: missing basevision");
    }
    if (this.gatewayLoginInvoker) {
      await this.gatewayLoginInvoker();
    } else if (!this.gatewayAccessToken) {
      await this.ensureGatewayLogin(true).catch(() => null);
    }
    if (this.gatewayWriteInvoker) {
      return this.gatewayWriteInvoker("/xg/write-and-infer", payload);
    }
    return this.invokeGatewayJson("/xg/write-and-infer", payload);
  }

  async invokeWrite(payload) {
    if (!Number.isFinite(Number(payload?.basevision))) {
      throw new Error("/xg/write failed: missing basevision");
    }
    if (this.gatewayLoginInvoker) {
      await this.gatewayLoginInvoker();
    } else if (!this.gatewayAccessToken) {
      await this.ensureGatewayLogin(true).catch(() => null);
    }
    const writePayload = {
      project_id: payload?.project_id,
      filename: payload?.filename,
      data: payload?.data,
      message: payload?.message,
      agent_name: payload?.agent_name,
      committer_name: payload?.committer_name,
      basevision: payload?.basevision,
    };
    if (this.gatewayWriteInvoker) {
      return this.gatewayWriteInvoker("/xg/write", writePayload);
    }
    return this.invokeGatewayJson("/xg/write", writePayload);
  }

  async ensureGatewayLogin(forceRefresh = false) {
    if (this.gatewayLoginInvoker) {
      return this.gatewayLoginInvoker();
    }
    if (forceRefresh) {
      this.gatewayAccessToken = "";
    }
    if (this.gatewayAccessToken) {
      return this.gatewayAccessToken;
    }
    if (this.gatewayLoginPromise) {
      return this.gatewayLoginPromise;
    }
    if (!this.gatewayAuthUsername || !this.gatewayAuthPassword || !this.gatewayBaseUrl) {
      throw new Error("gateway auth is not configured");
    }

    this.gatewayLoginPromise = (async () => {
      const loginUrl = new URL("/auth/login", this.gatewayBaseUrl);
      const response = await fetch(loginUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          username: this.gatewayAuthUsername,
          password: this.gatewayAuthPassword,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = payload?.detail || payload?.error || `${response.status} ${response.statusText}`;
        throw new Error(`gateway login failed: ${detail}`);
      }

      const token = asText(payload?.access_token);
      if (!token) {
        throw new Error("gateway login failed: missing access_token");
      }
      this.gatewayAccessToken = token;
      return token;
    })();

    try {
      return await this.gatewayLoginPromise;
    } finally {
      this.gatewayLoginPromise = null;
    }
  }

  async runFileWorkflow(input) {
    const handlers = input?.handlers && typeof input.handlers === "object" ? input.handlers : {};
    const startedAt = nowIso();
    const conversationId = asText(input?.conversationId) || "file-workflow";
    const projectId = asText(input?.projectId);
    const resumeFromStageIndex = Number.isInteger(input?.resumeFromStageIndex) ? input.resumeFromStageIndex : null;
    const resumeSnapshot = input?.resumeSnapshot && typeof input.resumeSnapshot === "object" ? input.resumeSnapshot : null;
    const runtimeRoot = this.getConversationRuntimeRoot(conversationId);

    if (!projectId) {
      return {
        ok: false,
        workflow: {
          mode: "linear",
          status: "failed",
          steps: WORKFLOW_STAGE_KEYS,
        },
        stage_results: [],
        entity_files: [],
        ingest_results: [],
        errors: [{ stage: "request", message: "projectId is required" }],
        runtime_root: runtimeRoot,
      };
    }

    const rawName = sanitizeFileName(input?.fileName);
    const storedName = resumeSnapshot
      ? asText(resumeSnapshot?.input_file?.storedName) || `${Date.now().toString(36)}-${rawName}`
      : `${Date.now().toString(36)}-${rawName}`;
    const uploadsDir = path.join(runtimeRoot, "uploads");
    const filePath = resumeSnapshot
      ? asText(resumeSnapshot?.input_file?.path) || path.join(uploadsDir, storedName)
      : path.join(uploadsDir, storedName);
    const content = Buffer.isBuffer(input?.content)
      ? input.content
      : resumeSnapshot
        ? await readFile(filePath)
        : Buffer.alloc(0);
    const stageKeys = WORKFLOW_STAGE_KEYS;
    const stageResults = Array.isArray(resumeSnapshot?.stage_results)
      ? stageKeys.map((stage, index) => {
        const matched = resumeSnapshot.stage_results.find((item) => item?.stage === stage);
        return {
          ...createStageResult(stage, index),
          ...(matched && typeof matched === "object" ? matched : {}),
          stage,
          order: index + 1,
        };
      })
      : stageKeys.map((stage, index) => createStageResult(stage, index));
    const errors = Array.isArray(resumeSnapshot?.errors) ? [...resumeSnapshot.errors] : [];
    const entityFiles = Array.isArray(resumeSnapshot?.entity_files) ? cloneJsonValue(resumeSnapshot.entity_files, []) : [];
    const ingestResults = Array.isArray(resumeSnapshot?.ingest_results) ? cloneJsonValue(resumeSnapshot.ingest_results, []) : [];

    const state = resumeSnapshot?.state && typeof resumeSnapshot.state === "object"
      ? {
        ...this.buildInitialWorkflowState(projectId),
        ...cloneJsonValue(resumeSnapshot.state, this.buildInitialWorkflowState(projectId)),
        projectId,
      }
      : this.buildInitialWorkflowState(projectId);
    let releaseProjectWorkflowLock = async () => {};

    const persistSnapshot = async () => {
      await this.writeWorkflowSnapshot(conversationId, {
        workflow: {
          mode: "linear",
          status: "running",
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
        state,
        started_at: startedAt,
        updated_at: nowIso(),
      });
    };

    if (resumeFromStageIndex !== null) {
      for (let index = resumeFromStageIndex; index < stageResults.length; index += 1) {
        stageResults[index] = {
          ...createStageResult(stageKeys[index], index),
        };
      }
      errors.splice(0, errors.length, ...errors.filter((item) => {
        const failedIndex = stageKeys.indexOf(asText(item?.stage));
        return failedIndex !== -1 && failedIndex < resumeFromStageIndex;
      }));
      if (resumeFromStageIndex <= 5) {
        entityFiles.splice(0, entityFiles.length);
      }
      if (resumeFromStageIndex <= 7) {
        ingestResults.splice(0, ingestResults.length);
      }
      if (resumeFromStageIndex <= 5) {
        state.ontology = null;
        state.ontologies = [];
      }
      if (resumeFromStageIndex <= 4) {
        state.ablation = [];
        state.ablationCandidates = [];
        state.ablationJudges = [];
      }
      if (resumeFromStageIndex <= 6) {
        state.probabilityPrecheck = null;
      }
      await persistSnapshot();
    }

    const runStage = async (stageIndex, executor) => {
      const stage = stageResults[stageIndex];
      stage.started_at = nowIso();
      stage.status = "running";
      stage.finished_at = null;
      stage.output = null;
      stage.error = null;
      await persistSnapshot();
      handlers.onStageUpdate?.({
        stage: stage.stage,
        order: stage.order,
        status: stage.status,
        started_at: stage.started_at,
        finished_at: stage.finished_at,
        output: stage.output,
        error: stage.error,
      });
      handlers.onStatus?.(`阶段 ${stage.order}/${stageKeys.length}：${stage.stage} 执行中`);
      try {
        const output = await executor();
        validateStageOutputShape(stage.stage, output);
        stage.output = output;
        stage.status = "success";
        stage.finished_at = nowIso();
        await persistSnapshot();
        handlers.onStageUpdate?.({
          stage: stage.stage,
          order: stage.order,
          status: stage.status,
          started_at: stage.started_at,
          finished_at: stage.finished_at,
          output: stage.output,
          error: stage.error,
        });
        handlers.onStatus?.(`阶段 ${stage.order}/${stageKeys.length}：${stage.stage} 完成`);
        return output;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stage.status = "failed";
        if (error && typeof error === "object" && error.stageOutput && typeof error.stageOutput === "object") {
          stage.output = error.stageOutput;
        }
        stage.error = message;
        stage.finished_at = nowIso();
        errors.push({ stage: stage.stage, message });
        await persistSnapshot();
        handlers.onStageUpdate?.({
          stage: stage.stage,
          order: stage.order,
          status: stage.status,
          started_at: stage.started_at,
          finished_at: stage.finished_at,
          output: stage.output,
          error: stage.error,
        });
        handlers.onStatus?.(`阶段 ${stage.order}/${stageKeys.length}：${stage.stage} 失败`);
        throw error;
      }
    };

    try {
      releaseProjectWorkflowLock = await this.acquireProjectWorkflowLock(projectId);
      const checkInterrupted = () => {
        if (input?.signal?.aborted) {
          throw new Error("Workflow interrupted by user");
        }
      };

      if (resumeFromStageIndex === null || resumeFromStageIndex <= 0) {
        await runStage(0, async () => {
          checkInterrupted();
          if (!this.gatewayLoginInvoker) {
            return { authenticated: false, skipped: true };
          }
          await this.gatewayLoginInvoker();
          return { authenticated: true };
        });
      }

      await mkdir(uploadsDir, { recursive: true });
      if (resumeFromStageIndex === null) {
        await writeFile(filePath, content);
      }

      const documentText = state.documentText || decodeDocumentText(content).slice(0, DEFAULT_TEXT_LIMIT);
      if (!documentText) {
        throw new Error("document text is empty or unreadable");
      }
      state.documentText = documentText;
      await persistSnapshot();
      const entityIdState = this.entityIdStateLoader
        ? normalizeEntityIdState(await this.entityIdStateLoader(state.projectId))
        : null;
      const entityIdSeed = entityIdState && entityIdState.sequenceSeed !== null
        ? entityIdState.sequenceSeed
        : Math.max(0, Math.floor(asNumber(await this.entityIdSeedLoader(state.projectId), 0)));
      const entityIdAllocator = createEntityIdAllocator({
        usedEntityIds: entityIdState?.usedEntityIds,
        sequenceSeed: entityIdSeed,
      });

      if (resumeFromStageIndex === null || resumeFromStageIndex <= 1) {
        await runStage(1, async () => {
          ensureStagePrerequisite(Boolean(documentText), "节点1-观察", "文档内容为空或不可读");
          checkInterrupted();
          const llmResult = await this.llmJsonInvoker({
            stage: "节点1-观察",
            instruction: [
              "把文档尽可能完整地拆分为实体数组 entities。",
              "优先抽取所有重要主语、宾语、主题词、对象名、模块名、人物名、系统名、方法名、事件名和关键名词短语；不要只保留少数概括性实体。",
              "同一句里出现多个重要对象时，拆成多个实体，不要合并成一个大实体。",
              "每个实体必须有 name、summary、properties、abilities、citations。",
              "citations 必须是文档中的原文短片段，尽量摘录能直接证明该实体存在或重要性的句子/片段，建议 1 到 3 条。",
              "如果实体有别名、简称或全称，都尽量保留在 properties 里。",
              "不要遗漏明显会参与后续关系抽取的实体；宁可多提取，也不要过度保守。",
            ].join("\n"),
            payload: { document_text: documentText },
          });

          const llmPayload = llmResult?.data ?? llmResult;
          const rawEntities = extractEntityCandidates(llmPayload);
          const entities = rawEntities.map((entity, index) => normalizeEntity(entity, index, entityIdAllocator)).filter((item) => asText(item.name));
          if (entities.length === 0) {
            throw attachStageDebug(new Error("节点1失败：未提取到实体"), {
              llm_raw: llmResult?.llm_raw ?? llmPayload,
              llm_raw_text: asText(llmResult?.llm_raw_text),
              llm_response: llmResult?.llm_response,
              debug_error: "节点1失败：未提取到实体",
            });
          }
          state.entities = entities;
          return {
            entity_count: entities.length,
            entities,
            llm_raw: llmResult?.llm_raw ?? llmPayload,
            llm_raw_text: asText(llmResult?.llm_raw_text),
            llm_response: llmResult?.llm_response,
          };
        });
      }

      if (resumeFromStageIndex === null || resumeFromStageIndex <= 2) {
        await runStage(2, async () => {
          ensureStagePrerequisite(state.entities.length > 0, "节点2-关系", "尚未抽取到实体");
          checkInterrupted();
          const node1Entities = state.entities.map((entity) => ({
            id: entity.id,
            name: entity.name,
            summary: entity.summary,
            citations: entity.citations,
            type: entity.type,
            properties: entity.properties,
          }));
          const llmResult = await this.llmJsonInvoker({
            stage: "节点2-操作",
            instruction: [
              "根据节点1输出的 entities 提取 relations 数组。",
              "你只能使用节点1中的实体作为 source 和 target，禁止凭空新增实体名。",
              "source 与 target 必须与节点1实体 name 精确一致；如果找不到可用实体，就不要生成这条关系。",
              "每条关系必须包含 source、target、relation_type、evidence。",
              "evidence 必须来自文档原文或节点1证据片段，并尽量简短明确。",
              "优先输出能直接表达结构、依赖、组成、归属、作用、完成任务、关联、触发、支撑等关系。",
            ].join("\n"),
            payload: {
              entities: node1Entities,
              entity_names: node1Entities.map((entity) => entity.name),
              document_text: documentText,
            },
          });

          const llmPayload = llmResult?.data ?? llmResult;
          const entityByName = new Map(state.entities.map((entity) => [entity.name, entity]));
          const rawRelations = extractRelationCandidates(llmPayload);
          const relations = rawRelations
            .map((item) => normalizeRelation(item, entityByName))
            .filter(Boolean);
          state.relations = relations;
          return {
            relation_count: relations.length,
            relations,
            llm_raw: llmResult?.llm_raw ?? llmPayload,
            llm_raw_text: asText(llmResult?.llm_raw_text),
            llm_response: llmResult?.llm_response,
          };
        });
      }

      if (resumeFromStageIndex === null || resumeFromStageIndex <= 3) {
        await runStage(3, async () => {
          ensureStagePrerequisite(state.entities.length > 0, "节点3-消融候选", "尚未抽取到实体");
          checkInterrupted();
          const ablationResult = await this.systemAdapter.generateAblationCandidates({
            entities: state.entities.map((entity) => ({
              id: entity.id,
              name: entity.name,
              summary: entity.summary,
              citations: entity.citations.slice(0, 2),
            })),
            relations: state.relations.map((relation) => ({
              source_name: relation.source_name,
              target_name: relation.target_name,
              relation_type: relation.relation_type,
              evidence: relation.evidence,
            })),
          });

          state.ablationCandidates = ablationResult.candidates;
          return {
            candidate_count: ablationResult.candidate_count,
            candidates: ablationResult.candidates,
            llm_raw: ablationResult.llm_raw,
            llm_raw_text: ablationResult.llm_raw_text,
            llm_response: ablationResult.llm_response,
          };
        });
      }

      if (resumeFromStageIndex === null || resumeFromStageIndex <= 4) {
        await runStage(4, async () => {
          ensureStagePrerequisite(state.entities.length > 0, "节点4-小故命中", "尚未抽取到实体");
          checkInterrupted();
          const entityById = new Map(state.entities.map((entity) => [entity.id, entity]));
          const entityByName = new Map(state.entities.map((entity) => [entity.name, entity]));
          const candidateMap = new Map(state.ablationCandidates.map((item) => [item.entity_id, item]));
          const ablationJudges = [];
          const judgeDebug = [];

          for (const candidate of state.ablationCandidates) {
            const entity = entityById.get(candidate.entity_id);
            if (!entity) continue;

            // 检查中断信号
            if (input?.signal?.aborted) {
              throw new Error("Workflow interrupted by user");
            }


            const focusEntity = {
              entity_id: entity.id,
              entity_name: entity.name,
              summary: entity.summary,
              abilities: entity.abilities,
              citations: entity.citations.slice(0, 2),
              keep_role: candidate.keep_role,
              remove_impact: candidate.remove_impact,
              observation: candidate.observation,
              evidence: candidate.evidence,
            };
            const relatedRelations = state.relations
              .filter((relation) => relation.source_entity_id === entity.id || relation.target_entity_id === entity.id)
              .map((relation) => ({
                source_name: relation.source_name,
                target_name: relation.target_name,
                relation_type: relation.relation_type,
                evidence: relation.evidence,
              }));
            const remainingEntities = state.entities
              .filter((item) => item.id !== entity.id)
              .map((item) => ({
                id: item.id,
                name: item.name,
                summary: item.summary,
                citations: item.citations.slice(0, 2),
              }));
            const remainingRelations = state.relations
              .filter((relation) => relation.source_entity_id !== entity.id && relation.target_entity_id !== entity.id)
              .map((relation) => ({
                source_name: relation.source_name,
                target_name: relation.target_name,
                relation_type: relation.relation_type,
                evidence: relation.evidence,
              }));

            try {
              const judgeResult = await this.systemAdapter.judgeAblationCandidate({
                entity,
                candidate,
                entities: state.entities,
                relations: state.relations,
              });
              const judge = buildAblationJudgeFromProbabilities(entity, judgeResult.keepDecision, judgeResult.removeDecision);
              const merged = mergeAblationResult(candidate, judge);
              ablationJudges.push(merged);
              judgeDebug.push({
                entity_id: entity.id,
                computed_judge: judge,
              });
            } catch (error) {
              throw attachStageDebug(error, {
                llm_raw: {
                  candidate: candidate,
                  keep_result: error?.stageOutput?.llm_raw?.keep_result,
                  remove_result: error?.stageOutput?.llm_raw?.remove_result,
                },
              });
            }
          }

          const judgeMap = new Map(ablationJudges.map((item) => [item.entity_id, item]));
          const ablation = state.entities
            .map((entity) => {
              const candidate = candidateMap.get(entity.id)
                || normalizeAblationCandidate({ entity_id: entity.id }, entityById, entityByName);
              const judge = judgeMap.get(entity.id) || null;
              return mergeAblationResult(candidate, judge);
            })
            .filter((item) => item.entity_id && item.entity_name && item.impact_reason);
          state.ablationJudges = ablationJudges;
          state.ablation = ablation;
          return {
            ablation_count: ablationJudges.length, // 使用完整的判定数作为总计
            ablation,
            ablation_candidates: state.ablationCandidates,
            ablation_judges: ablationJudges,
            llm_raw: {
              judge_results: judgeDebug,
            },
          };
        });
      }

      if (resumeFromStageIndex === null || resumeFromStageIndex <= 5) {
        await runStage(5, async () => {
          ensureStagePrerequisite(state.entities.length > 0, "节点5-本体", "尚未抽取到实体");
          checkInterrupted();
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

          const usedNames = new Set();
          const entityOntologies = state.entities.map((entity) => {
            const relatedRelations = state.relations.filter((relation) => (
              relation.source_entity_id === entity.id || relation.target_entity_id === entity.id
            ));
            const relatedAblation = state.ablation.find((item) => item.entity_id === entity.id) || null;
            const filename = makeEntityFilename(entity.name, usedNames);
            const entityOntology = {
              workflow_version: "v1-linear-file-workflow",
              generated_at: nowIso(),
              project_id: state.projectId,
              scope: "entity",
              entity_id: entity.id,
              entity_name: entity.name,
              system_summary: ontology.system_summary,
              entity,
              relations: relatedRelations,
              ablation: relatedAblation ? [relatedAblation] : [],
            };
            return {
              entity_id: entity.id,
              entity_name: entity.name,
              filename,
              ontology: entityOntology,
              precheck: null,
            };
          });

          entityFiles.splice(0, entityFiles.length, ...entityOntologies.map((item) => ({
            entity_id: item.entity_id,
            entity_name: item.entity_name,
            filename: item.filename,
            data: {
              source: "linear-workflow",
              ontology: item.ontology,
              entity: item.ontology.entity,
              relations: item.ontology.relations,
              ablation: item.ontology.ablation[0] || null,
              precheck: null,
              ontology_summary: item.ontology.system_summary || {},
            },
          })));

          state.ontology = ontology;
          state.ontologies = entityOntologies;
          return {
            ontology,
            ontology_count: entityOntologies.length,
            ontologies: entityOntologies.map((item) => ({
              entity_id: item.entity_id,
              entity_name: item.entity_name,
              filename: item.filename,
              ontology: item.ontology,
            })),
          };
        });
      }

      if (resumeFromStageIndex === null || resumeFromStageIndex <= 6) {
        await runStage(6, async () => {
          ensureStagePrerequisite(state.ontologies.length > 0, "节点6-概率预判", "尚未生成本体文件");
          checkInterrupted();
          const prechecks = [];
          for (const item of state.ontologies) {
            const precheck = await this.probabilityInvoker(item.ontology);
            const normalized = {
              entity_id: item.entity_id,
              entity_name: item.entity_name,
              precheck_probability: asText(precheck?.probability),
              precheck_reason: asText(precheck?.reason),
              raw: precheck,
            };
            prechecks.push(normalized);
            item.precheck = normalized;
          }

          state.probabilityPrecheck = prechecks;
          for (const fileItem of entityFiles) {
            const matched = prechecks.find((item) => item.entity_id === fileItem.entity_id);
            if (matched) {
              fileItem.data.precheck = matched;
            }
          }

          return {
            precheck_count: prechecks.length,
            prechecks,
          };
        });
      }

      if (resumeFromStageIndex === null || resumeFromStageIndex <= 7) {
        await runStage(7, async () => {
          ensureStagePrerequisite(entityFiles.length > 0, "节点7-入库", "尚未生成实体文件");
          checkInterrupted();
          const baseVersionMap = await this.baseVersionLoader(state.projectId);
          ingestResults.splice(0, ingestResults.length);
          for (const item of entityFiles) {
            const entityFilePayload = item.data;
            const validation = validateWorkflowEntityFileData(entityFilePayload);
            if (!validation.ok) {
              throw new Error(`节点6失败：实体文件格式校验失败：${validation.error}`);
            }

            const basevision = Number(baseVersionMap.get(item.filename) || 0);
            const ingestPayload = {
              project_id: state.projectId,
              filename: item.filename,
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
                entity_id: item.entity_id,
                entity_name: item.entity_name,
                filename: item.filename,
                status: asText(result?.status) || "success",
                commit_id: asText(result?.write_result?.commit_id) || "",
                version_id: result?.write_result?.version_id ?? null,
                raw: result,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              ingestResults.push({
                entity_id: item.entity_id,
                entity_name: item.entity_name,
                filename: item.filename,
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
      }
    } catch {
      await releaseProjectWorkflowLock().catch(() => null);
      const failedResult = {
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
      await this.writeWorkflowSnapshot(conversationId, {
        ...failedResult,
        state,
        updated_at: nowIso(),
      });
      handlers.onError?.(failedResult);
      return failedResult;
    }

    await releaseProjectWorkflowLock().catch(() => null);
    const successResult = {
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
    await this.writeWorkflowSnapshot(conversationId, {
      ...successResult,
      state,
      updated_at: nowIso(),
    });
    handlers.onCompleted?.(successResult);
    return successResult;
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
