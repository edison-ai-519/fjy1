import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { validateWorkflowEntityFileData } from "../workflowEntityFormat.mjs";
import { LinearWorkflowService } from "./linearWorkflowService.mjs";
import { WORKFLOW_V2_STAGE_KEYS } from "../../src/shared/workflowV2Stages.js";

const WORKFLOW_V2_SNAPSHOT_FILE = "latest-v2-run.json";
const DEFAULT_CHUNK_MAX_CHARS = 600;
const DEFAULT_CHUNK_MIN_CHARS = 80;
const DEFAULT_WINDOW_SIZE = 5;
const DEFAULT_WINDOW_STEP = 2;
const DEFAULT_PARALLEL_WINDOWS = 4;
const DEFAULT_WORKFLOW_LLM_TIMEOUT_MS = 0;
const DEFAULT_WORKFLOW_LLM_TEMPERATURE = 0.5;
const DEFAULT_ABLATION_PARENT_CONCURRENCY = 2;
const DEFAULT_ABLATION_CHILD_CONCURRENCY = 1;
const WORKFLOW_V2_SOURCE = "linear-workflow-v2";
const WORKFLOW_V2_VERSION = "v2-linear-object-workflow";
const WORKFLOW_V2_FILE_MESSAGE = "Workflow V2 ingest";

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value, fallback, minimum = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minimum, parsed);
}

function asInteger(value, fallback, minimum = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minimum, Math.floor(parsed));
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

function looksLikeHtmlDocument(value) {
  const text = asText(value);
  return /^<!doctype html/i.test(text) || /^<html[\s>]/i.test(text) || /^<body[\s>]/i.test(text);
}

function buildNonJsonResponseErrorMessage(scope, baseUrl, rawText) {
  const normalizedBaseUrl = asText(baseUrl);
  if (looksLikeHtmlDocument(rawText)) {
    return `${scope} endpoint returned HTML instead of JSON. 请检查 WORKFLOW_LLM_BASE_URL / DMXAPI_BASE_URL 是否配置成 OpenAI 兼容接口根路径（通常应以 /v1 结尾），当前为 ${normalizedBaseUrl || "未配置"}`;
  }
  return `${scope} endpoint returned non-JSON response. 请检查 WORKFLOW_LLM_BASE_URL / DMXAPI_BASE_URL 与上游服务兼容性，当前为 ${normalizedBaseUrl || "未配置"}`;
}

function normalizeWhitespace(value) {
  return asText(value).replace(/\s+/g, " ");
}

function normalizeObjectName(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/^[\s"'`“”‘’()[\]{}<>,.:;!?，。；：！？、]+|[\s"'`“”‘’()[\]{}<>,.:;!?，。；：！？、]+$/g, "");
}

const OBJECT_LEVEL_VALUES = new Set([
  "component",
  "function_unit",
  "subsystem",
  "system",
]);
const OBJECT_LEVEL_RANK = new Map([
  ["component", 0],
  ["function_unit", 1],
  ["subsystem", 2],
  ["system", 3],
]);

function normalizeObjectLevel(value) {
  const text = String(value ?? "").trim().toLowerCase();

  if (OBJECT_LEVEL_VALUES.has(text)) {
    return text;
  }

  const aliasMap = {
    sub_system: "subsystem",
    subsystem_level: "subsystem",
    module: "function_unit",
    function: "function_unit",
    function_module: "function_unit",
    unit: "function_unit",
    part: "component",
    element: "component",
    device: "component",
    entity: "component",
    object: "component",
  };

  return aliasMap[text] ?? "component";
}

function getWorkflowV2ObjectLevelRank(value) {
  return OBJECT_LEVEL_RANK.get(normalizeObjectLevel(value)) ?? -1;
}

function isAllowedContainsEdge(sourceObject, targetObject) {
  const sourceRank = getWorkflowV2ObjectLevelRank(sourceObject?.object_level);
  const targetRank = getWorkflowV2ObjectLevelRank(targetObject?.object_level);
  return sourceRank >= 0 && targetRank >= 0 && sourceRank === targetRank + 1;
}

function buildWorkflowV2NameLookup(objects) {
  const lookup = new Map();
  for (const object of Array.isArray(objects) ? objects : []) {
    const objectId = asText(object?.object_id);
    if (!objectId) {
      continue;
    }
    const candidates = uniqueStrings([
      object?.object_name,
      object?.normalized_name,
      ...(Array.isArray(object?.aliases) ? object.aliases : []),
    ]);
    for (const candidate of candidates) {
      lookup.set(normalizeObjectName(candidate), objectId);
    }
  }
  return lookup;
}

function filterWorkflowV2DecompositionResults(objects, decompositionResults) {
  const safeObjects = Array.isArray(objects) ? objects : [];
  const safeResults = Array.isArray(decompositionResults) ? decompositionResults : [];
  const objectById = new Map();
  const objectByName = new Map();
  const objectNameLookup = buildWorkflowV2NameLookup(safeObjects);

  for (const object of safeObjects) {
    const objectId = asText(object?.object_id);
    if (!objectId) {
      continue;
    }
    objectById.set(objectId, object);
    const names = uniqueStrings([
      object?.object_name,
      object?.normalized_name,
      ...(Array.isArray(object?.aliases) ? object.aliases : []),
    ]);
    for (const candidate of names) {
      objectByName.set(normalizeObjectName(candidate), object);
    }
  }

  const filteredResults = [];
  const skippedEdges = [];

  for (const item of safeResults) {
    const sourceObject = objectById.get(asText(item?.object_id))
      || objectByName.get(normalizeObjectName(item?.object_name));
    const validDecompositions = [];
    const itemSkippedEdges = [];

    for (const decomposition of Array.isArray(item?.decompositions) ? item.decompositions : []) {
      const sourceObjectId = asText(decomposition?.source_object_id)
        || asText(decomposition?.source)
        || asText(decomposition?.from)
        || asText(item?.object_id)
        || objectNameLookup.get(normalizeObjectName(decomposition?.parent_object_name))
        || objectNameLookup.get(normalizeObjectName(item?.object_name));
      const targetObjectId = asText(decomposition?.target_object_id)
        || asText(decomposition?.target)
        || asText(decomposition?.to)
        || objectNameLookup.get(normalizeObjectName(decomposition?.child_object_name));
      const resolvedSourceObject = objectById.get(sourceObjectId) || sourceObject;
      const resolvedTargetObject = objectById.get(targetObjectId) || objectByName.get(normalizeObjectName(decomposition?.child_object_name));
      if (isAllowedContainsEdge(resolvedSourceObject, resolvedTargetObject)) {
        validDecompositions.push({
          ...decomposition,
          source_object_id: sourceObjectId,
          target_object_id: targetObjectId,
          source_object_level: normalizeObjectLevel(resolvedSourceObject?.object_level),
          target_object_level: normalizeObjectLevel(resolvedTargetObject?.object_level),
          relation: "contains",
          relation_type: "contains",
        });
        continue;
      }

      itemSkippedEdges.push({
        ...decomposition,
        source_object_id: sourceObjectId,
        target_object_id: targetObjectId,
        source_object_level: normalizeObjectLevel(resolvedSourceObject?.object_level),
        target_object_level: normalizeObjectLevel(resolvedTargetObject?.object_level),
        relation: "contains",
        relation_type: "contains",
        status: "pending",
        reason: "object_level 不满足相邻层级 contains 约束",
      });
    }

    filteredResults.push({
      ...item,
      object_name: asText(item?.object_name) || asText(sourceObject?.object_name),
      decompositions: validDecompositions,
      reason: asText(item?.reason),
      llm_ensemble: item?.llm_ensemble ?? null,
      failed_object: item?.failed_object ?? null,
    });
    skippedEdges.push(...itemSkippedEdges);
  }

  return {
    decomposition_results: filteredResults,
    valid_decomposition_edge_count: filteredResults.reduce(
      (sum, item) => sum + (Array.isArray(item.decompositions) ? item.decompositions.length : 0),
      0,
    ),
    skipped_decomposition_edge_count: skippedEdges.length,
    pending_decomposition_edge_count: skippedEdges.length,
    skipped_decomposition_edges: skippedEdges,
  };
}

function buildSlug(value, fallback = "item") {
  const normalized = asText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || fallback;
}

function clampConfidence(value, fallback = 0.5) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, parsed));
}

function getErrorMessage(error, fallback = "unknown error") {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function getErrorCodeValue(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function getErrorHttpStatusFromMessage(message) {
  const match = asText(message).match(/request failed:\s*(\d{3})\b/);
  return match?.[1] || "";
}

function getErrorDiagnostics(error) {
  const diagnostics = {};
  if (!error || typeof error !== "object") {
    return diagnostics;
  }

  const errorName = asText(error.name);
  const errorCode = getErrorCodeValue(error.code);
  const errorHttpStatus = getErrorCodeValue(error.status) || getErrorHttpStatusFromMessage(getErrorMessage(error, ""));
  const cause = error.cause && typeof error.cause === "object" ? error.cause : null;
  const causeName = asText(cause?.name);
  const causeCode = getErrorCodeValue(cause?.code);

  if (errorName) {
    diagnostics.error_name = errorName;
  }
  if (errorCode) {
    diagnostics.error_code = errorCode;
  }
  if (errorHttpStatus) {
    diagnostics.error_http_status = errorHttpStatus;
  }
  if (causeName) {
    diagnostics.error_cause_name = causeName;
  }
  if (causeCode) {
    diagnostics.error_cause_code = causeCode;
  }

  return diagnostics;
}

function getErrorRawText(error) {
  if (error && typeof error === "object" && typeof error.llm_raw_text === "string") {
    return error.llm_raw_text;
  }
  if (
    error
    && typeof error === "object"
    && error.stageOutput
    && typeof error.stageOutput === "object"
    && typeof error.stageOutput.llm_raw_text === "string"
  ) {
    return error.stageOutput.llm_raw_text;
  }
  return "";
}

function averageConfidence(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0.5;
  }
  const normalized = values.map((item) => clampConfidence(item, 0.5));
  return Number((normalized.reduce((sum, item) => sum + item, 0) / normalized.length).toFixed(4));
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((item) => asText(item)).filter(Boolean))];
}

function buildWorkflowV2ChunkTextMap(chunks) {
  const chunkMap = new Map();
  for (const chunk of Array.isArray(chunks) ? chunks : []) {
    const chunkId = asText(chunk?.chunk_id);
    if (!chunkId) {
      continue;
    }
    chunkMap.set(chunkId, asText(chunk?.text));
  }
  return chunkMap;
}

function materializeWorkflowV2CitationTexts(chunkMap, chunkIds, fallbackTexts = []) {
  const resolved = uniqueStrings(chunkIds)
    .map((chunkId) => asText(chunkMap?.get?.(chunkId)))
    .filter(Boolean);
  if (resolved.length > 0) {
    return resolved;
  }
  return uniqueStrings(fallbackTexts);
}

function cloneJsonValue(value, fallback = null) {
  if (value === undefined) {
    return fallback;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function stableJsonStringify(value) {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = asRecord(value);
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildWorkflowV2OutputExampleText(example) {
  return [
    "你必须严格参考下面这个合法 JSON 输出样例，字段名必须完全一致，你只能替换其中的值，不能改字段名、不能改层级、不能省略必填字段：",
    JSON.stringify(example, null, 2),
  ].join("\n");
}

function validateWorkflowV2ValueAgainstSchema(value, schema, path = "root") {
  const schemaRecord = asRecord(schema);
  const expectedType = asText(schemaRecord.type);
  if (!expectedType) {
    return "";
  }

  if (expectedType === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return `${path} 必须是对象`;
    }
    const record = asRecord(value);
    const properties = asRecord(schemaRecord.properties);
    const required = Array.isArray(schemaRecord.required) ? schemaRecord.required.map((item) => asText(item)).filter(Boolean) : [];
    for (const key of required) {
      if (!(key in record)) {
        return `${path}.${key} 缺失`;
      }
    }
    if (schemaRecord.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(key in properties)) {
          return `${path}.${key} 不允许出现`;
        }
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (!(key in record)) {
        continue;
      }
      const error = validateWorkflowV2ValueAgainstSchema(record[key], childSchema, `${path}.${key}`);
      if (error) {
        return error;
      }
    }
    return "";
  }

  if (expectedType === "array") {
    if (!Array.isArray(value)) {
      return `${path} 必须是数组`;
    }
    const itemSchema = schemaRecord.items;
    if (itemSchema) {
      for (let index = 0; index < value.length; index += 1) {
        const error = validateWorkflowV2ValueAgainstSchema(value[index], itemSchema, `${path}[${index}]`);
        if (error) {
          return error;
        }
      }
    }
    return "";
  }

  if (expectedType === "string") {
    if (typeof value !== "string") {
      return `${path} 必须是字符串`;
    }
    if (Array.isArray(schemaRecord.enum) && !schemaRecord.enum.includes(value)) {
      return `${path} 必须是枚举值之一`;
    }
    return "";
  }

  if (expectedType === "number") {
    if (!(typeof value === "number" && Number.isFinite(value))) {
      return `${path} 必须是数字`;
    }
    if (Array.isArray(schemaRecord.enum) && !schemaRecord.enum.includes(value)) {
      return `${path} 必须是枚举值之一`;
    }
    return "";
  }

  if (expectedType === "boolean") {
    if (typeof value !== "boolean") {
      return `${path} 必须是布尔值`;
    }
    if (Array.isArray(schemaRecord.enum) && !schemaRecord.enum.includes(value)) {
      return `${path} 必须是枚举值之一`;
    }
    return "";
  }

  return "";
}

function validateWorkflowV2StructuredPayload(data, responseSchema) {
  const schema = responseSchema && typeof responseSchema === "object" ? responseSchema.schema : null;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return "";
  }
  return validateWorkflowV2ValueAgainstSchema(data, schema, "root");
}

function buildWorkflowV2StructuredPayloadError(result, responseSchema, validationError) {
  const schemaName = asText(responseSchema?.name) || "unknown_schema";
  const normalizedResult = normalizeWorkflowV2InvokerResult(result);
  const rawText = normalizedResult.llm_raw_text || stableJsonStringify(normalizedResult.data);
  return attachV2StageDebug(
    new Error(`workflow V2 LLM returned schema-mismatched JSON (${schemaName}): ${validationError}`),
    {
      llm_raw_text: rawText,
      llm_response: normalizedResult.llm_response ?? null,
      debug_error: `workflow V2 LLM returned schema-mismatched JSON (${schemaName})`,
    },
  );
}

function isWorkflowV2RetriableStructureError(message) {
  const text = asText(message);
  return text.includes("workflow V2 LLM returned invalid JSON")
    || text.includes("workflow V2 LLM returned schema-mismatched JSON");
}

function createV2StageDebugOutput(debug = {}) {
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
  if (debug.llm_ensemble !== undefined) {
    output.llm_ensemble = debug.llm_ensemble;
  }
  if (typeof debug.debug_error === "string" && debug.debug_error.trim()) {
    output.debug_error = debug.debug_error;
  }
  if (typeof debug.error_name === "string" && debug.error_name.trim()) {
    output.error_name = debug.error_name;
  }
  if (typeof debug.error_code === "string" && debug.error_code.trim()) {
    output.error_code = debug.error_code;
  }
  if (typeof debug.error_http_status === "string" && debug.error_http_status.trim()) {
    output.error_http_status = debug.error_http_status;
  }
  if (typeof debug.error_cause_name === "string" && debug.error_cause_name.trim()) {
    output.error_cause_name = debug.error_cause_name;
  }
  if (typeof debug.error_cause_code === "string" && debug.error_cause_code.trim()) {
    output.error_cause_code = debug.error_cause_code;
  }
  return output;
}

function attachV2StageDebug(error, debug = {}) {
  const baseError = error instanceof Error ? error : new Error(String(error));
  const stageOutput = createV2StageDebugOutput(debug);
  if (Object.keys(stageOutput).length > 0) {
    baseError.stageOutput = {
      ...(baseError.stageOutput && typeof baseError.stageOutput === "object" ? baseError.stageOutput : {}),
      ...stageOutput,
    };
  }
  return baseError;
}

function mergeFailedStageOutput(previousOutput, error) {
  const baseOutput = previousOutput && typeof previousOutput === "object" && !Array.isArray(previousOutput)
    ? cloneJsonValue(previousOutput, {})
    : {};
  const debugOutput = error && typeof error === "object" && error.stageOutput && typeof error.stageOutput === "object"
    ? cloneJsonValue(error.stageOutput, {})
    : {};
  const merged = {
    ...baseOutput,
    ...debugOutput,
  };
  return Object.keys(merged).length > 0 ? merged : null;
}

function createWorkflowV2AbortError(message = "workflow V2 已被用户终止") {
  const error = new Error(asText(message) || "workflow V2 已被用户终止");
  error.name = "AbortError";
  return error;
}

function getWorkflowV2AbortReason(signal, fallbackMessage = "workflow V2 已被用户终止") {
  if (!signal) {
    return createWorkflowV2AbortError(fallbackMessage);
  }
  const reason = signal.reason;
  if (reason instanceof Error) {
    return reason;
  }
  if (typeof reason === "string" && reason.trim()) {
    return createWorkflowV2AbortError(reason);
  }
  return createWorkflowV2AbortError(fallbackMessage);
}

function throwIfWorkflowV2Aborted(signal, fallbackMessage = "workflow V2 已被用户终止") {
  if (signal?.aborted) {
    throw getWorkflowV2AbortReason(signal, fallbackMessage);
  }
}

function createCombinedAbortSignal(signals) {
  const activeSignals = (Array.isArray(signals) ? signals : []).filter((signal) => signal && typeof signal.aborted === "boolean");
  if (activeSignals.length === 0) {
    return {
      signal: undefined,
      cleanup() {},
    };
  }
  if (activeSignals.length === 1) {
    return {
      signal: activeSignals[0],
      cleanup() {},
    };
  }

  const controller = new AbortController();
  const listeners = [];
  const abortFromSignal = (signal) => {
    if (!controller.signal.aborted) {
      controller.abort(getWorkflowV2AbortReason(signal));
    }
  };

  for (const signal of activeSignals) {
    if (signal.aborted) {
      abortFromSignal(signal);
      break;
    }
    const listener = () => abortFromSignal(signal);
    signal.addEventListener("abort", listener, { once: true });
    listeners.push({ signal, listener });
  }

  return {
    signal: controller.signal,
    cleanup() {
      for (const item of listeners) {
        item.signal.removeEventListener("abort", item.listener);
      }
    },
  };
}

function compactV2EnsembleEntry(result, extra = {}) {
  if (!result || typeof result !== "object") {
    return {
      ...extra,
      data: null,
      raw_text: "",
    };
  }
  return {
    ...extra,
    data: result.data ?? result.llm_raw ?? null,
    raw_text: asText(result.llm_raw_text),
  };
}

function normalizeWorkflowV2InvokerResult(result) {
  return {
    llm_raw: result?.llm_raw ?? result?.data ?? result,
    llm_raw_text: asText(result?.llm_raw_text),
    llm_response: result?.llm_response,
    data: result?.data ?? result?.llm_raw ?? result,
  };
}

function joinSymmetricText(left, right) {
  const values = [asText(left), asText(right)].filter(Boolean);
  return uniqueStrings(values).join("\n");
}

function mergeWorkflowV2SharedValue(left, right, fieldName = "") {
  if (left === undefined) {
    return cloneJsonValue(right, null);
  }
  if (right === undefined) {
    return cloneJsonValue(left, null);
  }
  if (stableJsonStringify(left) === stableJsonStringify(right)) {
    return cloneJsonValue(left, null);
  }

  if (typeof left === "string" || typeof right === "string") {
    return joinSymmetricText(left, right);
  }

  if (fieldName === "confidence" && Number.isFinite(Number(left)) && Number.isFinite(Number(right))) {
    return averageConfidence([left, right]);
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.every((item) => typeof item === "string") && right.every((item) => typeof item === "string")) {
      return uniqueStrings([...left, ...right]);
    }
    return cloneJsonValue([...left, ...right], []);
  }

  const leftRecord = asRecord(left);
  const rightRecord = asRecord(right);
  if (Object.keys(leftRecord).length > 0 || Object.keys(rightRecord).length > 0) {
    const merged = {};
    for (const key of uniqueStrings([...Object.keys(leftRecord), ...Object.keys(rightRecord)])) {
      merged[key] = mergeWorkflowV2SharedValue(leftRecord[key], rightRecord[key], key);
    }
    return merged;
  }

  if (Number.isFinite(Number(left)) && Number.isFinite(Number(right))) {
    return averageConfidence([left, right]);
  }

  return cloneJsonValue([left, right], []);
}

function buildResponseFormat(responseSchema, mode = "json_schema") {
  if (mode === "none") {
    return null;
  }
  if (mode === "json_object") {
    return {
      type: "json_object",
    };
  }
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

function extractFirstJsonValueText(text) {
  const input = asText(text);
  if (!input) {
    return "";
  }

  const fenced = input.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = (() => {
    const objectIndex = input.indexOf("{");
    const arrayIndex = input.indexOf("[");
    if (objectIndex === -1) return arrayIndex;
    if (arrayIndex === -1) return objectIndex;
    return Math.min(objectIndex, arrayIndex);
  })();
  if (start === -1) {
    return "";
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  let opening = "";
  let closing = "";

  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (!opening) {
      if (char === "{") {
        opening = "{";
        closing = "}";
        depth = 1;
      } else if (char === "[") {
        opening = "[";
        closing = "]";
        depth = 1;
      } else {
        continue;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === opening) {
      depth += 1;
    } else if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        return input.slice(start, index + 1).trim();
      }
    }
  }

  return "";
}

export function parseWorkflowV2JsonResponseText(text) {
  const direct = safeJsonParse(text);
  if (direct) {
    return direct;
  }
  const candidate = extractFirstJsonValueText(text);
  if (!candidate) {
    return null;
  }
  return safeJsonParse(candidate);
}

