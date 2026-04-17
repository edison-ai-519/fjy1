from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from wikimg.core import Document, WikiError, Workspace, normalize_layer, slugify
from wikimg.kimi_profile import (
    coerce_int,
    extract_summary,
    first_non_empty,
    normalize_properties,
    normalize_relations,
    parse_sections,
    split_frontmatter,
    stringify,
)


SUPPORTED_MODE = {"json", "markdown"}
CORE_REQUIRED_FIELDS = ("title", "type", "domain", "source")
REQUIRED_SECTIONS = ("定义与定位", "证据来源")
SECTION_ORDER = ("定义与定位", "属性", "证据来源", "关联主题")


def ingest_source(
    workspace: Workspace,
    *,
    profile: str,
    mode: str,
    slug: str | None = None,
    layer: str | None = None,
    source_text: str,
) -> dict[str, Any]:
    normalized_profile = profile.strip().lower()
    if normalized_profile != "kimi":
        raise WikiError(f"Unsupported ingest profile '{profile}'.")

    normalized_mode = mode.strip().lower()
    if normalized_mode not in SUPPORTED_MODE:
        raise WikiError(f"Unsupported ingest mode '{mode}'.")

    if normalized_mode == "json":
        batch_payload = parse_json_batch_source(source_text)
        if batch_payload is not None:
            return normalize_json_batch_source(
                workspace,
                profile=normalized_profile,
                layer=layer,
                slug=slug,
                source_text=source_text,
                batch_payload=batch_payload,
            )

    normalized_slug = infer_slug(mode=normalized_mode, explicit_slug=slug, source_text=source_text)
    normalized_layer, inference_warnings = infer_layer(
        mode=normalized_mode,
        explicit_layer=layer,
        source_text=source_text,
    )

    if normalized_mode == "json":
        normalized = normalize_json_source(
            workspace,
            profile=normalized_profile,
            layer=normalized_layer,
            slug=normalized_slug,
            source_text=source_text,
        )
    else:
        normalized = normalize_markdown_source(
            workspace,
            profile=normalized_profile,
            layer=normalized_layer,
            slug=normalized_slug,
            source_text=source_text,
        )

    return {
        "status": "ok",
        "ref": f"{normalized_layer}:{normalized_slug}",
        "layer": normalized_layer,
        "slug": normalized_slug,
        "title": normalized["title"],
        "markdown": normalized["markdown"],
        "warnings": [*inference_warnings, *normalized["warnings"]],
    }


def parse_json_batch_source(source_text: str) -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
    try:
        loaded = json.loads(source_text)
    except json.JSONDecodeError:
        return None

    if isinstance(loaded, list):
        items = loaded
        defaults: dict[str, Any] = {}
    elif isinstance(loaded, dict) and isinstance(loaded.get("items"), list):
        items = loaded["items"]
        defaults = {key: value for key, value in loaded.items() if key != "items"}
    else:
        return None

    normalized_items: list[dict[str, Any]] = []
    for index, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            raise WikiError(f"items[{index}] 必须是 JSON 对象。")
        normalized_items.append({**defaults, **item})

    if not normalized_items:
        raise WikiError("items 不能为空。")
    return defaults, normalized_items


def normalize_json_batch_source(
    workspace: Workspace,
    *,
    profile: str,
    layer: str | None,
    slug: str | None,
    source_text: str,
    batch_payload: tuple[dict[str, Any], list[dict[str, Any]]],
) -> dict[str, Any]:
    defaults, items = batch_payload
    batch_slug = slugify(_first_string(slug, defaults.get("slug"), defaults.get("id"), defaults.get("title"), "batch-ingest"))
    normalized_items = []
    layer_counts = {"common": 0, "domain": 0, "private": 0}
    warnings: list[str] = []

    for index, item in enumerate(items, start=1):
        item_slug = infer_json_item_slug(item, batch_slug if slug else "", index)
        item_source_text = json.dumps(item, ensure_ascii=False, indent=2)
        item_layer, layer_warnings = infer_layer(
            mode="json",
            explicit_layer=layer,
            source_text=item_source_text,
        )
        normalized = normalize_json_source(
            workspace,
            profile=profile,
            layer=item_layer,
            slug=item_slug,
            source_text=item_source_text,
        )
        item_payload = {
            "status": "ok",
            "ref": f"{item_layer}:{item_slug}",
            "layer": item_layer,
            "slug": item_slug,
            "title": normalized["title"],
            "markdown": normalized["markdown"],
            "warnings": [*layer_warnings, *normalized["warnings"]],
        }
        normalized_items.append(item_payload)
        layer_counts[item_layer] += 1
        warnings.extend(f"{item_payload['ref']}: {warning}" for warning in item_payload["warnings"])

    return {
        "status": "ok",
        "batch": True,
        "slug": batch_slug,
        "title": _first_string(defaults.get("title"), "Batch ingest"),
        "total": len(normalized_items),
        "layer_counts": layer_counts,
        "items": normalized_items,
        "warnings": warnings,
    }


