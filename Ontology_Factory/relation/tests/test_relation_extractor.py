from __future__ import annotations

from entity_relation import extract_relations
from ner.schema import NerDocument, NerEntity


class FakeRelationRuntime:
    def extract_relations(self, document: NerDocument):
        return (
            [
                {
                    "source_entity_id": "ent_1",
                    "target_entity_id": "ent_2",
                    "source_text": "ESP8266",
                    "target_text": "Onenet",
                    "relation_type": "reports_to",
                    "confidence": 1.0,
                    "evidence_sentence": "ESP8266 上传数据到 Onenet。",
                }
            ],
            {
                "extraction_backend": "spacy_llm",
                "spacy_llm_version": "0.7.4",
                "label_config_version": "2026-04-24.relation.v1",
                "task_name": "spacy.REL.v1",
            },
        )


def test_extract_relations_builds_directional_relation() -> None:
    document = NerDocument(
        doc_id="doc-1",
        source_text="ESP8266 上传数据到 Onenet。",
        entities=[
            NerEntity(
                entity_id="ent_1",
                text="ESP8266",
                normalized_text="ESP8266",
                label="TECH",
                start=0,
                end=7,
                source_sentence="ESP8266 上传数据到 Onenet。",
                metadata={"source_sentences": ["ESP8266 上传数据到 Onenet。"]},
            ),
            NerEntity(
                entity_id="ent_2",
                text="Onenet",
                normalized_text="Onenet",
                label="TECH",
                start=14,
                end=20,
                source_sentence="ESP8266 上传数据到 Onenet。",
                metadata={"source_sentences": ["ESP8266 上传数据到 Onenet。"]},
            ),
        ],
    )

    result = extract_relations(document, runtime=FakeRelationRuntime())

    assert len(result.relations) == 1
    assert result.relations[0].relation_type == "reports_to"
    assert result.relations[0].source_entity_id == "ent_1"
    assert result.relations[0].target_entity_id == "ent_2"
    assert result.relations[0].metadata["label_config_version"] == "2026-04-24.relation.v1"
