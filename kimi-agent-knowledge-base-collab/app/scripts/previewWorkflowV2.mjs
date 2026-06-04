import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const defaultSource = path.resolve(
  appRoot,
  '../.workflow-runtime/.workflow-runs/conversation-file-workflow-v2-mpwkw8gq-mwwz5z/latest-v2-run.json',
);
const cliArg = process.argv[2] || '';
const wantsHelp = cliArg === '-h' || cliArg === '--help';
const sourcePath = path.resolve(cliArg && !wantsHelp ? cliArg : defaultSource);
const publicPreviewDir = path.resolve(appRoot, 'public/workflow-v2-preview');
const distPreviewDir = path.resolve(appRoot, 'dist/workflow-v2-preview');
const previewFileName = 'latest-v2-run.json';
const previewFilePath = path.join(publicPreviewDir, previewFileName);
const preferredPreviewPort = Number(process.env.WORKFLOW_V2_PREVIEW_PORT || '4173');
const previewCacheKey = Date.now().toString(36);

function createPreviewUrl(port) {
  return `http://127.0.0.1:${port}/?tab=file-workflow-v2&workflowV2Preview=/workflow-v2-preview/${encodeURIComponent(previewFileName)}%3Fv%3D${encodeURIComponent(previewCacheKey)}`;
}

function openBrowser(url) {
  if (process.platform === 'win32') {
    const child = execFileSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-Command',
      `Start-Process '${url.replace(/'/g, "''")}'`,
    ], { stdio: 'ignore' });
    void child;
    return;
  }

  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  execFileSync(opener, [url], { stdio: 'ignore' });
}

function guessContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.woff') return 'font/woff';
  if (ext === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}

async function buildApp() {
  if (process.platform === 'win32') {
    execFileSync('cmd.exe', ['/d', '/s', '/c', 'npm run build'], {
      cwd: appRoot,
      stdio: 'inherit',
    });
    return;
  }

  execFileSync('npm', ['run', 'build'], {
    cwd: appRoot,
    stdio: 'inherit',
  });
}

async function syncPreviewFile(source, destination) {
  const content = await readFile(source, 'utf8');
  await writeFile(destination, content, 'utf8');
}

function safeJoin(rootDir, requestPath) {
  const normalized = path.normalize(decodeURIComponent(requestPath)).replace(/^([/\\])+/, '');
  const resolved = path.resolve(rootDir, normalized);
  if (!resolved.startsWith(rootDir)) {
    return null;
  }
  return resolved;
}

function createStaticServer(rootDir) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      let pathname = url.pathname;
      if (pathname === '/') {
        pathname = '/index.html';
      }

      const filePath = safeJoin(rootDir, pathname);
      if (!filePath || !existsSync(filePath)) {
        const indexPath = path.join(rootDir, 'index.html');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        createReadStream(indexPath).pipe(res);
        return;
      }

      res.writeHead(200, { 'Content-Type': guessContentType(filePath) });
      createReadStream(filePath).pipe(res);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(error instanceof Error ? error.message : '预览服务启动失败');
    }
  });
}

async function startStaticServer(rootDir, preferredPort) {
  for (let offset = 0; offset < 20; offset += 1) {
    const port = preferredPort + offset;
    const server = createStaticServer(rootDir);
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
      return { server, port };
    } catch (error) {
      server.close();
      if (error && typeof error === 'object' && error.code === 'EADDRINUSE') {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`无法找到可用端口，已尝试从 ${preferredPort} 开始的 20 个端口`);
}

async function main() {
  if (wantsHelp) {
    console.log('用法: npm run workflowv2:preview -- [jsonPath]');
    console.log(`默认预览文件: ${defaultSource}`);
    return;
  }

  if (!existsSync(sourcePath)) {
    throw new Error(`未找到 workflow V2 预览文件: ${sourcePath}`);
  }

  await mkdir(publicPreviewDir, { recursive: true });
  await rm(previewFilePath, { force: true });
  await syncPreviewFile(sourcePath, previewFilePath);
  await rm(distPreviewDir, { recursive: true, force: true });

  await buildApp();

  const { server, port } = await startStaticServer(path.resolve(appRoot, 'dist'), preferredPreviewPort);
  const previewUrl = createPreviewUrl(port);

  const sourceStat = await stat(sourcePath);
  console.log(`已同步最新预览文件: ${sourcePath}`);
  console.log(`源文件时间: ${sourceStat.mtime.toISOString()} 大小: ${sourceStat.size} bytes`);
  console.log(`预览文件写入: ${previewFilePath}`);
  console.log(`预览服务已启动: ${previewUrl}`);
  console.log('==============================');
  console.log(`启动后链接: ${previewUrl}`);
  console.log('==============================');
  openBrowser(previewUrl);
  console.log('已尝试打开浏览器。按 Ctrl+C 可停止预览服务。');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
