import { KnowledgeGraph } from '@/components/KnowledgeGraph';
import { EntityDetail } from '@/components/EntityDetail';
import { useOntologyContext } from '@/features/ontology/useOntologyContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Network, Info, Zap } from 'lucide-react';
import type { Entity } from '@/types/ontology';

interface ExplorerPageProps {
  onSelectEntity: (entity: Entity) => void;
}

export function ExplorerPage({ onSelectEntity }: ExplorerPageProps) {
  const {
    filteredEntities,
    filteredCrossReferences,
    selectedEntity,
    relatedEntities,
    selectedEntityId,
  } = useOntologyContext();

  return (
    <div className="flex flex-1 h-full w-full overflow-hidden bg-background">
      {/* Main Graph Area */}
      <div className="flex-1 relative flex flex-col min-h-0 min-w-0">
        <div className="flex-1 w-full relative min-h-0">
          <KnowledgeGraph
            entities={filteredEntities}
            crossReferences={filteredCrossReferences}
            onSelectEntity={onSelectEntity}
            selectedEntityId={selectedEntityId ?? undefined}
          />
        </div>
      </div>

      {/* Side Info Panel */}
      <div className="w-[450px] flex flex-col min-h-0 border-l border-border bg-card/30 backdrop-blur-sm animate-in slide-in-from-right-4 duration-500">
        <div className="p-4 border-b border-border bg-card flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-bold tracking-tight">实体详情</h3>
          </div>
          {selectedEntity && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full uppercase font-black">
              <Zap className="w-3 h-3 text-amber-500" />
              Live Sync
            </div>
          )}
        </div>

        <ScrollArea className="flex-1 h-full">
          <div className="p-4">
            {selectedEntity ? (
              <EntityDetail
                entity={selectedEntity}
                relatedEntities={relatedEntities}
                onSelectRelated={onSelectEntity}
              />
            ) : (
              <div className="h-[calc(100vh-200px)] flex flex-col items-center justify-center text-center p-8 space-y-4">
                <div className="p-6 rounded-full bg-muted/50 border border-dashed border-border mb-2">
                  <Network className="w-12 h-12 text-muted-foreground/30 animate-pulse" />
                </div>
                <h4 className="text-lg font-bold text-foreground/70">等待选取</h4>
                <p className="text-sm text-muted-foreground max-w-[240px]">
                  请在左侧图谱中点击任意节点，即可在此处同步查看该实体的工业定义、属性模型与关联链路。
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