def infer_slug(*, mode: str, explicit_slug: str | None, source_text: str) -> str:
    if explicit_slug and explicit_slug.strip():
        return slugify(explicit_slug)

    payload: dict[str, Any] = {}
    if mode == "json":
        try:
            loaded = json.loads(source_text)
        except json.JSONDecodeError:
            loaded = {}
        if isinstance(loaded, dict):
            payload = loaded
    elif mode == "markdown":
        frontmatter, body_markdown = split_frontmatter(source_text.replace("\r\n", "\n"))
        payload = frontmatter if isinstance(frontmatter, dict) else {}
        title = _first_string(payload.get("title"), extract_markdown_h1(body_markdown))
        if title:
            return slugify(title)

    return slugify(_first_string(payload.get("slug"), payload.get("id"), payload.get("title"), payload.get("name")))


def infer_json_item_slug(item: dict[str, Any], batch_slug: str, index: int) -> str:
    explicit_slug = _first_string(item.get("slug"))
    if explicit_slug:
        return slugify(explicit_slug)

    seed = _first_string(item.get("id"), item.get("title"), item.get("name"), f"item-{index}")
    item_slug = slugify(seed)
    return f"{batch_slug}/{item_slug}" if batch_slug else item_slug


def extract_markdown_h1(markdown: str) -> str:
    for line in markdown.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return ""


def infer_layer(*, mode: str, explicit_layer: str | None, source_text: str) -> tuple[str, list[str]]:
    if explicit_layer and explicit_layer.strip():
        return normalize_layer(explicit_layer), []

    payload: dict[str, Any] = {}
    if mode == "json":
        try:
            loaded = json.loads(source_text)
        except json.JSONDecodeError:
            loaded = {}
        if isinstance(loaded, dict):
            payload = loaded
    elif mode == "markdown":
        frontmatter, _ = split_frontmatter(source_text.replace("\r\n", "\n"))
        payload = frontmatter if isinstance(frontmatter, dict) else {}

    explicit_payload_layer = _first_string(
        payload.get("layer"),
        payload.get("knowledge_layer"),
        _nested_get(payload, "kimiwa", "layer"),
    )
    if explicit_payload_layer:
        return normalize_layer(explicit_payload_layer), []

    visibility = _first_string(
        payload.get("visibility"),
        payload.get("privacy"),
        payload.get("access"),
        payload.get("audience"),
    ).lower()
    if visibility in {"private", "personal", "internal", "confidential", "私有", "个人", "内部", "机密"}:
        return "private", ["未传入 layer，WiKiMG 根据访问/可见性字段推断为 private。"]

    page_kind = _first_string(payload.get("page_kind"), payload.get("kind")).lower()
    title = _first_string(payload.get("title"), payload.get("name"), _nested_get(payload, "kimiwa", "name"))
    doc_type = _first_string(payload.get("type"), _nested_get(payload, "kimiwa", "type"))
    domain = _first_string(payload.get("domain"), _nested_get(payload, "kimiwa", "domain"))
    summary = _first_string(payload.get("summary"), payload.get("definition"))
    relations = payload.get("relations")
    sections = payload.get("sections")

    if page_kind == "meta":
        return "common", ["未传入 layer，WiKiMG 根据 page_kind=meta 推断为 common。"]
    if has_common_signal(title, doc_type, domain, summary):
        return "common", ["未传入 layer，WiKiMG 根据共享/通用规范信号推断为 common。"]
    if doc_type or domain or isinstance(relations, list) or isinstance(sections, dict):
        return "domain", ["未传入 layer，WiKiMG 根据领域字段推断为 domain。"]

    return "common", ["未传入 layer，WiKiMG 未发现领域/私有信号，默认推断为 common。"]


