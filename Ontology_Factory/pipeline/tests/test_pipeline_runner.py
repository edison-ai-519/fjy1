from __future__ import annotations

import json
from pathlib import Path

import yaml
from ner.mentions import RawEntityMention

from pipeline.runner import run_batch_pipeline, run_pipeline


def _write_preprocess_config(path: Path) -> None:
    path.write_text(
        yaml.safe_dump(
            {
                "pipeline": {"conservative": True, "output": "clean_text"},
                "io": {"input_globs": ["*.txt"], "output_dir": "outputs", "encoding_fallbacks": ["utf-8"]},
                "models": {"enabled": False, "candidates": []},
            },
            allow_unicode=True,
        ),
        encoding="utf-8",
    )


def _write_pipeline_config(path: Path, preprocess_config: Path, store_path: Path, output_root: Path) -> None:
    path.write_text(
        yaml.safe_dump(
            {
                "preprocess": {"config_path": str(preprocess_config)},
                "spacy_llm": {
                    "api_key": "test-key",
                    "model": "openai/gpt-4o-mini",
                    "ner": {
                        "template_path": str(path.parent / "ner_template.jinja"),
                        "labels_path": str(path.parent / "ner_labels.yml"),
                        "examples_path": str(path.parent / "ner_examples.yml"),
                    },
                    "relation": {
                        "template_path": str(path.parent / "relation_template.jinja"),
                        "labels_path": str(path.parent / "relation_labels.yml"),
                        "examples_path": str(path.parent / "relation_examples.yml"),
                    },
                },
                "llm": {"enabled": False},
                "dls": {"config_path": str(path.parent / "unused.toml"), "artifact_root": "", "max_concurrency": 1},
                "output": {"root_dir": str(output_root), "enable_cooccurrence_edges": False},
                "storage": {"enabled": True, "database_path": str(store_path)},
            },
            allow_unicode=True,
        ),
        encoding="utf-8",
    )


class DeterministicNerRuntime:
    def extract_mentions(self, text: str):
        mentions: list[RawEntityMention] = []
        for term, label in [("ESP8266", "TECH"), ("OneNet", "TECH"), ("溶氧", "TERM"), ("传感器", "TERM")]:
            start = text.find(term)
            if start >= 0:
                mentions.append(
                    RawEntityMention(
                        text=term,
                        label=label,
                        start=start,
                        end=start + len(term),
                        confidence=0.9,
                    )
                )
        return (
            mentions,
            {
                "extraction_backend": "spacy_llm",
                "spacy_llm_version": "0.7.4",
                "label_config_version": "test-ner-v1",
                "task_name": "spacy.NER.v3",
            },
        )


class DeterministicRelationRuntime:
    def extract_relations(self, document):
        by_name = {
            entity.normalized_text or entity.text: entity
            for entity in document.entities
        }
        relations = []
        if "ESP8266" in by_name and "OneNet" in by_name:
            source = by_name["ESP8266"]
            target = by_name["OneNet"]
            relations.append(
                {
                    "source_entity_id": source.entity_id,
                    "target_entity_id": target.entity_id,
                    "source_text": source.normalized_text,
                    "target_text": target.normalized_text,
                    "relation_type": "reports_to",
                    "confidence": 1.0,
                    "evidence_sentence": document.source_text,
                }
            )
        elif "溶氧" in by_name and "传感器" in by_name:
            source = by_name["传感器"]
            target = by_name["溶氧"]
            relations.append(
                {
                    "source_entity_id": source.entity_id,
                    "target_entity_id": target.entity_id,
                    "source_text": source.normalized_text,
                    "target_text": target.normalized_text,
                    "relation_type": "monitors",
                    "confidence": 1.0,
                    "evidence_sentence": document.source_text,
                }
            )
        return (
            relations,
            {
                "extraction_backend": "spacy_llm",
                "spacy_llm_version": "0.7.4",
                "label_config_version": "test-relation-v1",
                "task_name": "spacy.REL.v1",
            },
        )


def _fake_classify_graph(**kwargs):
    graph = kwargs["graph"]
    return [
        {
            "node_id": node.node_id,
            "info_name": node.name,
            "ontology_label": "类",
            "confidence": 0.75,
            "epistemology": {"l_mapping": "L1", "ran": node.description or node.name, "ti": node.name},
            "logic_trace": {"reasoning": "unit-test", "xiaogu_list": []},
        }
        for node in graph.nodes
    ]


def test_run_pipeline_writes_version_and_exports(monkeypatch, tmp_path: Path) -> None:
    input_path = tmp_path / "sample.txt"
    input_path.write_text("溶氧传感器连接ESP8266并上报OneNet。", encoding="utf-8")
    preprocess_config = tmp_path / "preprocess.yaml"
    pipeline_config = tmp_path / "pipeline.yaml"
    _write_preprocess_config(preprocess_config)
    _write_pipeline_config(pipeline_config, preprocess_config, tmp_path / "store.sqlite3", tmp_path / "pipeline_outputs")

    monkeypatch.setattr("pipeline.runner._classify_graph", _fake_classify_graph)
    monkeypatch.setattr("pipeline.runner.build_default_ner_runtime", lambda payload: DeterministicNerRuntime())
    monkeypatch.setattr("pipeline.runner.build_default_relation_runtime", lambda payload: DeterministicRelationRuntime())

    result = run_pipeline(
        str(input_path),
        preprocess_config=str(preprocess_config),
        pipeline_config=str(pipeline_config),
    )

    report = json.loads(Path(result.report_path).read_text(encoding="utf-8"))
    assert result.version_id
    assert Path(result.graph_json_path).exists()
    assert Path(result.graph_graphml_path).exists()
    assert report["documents_processed"] == 1
    assert report["reclassified_canonical_entities"]


