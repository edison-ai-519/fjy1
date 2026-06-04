# 01 后端接入 granularity_align 阶段

## 目标

将已经存在的 `granularityAlignStage(...)` 正式接入文件工作流 V2 主流程，并保证每个 object 都有合法的 `object_level` 字段。

## 当前背景

当前文件工作流 V2 主流程大致为：

```text
chunk_parse
-> chunk_filter
-> window_extract
-> object_fusion
-> function_analysis
-> object_decompose
-> graph_build
-> ablation_analysis
```

需要改为：

```text
chunk_parse
-> chunk_filter
-> window_extract
-> object_fusion
-> granularity_align
-> function_analysis
-> object_decompose
-> graph_build
-> ablation_analysis
```

`granularity_align` 必须插入在：

```text
object_fusion 之后
function_analysis 之前
```

## 修改范围

优先搜索并修改以下位置：

```text
workflowV2Service.mjs
workflowV2Stages.js
granularityAlignStage
function_analysis
object_fusion
WORKFLOW_V2_STAGE_DEFINITIONS
```

## 核心要求

### 1. 接入 granularityAlignStage

在 `object_fusion` 阶段完成后，立即执行：

```js
granularityAlignStage(...)
```

输入使用当前 workflow state 中已有数据，包括但不限于：

```js
{
  document,
  chunks,
  filtered_chunks,
  windows,
  fused_objects,
  system_scope,
  llmClient,
  options
}
```

具体参数名按当前项目已有代码风格传递，不要强行改函数签名。

### 2. 回写 state.fused_objects

`granularityAlignStage(...)` 执行完成后，必须把对齐后的对象数组回写到：

```js
state.fused_objects
```

兼容以下可能返回字段：

```js
granularityAlignResult.fused_objects
granularityAlignResult.aligned_objects
granularityAlignResult.objects
```

如果这些字段都不存在，则保留原始：

```js
state.fused_objects
```

### 3. object_level 必须存在且只能四选一

每个 object 必须有字段：

```js
object_level
```

且必须是以下四个字符串之一：

```text
component
function_unit
subsystem
system
```

含义如下：

| object_level | 图谱层级 | 含义 |
| --- | --- | --- |
| component | L1 | 具体实体、设备、传感器、数据、代码、接口、参数、请求、动作、控制项 |
| function_unit | L2 | 功能模块、方案、设计、实现、计划、效果 |
| subsystem | L3 | 子系统、阶段、流程段 |
| system | L4 | 总系统、平台、架构、总对象 |

### 4. 增加后端强制归一化

在 `workflowV2Service.mjs` 或当前项目合适的工具位置增加：

```js
const OBJECT_LEVEL_VALUES = new Set([
  "component",
  "function_unit",
  "subsystem",
  "system",
]);

function normalizeObjectLevel(value) {
  const text = String(value ?? "").trim().toLowerCase();

  if (OBJECT_LEVEL_VALUES.has(text)) {
    return text;
  }

  const aliasMap = {
    sub_system: "subsystem",
    subsystem_level: "subsystem",
    module: "function_unit",
    function: "function_unit",
    function_module: "function_unit",
    unit: "function_unit",
    part: "component",
    element: "component",
    device: "component",
    entity: "component",
    object: "component",
  };

  return aliasMap[text] ?? "component";
}
```

注意：

- 不允许非法 `object_level` 进入 `function_analysis`
- 不允许 `object_level` 是数组
- 不允许 `object_level` 为空
- 每个 object 有且只有一个 `object_level` 字符串值
- 无法识别时兜底为 `component`

### 5. 回写时保留原字段

必须使用展开写法：

```js
state.fused_objects = alignedObjects.map((object) => ({
  ...object,
  object_level: normalizeObjectLevel(object.object_level),
}));
```

禁止重建成只包含少数字段的新对象，例如禁止：

```js
{
  object_id: object.object_id,
  name: object.name,
  object_level: ...
}
```

这样会丢失原对象字段。

### 6. schema 限制

如果项目已有 JSON Schema、Zod、responseSchema、structuredOutput、safeParse 等机制，请复用现有机制。

在 `granularityAlignStage(...)` 的 LLM 输出处增加 schema 约束：

```js
object_level: {
  type: "string",
  enum: [
    "component",
    "function_unit",
    "subsystem",
    "system"
  ]
}
```

schema 是第一道限制，`normalizeObjectLevel(...)` 是第二道兜底，二者都要保留。

## 修改 workflowV2Stages.js

在：

```js
object_fusion
```

后面新增：

```js
{
  key: "granularity_align",
  short: "05",
  title: "粒度对齐",
  detail: "对融合后的对象做层级/粒度归一，标注 component、function_unit、subsystem、system",
  retryable: true,
  entryCriteria: ["fused objects 已生成"],
  exitCriteria: ["object_level 已生成", "object_level 已归一"],
}
```

然后把后续阶段编号顺延：

```text
function_analysis -> 06
object_decompose -> 07
graph_build -> 08
ablation_analysis -> 09
```

不要破坏：

```text
WORKFLOW_V2_STAGE_KEYS
stage_results
snapshot
retry
error handling
```

## 禁止事项

不要修改最终 result 顶层结构。

禁止新增这些顶层字段：

```text
object_levels
l0_l4_graph
ontology_graph
pending_edges
```

允许的最终输出变化只有：

```js
result.objects[i].object_level
```

## 验收标准

完成后必须满足：

1. V2 stages 中出现 `granularity_align`
2. 执行顺序为：

```text
object_fusion -> granularity_align -> function_analysis
```

3. 每个进入 `function_analysis` 的 object 都有合法 `object_level`
4. 最终 `result.objects` 中每个 object 都有合法 `object_level`
5. `object_level` 只能是：

```text
component
function_unit
subsystem
system
```

6. 不改变现有 result 顶层结构
7. 不丢失原 object 字段
8. 不影响现有 snapshot、stage_results、异常处理和 ablation_analysis
