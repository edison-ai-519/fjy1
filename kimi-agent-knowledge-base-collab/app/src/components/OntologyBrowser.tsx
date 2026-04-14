import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { BookOpen, Link2, Search, Sparkles, TreePine } from 'lucide-react';
import type { CrossReference, Entity, KnowledgeLayer } from '@/types/ontology';

interface OntologyBrowserProps {
  entities: Entity[];
  crossReferences: CrossReference[];
  onSelectEntity: (entity: Entity) => void;
  selectedEntityId?: string;
}

const layerLabels: Record<KnowledgeLayer, string> = {
  common: 'Common',
  domain: 'Domain',
  private: 'Private',
};

export function OntologyBrowser({
  entities,
  crossReferences,
  onSelectEntity,
  selectedEntityId,
}: OntologyBrowserProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredEntities = useMemo(() => {
    if (!searchQuery.trim()) return entities;
    const query = searchQuery.toLowerCase();
    return entities.filter(entity =>
      entity.name.toLowerCase().includes(query) ||
      entity.domain.toLowerCase().includes(query) ||
      (entity.definition && entity.definition.toLowerCase().includes(query))
    );
  }, [entities, searchQuery]);

  const domainCount = new Set(entities.map((entity) => entity.domain)).size;
  const layerCount = new Set(entities.map((entity) => entity.layer)).size;
  const selectedEntity = entities.find((entity) => entity.id === selectedEntityId) ?? entities[0];

  const selectedRelations = selectedEntity
    ? crossReferences.filter(
      (reference) =>
        reference.source === selectedEntity.id || reference.target === selectedEntity.id,
    )
    : [];

  return (
    <Card className="h-full flex flex-col overflow-hidden border-slate-200 shadow-sm">
      <CardHeader className="border-b bg-gradient-to-br from-slate-50 via-white to-blue-50/70 pb-4 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg text-slate-800">
              <TreePine className="h-5 w-5 text-primary" />
              概念速览
            </CardTitle>
            <CardDescription className="text-[10px]">
              展示当前过滤范围内的全部节点，支持搜索查询。
            </CardDescription>
          </div>
          <div className="relative group flex-1 max-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 group-focus-within:text-primary transition-colors" />
            <Input
              placeholder="搜索实体..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 rounded-xl bg-white/50 border-slate-200 text-xs focus:bg-white transition-all shadow-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-3 lg:grid-cols-4">
          <div className="rounded-xl border bg-background/80 px-2 py-1.5 shadow-sm text-center">
            <div className="text-[10px] text-muted-foreground">领域数</div>
            <div className="mt-0.5 text-base font-bold text-slate-800">{domainCount}</div>
          </div>
          <div className="rounded-xl border bg-background/80 px-2 py-1.5 shadow-sm text-center">
            <div className="text-[10px] text-muted-foreground">存储层</div>
            <div className="mt-0.5 text-base font-bold text-slate-800">{layerCount}</div>
          </div>
          <div className="rounded-xl border bg-background/80 px-2 py-1.5 shadow-sm text-center">
            <div className="text-[10px] text-muted-foreground">实体数</div>
            <div className="mt-0.5 text-base font-bold text-slate-800">{entities.length}</div>
          </div>
          <div className="rounded-xl border bg-background/80 px-2 py-1.5 shadow-sm text-center">
            <div className="text-[10px] text-muted-foreground">关系数</div>
            <div className="mt-0.5 text-base font-bold text-slate-800">{crossReferences.length}</div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0 flex-1 overflow-hidden min-h-0 bg-slate-50/30">
        <ScrollArea className="h-full">
          <div className="space-y-4 p-4">
            {selectedEntity && !searchQuery ? (
              <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 shadow-sm ring-1 ring-blue-100/50">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-blue-600">
                  <Sparkles className="h-3.5 w-3.5" />
                  当前主阅读
                </div>
                <div className="mt-2 text-lg font-bold text-slate-900">{selectedEntity.name}</div>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 line-clamp-3">
                  {selectedEntity.definition}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-none">
                    {selectedEntity.domain}
                  </Badge>
                  <Badge variant="outline" className="bg-white border-blue-200 text-blue-600">
                    {layerLabels[selectedEntity.layer]}
                  </Badge>
                  <Badge variant="outline" className="bg-white border-blue-200 text-blue-600">
                    {selectedRelations.length} 关系
                  </Badge>
                </div>
              </div>
            ) : null}

            <div className="space-y-3">
              <div className="px-1 text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center justify-between">
                <span>{searchQuery ? '搜索结果' : '所有候选节点'} ({filteredEntities.length})</span>
                <div className="h-px flex-1 bg-slate-200 ml-3" />
              </div>

              {filteredEntities.map((entity) => {
                const isSelected = entity.id === selectedEntityId;
                const relationCount = crossReferences.filter(
                  (reference) =>
                    reference.source === entity.id || reference.target === entity.id,
                ).length;

                return (
                  <div
                    key={entity.id}
                    className={`rounded-2xl border p-4 transition-all duration-200 ${isSelected
                        ? 'border-primary shadow-md bg-white ring-1 ring-primary/20 scale-[1.02]'
                        : 'bg-white hover:border-slate-300 hover:shadow-sm border-slate-200'
                      }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`font-bold transition-colors ${isSelected ? 'text-primary text-base' : 'text-slate-800 text-sm'}`}>
                            {entity.name}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Badge variant="outline" className="text-[10px] h-5 bg-slate-50 border-slate-200">
                            {entity.domain}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={`text-[10px] h-5 border-none ${entity.layer === 'private' ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-600'
                              }`}
                          >
                            {layerLabels[entity.layer]}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] h-5 bg-emerald-50 text-emerald-600 border-none font-bold">
                            {relationCount} 关系
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <p className="mt-3 text-xs leading-relaxed text-slate-500 line-clamp-2 italic">
                      {entity.definition}
                    </p>

                    <div className="mt-4 flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-400">
                        <Link2 className="h-3 w-3" />
                        分析关联
                      </div>
                      {!isSelected ? (
                        <button
                          type="button"
                          onClick={() => onSelectEntity(entity)}
                          className="rounded-full bg-slate-900 px-4 py-1.5 text-[11px] font-bold text-white transition-all hover:bg-slate-800 active:scale-95 shadow-sm"
                        >
                          设为主阅读
                        </button>
                      ) : (
                        <div className="flex items-center gap-1 text-[11px] font-bold text-primary">
                          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse mr-1" />
                          阅读中
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-6 flex flex-col items-center justify-center text-center">
              <div className="p-2 bg-white rounded-full shadow-sm mb-3">
                <BookOpen className="h-5 w-5 text-slate-400" />
              </div>
              <h4 className="text-sm font-bold text-slate-700">探索完毕</h4>
              <p className="mt-1 text-xs text-slate-400 max-w-[200px]">
                以上是当前存储层下所有的本体节点。您可以切换过滤器查看更多层级。
              </p>
            </div>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
