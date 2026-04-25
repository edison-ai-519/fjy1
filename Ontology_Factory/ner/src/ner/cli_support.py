from __future__ import annotations

import warnings
from pathlib import Path
from typing import Any


def suppress_known_runtime_warnings() -> None:
    warnings.filterwarnings(
        "ignore",
        message=r"The pynvml package is deprecated\..*",
        category=FutureWarning,
    )
    warnings.filterwarnings(
        "ignore",
        category=FutureWarning,
        module=r"torch\.cuda\.__init__",
    )


def normalize_extract_argv(argv: list[str]) -> list[str]:
    normalized = list(argv)
    if not normalized:
        return normalized

    first = normalized[0]
    if first in {"-h", "--help"}:
        return normalized

    if first == "extract":
        if len(normalized) > 1 and normalized[1] and not normalized[1].startswith("-"):
            return ["extract", "--input", normalized[1], *normalized[2:]]
        return normalized

    if first.startswith("-"):
        return ["extract", *normalized]

    return ["extract", "--input", first, *normalized[1:], "--stdout"]


def read_text_file(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-16", "utf-16-le", "utf-16-be", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8")


def build_spacy_llm_runtime_payload(args: Any) -> dict[str, str]:
    provider = str(getattr(args, "provider", "") or "").strip().lower()
    model = str(getattr(args, "model", "") or "").strip()
    api_key = str(getattr(args, "api_key", "") or "").strip()
    base_url = str(getattr(args, "base_url", "") or "").strip()

    legacy_model = str(getattr(args, "openrouter_model", "") or "").strip()
    legacy_api_key = str(getattr(args, "openrouter_api_key", "") or "").strip()
    legacy_base_url = str(getattr(args, "openrouter_base_url", "") or "").strip()

    if provider not in {"openai", "openrouter"}:
        provider = "openrouter" if any((legacy_model, legacy_api_key, legacy_base_url)) else ""

    return {
        "provider": provider,
        "model": model or legacy_model,
        "api_key": api_key or legacy_api_key,
        "base_url": base_url or legacy_base_url,
    }
