# 线上本体服务接口对接说明

本文档面向需要接入线上本体服务的业务方，说明如何通过接口读取、写入、评估和治理本体数据。

线上服务器地址：

```text
http://81.70.12.214
```

建议所有业务系统统一调用 gateway：

```text
http://81.70.12.214:8080
```

页面入口：

```text
本体治理总览：http://81.70.12.214:8080/ui-dashboard
本体版本图谱：http://81.70.12.214:8080/ui-visual
本体 Agent 查询台：http://81.70.12.214:8080/ui-agent
用户与 API Key：http://81.70.12.214:8080/ui-users
本体概率判别：http://81.70.12.214:3000/probability/
本体概率 + 原因：http://81.70.12.214:3000/probability-reason/
```

## 1. 这套系统解决什么本体问题

业务系统在使用本体时，通常会遇到几个现实问题：

- 本体不是一次性定义完就不变，它会随着业务理解、字段定义、对象关系持续演进。
- 多个人或多个 Agent 都可能修改本体，如果没有版本管理，很难解释“现在用的是哪个版本”。
- 本体质量需要评估，例如一个对象是否足够像真实业务本体，能力和关系是否合理。
- 业务系统希望拿到稳定可信版本，但治理人员也希望看到社区或使用方更认可的版本。
- 当本体变更出问题时，需要能回滚、对比差异、追踪提交人和提交说明。

这套线上服务的核心定位是：

```text
为本体 JSON 提供版本化存储、概率评估、双轨推荐、星标反馈和自然语言查询能力。
```

对业务方的直接价值：

- 可以把本体当成可治理资产，而不是散落在各系统里的普通 JSON 文件。
- 可以读取当前本体、指定版本本体、官方推荐本体或社区推荐本体。
- 可以在写入本体时自动补充 `probability`，辅助判断本体质量。
- 可以通过版本树解释本体从哪里来、怎么变、谁提交、为什么提交。
- 可以用 Agent 直接问本体库，例如“学校本体最近发生了哪些变化”。

## 2. 对接入口怎么选

业务系统只需要记住一个 API 根地址：

```text
http://81.70.12.214:8080
```

这个地址是 gateway。它会统一转发到后端模块：

- `/xg/*`：本体版本库能力，包括读写、版本树、回滚、diff、推荐、星标。
- `/probability/*`：本体概率判别能力。
- `/api/agent/query`：本体自然语言查询能力。
- `/api/dashboard/summary`：本体治理总览能力。

不建议业务系统长期直连这些模块端口：

```text
http://81.70.12.214:8000   # xiaogugit，本体版本库模块
http://81.70.12.214:5000   # probability，本体概率模块
```

原因很直接：gateway 后面可能切换 Redis、MySQL、Agent tool 或鉴权策略，业务系统只接 gateway，后续改动最小。

## 3. 鉴权方式

系统对服务调用推荐使用 API Key。

请求头：

```http
X-API-Key: <你的 API Key>
```

API Key 可在页面申请：

```text
http://81.70.12.214:8080/ui-users
```

注册用户后会返回初始 API Key。API Key 明文只展示一次，后端只保存哈希；如果丢失，需要重新生成。

如果是人工使用页面，可以走浏览器登录；如果是业务系统调用接口，建议统一使用 API Key。

## 4. 快速连通性测试

### Linux / macOS

```bash
baseUrl="http://81.70.12.214:8080"
apiKey="<你的 API Key>"

curl -X GET "$baseUrl/health" \
  -H "X-API-Key: $apiKey"
```

### Windows PowerShell

```powershell
$baseUrl = "http://81.70.12.214:8080"
$apiKey = "<你的 API Key>"
$headers = @{
  "X-API-Key" = $apiKey
}

Invoke-RestMethod `
  -Method Get `
  -Uri "$baseUrl/health" `
  -Headers $headers
```

返回中会看到 gateway、xiaogugit、probability 的健康状态。

业务含义：

- gateway 正常：统一入口可用。
- xiaogugit 正常：本体版本库可用。
- probability 正常：本体概率判别可用。

## 5. 获取本体治理总览

接口：

```http
GET /api/dashboard/summary
```

示例：

```bash
curl -X GET "$baseUrl/api/dashboard/summary" \
  -H "X-API-Key: $apiKey"
