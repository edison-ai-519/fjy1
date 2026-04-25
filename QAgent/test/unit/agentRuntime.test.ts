import path from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";

import { buildShellSessionEnvironment } from "../../src/runtime/agentRuntime.js";
import type { RuntimeConfig } from "../../src/types.js";

function buildTempRuntimeConfig(): RuntimeConfig {
  const projectDir = path.join(process.cwd(), ".tmp-qagent-runtime-test");
  return {
    cwd: projectDir,
    resolvedPaths: {
      cwd: projectDir,
      homeDir: projectDir,
      globalAgentDir: path.join(projectDir, ".global"),
      projectRoot: projectDir,
      projectAgentDir: path.join(projectDir, ".agent"),
      globalConfigPath: path.join(projectDir, ".global", "config.json"),
      projectConfigPath: path.join(projectDir, ".agent", "config.json"),
      globalMemoryDir: path.join(projectDir, ".global", "memory"),
      projectMemoryDir: path.join(projectDir, ".agent", "memory"),
      globalSkillsDir: path.join(projectDir, ".global", "skills"),
      projectSkillsDir: path.join(projectDir, ".agent", "skills"),
      sessionRoot: path.join(projectDir, ".agent", "sessions"),
    },
    model: {
      provider: "openrouter",
      baseUrl: "https://openrouter.example/v1",
      apiKey: "config-api-key",
      model: "config-model",
      temperature: 0,
      appName: "QAgent Test",
      appUrl: "https://example.com/qagent",
    },
    runtime: {
      maxAgentSteps: 4,
      fetchMemoryMaxAgentSteps: 3,
      autoMemoryForkMaxAgentSteps: 4,
      shellCommandTimeoutMs: 10_000,
      maxToolOutputChars: 2_000,
      maxConversationSummaryMessages: 10,
      autoCompactThresholdTokens: 120_000,
      compactRecentKeepGroups: 8,
    },
    tool: {
      approvalMode: "always",
      shellExecutable: "powershell.exe",
    },
    gateway: {
      transportMode: "local",
    },
    edge: {
      bindHost: "127.0.0.1",
      port: 0,
    },
    cli: {},
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildShellSessionEnvironment", () => {
  it("会把 OpenRouter 配置注入到 shell 环境中", () => {
    const config = buildTempRuntimeConfig();
    const environment = buildShellSessionEnvironment(config, {
      OPENROUTER_API_KEY: "policy-api-key",
      CUSTOM_FLAG: "from-policy",
    });

    expect(environment.OPENROUTER_API_KEY).toBe("config-api-key");
    expect(environment.OPENROUTER_MODEL).toBe("config-model");
    expect(environment.OPENROUTER_BASE_URL).toBe("https://openrouter.example/v1");
    expect(environment.OPENROUTER_APP_NAME).toBe("QAgent Test");
    expect(environment.OPENROUTER_SITE_URL).toBe("https://example.com/qagent");
    expect(environment.QAGENT_PROVIDER).toBe("openrouter");
    expect(environment.QAGENT_MODEL_PROVIDER).toBe("openrouter");
    expect(environment.QAGENT_API_KEY).toBe("config-api-key");
    expect(environment.QAGENT_MODEL).toBe("config-model");
    expect(environment.QAGENT_BASE_URL).toBe("https://openrouter.example/v1");
    expect(environment.QAGENT_APP_NAME).toBe("QAgent Test");
    expect(environment.QAGENT_APP_URL).toBe("https://example.com/qagent");
    expect(environment.CUSTOM_FLAG).toBe("from-policy");
  });

  it("会把 OpenAI 配置映射到通用环境变量和 OpenAI 兼容变量", () => {
    const config = buildTempRuntimeConfig();
    config.model.provider = "openai";
    config.model.apiKey = "openai-key";
    config.model.model = "openai-model";
    config.model.baseUrl = "https://openai.example/v1";

    const environment = buildShellSessionEnvironment(config, {
      OPENROUTER_API_KEY: "policy-api-key",
      OPENROUTER_MODEL: "policy-model",
    });

    expect(environment.QAGENT_PROVIDER).toBe("openai");
    expect(environment.QAGENT_MODEL_PROVIDER).toBe("openai");
    expect(environment.QAGENT_API_KEY).toBe("openai-key");
    expect(environment.QAGENT_MODEL).toBe("openai-model");
    expect(environment.QAGENT_BASE_URL).toBe("https://openai.example/v1");
    expect(environment.OPENAI_API_KEY).toBe("openai-key");
    expect(environment.OPENAI_MODEL).toBe("openai-model");
    expect(environment.OPENAI_BASE_URL).toBe("https://openai.example/v1");
    expect(environment.OPENAI_API_BASE).toBe("https://openai.example/v1");
    expect(environment.OPENROUTER_API_KEY).toBe("policy-api-key");
    expect(environment.OPENROUTER_MODEL).toBe("policy-model");
  });
});
