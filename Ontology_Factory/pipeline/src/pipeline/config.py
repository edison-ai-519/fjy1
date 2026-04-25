from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

from pipeline.bootstrap import workspace_root


class PreprocessSettings(BaseModel):
    config_path: str = str(workspace_root() / "preprocess" / "config.yaml")


def _spacy_llm_resource_root() -> Path:
    return workspace_root() / "resources" / "spacy_llm"


class SpacyLLMTaskSettings(BaseModel):
    template_path: str
    labels_path: str
    examples_path: str = ""


class SpacyLLMSettings(BaseModel):
    api_key: str = ""
    api_key_env: str = "OPENROUTER_API_KEY"
    base_url: str = "https://openrouter.ai/api/v1"
    model: str = ""
    model_env: str = "OPENROUTER_MODEL"
    timeout_s: float = 60.0
    app_name: str = "ontology-factory"
    context_length: int = 32000
    temperature: float = 0.0
    max_retries: int = 3
    retry_interval_s: float = 1.0
    save_io: bool = False
    lang: str = "zh"
    ner: SpacyLLMTaskSettings = Field(
        default_factory=lambda: SpacyLLMTaskSettings(
            template_path=str(_spacy_llm_resource_root() / "ner_template.jinja"),
            labels_path=str(_spacy_llm_resource_root() / "ner_labels.yml"),
            examples_path=str(_spacy_llm_resource_root() / "ner_examples.yml"),
        )
    )
    relation: SpacyLLMTaskSettings = Field(
        default_factory=lambda: SpacyLLMTaskSettings(
            template_path=str(_spacy_llm_resource_root() / "relation_template.jinja"),
            labels_path=str(_spacy_llm_resource_root() / "relation_labels.yml"),
            examples_path=str(_spacy_llm_resource_root() / "relation_examples.yml"),
        )
    )


class DlsSettings(BaseModel):
    config_path: str = str(workspace_root() / "dls" / "config" / "ontology_negotiator.toml")
    artifact_root: str = ""
    max_concurrency: int = 1


class OutputSettings(BaseModel):
    root_dir: str = str(workspace_root() / "pipeline" / "outputs")
    enable_cooccurrence_edges: bool = False
    max_entities_for_classification: int = 0


class StorageSettings(BaseModel):
    enabled: bool = True
    database_path: str = str(workspace_root() / "storage" / "data" / "classification_store.sqlite3")


class PipelineConfig(BaseModel):
    preprocess: PreprocessSettings = Field(default_factory=PreprocessSettings)
    spacy_llm: SpacyLLMSettings = Field(default_factory=SpacyLLMSettings)
    llm: dict[str, Any] = Field(default_factory=dict)
    dls: DlsSettings = Field(default_factory=DlsSettings)
    output: OutputSettings = Field(default_factory=OutputSettings)
    storage: StorageSettings = Field(default_factory=StorageSettings)


def load_pipeline_config(path: str | None = None) -> PipelineConfig:
    if path is None:
        return PipelineConfig()
    config_path = Path(path).resolve()
    payload = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    config = PipelineConfig.model_validate(payload)
    base_dir = config_path.parent
    config.preprocess.config_path = _resolve_path(config.preprocess.config_path, base_dir)
    config.spacy_llm.ner.template_path = _resolve_path(config.spacy_llm.ner.template_path, base_dir)
    config.spacy_llm.ner.labels_path = _resolve_path(config.spacy_llm.ner.labels_path, base_dir)
    config.spacy_llm.ner.examples_path = _resolve_optional_path(config.spacy_llm.ner.examples_path, base_dir)
    config.spacy_llm.relation.template_path = _resolve_path(config.spacy_llm.relation.template_path, base_dir)
    config.spacy_llm.relation.labels_path = _resolve_path(config.spacy_llm.relation.labels_path, base_dir)
    config.spacy_llm.relation.examples_path = _resolve_optional_path(config.spacy_llm.relation.examples_path, base_dir)
    config.dls.config_path = _resolve_path(config.dls.config_path, base_dir)
    config.dls.artifact_root = _resolve_optional_path(config.dls.artifact_root, base_dir)
    config.output.root_dir = _resolve_path(config.output.root_dir, base_dir)
    config.storage.database_path = _resolve_path(config.storage.database_path, base_dir)
    return config


def _resolve_path(raw_path: str, base_dir: Path) -> str:
    path = Path(raw_path).expanduser()
    if not path.is_absolute():
        path = (base_dir / path).resolve()
    return str(path)


def _resolve_optional_path(raw_path: str, base_dir: Path) -> str:
    if not raw_path.strip():
        return ""
    return _resolve_path(raw_path, base_dir)
