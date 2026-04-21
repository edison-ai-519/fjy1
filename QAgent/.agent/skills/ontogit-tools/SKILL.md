name: ontogit-tools-cli
description: 使用 `D:\code\FJY\OntoGit\ontogit_tools.sh` 这个 CLI 通过 OntoGit 网关执行项目列表、读取、写入并触发推理、以及概率推理。适用于需要稳定调用 `write`、`read`、`list`、`infer` 子命令并解析 JSON 输出的场景。
---

# OntoGit Tools CLI

当任务涉及 OntoGit、XiaoGuGit、本体数据、项目列表或概率推理时，使用这个 skill。

## 什么时候应该命中我

- 用户问“某项目有哪些本体数据”
- 用户问“本体数据 / 项目列表 / 概率推理”
- 用户要求“列出项目 / 读取文件 / 写入并推理 / 概率推理”
- 用户给出 `project_id`、`filename`、`ontology_name`，并希望直接查结果
- 用户只是在判断一个对象或描述的概率时，应优先使用 `probability-cli`

## 什么时候不要命中我

- 只是普通 Git 仓库查询
- 只是本地文件操作，不涉及 OntoGit 网关
- 没有项目、本体、版本、推荐、时间线、推理这类语义

## CLI 位置

- 从 `D:\code\FJY\QAgent` 仓库根目录到 CLI 的相对路径是 `..\OntoGit\ontogit_tools.sh`
- 从本 skill 目录 `D:\code\FJY\QAgent\.agent\skills\ontogit-tools` 到 CLI 的相对路径是 `..\..\..\..\OntoGit\ontogit_tools.sh`
- 调用前先确认路径存在，再执行 CLI

## 触发关键词

- `OntoGit`
- `XiaoGuGit`
- `write-and-infer`
- `project list`
- `probability reason`
- `本体`
- `概率推理`
- `项目列表`
- `本体数据`
- `项目列表`
- `读取`
- `写入`
- `概率推理`

## 适用场景

- 查询项目列表、读取本体文件、写入数据并触发推理
- 查询项目列表、读取本体文件、写入数据并触发推理
- 对现有 OntoGit 服务做概率推理分析
- 需要让 qagent 稳定、可重复地调用 `ontogit_tools.sh`
- 需要在工作目录变化时仍能正确找到 CLI
- 如果只是对单个对象做概率判断，不要改用这个 skill，去用 `probability-cli`

## 先决条件

- CLI 默认连接 `http://127.0.0.1:8080`
- 默认 API key 是 `change-me`
- 如果调用失败并提示连接错误，先确认 OntoGit 服务栈已启动
- Windows 下优先运行 `D:\code\FJY\OntoGit\start_ontogit.ps1`
- Linux/macOS 下优先运行 OntoGit 仓库根目录下的 `start_ontogit.sh`

## 调用规则

- 已知项目时，直接用对应子命令；未知项目时，先 `list`
- `write` 会同时写入数据并触发推理，适合变更型任务
- `read` 只读，不会修改数据
- `infer` 只做概率推理，不写入项目数据
- 如果输入是对象或数组，先确保它是合法 JSON 字符串，再传给 `--data`
- 输出按 JSON 解析；成功时通常是网关返回的 JSON，失败时通常是 `{"error":"..."}` 形式
- 只有在确认需要修改 OntoGit 数据时才使用 `write`

## 极其友好的快速判断

1. 想看有哪些项目，用 `list`
2. 想看某个项目文件，用 `read`
3. 想把新数据写进去并触发推理，用 `write`
4. 只想让模型做概率推理，不改数据，用 `infer`
5. 不确定时，先 `list` 再决定下一步

## 给 qagent 的自然语言理解模板

当用户说：

- “demo 项目有哪些本体数据”
- “帮我读取 school.json”
- “把这份 JSON 写进去并触发推理”

应优先转成：

- 已知项目：直接进入对应命令
- 不知道项目：先 `list`
- 不知道文件名但知道本体名：优先用 `ontology_name`
- 明确要写入时：用 `write`
- 明确只看推理结论时：用 `infer`

## 常用命令

```powershell
bash ..\OntoGit\ontogit_tools.sh list
bash ..\OntoGit\ontogit_tools.sh read --project <project_id> --file <filename>
bash ..\OntoGit\ontogit_tools.sh write --project <project_id> --file <filename> --data '<json>' --msg "QAgent update"
bash ..\OntoGit\ontogit_tools.sh infer --data '<json>'
```

## 稳定使用策略

1. 先确认目标是 `list`、`read`、`write` 还是 `infer`
2. 如果不知道 project id，先 `list`
3. 写入前确保 `--data` 是合法 JSON，必要时先压成单行
4. 执行后检查 JSON 输出中的 `error`、空响应和字段缺失
5. 如果网关不可用，优先重试一次；仍失败则提示启动 `start_ontogit.ps1` 或 `start_ontogit.sh`
6. 如果只是路径不稳，优先使用 skill 中写死的相对路径，不要临时猜目录

## 结果判定

- `list` 成功：返回项目数组或项目对象集合
- `read` 成功：返回指定项目/文件的本体数据
- `write` 成功：返回写入与推理结果，且应包含服务端响应
- `infer` 成功：返回概率推理结果

## 不要误用

- 只是在做普通 Git 查询时，不要用这个 skill
- 只是查看本地仓库文件变化时，不要绕到 OntoGit
- 没有 OntoGit 服务时，不要假装写入成功
- 如果用户只说“看看代码有没有改”，应回到 Git skill
