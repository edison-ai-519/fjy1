"""Relation extraction exports."""

from entity_relation.extractor import extract_relations
from entity_relation.schema import EntityRelation, RelationDocument
from entity_relation.spacy_llm_runtime import SpacyLLMRelationRuntime, build_default_relation_runtime

__all__ = [
    "EntityRelation",
    "RelationDocument",
    "SpacyLLMRelationRuntime",
    "build_default_relation_runtime",
    "extract_relations",
]