function splitLongParagraph(paragraph, maxChars, paragraphIndex) {
  const parts = [];
  const sentences = paragraph.text.match(/[^。！？；;\n]+[。！？；;]?\s*/g) ?? [paragraph.text];
  let cursor = paragraph.start_offset;
  let sentenceIndex = 0;

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) {
      cursor += sentence.length;
      continue;
    }
    parts.push({
      text: trimmed,
      start_offset: cursor + sentence.indexOf(trimmed),
      end_offset: cursor + sentence.indexOf(trimmed) + trimmed.length,
      paragraph_index: paragraphIndex,
      sentence_index: sentenceIndex,
    });
    cursor += sentence.length;
    sentenceIndex += 1;
  }

  const chunks = [];
  let current = null;
  for (const part of parts) {
    if (!current) {
      current = { ...part };
      continue;
    }
    if ((current.text.length + 1 + part.text.length) <= maxChars) {
      current = {
        ...current,
        text: `${current.text} ${part.text}`.trim(),
        end_offset: part.end_offset,
      };
      continue;
    }
    chunks.push(current);
    current = { ...part };
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function isWeakStandaloneParagraph(text, chunkMinChars = DEFAULT_CHUNK_MIN_CHARS) {
  const normalized = asText(text);
  if (!normalized) {
    return false;
  }
  const compact = normalized.replace(/\s+/g, "");
  const shortThreshold = Math.min(24, Math.max(8, Math.floor(chunkMinChars / 2)));
  if (compact.length > shortThreshold) {
    return false;
  }
  if (/[。！？.!?；;]/.test(compact)) {
    return false;
  }
  if (/[:：]$/.test(compact)) {
    return true;
  }
  if (/^[第\d一二三四五六七八九十百千万0-9]+[章节部分篇节条项]/.test(compact)) {
    return true;
  }
  if (/^(导语|摘要|简介|概述|背景|定义|功能|用途|结构|组成|流程|步骤|案例|讨论|热门讨论|常见问题|FAQ|问答|总结|结论|引言|说明|备注|附录|参考资料)$/.test(compact)) {
    return true;
  }
  return compact.length <= 8 && !/[，,、]/.test(compact);
}

function mergePreChunkItems(left, right, sourceType) {
  const separator = left.paragraph_index === right.paragraph_index ? " " : "\n\n";
  return {
    ...right,
    text: `${left.text}${separator}${right.text}`.trim(),
    start_offset: Math.min(left.start_offset, right.start_offset),
    end_offset: Math.max(left.end_offset, right.end_offset),
    paragraph_index: Math.min(left.paragraph_index, right.paragraph_index),
    source_type: sourceType,
  };
}

function buildChunkReason(sourceType, chunkText) {
  if (sourceType === "paragraph") {
    return "该 chunk 由完整自然段直接生成，语义自洽且便于后续引用。";
  }
  if (sourceType === "heading-merged") {
    return "该 chunk 由弱语义短标题与后续正文合并生成，用于避免栏目名或小标题单独成块。";
  }
  if (sourceType === "neighbor-merged") {
    return "该 chunk 因长度低于最小阈值，与相邻自然段合并生成，以提升后续抽取稳定性。";
  }
  if (sourceType === "short-merged") {
    return "该 chunk 由过短片段归并生成，用于避免引用信息过短导致抽取不稳定。";
  }
  if (chunkText.length < DEFAULT_CHUNK_MIN_CHARS) {
    return "该 chunk 由相邻短句归并生成，用于避免引用信息过短导致抽取不稳定。";
  }
  return "该 chunk 由超长自然段按句界细分生成，便于保持局部语义完整并控制窗口大小。";
}

function buildWindowReason(chunkIds) {
  return `该窗口覆盖 ${chunkIds.length} 个连续 chunk，用于保留局部上下文并支持并行对象抽取。`;
}

function makeStageResult(stage, order, status, output = null, error = null, previous = null) {
  const startedAt = status === "running"
    ? new Date().toISOString()
    : previous?.started_at ?? null;
  const finishedAt = status === "success" || status === "failed"
    ? new Date().toISOString()
    : null;
  return {
    stage,
    order,
    status,
    started_at: startedAt,
    finished_at: finishedAt,
    output,
    error,
  };
}

function createV2ResponseEnvelope({ ok, stageResults, errors, runtimeRoot, inputFile, result, startedAt, finishedAt }) {
  return {
    ok,
    workflow: {
      mode: "analysis-v2",
      status: ok ? "success" : "failed",
      steps: [...WORKFLOW_V2_STAGE_KEYS],
    },
    input_file: inputFile,
    stage_results: stageResults,
    errors,
    runtime_root: runtimeRoot,
    result,
    started_at: startedAt,
    finished_at: finishedAt,
  };
}

function deriveWorkflowV2SnapshotStatus(stageResults) {
  const items = Array.isArray(stageResults) ? stageResults : [];
  if (items.some((item) => asText(item?.status) === "failed")) {
    return "failed";
  }
  if (items.some((item) => asText(item?.status) === "running")) {
    return "running";
  }
  const startedCount = items.filter((item) => ["success", "failed"].includes(asText(item?.status))).length;
  if (startedCount === 0) {
    return "idle";
  }
  if (items.every((item) => asText(item?.status) === "success")) {
    return "success";
  }
  return "running";
}

function deriveWorkflowV2Errors(stageResults) {
  return (Array.isArray(stageResults) ? stageResults : [])
    .filter((item) => asText(item?.status) === "failed" && asText(item?.error))
    .map((item) => ({
      stage: asText(item?.stage) || "unknown",
      message: asText(item?.error),
    }));
}

function deriveWorkflowV2StartedAt(stageResults) {
  return (Array.isArray(stageResults) ? stageResults : [])
    .map((item) => asText(item?.started_at))
    .filter(Boolean)[0] || undefined;
}

function deriveWorkflowV2FinishedAt(stageResults, workflowStatus) {
  if (!["success", "failed"].includes(workflowStatus)) {
    return undefined;
  }
  const finishedAtValues = (Array.isArray(stageResults) ? stageResults : [])
    .map((item) => asText(item?.finished_at))
    .filter(Boolean)
    .sort();
  return finishedAtValues.at(-1) || undefined;
}

function emptyWorkflowV2Result(document = null) {
  return {
    document,
    chunks: [],
    windows: [],
    objects: [],
    edges: [],
    ablation: [],
    meta: {
      total_chunks: 0,
      total_selected_chunks: 0,
      total_windows: 0,
      total_objects: 0,
      total_edges: 0,
      total_isolated_objects: 0,
      total_removed_cycle_edges: 0,
      is_dag: true,
      system_scope_focus: "",
      system_scope_candidates: [],
      document_abstraction_level: "",
      structure_quality_score: 0,
      structure_is_sound: false,
      structure_orphan_count: 0,
      structure_root_count: 0,
      structure_max_depth: 0,
      structure_too_flat_warning: "",
      structure_mixed_granularity_warning: "",
    },
  };
}

function isStructuredObjectIsolated(object, connectedNodeIds) {
  const objectId = asText(object?.object_id);
  return Boolean(objectId) && !connectedNodeIds.has(objectId);
}

function annotateStructuredObjects(objects, edges) {
  const connectedNodeIds = new Set();
  for (const edge of Array.isArray(edges) ? edges : []) {
    const sourceId = asText(edge?.source_object_id);
    const targetId = asText(edge?.target_object_id);
    if (sourceId) {
      connectedNodeIds.add(sourceId);
    }
    if (targetId) {
      connectedNodeIds.add(targetId);
    }
  }

  return (Array.isArray(objects) ? objects : []).map((object) => {
    const isolated = isStructuredObjectIsolated(object, connectedNodeIds);
    return {
      ...object,
      is_isolated: isolated,
      structure_status: isolated ? "isolated" : "structured",
      structure_reason: isolated
        ? "该对象在对象拆解后的结构图中没有任何入边或出边，说明当前未识别到可支撑结构的组成关系。"
        : "该对象已进入至少一条组成结构边，可参与 DAG 结构分析。",
    };
  });
}

function buildWorkflowV2ResultFromState(state) {
  const safeState = asRecord(state);
  const alignedObjects = Array.isArray(safeState.function_objects)
    ? safeState.function_objects
    : [];
  const objects = Array.isArray(safeState.fused_objects)
    ? safeState.fused_objects.map((object) => {
      const objectId = asText(object?.object_id);
      const alignedObject = alignedObjects.find((item) => asText(item?.object_id) === objectId) ?? null;
      return {
        ...object,
        object_level: normalizeObjectLevel(alignedObject?.object_level ?? object?.object_level),
      };
    })
    : [];
  const edges = Array.isArray(safeState.edges) ? safeState.edges : [];
  const filteredChunks = Array.isArray(safeState.filtered_chunks) && safeState.filtered_chunks.length > 0
    ? safeState.filtered_chunks
    : (Array.isArray(safeState.chunks) ? safeState.chunks : []);
  const nodeIds = objects.map((item) => asText(item?.object_id)).filter(Boolean);
  const systemScope = asRecord(safeState.system_scope);
  const structureQuality = asRecord(safeState.structure_quality);
  return {
    document: safeState.document ?? null,
    chunks: Array.isArray(safeState.chunks) ? safeState.chunks : [],
    windows: Array.isArray(safeState.windows) ? safeState.windows : [],
    objects,
    edges,
    ablation: Array.isArray(safeState.parent_summaries) ? safeState.parent_summaries : [],
    meta: {
      total_chunks: Array.isArray(safeState.chunks) ? safeState.chunks.length : 0,
      total_selected_chunks: filteredChunks.length,
      total_windows: Array.isArray(safeState.windows) ? safeState.windows.length : 0,
      total_objects: objects.length,
      total_edges: edges.length,
      total_isolated_objects: objects.filter((item) => item?.is_isolated === true).length,
      total_removed_cycle_edges: Array.isArray(safeState.removed_cycle_edges) ? safeState.removed_cycle_edges.length : 0,
      is_dag: computeTopologicalOrder(edges, nodeIds).cyclicNodeIds.length === 0,
      system_scope_focus: asText(systemScope.document_focus),
      system_scope_candidates: uniqueStrings(systemScope.primary_system_candidates),
      document_abstraction_level: asText(systemScope.document_abstraction_level),
      structure_quality_score: Number(structureQuality.quality_score ?? 0) || 0,
      structure_is_sound: structureQuality.is_structurally_sound === true,
      structure_orphan_count: Number(structureQuality.orphan_count ?? 0) || 0,
      structure_root_count: Number(structureQuality.root_count ?? 0) || 0,
      structure_max_depth: Number(structureQuality.max_depth ?? 0) || 0,
      structure_too_flat_warning: asText(structureQuality.too_flat_warning),
      structure_mixed_granularity_warning: asText(structureQuality.mixed_granularity_warning),
    },
  };
}

function computeObjectDepthMap(objects, edges) {
  const nodeIds = objects.map((item) => asText(item?.object_id)).filter(Boolean);
  const topo = computeTopologicalOrder(edges, nodeIds);
  const depthMap = new Map(nodeIds.map((nodeId) => [nodeId, 1]));
  const adjacency = new Map(nodeIds.map((nodeId) => [nodeId, []]));

  for (const edge of edges) {
    const sourceId = asText(edge?.source_object_id);
    const targetId = asText(edge?.target_object_id);
    if (!adjacency.has(sourceId) || !depthMap.has(targetId)) {
      continue;
    }
    adjacency.get(sourceId).push(targetId);
  }

  for (const nodeId of topo.orderedNodeIds) {
    const currentDepth = depthMap.get(nodeId) ?? 1;
    for (const targetId of adjacency.get(nodeId) ?? []) {
      depthMap.set(targetId, Math.max(depthMap.get(targetId) ?? 1, currentDepth + 1));
    }
  }

  return depthMap;
}

function countWorkflowV2Values(values) {
  const counter = {};
  for (const value of values) {
    const normalized = asText(value);
    if (!normalized) {
      continue;
    }
    counter[normalized] = (counter[normalized] ?? 0) + 1;
  }
  return counter;
}

function normalizeWorkflowV2DisplayName(value) {
  const text = normalizeWhitespace(value)
    .replace(/^[的该本此这那一个种类项款型版式套份台类]+/, "")
    .replace(/[：:，,、。；;（）()\[\]【】\s]+$/g, "")
    .trim();
  if (!text) {
    return "";
  }
  const segments = text.split("的").map((item) => item.trim()).filter(Boolean);
  const candidate = segments.at(-1) || text;
  if (candidate.length > 24) {
    return candidate.slice(-24);
  }
  return candidate;
}

function splitWorkflowV2Sentences(text) {
  return asText(text)
    .split(/[。！？!\n；;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function deriveWorkflowV2ScopeCandidates(chunks, rawText) {
  const scored = new Map();
  const evidenceChunkIds = new Map();
  const firstSeen = new Map();
  const chunkList = Array.isArray(chunks) ? chunks : [];

  const rememberCandidate = (candidate, chunkId, order) => {
    const normalized = normalizeWorkflowV2DisplayName(candidate);
    if (normalized.length < 2 || normalized.length > 24) {
      return;
    }
    scored.set(normalized, (scored.get(normalized) ?? 0) + 1);
    if (!firstSeen.has(normalized)) {
      firstSeen.set(normalized, order);
    }
    if (chunkId) {
      const currentChunkIds = evidenceChunkIds.get(normalized) ?? new Set();
      currentChunkIds.add(chunkId);
      evidenceChunkIds.set(normalized, currentChunkIds);
    }
  };

  const scopePatterns = [
    /^(.{1,24}?)(?:主要)?(?:包含|包括|含有|拥有)/,
    /^(.{1,24}?)(?:主要)?由.+?(?:组成|构成)/,
    /^(.{1,24}?)(?:主要)?分为/,
  ];

  chunkList.forEach((chunk, index) => {
    const chunkId = asText(chunk?.chunk_id);
    for (const sentence of splitWorkflowV2Sentences(chunk?.text)) {
      for (const pattern of scopePatterns) {
        const match = sentence.match(pattern);
        if (match?.[1]) {
          rememberCandidate(match[1], chunkId, index);
          break;
        }
      }
    }
  });

  if (scored.size === 0) {
    const fallbackSentence = splitWorkflowV2Sentences(rawText)[0] || "";
    rememberCandidate(fallbackSentence.slice(0, 24), chunkList[0]?.chunk_id, 0);
  }

  return [...scored.entries()]
    .sort((left, right) => {
      if (left[1] !== right[1]) {
        return right[1] - left[1];
      }
      const leftOrder = firstSeen.get(left[0]) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = firstSeen.get(right[0]) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left[0].localeCompare(right[0], "zh-Hans-CN");
    })
    .slice(0, 5)
    .map(([name, count]) => ({
      name,
      count,
      evidence_chunk_ids: [...(evidenceChunkIds.get(name) ?? new Set())],
    }));
}

function inferWorkflowV2AbstractionLevel(chunks, rawText, scopeCandidates) {
  const chunkList = Array.isArray(chunks) ? chunks : [];
  const averageChunkLength = chunkList.length > 0
    ? chunkList.reduce((sum, chunk) => sum + asText(chunk?.text).length, 0) / chunkList.length
    : 0;
  const structureSignalCount = (asText(rawText).match(/包含|包括|组成|构成|分为|模块|系统|子系统/g) ?? []).length;
  if (chunkList.length >= 5 || (scopeCandidates.length >= 2 && structureSignalCount >= 3)) {
    return "mixed_depth";
  }
  if (averageChunkLength >= 120 || structureSignalCount >= 2) {
    return "system_overview";
  }
  return "component_detail";
}

function inferWorkflowV2ObjectLevel(object) {
  const name = asText(object?.object_name);
  const normalized = `${name} ${asText(object?.normalized_name)}`.toLowerCase();
  const citationsText = uniqueStrings(object?.citations).join(" ");

  if (/(功能|流程|机制|协议|算法|逻辑|策略|服务|能力|规则)$/.test(name) || /(workflow|logic|service|algorithm|protocol|function)/.test(normalized)) {
    return {
      level: "function_unit",
      confidence: 0.82,
      reason: "名称更像功能、机制或规则单元，适合归到 function_unit。",
    };
  }
  if (/(子系统|模块|单元|总成|机构|组件组|控制器|集群)$/.test(name) || /(subsystem|module|controller|cluster)/.test(normalized)) {
    return {
      level: "subsystem",
      confidence: 0.8,
      reason: "名称带有模块化或中层结构特征，更接近 subsystem。",
    };
  }
  if (/(系统|平台|架构|网络|整车|电脑|主机|设备|装置)$/.test(name) || /(system|platform|network|computer|device)/.test(normalized)) {
    return {
      level: "system",
      confidence: 0.84,
      reason: "名称本身呈现总体系统或设备级对象，更适合标为 system。",
    };
  }
  if (/(cpu|gpu|alu|reg|core|sensor|cache|engine|motor|valve|pump|chip|board|register|module)/.test(normalized)
    || /芯片|传感器|寄存器|核心|电机|阀|泵|电路|板|部件|组件/.test(name)
    || citationsText.includes("作为")
  ) {
    return {
      level: "component",
      confidence: 0.78,
      reason: "对象名称更像可被进一步组合的实体部件，优先归到 component。",
    };
  }
  return {
    level: "component",
    confidence: 0.62,
    reason: "当前缺少更强的层级信号，先按 component 兜底，后续可结合结构边继续修正。",
  };
}

function buildV2EntityFilename(object, usedSlugs) {
  const baseName = buildSlug(
    object?.normalized_name || object?.object_name || object?.object_id,
    buildSlug(object?.object_id, "object"),
  );
  let slug = baseName || "object";
  let suffix = 2;
  while (usedSlugs.has(slug)) {
    slug = `${baseName}-${suffix}`;
    suffix += 1;
  }
  usedSlugs.add(slug);
  return `graph-source/domain/${slug}.json`;
}

function summarizeV2Ablation(parentSummary, objectName, objectId) {
  if (!parentSummary || typeof parentSummary !== "object") {
    return null;
  }
  const childImportanceList = Array.isArray(parentSummary.child_importance_list)
    ? parentSummary.child_importance_list
    : [];
  const strongestImpact = childImportanceList
    .map((item) => asRecord(item))
    .sort((left, right) => {
      const order = ["none", "low", "medium", "high", "critical"];
      return order.indexOf(asText(right.importance_level)) - order.indexOf(asText(left.importance_level));
    })[0];
  const importantChildren = childImportanceList
    .map((item) => asRecord(item))
    .map((item) => `${asText(item.ablated_child_object_id)}:${asText(item.importance_level) || "unknown"}`)
    .filter(Boolean);

  return {
    entity_id: objectId,
    entity_name: objectName,
    impact_level: asText(strongestImpact?.importance_level) || "unknown",
    impact_reason: asText(strongestImpact?.reason) || asText(parentSummary.reason),
    observation: importantChildren.length > 0
      ? `child_importance=${importantChildren.join(", ")}`
      : asText(parentSummary.reason),
    evidence: importantChildren,
  };
}

function buildWorkflowV2EntityFile({
  object,
  relatedEdges,
  ablation,
  summary,
  projectId,
  level,
}) {
  const objectId = asText(object?.object_id);
  const objectName = asText(object?.object_name) || objectId;
  const citations = uniqueStrings([
    ...(Array.isArray(object?.citations) ? object.citations : []),
    ...(Array.isArray(object?.function_citations) ? object.function_citations : []),
  ]);
  const coreFunction = asText(object?.core_function);
  const entity = {
    id: objectId,
    name: objectName,
    summary: coreFunction || asText(object?.reason) || `${objectName} 的结构化摘要`,
    type: object?.is_isolated === true ? "isolated-object" : "structured-object",
    level,
    source: WORKFLOW_V2_SOURCE,
    properties: {
      normalized_name: asText(object?.normalized_name),
      aliases: uniqueStrings(object?.aliases),
      confidence: clampConfidence(object?.confidence, 0.5),
      source_window_ids: uniqueStrings(object?.source_window_ids),
      merge_reasons: uniqueStrings(object?.merge_reasons),
      core_function: coreFunction,
      function_confidence: clampConfidence(object?.function_confidence, 0.5),
      function_reason: asText(object?.function_reason),
      object_level: asText(object?.object_level),
      granularity_confidence: clampConfidence(object?.granularity_confidence, 0.5),
      granularity_reason: asText(object?.granularity_reason),
      structure_status: asText(object?.structure_status),
      structure_reason: asText(object?.structure_reason),
      structure_depth: asInteger(object?.structure_depth, 0, 0),
      structural_role: asText(object?.structural_role),
      v2_ablation_summary: ablation,
    },
    abilities: coreFunction ? [coreFunction] : [],
    citations,
  };
  const relations = relatedEdges.map((edge) => ({
    source_entity_id: asText(edge?.source_object_id),
    target_entity_id: asText(edge?.target_object_id),
    source_name: asText(edge?.source_object_name),
    target_name: asText(edge?.target_object_name),
    relation_type: asText(edge?.relation) || "contains",
    evidence: asText(edge?.citation),
  }));
  const ontology = {
    workflow_version: WORKFLOW_V2_VERSION,
    generated_at: new Date().toISOString(),
    project_id: projectId,
    scope: "entity",
    entity_id: entity.id,
    entity_name: entity.name,
    system_summary: summary,
    entity,
    relations,
    ablation: ablation ? [ablation] : [],
  };

  return {
    source: WORKFLOW_V2_SOURCE,
    ontology,
    entity,
    relations,
    ablation,
    precheck: null,
    ontology_summary: summary,
    probability: "V2-no-precheck",
  };
}

function validateWorkflowV2RetrySnapshot(snapshot, startStage) {
  const stageIndex = WORKFLOW_V2_STAGE_KEYS.indexOf(startStage);
  if (stageIndex === -1) {
    return {
      ok: false,
      stageIndex,
      message: "startStage is invalid",
    };
  }

  const stageResults = Array.isArray(snapshot?.stage_results) ? snapshot.stage_results : [];
  const targetStage = asRecord(stageResults[stageIndex]);
  const targetStatus = asText(targetStage.status);
  if (!["success", "failed"].includes(targetStatus)) {
    return {
      ok: false,
      stageIndex,
      message: `startStage ${startStage} is not retryable because its current status is ${targetStatus || "missing"}`,
    };
  }

  for (let index = 0; index < stageIndex; index += 1) {
    const previous = asRecord(stageResults[index]);
    if (asText(previous.status) !== "success") {
      return {
        ok: false,
        stageIndex,
        message: `startStage ${startStage} is invalid because previous stage ${WORKFLOW_V2_STAGE_KEYS[index]} is ${asText(previous.status) || "missing"}`,
      };
    }
  }

  return {
    ok: true,
    stageIndex,
    message: "",
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const safeConcurrency = Math.max(1, Math.min(items.length || 1, concurrency));
  await Promise.all(Array.from({ length: safeConcurrency }, () => worker()));
  return results;
}

function computeTopologicalOrder(edges, nodeIds) {
  const indegree = new Map(nodeIds.map((nodeId) => [nodeId, 0]));
  const adjacency = new Map(nodeIds.map((nodeId) => [nodeId, []]));
  for (const edge of edges) {
    if (!indegree.has(edge.source_object_id) || !indegree.has(edge.target_object_id)) {
      continue;
    }
    indegree.set(edge.target_object_id, (indegree.get(edge.target_object_id) ?? 0) + 1);
    adjacency.get(edge.source_object_id).push(edge.target_object_id);
  }

  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([nodeId]) => nodeId);
  const visited = [];

  while (queue.length > 0) {
    const current = queue.shift();
    visited.push(current);
    for (const target of adjacency.get(current) ?? []) {
      indegree.set(target, (indegree.get(target) ?? 1) - 1);
      if ((indegree.get(target) ?? 0) === 0) {
        queue.push(target);
      }
    }
  }

  return {
    orderedNodeIds: visited,
    cyclicNodeIds: nodeIds.filter((nodeId) => !visited.includes(nodeId)),
  };
}

function buildWindowExtractPrompt(window) {
  return {
    instruction: [
      "你是一个严格的信息抽取器。",
      "你的任务是从给定文本窗口中抽取 object。",
      "只根据输入文本抽取，不允许使用任何外部知识。",
      "请尽量详细地提取窗口中明确出现的实体，不要因为它们层级较细或数量较多而省略。",
      "object_name 必须是文本中不可再拆分的最小实体词。",
      "如果一个短语还能自然拆成多个独立实体词，则不要把该短语整体当成 object_name 返回，而应分别返回更小的实体。",
      "只有当一个词组在原文中作为固定概念、专有名词或不可再分的整体出现时，才允许把它作为单个 object_name。",
      "优先抽取名词性实体、组成项、部件名、概念名、对象名，不要把完整句子、描述性短语或关系短语当成实体。",
      "如果文本出现“A 由 XXX 组成”“A 包含 XXX”“A 包括 XXX”这类结构表达，必须同时提取整体对象 A 和其中出现的组成项 XXX，不能只提取其中一侧。",
      "当一句话同时给出整体与组成关系时，整体对象、各个直接组成项都要分别列入 objects。",
      "每个 object 必须包含 object_name、normalized_name、citation_chunk_ids、confidence、reason。",
      "citation_chunk_ids 只能填写当前窗口 chunk_ids 中真实存在的 chunk_id。",
      "不要复述原文，不要抄写句子，不要返回 citation 文本；只返回能支撑该对象的 chunk_id 数组。",
      "如果同一对象需要多个 chunk 共同支撑，请把多个 chunk_id 一起放进 citation_chunk_ids。",
      "如果一个 chunk 中同时出现整体对象与组成项，即使文本很短，也要把该 chunk_id 同时分配给相关对象。",
      "confidence 必须是 0 到 1 之间的小数。",
      "如果没有合适对象，返回空数组。",
      buildWorkflowV2OutputExampleText({
        objects: [
          {
            object_name: "机械狗",
            normalized_name: "机械狗",
            citation_chunk_ids: ["c1"],
            confidence: 0.98,
            reason: "原文明确提到整体对象机械狗，并给出了它的组成关系。",
          },
          {
            object_name: "外壳",
            normalized_name: "外壳",
            citation_chunk_ids: ["c1"],
            confidence: 0.96,
            reason: "原文明确提到外壳是机械狗的直接组成项。",
          },
        ],
        reason: "已提取该窗口中的整体对象及其直接组成项。",
      }),
    ].join("\n"),
    responseSchema: {
      name: "workflow_v2_window_extract",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          objects: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                object_name: { type: "string" },
                normalized_name: { type: "string" },
                citation_chunk_ids: { type: "array", items: { type: "string" } },
                confidence: { type: "number" },
                reason: { type: "string" },
              },
              required: ["object_name", "normalized_name", "citation_chunk_ids", "confidence", "reason"],
            },
          },
          reason: { type: "string" },
        },
        required: ["objects", "reason"],
      },
    },
    payload: {
      window_id: window.window_id,
      chunk_ids: window.chunk_ids,
      window_text: window.text,
    },
  };
}