```

这个接口适合做业务侧的本体资产总览页。

它会返回：

- 项目列表。
- 每个项目下有哪些本体文件。
- 每个本体的版本时间线。
- 当前工作区里的本体 JSON。
- 后端服务健康状态。

业务方可以用它判断：

- 当前有哪些本体资产已经进入版本化管理。
- 每个本体是否有官方推荐版本。
- 哪些本体已经有社区热度。
- 哪些本体可能缺少概率字段或治理状态。

## 6. 读取本体

### 6.1 查看所有项目

```http
GET /xg/projects
```

```bash
curl -X GET "$baseUrl/xg/projects" \
  -H "X-API-Key: $apiKey"
```

### 6.2 查看项目下的本体时间线

```http
GET /xg/timelines/{project_id}
```

示例：

```bash
curl -X GET "$baseUrl/xg/timelines/demo" \
  -H "X-API-Key: $apiKey"
```

业务用途：

- 列出一个项目下有哪些本体。
- 查看每个本体最近变更时间。
- 给业务后台生成本体版本列表。

### 6.3 读取当前本体

```http
GET /xg/read/{project_id}/{filename}
```

示例：

```bash
curl -X GET "$baseUrl/xg/read/demo/student.json" \
  -H "X-API-Key: $apiKey"
```

适合场景：

- 业务系统需要加载当前生效本体。
- 审批页面需要展示当前本体结构。
- 数据质量系统需要读取本体做校验。

### 6.4 读取指定版本本体

```http
GET /xg/version-read/{project_id}/{version_id}?filename={filename}
```

示例：

```bash
curl -X GET "$baseUrl/xg/version-read/demo/2?filename=student.json" \
  -H "X-API-Key: $apiKey"
```

适合场景：

- 生产系统锁定某个稳定本体版本。
- 审计某次历史版本内容。
- 比较不同版本上线后的业务影响。

## 7. 写入本体并自动评估概率

推荐接口：

```http
POST /xg/write-and-infer
```

这个接口会把本体写入版本库，并在写入成功后自动调用概率判别，为本体补充 `probability` 字段。

请求体示例：

```json
{
  "project_id": "demo",
  "filename": "student.json",
  "basevision": 4,
  "message": "新增学生参与项目能力",
  "agent_name": "agent3.5",
  "committer_name": "张三",
  "data": {
    "name": "学生",
    "agent": "agent3.5",
    "abilities": ["学习", "完成作业", "参与项目"],
    "interactions": [
      {
        "target": "老师",
        "type": "请教"
      },
      {
        "target": "学校",
        "type": "就读"
      }
    ]
  }
}
```

Linux / macOS：

```bash
curl -X POST "$baseUrl/xg/write-and-infer" \
  -H "X-API-Key: $apiKey" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{
    "project_id": "demo",
    "filename": "student.json",
    "basevision": 4,
    "message": "新增学生参与项目能力",
    "agent_name": "agent3.5",
    "committer_name": "张三",
    "data": {
      "name": "学生",
      "agent": "agent3.5",
      "abilities": ["学习", "完成作业", "参与项目"],
      "interactions": [
        {"target": "老师", "type": "请教"},
        {"target": "学校", "type": "就读"}
      ]
    }
  }'
