from __future__ import annotations

import importlib.metadata
import os
import time
from pathlib import Path
from typing import Any, Iterable

import httpx
import srsly
import spacy
from pydantic import BaseModel, Field, field_validator, model_validator
from spacy.language import Language
from spacy.tokens import Doc
from spacy_llm.cache import BatchCache
from spacy_llm.pipeline.llm import LLMWrapper
from spacy_llm.registry import fewshot_reader, strip_normalizer

SPACY_LLM_LOCKED_VERSION = "0.7.4"
OPENAI_BASE_URL = "https://api.openai.com/v1"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


def ontology_factory_root() -> Path:
    return Path(__file__).resolve().parents[3]


def spacy_llm_resource_root() -> Path:
    return ontology_factory_root() / "resources" / "spacy_llm"


class LabelDefinition(BaseModel):
    name: str
    description: str
    allowed_aliases: list[str] = Field(default_factory=list)
    examples: list[str] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("label name must not be empty")
        return normalized

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("label description must not be empty")
        return normalized


class LabelConfig(BaseModel):
    version: str
    labels: list[LabelDefinition]

    @field_validator("version")
    @classmethod
    def validate_version(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("label config version must not be empty")
        return normalized

    @model_validator(mode="after")
    def validate_labels(self) -> "LabelConfig":
        if not self.labels:
            raise ValueError("label config must contain at least one label")
        names = [label.name for label in self.labels]
        if len(names) != len(set(names)):
            raise ValueError("label names must be unique")
        return self


class TaskResourcePaths(BaseModel):
    template_path: str
    labels_path: str
    examples_path: str = ""


class SpacyLLMModelConfig(BaseModel):
    provider: str = "openrouter"
    provider_env: str = "QAGENT_PROVIDER"
    api_key: str = ""
    api_key_env: str = "QAGENT_API_KEY"
    base_url: str = OPENROUTER_BASE_URL
    base_url_env: str = "QAGENT_BASE_URL"
    model: str = ""
    model_env: str = "QAGENT_MODEL"
    timeout_s: float = 60.0
    app_name: str = "ontology-factory"
    app_url: str = "https://github.com/ontology-factory"
    context_length: int | None = 32000
    temperature: float = 0.0
    max_retries: int = 3
    retry_interval_s: float = 1.0
    save_io: bool = False
    lang: str = "zh"
    task: TaskResourcePaths

    @field_validator("provider")
    @classmethod
    def validate_provider(cls, value: str) -> str:
        normalized = value.strip().lower() or "openrouter"
        if normalized not in {"openai", "openrouter"}:
            raise ValueError("provider must be one of: openai, openrouter")
        return normalized

    @classmethod
    def from_mapping(
        cls,
        payload: dict[str, Any] | None,
        *,
        task_name: str,
        default_template_filename: str,
        default_labels_filename: str,
        default_examples_filename: str,
    ) -> "SpacyLLMModelConfig":
        payload = payload or {}
        task_payload = dict(payload.get(task_name, {}) or {})
        provider_env = str(payload.get("provider_env", "QAGENT_PROVIDER")).strip() or "QAGENT_PROVIDER"
        provider = _resolve_provider(
            payload,
            provider_env=provider_env,
        )
        api_key_env = _normalize_env_name(
            str(payload.get("api_key_env", "QAGENT_API_KEY")).strip(),
            provider=provider,
            opposite_provider_value="OPENROUTER_API_KEY" if provider == "openai" else "OPENAI_API_KEY",
            fallback="QAGENT_API_KEY",
        )
        model_env = _normalize_env_name(
            str(payload.get("model_env", "QAGENT_MODEL")).strip(),
            provider=provider,
            opposite_provider_value="OPENROUTER_MODEL" if provider == "openai" else "OPENAI_MODEL",
            fallback="QAGENT_MODEL",
        )
        base_url_env = _normalize_env_name(
            str(payload.get("base_url_env", "QAGENT_BASE_URL")).strip(),
            provider=provider,
            opposite_provider_value="OPENROUTER_BASE_URL" if provider == "openai" else "OPENAI_BASE_URL",
            fallback="QAGENT_BASE_URL",
        )

        api_key = _resolve_config_value(
            raw_value=str(payload.get("api_key", "")).strip(),
            env_names=_env_candidates(api_key_env, *_provider_api_key_envs(provider)),
        )
        model = _resolve_config_value(
            raw_value=str(payload.get("model", "")).strip(),
            env_names=_env_candidates(model_env, *_provider_model_envs(provider)),
        )
        base_url = _resolve_base_url(
            raw_value=str(payload.get("base_url", "")).strip(),
            provider=provider,
            env_names=_env_candidates(base_url_env, *_provider_base_url_envs(provider)),
        )

        resource_root = spacy_llm_resource_root()
        template_path = _resolve_path(
            str(task_payload.get("template_path", "")).strip() or str(resource_root / default_template_filename)
        )
        labels_path = _resolve_path(
            str(task_payload.get("labels_path", "")).strip() or str(resource_root / default_labels_filename)
        )
        examples_path = _resolve_optional_path(
            str(task_payload.get("examples_path", "")).strip() or str(resource_root / default_examples_filename)
        )

        return cls(
            provider=provider,
            provider_env=provider_env,
            api_key=api_key,
            api_key_env=api_key_env,
            base_url=base_url,
            base_url_env=base_url_env,
            model=model,
            model_env=model_env,
            timeout_s=float(payload.get("timeout_s", 60.0)),
            app_name=(
                _resolve_config_value(
                    raw_value=str(payload.get("app_name", "")).strip(),
                    env_names=_provider_app_name_envs(provider),
                )
                or "ontology-factory"
            ),
            app_url=(
                _resolve_config_value(
                    raw_value=str(payload.get("app_url", "")).strip(),
                    env_names=_provider_app_url_envs(provider),
                )
                or "https://github.com/ontology-factory"
            ),
            context_length=(
                int(payload["context_length"])
                if payload.get("context_length") not in (None, "")
                else 32000
            ),
            temperature=float(payload.get("temperature", 0.0)),
            max_retries=max(1, int(payload.get("max_retries", 3))),
            retry_interval_s=max(0.1, float(payload.get("retry_interval_s", 1.0))),
            save_io=bool(payload.get("save_io", False)),
            lang=str(payload.get("lang", "zh")).strip() or "zh",
            task=TaskResourcePaths(
                template_path=str(template_path),
                labels_path=str(labels_path),
                examples_path=str(examples_path),
            ),
        )

    def require_ready(self) -> None:
        if not self.api_key:
            raise ValueError(
                f"{_provider_display_name(self.provider)} API key is required for spacy-llm extraction. "
                f"Set one of `{', '.join(self.api_key_env_hints())}` or provide `spacy_llm.api_key`."
            )
        if not self.model:
            raise ValueError(
                f"{_provider_display_name(self.provider)} model is required for spacy-llm extraction. "
                f"Set one of `{', '.join(self.model_env_hints())}` or provide `spacy_llm.model`."
            )

    def api_key_env_hints(self) -> list[str]:
        return _env_candidates(self.api_key_env, *_provider_api_key_envs(self.provider))

    def model_env_hints(self) -> list[str]:
        return _env_candidates(self.model_env, *_provider_model_envs(self.provider))


class OpenAICompatiblePromptExecutor:
    def __init__(self, config: SpacyLLMModelConfig) -> None:
        config.require_ready()
        self._config = config
        self._client = httpx.Client(timeout=config.timeout_s)
        self._url = config.base_url.rstrip("/") + "/chat/completions"

    @property
    def context_length(self) -> int | None:
        return self._config.context_length

    def __call__(self, prompts: Iterable[Iterable[str]]) -> Iterable[Iterable[str]]:
        return [
            [self._send_prompt(prompt) for prompt in prompts_for_doc]
            for prompts_for_doc in prompts
        ]

    def _send_prompt(self, prompt: str) -> str:
        last_error: Exception | None = None
        headers = self._build_headers()
        payload = {
            "model": self._config.model,
            "temperature": self._config.temperature,
            "messages": [{"role": "user", "content": prompt}],
        }

        for attempt in range(1, self._config.max_retries + 1):
            try:
                response = self._client.post(self._url, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
                content = data["choices"][0]["message"]["content"]
                if isinstance(content, list):
                    joined = []
                    for item in content:
                        if isinstance(item, dict) and item.get("type") == "text":
                            joined.append(str(item.get("text", "")))
                    content = "".join(joined)
                if not isinstance(content, str) or not content.strip():
                    raise ValueError(f"{_provider_display_name(self._config.provider)} returned an empty response content")
                return content
            except Exception as exc:  # pragma: no cover - network path
                last_error = exc
                if attempt >= self._config.max_retries:
                    break
                time.sleep(self._config.retry_interval_s * (2 ** (attempt - 1)))

        raise RuntimeError(
            f"spacy-llm {_provider_display_name(self._config.provider)} request failed: {last_error}"
        ) from last_error

    def _build_headers(self) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self._config.api_key}",
            "Content-Type": "application/json",
        }
        if self._config.provider == "openrouter":
            if self._config.app_url.strip():
                headers["HTTP-Referer"] = self._config.app_url.strip()
            if self._config.app_name.strip():
                headers["X-Title"] = self._config.app_name.strip()
        return headers

    def close(self) -> None:
        self._client.close()

    def __del__(self) -> None:  # pragma: no cover - best-effort cleanup
        try:
            self.close()
        except Exception:
            pass


