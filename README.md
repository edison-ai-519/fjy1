# FJY 综合本体知识库系统 (FJY Integrated Knowledge Base System)

这是一个集成了 **本体版本管理 (OntoGit)**、**智能代理框架 (QAgent)** 与 **协同知识库界面** 的全栈式本体工程平台。

## 🚀 核心组件

1.  **OntoGit (XiaoGuGit)**: 基于 Git 的本体版本控制系统，支持本体的读写、回滚、差异对比及概率推理分析。
2.  **QAgent**: 深度集成的智能助理框架，具备自动化操作本体、识别技能 (Skills) 的能力。
3.  **Ontology Factory**: 本体生产工厂，负责原始数据的预处理与 NER 提取。
4.  **Kimi-Agent Collab**: 现代化的前端看板，提供可视化的本体管理、Git 时间线展示及推理实验室。

---

### 选项 A：快捷启动全部组件 (全家桶)
如果您想一键拉起包括 OntoGit 后台和 Web 前端在内的所有组件，可以使用根目录下的全量启动脚本：

*   **Windows (PowerShell)**:
    ```powershell
    .\start_kimi_stack.ps1
    ```
*   **Linux/macOS (Bash)**:
    ```bash
    chmod +x start_kimi_stack.sh
    ./start_kimi_stack.sh
    ```

### 选项 B：分步手动启动 (推荐调试用)

#### 第 1 步：启动 OntoGit 后台服务栈
在进行任何前端操作前，需要启动本体中台的三个子服务（Gateway, XiaoGuGit, Probability）：

```powershell
cd OntoGit
.\start_ontogit.ps1
```
*   **网关地址**: `http://localhost:8080` (统一入口)
*   **API 鉴权**: 默认 `X-API-Key: change-me`

### 第 2 步：启动协同知识库 Web 前端
进入 Web 应用目录并启动开发服务器：

```bash
cd kimi-agent-knowledge-base-collab/app
npm install
npm run dev
```
*   **访问地址**: `http://localhost:5173`
*   **功能导航**: 切换至 **“小故 Git”** 标签页即可开始管理本体项目。

---

## 📦 架构说明 (Architecture)

*   **存储层**: 使用本地磁盘 + Git 仓库，确保数据永远可追溯，防丢失。
*   **推理层**: 独立 Python 微服务，利用大模型对本体逻辑进行置信度评分。
*   **代理层**: 在 Web 后端 (Node.js) 建立安全代理，自动注入鉴权信息，实现前端零配置。

---

## 🛡️ 安全周知
*   本仓库已配置严格的 `.gitignore`。
*   **请勿**提交任何包含 `sk-` 等真实 API Key 的文件。
*   所有的环境变量建议存放在本地生成的 `.env` 文件中。

---
*Created and Maintained by Antigravity AI.*
