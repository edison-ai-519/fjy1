import * as React from 'react';
import type { OntologyContextValue } from '@/features/ontology/context.types';

export const OntologyContext = React.createContext<OntologyContextValue | null>(null);