```

Windows PowerShell：

```powershell
$body = @{
  project_id = "demo"
  filename = "student.json"
  basevision = 4
  message = "新增学生参与项目能力"
  agent_name = "agent3.5"
  committer_name = "张三"
  data = @{
    name = "学生"
    agent = "agent3.5"
    abilities = @("学习", "完成作业", "参与项目")
    interactions = @(
      @{
        target = "老师"
        type = "请教"
      },
      @{
        target = "学校"
        type = "就读"
      }
    )
  }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod `
  -Method Post `
  -Uri "$baseUrl/xg/write-and-infer" `
  -Headers $headers `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

字段说明：

- `project_id`：本体所属项目，例如 `demo`。
- `filename`：本体文件名，例如 `student.json`。
- `basevision`：基于哪个版本提交，防止覆盖别人已经提交的新版本。
- `message`：本体变更说明，建议写业务含义。
- `agent_name`：本体生成来源，可以是模型、Agent 或系统名。
- `committer_name`：提交人。
- `data`：本体 JSON，请求时不需要带 `probability`，系统会自动补。

业务建议：

- 写入本体时必须关注 `basevision`，它是并发协作下的安全边界。
- `message` 要写清楚本体语义变化，例如“新增学生参与项目能力”，不要只写“更新”。
- 不建议业务方手动写 `probability`，概率字段应由系统推理或版本库缓存产生。

## 8. 本体概率判别

如果业务系统只是想判断一个对象是否适合作为本体，不需要入库，可以直接调用概率判别。

### 8.1 只返回概率

```http
POST /probability/api/llm/probability
```

示例：

```bash
curl -X POST "$baseUrl/probability/api/llm/probability" \
  -H "X-API-Key: $apiKey" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{
    "name": "学校",
    "agent": "agent2.3",
    "abilities": ["教学管理", "课程安排", "资源配置"],
    "interactions": [
      {"target": "老师", "type": "聘用"},
      {"target": "学生", "type": "培养"}
    ]
  }'
```

返回示例：

```json
{
  "probability": "98%",
  "status": "success"
}
```

### 8.2 返回概率和原因

```http
POST /probability/api/llm/probability-reason
```

示例：

```bash
curl -X POST "$baseUrl/probability/api/llm/probability-reason" \
  -H "X-API-Key: $apiKey" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{
    "name": "学校",
    "agent": "agent2.3",
    "abilities": ["教学管理", "课程安排", "资源配置"],
    "interactions": [
      {"target": "老师", "type": "聘用"},
      {"target": "学生", "type": "培养"}
    ]
  }'
```

业务理解：

- `probability` 适合写入本体，作为本体质量或真实性的轻量指标。
- `reason` 适合审核和解释，但不建议长期写入生产本体。
- 如果同一份本体已经在版本库里有概率，优先读取版本库结果，避免重复调用模型导致结果波动。

## 9. 本体双轨推荐

系统支持两条推荐轨道：

- 官方推荐：由治理方指定，适合生产默认版本、审批通过版本、对外发布版本。
- 社区推荐：按 stars 和社区热度排序，适合发现使用方更认可的候选版本。

### 9.1 获取官方推荐本体版本

```http
GET /xg/version-recommend/official?project_id=demo&filename=student.json
```

示例：

```bash
curl -X GET "$baseUrl/xg/version-recommend/official?project_id=demo&filename=student.json" \
  -H "X-API-Key: $apiKey"
```

业务用途：

- 生产系统默认读取官方推荐版本。
- 治理流程审核通过后下发标准版本。
- 对外服务返回“当前标准本体”。

### 9.2 设置官方推荐本体版本

```http
POST /xg/version-recommend/official/set
```

示例：

```bash
curl -X POST "$baseUrl/xg/version-recommend/official/set" \
  -H "X-API-Key: $apiKey" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{
    "project_id": "demo",
    "filename": "student.json",
    "version_id": 4,
    "operator": "admin",
    "reason": "审核通过，作为当前学生本体标准版本"
  }'
```

### 9.3 获取社区星标最高本体版本

```http
GET /xg/version-recommend/community?project_id=demo&filename=student.json
```

示例：

```bash
curl -X GET "$baseUrl/xg/version-recommend/community?project_id=demo&filename=student.json" \
  -H "X-API-Key: $apiKey"
```

业务用途：

- 发现业务使用方更认可的本体版本。
- 给官方治理人员提供候选版本。
- 用于灰度试用、版本投票和治理评审。

### 9.4 点星和取消点星

请使用 gateway 的幂等点星接口：

```http
POST /api/stars/star
POST /api/stars/unstar
```

点星：

```bash
curl -X POST "$baseUrl/api/stars/star" \
  -H "X-API-Key: $apiKey" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{
    "project_id": "demo",
    "filename": "student.json",
    "version_id": 2
  }'
```

取消点星：

```bash
curl -X POST "$baseUrl/api/stars/unstar" \
  -H "X-API-Key: $apiKey" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{
    "project_id": "demo",
    "filename": "student.json",
    "version_id": 2
  }'
```

幂等规则：

- 同一个 API Key 对同一个本体版本重复点星，只会增加一次 stars。
- 重复取消点星不会继续扣减 stars。
- gateway 用 MySQL 记录投票状态，xiaogugit 保存聚合 stars 数。

## 10. 本体版本差异和回滚

### 10.1 比较两个版本

```http
GET /xg/version-diff?project_id=demo&filename=student.json&base_version_id=2&target_version_id=4
```

示例：

```bash
curl -X GET "$baseUrl/xg/version-diff?project_id=demo&filename=student.json&base_version_id=2&target_version_id=4" \
  -H "X-API-Key: $apiKey"
```

业务用途：

- 解释本体字段、能力、关系发生了什么变化。
- 审批前查看变更影响。
- 回归问题时定位哪个版本引入了变化。

### 10.2 强制回滚到指定版本

```http
POST /xg/version-rollback?project_id=demo&version_id=2&filename=student.json
```

示例：

```bash
curl -X POST "$baseUrl/xg/version-rollback?project_id=demo&version_id=2&filename=student.json" \
  -H "X-API-Key: $apiKey"
```

业务理解：

- 回滚不是简单删除一个 JSON 文件，而是让当前本体内容回到指定版本状态。
- 适合发现本体变更有问题时快速恢复。
- 回滚后建议重新查看版本图谱，确认当前版本和回滚结果。

## 11. 本体 Agent 自然语言查询

接口：

```http
POST /api/agent/query
```

示例：

```bash
curl -X POST "$baseUrl/api/agent/query" \
  -H "X-API-Key: $apiKey" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{
    "question": "student.json 当前社区星标最高的版本是谁？",
    "project_id": "demo",
    "filename": "student.json"
  }'
```

可查询的问题示例：

```text
学校本体当前官方推荐版本是谁？
学生本体最近发生了哪些变化？
student.json V2 和 V4 差在哪？
demo 项目有哪些本体治理缺口？
```

业务用途：

- 给治理人员提供自然语言查询入口。
- 降低业务方理解版本库接口的成本。
- 在本体管理后台里实现“本体治理助手”。

注意：

- Agent 当前主要用于查询和解释，不建议直接作为修改本体的执行入口。
- 生产系统执行关键动作时，仍建议调用明确 REST API。

## 12. 推荐接入路径

如果业务方第一次接入，建议按这个顺序：

1. 申请 API Key。
2. 用 `/health` 测试 gateway 和后端服务是否可用。
3. 用 `/api/dashboard/summary` 查看有哪些项目和本体。
4. 用 `/xg/read/{project_id}/{filename}` 读取当前本体。
5. 如果业务需要稳定标准版本，接 `/xg/version-recommend/official`。
6. 如果业务需要用户反馈或候选版本，接 `/api/stars/star` 和 `/xg/version-recommend/community`。
7. 如果业务需要写入本体，接 `/xg/write-and-infer`，并严格传 `basevision`。
8. 如果业务需要智能查询，接 `/api/agent/query`。

## 13. 常见错误处理

对外错误通常会隐藏内部细节，常见格式：

```json
{
  "detail": "请稍后重试"
}
```

处理建议：

- `401 Unauthorized`：检查是否带了 `X-API-Key`，以及 API Key 是否正确。
- `400 Bad Request`：检查 JSON 字段、参数名、`filename`、`version_id`、中文编码。
- `502 Bad Gateway`：通常是后端模块暂时不可用，可以稍后重试。
- `500 Internal Server Error`：保留请求时间、接口路径、请求体摘要，交给服务方查日志。

Windows PowerShell 如果中文变成 `??`，请用 UTF-8 bytes 发送：

```powershell
-Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

并指定：

```powershell
-ContentType "application/json; charset=utf-8"
```

## 14. 最重要的对接原则

业务系统不要把本体服务当成普通文件接口来用，而应该把它当成“本体资产治理服务”：

- 读当前本体：用于快速消费。
- 读官方推荐版本：用于生产标准。
- 读社区推荐版本：用于发现候选。
- 写入本体：必须带版本基线和提交说明。
- 点星：表达使用方对某个本体版本的认可。
- diff 和回滚：用于治理、审计和问题恢复。
- 概率评估：用于辅助判断本体质量。
- Agent 查询：用于降低治理人员的查询门槛。

最终建议：

```text
业务系统只依赖 gateway 暴露的接口，不直接依赖模块端口。
```

这样后续本体服务内部升级 Redis、MySQL、Agent tool 或概率模型时，对业务系统影响最小。