function buildChunkFilterPrompt(document, chunks) {
  return {
    instruction: [
      "你是一个文档预处理筛选器。",
      "你的任务是从给定 chunks 中，筛出对后续对象抽取、组成关系识别、系统拆解最有信息量的 chunk。",
      "你只能返回应保留的 chunk_id 列表，不要改写 chunk 文本。",
      "优先保留以下 chunk：",
      "1. 明确出现对象、系统、模块、部件、概念名的 chunk。",
      "2. 明确出现“由…组成 / 包含 / 包括 / 构成 / 分为 / 包括…部分”等结构关系的 chunk。",
      "3. 明确描述对象核心功能、用途、职责、作用的 chunk。",
      "4. 对前后 chunk 形成必要语义补充、能帮助理解对象或关系的 chunk。",
      "尽量过滤掉纯寒暄、纯背景铺垫、重复表达、噪声句、与对象结构无关的弱信息 chunk。",
      "如果一个 chunk 中同时出现整体对象与组成项，即使文本很短，也必须保留。",
      "如果文档整体信息密度很高，可以保留多个 chunk；不要为了少而少。",
      "如果无法明确判断，宁可保留，不要误删关键 chunk。",
      "selected_chunk_ids 必须只包含输入里真实存在的 chunk_id，并保持原始顺序。",
      "如果所有 chunk 都值得保留，也可以全部返回。",
      buildWorkflowV2OutputExampleText({
        selected_chunk_ids: ["c1", "c2", "c4"],
        reason: "这些 chunk 明确包含对象名称、组成关系和核心功能线索；其余 chunk 主要是铺垫或弱相关描述。",
      }),
    ].join("\n"),
    responseSchema: {
      name: "workflow_v2_chunk_filter",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          selected_chunk_ids: {
            type: "array",
            items: { type: "string" },
          },
          reason: { type: "string" },
        },
        required: ["selected_chunk_ids", "reason"],
      },
    },
    payload: {
      document_name: asText(document?.file_name) || asText(document?.document_id) || "document",
      chunks: chunks.map((chunk) => ({
        chunk_id: chunk.chunk_id,
        order: chunk.order,
        text: chunk.text,
      })),
    },
  };
}

function buildFusionJudgePrompt(existingObject, candidate) {
  return {
    instruction: [
      "你是一个对象融合裁决器。",
      "只根据给定名称、别名和 citations 判断两个候选对象是否应视为同一对象。",
      "如果语义一致则 should_merge=true，否则 false。",
      "不要引入外部知识。",
      buildWorkflowV2OutputExampleText({
        should_merge: true,
        object_name: "机械狗",
        normalized_name: "机械狗",
        aliases: ["机械狗系统", "机器狗"],
        reason: "两个候选在 citations 中指向同一设备对象，只是称呼略有差异。",
      }),
    ].join("\n"),
    responseSchema: {
      name: "workflow_v2_fusion_judge",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          should_merge: { type: "boolean" },
          object_name: { type: "string" },
          normalized_name: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
        },
        required: ["should_merge", "object_name", "normalized_name", "aliases", "reason"],
      },
    },
    payload: {
      existing_object: existingObject,
      candidate_object: candidate,
    },
  };
}

function buildObjectFunctionPrompt(object) {
  return {
    instruction: [
      "你是一个核心功能分析器。",
      "请基于对象自身的 citations，提取该对象的核心功能。",
      "core_function 必须概括该对象最核心、最本质的能力、用途或成立目标。",
      "如果有多个功能，只保留最能代表该对象本体的核心功能，不要罗列次要功能。",
      "允许结合 citation 上下文做必要归纳，但不要脱离 citation 任意发挥。",
      "citation 必须包含支撑该核心功能的原文，尽量保留完整句子、完整分句或必要上下文。",
      "如果核心功能不清晰，也要给出最稳妥的单一核心功能判断，并在 reason 中说明依据。",
      buildWorkflowV2OutputExampleText({
        core_function: "执行环境感知与运动控制",
        citation: ["机械狗通过芯片处理信号，并由电源供能驱动整机运行。"],
        confidence: 0.88,
        reason: "引用内容同时支撑其感知处理与整机运行能力，因此归纳为环境感知与运动控制。",
      }),
    ].join("\n"),
    responseSchema: {
      name: "workflow_v2_object_function",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          core_function: { type: "string" },
          citation: { type: "array", items: { type: "string" } },
          confidence: { type: "number" },
          reason: { type: "string" },
        },
        required: ["core_function", "citation", "confidence", "reason"],
      },
    },
    payload: {
      object,
    },
  };
}

function buildGranularityAlignPrompt(objects) {
  const expectedCount = Array.isArray(objects) ? objects.length : 0;
  return {
    instruction: [
      "你是一个对象粒度对齐器。",
      "请根据对象名称、归一化名称、别名、引用片段等信息，为每个对象标注唯一的 object_level。",
      `输入共有 ${expectedCount} 个对象，aligned_objects 必须与输入一一对应，数量必须恰好等于 ${expectedCount}，并且顺序必须与输入一致。`,
      "每个 aligned_objects 项都必须同时包含 object_id 和 object_level。",
      "object_level 只能是 component、function_unit、subsystem、system 之一。",
      "component 表示具体实体、设备、传感器、数据、代码、接口、参数、请求、动作、控制项等细粒度对象。",
      "function_unit 表示功能模块、方案、设计、实现、计划、效果等功能性单元。",
      "subsystem 表示子系统、阶段、流程段等中层结构。",
      "system 表示总系统、平台、架构、总对象等最高层级对象。",
      "无法明确判断时，优先返回 component。",
      "不要修改 object_id，也不要遗漏任何输入对象。",
      "请保持输入对象的顺序，并为每个对象返回一条对应记录。",
      buildWorkflowV2OutputExampleText({
        aligned_objects: [
          { object_id: "obj-1", object_level: "component" },
          { object_id: "obj-2", object_level: "system" },
        ],
        reason: "已按对象名称与文本语义完成粒度对齐。",
      }),
    ].join("\n"),
    responseSchema: {
      name: "workflow_v2_granularity_align",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          aligned_objects: {
            type: "array",
            minItems: expectedCount,
            maxItems: expectedCount,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                object_id: { type: "string" },
                object_level: {
                  type: "string",
                  enum: [
                    "component",
                    "function_unit",
                    "subsystem",
                    "system",
                  ],
                },
              },
              required: ["object_id", "object_level"],
            },
          },
          reason: { type: "string" },
        },
        required: ["aligned_objects", "reason"],
      },
    },
    payload: {
      objects,
    },
  };
}

function buildObjectDecomposePrompt(object) {
  return {
    instruction: [
      "你是一个结构拆解器。",
      "请基于对象自身的 citations，提取它直接包含的子对象。",
      "你只能抽取相邻层级的直接 contains 关系。",
      "source 必须是父级对象，target 必须是直接子级对象。",
      "允许：system contains subsystem、subsystem contains function_unit、function_unit contains component。",
      "禁止：跨层 contains、反向 contains、证据不足的 contains、为了连通图谱伪造中间对象或中间关系。",
      "如果文档只暗示跨层关系，但没有中间层证据，不要强行连边；这类候选关系应交给后端记录为 pending/skipped。",
      "只提取能够由 citation 支持或判断出的组成/包含关系。",
      "允许结合 citation 上下文和必要的常识或领域知识，辅助判断最合理的组成关系。",
      "允许根据 citation 中的结构表达进行等价归纳，例如“由…组成”“包括…”“分为…部分”“包含…”都可以视为 contains。",
      "如果输出 A contains B、A contains C 等多个子对象，这些子对象必须处于同一拆解视角下，并且按合理的组织方案组合后能够共同表征 A。",
      "不要混合不同拆解维度的子对象；不要一部分是组成部件，另一部分是功能、流程、用途、角色或结果。",
      "如果若干子对象合在一起仍不足以表现 A，或者只是 A 的零散片段、示例项、相关项，而不是构成 A 的组成部分，则不要输出这些 contains。",
      "只提取直接子对象，不要跨层级推断孙节点或更深层结构。",
      "如果 citation 主要描述的是功能、用途、流程、依赖、因果、时序或交互关系，不要提取为 contains。",
      "relation 只能写 contains。",
      "可以使用必要知识辅助判断，但不要脱离 citation 主题随意补充无依据的子对象。",
      buildWorkflowV2OutputExampleText({
        decompositions: [
          {
            parent_object_name: "机械狗",
            child_object_name: "外壳",
            relation: "contains",
            citation: "机械狗由外壳、芯片、电源构成。",
            confidence: 0.95,
            reason: "citation 明确说明外壳是机械狗的直接组成部分。",
          },
          {
            parent_object_name: "机械狗",
            child_object_name: "芯片",
            relation: "contains",
            citation: "机械狗由外壳、芯片、电源构成。",
            confidence: 0.95,
            reason: "citation 明确说明芯片是机械狗的直接组成部分。",
          },
        ],
        reason: "已提取对象的直接组成关系；若没有直接组成关系则返回空数组。",
      }),
    ].join("\n"),
    responseSchema: {
      name: "workflow_v2_object_decompose",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          decompositions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                parent_object_name: { type: "string" },
                child_object_name: { type: "string" },
                relation: { type: "string", enum: ["contains"] },
                citation: { type: "string" },
                confidence: { type: "number" },
                reason: { type: "string" },
              },
              required: ["parent_object_name", "child_object_name", "relation", "citation", "confidence", "reason"],
            },
          },
          reason: { type: "string" },
        },
        required: ["decompositions", "reason"],
      },
    },
    payload: {
      object,
    },
  };
}

function buildObjectDecomposeRetryHint(attempt) {
  if (attempt === 2) {
    return "上次输出不是合法 JSON，这次只返回 JSON，不要包裹代码围栏。";
  }
  if (attempt >= 3) {
    return [
      "上次输出仍不是合法 JSON。",
      "这次严格只返回一个 JSON 对象。",
      "字段只能包含 decompositions 和 reason。",
      "如果没有直接组成关系，请返回 {\"decompositions\":[],\"reason\":\"未发现直接组成关系\"}。",
    ].join(" ");
  }
  return "";
}

function buildCycleResolvePrompt(cycleEdges) {
  return {
    instruction: [
      "你是一个有向无环图裁决器。",
      "请在构成环的边中删除最弱的一条。",
      "优先保留证据更强、citation 更明确、confidence 更高的边。",
      buildWorkflowV2OutputExampleText({
        remove_edge_id: "edge-cpu-to-computer",
        reason: "这条边的证据更弱，删除后可打破环且保留主要结构关系。",
      }),
    ].join("\n"),
    responseSchema: {
      name: "workflow_v2_cycle_resolve",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          remove_edge_id: { type: "string" },
          reason: { type: "string" },
        },
        required: ["remove_edge_id", "reason"],
      },
    },
    payload: {
      cycle_edges: cycleEdges,
    },
  };
}

function buildSiblingAblationPrompt(parent, ablatedChild, siblings, localEdges) {
  return {
    instruction: [
      "你是一个局部结构消融分析器。",
      "请分析去除某个子节点后，对其兄弟节点的影响。",
      "只能基于输入对象、edges 和 citations 判断。",
      "impact_level 只能是 none、low、medium、high。",
      buildWorkflowV2OutputExampleText({
        sibling_impacts: [
          {
            target_sibling_object_id: "obj-power",
            impact_level: "medium",
            judgement: "外壳缺失会削弱对电源模块的保护与集成稳定性。",
            reason: "citation 表明外壳承担封装和承载作用，因此去除后会中度影响同级模块工作环境。",
          },
        ],
        reason: "已分析被消融子节点对各兄弟节点的影响程度。",
      }),
    ].join("\n"),
    responseSchema: {
      name: "workflow_v2_sibling_ablation",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          sibling_impacts: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                target_sibling_object_id: { type: "string" },
                impact_level: { type: "string" },
                judgement: { type: "string" },
                reason: { type: "string" },
              },
              required: ["target_sibling_object_id", "impact_level", "judgement", "reason"],
            },
          },
          reason: { type: "string" },
        },
        required: ["sibling_impacts", "reason"],
      },
    },
    payload: {
      parent,
      ablated_child: ablatedChild,
      siblings,
      local_edges: localEdges,
    },
  };
}

function buildParentAblationPrompt(parent, ablatedChild, children, localEdges) {
  return {
    instruction: [
      "你是一个父节点重要性分析器。",
      "请分析去掉一个直接子节点后，父节点是否仍可以完成其核心功能。",
      "parent 对象中的 core_function 字段就是父节点核心功能的判定基准。",
      "判定标准以“去除某子后父是否可以完成其核心功能”为准，而不是只看定义是否略有变化。",
      "如果去掉该子节点后父节点仍可完成核心功能，则 importance_level 倾向 none 或 low；若明显削弱但仍可部分完成，则倾向 medium；若无法完成或基本失去核心功能，则倾向 high 或 critical。",
      "只能基于输入数据判断。",
      "importance_level 只能是 none、low、medium、high、critical。",
      buildWorkflowV2OutputExampleText({
        impact_on_parent: {
          parent_object_id: "obj-dog",
          importance_level: "high",
          judgement: "去掉电源后，父系统将难以维持核心运行能力。",
          reason: "父对象的核心功能依赖持续供能，因此电源缺失会显著破坏其核心功能。",
        },
        reason: "已完成对子节点缺失时父节点核心功能保持情况的判断。",
      }),
    ].join("\n"),
    responseSchema: {
      name: "workflow_v2_parent_ablation",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          impact_on_parent: {
            type: "object",
            additionalProperties: false,
            properties: {
              parent_object_id: { type: "string" },
              importance_level: { type: "string" },
              judgement: { type: "string" },
              reason: { type: "string" },
            },
            required: ["parent_object_id", "importance_level", "judgement", "reason"],
          },
          reason: { type: "string" },
        },
        required: ["impact_on_parent", "reason"],
      },
    },
    payload: {
      parent,
      ablated_child: ablatedChild,
      children,
      local_edges: localEdges,
    },
  };
}

const WORKFLOW_V2_PICK_CONFLICT_RESPONSE_SCHEMA = {
  name: "workflow_v2_pick_conflicts",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      resolved_conflicts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item_key: { type: "string" },
            selected_model: { type: "string" },
            reason: { type: "string" },
          },
          required: ["item_key", "selected_model", "reason"],
        },
      },
      reason: { type: "string" },
    },
    required: ["resolved_conflicts", "reason"],
  },
};

const WORKFLOW_V2_CONFLICT_REVIEW_RESPONSE_SCHEMA = {
  name: "workflow_v2_review_conflicts",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      conflict_reviews: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item_key: { type: "string" },
            preferred_model: { type: "string" },
            confidence: { type: "number" },
            reason: { type: "string" },
            suggestion: { type: "string" },
          },
          required: ["item_key", "preferred_model", "confidence", "reason", "suggestion"],
        },
      },
      round_summary: { type: "string" },
    },
    required: ["conflict_reviews", "round_summary"],
  },
};

function buildWorkflowV2EnsembleShape(stage, responseSchema) {
  const schemaName = asText(responseSchema?.name);
  if (stage === "chunk_filter" || schemaName === "workflow_v2_chunk_filter") {
    return {
      kind: "array",
      containerKey: "selected_chunk_ids",
      extractItems(value) {
        return Array.isArray(asRecord(value).selected_chunk_ids) ? asRecord(value).selected_chunk_ids : [];
      },
      getItemKey(item, index) {
        return asText(item) || `selected_chunk_ids:${index + 1}`;
      },
      buildComparableValue(item) {
        return asText(item);
      },
      pickShell(value) {
        const record = asRecord(value);
        return {
          reason: asText(record.reason),
        };
      },
      wrap(items, shell) {
        return {
          ...shell,
          selected_chunk_ids: items,
        };
      },
    };
  }

  if (stage === "window_extract" || schemaName === "workflow_v2_window_extract") {
    return {
      kind: "array",
      containerKey: "objects",
      extractItems(value) {
        return Array.isArray(asRecord(value).objects) ? asRecord(value).objects : [];
      },
      getItemKey(item, index) {
        return normalizeObjectName(item?.normalized_name || item?.object_name) || `objects:${index + 1}`;
      },
      buildComparableValue(item) {
        return {
          object_name: normalizeObjectName(item?.object_name),
          normalized_name: normalizeObjectName(item?.normalized_name || item?.object_name),
        };
      },
      pickShell(value) {
        const record = asRecord(value);
        return {
          reason: asText(record.reason),
        };
      },
      wrap(items, shell) {
        return {
          ...shell,
          objects: items,
        };
      },
    };
  }

  if (stage === "object_decompose" || schemaName === "workflow_v2_object_decompose") {
    return {
      kind: "array",
      containerKey: "decompositions",
      extractItems(value) {
        return Array.isArray(asRecord(value).decompositions) ? asRecord(value).decompositions : [];
      },
      getItemKey(item, index) {
        return [
          normalizeObjectName(item?.parent_object_name),
          normalizeObjectName(item?.child_object_name),
          normalizeObjectName(item?.relation),
        ].filter(Boolean).join("::") || `decompositions:${index + 1}`;
      },
      buildComparableValue(item) {
        return {
          parent_object_name: normalizeObjectName(item?.parent_object_name),
          child_object_name: normalizeObjectName(item?.child_object_name),
          relation: normalizeObjectName(item?.relation),
        };
      },
      pickShell(value) {
        const record = asRecord(value);
        return {
          reason: asText(record.reason),
        };
      },
      wrap(items, shell) {
        return {
          ...shell,
          decompositions: items,
        };
      },
    };
  }

  if (schemaName === "workflow_v2_sibling_ablation") {
    return {
      kind: "array",
      containerKey: "sibling_impacts",
      extractItems(value) {
        return Array.isArray(asRecord(value).sibling_impacts) ? asRecord(value).sibling_impacts : [];
      },
      getItemKey(item, index) {
        return asText(item?.target_sibling_object_id) || `sibling_impacts:${index + 1}`;
      },
      buildComparableValue(item) {
        return {
          target_sibling_object_id: asText(item?.target_sibling_object_id),
          impact_level: asText(item?.impact_level),
        };
      },
      pickShell(value) {
        const record = asRecord(value);
        return {
          reason: asText(record.reason),
        };
      },
      wrap(items, shell) {
        return {
          ...shell,
          sibling_impacts: items,
        };
      },
    };
  }

  return {
    kind: "single_object",
    containerKey: "root",
    extractItems(value) {
      const record = asRecord(value);
      return Object.keys(record).length > 0 ? [record] : [];
    },
    getItemKey() {
      return "__root__";
    },
    buildComparableValue(value) {
      const record = asRecord(value);
      const schemaName = asText(responseSchema?.name);
      if (schemaName === "workflow_v2_object_function") {
        return {
          core_function: normalizeWhitespace(record.core_function),
        };
      }
      if (schemaName === "workflow_v2_fusion_judge") {
        return {
          should_merge: record.should_merge === true,
          object_name: normalizeObjectName(record.object_name),
          normalized_name: normalizeObjectName(record.normalized_name || record.object_name),
          aliases: uniqueStrings(record.aliases).map((item) => normalizeObjectName(item)).sort(),
        };
      }
      if (schemaName === "workflow_v2_cycle_resolve") {
        return {
          remove_edge_id: asText(record.remove_edge_id),
        };
      }
      if (schemaName === "workflow_v2_parent_ablation") {
        const impact = asRecord(record.impact_on_parent);
        return {
          parent_object_id: asText(impact.parent_object_id),
          importance_level: asText(impact.importance_level),
        };
      }
      return {
        ...record,
        reason: undefined,
        citation: undefined,
        citations: undefined,
        confidence: undefined,
        judgement: undefined,
      };
    },
    pickShell() {
      return {};
    },
    wrap(items) {
      return asRecord(items[0]);
    },
  };
}

