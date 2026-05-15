import { useState, useEffect } from 'react';
import { fetchKnowledgeGraph, fetchOntologies, searchEntities as searchEntitiesRequest } from '@/features/ontology/api';
import { subscribeRepositorySync } from '@/shared/events/repositorySync';
import type { KnowledgeGraphData, Entity, OntologyModule } from '@/types/ontology';
import { getStoredSelectedProjectId, subscribeSelectedProjectIdChange } from '@/features/workspace/selectedProject';

export function useOntologyData(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeGraphData | null>(null);
  const [philosophicalOntology, setPhilosophicalOntology] = useState<OntologyModule | null>(null);
  const [formalOntology, setFormalOntology] = useState<OntologyModule | null>(null);
  const [scientificOntology, setScientificOntology] = useState<OntologyModule | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(getStoredSelectedProjectId);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(() => (
    typeof document === 'undefined'
      ? true
      : document.visibilityState !== 'hidden'
  ));

  const refreshKnowledgeGraph = async (options: { silent?: boolean; forceRefresh?: boolean } = {}) => {
    const silent = options.silent ?? true;
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const knowledgeGraphPromise = fetchKnowledgeGraph({ refresh: options.forceRefresh, projectId: selectedProjectId });
      const ontologiesPromise = fetchOntologies();
      const [kgData, ontologies] = await Promise.all([
        knowledgeGraphPromise,
        ontologiesPromise,
      ]);

      setKnowledgeGraph(kgData);
      setPhilosophicalOntology(ontologies.philosophicalOntology);
      setFormalOntology(ontologies.formalOntology);
      setScientificOntology(ontologies.scientificOntology);
      setLastRefreshAt(new Date().toISOString());
      setHasLoadedOnce(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setRefreshing(false);
      setError(null);
      return undefined;
    }

    setHasLoadedOnce(false);
    void refreshKnowledgeGraph({ silent: false });
  }, [enabled, selectedProjectId]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const handleVisibilityChange = () => {
      setIsPageVisible(document.visibilityState !== 'hidden');
    };

    handleVisibilityChange();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (!enabled || !hasLoadedOnce || !isPageVisible) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      void refreshKnowledgeGraph({ silent: true, forceRefresh: true });
    }, 10000);

    return () => window.clearInterval(interval);
  }, [enabled, hasLoadedOnce, isPageVisible, selectedProjectId]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    return subscribeRepositorySync(() => {
      void refreshKnowledgeGraph({ silent: true, forceRefresh: true });
    });
  }, [enabled, selectedProjectId]);

  useEffect(() => subscribeSelectedProjectIdChange((projectId) => {
    setSelectedProjectId(projectId);
  }), []);

  const getEntityById = (id: string): Entity | undefined => {
    return knowledgeGraph?.entity_index[id];
  };

  const searchEntities = async (query: string): Promise<Entity[]> => {
    if (!query.trim()) return [];
    return searchEntitiesRequest(query, selectedProjectId);
  };

  const getEntitiesByDomain = (domain: string): Entity[] => {
    if (!knowledgeGraph) return [];
    return Object.values(knowledgeGraph.entity_index).filter((entity) => entity.domain === domain);
  };

  const getEntitiesByLevel = (level: number): Entity[] => {
    if (!knowledgeGraph) return [];
    return Object.values(knowledgeGraph.entity_index).filter((entity) => entity.level === level);
  };

  const getRelatedEntities = (entityId: string): Entity[] => {
    if (!knowledgeGraph) return [];

    const related = knowledgeGraph.cross_references.filter((ref) => ref.source === entityId || ref.target === entityId);

    return related.map((ref) => {
      const relatedId = ref.source === entityId ? ref.target : ref.source;
      return knowledgeGraph.entity_index[relatedId];
    }).filter(Boolean);
  };

  return {
    knowledgeGraph,
    philosophicalOntology,
    formalOntology,
    scientificOntology,
    loading,
    refreshing,
    lastRefreshAt,
    error,
    getEntityById,
    searchEntities,
    getEntitiesByDomain,
    getEntitiesByLevel,
    getRelatedEntities,
    refreshKnowledgeGraph,
    selectedProjectId,
  };
}
