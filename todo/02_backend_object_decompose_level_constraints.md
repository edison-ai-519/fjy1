# 02 后端 object_decompose 层级关系约束

## 目标

在 `object_decompose` 关系抽取阶段增加层级约束，让关系抽取尽可能形成稳定的 L1-L4 结构关系，为后续 L0-L4 本体图谱提供合法边。

## 背景

`granularity_align` 已经为每个 object 增加：

```js
object_level
```

合法值只有：

```text
component
function_unit
subsystem
system
```

对应层级：

| object_level | 层级 |
| --- | --- |
| component | L1 |
| function_unit | L2 |
| subsystem | L3 |
| system | L4 |

`object_decompose` 主要负责对象拆解和 contains 关系抽取。

现在需要让 `object_decompose` 基于 `object_level` 约束 contains 边。

## 后端 contains 方向

后端原始结构边仍然保持：

```text
父级 -> 子级
```

也就是：

```text
L4 -> L3 -> L2 -> L1
```

不要在后端把 contains 反向改成 supports。

前端 L0-L4 图谱可以在视图层派生反向 supports 边，但后端原始 edges 不要改方向。

## 允许的 contains 关系

只允许相邻层级直接组成关系：

```text
system        -> subsystem
subsystem     -> function_unit
function_unit -> component
```

对应：

```text
L4 -> L3
L3 -> L2
L2 -> L1
```

## 禁止或降级为 pending/skipped 的关系

以下关系不允许直接进入 `graph_build`：

```text
system -> function_unit
system -> component
subsystem -> component
component -> function_unit
function_unit -> subsystem
subsystem -> system
component -> subsystem
component -> system
function_unit -> system
```

也就是：

1. 禁止反向 contains
2. 禁止跨多层 contains
3. 禁止证据不足时强行补边
4. 禁止伪造中间节点
5. 禁止为了连通图谱强行生成关系

## 修改范围

优先搜索并修改：

```text
object_decompose
objectDecomposeStage
decomposition edges
graph_build
workflowV2Service.mjs
```

## 新增校验函数

请增加类似函数：

```js
function isAllowedContainsEdge(sourceObject, targetObject) {
  const sourceLevel = sourceObject?.object_level;
  const targetLevel = targetObject?.object_level;

  return (
    sourceLevel === "system" &&
    targetLevel === "subsystem"
  ) || (
    sourceLevel === "subsystem" &&
    targetLevel === "function_unit"
  ) || (
    sourceLevel === "function_unit" &&
    targetLevel === "component"
  );
}
```

## 在 object_decompose 输出后过滤关系

LLM 或规则抽出来的关系不能直接进入 `graph_build`。

必须执行后端校验：

```js
const objectById = new Map(
  state.fused_objects.map((object) => [object.object_id, object])
);

const validEdges = [];
const skippedEdges = [];

for (const edge of decompositionEdges) {
  const sourceId = edge.source_object_id ?? edge.source ?? edge.from;
  const targetId = edge.target_object_id ?? edge.target ?? edge.to;

  const sourceObject = objectById.get(sourceId);
  const targetObject = objectById.get(targetId);

  if (isAllowedContainsEdge(sourceObject, targetObject)) {
    validEdges.push({
      ...edge,
      relation_type: "contains",
    });
  } else {
    skippedEdges.push({
      ...edge,
      status: "pending",
      reason: "object_level 不满足相邻层级 contains 约束",
      source_object_level: sourceObject?.object_level ?? "",
      target_object_level: targetObject?.object_level ?? "",
    });
  }
}
```

最终进入 `graph_build` 的只能是：

```js
validEdges
```

## pending/skipped 信息放置位置

不要新增最终 result 顶层字段。

不要新增：

```text
result.pending_edges
result.skipped_edges
result.l0_l4_graph
```

可以把统计信息放在当前 stage result 或 summary 中，例如：

```js
{
  pending_decomposition_edge_count,
  skipped_invalid_edge_count,
  valid_decomposition_edge_count
}
```

## 修改 object_decompose prompt

请在 `object_decompose` 阶段的 LLM prompt 中加入约束：

```text
你只能抽取相邻层级的直接 contains 关系。

source 必须是父级对象。
target 必须是直接子级对象。

允许：
- system contains subsystem
- subsystem contains function_unit
- function_unit contains component

禁止：
- 跨层 contains
- 反向 contains
- 证据不足的 contains
- 为了连通图谱伪造中间对象或中间关系

如果文档只暗示跨层关系，但没有中间层证据，不要强行连边。
这类候选关系应交给后端记录为 pending/skipped。
```

## schema 要求

如果 object_decompose 有结构化输出 schema，请限制关系类型：

```js
relation_type: {
  type: "string",
  enum: ["contains"]
}
```

但注意：

schema 很难表达 source 和 target 的层级差，所以必须保留后端 `isAllowedContainsEdge(...)` 校验。

## 对 L0 的说明

`object_decompose` 不负责 L0。

L0 是固定常量：

```text
时间
空间
事件
数量
能量
```

L1 到 L0 的关系由前端 L0-L4 图谱适配层使用关键词规则生成，不调用模型。

## 验收标准

完成后必须满足：

1. `object_decompose` 使用 `object_level` 约束 contains 边
2. 进入 `graph_build` 的 contains 边尽可能只包含：

```text
system -> subsystem
subsystem -> function_unit
function_unit -> component
```

3. 跨层、反向、证据不足的关系不会强行进入 `graph_build`
4. 不伪造中间节点
5. 不改变最终 result 顶层结构
6. skipped/pending 只进入 stage result 或 summary
7. 原有 graph_build DAG 化逻辑仍然可用
8. 原有结构验证图不受破坏
