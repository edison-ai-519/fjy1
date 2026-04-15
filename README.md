# FJY 综合本体知识库系统

## 环境要求

推荐统一准备以下环境：

- `Git`
- `Node.js 20+`
- `npm 10+`
- `Python 3.10` 或 `Python 3.11`

平台补充：

- Windows：`PowerShell 5.1+` 或 `PowerShell 7+`
- Linux/macOS：`bash`、`curl`、`lsof`


## 各模块初始化和启动

### 1. `kimi-agent-knowledge-base-collab/app`

初始化：

```powershell
cd .\kimi-agent-knowledge-base-collab\app
npm install
```

```bash
cd ./kimi-agent-knowledge-base-collab/app
npm install
```

启动前端：

```powershell
npm run dev
```


启动后端：

```powershell
npm run server
```


### 2. `QAgent`

初始化：

```powershell
cd .\QAgent
npm install
```

启动：
```
npm run dev
```


## 快速启动

完成下面这些初始化后即可直接一键启动主链路：

- `OntoGit`
- `Ontology_Factory/WIKI_MG`
- `kimi-agent-knowledge-base-collab/app`

### Windows

```powershell
cd D:\code\FJY
.\start_kimi_stack.ps1
```


### Linux/macOS

```bash
cd /path/to/FJY
chmod +x ./start_kimi_stack.sh
./start_kimi_stack.sh
```

指定环境变量：

```bash
cd /path/to/FJY
PORT=8787 VITE_PORT=5173 PYTHON_BIN=python3 WIKIMG_ROOT="$(pwd)/Ontology_Factory" ./start_kimi_stack.sh
```

启动完成后常用入口：

- 前端：`http://localhost:5173`
- 后端健康检查：`http://localhost:8787/api/health`
- OntoGit gateway：`http://localhost:8080`

查看日志：

```powershell
Get-Content -Wait .\.run-logs\kimi-frontend.log
Get-Content -Wait .\.run-logs\kimi-backend.log
```

```bash
tail -f ./.run-logs/kimi-frontend.log
tail -f ./.run-logs/kimi-backend.log
```
