# 04 前端图谱切换按钮与 L0-L4 布局

## 目标

在原有结构验证图基础上新增一个按钮，用于在两个图谱之间切换：

1. 原结构验证图
2. L0-L4 本体层级图

要求不删除、不替换、不破坏原结构验证图。

## 修改范围

请搜索当前结构验证图相关组件，例如：

```text
结构验证图
StructureValidationGraph
workflow V2 graph
ReactFlow
nodes
edges
graph view
validation graph
```

并在合适组件中增加图谱模式切换。

## UI 要求

新增一个切换按钮或分段按钮：

```text
结构图
L0-L4 本体图
```

状态示例：

```ts
const [graphMode, setGraphMode] = useState<"structure" | "l0l4">("structure");
```

按钮逻辑：

```tsx
<button onClick={() => setGraphMode("structure")}>
  结构图
</button>

<button onClick={() => setGraphMode("l0l4")}>
  L0-L4 本体图
</button>
```

实际样式请复用项目已有按钮组件。

## 数据来源

### 结构图

继续使用原来的 nodes/edges 和原布局逻辑。

不要改原逻辑。

### L0-L4 本体图

使用新适配层生成：

```ts
buildWorkflowV2L0L4Graph({
  objects: result.objects,
  edges: result.edges,
});
```

具体函数名可以按项目风格调整。

## 渲染要求

根据 graphMode 决定渲染数据：

```ts
const graphData = graphMode === "structure"
  ? structureGraphData
  : l0l4GraphData;
```

## L0-L4 布局要求

L0-L4 图谱必须从上到下展示：

```text
L0
L1
L2
L3
L4
```

每个 Lx 层的数据必须在同一水平层。

建议使用固定 layer y 坐标：

```ts
const LAYER_Y = {
  L0: 0,
  L1: 180,
  L2: 360,
  L3: 540,
  L4: 720,
};
```

每一层内部横向排列：

```ts
x = index * horizontalGap
y = LAYER_Y[layer]
```

可以根据节点数量居中：

```ts
const totalWidth = (nodesInLayer.length - 1) * horizontalGap;
const x = index * horizontalGap - totalWidth / 2;
```

如果当前项目已有 dagre/layout 工具，也可以复用，但必须强制同层节点使用同一个 rank/layer。

## L0-L4 视觉展示要求

节点应显示：

```text
节点名称
层级 L0/L1/L2/L3/L4
object_level
pending 状态，如果有
```

L0 节点应明显显示为固定本体原子。

L1-L4 节点显示原 object 名称。

边应显示或保留：

```text
type
derived_from
evidence
status
```

## 边方向

后端 result.edges 中 contains 是：

```text
父级 -> 子级
```

L0-L4 图谱中可以展示为支撑方向：

```text
L1 -> L2 -> L3 -> L4
```

L1 到 L0 使用：

```text
L1 -> L0
```

但视觉布局仍然保持：

```text
L0 最上
L1
L2
L3
L4 最下
```

也就是说，边可以向上连，但层级必须从上到下固定展示。

## 不要破坏原图

必须保证：

1. 默认仍然显示原结构验证图，除非当前项目更适合默认展示上一次选择
2. 原结构验证图 nodes/edges 不被 L0-L4 adapter 污染
3. 原结构验证图布局不变
4. 原结构验证图点击、缩放、拖拽、tooltip、详情面板等功能不受影响
5. L0-L4 图谱切换回来后，原图仍可正常使用

## 空数据处理

如果 `result.objects` 为空：

```text
L0-L4 本体图暂无对象数据
```

但仍可展示 L0 固定原子，具体按当前 UI 风格决定。

如果没有合法 `object_level`：

```text
暂无可分层对象，请先完成粒度对齐
```

如果 L1 没有匹配到 L0：

```text
显示 L1 节点，但标记 pending
```

## 禁止事项

1. 不要删除原结构图
2. 不要把 L0-L4 图谱数据写回后端 result
3. 不要修改原 result.edges 方向
4. 不要让结构图使用 L0-L4 的派生边
5. 不要让 L0-L4 图谱使用旧 L0 节点：

```text
地点
关系
属性
条件
边界
```

## 验收标准

完成后必须满足：

1. 页面上可以看到图谱切换按钮
2. 可以在“结构图”和“L0-L4 本体图”之间切换
3. 原结构图仍然可用
4. L0-L4 图谱显示五层：

```text
L0
L1
L2
L3
L4
```

5. 每层节点水平对齐
6. L0 只显示：

```text
时间
空间
事件
数量
能量
```

7. L1-L4 节点来自 `result.objects`
8. L1-L4 层级来自 `object_level`
9. 层间有线连接
10. L1 尽可能多地连接 L0
11. 证据不足的节点或边显示 pending
12. 不改变后端最终 result 顶层结构
