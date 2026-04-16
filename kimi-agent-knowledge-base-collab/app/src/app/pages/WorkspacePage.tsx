import { GitBranch } from 'lucide-react';

import { XiaoGuGitDashboard } from '@/components/XiaoGuGitDashboard';
import { ScrollArea } from '@/components/ui/scroll-area';

export function WorkspacePage() {
  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        <div className="rounded-3xl border border-border/40 bg-card/60 backdrop-blur-md shadow-lg overflow-hidden mb-6">
          <div className="px-6 py-8 lg:px-10 bg-gradient-to-r from-primary/5 via-background to-transparent relative">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-primary/80">
              <GitBranch className="w-3.5 h-3.5" />
              统一本体工作台 (Unified Workspace)
            </div>
            <h2 className="mt-4 text-3xl font-black tracking-tight text-foreground/90">
              本体版本管理与实时编辑
            </h2>
            <p className="mt-2 text-sm text-muted-foreground max-w-2xl font-medium">
              取代了旧版的离线编辑器。支持 Git 级的历史记录管理，并在每次写入时自动触发概率推理服务。
            </p>
            <div className="absolute right-10 top-1/2 -translate-y-1/2 opacity-[0.03] pointer-events-none">
              <GitBranch className="w-40 h-40" />
            </div>
          </div>
        </div>
        <XiaoGuGitDashboard />
      </div>
    </ScrollArea>
  );
}
