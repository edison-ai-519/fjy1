from __future__ import annotations

import hashlib
from typing import Iterable

from entity_relation.schema import EntityRelation, RelationDocument
from ner.demo_data import DEMO_DOC_IDS
from ner.schema import NerDocument, NerEntity

_RELATION_PATTERNS: list[tuple[str, tuple[str, ...], float]] = [
    ("controls", ("控制", "调节", "驱动", "启停", "开关"), 0.84),
    ("monitors", ("监测", "检测", "采集", "测量", "查看"), 0.82),
    ("reports_to", ("上传", "上报", "发送", "同步", "推送"), 0.8),
    ("connected_to", ("连接", "接入", "串口", "联网", "配网"), 0.78),
    ("uses", ("基于", "使用", "采用", "依托"), 0.74),
]


def extract_relations(document: NerDocument) -> RelationDocument:
    if document.doc_id in DEMO_DOC_IDS:
        return _build_demo_relations(document)
    sentence_groups = _group_entities_by_sentence(document.entities)
    relations: list[EntityRelation] = []
    seen_keys: set[tuple[str, str, str]] = set()

    for sentence, entities in sentence_groups.items():
        ordered = _order_entities_in_sentence(sentence, entities)
        if len(ordered) < 2:
            continue
        candidates = _extract_candidate_relations(sentence, ordered)
        for source, target, relation_type, confidence, symmetric in candidates:
            dedupe_key = _dedupe_relation_key(source, target, relation_type, symmetric)
            if dedupe_key in seen_keys:
                continue
            seen_keys.add(dedupe_key)
            relations.append(
                EntityRelation(
                    relation_id=_build_relation_id(document.doc_id, source.entity_id, target.entity_id, relation_type),
                    source_entity_id=source.entity_id,
                    target_entity_id=target.entity_id,
                    source_text=source.normalized_text or source.text,
                    target_text=target.normalized_text or target.text,
                    relation_type=relation_type,
                    confidence=confidence,
                    evidence_sentence=sentence,
                    metadata={
                        "symmetric": symmetric,
                        "trigger": _find_trigger(sentence, relation_type),
                    },
                )
            )

    return RelationDocument(doc_id=document.doc_id, relations=relations)


def _build_demo_relations(document: NerDocument) -> RelationDocument:
    entity_map = {entity.entity_id: entity for entity in document.entities}
    relation_specs = [
        ("ent_demo_system", "ent_demo_platform", "依赖", 0.98),
        ("ent_demo_system", "ent_demo_monitoring", "包含", 0.97),
        ("ent_demo_system", "ent_demo_user", "服务于", 0.96),
        ("ent_demo_system", "ent_demo_feed", "扩展能力", 0.95),
        ("ent_demo_system", "ent_demo_alert", "联动", 0.96),
        ("ent_demo_system", "ent_demo_control", "支撑", 0.97),
        ("ent_demo_system", "ent_demo_console", "入口", 0.97),
        ("ent_demo_system", "ent_demo_oxygen", "包含", 0.95),
        ("ent_demo_system", "ent_demo_device", "依赖", 0.94),
        ("ent_demo_system", "ent_demo_rules", "约束", 0.93),
        ("ent_demo_system", "ent_demo_auth", "流程", 0.93),
        ("ent_demo_system", "ent_demo_boiler", "保障", 0.94),
        ("ent_demo_alert", "ent_demo_monitoring", "监控输入", 0.93),
        ("ent_demo_control", "ent_demo_feed", "执行", 0.94),
        ("ent_demo_console", "ent_demo_control", "操作", 0.96),
        ("ent_demo_console", "ent_demo_alert", "响应", 0.95),
        ("ent_demo_auth", "ent_demo_rules", "落实", 0.94),
        ("ent_demo_oxygen", "ent_demo_device", "控制", 0.93),
    ]
    relations: list[EntityRelation] = []
    for source_id, target_id, relation_type, confidence in relation_specs:
        source = entity_map.get(source_id)
        target = entity_map.get(target_id)
        if source is None or target is None:
            continue
        relations.append(
            EntityRelation(
                relation_id=_build_relation_id(document.doc_id, source.entity_id, target.entity_id, relation_type),
                source_entity_id=source.entity_id,
                target_entity_id=target.entity_id,
                source_text=source.normalized_text or source.text,
                target_text=target.normalized_text or target.text,
                relation_type=relation_type,
                confidence=confidence,
                evidence_sentence=source.source_sentence or document.source_text[:120],
                metadata={"symmetric": False, "trigger": "demo-mock"},
            )
        )
    return RelationDocument(doc_id=document.doc_id, relations=relations)


def _group_entities_by_sentence(entities: Iterable[NerEntity]) -> dict[str, list[NerEntity]]:
    groups: dict[str, list[NerEntity]] = {}
    for entity in entities:
        sentences = list(entity.metadata.get("source_sentences", [])) or [entity.source_sentence]
        for sentence in sentences:
            sentence = str(sentence).strip()
            if not sentence:
                continue
            groups.setdefault(sentence, []).append(entity)
    return groups