def ensure_locked_spacy_llm_version() -> str:
    installed = importlib.metadata.version("spacy-llm")
    if installed != SPACY_LLM_LOCKED_VERSION:
        raise RuntimeError(
            f"Expected spacy-llm=={SPACY_LLM_LOCKED_VERSION}, found {installed}. "
            "Please install the locked version before running extraction."
        )
    return installed


def make_examples_reader(path: str) -> Any:
    if not path.strip():
        return None
    return fewshot_reader(path)


def load_label_config(path: str) -> LabelConfig:
    payload = _read_structured_file(Path(path))
    if not isinstance(payload, dict):
        raise ValueError(f"Label config at {path} must be an object")
    return LabelConfig.model_validate(payload)


def build_label_definitions(config: LabelConfig) -> dict[str, str]:
    definitions: dict[str, str] = {}
    for label in config.labels:
        parts = [label.description.strip()]
        if label.allowed_aliases:
            aliases = ", ".join(alias.strip() for alias in label.allowed_aliases if alias.strip())
            if aliases:
                parts.append(
                    f"Reference aliases for prompt explanation only (never output these aliases as labels): {aliases}."
                )
        if label.examples:
            examples = "; ".join(example.strip() for example in label.examples if example.strip())
            if examples:
                parts.append(f"Examples: {examples}.")
        definitions[label.name] = " ".join(parts)
    return definitions


