---
name: probability-cli
description: 使用 `D:\code\FJY\OntoGit\probability.sh` 这个 CLI 对对象名称或详细描述做概率判断，输出 JSON 格式的 `probability` 和 `reason`。适用于需要独立做本体/对象可信度判断，而不是查询项目版本或图谱数据的场景。
---

# Probability CLI

当任务是在判断一个对象、概念、名称或描述“像不像真实本体”时，使用这个 skill。

## 什么时候应该命中我

- 用户要对一个名称做概率判断
- 用户要对一段描述判断“是否像真实本体”
- 用户希望输出 `{"probability":"97%","reason":"..."}` 这种结果
- 用户明确提到 `probability.sh`、概率判断、可信度、可能性、概率推理

## 什么时候不要命中我

- 用户在查 OntoGit 项目版本、推荐版本、时间线或写入结果
- 用户在查 Git 仓库状态、提交或差异
- 用户需要的是图谱查询、版本树或历史快照

## CLI 位置

- 从 `D:\code\FJY\QAgent` 仓库根目录到 CLI 的相对路径是 `..\OntoGit\probability.sh`
- 从本 skill 目录 `D:\code\FJY\QAgent\.agent\skills\probability-cli` 到 CLI 的相对路径是 `..\..\..\..\OntoGit\probability.sh`
- 调用前先确认路径存在，再执行 CLI

## 输入方式

- 位置参数 `name`：必填，表示要判断的对象名称
- `--details`：可选，补充描述文本
- `--json`：可选，传入完整 JSON，例如 `{ "name": "...", "details": "..." }`

## 调用规则

- 优先传 `name`
- 如果信息更完整，附带 `--details`
- 如果上游已经有结构化对象，优先用 `--json`
- 输出按 JSON 解析；成功时返回类似 `{"probability":"97%","reason":"..."}`，失败时返回 `{"status":"error","message":"..."}`

## 极其友好的快速判断

1. 只要一个对象名，用 `name`
2. 有补充背景时，加 `--details`
3. 已经有 JSON payload 时，用 `--json`
4. 如果要的是项目版本、文件历史或图谱关系，不要用这个 skill

## 给 qagent 的自然语言理解模板

当用户说：

- “判断 school 这个名字像不像一个真实本体”
- “给我一个对象可信度”
- “把这段描述做概率判断”

应优先转成：

- 对象名明确：直接传 `name`
- 有上下文：补 `--details`
- 上游有完整对象：用 `--json`

## 常用命令

```powershell
bash ..\OntoGit\probability.sh school
bash ..\OntoGit\probability.sh school --details "教育领域的本体名称"
bash ..\OntoGit\probability.sh --json '{"name":"school","details":"教育领域的本体名称"}'
```

## 稳定使用策略

1. 先确认是否真的要做“概率判断”，而不是项目查询
2. 如果信息不足，至少提供一个名称
3. 如果结果需要机器消费，优先解析 JSON 输出
4. 如果 CLI 报缺少依赖，先补 `openai` 相关环境

## 结果判定

- 成功时：返回 JSON 字符串，包含 `probability` 和 `reason`
- 失败时：返回错误 JSON，包含 `status` 和 `message`

## 不要误用

- 不要把它当成 OntoGit 的版本查询工具
- 不要用它替代图谱查询
- 不要在要查项目数据时绕进来