def test_run_batch_pipeline_commits_one_version(monkeypatch, tmp_path: Path) -> None:
    input_dir = tmp_path / "docs"
    input_dir.mkdir()
    (input_dir / "a.txt").write_text("ESP8266 上传数据到 OneNet。", encoding="utf-8")
    (input_dir / "b.txt").write_text("溶氧传感器监测鱼缸。", encoding="utf-8")
    preprocess_config = tmp_path / "preprocess.yaml"
    pipeline_config = tmp_path / "pipeline.yaml"
    _write_preprocess_config(preprocess_config)
    _write_pipeline_config(pipeline_config, preprocess_config, tmp_path / "store.sqlite3", tmp_path / "pipeline_outputs")

    monkeypatch.setattr("pipeline.runner._classify_graph", _fake_classify_graph)
    monkeypatch.setattr("pipeline.runner.build_default_ner_runtime", lambda payload: DeterministicNerRuntime())
    monkeypatch.setattr("pipeline.runner.build_default_relation_runtime", lambda payload: DeterministicRelationRuntime())

    result = run_batch_pipeline(
        str(input_dir),
        preprocess_config=str(preprocess_config),
        pipeline_config=str(pipeline_config),
    )

    report = json.loads(Path(result.report_path).read_text(encoding="utf-8"))
    assert result.version_id
    assert report["documents_processed"] == 2
    assert Path(result.graph_json_path).exists()


def test_canonical_reuse_skips_reclassification_when_signature_unchanged(monkeypatch, tmp_path: Path) -> None:
    first = tmp_path / "first.txt"
    second = tmp_path / "second.txt"
    first.write_text("ESP8266 上传数据到 OneNet。", encoding="utf-8")
    second.write_text("ESP8266 模块稳定运行。", encoding="utf-8")
    preprocess_config = tmp_path / "preprocess.yaml"
    pipeline_config = tmp_path / "pipeline.yaml"
    _write_preprocess_config(preprocess_config)
    _write_pipeline_config(pipeline_config, preprocess_config, tmp_path / "store.sqlite3", tmp_path / "pipeline_outputs")

    calls: list[int] = []

    def fake_classify(**kwargs):
        calls.append(len(kwargs["graph"].nodes))
        return _fake_classify_graph(**kwargs)

    monkeypatch.setattr("pipeline.runner._classify_graph", fake_classify)
    monkeypatch.setattr("pipeline.runner.build_default_ner_runtime", lambda payload: DeterministicNerRuntime())
    monkeypatch.setattr("pipeline.runner.build_default_relation_runtime", lambda payload: DeterministicRelationRuntime())

    first_result = run_pipeline(
        str(first),
        preprocess_config=str(preprocess_config),
        pipeline_config=str(pipeline_config),
    )
    second_result = run_pipeline(
        str(second),
        preprocess_config=str(preprocess_config),
        pipeline_config=str(pipeline_config),
    )

    first_report = json.loads(Path(first_result.report_path).read_text(encoding="utf-8"))
    second_report = json.loads(Path(second_result.report_path).read_text(encoding="utf-8"))
    assert first_report["reclassified_canonical_entities"]
    assert first_report["reclassified_canonical_entities"]
    assert len(calls) == len(first_report["reclassified_canonical_entities"])


def test_duplicate_content_hash_is_skipped(monkeypatch, tmp_path: Path) -> None:
    input_path = tmp_path / "sample.txt"
    input_path.write_text("ESP8266 上传数据到 OneNet。", encoding="utf-8")
    preprocess_config = tmp_path / "preprocess.yaml"
    pipeline_config = tmp_path / "pipeline.yaml"
    _write_preprocess_config(preprocess_config)
    _write_pipeline_config(pipeline_config, preprocess_config, tmp_path / "store.sqlite3", tmp_path / "pipeline_outputs")

    monkeypatch.setattr("pipeline.runner._classify_graph", _fake_classify_graph)
    monkeypatch.setattr("pipeline.runner.build_default_ner_runtime", lambda payload: DeterministicNerRuntime())
    monkeypatch.setattr("pipeline.runner.build_default_relation_runtime", lambda payload: DeterministicRelationRuntime())

    first_result = run_pipeline(
        str(input_path),
        preprocess_config=str(preprocess_config),
        pipeline_config=str(pipeline_config),
    )
    second_result = run_pipeline(
        str(input_path),
        preprocess_config=str(preprocess_config),
        pipeline_config=str(pipeline_config),
    )

    assert first_result.version_id
    second_report = json.loads(Path(second_result.report_path).read_text(encoding="utf-8"))
    assert second_report["documents_processed"] == 0
    assert second_report["documents_skipped"] == 1
