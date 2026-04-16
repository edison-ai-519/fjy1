import { EntityDetail } from '@/components/EntityDetail';
import { KnowledgeGraph } from '@/components/KnowledgeGraph';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useOntologyContext } from '@/features/ontology/useOntologyContext';
import type { Entity } from '@/types/ontology';

interface GraphPageProps {
  onSelectEntity: (entity: Entity) => void;
}

export function GraphPage({ onSelectEntity }: GraphPageProps) {
  const {
    filteredEntities,
    filteredCrossReferences,
    selectedEntity,
    relatedEntities,
    selectedEntityId,
  } = useOntologyContext();

  return (
    <ScrollArea className="h-full w-full">
      <div className="p-6 space-y-12 flex flex-col pb-20">
        <div className="w-full h-[700px] xl:h-[850px] shadow-sm rounded-3xl overflow-hidden border border-border">
          <KnowledgeGraph
            entities={filteredEntities}
            crossReferences={filteredCrossReferences}
            onSelectEntity={onSelectEntity}
            selectedEntityId={selectedEntityId ?? undefined}
          />
        </div>
        <div className="w-full relative z-10 bg-background">
          <EntityDetail
            entity={selectedEntity}
            relatedEntities={relatedEntities}
            onSelectRelated={onSelectEntity}
          />
        </div>
      </div>
    </ScrollArea>
  );
}
