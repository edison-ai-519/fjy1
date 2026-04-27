import { useState, useEffect } from 'react';
import { fetchKnowledgeGraph, fetchOntologies, searchEntities as searchEntitiesRequest } from '@/features/ontology/api';
import { subscribeRepositorySync } from '@/shared/events/repositorySync';
import type { KnowledgeGraphData, Entity, OntologyModule } from '@/types/ontology';
import { getStoredSelectedProjectId, subscribeSelectedProjectIdChange } from '@/features/workspace/selectedProject';

export function useOntologyData() {
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeGraphData | null>(null);
  const [philosophicalOntology, setPhilosophicalOntology] = useState<OntologyModule | null>(null);
  const [formalOntology, setFormalOntology] = useState<OntologyModule | null>(null);
  const [scientificOntology, setScientificOntology] = useState<OntologyModule | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(getStoredSelectedProjectId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshKnowledgeGraph = async (options: { silent?: boolean; forceRefresh?: boolean } = {}) => {
    try {
      if (!options.silent) {
        setLoading(true);
      }
      setError(null);

      const [kgData, ontologies] = await Promise.all([
        fetchKnowledgeGraph({ refresh: options.forceRefresh, projectId: selectedProjectId }),
        fetchOntologies(),
      ]);

      setKnowledgeGraph(kgData);
      setPhilosophicalOntology(ontologies.philosophicalOntology);
      setFormalOntology(ontologies.formalOntology);
      setScientificOntology(ontologies.scientificOntology);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (!options.silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void refreshKnowledgeGraph();
  }, [selectedProjectId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshKnowledgeGraph({ silent: true, forceRefresh: true });
    }, 10000);

    return () => window.clearInterval(interval);
  }, [selectedProjectId]);

  useEffect(() => {
    return subscribeRepositorySync(() => {
      void refreshKnowledgeGraph({ silent: true, forceRefresh: true });
    });
  }, [selectedProjectId]);

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
