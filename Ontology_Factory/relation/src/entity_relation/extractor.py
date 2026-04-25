from __future__ import annotations

import hashlib

from entity_relation.schema import EntityRelation, RelationDocument
from ner.schema import NerDocument, NerEntity
from entity_relation.spacy_llm_runtime import SpacyLLMRelationRuntime, build_default_relation_runtime


def extract_relations(
    document: NerDocument,
    runtime: SpacyLLMRelationRuntime | None = None,
) -> RelationDocument:
    runtime = runtime or build_default_relation_runtime()
    relation_payloads, runtime_metadata = runtime.extract_relations(document)
    relations = [
        EntityRelation(
            relation_id=_build_relation_id(
                document.doc_id,
                payload["source_entity_id"],
                payload["target_entity_id"],
                payload["relation_type"],
            ),
            source_entity_id=payload["source_entity_id"],
            target_entity_id=payload["target_entity_id"],
            source_text=payload["source_text"],
            target_text=payload["target_text"],
            relation_type=payload["relation_type"],
            confidence=float(payload["confidence"]),
            evidence_sentence=payload["evidence_sentence"],
            metadata=dict(runtime_metadata),
        )
        for payload in relation_payloads
    ]
    return RelationDocument(doc_id=document.doc_id, relations=relations)


def _build_relation_id(doc_id: str, source_entity_id: str, target_entity_id: str, relation_type: str) -> str:
    digest = hashlib.sha1(f"{doc_id}|{source_entity_id}|{target_entity_id}|{relation_type}".encode("utf-8")).hexdigest()[:12]
    return f"rel_{digest}"
