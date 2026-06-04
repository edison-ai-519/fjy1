# 05 验收与回归检查清单

## 目标

对本次 L0-L4 本体层级图谱改造进行完整验收和回归检查。

本次改造包含：

1. 后端接入 `granularity_align`
2. 强制生成合法 `object_level`
3. `object_decompose` 增加层级关系约束
4. 前端新增 L0-L4 图谱适配层
5. 原结构验证图增加切换按钮

## 一、后端主流程验收

### 预期流程

文件工作流 V2 主流程必须为：

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

### 检查点

确认：

```text
object_fusion -> granularity_align -> function_analysis
```

顺序正确。

确认 `workflowV2Stages.js` 中有：

```text
granularity_align
```

确认阶段编号：

```text
chunk_parse        01
chunk_filter       02
window_extract     03
object_fusion      04
granularity_align  05
function_analysis  06
object_decompose   07
graph_build        08
ablation_analysis  09
```

## 二、object_level 验收

### 合法值

每个 object 必须有且只有一个：

```js
object_level
```

合法值只能是：

```text
component
function_unit
subsystem
system
```

### 检查代码

在最终 result 中检查：

```js
for (const object of result.objects) {
  console.assert(typeof object.object_level === "string");
  console.assert([
    "component",
    "function_unit",
    "subsystem",
    "system",
  ].includes(object.object_level));
}
```

### 不允许出现

```text
module
part
unit
sub_system
function
device
element
null
undefined
[]
{}
""
```

如果 LLM 输出这些值，必须被后端 normalize 为合法值。

## 三、最终 result 结构验收

### 不允许改变顶层结构

最终大 JSON 顶层结构仍保持现有形式。

允许：

```js
result.objects[i].object_level
```

不允许新增顶层：

```text
result.object_levels
result.l0_l4_graph
result.ontology_graph
result.pending_edges
result.skipped_edges
```

### 检查点

确认以下现有字段仍然存在且结构不变：

```text
objects
edges
chunks
windows
ablation
meta
stage_results
```

具体以当前项目已有 result 结构为准，不要因为本次改造破坏旧字段。

## 四、object_decompose 关系约束验收

### 允许关系

进入 `graph_build` 的 contains 边应尽可能只包含：

```text
system -> subsystem
subsystem -> function_unit
function_unit -> component
```

### 检查逻辑

根据 edge 的 source/target 找 object：

```js
const objectById = new Map(result.objects.map((object) => [
  object.object_id,
  object,
]));
```

对 contains 边检查：

```js
function isAllowedContainsEdge(sourceObject, targetObject) {
  return (
    sourceObject.object_level === "system" &&
    targetObject.object_level === "subsystem"
  ) || (
    sourceObject.object_level === "subsystem" &&
    targetObject.object_level === "function_unit"
  ) || (
    sourceObject.object_level === "function_unit" &&
    targetObject.object_level === "component"
  );
}
```

### 不允许强行进入 graph_build

以下关系不能直接进入 graph_build：

```text
system -> function_unit
system -> component
subsystem -> component
component -> function_unit
function_unit -> subsystem
subsystem -> system
```

这些关系如果有证据，可以记录为 pending/skipped，但不要伪造中间节点。

## 五、L0 固定原子验收

### L0 只能有 5 个

L0 固定为：

```text
时间
空间
事件
数量
能量
```

### 不允许出现旧 L0

禁止出现：

```text
地点
关系
属性
条件
边界
```

### 检查点

在 L0-L4 图谱中检查：

```js
const l0Nodes = nodes.filter((node) => node.layer === "L0");
console.assert(l0Nodes.length === 5);
console.assert(l0Nodes.every((node) => [
  "时间",
  "空间",
  "事件",
  "数量",
  "能量",
].includes(node.label)));
```

## 六、L1-L0 关系验收

### 规则

L1 节点来自：

```text
object_level === "component"
```

L1 要尽可能多地连接 L0。

L1 到 L0 只能使用关键词/证据规则，不调用模型。

### L0 关键词

#### 时间

