export const WORKFLOW_V2_STAGE_DEFINITIONS = [
  {
    key: "chunk_parse",
    short: "01",
    title: "分块",
    detail: "自然段切块与短块归并",
    retryable: false,
    entryCriteria: ["文件文本可读取"],
    exitCriteria: ["chunks 已生成", "offset 已记录"],
  },
  {
    key: "chunk_filter",
    short: "02",
    title: "预筛",
    detail: "预筛高信息 chunk 供后续组窗",
    retryable: true,
    entryCriteria: ["chunks 已生成"],
    exitCriteria: ["selected chunk ids 已生成", "filtered chunks 已生成"],
  },
  {
    key: "window_extract",
    short: "03",
    title: "窗口抽取",
    detail: "滑动窗口并行抽取对象",
    retryable: true,
    entryCriteria: ["filtered chunks 已生成"],
    exitCriteria: ["windows 已生成", "window objects 已生成"],
  },
  {
    key: "object_fusion",
    short: "04",
    title: "对象融合",
    detail: "同名直合并，近义对象裁决",
    retryable: true,
    entryCriteria: ["window objects 已生成"],
    exitCriteria: ["fused objects 已生成"],
  },
  {
    key: "granularity_align",
    short: "05",
    title: "粒度对齐",
    detail: "对融合后的对象做层级/粒度归一，标注 component、function_unit、subsystem、system",
    retryable: true,
    entryCriteria: ["fused objects 已生成"],
    exitCriteria: ["object_level 已生成", "object_level 已归一"],
  },
  {
    key: "function_analysis",
    short: "06",
    title: "功能分析",
    detail: "基于 citation 提取对象核心功能",
    retryable: true,
    entryCriteria: ["fused objects 已生成"],
    exitCriteria: ["function objects 已生成"],
  },
  {
    key: "object_decompose",
    short: "07",
    title: "对象拆解",
    detail: "基于 citation 提取直接组成关系",
    retryable: true,
    entryCriteria: ["function objects 已生成"],
    exitCriteria: ["decomposition edges 已生成"],
  },
  {
    key: "graph_build",
    short: "08",
    title: "图构建",
    detail: "构建 contains DAG 并消解环",
    retryable: true,
    entryCriteria: ["decomposition edges 已生成"],
    exitCriteria: ["edges 已生成", "图已 DAG 化"],
  },
  {
    key: "ablation_analysis",
    short: "09",
    title: "消融",
    detail: "按核心功能标准做兄弟/父级影响分析",
    retryable: true,
    entryCriteria: ["DAG 已生成"],
    exitCriteria: ["ablation summaries 已生成"],
  },
];

export const WORKFLOW_V2_STAGE_KEYS = WORKFLOW_V2_STAGE_DEFINITIONS.map((stage) => stage.key);

export function getWorkflowV2StageDefinition(stageKey) {
  return WORKFLOW_V2_STAGE_DEFINITIONS.find((stage) => stage.key === stageKey) ?? null;
}
