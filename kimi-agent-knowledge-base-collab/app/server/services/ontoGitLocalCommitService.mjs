import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_STATUS = "开发中";

function validateProjectId(projectId) {
  const normalized = String(projectId || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new Error("projectId 只能包含字母、数字、下划线和短横线");
  }
  return normalized;
}

function validateFilename(filename) {
  const normalized = path.posix.normalize(String(filename || "").replace(/\\/g, "/"));
  if (!normalized || normalized === "." || normalized === "..") {
    throw new Error("filename 不能为空");
  }
  if (path.isAbsolute(normalized) || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error("filename 非法，禁止路径穿越");
  }
  if (normalized.startsWith(".git")) {
    throw new Error("filename 非法，禁止写入 .git 目录");
  }
  return normalized;
}

function nowTimestamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

async function runGit(cwd, args, { allowFailure = false } = {}) {
  try {
    return await execFileAsync("git", args, {
      cwd,
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    if (allowFailure) {
      return {
        stdout: error.stdout || "",
        stderr: error.stderr || "",
      };
    }
    throw new Error(error.stderr?.trim() || error.stdout?.trim() || "git command failed");
  }
}

async function ensureGitRepo(projectDir) {
  if (existsSync(path.join(projectDir, ".git"))) {
    return;
  }
  await runGit(projectDir, ["init"]);
}

async function readLatestVersionId(projectDir, filename) {
  const result = await runGit(projectDir, ["log", "--format=%B", "-1", "--", filename], { allowFailure: true });
  const lines = String(result.stdout || "").split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith("XG-VersionId:")) {
      const raw = line.split(":", 2)[1]?.trim() || "";
      if (/^\d+$/.test(raw)) {
        return Number(raw);
      }
    }
  }
  return 0;
}

function parseCommitMessage(message) {
  const visibleLines = [];
  const metadata = {};

  for (const rawLine of String(message || "").split(/\r?\n/)) {
    const separator = rawLine.indexOf(":");
    if (separator > 0) {
      const key = rawLine.slice(0, separator).trim();
      const value = rawLine.slice(separator + 1).trim();
      if (key.startsWith("XG-")) {
        metadata[key] = value;
        continue;
      }
    }
    visibleLines.push(rawLine);
  }

  return {
    message: visibleLines.join("\n").trim(),
    metadata,
  };
}

function toPosixRelativePath(root, target) {
  return path.relative(root, target).replace(/\\/g, "/");
}

