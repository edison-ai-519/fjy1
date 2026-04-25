from __future__ import annotations

from pathlib import Path

import yaml
from spacy_llm.tasks.rel.util import RELExample


def test_relation_examples_have_valid_entity_offsets() -> None:
    resource_path = (
        Path(__file__).resolve().parents[2]
        / "resources"
        / "spacy_llm"
        / "relation_examples.yml"
    )
    examples = yaml.safe_load(resource_path.read_text(encoding="utf-8"))

    assert examples

    for payload in examples:
        example = RELExample.model_validate(payload)
        doc = example.to_doc()
        assert len(doc.ents) == len(example.ents)
