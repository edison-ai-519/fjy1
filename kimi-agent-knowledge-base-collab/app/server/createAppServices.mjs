import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { JsonKnowledgeBaseRepository } from "./repositories/jsonKnowledgeBaseRepository.mjs";
import { DatabaseKnowledgeBaseRepository } from "./repositories/databaseKnowledgeBaseRepository.mjs";
import { WikiMGKnowledgeBaseRepository } from "./repositories/wikiMGKnowledgeBaseRepository.mjs";
import { KnowledgeBaseService } from "./services/knowledgeBaseService.mjs";
import { AssistantSessionStateService } from "./services/assistantSessionStateService.mjs";
import { ConversationGraphStateService } from "./services/conversationGraphStateService.mjs";
import { OntoGitLocalCommitService } from "./services/ontoGitLocalCommitService.mjs";
import { LinearWorkflowService } from "./services/linearWorkflowService.mjs";
import { WikiWorkspaceWriterService } from "./services/wikiWorkspaceWriterService.mjs";
import { ensureKnowledgeDataWorkspace, resolveKnowledgeDataPaths } from "./knowledgeDataPaths.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(appRoot, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const workflowRuntimeRoot = path.join(projectRoot, ".workflow-runtime");
const defaultWikiMGRoot = path.resolve(workspaceRoot, "Ontology_Factory");

export function createAppServices() {
  const repositoryMode = process.env.KNOWLEDGE_BASE_PROVIDER || "json";
  const knowledgeDataPaths = resolveKnowledgeDataPaths({
    workspaceRoot,
    env: process.env,
    defaultWikiMGCodeRoot: defaultWikiMGRoot,
  });
  ensureKnowledgeDataWorkspace(knowledgeDataPaths);

  let repository;

  if (repositoryMode === "database") {
    repository = new DatabaseKnowledgeBaseRepository({
      databaseUrl: process.env.DATABASE_URL,
    });
  } else if (repositoryMode === "wikimg") {
    repository = new WikiMGKnowledgeBaseRepository({
      workspaceRoot: knowledgeDataPaths.wikimgWorkspaceRoot,
      sourceWorkspaceRoot: knowledgeDataPaths.wikimgCodeRoot,
      profile: process.env.WIKIMG_PROFILE || "kimi",
      wikimgScriptPath: knowledgeDataPaths.wikimgScriptPath,
      pythonBin: process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3"),
      ontoGitStorageRoot: knowledgeDataPaths.ontoGitStorageRoot,
    });
  } else {
    repository = new JsonKnowledgeBaseRepository({
      dataRoot: path.join(appRoot, "public", "data"),
      dbFilePath: path.join(appRoot, "data", "knowledge-base-db.json"),
    });
  }

  const ontoGitCommitService = new OntoGitLocalCommitService({
    storageRoot: knowledgeDataPaths.ontoGitStorageRoot,
  });
  const wikiWorkspaceWriter = new WikiWorkspaceWriterService({
    docsRoot: knowledgeDataPaths.wikiDocsRoot,
  });

  return {
    knowledgeBaseService: new KnowledgeBaseService(repository, {
      projectId: process.env.ONTOGIT_PROJECT_ID || "demo",
      sourceCommitter: ({ projectId, filename, data, message, agentName, committerName }) => (
        ontoGitCommitService.writeVersion({
          projectId,
          filename,
          data,
          message,
          agentName,
          committerName,
        })
      ),
      wikiWriter: ({ layer, slug, markdown }) => (
        wikiWorkspaceWriter.writeDocument({ layer, slug, markdown })
      ),
    }),
    assistantSessionStateService: new AssistantSessionStateService({
      runtimeRoot: workflowRuntimeRoot,
    }),
    conversationGraphStateService: new ConversationGraphStateService({
      runtimeRoot: workflowRuntimeRoot,
    }),
    localWorkspaceService: ontoGitCommitService,
    workflowService: new LinearWorkflowService({
      runtimeRoot: workflowRuntimeRoot,
      gatewayBaseUrl: process.env.XG_GATEWAY_URL || process.env.GATEWAY_URL || "http://127.0.0.1:8080",
      gatewayApiKey: process.env.XG_GATEWAY_API_KEY || process.env.GATEWAY_SERVICE_API_KEY || "",
      workflowTimeoutMs: Number(process.env.WORKFLOW_TIMEOUT_MS || 120000),
      workflowLlmBaseUrl: process.env.WORKFLOW_LLM_BASE_URL || process.env.DMXAPI_BASE_URL || "",
      workflowLlmApiKey: process.env.WORKFLOW_LLM_API_KEY || process.env.DMXAPI_API_KEY || "",
      workflowModel: process.env.WORKFLOW_MODEL || process.env.DMXAPI_MODEL || "gpt-5.4",
    }),
    appRoot,
  };
}