async function writeProjectMeta(projectDir, projectId, { agentName, committerName, message, basevision }) {
  const metaPath = path.join(projectDir, "project_meta.json");
  let current = {};
  if (existsSync(metaPath)) {
    try {
      current = JSON.parse(await readFile(metaPath, "utf8"));
    } catch {
      current = {};
    }
  }

  const now = nowTimestamp();
  const meta = {
    project_id: projectId,
    name: current.name || projectId,
    description: current.description || "",
    status: current.status || DEFAULT_STATUS,
    created_at: current.created_at || now,
    updated_at: now,
    official_recommendations: current.official_recommendations || {},
    official_history: current.official_history || {},
    last_agent: agentName,
    last_committer: committerName,
    last_message: message,
    last_basevision: basevision,
  };

  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

async function readProjectMeta(projectDir, projectId) {
  const metaPath = path.join(projectDir, "project_meta.json");
  let current = {};
  if (existsSync(metaPath)) {
    try {
      current = JSON.parse(await readFile(metaPath, "utf8"));
    } catch {
      current = {};
    }
  }

  return {
    ...current,
    project_id: projectId,
    name: current.name || projectId,
    description: current.description || "",
    status: current.status || DEFAULT_STATUS,
    created_at: current.created_at || "",
    updated_at: current.updated_at || "",
    official_recommendations: current.official_recommendations || {},
    official_history: current.official_history || {},
  };
}

function resolveProjectDir(storageRoot, projectId) {
  const safeProjectId = validateProjectId(projectId);
  const root = path.resolve(storageRoot);
  const projectDir = path.resolve(root, safeProjectId);
  if (projectDir !== path.join(root, safeProjectId) || !projectDir.startsWith(`${root}${path.sep}`)) {
    throw new Error("projectId 非法，禁止访问工作区之外的目录");
  }

  return {
    safeProjectId,
    projectDir,
  };
}

function serializeFileData(data) {
  if (typeof data === "string") {
    return data.endsWith("\n") ? data : `${data}\n`;
  }
  return `${JSON.stringify(data, null, 2)}\n`;
}

export class OntoGitLocalCommitService {
  constructor(options = {}) {
    this.storageRoot = options.storageRoot;
    this.defaultAgentName = options.defaultAgentName || "ontology-editor";
    this.defaultCommitterName = options.defaultCommitterName || "ontology-editor";
  }

  async writeVersion({
    projectId,
    filename,
    data,
    message,
    agentName = this.defaultAgentName,
    committerName = this.defaultCommitterName,
    timestamp,
  }) {
    const safeProjectId = validateProjectId(projectId);
    const safeFilename = validateFilename(filename);
    const projectDir = path.join(this.storageRoot, safeProjectId);

    await mkdir(path.dirname(path.join(projectDir, safeFilename)), { recursive: true });
    await mkdir(projectDir, { recursive: true });
    await ensureGitRepo(projectDir);

    const basevision = await readLatestVersionId(projectDir, safeFilename);
    const nextVersionId = basevision + 1;
    const filePath = path.join(projectDir, safeFilename);
    await writeFile(filePath, serializeFileData(data), "utf8");
    await writeProjectMeta(projectDir, safeProjectId, {
      agentName,
      committerName,
      message,
      basevision,
    });

    await runGit(projectDir, ["add", safeFilename, "project_meta.json"]);

    const fullMessage = [
      String(message || "").trim() || "System: version update",
      "",
      `XG-Filename: ${safeFilename}`,
      `XG-VersionId: ${nextVersionId}`,
      `XG-BaseVersion: ${basevision}`,
      `XG-ObjectName: ${agentName}`,
      `XG-CommitterName: ${committerName}`,
    ].join("\n");

    const commitEnv = timestamp
      ? {
          ...process.env,
          GIT_AUTHOR_DATE: timestamp,
          GIT_COMMITTER_DATE: timestamp,
        }
      : process.env;

    await execFileAsync("git", [
      "-c",
      `user.name=${committerName}`,
      "-c",
      `user.email=${committerName}@local`,
      "commit",
      "--allow-empty",
      `--author=${committerName} <${committerName}@local>`,
      "-m",
      fullMessage,
    ], {
      cwd: projectDir,
      env: commitEnv,
      maxBuffer: 20 * 1024 * 1024,
    });

    const commitResult = await runGit(projectDir, ["rev-parse", "HEAD"]);
    return {
      status: "success",
      filename: safeFilename,
      path: filePath,
      version_id: nextVersionId,
      basevision,
      commit_id: String(commitResult.stdout || "").trim(),
    };
  }

  async listProjects() {
    await mkdir(this.storageRoot, { recursive: true });
    const entries = await readdir(this.storageRoot, { withFileTypes: true });
    const projects = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".xg_meta") {
        continue;
      }

      const projectDir = path.join(this.storageRoot, entry.name);
      const meta = await readProjectMeta(projectDir, entry.name);
      const files = await this.listJsonFiles(entry.name) || [];
      const isGitProject = existsSync(path.join(projectDir, ".git"));
      const commitCountResult = isGitProject
        ? await runGit(projectDir, ["rev-list", "--count", "HEAD"], { allowFailure: true })
        : { stdout: "0" };
      const latestCommitResult = isGitProject
        ? await runGit(projectDir, ["rev-parse", "HEAD"], { allowFailure: true })
        : { stdout: "" };
      projects.push({
        ...meta,
        file_count: files.length,
        commit_count: Number(String(commitCountResult.stdout || "0").trim()) || 0,
        files,
        latest_commit_id: String(latestCommitResult.stdout || "").trim() || undefined,
      });
    }

    return projects.sort((left, right) => (
      String(right.updated_at || "").localeCompare(String(left.updated_at || ""))
    ));
  }

  async initProject({ projectId, name, description = "" }) {
    const safeProjectId = validateProjectId(projectId);
    const projectDir = path.join(this.storageRoot, safeProjectId);
    await mkdir(projectDir, { recursive: true });
    await ensureGitRepo(projectDir);

    const current = await readProjectMeta(projectDir, safeProjectId);
    const now = nowTimestamp();
    const meta = {
      ...current,
      project_id: safeProjectId,
      name: String(name || current.name || safeProjectId),
      description: String(description || current.description || ""),
      status: current.status || DEFAULT_STATUS,
      created_at: current.created_at || now,
      updated_at: now,
      official_recommendations: current.official_recommendations || {},
      official_history: current.official_history || {},
    };

    await writeFile(path.join(projectDir, "project_meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    await runGit(projectDir, ["add", "project_meta.json"]);
    const statusResult = await runGit(projectDir, ["status", "--porcelain"], { allowFailure: true });
    let commitId = null;

    if (String(statusResult.stdout || "").trim()) {
      await execFileAsync("git", [
        "-c",
        "user.name=System",
        "-c",
        "user.email=System@local",
        "commit",
        "--allow-empty",
        "--author=System <System@local>",
        "-m",
        `System: 初始化项目 ${safeProjectId}`,
      ], {
        cwd: projectDir,
        env: process.env,
        maxBuffer: 20 * 1024 * 1024,
      });
      const commitResult = await runGit(projectDir, ["rev-parse", "HEAD"]);
      commitId = String(commitResult.stdout || "").trim();
    }

    return {
      status: commitId ? "created" : "updated",
      commit_id: commitId,
      project: {
        ...meta,
        file_count: 0,
        commit_count: commitId ? 1 : 0,
        files: [],
        latest_commit_id: commitId || undefined,
      },
    };
  }

  async updateProjectName(projectId, name) {
    const { safeProjectId, projectDir } = resolveProjectDir(this.storageRoot, projectId);
    if (!existsSync(projectDir)) {
      return null;
    }

    const trimmedName = String(name || "").trim();
    if (!trimmedName) {
      throw new Error("name is required");
    }

    const current = await readProjectMeta(projectDir, safeProjectId);
    const now = nowTimestamp();
    const meta = {
      ...current,
      project_id: safeProjectId,
      name: trimmedName,
      updated_at: now,
      status: current.status || DEFAULT_STATUS,
      created_at: current.created_at || now,
      official_recommendations: current.official_recommendations || {},
      official_history: current.official_history || {},
    };

    await writeFile(path.join(projectDir, "project_meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");

    const isGitProject = existsSync(path.join(projectDir, ".git"));
    let commitId = null;
    if (isGitProject) {
      await runGit(projectDir, ["add", "project_meta.json"]);
      const statusResult = await runGit(projectDir, ["status", "--porcelain"], { allowFailure: true });
      if (String(statusResult.stdout || "").trim()) {
        await execFileAsync("git", [
          "-c",
          "user.name=System",
          "-c",
          "user.email=System@local",
          "commit",
          "--allow-empty",
          "--author=System <System@local>",
          "-m",
          `System: update project name ${safeProjectId}`,
        ], {
          cwd: projectDir,
          env: process.env,
          maxBuffer: 20 * 1024 * 1024,
        });
        const commitResult = await runGit(projectDir, ["rev-parse", "HEAD"]);
        commitId = String(commitResult.stdout || "").trim();
      }
    }

    const files = await this.listJsonFiles(safeProjectId) || [];
    const commitCountResult = isGitProject
      ? await runGit(projectDir, ["rev-list", "--count", "HEAD"], { allowFailure: true })
      : { stdout: "0" };
    const latestCommitResult = isGitProject
      ? await runGit(projectDir, ["rev-parse", "HEAD"], { allowFailure: true })
      : { stdout: "" };

    return {
      status: "updated",
      commit_id: commitId,
      project: {
        ...meta,
        file_count: files.length,
        commit_count: Number(String(commitCountResult.stdout || "0").trim()) || 0,
        files,
        latest_commit_id: String(latestCommitResult.stdout || "").trim() || undefined,
      },
    };
  }

  async listJsonFiles(projectId) {
    const { projectDir } = resolveProjectDir(this.storageRoot, projectId);
    if (!existsSync(projectDir)) {
      return null;
    }

    const results = [];
    const visit = async (dir) => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === ".git") {
          continue;
        }

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await visit(fullPath);
          continue;
        }

        const relativePath = toPosixRelativePath(projectDir, fullPath);
        if (
          relativePath === "project_meta.json"
          || relativePath === "init.txt"
          || relativePath.startsWith("_inference/")
          || !relativePath.toLowerCase().endsWith(".json")
        ) {
          continue;
        }
        results.push(relativePath);
      }
    };

    await visit(projectDir);
    return results.sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  }

  async readJsonFile(projectId, filename, commitId) {
    const safeFilename = validateFilename(filename);
    const { projectDir } = resolveProjectDir(this.storageRoot, projectId);
    if (!existsSync(projectDir)) {
      return null;
    }

    const raw = commitId
      ? (await runGit(projectDir, ["show", `${commitId}:${safeFilename}`])).stdout
      : await readFile(path.join(projectDir, safeFilename), "utf8");

    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  async getFileTimeline(projectId, filename) {
    const safeFilename = validateFilename(filename);
    const { projectDir } = resolveProjectDir(this.storageRoot, projectId);
    if (!existsSync(projectDir)) {
      return null;
    }

    const commitsResult = existsSync(path.join(projectDir, ".git"))
      ? await runGit(
          projectDir,
          ["log", "--reverse", "--format=%H%x1f%an%x1f%aI%x1f%B%x1e", "--", safeFilename],
          { allowFailure: true },
        )
      : { stdout: "" };

    const entries = String(commitsResult.stdout || "")
      .split("\x1e")
      .map((entry) => entry.trim())
      .filter(Boolean);

    const history = entries.map((entry, index) => {
      const [id = "", author = "", timestamp = "", ...messageParts] = entry.split("\x1f");
      const parsed = parseCommitMessage(messageParts.join("\x1f"));
      const parsedVersionId = Number(parsed.metadata["XG-VersionId"]);
      const versionId = Number.isFinite(parsedVersionId) && parsedVersionId > 0
        ? parsedVersionId
        : index + 1;

      return {
        id: id.trim(),
        version_id: versionId,
        msg: parsed.message || "本地文件版本",
        object_name: parsed.metadata["XG-ObjectName"] || author.trim(),
        committer: parsed.metadata["XG-CommitterName"] || author.trim(),
        time: timestamp.trim(),
      };
    });

    return {
      filename: safeFilename,
      version_count: history.length,
      latest_commit_id: history.at(-1)?.id || null,
      latest_version_id: history.at(-1)?.version_id || null,
      root_version_ids: history.length > 0 ? [history[0].version_id] : [],
      history,
    };
  }

  async getJsonFileTimelines(projectId) {
    const files = await this.listJsonFiles(projectId);
    if (!files) {
      return null;
    }

    const timelines = [];
    for (const filename of files) {
      const timeline = await this.getFileTimeline(projectId, filename);
      if (timeline) {
        timelines.push(timeline);
      }
    }
    return timelines;
  }

  async deleteProject(projectId) {
    const { safeProjectId, projectDir } = resolveProjectDir(this.storageRoot, projectId);
    if (!existsSync(projectDir)) {
      return {
        status: "not_found",
        project_id: safeProjectId,
      };
    }

    await rm(projectDir, { recursive: true, force: true });
    return {
      status: "deleted",
      project_id: safeProjectId,
    };
  }
}
