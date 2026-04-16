import * as React from 'react';

import { useOntologyData } from '@/hooks/useOntologyData';
import type { Entity, KnowledgeLayer } from '@/types/ontology';
import { buildOntologyAppState } from '@/features/ontology/state';
import { OntologyContext } from '@/features/ontology/context.shared';
import type { OntologyContextValue } from '@/features/ontology/context.types';

export function OntologyProvider({ children }: { children: React.ReactNode }) {
  const { knowledgeGraph, loading, error, searchEntities } = useOntologyData();
  const [selectedLayer, setSelectedLayer] = React.useState<'all' | KnowledgeLayer>('all');
  const [selectedEntityId, setSelectedEntityId] = React.useState<string | null>(null);

  const appState = React.useMemo(() => buildOntologyAppState({
    knowledgeGraph,
    selectedLayer,
    selectedEntityId,
  }), [knowledgeGraph, selectedEntityId, selectedLayer]);

  const selectEntity = React.useCallback((entity: Entity) => {
    setSelectedEntityId(entity.id);
  }, []);

  const searchInLayer = React.useCallback(async (query: string) => {
    const results = await searchEntities(query);
    return results.filter((entity) => selectedLayer === 'all' || entity.layer === selectedLayer);
  }, [searchEntities, selectedLayer]);

  const value = React.useMemo<OntologyContextValue>(() => ({
    ...appState,
    loading,
    error,
    selectedLayer,
    setSelectedLayer,
    selectedEntityId: appState.selectedEntity?.id ?? selectedEntityId,
    selectEntity,
    searchInLayer,
  }), [appState, error, loading, searchInLayer, selectEntity, selectedEntityId, selectedLayer]);

  return <OntologyContext.Provider value={value}>{children}</OntologyContext.Provider>;
}
