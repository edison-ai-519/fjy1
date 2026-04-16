import type { KnowledgeLayer } from '@/types/ontology';

export const LAYER_FILTERS: Array<{ value: 'all' | KnowledgeLayer; label: string }> = [
  { value: 'all', label: '全部层' },
  { value: 'common', label: 'Common' },
  { value: 'domain', label: 'Domain' },
  { value: 'private', label: 'Private' },
];
