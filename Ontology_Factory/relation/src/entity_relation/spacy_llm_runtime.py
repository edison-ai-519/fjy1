from __future__ import annotations

import re
import warnings
from typing import Any, Iterable

from spacy.tokens import Doc, Span
from spacy.util import filter_spans
from spacy_llm.compat import ValidationError
from spacy_llm.tasks.rel import RelationItem, make_rel_task
from spacy_llm.tasks.rel.task import RELTask

from ner.schema import NerDocument, NerEntity
from ner.spacy_llm_support import SpacyLLMModelConfig
from ner.spacy_llm_support import build_label_definitions, ensure_locked_spacy_llm_version
from ner.spacy_llm_support import label_names, load_label_config, make_blank_nlp
from ner.spacy_llm_support import make_examples_reader, make_llm_wrapper, read_template
from ner.spacy_llm_support import strict_label_normalizer, task_metadata

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？；\n])")


class SpacyLLMRelationRuntime:
    def __init__(self, config: SpacyLLMModelConfig) -> None:
        self.config = config
        self.spacy_llm_version = ensure_locked_spacy_llm_version()
        self.label_config = load_label_config(config.task.labels_path)
        self.nlp = make_blank_nlp(config.lang)
        self.task = make_rel_task(
            labels=label_names(self.label_config),
            template=read_template(config.task.template_path),
            label_definitions=build_label_definitions(self.label_config),
            examples=make_examples_reader(config.task.examples_path),
            normalizer=strict_label_normalizer(),
            parse_responses=parse_rel_responses_strict,
            shard_reducer=reduce_relation_shards_to_doc,
            verbose=False,
        )
        self.wrapper = make_llm_wrapper(nlp=self.nlp, task=self.task, model_config=config)
        self.metadata = task_metadata(
            spacy_llm_version=self.spacy_llm_version,
            label_config=self.label_config,
            task_name="spacy.REL.v1",
            template_path=config.task.template_path,
        )

    def extract_relations(self, document: NerDocument) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        doc, ordered_entities = self._make_doc(document)
        if len(ordered_entities) < 2:
            return [], dict(self.metadata)
        doc = self.wrapper(doc)
        rel_items = list(getattr(doc._, "rel", []))
        relations: list[dict[str, Any]] = []
        seen: set[tuple[str, str, str]] = set()
        for rel_item in rel_items:
            if rel_item.dep == rel_item.dest:
                continue
            source_entity = ordered_entities[rel_item.dep]
            target_entity = ordered_entities[rel_item.dest]
            relation_key = (
                source_entity.entity_id,
                target_entity.entity_id,
                rel_item.relation,
            )
            if relation_key in seen:
                continue
            seen.add(relation_key)
            relations.append(
                {
                    "source_entity_id": source_entity.entity_id,
                    "target_entity_id": target_entity.entity_id,
                    "source_text": source_entity.normalized_text or source_entity.text,
                    "target_text": target_entity.normalized_text or target_entity.text,
                    "relation_type": rel_item.relation,
                    "confidence": 1.0,
                    "evidence_sentence": _extract_sentence(
                        document.source_text,
                        min(source_entity.start, target_entity.start),
                        max(source_entity.end, target_entity.end),
                    ),
                }
            )
        return relations, dict(self.metadata)

    def _make_doc(self, document: NerDocument) -> tuple[Doc, list[NerEntity]]:
        doc = self.nlp.make_doc(document.source_text)
        entity_spans: list[tuple[NerEntity, Span]] = []
        for entity in sorted(document.entities, key=lambda item: (item.start, item.end, item.entity_id)):
            span = doc.char_span(entity.start, entity.end, label=entity.label, alignment_mode="contract")
            if span is None:
                continue
            entity_spans.append((entity, span))

        filtered_spans = filter_spans([span for _, span in entity_spans])
        kept_by_key = {(span.start_char, span.end_char, span.label_): span for span in filtered_spans}

        ordered_entities: list[NerEntity] = []
        ordered_spans: list[Span] = []
        for entity, span in entity_spans:
            key = (span.start_char, span.end_char, span.label_)
            if key not in kept_by_key:
                continue
            ordered_entities.append(entity)
            ordered_spans.append(kept_by_key[key])
            kept_by_key.pop(key, None)

        doc.ents = tuple(ordered_spans)
        return doc, ordered_entities


def build_default_relation_runtime(payload: dict[str, Any] | None = None) -> SpacyLLMRelationRuntime:
    return SpacyLLMRelationRuntime(
        SpacyLLMModelConfig.from_mapping(
            payload,
            task_name="relation",
            default_template_filename="relation_template.jinja",
            default_labels_filename="relation_labels.yml",
            default_examples_filename="relation_examples.yml",
        )
    )


def parse_rel_responses_strict(
    task: RELTask,
    shards: Iterable[Iterable[Doc]],
    responses: Iterable[Iterable[str]],
) -> Iterable[Iterable[list[RelationItem]]]:
    for responses_for_doc, shards_for_doc in zip(responses, shards):
        results_for_doc: list[list[RelationItem]] = []
        for response, shard in zip(responses_for_doc, shards_for_doc):
            relations: list[RelationItem] = []
            for line in response.strip().split("\n"):
                if not line.strip():
                    continue
                try:
                    rel_item = RelationItem.model_validate_json(line)
                except ValidationError:
                    continue
                normalized = task.normalizer(rel_item.relation)
                if normalized not in task.label_dict:
                    continue
                rel_item.relation = task.label_dict[normalized]
                if 0 <= rel_item.dep < len(shard.ents) and 0 <= rel_item.dest < len(shard.ents):
                    relations.append(rel_item)
            results_for_doc.append(relations)
        yield results_for_doc


def reduce_relation_shards_to_doc(task: RELTask, shards: Iterable[Doc]) -> Doc:
    shards = list(shards)
    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore",
            category=UserWarning,
            message=".*Skipping .* while merging docs.",
        )
        doc = Doc.from_docs(shards, ensure_whitespace=True)
    merged: list[RelationItem] = []
    entity_offset = 0
    for shard in shards:
        shard_relations = list(getattr(shard._, task.field, []))
        for relation in shard_relations:
            merged.append(
                RelationItem(
                    dep=relation.dep + entity_offset,
                    dest=relation.dest + entity_offset,
                    relation=relation.relation,
                )
            )
        entity_offset += len(shard.ents)
    setattr(doc._, task.field, merged)
    return doc


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
    return text[max(0, start - 40): min(len(text), end + 40)].strip()
