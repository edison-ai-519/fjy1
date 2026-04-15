import assert from "node:assert/strict";
import test from "node:test";

import { ExecutionStageClassifierService } from "../services/executionStageClassifierService.mjs";

test("ExecutionStageClassifierService normalizes llm output into fixed semantic statuses", async () => {
  const service = new ExecutionStageClassifierService({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "observing",
            },
          },
        ],
      }),
    }),
  });

  const result = await service.classify({
    type: "tool.output.delta",
    payload: {
      stream: "stdout",
      chunk: "hello\n",
    },
    createdAt: "2026-04-15T02:00:00.000Z",
    modelConfig: {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      modelName: "gpt-4.1-mini",
    },
  });

  assert.equal(result.semanticStatus, "observing");
  assert.equal(result.label, "观察中...");
  assert.equal(result.via, "llm");
});

test("ExecutionStageClassifierService falls back when llm output is invalid", async () => {
  const service = new ExecutionStageClassifierService({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "not-a-valid-status",
            },
          },
        ],
      }),
    }),
  });

  const result = await service.classify({
    type: "assistant.delta",
    payload: {
      delta: "正在整理答案",
    },
    createdAt: "2026-04-15T02:00:00.000Z",
    modelConfig: {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      modelName: "gpt-4.1-mini",
    },
  });

  assert.equal(result.semanticStatus, "reasoning");
  assert.equal(result.label, "推理中...");
  assert.equal(result.via, "fallback");
});

test("ExecutionStageClassifierService maps interrupt and failure paths deterministically", async () => {
  const service = new ExecutionStageClassifierService();

  const interrupted = await service.classify({
    type: "runtime.aborted",
    payload: {
      reason: "timeout",
    },
    createdAt: "2026-04-15T02:00:00.000Z",
  });
  const failed = await service.classify({
    type: "runtime.error",
    payload: {
      message: "Shell failed",
    },
    createdAt: "2026-04-15T02:00:01.000Z",
  });
  const completed = await service.classify({
    type: "command.completed",
    payload: {
      result: {
        status: "success",
      },
    },
    createdAt: "2026-04-15T02:00:02.000Z",
  });

  assert.equal(interrupted.semanticStatus, "interrupted");
  assert.equal(interrupted.label, "执行中断...");
  assert.equal(failed.semanticStatus, "failed");
  assert.equal(failed.label, "执行失败...");
  assert.equal(completed.semanticStatus, "completed");
  assert.equal(completed.label, "执行结束...");
});
