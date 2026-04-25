from __future__ import annotations

from ner.spacy_llm_support import OPENAI_BASE_URL, SpacyLLMModelConfig


def test_spacy_llm_config_prefers_qagent_openai_environment(monkeypatch) -> None:
    monkeypatch.setenv("QAGENT_PROVIDER", "openai")
    monkeypatch.setenv("QAGENT_API_KEY", "openai-key")
    monkeypatch.setenv("QAGENT_MODEL", "gpt-4.1-mini")
    monkeypatch.setenv("QAGENT_BASE_URL", "https://openai.example/v1")

    config = SpacyLLMModelConfig.from_mapping(
        {},
        task_name="ner",
        default_template_filename="ner_template.jinja",
        default_labels_filename="ner_labels.yml",
        default_examples_filename="ner_examples.yml",
    )

    assert config.provider == "openai"
    assert config.api_key == "openai-key"
    assert config.model == "gpt-4.1-mini"
    assert config.base_url == "https://openai.example/v1"
    assert config.api_key_env == "QAGENT_API_KEY"
    assert config.model_env == "QAGENT_MODEL"


def test_spacy_llm_config_ignores_stale_openrouter_defaults_for_openai(monkeypatch) -> None:
    monkeypatch.setenv("QAGENT_PROVIDER", "openai")
    monkeypatch.setenv("QAGENT_API_KEY", "openai-key")
    monkeypatch.setenv("QAGENT_MODEL", "gpt-4.1-mini")

    config = SpacyLLMModelConfig.from_mapping(
        {
            "provider": "openai",
            "api_key_env": "OPENROUTER_API_KEY",
            "model_env": "OPENROUTER_MODEL",
            "base_url": "https://openrouter.ai/api/v1",
        },
        task_name="ner",
        default_template_filename="ner_template.jinja",
        default_labels_filename="ner_labels.yml",
        default_examples_filename="ner_examples.yml",
    )

    assert config.provider == "openai"
    assert config.api_key == "openai-key"
    assert config.model == "gpt-4.1-mini"
    assert config.base_url == OPENAI_BASE_URL
    assert config.api_key_env == "QAGENT_API_KEY"
    assert config.model_env == "QAGENT_MODEL"
