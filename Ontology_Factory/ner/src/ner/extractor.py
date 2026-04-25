from __future__ import annotations

import hashlib
import re
from collections import Counter, defaultdict

from ner.mentions import RawEntityMention
from ner.schema import NerDocument, NerEntity
from ner.spacy_llm_runtime import SpacyLLMNerRuntime, build_default_ner_runtime

_WHITESPACE_RE = re.compile(r"\s+")
_PUNCT_ONLY_RE = re.compile(r"^[\W_]+$", re.UNICODE)
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？；\n])")


def extract_entities(
    text: str,
    *,
    doc_id: str,
    runtime: SpacyLLMNerRuntime | None = None,
) -> NerDocument:
    runtime = runtime or build_default_ner_runtime()
    raw_mentions, runtime_metadata = runtime.extract_mentions(text)
    entities = _merge_mentions(raw_mentions=raw_mentions, text=text, doc_id=doc_id)
    for entity in entities:
        entity.metadata.update(runtime_metadata)
    return NerDocument(doc_id=doc_id, source_text=text, entities=entities)


def _merge_mentions(*, raw_mentions: list[RawEntityMention], text: str, doc_id: str) -> list[NerEntity]:
    grouped: dict[tuple[str, str], list[RawEntityMention]] = defaultdict(list)
    for mention in raw_mentions:
        normalized_text = _normalize_entity_text(mention.text)
        if _is_noise(normalized_text):
            continue
        mention = RawEntityMention(
            text=mention.text.strip(),
            label=mention.label.strip() or "TERM",
            start=max(0, mention.start),
            end=max(mention.start, mention.end),
            confidence=mention.confidence,
        )
        grouped[(normalized_text, mention.label)].append(mention)

    entities: list[NerEntity] = []
    for (normalized_text, label), mentions in grouped.items():
        ordered_mentions = sorted(mentions, key=lambda item: (item.start, item.end))
        surface_counter = Counter(item.text.strip() for item in ordered_mentions if item.text.strip())
        preferred_text = surface_counter.most_common(1)[0][0] if surface_counter else normalized_text
        first = ordered_mentions[0]
        sentence = _extract_sentence(text, first.start, first.end)
        entity = NerEntity(
            entity_id=_build_entity_id(doc_id, normalized_text, label),
            text=preferred_text,
            normalized_text=normalized_text,
            label=label,
            start=first.start,
            end=first.end,
            confidence=_mean_confidence(ordered_mentions),
            source_sentence=sentence,
            metadata={
                "mentions": [
                    {
                        "text": mention.text,
                        "start": mention.start,
                        "end": mention.end,
                        "confidence": mention.confidence,
                    }
                    for mention in ordered_mentions
                ],
                "occurrence_count": len(ordered_mentions),
                "source_sentences": _unique_preserve_order(
                    _extract_sentence(text, mention.start, mention.end) for mention in ordered_mentions
                ),
                "normalization_notes": "",
                "llm_enhanced": False,
            },
        )
        entities.append(entity)
    return sorted(entities, key=lambda item: (item.start, item.end, item.normalized_text))


def _normalize_entity_text(value: str) -> str:
    text = _WHITESPACE_RE.sub(" ", value).strip(" \t\r\n,.;:()[]{}<>\"'“”‘’")
    return text


def _is_noise(value: str) -> bool:
    if not value:
        return True
    if _PUNCT_ONLY_RE.match(value):
        return True
    if len(value) == 1 and not value.isupper():
        return True
    if len(value) < 2 and not any(char.isdigit() for char in value):
        return True
    return False


def _extract_sentence(text: str, start: int, end: int) -> str:
    if not text:
        return ""
    cursor = 0
    for piece in _SENTENCE_SPLIT_RE.split(text):
        sentence = piece.strip()
        next_cursor = cursor + len(piece)
        if sentence and cursor <= start <= next_cursor:
            return sentence
        cursor = next_cursor
    return text[max(0, start - 40) : min(len(text), end + 40)].strip()


def _mean_confidence(mentions: list[RawEntityMention]) -> float | None:
    values = [mention.confidence for mention in mentions if mention.confidence is not None]
    if not values:
        return None
    return sum(values) / len(values)


def _build_entity_id(doc_id: str, normalized_text: str, label: str) -> str:
    digest = hashlib.sha1(f"{doc_id}|{normalized_text}|{label}".encode("utf-8")).hexdigest()[:12]
    return f"ent_{digest}"


def _unique_preserve_order(values):
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result
