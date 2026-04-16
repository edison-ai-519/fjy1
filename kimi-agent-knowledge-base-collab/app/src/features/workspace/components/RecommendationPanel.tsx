import { Star } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function RecommendationPanel() {
  return (
    <Card className="border-border/40 bg-card/60 backdrop-blur-md text-foreground rounded-3xl overflow-hidden shadow-2xl relative">
      <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-background to-transparent pointer-events-none" />
      <CardContent className="p-8 relative z-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="space-y-3 text-center md:text-left">
            <h3 className="text-2xl font-black flex items-center gap-3 justify-center md:justify-start tracking-tight text-foreground/90">
              <Star className="h-6 w-6 text-amber-500 drop-shadow-[0_0_8px_rgba(251,191,36,0.3)]" />
              本体推荐与分发系统
            </h3>
            <p className="text-[13px] text-muted-foreground max-w-md font-medium leading-relaxed">
              支持官方权威版本锁定与社区活跃推荐。点击下方的“获取快照”，我们可以为您提取 XiaoGuGit 当前项目最受认可的结构化快照。
            </p>
          </div>
          <div className="flex flex-wrap gap-4 justify-center">
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 h-11 px-6 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg">官方推荐快照</Button>
            <Button variant="outline" className="border-border/40 hover:bg-muted/50 gap-2 h-11 px-6 rounded-2xl font-black uppercase tracking-widest text-[10px] bg-background">社会化推荐排行</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
