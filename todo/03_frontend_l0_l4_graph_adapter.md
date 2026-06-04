# 03 前端 L0-L4 图谱适配层

## 目标

新增 L0-L4 本体层级图谱适配逻辑。

该适配层基于现有最终结果：

```js
result.objects
result.edges
```

生成一个前端专用的 L0-L4 图谱数据。

不要修改后端最终 result 顶层结构。

## L0 固定常量

L0 不从文档抽取，不调用模型生成。

L0 只允许包含以下五个本体原子：

```ts
export const L0_ATOMS = [
  "时间",
  "空间",
  "事件",
  "数量",
  "能量",
] as const;
```

禁止出现以下旧 L0：

```text
地点
关系
属性
条件
边界
```

## L1-L4 映射

根据 `object_level` 映射：

```ts
export const OBJECT_LEVEL_TO_LAYER = {
  component: "L1",
  function_unit: "L2",
  subsystem: "L3",
  system: "L4",
} as const;
```

对应关系：

| object_level | layer |
| --- | --- |
| component | L1 |
| function_unit | L2 |
| subsystem | L3 |
| system | L4 |

## 修改范围

优先搜索：

```text
workflowV2L0L4View.ts
graph adapter
structure validation graph
nodes edges adapter
ReactFlow
Dagre
layout graph
```

如果已有 `workflowV2L0L4View.ts`，请在其中实现。

如果没有，请按当前项目结构新增类似文件，例如：

```text
app/src/.../workflowV2L0L4View.ts
```

## 适配层输入

适配层输入应该是现有结果：

```ts
type BuildL0L4GraphInput = {
  objects: any[];
  edges: any[];
};
```

不要依赖新增后端顶层字段。

## 适配层输出

输出前端图谱使用的 nodes / edges，例如：

```ts
type L0L4GraphNode = {
  id: string;
  label: string;
  layer: "L0" | "L1" | "L2" | "L3" | "L4";
  object_level?: "component" | "function_unit" | "subsystem" | "system";
  source_object_id?: string;
  status?: "normal" | "pending";
  evidence?: string[];
};

type L0L4GraphEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  derived_from?: "contains" | "l0_keyword_rule";
  status?: "normal" | "pending";
  evidence?: string[];
};
```

字段名可按现有图组件要求调整，但必须保留 layer 信息。

## 节点生成规则

### L0 节点

固定生成 5 个：

```text
L0:时间
L0:空间
L0:事件
L0:数量
L0:能量
```

每个节点：

```ts
{
  id: `l0:${atom}`,
  label: atom,
  layer: "L0"
}
```

### L1 节点

来自：

```ts
object.object_level === "component"
```

每个节点 layer 为：

```ts
"L1"
```

### L2 节点

来自：

```ts
object.object_level === "function_unit"
```

每个节点 layer 为：

```ts
"L2"
```

### L3 节点

来自：

```ts
object.object_level === "subsystem"
```

每个节点 layer 为：

```ts
"L3"
```

### L4 节点

来自：

```ts
object.object_level === "system"
```

每个节点 layer 为：

```ts
"L4"
```

## L1 到 L0 的关键词规则

L1 要尽可能多地连接 L0，因为 L0 是组成 L1 的基本要素。

L1 到 L0 不调用模型，只使用关键词/证据规则。

### 时间

关键词：

```text
时间、日期、周期、阶段、时刻、频率、延迟、持续、开始、结束、先后、同步、异步
```

### 空间

关键词：

```text
空间、区域、范围、位置、坐标、布局、方向、距离、路径、容量、体积、面积、高度、宽度、长度
```

### 事件

关键词：

```text
事件、触发、请求、响应、报警、故障、执行、动作、启动、停止、切换、异常、变化、运行、调用
```

### 数量

关键词：

```text
数量、数值、阈值、比例、频率、参数、大小、长度、宽度、高度、重量、个数、次数、速率、精度
```

### 能量

关键词：

```text
能量、功率、电压、电流、电能、热量、热能、机械能、动能、势能、压力、温度、流量、负载、消耗、供能、耗能、转换效率
```

## L1-L0 关系生成要求

1. 一个 L1 可以连接多个 L0
2. 必须选一个主归类 `primary_atom`
3. 必须保留匹配证据，例如命中的关键词
4. 找不到任何 L0 证据时，L1 节点标记 pending
5. 不允许伪造 L1-L0 边
6. L1-L0 边类型可以是：

```text
mapped_to_atom
classified_as
grounded_in
```

推荐：

```ts
{
  source: l1NodeId,
  target: l0NodeId,
  type: "mapped_to_atom",
  derived_from: "l0_keyword_rule",
  evidence: matchedKeywords
}
```

## L1-L4 关系生成规则

L1-L4 的关系主要来自后端最终：

```js
result.edges
```

后端 contains 边方向是：

```text
父级 -> 子级
```

例如：

```text
system -> subsystem
subsystem -> function_unit
function_unit -> component
```

在 L0-L4 图谱中，为表达“基本要素支撑上层对象”，可以在前端派生反向边：

```text
component -> function_unit
function_unit -> subsystem
subsystem -> system
```

关系类型建议：

```text
supports
```

并保留来源：

```ts
derived_from: "contains"
```

注意：

1. 不要修改原始 result.edges
2. 只在 L0-L4 适配层中派生反向边
3. 原结构验证图仍然使用原始边
4. L0-L4 图谱使用派生边

## 图层顺序

新图谱从上到下展示：

```text
L0
L1
L2
L3
L4
```

注意：

虽然 supports 边可能是 L1 -> L2 -> L3 -> L4，但视觉层级必须是：

```text
L0 在最上方
L1 在 L0 下方
L2 在 L1 下方
L3 在 L2 下方
L4 在最下方
```

## 禁止事项

1. 不要把 L0 写回后端 result.objects
2. 不要新增 result.l0_l4_graph
3. 不要新增 result.ontology_graph
4. 不要修改 result.edges 方向
5. 不要让旧 L0 节点出现：

```text
地点
关系
属性
条件
边界
```

6. 不要调用模型生成 L0
7. 不要伪造没有证据的 L1-L0 边

## 验收标准

完成后必须满足：

1. L0 节点固定为 5 个：

```text
时间
空间
事件
数量
能量
```

2. L0 节点不从文档抽取
3. L1-L4 由 `object_level` 映射得到
4. 每个节点有 `layer`
5. 每个 Lx 层节点能被布局到同一水平层
6. L1 尽可能多地通过关键词规则连接 L0
7. L1-L0 关系保留 evidence
8. L1-L4 关系从 result.edges 派生
9. 不污染原结构验证图数据
10. 不改变后端最终 result 顶层结构