def _order_entities_in_sentence(sentence: str, entities: list[NerEntity]) -> list[NerEntity]:
    unique: list[NerEntity] = []
    seen_ids: set[str] = set()
    for entity in sorted(entities, key=lambda item: _sentence_index(sentence, item)):
        if entity.entity_id in seen_ids:
            continue
        seen_ids.add(entity.entity_id)
        unique.append(entity)
    return unique


def _sentence_index(sentence: str, entity: NerEntity) -> int:
    index = sentence.find(entity.normalized_text or entity.text)
    if index >= 0:
        return index
    return 10**6 + entity.start


def _extract_candidate_relations(sentence: str, entities: list[NerEntity]) -> list[tuple[NerEntity, NerEntity, str, float, bool]]:
    candidates: list[tuple[NerEntity, NerEntity, str, float, bool]] = []
    for relation_type, keywords, confidence in _RELATION_PATTERNS:
        trigger = _find_trigger(sentence, relation_type)
        if not trigger:
            continue
        relation_entities = _entities_around_trigger(sentence, entities, trigger)
        if len(relation_entities) < 2:
            continue
        source, target = _select_directional_pair(sentence, relation_entities, trigger, relation_type)
        if source is None or target is None:
            continue
        symmetric = relation_type == "co_occurs_with"
        candidates.append((source, target, relation_type, confidence, symmetric))
    return candidates


def _find_trigger(sentence: str, relation_type: str) -> str:
    for current_relation_type, keywords, _confidence in _RELATION_PATTERNS:
        if current_relation_type != relation_type:
            continue
        for keyword in keywords:
            if keyword in sentence:
                return keyword
    return ""


def _entities_around_trigger(sentence: str, entities: list[NerEntity], trigger: str) -> list[NerEntity]:
    trigger_index = sentence.find(trigger)
    if trigger_index < 0:
        return []
    window_start = max(0, trigger_index - 18)
    window_end = trigger_index + len(trigger) + 18
    selected = [entity for entity in entities if _entity_overlaps_window(sentence, entity, window_start, window_end)]
    return selected or entities[:2]


def _entity_overlaps_window(sentence: str, entity: NerEntity, window_start: int, window_end: int) -> bool:
    start = _sentence_index(sentence, entity)
    end = start + max(len(entity.normalized_text or entity.text), 1)
    return not (end < window_start or start > window_end)


def _select_directional_pair(
    sentence: str,
    entities: list[NerEntity],
    trigger: str,
    relation_type: str,
) -> tuple[NerEntity | None, NerEntity | None]:
    if len(entities) < 2:
        return None, None
    trigger_index = sentence.find(trigger)
    left_entities = [entity for entity in entities if _sentence_index(sentence, entity) <= trigger_index]
    right_entities = [entity for entity in entities if _sentence_index(sentence, entity) >= trigger_index]

    if relation_type in {"reports_to", "connected_to", "uses"}:
        source = _nearest_entity_before(sentence, left_entities, trigger_index)
        target = _nearest_entity_after(sentence, right_entities, trigger_index)
        if source and target and source.entity_id != target.entity_id:
            return source, target

    if relation_type in {"controls", "monitors"}:
        target = _nearest_entity_before(sentence, left_entities, trigger_index)
        source = _nearest_entity_after(sentence, right_entities, trigger_index)
        if source and target and source.entity_id != target.entity_id:
            return source, target

    ordered = sorted(entities, key=lambda item: _sentence_index(sentence, item))
    if len(ordered) >= 2:
        return ordered[0], ordered[1]
    return None, None


def _nearest_entity_before(sentence: str, entities: list[NerEntity], trigger_index: int) -> NerEntity | None:
    candidates = [entity for entity in entities if _sentence_index(sentence, entity) <= trigger_index]
    if not candidates:
        return None
    return max(candidates, key=lambda entity: _sentence_index(sentence, entity))


def _nearest_entity_after(sentence: str, entities: list[NerEntity], trigger_index: int) -> NerEntity | None:
    candidates = [entity for entity in entities if _sentence_index(sentence, entity) >= trigger_index]
    if not candidates:
        return None
    return min(candidates, key=lambda entity: _sentence_index(sentence, entity))


def _dedupe_relation_key(
    source: NerEntity,
    target: NerEntity,
    relation_type: str,
    symmetric: bool,
) -> tuple[str, str, str]:
    left = source.normalized_text or source.text
    right = target.normalized_text or target.text
    if symmetric and left > right:
        left, right = right, left
    return (left, relation_type, right)


def _build_relation_id(doc_id: str, source_entity_id: str, target_entity_id: str, relation_type: str) -> str:
    digest = hashlib.sha1(f"{doc_id}|{source_entity_id}|{target_entity_id}|{relation_type}".encode("utf-8")).hexdigest()[:12]
    return f"rel_{digest}"
