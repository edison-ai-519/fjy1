import type { Entity, KnowledgeGraphData, KnowledgeLayer } from '@/types/ontology';

export interface OntologyAppState {
  entities: Entity[];
  crossReferences: Array<{ source: string; target: string; relation: string; description: string }>;
  filteredEntities: Entity[];
  filteredCrossReferences: Array<{ source: string; target: string; relation: string; description: string }>;
  selectedEntity: Entity | null;
  relatedEntities: Entity[];
  filteredStatistics: KnowledgeGraphData['statistics'] | null;
}

export function buildFilteredStatistics(
  knowledgeGraph: KnowledgeGraphData | null,
  entities: Entity[],
  crossReferences: Array<{ source: string; target: string }>,
) {
  if (!knowledgeGraph) {
    return null;
  }

  const domains = [...new Set(entities.map((entity) => entity.domain).filter(Boolean))].sort();
  const levels = [...new Set(entities.map((entity) => entity.level).filter((level): level is number => typeof level === 'number'))].sort((left, right) => left - right);
  const sources = [...new Set(entities.map((entity) => entity.source).filter(Boolean))].sort();
  const layers = [...new Set(entities.map((entity) => entity.layer).filter(Boolean))] as KnowledgeLayer[];
  const orderedLayers = ['common', 'domain', 'private'].filter((layer) => layers.includes(layer as KnowledgeLayer)) as KnowledgeLayer[];
  const layerCounts = orderedLayers.reduce<Partial<Record<KnowledgeLayer, number>>>((accumulator, layer) => {
    accumulator[layer] = entities.filter((entity) => entity.layer === layer).length;
    return accumulator;
  }, {});

  return {
    ...knowledgeGraph.statistics,
    total_entities: entities.length,
    total_relations: crossReferences.length,
    domains,
    levels,
    sources,
    layers: orderedLayers,
    layer_counts: layerCounts,
  };
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
    filteredStatistics: buildFilteredStatistics(input.knowledgeGraph, filteredEntities, filteredCrossReferences),
  };
}
