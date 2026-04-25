"""NER package exports."""

from ner.extractor import extract_entities
from ner.llm import OpenRouterClient, OpenRouterConfig
from ner.mentions import RawEntityMention
from ner.schema import NerDocument, NerEntity
from ner.spacy_llm_runtime import SpacyLLMNerRuntime, build_default_ner_runtime

__all__ = [
    "NerDocument",
    "NerEntity",
    "OpenRouterClient",
    "OpenRouterConfig",
    "RawEntityMention",
    "SpacyLLMNerRuntime",
    "build_default_ner_runtime",
    "extract_entities",
]
