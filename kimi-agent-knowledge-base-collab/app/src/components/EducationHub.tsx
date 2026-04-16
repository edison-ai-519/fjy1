import { useEffect, useState } from 'react';
import { BookOpen, Clock3, GraduationCap, Lightbulb, Orbit } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fetchEducationContent, type EducationContent } from '@/features/ontology/api';
import type { Entity } from '@/types/ontology';

interface EducationHubProps {
  selectedEntity: Entity | null;
}

export function EducationHub({ selectedEntity }: EducationHubProps) {
  const [content, setContent] = useState<EducationContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    fetchEducationContent(selectedEntity?.id)
      .then((result) => {
        if (!active) return;
        setContent(result);
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : '加载科普内容失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedEntity?.id]);

  if (loading) {
    return <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">正在加载科普内容...</div>;
  }

  if (error || !content) {
    return <div className="rounded-2xl border bg-card p-6 text-sm text-destructive">{error || '暂无科普内容'}</div>;
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-x border-b border-border/40 bg-card/60 backdrop-blur-md shadow-lg relative">
        <div className="bg-gradient-to-br from-primary/10 via-background to-transparent border-b border-border/10 p-8 lg:p-12 relative overflow-hidden rounded-t-[inherit] -mt-[1px] -mx-[1px]">
          <div className="absolute right-0 top-0 opacity-[0.03] pointer-events-none -translate-y-1/2 translate-x-1/4">
            <GraduationCap className="w-64 h-64" />
          </div>
          <div className="relative z-10 space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-primary/80">
              <GraduationCap className="h-3.5 w-3.5" />
              科普导读
            </div>
            <CardTitle className="text-4xl font-black tracking-tight leading-tight">{content.featured_topic.title}</CardTitle>
            <CardDescription className="text-sm leading-7 text-muted-foreground/80 max-w-3xl font-medium">
              {content.featured_topic.summary}
            </CardDescription>
          </div>
        </div>
        <CardContent className="grid gap-6 p-8 md:grid-cols-[1.2fr_0.8fr]">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Lightbulb className="h-4 w-4 text-primary" />
              看完这部分你应该能抓住
            </div>
            <div className="space-y-2">
              {content.featured_topic.takeaways.map((takeaway) => (
                <div key={takeaway} className="rounded-xl border border-border/40 bg-muted/20 px-4 py-3 text-sm text-foreground/80 font-medium">
                  {takeaway}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-border/40 bg-muted/30 p-6 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Clock3 className="h-4 w-4 text-primary" />
              阅读信息
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">适合人群</span>
                <span className="font-medium">{content.featured_topic.audience}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">阅读时长</span>
                <span className="font-medium">{content.featured_topic.reading_time}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">当前联动概念</span>
                <span className="font-medium">{selectedEntity?.name || '未选中'}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {content.selected_entity_guide ? (
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Orbit className="h-5 w-5 text-primary" />
              当前概念的科普入口
            </CardTitle>
            <CardDescription>你当前正在看的概念，也可以当作一个很好的入门案例。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-border/40 bg-muted/20 p-4">
              <div className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">当前概念</div>
              <div className="mt-2 font-black text-lg">{content.selected_entity_guide.entity}</div>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{content.selected_entity_guide.why_it_matters}</p>
            </div>
            <div className="rounded-xl border border-border/40 bg-muted/20 p-4">
              <div className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">最容易理解的角度</div>
              <p className="mt-2 text-sm text-foreground/80 leading-relaxed font-medium">{content.selected_entity_guide.beginner_angle}</p>
            </div>
            <div className="rounded-xl border border-border/20 bg-muted/20 p-4">
              <div className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">顺手一起看的概念</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {content.selected_entity_guide.connected_concepts.map((concept) => (
                  <Badge key={concept} variant="outline">{concept}</Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <BookOpen className="h-5 w-5 text-primary" />
              三组入门材料
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {content.primers.map((primer) => (
              <div key={primer.title} className="rounded-2xl border border-border/40 bg-muted/10 p-5 transition-all hover:bg-muted/20 group">
                <div className="font-black text-lg tracking-tight group-hover:text-primary transition-colors">{primer.title}</div>
                <div className="mt-1 text-[10px] text-muted-foreground uppercase font-black">{primer.focus}</div>
                <p className="mt-3 text-sm leading-6 text-foreground/70">{primer.summary}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {primer.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">{tag}</Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-lg">常见问题场景</CardTitle>
            <CardDescription>把抽象概念翻译成更接近实际工作的表达。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {content.scenarios.map((scenario) => (
              <div key={scenario.title} className="rounded-2xl border border-border/40 bg-muted/10 p-5">
                <div className="font-black text-blue-500 uppercase tracking-tighter text-[11px] mb-2">场景分析</div>
                <div className="font-black text-lg leading-tight mb-2">{scenario.title}</div>
                <div className="text-sm font-black text-primary/90 mb-2">Q: {scenario.question}</div>
                <p className="text-sm leading-relaxed text-muted-foreground italic border-l-2 border-primary/20 pl-4">{scenario.answer}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

