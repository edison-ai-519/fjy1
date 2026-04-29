import assert from "node:assert/strict";
import test from "node:test";

import { createAppServices } from "../createAppServices.mjs";

const WORKFLOW_ENV_NAMES = [
  "WORKFLOW_LLM_API_KEY",
  "WORKFLOW_LLM_BASE_URL",
  "WORKFLOW_MODEL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "OPENROUTER_MODEL",
  "DMXAPI_API_KEY",
  "DMXAPI_BASE_URL",
  "DMXAPI_MODEL",
];

function withClearedEnv(names, callback) {
  const snapshot = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) {
    delete process.env[name];
  }

  try {
    return callback();
  } finally {
    for (const [name, value] of snapshot.entries()) {
      if (typeof value === "string") {
        process.env[name] = value;
      } else {
        delete process.env[name];
      }
    }
  }
}

test("createAppServices 使用 Windows 全局环境变量补齐 workflow LLM 配置", () => {
  withClearedEnv(WORKFLOW_ENV_NAMES, () => {
    const services = createAppServices({
      windowsEnvReader: () => ({
        WORKFLOW_LLM_API_KEY: "global-workflow-key",
        WORKFLOW_LLM_BASE_URL: "https://example.com/api/v1",
        WORKFLOW_MODEL: "openai/gpt-4.1-mini",
      }),
    });

    assert.equal(services.workflowService.workflowLlmApiKey, "global-workflow-key");
    assert.equal(services.workflowService.workflowLlmBaseUrl, "https://example.com/api/v1");
    assert.equal(services.workflowService.workflowModel, "openai/gpt-4.1-mini");
  });
});

test("createAppServices 使用 .agent/config.json 补齐 workflow LLM key", () => {
  withClearedEnv(WORKFLOW_ENV_NAMES, () => {
    const services = createAppServices({
      windowsEnvReader: () => ({}),
      agentConfigReader: () => ({
        model: {
          apiKey: "agent-config-key",
        },
      }),
    });

    assert.equal(services.workflowService.workflowLlmApiKey, "agent-config-key");
    assert.equal(services.workflowService.workflowLlmBaseUrl, "https://openrouter.ai/api/v1");
    assert.equal(services.workflowService.workflowModel, "openai/gpt-4o-mini");
  });
});