def has_common_signal(*values: str) -> bool:
    text = " ".join(value.lower() for value in values if value)
    keywords = (
        "common",
        "shared",
        "general",
        "共享",
        "通用",
        "公共",
        "规范",
        "模板",
        "字段",
        "标准",
    )
    return any(keyword in text for keyword in keywords)


def _first_string(*values: Any) -> str:
    for value in values:
        text = stringify(value)
        if text:
            return text
    return ""


def _nested_get(value: Any, *keys: str) -> Any:
    current = value
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def normalize_json_source(
    workspace: Workspace,
    *,
    profile: str,
    layer: str,
    slug: str,
    source_text: str,
) -> dict[str, Any]:
    try:
        payload = json.loads(source_text)
    except json.JSONDecodeError as error:
        raise WikiError(f"JSON 输入解析失败: {error.msg}") from error

    if not isinstance(payload, dict):
        raise WikiError("JSON 输入必须是对象。")

    title = stringify(payload.get("title"))
    for field in CORE_REQUIRED_FIELDS:
        if not stringify(payload.get(field)):
            raise WikiError(f"缺少必填字段 '{field}'。")

    page_kind = stringify(payload.get("page_kind") or "entity").lower() or "entity"
    if page_kind == "meta":
        raise WikiError("前端双模式入库暂不支持 meta 页面。")

    warnings: list[str] = []
    summary = stringify(payload.get("summary"))
    sections_input = payload.get("sections")
    sections = sections_input if isinstance(sections_input, dict) else {}

    for section_name in REQUIRED_SECTIONS:
        if not _section_has_content(sections.get(section_name)):
            raise WikiError(f"缺少必填章节 '{section_name}'。")

    property_section_value = sections.get("属性")
    if not _section_has_content(property_section_value):
        property_section_value = _build_property_section_from_properties(payload.get("properties"))
        if property_section_value:
            warnings.append("未提供“属性”章节，已根据 properties 自动生成。")

    related_section_value = sections.get("关联主题")
    if not _section_has_content(related_section_value):
        related_section_value = _build_related_section_from_relations(payload.get("relations"))

    frontmatter = {
        "profile": profile,
        "page_kind": page_kind,
        "title": title,
        "type": stringify(payload.get("type")),
        "domain": stringify(payload.get("domain")),
        "level": coerce_int(payload.get("level")),
        "source": stringify(payload.get("source")),
        "properties": payload.get("properties") if isinstance(payload.get("properties"), dict) else {},
        "relations": payload.get("relations") if isinstance(payload.get("relations"), list) else [],
    }

    markdown = render_markdown_document(
        title=title,
        summary=summary or stringify(sections.get("定义与定位")),
        frontmatter=frontmatter,
        sections={
            "定义与定位": render_section_body(sections.get("定义与定位")),
            "属性": render_section_body(property_section_value),
            "证据来源": render_section_body(sections.get("证据来源")),
            "关联主题": render_section_body(related_section_value),
        },
        trailing_sections={
            name: render_section_body(value)
            for name, value in sections.items()
            if name not in SECTION_ORDER
        },
    )

    return {
        "title": title,
        "markdown": markdown,
        "warnings": warnings,
    }


