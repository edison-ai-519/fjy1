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
    layer: str,
    slug: str,
    source_text: str,
) -> dict[str, Any]:
    normalized_profile = profile.strip().lower()
    if normalized_profile != "kimi":
        raise WikiError(f"Unsupported ingest profile '{profile}'.")

    normalized_mode = mode.strip().lower()
    if normalized_mode not in SUPPORTED_MODE:
        raise WikiError(f"Unsupported ingest mode '{mode}'.")

    normalized_layer = normalize_layer(layer)
    normalized_slug = slugify(slug)

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
        "warnings": normalized["warnings"],
    }


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