def label_names(config: LabelConfig) -> list[str]:
    return [label.name for label in config.labels]


def task_metadata(*, spacy_llm_version: str, label_config: LabelConfig, task_name: str, template_path: str) -> dict[str, Any]:
    return {
        "extraction_backend": "spacy_llm",
        "spacy_llm_version": spacy_llm_version,
        "label_config_version": label_config.version,
        "task_name": task_name,
        "template_path": str(Path(template_path).resolve()),
    }


def read_template(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def make_blank_nlp(lang: str) -> Language:
    return spacy.blank(lang)


def make_llm_wrapper(*, nlp: Language, task: Any, model_config: SpacyLLMModelConfig) -> LLMWrapper:
    return LLMWrapper(
        name="llm",
        vocab=nlp.vocab,
        task=task,
        model=OpenAICompatiblePromptExecutor(model_config),
        cache=BatchCache(path=None, batch_size=64, max_batches_in_mem=1),
        save_io=model_config.save_io,
    )


def strict_label_normalizer() -> Any:
    return strip_normalizer()


def _read_structured_file(path: Path) -> Any:
    suffix = path.suffix.lower()
    if suffix in {".yml", ".yaml"}:
        return srsly.read_yaml(path)
    if suffix == ".json":
        return srsly.read_json(path)
    raise ValueError(f"Unsupported structured file format: {path}")


def _resolve_path(value: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = (Path.cwd() / path).resolve()
    return path


def _resolve_optional_path(value: str) -> str:
    if not value:
        return ""
    return str(_resolve_path(value))


def _provider_display_name(provider: str) -> str:
    return "OpenRouter" if provider == "openrouter" else "OpenAI"


def _normalize_provider(value: str) -> str:
    normalized = value.strip().lower()
    return normalized if normalized in {"openai", "openrouter"} else ""


def _default_base_url_for_provider(provider: str) -> str:
    return OPENROUTER_BASE_URL if provider == "openrouter" else OPENAI_BASE_URL


def _env_candidates(*names: str) -> list[str]:
    results: list[str] = []
    seen: set[str] = set()
    for name in names:
        normalized = name.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        results.append(normalized)
    return results


def _first_env_value(names: Iterable[str]) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def _provider_api_key_envs(provider: str) -> list[str]:
    return ["QAGENT_API_KEY", "OPENAI_API_KEY"] if provider == "openai" else ["QAGENT_API_KEY", "OPENROUTER_API_KEY"]


def _provider_model_envs(provider: str) -> list[str]:
    return ["QAGENT_MODEL", "OPENAI_MODEL"] if provider == "openai" else ["QAGENT_MODEL", "OPENROUTER_MODEL"]


def _provider_base_url_envs(provider: str) -> list[str]:
    return ["QAGENT_BASE_URL", "OPENAI_BASE_URL", "OPENAI_API_BASE"] if provider == "openai" else ["QAGENT_BASE_URL", "OPENROUTER_BASE_URL"]


def _provider_app_name_envs(provider: str) -> list[str]:
    return ["QAGENT_APP_NAME", "OPENROUTER_APP_NAME"] if provider == "openrouter" else ["QAGENT_APP_NAME"]


def _provider_app_url_envs(provider: str) -> list[str]:
    return ["QAGENT_APP_URL", "OPENROUTER_SITE_URL"] if provider == "openrouter" else ["QAGENT_APP_URL"]


def _normalize_env_name(value: str, *, provider: str, opposite_provider_value: str, fallback: str) -> str:
    normalized = value.strip()
    if not normalized or normalized == opposite_provider_value:
        return fallback
    return normalized


def _resolve_config_value(*, raw_value: str, env_names: Iterable[str]) -> str:
    return raw_value.strip() or _first_env_value(env_names)


def _resolve_provider(payload: dict[str, Any], *, provider_env: str) -> str:
    explicit_provider = _normalize_provider(str(payload.get("provider", "")).strip())
    if explicit_provider:
        return explicit_provider

    env_provider = _normalize_provider(
        _first_env_value(_env_candidates(provider_env, "QAGENT_MODEL_PROVIDER"))
    )
    if env_provider:
        return env_provider

    explicit_base_url = str(payload.get("base_url", "")).strip()
    if "openrouter" in explicit_base_url.lower():
        return "openrouter"
    if explicit_base_url:
        return "openai"

    explicit_api_key = str(payload.get("api_key", "")).strip()
    if explicit_api_key.startswith("sk-or-v1"):
        return "openrouter"

    if _first_env_value(["OPENROUTER_API_KEY"]):
        return "openrouter"
    if _first_env_value(["OPENAI_API_KEY"]):
        return "openai"

    return "openrouter"


def _resolve_base_url(*, raw_value: str, provider: str, env_names: Iterable[str]) -> str:
    normalized = raw_value.strip()
    if normalized and normalized != _default_base_url_for_provider("openai" if provider == "openrouter" else "openrouter"):
        return normalized

    return _first_env_value(env_names) or _default_base_url_for_provider(provider)


OpenRouterPromptExecutor = OpenAICompatiblePromptExecutor