def normalize_markdown_source(
    workspace: Workspace,
    *,
    profile: str,
    layer: str,
    slug: str,
    source_text: str,
) -> dict[str, Any]:
    markdown = source_text.replace("\r\n", "\n").strip()
    if not markdown:
        raise WikiError("Markdown 输入不能为空。")

    normalized_markdown = markdown + ("\n" if not markdown.endswith("\n") else "")
    frontmatter, body_markdown = split_frontmatter(normalized_markdown)
    sections = parse_sections(body_markdown)

    if stringify(frontmatter.get("profile")).lower() != profile:
        raise WikiError(f"Markdown frontmatter.profile 必须为 '{profile}'。")

    page_kind = stringify(frontmatter.get("page_kind") or frontmatter.get("kind") or "entity").lower() or "entity"
    if page_kind == "meta":
        raise WikiError("前端双模式入库暂不支持 meta 页面。")

    for field in CORE_REQUIRED_FIELDS:
        if not stringify(frontmatter.get(field)):
            raise WikiError(f"Markdown frontmatter 缺少必填字段 '{field}'。")

    if coerce_int(frontmatter.get("level")) is None:
        raise WikiError("Markdown frontmatter.level 必须是整数。")

    for section_name in REQUIRED_SECTIONS:
        if not stringify(sections.get(section_name)):
            raise WikiError(f"Markdown 缺少必填章节 '{section_name}'。")

    document = _build_virtual_document(workspace, layer=layer, slug=slug, title=stringify(frontmatter.get("title")))
    relations = normalize_relations(
        workspace,
        document,
        frontmatter.get("relations"),
        [],
    )

    warnings: list[str] = []
    if not relations and stringify(sections.get("关联主题")):
        warnings.append("当前 Markdown 的“关联主题”尚未解析为显式关系，请优先补充 frontmatter.relations。")

    title = first_non_empty(
        stringify(frontmatter.get("title")),
        document.title,
    )
    return {
        "title": title,
        "markdown": normalized_markdown,
        "warnings": warnings,
    }


def render_markdown_document(
    *,
    title: str,
    summary: str,
    frontmatter: dict[str, Any],
    sections: dict[str, str],
    trailing_sections: dict[str, str],
) -> str:
    blocks = [
        "---",
        json.dumps(frontmatter, ensure_ascii=False, indent=2),
        "---",
        f"# {title}",
        "",
    ]

    if summary.strip():
        blocks.extend([f"> {summary.strip()}", ""])

    for section_name in SECTION_ORDER:
        body = sections.get(section_name, "").strip()
        blocks.append(f"## {section_name}")
        blocks.append(body)
        blocks.append("")

    for section_name, body in trailing_sections.items():
        if not body.strip():
            continue
        blocks.append(f"## {section_name}")
        blocks.append(body.strip())
        blocks.append("")

    return "\n".join(blocks).strip() + "\n"


def render_section_body(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        lines = []
        for item in value:
            text = stringify(item)
            if text:
                lines.append(f"- {text}")
        return "\n".join(lines).strip()
    if isinstance(value, dict):
        lines = []
        for key, item in value.items():
            text = stringify(item)
            if text:
                lines.append(f"- {key}: {text}")
        return "\n".join(lines).strip()
    return ""


def _section_has_content(value: Any) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return any(stringify(item) for item in value)
    if isinstance(value, dict):
        return any(stringify(item) for item in value.values())
    return False


def _build_property_section_from_properties(raw_properties: Any) -> list[str]:
    properties = raw_properties if isinstance(raw_properties, dict) else {}
    if not properties:
        return []
    normalized = normalize_properties(properties, "")
    lines = []
    for key, value in normalized.items():
        if isinstance(value, list):
            rendered = ", ".join(stringify(item) for item in value if stringify(item))
        elif isinstance(value, dict):
            rendered = json.dumps(value, ensure_ascii=False)
        else:
            rendered = stringify(value)
        if rendered:
            lines.append(f"{key}: {rendered}")
    return lines


def _build_related_section_from_relations(raw_relations: Any) -> list[str]:
    relations = raw_relations if isinstance(raw_relations, list) else []
    lines = []
    for item in relations:
        if not isinstance(item, dict):
            continue
        target = stringify(item.get("target") or item.get("ref") or item.get("href"))
        relation_type = stringify(item.get("type") or item.get("relation"))
        if not target:
            continue
        if relation_type:
            lines.append(f"{target} ({relation_type})")
        else:
            lines.append(target)
    return lines


def _build_virtual_document(workspace: Workspace, *, layer: str, slug: str, title: str) -> Document:
    path = workspace.docs_dir / layer / f"{slug}.md"
    relative_path = path.relative_to(workspace.root).as_posix()
    return Document(
        layer=layer,
        slug=slug,
        title=title or Path(slug).name,
        path=path,
        relative_path=relative_path,
    )
