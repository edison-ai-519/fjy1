import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { OntoGitKnowledgeBaseRepository } from "./repositories/ontoGitKnowledgeBaseRepository.mjs";
import { KnowledgeBaseService } from "./services/knowledgeBaseService.mjs";
import { AssistantSessionStateService } from "./services/assistantSessionStateService.mjs";
import { ConversationGraphStateService } from "./services/conversationGraphStateService.mjs";
import { LinearWorkflowService } from "./services/linearWorkflowService.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(appRoot, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const workflowRuntimeRoot = path.join(projectRoot, ".workflow-runtime");

export function createAppServices() {
  const ontoGitProjectId = process.env.ONTOGIT_PROJECT_ID || "demo";
  const gatewayBaseUrl = process.env.XG_GATEWAY_URL || process.env.GATEWAY_URL || "http://127.0.0.1:8080";
  const gatewayApiKeyRaw = process.env.XG_GATEWAY_API_KEY || process.env.GATEWAY_SERVICE_API_KEY || "";
  const gatewayApiKey = gatewayApiKeyRaw && gatewayApiKeyRaw !== "change-me" ? gatewayApiKeyRaw : "";
  const authUsername = process.env.ONTOGIT_AUTH_USERNAME || process.env.XG_AUTH_USERNAME || "mogong";
  const authPassword = process.env.ONTOGIT_AUTH_PASSWORD || process.env.XG_AUTH_PASSWORD || "123456";

  const repository = new OntoGitKnowledgeBaseRepository({
    gatewayBaseUrl,
    gatewayApiKey,
    authUsername,
    authPassword,
  });

  return {
    knowledgeBaseService: new KnowledgeBaseService(repository, {
      projectId: ontoGitProjectId,
      sourceCommitter: ({ projectId, filename, data, message, agentName, committerName, basevision, inferenceMessage, inferenceAgentName, inferenceCommitterName }) => (
        repository.writeWorkflowEntity({
          projectId,
          filename,
          data,
          message,
          agentName,
          committerName,
          basevision,
          inferenceMessage,
          inferenceAgentName,
          inferenceCommitterName,
        })
      ),
    }),
    assistantSessionStateService: new AssistantSessionStateService({
      runtimeRoot: workflowRuntimeRoot,
    }),
    conversationGraphStateService: new ConversationGraphStateService({
      runtimeRoot: workflowRuntimeRoot,
    }),
    localWorkspaceService: repository,
    workflowService: new LinearWorkflowService({
      runtimeRoot: workflowRuntimeRoot,
      gatewayBaseUrl: process.env.XG_GATEWAY_URL || process.env.GATEWAY_URL || "http://127.0.0.1:8080",
      gatewayApiKey: process.env.XG_GATEWAY_API_KEY || process.env.GATEWAY_SERVICE_API_KEY || "",
      gatewayAuthUsername: authUsername,
      gatewayAuthPassword: authPassword,
      gatewayLoginInvoker: () => repository.ensureGatewayLogin(true),
      gatewayRequestInvoker: (pathname, options) => repository.requestGatewayJson(pathname, options),
      gatewayWriteInvoker: (pathname, payload, options) => repository.invokeGatewayJson(pathname, payload, options),
      baseVersionLoader: async (projectId) => {
        const timelines = await repository.getJsonFileTimelines(projectId);
        const map = new Map();
        for (const timeline of timelines) {
          const commits = Array.isArray(timeline?.commits) ? timeline.commits : [];
          const latest = commits.at(-1);
          const versionId = Number(latest?.versionId ?? latest?.version_id ?? 0);
          map.set(timeline.filename, Number.isFinite(versionId) && versionId > 0 ? versionId : 0);
        }
        return map;
      },
      workflowTimeoutMs: Number(process.env.WORKFLOW_TIMEOUT_MS || 120000),
      workflowLlmBaseUrl: process.env.WORKFLOW_LLM_BASE_URL || process.env.OPENROUTER_BASE_URL || process.env.DMXAPI_BASE_URL || "https://openrouter.ai/api/v1",
      workflowLlmApiKey: process.env.WORKFLOW_LLM_API_KEY || process.env.OPENROUTER_API_KEY || process.env.DMXAPI_API_KEY || "",
      workflowModel: process.env.WORKFLOW_MODEL || process.env.OPENROUTER_MODEL || process.env.DMXAPI_MODEL || "openai/gpt-4o-mini",
    }),
    appRoot,
  };
}
