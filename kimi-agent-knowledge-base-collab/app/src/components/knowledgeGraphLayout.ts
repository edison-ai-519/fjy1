import type { CrossReference, Entity } from '../types/ontology';

export interface KnowledgeGraphNode {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  entity: Entity;
}

export interface KnowledgeGraphLink {
  source: string;
  target: string;
  relation: string;
}

export interface KnowledgeGraphLayoutCacheEntry {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
}

export type KnowledgeGraphLayoutCache = Record<string, KnowledgeGraphLayoutCacheEntry>;

export interface KnowledgeGraphDimensions {
  width: number;
  height: number;
}

const INITIAL_ORBIT_RADIUS = 80;
const NODE_RADIUS_BY_LEVEL = {
  min: 17,
  base: 20,
  max: 23,
};

const PALETTE = ['#2563eb', '#7c3aed', '#059669', '#ea580c', '#db2777', '#0f766e', '#4f46e5', '#ca8a04'];

export function buildKnowledgeGraphDomainColors(entities: Entity[]) {
  const uniqueDomains = [...new Set(entities.map((entity) => entity.domain).filter(Boolean))];
  return uniqueDomains.reduce<Record<string, string>>((accumulator, domain, index) => {
    accumulator[domain] = PALETTE[index % PALETTE.length];
    return accumulator;
  }, {});
}

export function createKnowledgeGraphNodes(
  entities: Entity[],
  dimensions: KnowledgeGraphDimensions,
  options: {
    layoutCache?: KnowledgeGraphLayoutCache;
    domainColors?: Record<string, string>;
  } = {},
): KnowledgeGraphNode[] {
  const visibleEntities = entities.filter((entity) => entity.visible !== false);
  if (visibleEntities.length === 0) {
    return [];
  }

  const layoutCache = options.layoutCache || {};
  const domainColors = options.domainColors || {};

  return visibleEntities.map((entity, index) => {
    const angle = (index / visibleEntities.length) * 2 * Math.PI;
    const displayLevel = entity.display_level ?? 2;
    const cachedPosition = layoutCache[entity.id];

    return {
      id: entity.id,
      name: entity.name,
      x: cachedPosition?.x ?? (dimensions.width / 2 + Math.cos(angle) * INITIAL_ORBIT_RADIUS),
      y: cachedPosition?.y ?? (dimensions.height / 2 + Math.sin(angle) * INITIAL_ORBIT_RADIUS),
      vx: cachedPosition?.vx ?? 0,
      vy: cachedPosition?.vy ?? 0,
      radius: cachedPosition?.radius ?? (displayLevel <= 1 ? NODE_RADIUS_BY_LEVEL.max : displayLevel >= 3 ? NODE_RADIUS_BY_LEVEL.min : NODE_RADIUS_BY_LEVEL.base),
      color: cachedPosition?.color ?? domainColors[entity.domain] ?? '#6b7280',
      entity,
    };
  });
}

export function mergeKnowledgeGraphLinks(crossReferences: CrossReference[]): KnowledgeGraphLink[] {
  const mergedLinksMap = new Map<string, KnowledgeGraphLink>();

  crossReferences.forEach((ref) => {
    const ids = [ref.source, ref.target].sort();
    const key = ids.join('--');
    const existing = mergedLinksMap.get(key);

    if (existing) {
      if (!existing.relation.split(' | ').includes(ref.relation)) {
        existing.relation += ` | ${ref.relation}`;
      }
      return;
    }

    mergedLinksMap.set(key, {
      source: ref.source,
      target: ref.target,
      relation: ref.relation,
    });
  });

  return Array.from(mergedLinksMap.values());
}

export function createKnowledgeGraphNodeIndex(nodes: KnowledgeGraphNode[]) {
  return new Map(nodes.map((node) => [node.id, node]));
}
