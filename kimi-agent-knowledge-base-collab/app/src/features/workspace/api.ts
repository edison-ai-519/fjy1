import {
  normalizeXgProjectsResponse,
  normalizeXgReadResponse,
  normalizeXgTimelinesResponse,
  normalizeXgWriteResult,
  type XgProject,
  type XgTimeline,
  type XgWriteResult,
} from '@/lib/xgApi';
import { apiFetch, clearStoredAccessToken, parseJson, setStoredAccessToken } from '@/shared/api/http';
import { notifyRepositorySync } from '@/shared/events/repositorySync';
import { validateWorkflowEntityFileData } from '@/features/workspace/workflowEntityFormat';

export type { XgProject, XgTimeline, XgTimelineCommit, XgWriteResult } from '@/lib/xgApi';

function encodePathSegments(value: string): string {
  return value
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export interface ProbabilityResult {
  probability: number;
  reason: string;
}

export interface WorkflowConfig {
  workflowModel: string;
}

export async function fetchXgProjects(): Promise<XgProject[]> {
  const response = await apiFetch('/api/xg/projects');
  return normalizeXgProjectsResponse(await parseJson<unknown>(response));
}

export async function fetchXgRead(projectId: string, filename: string, commitId?: string): Promise<unknown> {
  const response = await apiFetch(`/api/xg/read/${encodeURIComponent(projectId)}/${encodePathSegments(filename)}${commitId ? `?commit_id=${commitId}` : ''}`);
  return normalizeXgReadResponse(await parseJson<unknown>(response));
}

export async function fetchXgTimelines(projectId: string): Promise<XgTimeline[]> {
  const response = await apiFetch(`/api/xg/timelines/${encodeURIComponent(projectId)}`);
  return normalizeXgTimelinesResponse(await parseJson<unknown>(response));
}

export async function writeXgAndInfer(input: {
  project_id: string;
  filename: string;
  data: unknown;
  message: string;
  agent_name?: string;
  committer_name?: string;
  basevision: number;
  inference_message?: string;
  inference_agent_name?: string;
  inference_committer_name?: string;
}): Promise<XgWriteResult> {
  const validation = validateWorkflowEntityFileData(input.data);
  if (!validation.ok) {
    throw new Error(`写入拦截：仅支持标准工作流实体 JSON。${validation.error}`);
  }

  const response = await apiFetch('/api/xg/write-and-infer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const result = normalizeXgWriteResult(await parseJson<unknown>(response));
  notifyRepositorySync({ projectId: input.project_id, filename: input.filename, source: 'writeXgAndInfer' });
  return result;
}

export async function fetchProbabilityReason(concept: unknown): Promise<ProbabilityResult> {
  const response = await apiFetch('/api/probability/api/llm/probability-reason', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(concept),
  });
  return parseJson<ProbabilityResult>(response);
}

export async function fetchWorkflowConfig(): Promise<WorkflowConfig> {
  const response = await apiFetch('/api/workflow/config');
  return parseJson<WorkflowConfig>(response);
}

export async function updateWorkflowConfig(workflowModel: string): Promise<WorkflowConfig> {
  const response = await apiFetch('/api/workflow/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowModel }),
  });
  return parseJson<WorkflowConfig>(response);
}

export async function rollbackXgVersion(projectId: string, commitId: string): Promise<unknown> {
  const params = new URLSearchParams({ project_id: projectId, commit_id: commitId });
  const response = await apiFetch(`/api/xg/rollback?${params.toString()}`, {
    method: 'POST',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({} as { detail?: string }));
    throw new Error(errorData.detail || `Rollback failed with status ${response.status}`);
  }

  return response.json();
}

export async function fetchXgDiff(projectId: string, filename: string, base: string, target: string): Promise<unknown> {
  const params = new URLSearchParams({ project_id: projectId, filename, base, target });
  const response = await apiFetch(`/api/xg/diff?${params.toString()}`);
  return parseJson(response);
}

export async function initXgProject(projectData: { project_id: string; name?: string; description?: string }): Promise<unknown> {
  const response = await apiFetch('/api/xg/projects/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(projectData),
  });
  return parseJson(response);
}

export async function updateXgProjectName(projectId: string, name: string): Promise<unknown> {
  const response = await apiFetch(`/api/xg/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return parseJson(response);
}

export async function setOfficialRecommend(projectId: string, filename: string, versionId: string): Promise<unknown> {
  const response = await apiFetch('/api/xg/version-recommend/official/set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, filename, version_id: versionId }),
  });
  return parseJson(response);
}

export interface RouteDoc {
  name: string;
  method: string;
  path: string;
  module: string;
  auth: string;
  description: string;
}

export async function fetchRoutes(): Promise<RouteDoc[]> {
  const response = await apiFetch('/api/routes');
  return parseJson<RouteDoc[]>(response);
}

export interface HealthStatus {
  status: string;
  modules: Record<string, string>;
}

export async function fetchHealth(): Promise<HealthStatus> {
  const response = await apiFetch('/health');
  return parseJson<HealthStatus>(response);
}

// --- New Auth Endpoints ---

export async function login(username: string, password: string): Promise<{ access_token: string }> {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const payload = await parseJson<{ access_token: string }>(response);
  if (payload.access_token) {
    setStoredAccessToken(payload.access_token);
  }
  return payload;
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } finally {
    clearStoredAccessToken();
  }
}

// --- New Admin & Advanced Endpoints ---

export async function deleteXgProject(projectId: string): Promise<unknown> {
  const response = await apiFetch(`/api/xg/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  });
  return parseJson(response);
}
