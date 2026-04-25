from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from ner.cli_support import build_spacy_llm_runtime_payload, normalize_extract_argv, read_text_file, suppress_known_runtime_warnings

suppress_known_runtime_warnings()

from ner.extractor import extract_entities
from ner.spacy_llm_runtime import build_default_ner_runtime

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？；\n])")


def main() -> int:
    parser = argparse.ArgumentParser(description="NER command line interface.")
    subparsers = parser.add_subparsers(dest="command")

    extract_parser = subparsers.add_parser("extract", help="Extract entities from text.")
    extract_parser.add_argument("--input", required=True, help="Input plain text path.")
    extract_parser.add_argument("--output", default="", help="Optional output JSON path.")
    extract_parser.add_argument("--stdout", action="store_true", help="Print JSON to stdout.")
    extract_parser.add_argument("--doc-id", default="", help="Optional document identifier.")
    extract_parser.add_argument("--query", default="", help="Optional query term to extract on matched snippets only.")
    extract_parser.add_argument("--max-sentences", type=int, default=6, help="Used with --query to narrow extraction.")
    extract_parser.add_argument("--provider", choices=("openai", "openrouter"), default="", help="OpenAI-compatible provider name.")
    extract_parser.add_argument("--model", default="", help="OpenAI-compatible model name.")
    extract_parser.add_argument("--api-key", default="", help="OpenAI-compatible API key.")
    extract_parser.add_argument("--base-url", default="", help="OpenAI-compatible base url.")
    extract_parser.add_argument("--openrouter-model", default="", help="Legacy OpenRouter model name override.")
    extract_parser.add_argument("--openrouter-api-key", default="", help="Legacy OpenRouter API key override.")
    extract_parser.add_argument("--openrouter-base-url", default="", help="Legacy OpenRouter base url override.")
    args = parser.parse_args(normalize_extract_argv(sys.argv[1:]))

    if args.command not in {"extract", None}:
        parser.error(f"unsupported command: {args.command}")

    input_path = Path(args.input)
    text = read_text_file(input_path)
    if args.query.strip():
        text = _slice_text_by_query(text, args.query.strip(), max_sentences=max(1, int(args.max_sentences)))
    doc_id = args.doc_id or input_path.stem
    runtime = build_default_ner_runtime(build_spacy_llm_runtime_payload(args))
    document = extract_entities(text, doc_id=doc_id, runtime=runtime)
    rendered = document.model_dump_json(indent=2)
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered, encoding="utf-8")
    if args.stdout or not args.output:
        print(rendered)
    return 0


def _slice_text_by_query(text: str, query: str, *, max_sentences: int) -> str:
    sentences = [piece.strip() for piece in _SENTENCE_SPLIT_RE.split(text) if piece.strip()]
    direct = [sentence for sentence in sentences if query in sentence]
    if not direct:
        lowered = query.lower()
        direct = [sentence for sentence in sentences if lowered in sentence.lower()]
    return "\n".join(direct[:max_sentences]) or text


if __name__ == "__main__":
    raise SystemExit(main())
