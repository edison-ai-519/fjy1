import type { Entity, KnowledgeGraphData, KnowledgeLayer } from '@/types/ontology';

export interface OntologyAppState {
  entities: Entity[];
  crossReferences: Array<{ source: string; target: string; relation: string; description: string }>;
  filteredEntities: Entity[];
  filteredCrossReferences: Array<{ source: string; target: string; relation: string; description: string }>;
  selectedEntity: Entity | null;
  relatedEntities: Entity[];
}

export function buildOntologyAppState(input: {
  knowledgeGraph: KnowledgeGraphData | null;
  selectedLayer: 'all' | KnowledgeLayer;
  selectedEntityId: string | null;
}): OntologyAppState {
  const entities = input.knowledgeGraph ? Object.values(input.knowledgeGraph.entity_index) : [];
  const crossReferences = input.knowledgeGraph?.cross_references || [];
  const filteredEntities = entities.filter((entity) => (
    input.selectedLayer === 'all' || entity.layer === input.selectedLayer
  ));
  const visibleEntityIds = new Set(filteredEntities.map((entity) => entity.id));
  const filteredCrossReferences = crossReferences.filter((reference) => (
    visibleEntityIds.has(reference.source) && visibleEntityIds.has(reference.target)
  ));
  const selectedEntity = filteredEntities.find((entity) => entity.id === input.selectedEntityId)
    ?? filteredEntities[0]
    ?? null;
  const relatedEntities = selectedEntity
    ? filteredCrossReferences
      .map((reference) => {
        const relatedId = reference.source === selectedEntity.id
          ? reference.target
          : reference.target === selectedEntity.id
            ? reference.source
            : null;
        return relatedId ? filteredEntities.find((entity) => entity.id === relatedId) || null : null;
      })
      .filter((entity): entity is Entity => Boolean(entity))
    : [];

  return {
    entities,
    crossReferences,
    filteredEntities,
    filteredCrossReferences,
    selectedEntity,
    relatedEntities,
  };
}