```text
时间、日期、周期、阶段、时刻、频率、延迟、持续、开始、结束、先后、同步、异步
```

#### 空间

```text
空间、区域、范围、位置、坐标、布局、方向、距离、路径、容量、体积、面积、高度、宽度、长度
```

#### 事件

```text
事件、触发、请求、响应、报警、故障、执行、动作、启动、停止、切换、异常、变化、运行、调用
```

#### 数量

```text
数量、数值、阈值、比例、频率、参数、大小、长度、宽度、高度、重量、个数、次数、速率、精度
```

#### 能量

```text
能量、功率、电压、电流、电能、热量、热能、机械能、动能、势能、压力、温度、流量、负载、消耗、供能、耗能、转换效率
```

### 检查点

1. L1 可以连接多个 L0
2. L1 要有主归类 `primary_atom`
3. L1-L0 边要有 evidence
4. 没有证据时标记 pending
5. 不允许伪造 L1-L0 边

## 七、L0-L4 图谱布局验收

### 层级顺序

视觉上必须从上到下展示：

```text
L0
L1
L2
L3
L4
```

其中：

```text
L0 = 时间 / 空间 / 事件 / 数量 / 能量
L1 = component
L2 = function_unit
L3 = subsystem
L4 = system
```

### 检查点

1. 每个节点都有 layer 字段
2. 同一个 layer 的节点在同一水平层
3. 不同 layer 不混排
4. L0 在最上方
5. L4 在最下方
6. 层间有线连接
7. pending 节点或边能被识别

## 八、图谱切换按钮验收

### 必须有两个模式

```text
结构图
L0-L4 本体图
```

### 检查点

1. 默认结构图仍然可用
2. 点击按钮可以切换到 L0-L4 本体图
3. 再点击可以切回结构图
4. 原结构图 nodes/edges 不被修改
5. 原结构图布局不被修改
6. 原结构图交互不受影响
7. L0-L4 图谱使用独立 adapter 生成

## 九、边方向验收

### 后端

后端 result.edges 仍保持 contains 原方向：

```text
父级 -> 子级
```

例如：

```text
system -> subsystem
subsystem -> function_unit
function_unit -> component
```

### 前端 L0-L4 图

L0-L4 图可以派生 supports 方向：

```text
component -> function_unit
function_unit -> subsystem
subsystem -> system
```

同时：

```text
component -> L0 atom
```

### 检查点

1. 不修改 result.edges
2. L0-L4 图中派生边必须带：

```text
derived_from: "contains"
```

或：

```text
derived_from: "l0_keyword_rule"
```

3. 原结构图不使用 L0-L4 派生边

## 十、回归检查

确认以下能力没有被破坏：

```text
旧文件工作流 V2 可正常执行
stage_results 正常
snapshot 正常
重试机制正常
异常处理正常
原结构验证图正常
graph_build DAG 化正常
ablation_analysis 正常
最终 result 顶层结构正常
```

## 十一、最终验收标准总表

完成后必须满足：

1. `granularity_align` 已接入主流程
2. `granularity_align` 位于 `object_fusion` 和 `function_analysis` 之间
3. 每个 object 都有合法 `object_level`
4. `object_level` 只能是：

```text
component
function_unit
subsystem
system
```

5. `object_decompose` 使用 `object_level` 约束 contains 关系
6. 进入 `graph_build` 的 contains 边尽可能满足：

```text
system -> subsystem
subsystem -> function_unit
function_unit -> component
```

7. L0 固定为：

```text
时间
空间
事件
数量
能量
```

8. 不出现旧 L0：

```text
地点
关系
属性
条件
边界
```

9. 新增 L0-L4 图谱视图
10. 原结构验证图仍然保留
11. 有按钮可以切换：

```text
结构图
L0-L4 本体图
```

12. L0-L4 图谱从上到下展示：

```text
L0
L1
L2
L3
L4
```

13. 每层节点水平对齐
14. L1 尽可能多地连接 L0
15. L1-L0 关系使用关键词证据，不调用模型
16. 证据不足标记 pending，不伪造关系
17. 不改变最终 result 顶层结构
18. 不影响现有功能
