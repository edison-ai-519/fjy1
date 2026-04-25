from __future__ import annotations

from ner.extractor import extract_entities
from ner.mentions import RawEntityMention


class FakeRuntime:
    def extract_mentions(self, text: str):
        return (
            [
                RawEntityMention(text="溶氧", label="TERM", start=0, end=2, confidence=0.9),
                RawEntityMention(text="溶氧", label="TERM", start=6, end=8, confidence=0.8),
                RawEntityMention(text=";", label="TERM", start=12, end=13, confidence=0.1),
                RawEntityMention(text="ESP8266", label="TECH", start=14, end=21, confidence=0.95),
            ],
            {
                "extraction_backend": "spacy_llm",
                "spacy_llm_version": "0.7.4",
                "label_config_version": "2026-04-24.ner.v1",
                "task_name": "spacy.NER.v3",
            },
        )


def test_extract_entities_merges_duplicates_and_filters_noise() -> None:
    doc = extract_entities(
        "溶氧保持稳定，溶氧传感器连接ESP8266模块。",
        doc_id="doc-1",
        runtime=FakeRuntime(),
    )

    assert len(doc.entities) == 2
    assert doc.entities[0].normalized_text == "溶氧"
    assert doc.entities[0].metadata["occurrence_count"] == 2
    assert doc.entities[1].normalized_text == "ESP8266"
    assert doc.entities[0].metadata["extraction_backend"] == "spacy_llm"
    assert doc.entities[0].metadata["label_config_version"] == "2026-04-24.ner.v1"