function buildWorkflowV2SharedAndConflictItems(stage, responseSchema, modelAData, modelBData) {
  const shape = buildWorkflowV2EnsembleShape(stage, responseSchema);

  if (shape.kind === "single_object") {
    const aValue = asRecord(modelAData);
    const bValue = asRecord(modelBData);
    const hasA = Object.keys(aValue).length > 0;
    const hasB = Object.keys(bValue).length > 0;
    const aComparable = shape.buildComparableValue(aValue);
    const bComparable = shape.buildComparableValue(bValue);

    if (!hasA && !hasB) {
      return {
        shape,
        shell: {},
        shared_items: [],
        conflicts: [],
      };
    }

    if (stableJsonStringify(aComparable) === stableJsonStringify(bComparable)) {
      return {
        shape,
        shell: {},
        shared_items: [{
          item_key: "__root__",
          order: 0,
          value: cloneJsonValue(hasA && hasB ? mergeWorkflowV2SharedValue(aValue, bValue) : (hasA ? aValue : bValue), {}),
        }],
        conflicts: [],
      };
    }

    return {
      shape,
      shell: {},
      shared_items: [],
      conflicts: [{
        item_key: "__root__",
        order: 0,
        model_a_value: hasA ? cloneJsonValue(aValue, {}) : null,
        model_b_value: hasB ? cloneJsonValue(bValue, {}) : null,
      }],
    };
  }

  const modelAItems = shape.extractItems(modelAData).map((item, index) => ({
    order: index,
    item_key: shape.getItemKey(item, index),
    item,
  }));
  const modelBItems = shape.extractItems(modelBData).map((item, index) => ({
    order: index,
    item_key: shape.getItemKey(item, index),
    item,
  }));
  const modelAMap = new Map(modelAItems.map((item) => [item.item_key, item]));
  const modelBMap = new Map(modelBItems.map((item) => [item.item_key, item]));
  const allKeys = uniqueStrings([
    ...modelAItems.map((item) => item.item_key),
    ...modelBItems.map((item) => item.item_key),
  ]);
  const sharedItems = [];
  const conflicts = [];

  for (const [index, itemKey] of allKeys.entries()) {
    const left = modelAMap.get(itemKey) || null;
    const right = modelBMap.get(itemKey) || null;
    const leftValue = left ? cloneJsonValue(left.item, null) : null;
    const rightValue = right ? cloneJsonValue(right.item, null) : null;
    const leftComparable = left ? shape.buildComparableValue(left.item) : null;
    const rightComparable = right ? shape.buildComparableValue(right.item) : null;
    if (leftValue !== null && rightValue !== null && stableJsonStringify(leftComparable) === stableJsonStringify(rightComparable)) {
      sharedItems.push({
        item_key: itemKey,
        order: Math.min(left.order, right.order),
        value: mergeWorkflowV2SharedValue(leftValue, rightValue),
      });
      continue;
    }
    conflicts.push({
      item_key: itemKey || `${shape.containerKey}:${index + 1}`,
      order: Math.min(left?.order ?? Number.MAX_SAFE_INTEGER, right?.order ?? Number.MAX_SAFE_INTEGER, index),
      model_a_value: leftValue,
      model_b_value: rightValue,
    });
  }

  const shell = (() => {
    const leftShell = shape.pickShell(modelAData);
    if (Object.keys(leftShell).length > 0) {
      return leftShell;
    }
    return shape.pickShell(modelBData);
  })();

  return {
    shape,
    shell,
    shared_items: sharedItems.sort((left, right) => left.order - right.order),
    conflicts: conflicts.sort((left, right) => left.order - right.order),
  };
}

function buildWorkflowV2ConflictJudgePrompt({
  stage,
  instruction,
  retryHint,
  payload,
  conflicts,
  sharedItems,
  modelRuns,
  reviewRounds = [],
}) {
  return {
    instruction: [
      "你是文件工作流 V2 的分歧判决器。",
      `当前阶段：${stage}`,
      "模型 A 与模型 B 已各自完成一次结构化输出。",
      "请保留双方完全一致的 shared_items，只对 conflicts 做判决。",
      "对每个 conflict，你只能二选一，selected_model 只能写 model_a 或 model_b。",
      "不要融合答案，不要改写成第三种结果，不要混合两边字段。",
      "你必须参考 model_a_review 和 model_b_review 中的点评意见，再做最终选择。",
      "优先选择更符合原任务约束、citation 更完整、字段更自洽、结构更稳定的一侧。",
      retryHint ? `补充要求：${retryHint}` : "",
      "原始任务要求如下：",
      instruction,
      buildWorkflowV2OutputExampleText({
        resolved_conflicts: [
          {
            item_key: "机械狗::外壳::contains",
            selected_model: "model_b",
            reason: "model_b 的字段更完整，且更符合当前阶段 schema。",
          },
        ],
        reason: "已逐条选择更符合任务约束与字段要求的一侧结果。",
      }),
    ].filter(Boolean).join("\n"),
    responseSchema: WORKFLOW_V2_PICK_CONFLICT_RESPONSE_SCHEMA,
    payload: {
      original_payload: payload,
      shared_items: sharedItems.map((item) => ({
        item_key: item.item_key,
        value: item.value,
      })),
      conflicts: conflicts.map((item) => ({
        item_key: item.item_key,
        model_a_value: item.model_a_value,
        model_b_value: item.model_b_value,
      })),
      model_reviews: reviewRounds,
      model_a_review: reviewRounds.find((item) => item?.reviewer_model_key === "model_a")?.data ?? null,
      model_b_review: reviewRounds.find((item) => item?.reviewer_model_key === "model_b")?.data ?? null,
      model_a_name: modelRuns[0]?.model || "model_a",
      model_b_name: modelRuns[1]?.model || "model_b",
    },
  };
}

function buildWorkflowV2ConflictReviewPrompt({
  stage,
  instruction,
  retryHint,
  payload,
  conflicts,
  sharedItems,
  reviewer,
}) {
  const targetModel = reviewer.key === "model_a" ? "model_b" : "model_a";
  return {
    instruction: [
      "你是文件工作流 V2 的冲突点评者。",
      `当前阶段：${stage}`,
      `你当前代表 ${reviewer.key}，请逐条点评 unresolved conflicts，并判断你更支持 model_a 还是 model_b。`,
      `请重点指出 ${targetModel} 的问题、可取之处，以及你建议 judge 最终如何取舍。`,
      "preferred_model 只能写 model_a、model_b 或 tie。",
      "suggestion 要写给 judge 的简短取舍建议，而不是重写结果。",
      retryHint ? `补充要求：${retryHint}` : "",
      "原始任务要求如下：",
      instruction,
      buildWorkflowV2OutputExampleText({
        conflict_reviews: [
          {
            item_key: "机械狗::外壳::contains",
            preferred_model: "model_b",
            confidence: 0.82,
            reason: "model_b 的字段更完整，保留了当前阶段需要的关键结构字段。",
            suggestion: "优先选 model_b，因为它更符合 schema 且证据表达更完整。",
          },
        ],
        round_summary: "本轮主要建议优先保留字段完整、结构更稳定的一侧输出。",
      }),
    ].filter(Boolean).join("\n"),
    responseSchema: WORKFLOW_V2_CONFLICT_REVIEW_RESPONSE_SCHEMA,
    payload: {
      original_payload: payload,
      shared_items: sharedItems.map((item) => ({
        item_key: item.item_key,
        value: item.value,
      })),
      unresolved_conflicts: conflicts.map((item) => ({
        item_key: item.item_key,
        model_a_value: item.model_a_value,
        model_b_value: item.model_b_value,
      })),
      reviewer_model_key: reviewer.key,
      reviewer_model_name: reviewer.model,
    },
  };
}

function normalizeWorkflowV2JudgeResult(data, conflicts) {
  const conflictMap = new Map((Array.isArray(conflicts) ? conflicts : []).map((item) => [item.item_key, item]));
  const record = asRecord(data);
  const resolved = Array.isArray(record.resolved_conflicts)
    ? record.resolved_conflicts.map((item) => asRecord(item)).map((item) => {
      const itemKey = asText(item.item_key);
      if (!itemKey || !conflictMap.has(itemKey)) {
        return null;
      }
      const selectedModel = asText(item.selected_model) === "model_b" ? "model_b" : "model_a";
      return {
        item_key: itemKey,
        selected_model: selectedModel,
        reason: asText(item.reason) || "判决模型认为该侧更符合原始任务要求。",
      };
    }).filter(Boolean)
    : [];

  return {
    resolved_conflicts: resolved,
    reason: asText(record.reason),
  };
}

function normalizeWorkflowV2ReviewResult(data, conflicts) {
  const conflictMap = new Map((Array.isArray(conflicts) ? conflicts : []).map((item) => [item.item_key, item]));
  const record = asRecord(data);
  const reviews = Array.isArray(record.conflict_reviews)
    ? record.conflict_reviews.map((item) => asRecord(item)).map((item) => {
      const itemKey = asText(item.item_key);
      if (!itemKey || !conflictMap.has(itemKey)) {
        return null;
      }
      const preferredModel = (() => {
        const value = asText(item.preferred_model);
        if (value === "model_a" || value === "model_b" || value === "tie") {
          return value;
        }
        return "tie";
      })();
      return {
        item_key: itemKey,
        preferred_model: preferredModel,
        confidence: clampConfidence(item.confidence, 0.5),
        reason: asText(item.reason) || "该点评解释了 reviewer 的取舍倾向。",
        suggestion: asText(item.suggestion) || "请综合双方证据后再做最终选择。",
      };
    }).filter(Boolean)
    : [];
  return {
    conflict_reviews: reviews,
    round_summary: asText(record.round_summary),
  };
}

function buildWorkflowV2ReviewRoundData(conflicts, normalizedReview, reviewer) {
  const reviewMap = new Map(
    (Array.isArray(normalizedReview?.conflict_reviews) ? normalizedReview.conflict_reviews : [])
      .map((item) => [item.item_key, item]),
  );

  const resolvedConflicts = (Array.isArray(conflicts) ? conflicts : []).map((conflict) => {
    const review = reviewMap.get(conflict.item_key);
    if (!review) {
      return null;
    }

    const preferredModel = review.preferred_model;
    const pickedValue = preferredModel === "model_b"
      ? (conflict.model_b_value ?? conflict.model_a_value ?? null)
      : preferredModel === "model_a"
        ? (conflict.model_a_value ?? conflict.model_b_value ?? null)
        : mergeWorkflowV2SharedValue(conflict.model_a_value, conflict.model_b_value);

    return {
      item_key: conflict.item_key,
      decision: preferredModel === "tie" ? "建议继续裁决" : `建议保留 ${preferredModel}`,
      summary: review.reason,
      final_value: cloneJsonValue(pickedValue, {}),
      citations: [
        {
          target_model: preferredModel === "tie" ? reviewer.key : preferredModel,
          stance: preferredModel === "tie" ? "修改" : "同意",
          reason: review.reason,
          suggestion: review.suggestion,
        },
      ],
    };
  }).filter(Boolean);

  const remainingConflicts = resolvedConflicts
    .filter((item) => item.decision === "建议继续裁决")
    .map((item) => item.item_key);

  return {
    resolved_conflicts: resolvedConflicts,
    remaining_conflicts: remainingConflicts,
    conflict_reviews: cloneJsonValue(normalizedReview?.conflict_reviews, []),
    round_summary: asText(normalizedReview?.round_summary) || `${reviewer.key} 已完成冲突点评。`,
  };
}

function buildWorkflowV2FinalEnsembleData(comparison, judgeSelections) {
  const selectionMap = new Map((judgeSelections?.resolved_conflicts ?? []).map((item) => [item.item_key, item]));
  const shape = comparison.shape;
  const pickConflictValue = (conflict) => {
    const selection = selectionMap.get(conflict?.item_key || "");
    if (selection?.selected_model === "model_b") {
      return cloneJsonValue(conflict?.model_b_value, null);
    }
    if (selection?.selected_model === "model_a") {
      return cloneJsonValue(conflict?.model_a_value, null);
    }
    return cloneJsonValue(conflict?.model_a_value ?? conflict?.model_b_value, null);
  };
  const pickFinalShell = (mergedItems) => {
    const modelAShell = asRecord(comparison.model_a_shell);
    const modelBShell = asRecord(comparison.model_b_shell);
    const selectedModels = comparison.conflicts
      .map((item) => asText(selectionMap.get(item.item_key)?.selected_model))
      .filter(Boolean);

    if (mergedItems.length === 0 && comparison.shared_items.length === 0) {
      if (selectedModels.length > 0 && selectedModels.every((item) => item === "model_b")) {
        return modelBShell;
      }
      if (selectedModels.length > 0 && selectedModels.every((item) => item === "model_a")) {
        return modelAShell;
      }
    }

    if (Object.keys(modelAShell).length > 0) {
      return modelAShell;
    }
    return modelBShell;
  };

  if (shape.kind === "single_object") {
    const shared = comparison.shared_items[0]?.value;
    if (shared && typeof shared === "object" && !Array.isArray(shared)) {
      return cloneJsonValue(shared, {});
    }
    const conflict = comparison.conflicts[0] || null;
    const selection = selectionMap.get(conflict?.item_key || "__root__");
    if (!conflict) {
      return {};
    }
    if (selection?.selected_model === "model_b") {
      return cloneJsonValue(conflict.model_b_value, {});
    }
    if (selection?.selected_model === "model_a") {
      return cloneJsonValue(conflict.model_a_value, {});
    }
    return cloneJsonValue(conflict.model_a_value ?? conflict.model_b_value, {});
  }

  const mergedItems = [
    ...comparison.shared_items.map((item) => ({
      order: item.order,
      value: cloneJsonValue(item.value, null),
    })),
    ...comparison.conflicts.map((item) => {
      return {
        order: item.order,
        value: pickConflictValue(item),
      };
    }),
  ].filter((item) => item.value !== null)
    .sort((left, right) => left.order - right.order)
    .map((item) => item.value);

  return shape.wrap(mergedItems, pickFinalShell(mergedItems));
}

function createDocumentRecord({ conversationId, fileName, projectId, rawText }) {
  const normalizedText = typeof rawText === "string" ? rawText.replace(/\r\n/g, "\n") : "";
  return {
    document_id: `doc-${buildSlug(conversationId || fileName || projectId, "workflow-v2")}`,
    file_name: fileName || "upload.txt",
    project_id: projectId || "demo",
    raw_text: normalizedText,
    language: /[A-Za-z]/.test(normalizedText) && /[\u4e00-\u9fff]/.test(normalizedText)
      ? "mixed"
      : /[A-Za-z]/.test(normalizedText) ? "en" : "zh",
    reason: "该记录保存了本次 V2 工作流的原始文档文本，供后续所有阶段引用。",
  };
}

export class WorkflowV2Service extends LinearWorkflowService {
  constructor(options = {}) {
    super(options);
    this.chunkMaxChars = asInteger(options.chunkMaxChars, DEFAULT_CHUNK_MAX_CHARS, 120);
    this.chunkMinChars = asInteger(options.chunkMinChars, DEFAULT_CHUNK_MIN_CHARS, 20);
    this.windowSize = asInteger(options.windowSize, DEFAULT_WINDOW_SIZE, 2);
    this.windowStep = asInteger(options.windowStep, DEFAULT_WINDOW_STEP, 1);
    this.parallelWindows = asInteger(options.parallelWindows, DEFAULT_PARALLEL_WINDOWS, 1);
    this.workflowLlmTimeoutMs = asNumber(options.workflowLlmTimeoutMs, DEFAULT_WORKFLOW_LLM_TIMEOUT_MS, 0);
    this.ablationParentConcurrency = asInteger(options.ablationParentConcurrency, DEFAULT_ABLATION_PARENT_CONCURRENCY, 1);
    this.ablationChildConcurrency = asInteger(options.ablationChildConcurrency, DEFAULT_ABLATION_CHILD_CONCURRENCY, 1);
    this.workflowJudgeModel = asText(options.workflowJudgeModel) || this.workflowModelA;
    this.workflowV2EnvResolver = typeof options.workflowV2EnvResolver === "function"
      ? options.workflowV2EnvResolver
      : this.workflowEnvResolver;
    this.llmJsonInvokerBase = typeof options.llmJsonInvoker === "function"
      ? options.llmJsonInvoker
      : ((input) => this.invokeWorkflowV2Json(input));
  }

  getWorkflowConfig() {
    return {
      workflowModel: this.workflowModelA,
      workflowModelA: this.workflowModelA,
      workflowModelB: this.workflowModelB,
      workflowJudgeModel: this.workflowJudgeModel,
      chunkMaxChars: this.chunkMaxChars,
      chunkMinChars: this.chunkMinChars,
      windowSize: this.windowSize,
      windowStep: this.windowStep,
      parallelWindows: this.parallelWindows,
    };
  }

  setWorkflowConfig(input = {}) {
    const nextPrimary = asText(input.workflowModelA) || asText(input.workflowModel);
    const nextSecondary = asText(input.workflowModelB);
    const nextJudgeModel = asText(input.workflowJudgeModel);
    if (input.workflowModel !== undefined && !nextPrimary) {
      throw new Error("workflow model cannot be empty");
    }
    if (input.workflowModelA !== undefined && !nextPrimary) {
      throw new Error("workflow model A cannot be empty");
    }
    if (input.workflowModelB !== undefined && !nextSecondary) {
      throw new Error("workflow model B cannot be empty");
    }
    if (input.workflowJudgeModel !== undefined && !nextJudgeModel) {
      throw new Error("workflow judge model cannot be empty");
    }
    if (nextPrimary) {
      this.workflowModel = nextPrimary;
      this.workflowModelA = nextPrimary;
      this.manualWorkflowConfig.workflowModel = nextPrimary;
      this.manualWorkflowConfig.workflowModelA = nextPrimary;
      if (input.workflowModel !== undefined && input.workflowModelB === undefined) {
        this.workflowModelB = nextPrimary;
        this.manualWorkflowConfig.workflowModelB = nextPrimary;
      }
      if (input.workflowModel !== undefined && input.workflowJudgeModel === undefined) {
        this.workflowJudgeModel = nextPrimary;
        this.manualWorkflowConfig.workflowJudgeModel = nextPrimary;
      }
    }
    if (nextSecondary) {
      this.workflowModelB = nextSecondary;
      this.manualWorkflowConfig.workflowModelB = nextSecondary;
    }
    if (nextJudgeModel) {
      this.workflowJudgeModel = nextJudgeModel;
      this.manualWorkflowConfig.workflowJudgeModel = nextJudgeModel;
    }
    if (input.chunkMaxChars !== undefined) {
      this.chunkMaxChars = asInteger(input.chunkMaxChars, this.chunkMaxChars, 120);
      this.manualWorkflowConfig.chunkMaxChars = this.chunkMaxChars;
    }
    if (input.chunkMinChars !== undefined) {
      this.chunkMinChars = asInteger(input.chunkMinChars, this.chunkMinChars, 20);
      this.manualWorkflowConfig.chunkMinChars = this.chunkMinChars;
    }
    if (input.windowSize !== undefined) {
      this.windowSize = asInteger(input.windowSize, this.windowSize, 2);
      this.manualWorkflowConfig.windowSize = this.windowSize;
    }
    if (input.windowStep !== undefined) {
      this.windowStep = asInteger(input.windowStep, this.windowStep, 1);
      this.manualWorkflowConfig.windowStep = this.windowStep;
    }
    if (input.parallelWindows !== undefined) {
      this.parallelWindows = asInteger(input.parallelWindows, this.parallelWindows, 1);
      this.manualWorkflowConfig.parallelWindows = this.parallelWindows;
    }
    return this.getWorkflowConfig();
  }

  async refreshWorkflowConfigFromResolver() {
    await super.refreshWorkflowConfigFromResolver();
    if (!this.workflowV2EnvResolver) {
      return;
    }
    const resolved = await this.workflowV2EnvResolver();
    const config = asRecord(resolved);
    if (config.chunkMaxChars !== undefined) {
      this.chunkMaxChars = asInteger(config.chunkMaxChars, this.chunkMaxChars, 120);
    }
    if (config.chunkMinChars !== undefined) {
      this.chunkMinChars = asInteger(config.chunkMinChars, this.chunkMinChars, 20);
    }
    if (config.windowSize !== undefined) {
      this.windowSize = asInteger(config.windowSize, this.windowSize, 2);
    }
    if (config.windowStep !== undefined) {
      this.windowStep = asInteger(config.windowStep, this.windowStep, 1);
    }
    if (config.parallelWindows !== undefined) {
      this.parallelWindows = asInteger(config.parallelWindows, this.parallelWindows, 1);
    }
    if (config.workflowJudgeModel !== undefined) {
      const nextJudgeModel = asText(config.workflowJudgeModel);
      if (nextJudgeModel) {
        this.workflowJudgeModel = nextJudgeModel;
      }
    }

    const manualConfig = asRecord(this.manualWorkflowConfig);
    const manualJudgeModel = asText(manualConfig.workflowJudgeModel);
    if (manualJudgeModel) {
      this.workflowJudgeModel = manualJudgeModel;
    }
    if (manualConfig.chunkMaxChars !== undefined) {
      this.chunkMaxChars = asInteger(manualConfig.chunkMaxChars, this.chunkMaxChars, 120);
    }
    if (manualConfig.chunkMinChars !== undefined) {
      this.chunkMinChars = asInteger(manualConfig.chunkMinChars, this.chunkMinChars, 20);
    }
    if (manualConfig.windowSize !== undefined) {
      this.windowSize = asInteger(manualConfig.windowSize, this.windowSize, 2);
    }
    if (manualConfig.windowStep !== undefined) {
      this.windowStep = asInteger(manualConfig.windowStep, this.windowStep, 1);
    }
    if (manualConfig.parallelWindows !== undefined) {
      this.parallelWindows = asInteger(manualConfig.parallelWindows, this.parallelWindows, 1);
    }
  }

