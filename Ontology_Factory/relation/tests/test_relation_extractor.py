from __future__ import annotations

from entity_relation import extract_relations
from ner.extractor import extract_entities
from ner.schema import NerDocument, NerEntity


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

    result = extract_relations(document)

    assert len(result.relations) == 1
    assert result.relations[0].relation_type == "reports_to"
    assert result.relations[0].source_entity_id == "ent_1"
    assert result.relations[0].target_entity_id == "ent_2"


def test_extract_relations_falls_back_to_co_occurs_with() -> None:
    document = NerDocument(
        doc_id="doc-2",
        source_text="ESP8266 和 OneNet 在同一方案中出现。",
        entities=[
            NerEntity(
                entity_id="ent_1",
                text="ESP8266",
                normalized_text="ESP8266",
                label="TECH",
                start=0,
                end=7,
                source_sentence="ESP8266 和 OneNet 在同一方案中出现。",
                metadata={"source_sentences": ["ESP8266 和 OneNet 在同一方案中出现。"]},
            ),
            NerEntity(
                entity_id="ent_2",
                text="OneNet",
                normalized_text="OneNet",
                label="TECH",
                start=10,
                end=16,
                source_sentence="ESP8266 和 OneNet 在同一方案中出现。",
                metadata={"source_sentences": ["ESP8266 和 OneNet 在同一方案中出现。"]},
            ),
        ],
    )

    result = extract_relations(document)

    assert len(result.relations) == 0


def test_extract_relations_ignores_sentence_without_trigger() -> None:
    document = NerDocument(
        doc_id="doc-3",
        source_text="ESP8266 和 OneNet 都出现在同一段描述中。",
        entities=[
            NerEntity(
                entity_id="ent_1",
                text="ESP8266",
                normalized_text="ESP8266",
                label="TECH",
                start=0,
                end=7,
                source_sentence="ESP8266 和 OneNet 都出现在同一段描述中。",
                metadata={"source_sentences": ["ESP8266 和 OneNet 都出现在同一段描述中。"]},
            ),
            NerEntity(
                entity_id="ent_2",
                text="OneNet",
                normalized_text="OneNet",
                label="TECH",
                start=10,
                end=16,
                source_sentence="ESP8266 和 OneNet 都出现在同一段描述中。",
                metadata={"source_sentences": ["ESP8266 和 OneNet 都出现在同一段描述中。"]},
            ),
        ],
    )

    result = extract_relations(document)

    assert result.relations == []


def test_extract_relations_uses_demo_payload_for_fixed_doc() -> None:
    ner_document = extract_entities(
        "任意文本都不重要。",
        doc_id="智能养鱼系统概览",
        use_llm=False,
        provider=None,
        llm_client=None,
        source_name="test.txt",
    )

    result = extract_relations(ner_document)

    assert len(result.relations) >= 5
    relation_types = {relation.relation_type for relation in result.relations}
    assert "依赖" in relation_types
    assert "包含" in relation_types
