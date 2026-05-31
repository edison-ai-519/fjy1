import React, { type ReactNode } from 'react';
import { Boxes, Layers3, Network, SplitSquareVertical } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { WorkflowV2SystemDecompositionView, WorkflowV2SystemStructureNode } from './fileWorkflowV2View';

void React;

function renderStructureNode(node: WorkflowV2SystemStructureNode): ReactNode {
  const isRoot = node.depth === 0;
  const isLeaf = node.isLeaf;

  return (
    <div
      key={node.id}
      className={cn(
        'min-w-0 overflow-hidden rounded-[28px] border p-4 shadow-sm transition-colors',
        isRoot
          ? 'border-primary/30 bg-primary/5'
          : isLeaf
            ? 'border-border/60 bg-background/75'
            : 'border-sky-500/20 bg-background/85',
      )}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="break-words text-sm font-black leading-6 text-foreground sm:text-base">
            {node.name}
          </div>
          <div className="mt-1 break-words text-xs text-muted-foreground">
            {node.normalizedName || '未提供 normalized_name'}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {node.objectLevel ? (
            <Badge variant="secondary" className="rounded-full">
              {node.objectLevel}
            </Badge>
          ) : null}
          <Badge variant={isRoot ? 'default' : 'outline'} className="rounded-full">
            {isRoot ? '根节点' : isLeaf ? '叶子节点' : `${node.childCount} 个子级`}
          </Badge>
        </div>
      </div>

      {node.coreFunction ? (
        <div className={cn(
          'mt-3 rounded-2xl border px-3 py-2 text-sm leading-6',
          isRoot
            ? 'border-primary/20 bg-background/70 text-foreground/90'
            : 'border-emerald-500/20 bg-emerald-500/5 text-foreground/85',
        )}
        >
          {node.coreFunction}
        </div>
      ) : (
        <div className="mt-3 rounded-2xl border border-dashed border-border/60 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
          当前节点还没有核心功能摘要。
        </div>
      )}

      {node.children.length > 0 ? (
        <div className={cn('mt-4 grid gap-3', isRoot ? 'lg:grid-cols-2' : 'grid-cols-1')}>
          {node.children.map((child) => renderStructureNode(child))}
        </div>
      ) : null}

      {node.hiddenDescendantCount > 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-border/70 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
          还有 {node.hiddenDescendantCount} 个下级未展开。
        </div>
      ) : null}
    </div>
  );
}

export function WorkflowV2SystemDecompositionPanel({
  view,
}: {
  view: WorkflowV2SystemDecompositionView;
}) {
  const legacyRoot = (view as WorkflowV2SystemDecompositionView & { root?: WorkflowV2SystemStructureNode | null }).root ?? null;
  const roots = Array.isArray(view.roots) ? view.roots : (legacyRoot ? [legacyRoot] : []);
  const clusterCount = typeof view.summary.clusterCount === 'number' && Number.isFinite(view.summary.clusterCount)
    ? view.summary.clusterCount
    : roots.length;

  if (roots.length === 0 || view.summary.containmentCount === 0) {
    return (
      <div className="rounded-[28px] border border-dashed border-border/70 bg-background/65 p-6 text-sm text-muted-foreground">
        {view.emptyReason || '当前还没有足够的包含关系来生成系统拆解视图。'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Boxes className="h-4 w-4 text-primary" />
            拆解簇
          </div>
          <div className="mt-2 text-sm font-black">{clusterCount} 组</div>
          <div className="mt-1 break-words text-xs text-muted-foreground">
            {roots.slice(0, 3).map((node) => node.name).join(' / ')}
            {roots.length > 3 ? ` 等 ${roots.length} 个根节点` : ''}
          </div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Network className="h-4 w-4 text-sky-600" />
            包含边
          </div>
          <div className="mt-2 text-sm font-black">{view.summary.containmentCount}</div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Layers3 className="h-4 w-4 text-emerald-600" />
            展开层级
          </div>
          <div className="mt-2 text-sm font-black">{view.summary.maxDepth} 层</div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <SplitSquareVertical className="h-4 w-4 text-amber-600" />
            叶子节点
          </div>
          <div className="mt-2 text-sm font-black">{view.summary.leafCount}</div>
        </div>
      </div>

      <div className="rounded-[30px] border border-primary/20 bg-gradient-to-b from-primary/5 to-background/80 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="rounded-full">默认展开 {view.summary.maxDepth} 层</Badge>
          {view.summary.hiddenDescendantCount > 0 ? (
            <Badge variant="secondary" className="rounded-full">
              仍有 {view.summary.hiddenDescendantCount} 个下级折叠
            </Badge>
          ) : null}
          <Badge variant="outline" className="rounded-full">结构树优先</Badge>
          <Badge variant="outline" className="rounded-full">根节点 {clusterCount}</Badge>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {roots.map((root) => renderStructureNode(root))}
        </div>
      </div>
    </div>
  );
}