  getWorkflowSnapshotPath(conversationId) {
    return path.join(this.getConversationRuntimeRoot(conversationId || "session"), WORKFLOW_V2_SNAPSHOT_FILE);
  }

  async writeWorkflowSnapshot(conversationId, snapshot) {
    const runtimeRoot = await this.ensureConversationRuntime(conversationId || "session");
    const snapshotPath = path.join(runtimeRoot, WORKFLOW_V2_SNAPSHOT_FILE);
    await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");
  }

  async readWorkflowSnapshot(conversationId) {
    const snapshotPath = this.getWorkflowSnapshotPath(conversationId || "session");
    const content = await readFile(snapshotPath, "utf8");
    const parsed = safeJsonParse(content);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("workflow v2 snapshot is invalid");
    }
    return parsed;
  }

  async invokeWorkflowV2Json({
    stage,
    instruction,
    payload,
    responseSchema = null,
    retryHint = "",
    modelOverride = "",
    temperature = DEFAULT_WORKFLOW_LLM_TEMPERATURE,
    responseFormatMode = "none",
    signal,
  }) {
    if (!this.workflowLlmApiKey || !this.workflowLlmBaseUrl) {
      await this.refreshWorkflowConfigFromResolver();
    }
    if (!this.workflowLlmApiKey || !this.workflowLlmBaseUrl) {
      throw new Error("workflow LLM is not configured");
    }
    throwIfWorkflowV2Aborted(signal);

    const requestBody = {
      model: asText(modelOverride) || this.workflowModelA,
      temperature,
      stream: false,
      messages: [
        {
          role: "system",
          content: [
            "你是文件工作流 V2 的结构化分析助手。",
            "你只能根据输入内容回答。",
            "你必须只输出合法 JSON，不能输出 Markdown 或解释。",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `当前阶段：${stage}`,
            instruction,
            retryHint ? `补充要求：${retryHint}` : "",
            "输入如下：",
            JSON.stringify(payload, null, 2),
          ].filter(Boolean).join("\n\n"),
        },
      ],
    };
    const responseFormat = buildResponseFormat(responseSchema, responseFormatMode);
    if (responseFormat) {
      requestBody.response_format = responseFormat;
    }

    const timeoutController = this.workflowLlmTimeoutMs > 0 ? new AbortController() : null;
    const { signal: requestSignal, cleanup: cleanupRequestSignal } = createCombinedAbortSignal([signal, timeoutController?.signal]);
    const timeoutId = this.workflowLlmTimeoutMs > 0
      ? setTimeout(() => timeoutController?.abort(new Error(`workflow V2 LLM request timed out after ${this.workflowLlmTimeoutMs}ms`)), this.workflowLlmTimeoutMs)
      : null;
    let response;
    try {
      response = await fetch(`${this.workflowLlmBaseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.workflowLlmApiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: requestSignal,
      });
    } catch (error) {
      if (timeoutController?.signal?.aborted) {
        throw new Error(`workflow V2 LLM request timed out after ${this.workflowLlmTimeoutMs}ms`);
      }
      if (signal?.aborted) {
        throw getWorkflowV2AbortReason(signal);
      }
      if (error?.name === "AbortError" && requestSignal?.aborted) {
        throw getWorkflowV2AbortReason(requestSignal);
      }
      throw attachV2StageDebug(error, {
        ...getErrorDiagnostics(error),
      });
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      cleanupRequestSignal();
    }
    throwIfWorkflowV2Aborted(signal);
    if (!response.ok) {
      const text = await response.text();
      throw attachV2StageDebug(new Error(`workflow V2 LLM request failed: ${response.status} ${text}`), {
        error_name: "HttpError",
        error_code: String(response.status),
        error_http_status: String(response.status),
        llm_raw_text: text,
      });
    }

    const responseText = await response.text();
    const json = safeJsonParse(responseText);
    if (!json) {
      throw attachV2StageDebug(new Error(buildNonJsonResponseErrorMessage("workflow V2 LLM", this.workflowLlmBaseUrl, responseText)), {
        llm_raw_text: responseText,
        llm_response: null,
        debug_error: "workflow V2 LLM endpoint returned non-JSON response",
      });
    }
    const content = asText(json?.choices?.[0]?.message?.content);
    const parsed = parseWorkflowV2JsonResponseText(content);
    if (!parsed) {
      throw attachV2StageDebug(new Error("workflow V2 LLM returned invalid JSON"), {
        llm_raw_text: content,
        llm_response: json,
        debug_error: "workflow V2 LLM returned invalid JSON",
      });
    }
    const validationError = validateWorkflowV2StructuredPayload(parsed, responseSchema);
    if (validationError) {
      throw buildWorkflowV2StructuredPayloadError({
        llm_raw: parsed,
        llm_raw_text: content,
        llm_response: json,
        data: parsed,
      }, responseSchema, validationError);
    }
    return {
      llm_raw: parsed,
      llm_raw_text: content,
      llm_response: json,
      data: parsed,
    };
  }

  async invokeWorkflowV2JsonSingleWithRetry({
    stage,
    instruction,
    payload,
    responseSchema = null,
    retryHint = "",
    modelOverride = "",
    temperature = DEFAULT_WORKFLOW_LLM_TEMPERATURE,
    ensembleRole = "dual_run",
    ensembleModelKey = "",
    signal,
  }) {
    const responseFormatModes = ["none", "none", "none"];
    const retryTemperatures = [
      temperature,
      0.3,
      0.7,
    ].filter((value, index, list) => list.indexOf(value) === index);
    let lastError = null;

    for (let index = 0; index < retryTemperatures.length; index += 1) {
      const nextTemperature = retryTemperatures[index];
      const nextResponseFormatMode = responseFormatModes[Math.min(index, responseFormatModes.length - 1)];
      const nextRetryHint = index === 0
        ? retryHint
        : [
          retryHint,
          "上一次返回内容无法解析为合法 JSON。请这次只输出一个完整、闭合、可直接 JSON.parse 的 JSON 对象，不要省略括号、不要重复引号，也不要输出任何解释文本。",
        ].filter(Boolean).join("\n");
      try {
        const result = normalizeWorkflowV2InvokerResult(await this.llmJsonInvokerBase({
          stage,
          instruction,
          payload,
          responseSchema,
          retryHint: nextRetryHint,
          temperature: nextTemperature,
          modelOverride,
          ensembleRole,
          ensembleModelKey,
          responseFormatMode: nextResponseFormatMode,
          signal,
        }));
        const validationError = validateWorkflowV2StructuredPayload(result.data, responseSchema);
        if (validationError) {
          throw buildWorkflowV2StructuredPayloadError(result, responseSchema, validationError);
        }
        return result;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!isWorkflowV2RetriableStructureError(message)) {
          throw error;
        }
        if (index < retryTemperatures.length - 1) {
          continue;
        }
      }
    }

    const fallbackMessage = lastError instanceof Error ? lastError.message : "workflow V2 LLM returned invalid JSON";
    const finalError = attachV2StageDebug(
      new Error(`${fallbackMessage} after ${retryTemperatures.length} attempts`),
      {
        ...(lastError && typeof lastError === "object" && lastError.stageOutput && typeof lastError.stageOutput === "object"
          ? lastError.stageOutput
          : {}),
        llm_raw_text: getErrorRawText(lastError),
      },
    );
    if (getErrorRawText(lastError)) {
      finalError.llm_raw_text = getErrorRawText(lastError);
    }
    throw finalError;
  }

  async invokeStageJson(input) {
    const stage = asText(input?.stage) || "unknown";
    const instruction = asText(input?.instruction);
    const payload = input?.payload;
    const responseSchema = input?.responseSchema ?? null;
    const retryHint = asText(input?.retryHint);
    const signal = input?.signal;
    const modelRuns = [
      { key: "model_a", model: this.workflowModelA || this.workflowModel },
      { key: "model_b", model: this.workflowModelB || this.workflowModelA || this.workflowModel },
    ];
    const llmEnsemble = {
      strategy: "shared-review-judge-pick",
      stage,
      parallel_count: 1,
      debate_rounds: 2,
      judge_model: this.workflowJudgeModel || this.workflowModelA,
      models: {
        model_a: {
          model: modelRuns[0].model,
          single_result: null,
        },
        model_b: {
          model: modelRuns[1].model,
          single_result: null,
        },
      },
      shared_items: [],
      conflicts: [],
      cross_rounds: [],
      judge_result: null,
      final_result: null,
    };

    const modelResults = await Promise.all(modelRuns.map(async (modelRun) => {
      try {
        const result = await this.invokeWorkflowV2JsonSingleWithRetry({
          stage,
          instruction,
          payload,
          responseSchema,
          retryHint,
          temperature: DEFAULT_WORKFLOW_LLM_TEMPERATURE,
          modelOverride: modelRun.model,
          ensembleRole: "dual_run",
          ensembleModelKey: modelRun.key,
          signal,
        });
        llmEnsemble.models[modelRun.key].single_result = compactV2EnsembleEntry(result, {
          model: modelRun.model,
          status: "completed",
        });
        return {
          ok: true,
          modelRun,
          result,
        };
      } catch (error) {
        llmEnsemble.models[modelRun.key].single_result = {
          model: modelRun.model,
          data: null,
          raw_text: getErrorRawText(error),
          status: "failed",
          error: getErrorMessage(error, "workflow V2 LLM request failed"),
          ...getErrorDiagnostics(error),
        };
        return {
          ok: false,
          modelRun,
          error,
        };
      }
    }));

    const successfulResults = modelResults.filter((item) => item.ok);
    if (successfulResults.length === 0) {
      const firstError = modelResults.find((item) => !item.ok)?.error || new Error("workflow V2 stage invocation failed");
      throw attachV2StageDebug(firstError, {
        llm_ensemble: llmEnsemble,
      });
    }

    if (successfulResults.length === 1) {
      const winner = successfulResults[0];
      llmEnsemble.final_result = compactV2EnsembleEntry(winner.result, {
        source: winner.modelRun.key,
        status: "completed",
      });
      return {
        llm_raw: winner.result.llm_raw,
        llm_raw_text: winner.result.llm_raw_text,
        llm_response: winner.result.llm_response,
        llm_ensemble: llmEnsemble,
        data: winner.result.data,
      };
    }

    const modelAResult = successfulResults.find((item) => item.modelRun.key === "model_a")?.result ?? successfulResults[0].result;
    const modelBResult = successfulResults.find((item) => item.modelRun.key === "model_b")?.result ?? successfulResults[1].result;
    const comparison = buildWorkflowV2SharedAndConflictItems(
      stage,
      responseSchema,
      modelAResult.data ?? modelAResult.llm_raw ?? null,
      modelBResult.data ?? modelBResult.llm_raw ?? null,
    );
    llmEnsemble.shared_items = comparison.shared_items.map((item) => ({
      item_key: item.item_key,
      order: item.order,
      value: cloneJsonValue(item.value, null),
    }));
    llmEnsemble.conflicts = comparison.conflicts.map((item) => ({
      item_key: item.item_key,
      order: item.order,
      model_a_value: cloneJsonValue(item.model_a_value, null),
      model_b_value: cloneJsonValue(item.model_b_value, null),
    }));

    let judgeResult = null;
    let finalData = null;
    if (comparison.conflicts.length > 0) {
      const reviewResults = await Promise.all(modelRuns.map(async (reviewer, index) => {
        const reviewPrompt = buildWorkflowV2ConflictReviewPrompt({
          stage,
          instruction,
          retryHint,
          payload,
          conflicts: comparison.conflicts,
          sharedItems: comparison.shared_items,
          reviewer,
        });

        try {
          const reviewResult = await this.invokeWorkflowV2JsonSingleWithRetry({
            stage,
            instruction: reviewPrompt.instruction,
            payload: reviewPrompt.payload,
            responseSchema: reviewPrompt.responseSchema,
            retryHint: "",
            temperature: DEFAULT_WORKFLOW_LLM_TEMPERATURE,
            modelOverride: reviewer.model,
            ensembleRole: "cross_round",
            ensembleModelKey: reviewer.key,
            signal,
          });
          const normalizedReview = normalizeWorkflowV2ReviewResult(reviewResult.data, comparison.conflicts);
          const roundData = buildWorkflowV2ReviewRoundData(comparison.conflicts, normalizedReview, reviewer);
          const roundEntry = compactV2EnsembleEntry({
            ...reviewResult,
            data: roundData,
          }, {
            round: index + 1,
            reviewer_model: reviewer.model,
            reviewer_model_key: reviewer.key,
            status: "completed",
          });
          llmEnsemble.cross_rounds[index] = roundEntry;
          return {
            ok: true,
            reviewer,
            roundEntry,
            review: normalizedReview,
          };
        } catch (error) {
          llmEnsemble.cross_rounds[index] = {
            round: index + 1,
            reviewer_model: reviewer.model,
            reviewer_model_key: reviewer.key,
            data: null,
            raw_text: getErrorRawText(error),
            status: "failed",
            error: getErrorMessage(error, "workflow V2 conflict review failed"),
          };
          return {
            ok: false,
            reviewer,
            error,
          };
        }
      }));

      const completedReviews = reviewResults
        .filter((item) => item.ok && item.roundEntry)
        .map((item) => item.roundEntry);
      const judgePrompt = buildWorkflowV2ConflictJudgePrompt({
        stage,
        instruction,
        retryHint,
        payload,
        conflicts: comparison.conflicts,
        sharedItems: comparison.shared_items,
        modelRuns,
        reviewRounds: completedReviews,
      });
      try {
        judgeResult = await this.invokeWorkflowV2JsonSingleWithRetry({
          stage,
          instruction: judgePrompt.instruction,
          payload: judgePrompt.payload,
          responseSchema: judgePrompt.responseSchema,
          retryHint: "",
          temperature: DEFAULT_WORKFLOW_LLM_TEMPERATURE,
          modelOverride: this.workflowJudgeModel || this.workflowModelA,
          ensembleRole: "judge_pick",
          ensembleModelKey: "judge",
          signal,
        });
        const normalizedSelections = normalizeWorkflowV2JudgeResult(judgeResult.data, comparison.conflicts);
        llmEnsemble.judge_result = compactV2EnsembleEntry({
          ...judgeResult,
          data: normalizedSelections,
        }, {
          model: this.workflowJudgeModel || this.workflowModelA,
          status: "completed",
        });
        finalData = buildWorkflowV2FinalEnsembleData(comparison, normalizedSelections);
      } catch (error) {
        llmEnsemble.judge_result = {
          model: this.workflowJudgeModel || this.workflowModelA,
          data: null,
          raw_text: getErrorRawText(error),
          status: "failed",
          error: getErrorMessage(error, "workflow V2 judge failed"),
        };
        finalData = buildWorkflowV2FinalEnsembleData(comparison, {
          resolved_conflicts: comparison.conflicts.map((item) => ({
            item_key: item.item_key,
            selected_model: "model_a",
            reason: "判决模型失败，回退到模型 A。",
          })),
        });
      }
    }

    if (!finalData) {
      finalData = buildWorkflowV2FinalEnsembleData(comparison, { resolved_conflicts: [] });
    }
    const finalRawText = judgeResult?.llm_raw_text || JSON.stringify(finalData);
    llmEnsemble.final_result = {
      source: comparison.conflicts.length > 0 ? "judge_pick" : "shared_consensus",
      data: cloneJsonValue(finalData, null),
      raw_text: finalRawText,
      status: "completed",
    };
    return {
      llm_raw: finalData,
      llm_raw_text: finalRawText,
      llm_response: judgeResult?.llm_response,
      llm_ensemble: llmEnsemble,
      data: finalData,
    };
  }

  buildInitialStageResults() {
    return WORKFLOW_V2_STAGE_KEYS.map((stage, index) => ({
      stage,
      order: index + 1,
      status: "pending",
      started_at: null,
      finished_at: null,
      output: null,
      error: null,
    }));
  }

  async retryFileWorkflowFromStage(input) {
    const conversationId = asText(input?.conversationId) || "file-workflow-v2";
    const projectId = asText(input?.projectId);
    const startStage = asText(input?.startStage);
    const runtimeRoot = this.getConversationRuntimeRoot(conversationId);

    if (!projectId) {
      return createV2ResponseEnvelope({
        ok: false,
        stageResults: [],
        errors: [{ stage: "request", message: "projectId is required" }],
        runtimeRoot,
        inputFile: null,
        result: emptyWorkflowV2Result(),
      });
    }
    if (!startStage || !WORKFLOW_V2_STAGE_KEYS.includes(startStage)) {
      return createV2ResponseEnvelope({
        ok: false,
        stageResults: [],
        errors: [{ stage: "request", message: "startStage is invalid" }],
        runtimeRoot,
        inputFile: null,
        result: emptyWorkflowV2Result(),
      });
    }

    const snapshot = await this.readWorkflowSnapshot(conversationId);
    const retryValidation = validateWorkflowV2RetrySnapshot(snapshot, startStage);
    if (!retryValidation.ok) {
      return createV2ResponseEnvelope({
        ok: false,
        stageResults: Array.isArray(snapshot?.stage_results) ? snapshot.stage_results : [],
        errors: [{ stage: "request", message: retryValidation.message }],
        runtimeRoot,
        inputFile: asRecord(snapshot?.input_file),
        result: {
          ...buildWorkflowV2ResultFromState(snapshot?.state),
          reason: "重试请求被拒绝，因为当前阶段状态或前序阶段状态不满足重试条件。",
        },
      });
    }

    return this.runFileWorkflow({
      projectId,
      conversationId,
      fileName: asText(snapshot?.input_file?.originalName) || "upload.txt",
      mimeType: asText(snapshot?.input_file?.mimeType) || "text/plain",
      resumeFromStageIndex: retryValidation.stageIndex,
      resumeSnapshot: snapshot,
      signal: input?.signal,
      handlers: input?.handlers,
    });
  }

  async getFileWorkflowSession(conversationId) {
    const normalizedConversationId = asText(conversationId) || "file-workflow-v2";
    const runtimeRoot = this.getConversationRuntimeRoot(normalizedConversationId);
    const snapshot = await this.readWorkflowSnapshot(normalizedConversationId);
    const stageResults = Array.isArray(snapshot?.stage_results) ? snapshot.stage_results : [];
    const workflowStatus = deriveWorkflowV2SnapshotStatus(stageResults);
    const errors = deriveWorkflowV2Errors(stageResults);
    const snapshotResult = asRecord(snapshot?.result);
    const result = Object.keys(snapshotResult).length > 0
      ? snapshotResult
      : {
        ...buildWorkflowV2ResultFromState(snapshot?.state),
        reason: workflowStatus === "running"
          ? "已从服务端快照恢复当前 V2 工作流的阶段结果与中间产物。"
          : "已从服务端快照恢复当前 V2 工作流结果。",
      };

    return {
      ok: workflowStatus === "success",
      workflow: {
        mode: "analysis-v2",
        status: workflowStatus,
        steps: [...WORKFLOW_V2_STAGE_KEYS],
      },
      input_file: asRecord(snapshot?.input_file),
      stage_results: stageResults,
      errors,
      runtime_root: runtimeRoot,
      result,
      started_at: deriveWorkflowV2StartedAt(stageResults),
      finished_at: deriveWorkflowV2FinishedAt(stageResults, workflowStatus),
    };
  }

  buildEntityFilesFromState(state, projectId) {
    const safeState = asRecord(state);
    const objects = Array.isArray(safeState.fused_objects) ? safeState.fused_objects : [];
    const edges = Array.isArray(safeState.edges) ? safeState.edges : [];
    const parentSummaries = Array.isArray(safeState.parent_summaries) ? safeState.parent_summaries : [];

    if (objects.length === 0) {
      throw new Error("workflow V2 snapshot has no objects to write");
    }

    const objectById = new Map(objects.map((item) => [asText(item?.object_id), item]));
    const namedEdges = edges.map((edge) => {
      const sourceId = asText(edge?.source_object_id);
      const targetId = asText(edge?.target_object_id);
      return {
        ...edge,
        source_object_name: asText(objectById.get(sourceId)?.object_name) || sourceId,
        target_object_name: asText(objectById.get(targetId)?.object_name) || targetId,
      };
    });
    const depthMap = computeObjectDepthMap(objects, namedEdges);
    const summary = {
      entity_count: objects.length,
      relation_count: namedEdges.length,
      ablation_count: parentSummaries.length,
    };
    const ablationByParentId = new Map(
      parentSummaries
        .map((item) => asRecord(item))
        .map((item) => [asText(item.parent_object_id), item])
        .filter(([objectId]) => objectId),
    );
    const usedSlugs = new Set();

    return objects.map((object) => {
      const objectId = asText(object?.object_id);
      const objectName = asText(object?.object_name) || objectId;
      const relatedEdges = namedEdges.filter((edge) => (
        asText(edge?.source_object_id) === objectId || asText(edge?.target_object_id) === objectId
      ));
      const ablation = summarizeV2Ablation(ablationByParentId.get(objectId), objectName, objectId);
      const data = buildWorkflowV2EntityFile({
        object,
        relatedEdges,
        ablation,
        summary,
        projectId,
        level: depthMap.get(objectId) ?? 1,
      });
      return {
        entity_id: objectId,
        entity_name: objectName,
        filename: buildV2EntityFilename(object, usedSlugs),
        data,
      };
    });
  }

  async writeWorkflowSessionToOntoGit(input = {}) {
    const conversationId = asText(input?.conversationId) || "file-workflow-v2";
    const runtimeRoot = this.getConversationRuntimeRoot(conversationId);
    const snapshot = await this.readWorkflowSnapshot(conversationId);
    const safeState = asRecord(snapshot?.state);
    const projectId = asText(input?.projectId)
      || asText(safeState?.document?.project_id)
      || asText(snapshot?.result?.document?.project_id)
      || "demo";
    const releaseLock = await this.acquireProjectWorkflowLock(projectId);

    try {
      const entityFiles = this.buildEntityFilesFromState(safeState, projectId);
      const baseVersionMap = await this.baseVersionLoader(projectId);
      const ingestResults = [];

      for (const item of entityFiles) {
        const validation = validateWorkflowEntityFileData(item.data);
        if (!validation.ok) {
          throw new Error(`workflow V2 entity file validation failed: ${validation.error}`);
        }

        const ingestPayload = {
          project_id: projectId,
          filename: item.filename,
          data: item.data,
          message: WORKFLOW_V2_FILE_MESSAGE,
          agent_name: WORKFLOW_V2_SOURCE,
          committer_name: WORKFLOW_V2_SOURCE,
          basevision: Number(baseVersionMap.get(item.filename) || 0),
          inference_message: "Workflow V2 inference update",
          inference_agent_name: WORKFLOW_V2_SOURCE,
          inference_committer_name: WORKFLOW_V2_SOURCE,
        };

        try {
          const result = await this.invokeWriteAndInfer(ingestPayload);
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
          ingestResults.push({
            entity_id: item.entity_id,
            entity_name: item.entity_name,
            filename: item.filename,
            status: "failed",
            commit_id: "",
            version_id: null,
            error: getErrorMessage(error, "workflow V2 ingest failed"),
          });
          throw error;
        }
      }

      const writeback = {
        project_id: projectId,
        conversation_id: conversationId,
        entity_files: entityFiles,
        ingest_results: ingestResults,
        wrote_at: new Date().toISOString(),
      };
      await this.writeWorkflowSnapshot(conversationId, {
        ...snapshot,
        writeback,
      });

      return {
        ok: true,
        project_id: projectId,
        conversation_id: conversationId,
        runtime_root: runtimeRoot,
        entity_files: entityFiles,
        ingest_results: ingestResults,
        result: Object.keys(asRecord(snapshot?.result)).length > 0
          ? snapshot.result
          : buildWorkflowV2ResultFromState(safeState),
        started_at: asText(snapshot?.started_at) || deriveWorkflowV2StartedAt(snapshot?.stage_results),
        finished_at: asText(snapshot?.finished_at) || deriveWorkflowV2FinishedAt(snapshot?.stage_results, deriveWorkflowV2SnapshotStatus(snapshot?.stage_results)),
      };
    } finally {
      await releaseLock();
    }
  }

  async chunkParseStage(document) {
    const text = asText(document?.raw_text);
    if (!text) {
      return {
        chunks: [],
        total_chunks: 0,
        reason: "输入文本为空，因此没有生成任何 chunk。",
      };
    }

    const rawParagraphs = [];
    const separatorRegex = /\n\s*\n+/g;
    let startOffset = 0;
    let paragraphIndex = 0;
    let match = separatorRegex.exec(text);
    while (match) {
      const end = match.index;
      const segment = text.slice(startOffset, end);
      const trimmed = segment.trim();
      if (trimmed) {
        const segmentStart = startOffset + segment.indexOf(trimmed);
        rawParagraphs.push({
          text: trimmed,
          start_offset: segmentStart,
          end_offset: segmentStart + trimmed.length,
          paragraph_index: paragraphIndex,
        });
        paragraphIndex += 1;
      }
      startOffset = match.index + match[0].length;
      match = separatorRegex.exec(text);
    }
    const trailing = text.slice(startOffset);
    const trailingTrimmed = trailing.trim();
    if (trailingTrimmed) {
      const segmentStart = startOffset + trailing.indexOf(trailingTrimmed);
      rawParagraphs.push({
        text: trailingTrimmed,
        start_offset: segmentStart,
        end_offset: segmentStart + trailingTrimmed.length,
        paragraph_index: paragraphIndex,
      });
    }

    const preChunks = [];
    for (const paragraph of rawParagraphs) {
      if (paragraph.text.length <= this.chunkMaxChars) {
        preChunks.push({
          ...paragraph,
          source_type: "paragraph",
        });
        continue;
      }
      const splitChunks = splitLongParagraph(paragraph, this.chunkMaxChars, paragraph.paragraph_index);
      for (const item of splitChunks) {
        preChunks.push({
          ...item,
          source_type: "sentence-merged",
        });
      }
    }

    const merged = [];
    const pending = preChunks.map((item) => ({ ...item }));
    for (let index = 0; index < pending.length; index += 1) {
      const item = pending[index];
      const last = merged.at(-1);
      const next = pending[index + 1];
      const isShortItem = item.text.length < this.chunkMinChars;
      if (isShortItem) {
        const canMergePrevious = Boolean(
          last && (last.text.length + 1 + item.text.length) <= this.chunkMaxChars,
        );
        const canMergeNext = Boolean(
          next && (item.text.length + 1 + next.text.length) <= this.chunkMaxChars,
        );
        const sameParagraphAsPrevious = Boolean(last && last.paragraph_index === item.paragraph_index);
        const weakStandalone = Boolean(
          next
          && item.paragraph_index !== next.paragraph_index
          && isWeakStandaloneParagraph(item.text, this.chunkMinChars),
        );
        const veryShortStandalone = item.text.length < Math.max(8, Math.floor(this.chunkMinChars / 2));
        const crossParagraphMergeEligible = weakStandalone || veryShortStandalone;

        if (sameParagraphAsPrevious && canMergePrevious) {
          last.text = `${last.text} ${item.text}`.trim();
          last.end_offset = item.end_offset;
          last.source_type = "short-merged";
          continue;
        }

        if (crossParagraphMergeEligible && canMergeNext) {
          pending[index + 1] = mergePreChunkItems(
            item,
            next,
            weakStandalone ? "heading-merged" : "neighbor-merged",
          );
          continue;
        }

        if (crossParagraphMergeEligible && canMergePrevious) {
          last.text = `${last.text}\n\n${item.text}`.trim();
          last.end_offset = item.end_offset;
          last.source_type = weakStandalone ? "heading-merged" : "neighbor-merged";
          continue;
        }
      }
      merged.push({ ...item });
    }

    const chunks = merged.map((item, index) => ({
      chunk_id: `c${index + 1}`,
      order: index + 1,
      text: item.text,
      start_offset: item.start_offset,
      end_offset: item.end_offset,
      paragraph_index: item.paragraph_index,
      reason: buildChunkReason(item.source_type, item.text),
    }));

    return {
      chunks,
      total_chunks: chunks.length,
      reason: "已优先按自然段切块，并对超长段做句界细分、对过短片段或弱语义短标题做相邻归并。",
    };
  }

  async systemScopeIdentifyStage(document, chunks, options = {}) {
    throwIfWorkflowV2Aborted(options?.signal);
    const rawText = asText(document?.raw_text);
    const scopeCandidates = deriveWorkflowV2ScopeCandidates(chunks, rawText);
    const primarySystemCandidates = scopeCandidates.map((item) => item.name);
    const evidenceChunkIds = uniqueStrings(scopeCandidates.flatMap((item) => item.evidence_chunk_ids));
    const documentFocus = primarySystemCandidates[0] || asText(document?.file_name) || "未识别主系统";
    const documentAbstractionLevel = inferWorkflowV2AbstractionLevel(chunks, rawText, scopeCandidates);

    return {
      primary_system_candidates: primarySystemCandidates,
      document_focus: documentFocus,
      document_abstraction_level: documentAbstractionLevel,
      evidence_chunk_ids: evidenceChunkIds,
      scope_reason: primarySystemCandidates.length > 0
        ? `已根据分块文本中的“包含/组成/构成”等结构信号，锁定 ${documentFocus} 作为当前文档的主系统候选。`
        : "当前文本的系统边界信号较弱，因此只保留了保守的主系统候选。",
      reason: "已完成文档范围识别，用于给后续对象抽取和系统拆解建立统一叙事视角。",
    };
  }

  async chunkFilterStage(document, chunks, options = {}) {
    throwIfWorkflowV2Aborted(options?.signal);
    const safeChunks = Array.isArray(chunks) ? chunks.filter((item) => asText(item?.chunk_id) && asText(item?.text)) : [];
    if (safeChunks.length === 0) {
      return {
        selected_chunk_ids: [],
        selected_chunks: [],
        total_input_chunks: 0,
        total_selected_chunks: 0,
        skipped_count: 0,
        reason: "当前没有可筛选的 chunk，因此跳过文档预筛。",
      };
    }

    if (safeChunks.length <= 3) {
      return {
        selected_chunk_ids: safeChunks.map((chunk) => chunk.chunk_id),
        selected_chunks: safeChunks,
        total_input_chunks: safeChunks.length,
        total_selected_chunks: safeChunks.length,
        skipped_count: 0,
        reason: "当前 chunk 数较少，直接全量保留，避免过筛导致后续信息损失。",
      };
    }

    const chunkMap = new Map(safeChunks.map((chunk) => [chunk.chunk_id, chunk]));
    const prompt = buildChunkFilterPrompt(document, safeChunks);

    try {
      const llmResult = await this.invokeStageJson({
        stage: "chunk_filter",
        instruction: prompt.instruction,
        payload: prompt.payload,
        responseSchema: prompt.responseSchema,
        signal: options?.signal,
      });
      const payload = asRecord(llmResult.data);
      const selectedChunkIds = uniqueStrings(payload.selected_chunk_ids).filter((chunkId) => chunkMap.has(chunkId));
      const selectedChunks = selectedChunkIds.map((chunkId) => chunkMap.get(chunkId)).filter(Boolean);
      const fallbackToAll = selectedChunks.length === 0;
      const finalSelectedChunks = fallbackToAll ? safeChunks : selectedChunks;
      const finalSelectedIds = finalSelectedChunks.map((chunk) => chunk.chunk_id);

      return {
        selected_chunk_ids: finalSelectedIds,
        selected_chunks: finalSelectedChunks,
        total_input_chunks: safeChunks.length,
        total_selected_chunks: finalSelectedChunks.length,
        skipped_count: Math.max(0, safeChunks.length - finalSelectedChunks.length),
        used_fallback: fallbackToAll,
        llm_ensemble: llmResult.llm_ensemble ?? null,
        reason: fallbackToAll
          ? `模型未明确选出可保留 chunk，已回退为全量保留以保全后续流程。${asText(payload.reason) ? ` ${asText(payload.reason)}` : ""}`.trim()
          : (asText(payload.reason) || "已筛出更值得进入后续窗口抽取的高信息 chunk。"),
      };
    } catch (error) {
      return {
        selected_chunk_ids: safeChunks.map((chunk) => chunk.chunk_id),
        selected_chunks: safeChunks,
        total_input_chunks: safeChunks.length,
        total_selected_chunks: safeChunks.length,
        skipped_count: 0,
        used_fallback: true,
        error: getErrorMessage(error, "chunk_filter failed"),
        raw_text: getErrorRawText(error),
        llm_ensemble: error?.stageOutput?.llm_ensemble ?? null,
        ...getErrorDiagnostics(error),
        reason: "文档预筛失败，已自动回退为全量 chunk 继续后续窗口抽取。",
      };
    }
  }

  buildWindows(chunks) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      return [];
    }
    const windows = [];
    const size = Math.max(2, this.windowSize);
    const step = Math.max(1, this.windowStep);
    for (let start = 0; start < chunks.length; start += step) {
      const windowChunks = chunks.slice(start, start + size);
      if (windowChunks.length === 0) {
        continue;
      }
      windows.push({
        window_id: `w${windows.length + 1}`,
        order: windows.length + 1,
        chunk_ids: windowChunks.map((chunk) => chunk.chunk_id),
        text: windowChunks.map((chunk) => chunk.text).join("\n\n"),
        start_chunk_order: windowChunks[0].order,
        end_chunk_order: windowChunks[windowChunks.length - 1].order,
        reason: buildWindowReason(windowChunks.map((chunk) => chunk.chunk_id)),
      });
      if (start + size >= chunks.length) {
        break;
      }
    }
    return windows;
  }

  async windowExtractStage(document, chunks, options = {}) {
    throwIfWorkflowV2Aborted(options?.signal);
    const windows = this.buildWindows(chunks);
    const chunkTextMap = buildWorkflowV2ChunkTextMap(chunks);
    let processedWindows = 0;
    let failedWindowsCount = 0;
    options?.onProgress?.({
      stage: "window_extract",
      completed: 0,
      total: windows.length,
      failed: 0,
      parallel: this.parallelWindows,
      message: windows.length > 0
        ? `第三阶段窗口抽取进行中：已完成 0 / ${windows.length} 个窗口。`
        : "第三阶段没有可执行的滑动窗口。",
    });
    const windowResults = await mapWithConcurrency(
      windows,
      this.parallelWindows,
      async (window) => {
        throwIfWorkflowV2Aborted(options?.signal);
        const prompt = buildWindowExtractPrompt(window);
        try {
          const llmResult = await this.invokeStageJson({
            stage: "window_extract",
            instruction: prompt.instruction,
            payload: prompt.payload,
            responseSchema: prompt.responseSchema,
            signal: options?.signal,
          });
          const payload = asRecord(llmResult.data);
          const objects = Array.isArray(payload.objects) ? payload.objects.map((item) => {
            const record = asRecord(item);
            const objectName = asText(record.object_name);
            const normalizedName = normalizeObjectName(record.normalized_name || objectName);
            const requestedChunkIds = uniqueStrings(record.citation_chunk_ids).filter((chunkId) => window.chunk_ids.includes(chunkId));
            const fallbackChunkIds = window.chunk_ids.length > 0 ? window.chunk_ids : uniqueStrings(record.citation_chunk_ids);
            const citationChunkIds = requestedChunkIds.length > 0 ? requestedChunkIds : fallbackChunkIds;
            const citationTexts = materializeWorkflowV2CitationTexts(
              chunkTextMap,
              citationChunkIds,
              Array.isArray(record.citation) ? record.citation : [],
            );
            return {
              object_name: objectName,
              normalized_name: normalizedName,
              citation_chunk_ids: citationChunkIds,
              citation: citationTexts,
              confidence: clampConfidence(record.confidence, 0.5),
              reason: asText(record.reason) || `${objectName || "该对象"} 在窗口文本中被识别为独立对象。`,
            };
          }).filter((item) => item.object_name && item.normalized_name) : [];
          processedWindows += 1;
          options?.onProgress?.({
            stage: "window_extract",
            completed: processedWindows,
            total: windows.length,
            failed: failedWindowsCount,
            parallel: this.parallelWindows,
            window_id: window.window_id,
            message: `第三阶段窗口抽取进行中：已完成 ${processedWindows} / ${windows.length} 个窗口，失败 ${failedWindowsCount} 个。`,
          });
          return {
            window_id: window.window_id,
            objects,
            reason: asText(payload.reason) || "该窗口已完成对象抽取。",
            llm_ensemble: llmResult.llm_ensemble ?? null,
            failed_window: null,
          };
        } catch (error) {
          throwIfWorkflowV2Aborted(options?.signal);
          processedWindows += 1;
          failedWindowsCount += 1;
          const failedWindow = {
            window_id: window.window_id,
            chunk_ids: window.chunk_ids,
            error: getErrorMessage(error, "window_extract failed"),
            raw_text: getErrorRawText(error),
            llm_ensemble: error?.stageOutput?.llm_ensemble ?? null,
            ...getErrorDiagnostics(error),
            reason: `窗口 ${window.window_id} 抽取失败，已跳过该窗口并保留其余窗口成果。`,
          };
          options?.onProgress?.({
            stage: "window_extract",
            completed: processedWindows,
            total: windows.length,
            failed: failedWindowsCount,
            parallel: this.parallelWindows,
            window_id: window.window_id,
            skipped: true,
            message: `第三阶段窗口抽取进行中：已完成 ${processedWindows} / ${windows.length} 个窗口，失败 ${failedWindowsCount} 个。`,
          });
          return {
            window_id: window.window_id,
            objects: [],
            reason: `窗口 ${window.window_id} 抽取失败，已跳过该窗口。`,
            llm_ensemble: error?.stageOutput?.llm_ensemble ?? null,
            failed_window: failedWindow,
          };
        }
      },
    );

    const successfulWindowResults = windowResults
      .filter((item) => !item.failed_window)
      .map((item) => ({
        window_id: item.window_id,
        objects: item.objects,
        reason: item.reason,
        llm_ensemble: item.llm_ensemble ?? null,
      }));
    const failedWindows = windowResults
      .map((item) => item.failed_window)
      .filter(Boolean);

    return {
      windows,
      total_windows: windows.length,
      window_results: successfulWindowResults,
      failed_windows: failedWindows,
      progress: {
        completed: windowResults.length,
        total: windows.length,
        failed: failedWindows.length,
        parallel: this.parallelWindows,
      },
      reason: document.raw_text
        ? (failedWindows.length > 0
          ? "已按滑动窗口并行完成对象抽取；失败窗口已跳过并保留其余成果。"
          : "已按滑动窗口并行完成对象抽取。")
        : "原始文本为空，因此窗口抽取结果为空。",
    };
  }

  shouldSendFusionJudge(existingObject, candidate) {
    const existing = normalizeObjectName(existingObject.object_name);
    const next = normalizeObjectName(candidate.object_name);
    if (!existing || !next || existing === next) {
      return false;
    }
    if (existing.includes(next) || next.includes(existing)) {
      return true;
    }
    const existingTokens = new Set(existing.split(/\s+/).filter(Boolean));
    const nextTokens = new Set(next.split(/\s+/).filter(Boolean));
    const overlap = [...existingTokens].filter((token) => nextTokens.has(token)).length;
    return overlap > 0 && overlap >= Math.min(existingTokens.size, nextTokens.size);
  }

  async objectFusionStage(windowResults, options = {}) {
    throwIfWorkflowV2Aborted(options?.signal);
    const chunkTextMap = buildWorkflowV2ChunkTextMap(options?.chunks);
    const candidates = [];
    for (const windowResult of windowResults) {
      for (const object of Array.isArray(windowResult.objects) ? windowResult.objects : []) {
        candidates.push({
          ...object,
          source_window_id: windowResult.window_id,
        });
      }
    }

    const fused = [];
    const discardedCandidates = [];
    const judgeResults = [];

    for (const candidate of candidates) {
      throwIfWorkflowV2Aborted(options?.signal);
      const directMatch = fused.find((item) => item.normalized_name === candidate.normalized_name || item.aliases.includes(candidate.object_name));
      if (directMatch) {
        directMatch.citation_chunk_ids = uniqueStrings([
          ...(Array.isArray(directMatch.citation_chunk_ids) ? directMatch.citation_chunk_ids : []),
          ...(Array.isArray(candidate.citation_chunk_ids) ? candidate.citation_chunk_ids : []),
        ]);
        directMatch.aliases = uniqueStrings([...directMatch.aliases, candidate.object_name]);
        directMatch.citations = materializeWorkflowV2CitationTexts(
          chunkTextMap,
          directMatch.citation_chunk_ids,
          [...directMatch.citations, ...candidate.citation],
        );
        directMatch.source_window_ids = uniqueStrings([...directMatch.source_window_ids, candidate.source_window_id]);
        directMatch.merge_reasons = uniqueStrings([...directMatch.merge_reasons, candidate.reason, "normalized_name 完全一致，因此直接合并。"]);
        directMatch.confidence = averageConfidence([directMatch.confidence, candidate.confidence]);
        directMatch.reason = "该对象由同名或已知别名候选合并而成。";
        continue;
      }

      const ambiguous = fused.find((item) => this.shouldSendFusionJudge(item, candidate));
      if (ambiguous) {
        const prompt = buildFusionJudgePrompt(ambiguous, candidate);
        try {
          const judgeResult = await this.invokeStageJson({
            stage: "object_fusion",
            instruction: prompt.instruction,
            payload: prompt.payload,
            responseSchema: prompt.responseSchema,
            signal: options?.signal,
          });
          const judge = asRecord(judgeResult.data);
          if (judge.should_merge === true) {
            judgeResults.push({
              existing_object_name: ambiguous.object_name,
              candidate_object_name: candidate.object_name,
              selected_action: "merge",
              reason: asText(judge.reason) || "判决模型认为两个候选应合并。",
              llm_ensemble: judgeResult.llm_ensemble ?? null,
            });
            ambiguous.object_name = asText(judge.object_name) || ambiguous.object_name;
            ambiguous.normalized_name = normalizeObjectName(judge.normalized_name || ambiguous.normalized_name);
            ambiguous.aliases = uniqueStrings([...ambiguous.aliases, ...uniqueStrings(judge.aliases), candidate.object_name]);
            ambiguous.citation_chunk_ids = uniqueStrings([
              ...(Array.isArray(ambiguous.citation_chunk_ids) ? ambiguous.citation_chunk_ids : []),
              ...(Array.isArray(candidate.citation_chunk_ids) ? candidate.citation_chunk_ids : []),
            ]);
            ambiguous.citations = materializeWorkflowV2CitationTexts(
              chunkTextMap,
              ambiguous.citation_chunk_ids,
              [...ambiguous.citations, ...candidate.citation],
            );
            ambiguous.source_window_ids = uniqueStrings([...ambiguous.source_window_ids, candidate.source_window_id]);
            ambiguous.merge_reasons = uniqueStrings([...ambiguous.merge_reasons, asText(judge.reason), candidate.reason]);
            ambiguous.confidence = averageConfidence([ambiguous.confidence, candidate.confidence]);
            ambiguous.reason = "该对象由同义或近义候选经裁决后融合而成。";
            continue;
          }
          judgeResults.push({
            existing_object_name: ambiguous.object_name,
            candidate_object_name: candidate.object_name,
            selected_action: "keep_separate",
            reason: asText(judge.reason) || "判决模型认为两个候选应保持分离。",
            llm_ensemble: judgeResult.llm_ensemble ?? null,
          });
        } catch (error) {
          throwIfWorkflowV2Aborted(options?.signal);
          judgeResults.push({
            existing_object_name: ambiguous.object_name,
            candidate_object_name: candidate.object_name,
            selected_action: "keep_separate_on_error",
            reason: `融合裁决失败，已保守保留分离。${getErrorMessage(error, "object_fusion failed")}`,
            llm_ensemble: error?.stageOutput?.llm_ensemble ?? null,
            raw_text: getErrorRawText(error),
            ...getErrorDiagnostics(error),
          });
        }
      }

      fused.push({
        object_id: `obj-${buildSlug(candidate.normalized_name || candidate.object_name, "object")}-${fused.length + 1}`,
        object_name: candidate.object_name,
        normalized_name: candidate.normalized_name,
        aliases: uniqueStrings([candidate.object_name]),
        citation_chunk_ids: uniqueStrings(candidate.citation_chunk_ids),
        citations: materializeWorkflowV2CitationTexts(
          chunkTextMap,
          candidate.citation_chunk_ids,
          candidate.citation,
        ),
        source_window_ids: uniqueStrings([candidate.source_window_id]),
        confidence: clampConfidence(candidate.confidence, 0.5),
        merge_reasons: uniqueStrings([candidate.reason]),
        reason: "该对象来自窗口抽取结果，当前没有发现需要与之合并的更早候选。",
      });
    }

    return {
      fused_objects: fused,
      total_fused_objects: fused.length,
      discarded_candidates: discardedCandidates,
      judge_results: judgeResults,
      reason: "已先按 normalized_name 直接合并，再对模糊候选执行 LLM 融合裁决。",
    };
  }

  async granularityAlignStage(objects, options = {}) {
    throwIfWorkflowV2Aborted(options?.signal);
    const safeObjects = Array.isArray(objects) ? objects : [];
    const fallbackAlignedObjects = safeObjects.map((object) => {
      const granularity = inferWorkflowV2ObjectLevel(object);
      return {
        ...object,
        object_level: normalizeObjectLevel(granularity.level),
        granularity_confidence: granularity.confidence,
        granularity_reason: granularity.reason,
      };
    });

    if (fallbackAlignedObjects.length === 0) {
      return {
        fused_objects: [],
        aligned_objects: [],
        objects: [],
        total_aligned_objects: 0,
        level_summary: countWorkflowV2Values([]),
        alignment_debug: {
          mode: "fallback",
          llm_attempted: false,
          fallback_reason: "没有可对齐的融合对象。",
        },
        reason: "没有可对齐的融合对象。",
      };
    }

    let alignedObjects = fallbackAlignedObjects;
    let reason = "已为融合对象补齐统一粒度标签，减少系统、子系统、组件在同一层混写的问题。";
    let alignmentMode = "fallback";
    let fallbackReason = "已使用启发式粒度推断作为回退结果。";
    try {
      const prompt = buildGranularityAlignPrompt(fallbackAlignedObjects);
      const llmResult = await this.invokeStageJson({
        stage: "granularity_align",
        instruction: prompt.instruction,
        payload: prompt.payload,
        responseSchema: prompt.responseSchema,
        signal: options?.signal,
      });
      const payload = asRecord(llmResult.data);
      const expectedObjectIds = fallbackAlignedObjects.map((item) => asText(item.object_id)).filter(Boolean);
      const alignedObjectsPayload = Array.isArray(payload.aligned_objects) ? payload.aligned_objects : [];
      const expectedObjectIdSet = new Set(expectedObjectIds);
      const alignedLevels = new Map();
      let alignedObjectsAreComplete = alignedObjectsPayload.length === expectedObjectIds.length && expectedObjectIds.length > 0;
      if (alignedObjectsAreComplete) {
        for (const [index, item] of alignedObjectsPayload.entries()) {
          const objectId = asText(item?.object_id);
          const rawObjectLevel = asText(item?.object_level);
          if (
            !objectId
            || objectId !== expectedObjectIds[index]
            || !expectedObjectIdSet.has(objectId)
            || !OBJECT_LEVEL_VALUES.has(rawObjectLevel)
            || alignedLevels.has(objectId)
          ) {
            alignedObjectsAreComplete = false;
            break;
          }
          alignedLevels.set(objectId, normalizeObjectLevel(rawObjectLevel));
        }
      }
      if (alignedObjectsAreComplete && alignedLevels.size === expectedObjectIds.length) {
        alignedObjects = fallbackAlignedObjects.map((object) => ({
          ...object,
          object_level: alignedLevels.get(asText(object.object_id)) ?? normalizeObjectLevel(object.object_level),
        }));
        reason = asText(payload.reason) || reason;
        alignmentMode = "llm";
        fallbackReason = "";
      } else {
        fallbackReason = `LLM 返回结果未严格覆盖全部对象，要求 ${expectedObjectIds.length} 个 aligned_objects 且每项必须按输入顺序包含 object_id 与 object_level（四选一），已回退到启发式粒度推断。`;
      }
    } catch (error) {
      throwIfWorkflowV2Aborted(options?.signal);
      const message = getErrorMessage(error, "granularity_align llm failed");
      fallbackReason = `LLM 粒度对齐调用失败：${message}，已回退到启发式粒度推断。`;
    }

    const levelSummary = countWorkflowV2Values(alignedObjects.map((item) => item.object_level));

    return {
      fused_objects: alignedObjects,
      aligned_objects: alignedObjects,
      objects: alignedObjects,
      total_aligned_objects: alignedObjects.length,
      level_summary: levelSummary,
      alignment_debug: {
        mode: alignmentMode,
        llm_attempted: true,
        fallback_reason: alignmentMode === "llm" ? "" : fallbackReason,
      },
      reason,
    };
  }

  async functionAnalysisStage(objects, options = {}) {
    throwIfWorkflowV2Aborted(options?.signal);
    const safeObjects = (Array.isArray(objects) ? objects : []).map((object) => ({
      ...object,
      object_level: normalizeObjectLevel(object?.object_level),
    }));
    let processedObjects = 0;
    let failedObjectsCount = 0;
    options?.onProgress?.({
      stage: "function_analysis",
      completed: 0,
      total: safeObjects.length,
      failed: 0,
      message: safeObjects.length > 0
        ? `第六阶段功能分析进行中：已完成 0 / ${safeObjects.length} 个对象。`
        : "第六阶段没有可分析核心功能的对象。",
    });

    const functionObjects = await mapWithConcurrency(
      safeObjects,
      Math.min(4, Math.max(1, safeObjects.length || 1)),
      async (object) => {
        throwIfWorkflowV2Aborted(options?.signal);
        try {
          const prompt = buildObjectFunctionPrompt(object);
          const llmResult = await this.invokeStageJson({
            stage: "function_analysis",
            instruction: prompt.instruction,
            payload: prompt.payload,
            responseSchema: prompt.responseSchema,
            signal: options?.signal,
          });
          const payload = asRecord(llmResult.data);
          const nextObject = {
            ...object,
            core_function: asText(payload.core_function),
            function_citations: uniqueStrings(payload.citation),
            function_confidence: clampConfidence(payload.confidence, 0.5),
            function_reason: asText(payload.reason) || `${object.object_name} 的核心功能已基于 citations 归纳。`,
            function_llm_ensemble: llmResult.llm_ensemble ?? null,
            function_error: "",
            function_error_name: "",
            function_error_code: "",
            function_error_cause_name: "",
            function_error_cause_code: "",
            function_error_http_status: "",
          };
          processedObjects += 1;
          options?.onProgress?.({
            stage: "function_analysis",
            completed: processedObjects,
            total: safeObjects.length,
            failed: failedObjectsCount,
            object_id: object.object_id,
            object_name: object.object_name,
            message: `第六阶段功能分析进行中：已完成 ${processedObjects} / ${safeObjects.length} 个对象，失败 ${failedObjectsCount} 个。`,
          });
          return nextObject;
        } catch (error) {
          throwIfWorkflowV2Aborted(options?.signal);
          const diagnostics = getErrorDiagnostics(error);
          processedObjects += 1;
          failedObjectsCount += 1;
          options?.onProgress?.({
            stage: "function_analysis",
            completed: processedObjects,
            total: safeObjects.length,
            failed: failedObjectsCount,
            object_id: object.object_id,
            object_name: object.object_name,
            skipped: true,
            message: `第六阶段功能分析进行中：已完成 ${processedObjects} / ${safeObjects.length} 个对象，失败 ${failedObjectsCount} 个。`,
          });
          return {
            ...object,
            core_function: asText(object.core_function),
            function_citations: uniqueStrings(object.function_citations),
            function_confidence: clampConfidence(object.function_confidence, 0.5),
            function_reason: `对象 ${object.object_name} 的功能分析失败，已保留对象并继续后续流程。`,
            function_llm_ensemble: error?.stageOutput?.llm_ensemble ?? null,
            function_error: getErrorMessage(error, "function_analysis failed"),
            function_raw_text: getErrorRawText(error),
            function_error_name: diagnostics.error_name || "",
            function_error_code: diagnostics.error_code || "",
            function_error_cause_name: diagnostics.error_cause_name || "",
            function_error_cause_code: diagnostics.error_cause_code || "",
            function_error_http_status: diagnostics.error_http_status || "",
          };
        }
      },
    );

    const failedFunctionObjects = functionObjects
      .filter((object) => asText(object.function_error))
      .map((object) => ({
        object_id: object.object_id,
        object_name: object.object_name,
        error: asText(object.function_error),
        raw_text: asText(object.function_raw_text),
        llm_ensemble: object.function_llm_ensemble ?? null,
        error_name: asText(object.function_error_name),
        error_code: asText(object.function_error_code),
        error_cause_name: asText(object.function_error_cause_name),
        error_cause_code: asText(object.function_error_cause_code),
        error_http_status: asText(object.function_error_http_status),
        reason: `对象 ${object.object_name} 的功能分析失败，已跳过本次功能归纳。`,
      }));

    return {
      function_objects: functionObjects.map((object) => ({
        object_id: object.object_id,
        object_name: object.object_name,
        normalized_name: object.normalized_name,
        object_level: object.object_level,
        aliases: object.aliases,
        citations: object.citations,
        core_function: object.core_function,
        citation: object.function_citations,
        confidence: object.function_confidence,
        reason: object.function_reason,
        llm_ensemble: object.function_llm_ensemble ?? null,
        error: asText(object.function_error),
        error_name: asText(object.function_error_name),
        error_code: asText(object.function_error_code),
        error_cause_name: asText(object.function_error_cause_name),
        error_cause_code: asText(object.function_error_cause_code),
        error_http_status: asText(object.function_error_http_status),
      })),
      updated_objects: functionObjects,
      failed_function_objects: failedFunctionObjects,
      total_function_objects: functionObjects.length,
      progress: {
        completed: functionObjects.length,
        total: safeObjects.length,
        failed: failedFunctionObjects.length,
      },
      reason: failedFunctionObjects.length > 0
        ? "已尽量基于每个融合对象的 citations 提取其核心功能；失败对象已跳过并保留后续流程。"
        : "已基于每个融合对象的 citations 提取其核心功能。",
    };
  }

  async objectDecomposeStage(objects, options = {}) {
    throwIfWorkflowV2Aborted(options?.signal);
    const safeObjects = (Array.isArray(objects) ? objects : []).map((object) => ({
      ...object,
      object_level: normalizeObjectLevel(object?.object_level),
    }));
    let completedObjects = 0;
    let failedObjectsCount = 0;
    options?.onProgress?.({
      stage: "object_decompose",
      completed: 0,
      total: safeObjects.length,
      failed: 0,
      message: safeObjects.length > 0
        ? `第七阶段对象拆解进行中：已完成 0 / ${safeObjects.length} 个对象。`
        : "第七阶段没有可拆解的对象。",
    });

    const decompositionResults = await mapWithConcurrency(
      safeObjects,
      Math.min(4, Math.max(1, safeObjects.length || 1)),
      async (object) => {
        throwIfWorkflowV2Aborted(options?.signal);
        const prompt = buildObjectDecomposePrompt(object);
        const attemptOutputs = [];
        let successPayload = null;

        for (let attempt = 1; attempt <= 3; attempt += 1) {
          throwIfWorkflowV2Aborted(options?.signal);
          try {
            const llmResult = await this.invokeStageJson({
              stage: "object_decompose",
              instruction: prompt.instruction,
              payload: prompt.payload,
              responseSchema: prompt.responseSchema,
              retryHint: buildObjectDecomposeRetryHint(attempt),
              signal: options?.signal,
            });
            successPayload = {
              data: asRecord(llmResult.data),
              llm_ensemble: llmResult.llm_ensemble ?? null,
            };
            break;
          } catch (error) {
            throwIfWorkflowV2Aborted(options?.signal);
            attemptOutputs.push({
              attempt,
              error: getErrorMessage(error, "object_decompose failed"),
              model_output: getErrorRawText(error),
              llm_ensemble: error?.stageOutput?.llm_ensemble ?? null,
              ...getErrorDiagnostics(error),
              reason: getErrorRawText(error)
                ? "该次调用返回了不可解析的模型输出，因此未能通过 JSON 校验。"
                : "该次调用未返回可用的结构化结果，因此无法完成对象拆解。",
            });
          }
        }

        completedObjects += 1;
        if (!successPayload) {
          failedObjectsCount += 1;
          const failedObject = {
            object_id: object.object_id,
            object_name: object.object_name,
            attempts: attemptOutputs,
            reason: `对象 ${object.object_name} 连续 3 次拆解失败，已记录模型输出并跳过该对象。`,
          };
          options?.onProgress?.({
            stage: "object_decompose",
            completed: completedObjects,
            total: safeObjects.length,
            failed: failedObjectsCount,
            object_id: object.object_id,
            object_name: object.object_name,
            skipped: true,
            message: `第七阶段对象拆解进行中：已完成 ${completedObjects} / ${safeObjects.length} 个对象，失败 ${failedObjectsCount} 个。`,
          });
          return {
            object_id: object.object_id,
            object_name: object.object_name,
            decompositions: [],
            reason: `对象 ${object.object_name} 拆解失败，已跳过该对象。`,
            failed_object: failedObject,
          };
        }

        const decompositions = Array.isArray(successPayload.data.decompositions)
          ? successPayload.data.decompositions.map((item) => {
            const record = asRecord(item);
            return {
              parent_object_name: asText(record.parent_object_name) || object.object_name,
              child_object_name: asText(record.child_object_name),
              relation: "contains",
              citation: asText(record.citation),
              confidence: clampConfidence(record.confidence, 0.5),
              reason: asText(record.reason) || "该组成关系由输入 citation 直接支撑。",
            };
          }).filter((item) => item.parent_object_name && item.child_object_name && item.citation)
          : [];

          options?.onProgress?.({
            stage: "object_decompose",
            completed: completedObjects,
            total: safeObjects.length,
            failed: failedObjectsCount,
            object_id: object.object_id,
            object_name: object.object_name,
            skipped: false,
            message: `第七阶段对象拆解进行中：已完成 ${completedObjects} / ${safeObjects.length} 个对象，失败 ${failedObjectsCount} 个。`,
          });
          return {
            object_id: object.object_id,
            object_name: object.object_name,
            decompositions,
            reason: asText(successPayload.data.reason) || `已基于 ${object.object_name} 的 citations 完成拆解。`,
            llm_ensemble: successPayload.llm_ensemble ?? null,
          failed_object: null,
        };
      },
    );

    const failedObjects = decompositionResults
      .map((item) => item.failed_object)
      .filter(Boolean);
    const filteredDecomposition = filterWorkflowV2DecompositionResults(safeObjects, decompositionResults);

    return {
      decomposition_results: filteredDecomposition.decomposition_results,
      failed_objects: failedObjects,
      skipped_decomposition_edges: filteredDecomposition.skipped_decomposition_edges,
      valid_decomposition_edge_count: filteredDecomposition.valid_decomposition_edge_count,
      pending_decomposition_edge_count: filteredDecomposition.pending_decomposition_edge_count,
      skipped_decomposition_edge_count: filteredDecomposition.skipped_decomposition_edge_count,
      total_decomposition_groups: filteredDecomposition.decomposition_results.length,
      total_decompositions: filteredDecomposition.valid_decomposition_edge_count,
      total_failed_objects: failedObjects.length,
      progress: {
        completed: decompositionResults.length,
        total: safeObjects.length,
        failed: failedObjects.length,
      },
      reason: failedObjects.length > 0
        ? "已针对每个融合对象尝试拆解直接组成关系；失败对象已记录并跳过，同时过滤了不满足相邻层级约束的关系。"
        : "已针对每个融合对象，依据其 citations 抽取直接组成关系，并过滤了不满足相邻层级约束的关系。",
    };
  }

  mapObjectNameToId(objects) {
    const map = new Map();
    for (const object of objects) {
      const candidates = uniqueStrings([object.object_name, object.normalized_name, ...(object.aliases ?? [])]);
      for (const candidate of candidates) {
        map.set(normalizeObjectName(candidate), object.object_id);
      }
    }
    return map;
  }

  async graphBuildStage(objects, decompositionResults, options = {}) {
    throwIfWorkflowV2Aborted(options?.signal);
    const objectIdMap = this.mapObjectNameToId(objects);
    const objectById = new Map((Array.isArray(objects) ? objects : []).map((object) => [asText(object?.object_id), object]));
    const edgeMap = new Map();

    for (const item of decompositionResults) {
      for (const decomposition of item.decompositions ?? []) {
        const sourceObjectId = asText(decomposition.source_object_id)
          || asText(decomposition.source)
          || asText(decomposition.from)
          || objectIdMap.get(normalizeObjectName(decomposition.parent_object_name));
        const targetObjectId = asText(decomposition.target_object_id)
          || asText(decomposition.target)
          || asText(decomposition.to)
          || objectIdMap.get(normalizeObjectName(decomposition.child_object_name));
        const sourceObject = objectById.get(sourceObjectId);
        const targetObject = objectById.get(targetObjectId);
        if (!sourceObjectId || !targetObjectId || sourceObjectId === targetObjectId || !isAllowedContainsEdge(sourceObject, targetObject)) {
          continue;
        }
        const edgeKey = `${sourceObjectId}->${targetObjectId}->contains`;
        const current = edgeMap.get(edgeKey);
        const normalizedEdge = {
          edge_id: current?.edge_id || `edge-${edgeMap.size + 1}`,
          source_object_id: sourceObjectId,
          target_object_id: targetObjectId,
          relation: "contains",
          citation: asText(decomposition.citation),
          confidence: clampConfidence(decomposition.confidence, 0.5),
          derived_from: "object_decompose",
          reason: asText(decomposition.reason) || "该边来自对象拆解阶段的直接组成关系。",
        };
        if (!current || normalizedEdge.confidence > current.confidence || (
          normalizedEdge.confidence === current.confidence && normalizedEdge.citation.length > current.citation.length
        )) {
          edgeMap.set(edgeKey, normalizedEdge);
        }
      }
    }

    const edges = [...edgeMap.values()];
    const nodeIds = objects.map((item) => item.object_id);
    const removedCycleEdges = [];

    while (true) {
      throwIfWorkflowV2Aborted(options?.signal);
      const topo = computeTopologicalOrder(edges, nodeIds);
      if (topo.cyclicNodeIds.length === 0) {
        break;
      }
      const cycleEdges = edges.filter((edge) => topo.cyclicNodeIds.includes(edge.source_object_id) && topo.cyclicNodeIds.includes(edge.target_object_id));
      if (cycleEdges.length === 0) {
        break;
      }
      const weakest = cycleEdges
        .slice()
        .sort((left, right) => {
          if (left.confidence !== right.confidence) {
            return left.confidence - right.confidence;
          }
          if (left.citation.length !== right.citation.length) {
            return left.citation.length - right.citation.length;
          }
          return left.edge_id.localeCompare(right.edge_id);
        })[0];

      let reason = "该边与其他更强的 contains 关系共同构成环，因此被移除以保持 DAG。";
      try {
        const prompt = buildCycleResolvePrompt(cycleEdges);
        const cycleJudgeResult = await this.invokeStageJson({
          stage: "graph_build",
          instruction: prompt.instruction,
          payload: prompt.payload,
          responseSchema: prompt.responseSchema,
          signal: options?.signal,
        });
        const judge = asRecord(cycleJudgeResult.data);
        if (asText(judge.remove_edge_id) === weakest.edge_id) {
          reason = asText(judge.reason) || reason;
        }
        weakest.llm_ensemble = cycleJudgeResult.llm_ensemble ?? null;
      } catch {
        throwIfWorkflowV2Aborted(options?.signal);
        // 环裁决失败时保留程序化兜底。
      }

      const removeIndex = edges.findIndex((edge) => edge.edge_id === weakest.edge_id);
      if (removeIndex === -1) {
        break;
      }
      edges.splice(removeIndex, 1);
      removedCycleEdges.push({
        edge_id: weakest.edge_id,
        citation: weakest.citation,
        reason,
        llm_ensemble: weakest.llm_ensemble ?? null,
      });
    }

    const annotatedObjects = annotateStructuredObjects(objects, edges);
    return {
      objects: annotatedObjects,
      edges,
      total_edges: edges.length,
      total_isolated_objects: annotatedObjects.filter((item) => item.is_isolated === true).length,
      removed_cycle_edges: removedCycleEdges,
      total_removed_cycle_edges: removedCycleEdges.length,
      is_dag: computeTopologicalOrder(edges, nodeIds).cyclicNodeIds.length === 0,
      reason: "已将对象拆解关系映射为 contains 边，并移除了会形成环的弱边。",
    };
  }

  async structureQualityGateStage(objects, edges, removedCycleEdges = [], options = {}) {
    throwIfWorkflowV2Aborted(options?.signal);
    const safeObjects = Array.isArray(objects) ? objects : [];
    const safeEdges = Array.isArray(edges) ? edges : [];
    const connectedObjectIds = new Set();
    const indegree = new Map();
    const outdegree = new Map();
    const objectById = new Map();

    for (const object of safeObjects) {
      const objectId = asText(object?.object_id);
      if (!objectId) {
        continue;
      }
      objectById.set(objectId, object);
      indegree.set(objectId, 0);
      outdegree.set(objectId, 0);
    }

    for (const edge of safeEdges) {
      const sourceId = asText(edge?.source_object_id);
      const targetId = asText(edge?.target_object_id);
      if (!objectById.has(sourceId) || !objectById.has(targetId)) {
        continue;
      }
      connectedObjectIds.add(sourceId);
      connectedObjectIds.add(targetId);
      indegree.set(targetId, (indegree.get(targetId) ?? 0) + 1);
      outdegree.set(sourceId, (outdegree.get(sourceId) ?? 0) + 1);
    }

    const depthMap = computeObjectDepthMap(safeObjects, safeEdges);
    const rootObjectIds = safeObjects
      .map((object) => asText(object?.object_id))
      .filter((objectId) => objectId && connectedObjectIds.has(objectId) && (indegree.get(objectId) ?? 0) === 0);
    const orphanObjects = safeObjects.filter((object) => {
      const objectId = asText(object?.object_id);
      return objectId && !connectedObjectIds.has(objectId);
    });
    const depthDistribution = {};
    const granularityByDepth = new Map();
    let maxDepth = 0;

    for (const object of safeObjects) {
      const objectId = asText(object?.object_id);
      if (!objectId || !connectedObjectIds.has(objectId)) {
        continue;
      }
      const depth = depthMap.get(objectId) ?? 1;
      const objectLevel = asText(object?.object_level) || "component";
      depthDistribution[String(depth)] = (depthDistribution[String(depth)] ?? 0) + 1;
      maxDepth = Math.max(maxDepth, depth);
      const levelSet = granularityByDepth.get(depth) ?? new Set();
      levelSet.add(objectLevel);
      granularityByDepth.set(depth, levelSet);
    }

    const levelSummary = countWorkflowV2Values(safeObjects.map((object) => object?.object_level));
    const mixedGranularityDepths = [...granularityByDepth.entries()]
      .filter(([, levelSet]) => levelSet.size > 1)
      .map(([depth, levelSet]) => `第 ${depth} 层(${[...levelSet].join("/")})`);
    const tooFlatWarning = safeEdges.length === 0
      ? (safeObjects.length > 1 ? "当前还没有形成稳定结构边，暂时无法验证系统拆解质量。" : "")
      : (safeEdges.length >= Math.max(3, Math.floor(safeObjects.length / 2)) && maxDepth <= 2
        ? "结构边数量不少，但最大深度仍然偏浅，说明系统拆解可能过于扁平。"
        : "");
    const mixedGranularityWarning = mixedGranularityDepths.length > 0
      ? `同层存在粒度混写：${mixedGranularityDepths.join("，")}。`
      : "";
    const fragmentedRootWarning = rootObjectIds.length > 2
      ? `当前检测到 ${rootObjectIds.length} 个根系统，结构可能仍然偏碎。`
      : "";
    const qualityScore = Math.max(
      0,
      Math.min(
        100,
        100
          - (safeEdges.length === 0 && safeObjects.length > 0 ? 30 : 0)
          - (Array.isArray(removedCycleEdges) ? removedCycleEdges.length : 0) * 12
          - orphanObjects.length * 8
          - (tooFlatWarning ? 12 : 0)
          - (mixedGranularityWarning ? 10 : 0)
          - Math.max(0, rootObjectIds.length - 1) * 5,
      ),
    );
    const isStructurallySound = safeEdges.length > 0
      && qualityScore >= 70
      && orphanObjects.length <= Math.max(2, Math.floor(safeObjects.length / 3))
      && !tooFlatWarning;
    const updatedObjects = safeObjects.map((object) => {
      const objectId = asText(object?.object_id);
      const hasChildren = (outdegree.get(objectId) ?? 0) > 0;
      const hasParent = (indegree.get(objectId) ?? 0) > 0;
      const isConnected = connectedObjectIds.has(objectId);
      let structuralRole = "isolated";
      if (isConnected && !hasParent) {
        structuralRole = "root";
      } else if (isConnected && hasChildren) {
        structuralRole = "branch";
      } else if (isConnected) {
        structuralRole = "leaf";
      }
      return {
        ...object,
        structure_depth: isConnected ? (depthMap.get(objectId) ?? 1) : 0,
        structural_role: structuralRole,
      };
    });

    return {
      updated_objects: updatedObjects,
      quality_score: qualityScore,
      is_structurally_sound: isStructurallySound,
      cycle_count: Array.isArray(removedCycleEdges) ? removedCycleEdges.length : 0,
      orphan_count: orphanObjects.length,
      root_count: rootObjectIds.length,
      max_depth: maxDepth,
      root_object_ids: rootObjectIds,
      root_object_names: rootObjectIds.map((objectId) => asText(objectById.get(objectId)?.object_name) || objectId),
      depth_distribution: depthDistribution,
      level_summary: levelSummary,
      too_flat_warning: tooFlatWarning,
      mixed_granularity_warning: mixedGranularityWarning,
      fragmented_root_warning: fragmentedRootWarning,
      reason: [
        `质量分 ${qualityScore}`,
        `孤立节点 ${orphanObjects.length}`,
        `根节点 ${rootObjectIds.length}`,
        `最大深度 ${maxDepth || 0}`,
        tooFlatWarning,
        mixedGranularityWarning,
        fragmentedRootWarning,
      ].filter(Boolean).join("；"),
    };
  }

  async ablationAnalysisStage(objects, edges, options = {}) {
    throwIfWorkflowV2Aborted(options?.signal);
    const objectById = new Map(objects.map((object) => [object.object_id, object]));
    const childrenByParent = new Map();
    for (const edge of edges) {
      if (!childrenByParent.has(edge.source_object_id)) {
        childrenByParent.set(edge.source_object_id, []);
      }
      childrenByParent.get(edge.source_object_id).push(edge.target_object_id);
    }

    const parentEntries = Array.from(childrenByParent.entries()).filter(([parentObjectId, childIds]) => {
      const parent = objectById.get(parentObjectId);
      return Boolean(parent) && Array.isArray(childIds) && childIds.length > 0;
    });
    const total = parentEntries.length;
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    onProgress?.({
      stage: "ablation_analysis",
      completed: 0,
      total,
      message: total > 0
        ? `最终阶段消融分析开始，待处理 ${total} 个父节点。`
        : "最终阶段没有可做消融分析的父节点，已跳过。",
    });

    let completedParents = 0;
    let failedParentsCount = 0;
    const parentConcurrency = Math.max(1, Math.min(parentEntries.length || 1, this.ablationParentConcurrency));
    const parentSummaries = await mapWithConcurrency(
      parentEntries,
      parentConcurrency,
      async ([parentObjectId, childIds]) => {
        throwIfWorkflowV2Aborted(options?.signal);
        const parent = objectById.get(parentObjectId);
        if (!parent || childIds.length === 0) {
          return null;
        }
        try {
          const children = childIds.map((childId) => objectById.get(childId)).filter(Boolean);
          const localEdges = edges.filter((edge) => edge.source_object_id === parentObjectId || childIds.includes(edge.source_object_id) || childIds.includes(edge.target_object_id));
          let processedChildren = 0;
          let failedChildrenCount = 0;
          onProgress?.({
            stage: "ablation_analysis",
            completed: completedParents,
            total,
            failed: failedParentsCount,
            current_parent_object_id: parent.object_id,
            current_parent_object_name: parent.object_name,
            processed_child_count: 0,
            total_child_count: children.length,
            message: `最终阶段正在分析父节点 ${parent.object_name}，已完成 0 / ${children.length} 个子节点。`,
          });
          const childConcurrency = Math.max(1, Math.min(children.length || 1, this.ablationChildConcurrency));
          const childAnalyses = await mapWithConcurrency(
            children,
            childConcurrency,
            async (child) => {
              throwIfWorkflowV2Aborted(options?.signal);
              onProgress?.({
                stage: "ablation_analysis",
                completed: completedParents,
                total,
                failed: failedParentsCount,
                current_parent_object_id: parent.object_id,
                current_parent_object_name: parent.object_name,
                current_child_object_id: child.object_id,
                current_child_object_name: child.object_name,
                processed_child_count: processedChildren,
                total_child_count: children.length,
                message: `最终阶段正在分析父节点 ${parent.object_name} 的子节点 ${child.object_name}，当前已完成 ${processedChildren} / ${children.length} 个子节点。`,
              });
              const siblings = children.filter((item) => item.object_id !== child.object_id);
              const siblingImpacts = [];
              const childFailures = [];
              if (siblings.length > 0) {
                try {
                  const siblingPrompt = buildSiblingAblationPrompt(parent, child, siblings, localEdges);
                  const siblingResult = await this.invokeStageJson({
                    stage: "ablation_analysis",
                    instruction: siblingPrompt.instruction,
                    payload: siblingPrompt.payload,
                    responseSchema: siblingPrompt.responseSchema,
                    signal: options?.signal,
                  });
                  const siblingPayload = asRecord(siblingResult.data);
                  const impacts = Array.isArray(siblingPayload.sibling_impacts) ? siblingPayload.sibling_impacts : [];
                  for (const impact of impacts) {
                    const record = asRecord(impact);
                    siblingImpacts.push({
                      ablated_child_object_id: child.object_id,
                      target_sibling_object_id: asText(record.target_sibling_object_id),
                      impact_level: ["none", "low", "medium", "high"].includes(asText(record.impact_level)) ? asText(record.impact_level) : "low",
                      judgement: asText(record.judgement),
                      reason: asText(record.reason) || "该兄弟影响判断来自局部消融分析。",
                      llm_ensemble: siblingResult.llm_ensemble ?? null,
                    });
                  }
                } catch (error) {
                  throwIfWorkflowV2Aborted(options?.signal);
                  childFailures.push({
                    parent_object_id: parent.object_id,
                    parent_object_name: parent.object_name,
                    child_object_id: child.object_id,
                    child_object_name: child.object_name,
                    step: "sibling_ablation",
                    error: getErrorMessage(error, "sibling ablation failed"),
                    raw_text: getErrorRawText(error),
                    llm_ensemble: error?.stageOutput?.llm_ensemble ?? null,
                    ...getErrorDiagnostics(error),
                  });
                }
              }

              let parentImpact = null;
              try {
                const parentPrompt = buildParentAblationPrompt(parent, child, children, localEdges);
                const parentResult = await this.invokeStageJson({
                  stage: "ablation_analysis",
                  instruction: parentPrompt.instruction,
                  payload: parentPrompt.payload,
                  responseSchema: parentPrompt.responseSchema,
                  signal: options?.signal,
                });
                const parentPayload = asRecord(parentResult.data);
                const impact = asRecord(parentPayload.impact_on_parent);
                parentImpact = {
                  ablated_child_object_id: child.object_id,
                  parent_object_id: asText(impact.parent_object_id) || parent.object_id,
                  importance_level: ["none", "low", "medium", "high", "critical"].includes(asText(impact.importance_level))
                    ? asText(impact.importance_level)
                    : "medium",
                  judgement: asText(impact.judgement),
                  reason: asText(impact.reason) || "该子节点重要性判断来自父节点消融分析。",
                  llm_ensemble: parentResult.llm_ensemble ?? null,
                };
              } catch (error) {
                throwIfWorkflowV2Aborted(options?.signal);
                childFailures.push({
                  parent_object_id: parent.object_id,
                  parent_object_name: parent.object_name,
                  child_object_id: child.object_id,
                  child_object_name: child.object_name,
                  step: "parent_ablation",
                  error: getErrorMessage(error, "parent ablation failed"),
                  raw_text: getErrorRawText(error),
                  llm_ensemble: error?.stageOutput?.llm_ensemble ?? null,
                  ...getErrorDiagnostics(error),
                });
              }

              processedChildren += 1;
              if (childFailures.length > 0) {
                failedChildrenCount += 1;
              }
              onProgress?.({
                stage: "ablation_analysis",
                completed: completedParents,
                total,
                failed: failedParentsCount,
                current_parent_object_id: parent.object_id,
                current_parent_object_name: parent.object_name,
                current_child_object_id: child.object_id,
                current_child_object_name: child.object_name,
                processed_child_count: processedChildren,
                total_child_count: children.length,
                child_failed: childFailures.length > 0,
                message: `最终阶段正在分析父节点 ${parent.object_name}，已完成 ${processedChildren} / ${children.length} 个子节点，失败 ${failedChildrenCount} 个。`,
              });
              return {
                sibling_impacts: siblingImpacts,
                parent_impact: parentImpact,
                child_failures: childFailures,
              };
            },
          );

          const siblingDependencyTable = childAnalyses.flatMap((item) => item?.sibling_impacts ?? []);
          const childImportanceList = childAnalyses
            .map((item) => item?.parent_impact ?? null)
            .filter(Boolean);
          const failedChildAnalyses = childAnalyses.flatMap((item) => item?.child_failures ?? []);

          const summary = {
            parent_object_id: parent.object_id,
            parent_object_name: parent.object_name,
            sibling_dependency_table: siblingDependencyTable,
            child_importance_list: childImportanceList,
            failed_child_analyses: failedChildAnalyses,
            reason: failedChildAnalyses.length > 0
              ? "该摘要聚合了该父对象全部直接子节点的兄弟影响分析与父级重要性分析；失败子任务已跳过。"
              : "该摘要聚合了该父对象全部直接子节点的兄弟影响分析与父级重要性分析。",
          };

          completedParents += 1;
          onProgress?.({
            stage: "ablation_analysis",
            completed: completedParents,
            total,
            failed: failedParentsCount,
            parent_object_id: parent.object_id,
            parent_object_name: parent.object_name,
            message: `最终阶段已完成 ${completedParents} / ${total} 个父节点的消融分析。`,
          });
          return {
            summary,
            failed_parent: null,
          };
        } catch (error) {
          throwIfWorkflowV2Aborted(options?.signal);
          completedParents += 1;
          failedParentsCount += 1;
          onProgress?.({
            stage: "ablation_analysis",
            completed: completedParents,
            total,
            failed: failedParentsCount,
            parent_object_id: parent.object_id,
            parent_object_name: parent.object_name,
            skipped: true,
            message: `最终阶段已完成 ${completedParents} / ${total} 个父节点的消融分析，失败 ${failedParentsCount} 个。`,
          });
          return {
            summary: null,
            failed_parent: {
              parent_object_id: parent.object_id,
              parent_object_name: parent.object_name,
              error: getErrorMessage(error, "ablation parent analysis failed"),
              raw_text: getErrorRawText(error),
              llm_ensemble: error?.stageOutput?.llm_ensemble ?? null,
              ...getErrorDiagnostics(error),
            },
          };
        }
      },
    );

    const successfulParentSummaries = parentSummaries
      .map((item) => item?.summary ?? null)
      .filter(Boolean);
    const failedParentAnalyses = parentSummaries
      .map((item) => item?.failed_parent ?? null)
      .filter(Boolean);

    return {
      parent_summaries: successfulParentSummaries,
      failed_parent_analyses: failedParentAnalyses,
      total_parent_summaries: successfulParentSummaries.length,
      progress: {
        completed: successfulParentSummaries.length + failedParentAnalyses.length,
        total,
        failed: failedParentAnalyses.length,
      },
      reason: failedParentAnalyses.length > 0
        ? "已尽量对所有有直接子节点的父对象完成消融分析；失败父节点已跳过并保留其余成果。"
        : "已对所有有直接子节点的父对象完成消融分析。",
    };
  }

  async runFileWorkflow(input) {
    await this.refreshWorkflowConfigFromResolver();
    const conversationId = asText(input?.conversationId) || "file-workflow-v2";
    const projectId = asText(input?.projectId) || "demo";
    const fileName = asText(input?.fileName) || "upload.txt";
    const mimeType = asText(input?.mimeType) || "text/plain";
    const handlers = input?.handlers && typeof input.handlers === "object" ? input.handlers : {};
    const runtimeRoot = await this.ensureConversationRuntime(conversationId);
    const releaseLock = await this.acquireProjectWorkflowLock(projectId);
    const startedAt = new Date().toISOString();
    const stageResults = this.buildInitialStageResults();
    const errors = [];

      let state = {
        document: null,
        chunks: [],
        filtered_chunks: [],
        windows: [],
        window_results: [],
        fused_objects: [],
        function_objects: [],
        decomposition_results: [],
        edges: [],
        removed_cycle_edges: [],
        parent_summaries: [],
      };

    try {
      let rawText = "";
      let inputFile = {
        originalName: fileName,
        storedName: fileName,
        size: 0,
        path: runtimeRoot,
        mimeType,
      };

      if (input.resumeSnapshot) {
        const snapshot = asRecord(input.resumeSnapshot);
        state = {
          ...state,
          ...asRecord(snapshot.state),
        };
        const previousResults = Array.isArray(snapshot.stage_results) ? snapshot.stage_results : [];
        for (let index = 0; index < stageResults.length; index += 1) {
          if (previousResults[index]) {
            stageResults[index] = previousResults[index];
          }
        }
        rawText = asText(snapshot?.state?.document?.raw_text);
        inputFile = {
          ...inputFile,
          ...asRecord(snapshot.input_file),
        };
      } else {
        const content = Buffer.isBuffer(input?.content) ? input.content : Buffer.from([]);
        rawText = content.toString("utf8").replace(/\u0000/g, "");
        inputFile.size = content.byteLength;
        const uploadDir = path.join(runtimeRoot, "uploads");
        await mkdir(uploadDir, { recursive: true });
        const uploadPath = path.join(uploadDir, fileName.replace(/[\\/]+/g, "_"));
        await writeFile(uploadPath, content);
        inputFile.path = uploadPath;
      }

      state.document = state.document || createDocumentRecord({
        conversationId,
        fileName,
        projectId,
        rawText,
      });

      const stageStartIndex = asInteger(input.resumeFromStageIndex, 0, 0);

      const runStage = async (stageKey, executor, applyOutput = () => {}) => {
        throwIfWorkflowV2Aborted(input?.signal);
        const stageIndex = WORKFLOW_V2_STAGE_KEYS.indexOf(stageKey);
        const previous = stageResults[stageIndex];
        stageResults[stageIndex] = makeStageResult(stageKey, stageIndex + 1, "running", previous?.output ?? null, null, previous);
        handlers.onStatus?.({
          stage: stageKey,
          message: `正在执行 ${stageKey}`,
        });
        handlers.onStageUpdate?.(stageResults[stageIndex]);
        try {
          const output = await executor();
          throwIfWorkflowV2Aborted(input?.signal);
          applyOutput(output);
          stageResults[stageIndex] = makeStageResult(stageKey, stageIndex + 1, "success", output, null, stageResults[stageIndex]);
          handlers.onStageUpdate?.(stageResults[stageIndex]);
          await this.writeWorkflowSnapshot(conversationId, {
            input_file: inputFile,
            stage_results: stageResults,
            state,
          });
          return output;
        } catch (error) {
          const message = error instanceof Error ? error.message : "workflow V2 stage failed";
          const currentStage = stageResults[stageIndex];
          if (currentStage?.status === "running") {
            stageResults[stageIndex] = makeStageResult(
              stageKey,
              stageIndex + 1,
              "failed",
              mergeFailedStageOutput(currentStage.output, error),
              message,
              currentStage,
            );
            handlers.onStageUpdate?.(stageResults[stageIndex]);
          }
          try {
            await this.writeWorkflowSnapshot(conversationId, {
              input_file: inputFile,
              stage_results: stageResults,
              state,
            });
          } catch {
            // ignore snapshot write failure during stage error handling
          }
          throw error;
        }
      };

      if (stageStartIndex <= 0) {
        await runStage("chunk_parse", async () => this.chunkParseStage(state.document), (output) => {
          state.chunks = output.chunks;
        });
      }
      if (stageStartIndex <= 1) {
        await runStage("chunk_filter", async () => this.chunkFilterStage(state.document, state.chunks, {
          signal: input?.signal,
        }), (output) => {
          state.filtered_chunks = Array.isArray(output.selected_chunks) ? output.selected_chunks : state.chunks;
        });
      }
      if (stageStartIndex <= 2) {
        await runStage("window_extract", async () => this.windowExtractStage(
          state.document,
          Array.isArray(state.filtered_chunks) && state.filtered_chunks.length > 0 ? state.filtered_chunks : state.chunks,
          {
            signal: input?.signal,
            onProgress: (progressPayload) => handlers.onStatus?.(progressPayload),
          },
        ), (output) => {
          state.windows = output.windows;
          state.window_results = output.window_results;
        });
      }
      if (stageStartIndex <= 3) {
        await runStage("object_fusion", async () => this.objectFusionStage(state.window_results, {
          signal: input?.signal,
          chunks: Array.isArray(state.filtered_chunks) && state.filtered_chunks.length > 0 ? state.filtered_chunks : state.chunks,
        }), (output) => {
          state.fused_objects = output.fused_objects;
        });
      }
      if (stageStartIndex <= 4) {
        await runStage("granularity_align", async () => this.granularityAlignStage(state.fused_objects, {
          signal: input?.signal,
          llmClient: this.llmClient,
          options: input?.options,
        }), (output) => {
          const alignedObjects = Array.isArray(output.fused_objects)
            ? output.fused_objects
            : Array.isArray(output.aligned_objects)
              ? output.aligned_objects
              : Array.isArray(output.objects)
                ? output.objects
                : state.fused_objects;
          state.fused_objects = Array.isArray(alignedObjects)
            ? alignedObjects.map((object) => ({
              ...object,
              object_level: normalizeObjectLevel(object?.object_level),
            }))
            : state.fused_objects;
        });
      }
      if (stageStartIndex <= 5) {
        await runStage("function_analysis", async () => this.functionAnalysisStage(state.fused_objects, {
          signal: input?.signal,
          onProgress: (progressPayload) => handlers.onStatus?.(progressPayload),
        }), (output) => {
          state.function_objects = output.function_objects;
          state.fused_objects = output.updated_objects;
        });
      }
      if (stageStartIndex <= 6) {
        await runStage("object_decompose", async () => this.objectDecomposeStage(state.fused_objects, {
          signal: input?.signal,
          onProgress: (progressPayload) => handlers.onStatus?.(progressPayload),
        }), (output) => {
          state.decomposition_results = output.decomposition_results;
        });
      }
      if (stageStartIndex <= 7) {
        await runStage("graph_build", async () => this.graphBuildStage(state.fused_objects, state.decomposition_results, {
          signal: input?.signal,
        }), (output) => {
          state.fused_objects = Array.isArray(output.objects) ? output.objects : state.fused_objects;
          state.edges = output.edges;
          state.removed_cycle_edges = output.removed_cycle_edges;
        });
      }
      if (stageStartIndex <= 8) {
        await runStage("ablation_analysis", async () => this.ablationAnalysisStage(state.fused_objects, state.edges, {
          signal: input?.signal,
          onProgress: (progressPayload) => handlers.onStatus?.(progressPayload),
        }), (output) => {
          state.parent_summaries = output.parent_summaries;
        });
      }

      const result = {
        ...buildWorkflowV2ResultFromState(state),
        reason: "已完成文档分块、预筛 chunk、对象抽取、对象融合、粒度对齐、核心功能分析、拆解建图与消融分析的全流程。",
      };
      const finishedAt = new Date().toISOString();
      await this.writeWorkflowSnapshot(conversationId, {
        input_file: inputFile,
        stage_results: stageResults,
        state,
        result,
      });
      return createV2ResponseEnvelope({
        ok: true,
        stageResults,
        errors,
        runtimeRoot,
        inputFile,
        result,
        startedAt,
        finishedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "workflow V2 failed";
      const failedStageIndex = stageResults.findIndex((item) => item.status === "running");
      if (failedStageIndex !== -1) {
        const current = stageResults[failedStageIndex];
        stageResults[failedStageIndex] = makeStageResult(
          current.stage,
          current.order,
          "failed",
          mergeFailedStageOutput(current.output, error),
          message,
          current,
        );
        handlers.onStageUpdate?.(stageResults[failedStageIndex]);
        errors.push({
          stage: current.stage,
          message,
        });
      } else {
        const latestFailedIndex = [...stageResults]
          .map((item, index) => ({ item, index }))
          .reverse()
          .find(({ item }) => item.status === "failed")?.index ?? -1;
        if (latestFailedIndex !== -1) {
          errors.push({
            stage: stageResults[latestFailedIndex].stage,
            message,
          });
        } else {
          errors.push({
            stage: "request",
            message,
          });
        }
      }
      try {
        await this.writeWorkflowSnapshot(conversationId, {
          input_file: inputFile,
          stage_results: stageResults,
          state,
        });
      } catch {
        // ignore snapshot write failure during error handling
      }
      return createV2ResponseEnvelope({
        ok: false,
        stageResults,
        errors,
        runtimeRoot,
        inputFile: {
          originalName: fileName,
          storedName: fileName,
          size: Buffer.isBuffer(input?.content) ? input.content.byteLength : 0,
          path: runtimeRoot,
          mimeType,
        },
        result: {
          ...buildWorkflowV2ResultFromState(state),
          reason: "工作流在中途失败，当前结果只包含已完成阶段的部分产物。",
        },
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    } finally {
      await releaseLock();
    }
  }
}
