import * as React from 'react';
import { OntologyContext } from '@/features/ontology/context.shared';

export function useOntologyContext() {
  const context = React.useContext(OntologyContext);
  if (!context) {
    throw new Error('useOntologyContext must be used within OntologyProvider');
  }

  return context;
}
