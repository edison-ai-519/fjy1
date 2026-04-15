const EXECUTION_STAGE_LABELS = Object.freeze({
  thinking: "思考中...",
  executing: "执行中...",
  reasoning: "推理中...",
  observing: "观察中...",
  interrupted: "执行中断...",
  failed: "执行失败...",
  completed: "执行结束...",
});

const VALID_EXECUTION_STAGE_STATUSES = new Set(Object.keys(EXECUTION_STAGE_LABELS));
const DEFAULT_REQUEST_TIMEOUT_MS = 3_000;

function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function inferStatusFromText(detail, fallback = "thinking") {
  const normalized = asTrimmedString(detail).toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (
    normalized.includes("中断")
    || normalized.includes("abort")
    || normalized.includes("cancel")
    || normalized.includes("timeout")
    || normalized.includes("超时")
  ) {
    return "interrupted";
  }

  if (
    normalized.includes("失败")
    || normalized.includes("error")
    || normalized.includes("exception")
    || normalized.includes("stderr")
  ) {
    return "failed";
  }

  if (
    normalized.includes("观察")
    || normalized.includes("读取输出")
    || normalized.includes("查看结果")
    || normalized.includes("scan result")
  ) {
    return "observing";
  }

  if (
    normalized.includes("推理")
    || normalized.includes("回答")
    || normalized.includes("答案")
    || normalized.includes("reason")
  ) {
    return "reasoning";
  }

  if (
    normalized.includes("执行")
    || normalized.includes("运行")
    || normalized.includes("tool")
    || normalized.includes("shell")
    || normalized.includes("command")
  ) {
    return "executing";
  }

  if (
    normalized.includes("完成")
    || normalized.includes("结束")
    || normalized.includes("done")
    || normalized.includes("complete")
  ) {
    return "completed";
  }

  return fallback;
}

function normalizeSemanticStatus(value) {
  const normalized = asTrimmedString(value)
    .toLowerCase()
    .replace(/[`"'{}\[\]\s]/g, "");

  if (!normalized) {
    return null;
  }

  if (VALID_EXECUTION_STAGE_STATUSES.has(normalized)) {
    return normalized;
  }

  return inferStatusFromText(normalized, null);
}

function extractLlmContent(payload) {
  const choice = payload?.choices?.[0]?.message?.content;
  if (typeof choice === "string") {
    return choice;
  }

  if (Array.isArray(choice)) {
    return choice
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function classifyCommandCompletedResult(result) {
  const status = asTrimmedString(result?.status).toLowerCase();

  if (status === "success") {
    return "completed";
  }

  if (
    status === "cancelled"
    || status === "rejected"
    || status === "timeout"
  ) {
    return "interrupted";
  }

  if (status) {
    return "failed";
  }

  if (typeof result?.exitCode === "number" && result.exitCode === 0) {
    return "completed";
  }

  return "failed";
}

export function getExecutionStageLabel(status) {
  return EXECUTION_STAGE_LABELS[status] || EXECUTION_STAGE_LABELS.thinking;
}

export function classifyExecutionStageFallback(input) {
  const type = asTrimmedString(input?.type);
  const payload = input?.payload && typeof input.payload === "object" ? input.payload : {};

  if (type === "request.started") {
    return "thinking";
  }

  if (type === "status.changed") {
    return inferStatusFromText(payload.detail, "thinking");
  }

  if (type === "tool.started") {
    return "executing";
  }

  if (type === "tool.output.delta") {
    return "observing";
  }

  if (type === "assistant.delta" || type === "assistant.completed") {
    return "reasoning";
  }

  if (type === "runtime.error") {
    return "failed";
  }

  if (type === "runtime.aborted") {
    return "interrupted";
  }

  if (type === "command.completed") {
    return classifyCommandCompletedResult(payload.result);
  }

  if (type === "tool.finished") {
    return classifyCommandCompletedResult(payload.result);
  }

  return inferStatusFromText(
    payload.detail
      || payload.message
      || payload.reason
      || payload.command,
    "thinking",
  );
}

function buildUserPrompt(input) {
  const payload = input?.payload && typeof input.payload === "object" ? input.payload : {};
  const snapshot = {
    eventType: input?.type || "",
    currentSemanticStatus: input?.currentSemanticStatus || null,
    detail: asTrimmedString(payload.detail) || null,
    message: asTrimmedString(payload.message) || null,
    reason: asTrimmedString(payload.reason) || null,
    command: asTrimmedString(payload.command)
      || asTrimmedString(payload?.toolCall?.input?.command)
      || asTrimmedString(payload?.result?.command)
      || null,
    stream: asTrimmedString(payload.stream) || null,
    status: asTrimmedString(payload.status)
      || asTrimmedString(payload?.result?.status)
      || null,
    delta: asTrimmedString(payload.delta).slice(0, 120) || null,
    chunk: asTrimmedString(payload.chunk).slice(0, 120) || null,
  };

  return JSON.stringify(snapshot);
}

export class ExecutionStageClassifierService {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
    this.requestTimeoutMs = Number.isFinite(Number(options.requestTimeoutMs))
      ? Number(options.requestTimeoutMs)
      : DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async classify(input) {
    const fallbackStatus = classifyExecutionStageFallback(input);
    const fallbackResult = {
      semanticStatus: fallbackStatus,
      label: getExecutionStageLabel(fallbackStatus),
      via: "fallback",
    };

    if (!this.canUseLlm(input?.modelConfig)) {
      return fallbackResult;
    }

    try {
      const llmStatus = await this.classifyWithLlm(input);
      const normalized = normalizeSemanticStatus(llmStatus);
      if (!normalized) {
        return fallbackResult;
      }

      return {
        semanticStatus: normalized,
        label: getExecutionStageLabel(normalized),
        via: "llm",
      };
    } catch {
      return fallbackResult;
    }
  }

  canUseLlm(modelConfig) {
    return Boolean(
      this.fetchImpl
      && asTrimmedString(modelConfig?.apiKey)
      && asTrimmedString(modelConfig?.baseUrl)
      && asTrimmedString(modelConfig?.modelName),
    );
  }

  async classifyWithLlm(input) {
    const modelConfig = input.modelConfig;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await this.fetchImpl(
        `${modelConfig.baseUrl.replace(/\/+$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${modelConfig.apiKey}`,
          },
          body: JSON.stringify({
            model: modelConfig.modelName,
            temperature: 0,
            max_tokens: 8,
            messages: [
              {
                role: "system",
                content: [
                  "你是运行事件分类器。",
                  "只允许从以下枚举中返回一个英文 code：thinking, executing, reasoning, observing, interrupted, failed, completed。",
                  "禁止返回解释、标点、JSON、额外文本。",
                ].join(" "),
              },
              {
                role: "user",
                content: buildUserPrompt(input),
              },
            ],
          }),
          signal: controller.signal,
        },
      );

      if (!response?.ok) {
        throw new Error(`Classifier request failed with status ${response?.status ?? "unknown"}`);
      }

      const payload = await response.json();
      return extractLlmContent(payload);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
