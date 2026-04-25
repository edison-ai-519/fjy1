from __future__ import annotations

from pathlib import Path

from ner.cli_support import normalize_extract_argv, read_text_file


def test_normalize_extract_argv_accepts_bare_input_path() -> None:
    assert normalize_extract_argv(["story.txt"]) == ["extract", "--input", "story.txt", "--stdout"]


def test_normalize_extract_argv_accepts_extract_with_positional_input() -> None:
    assert normalize_extract_argv(["extract", "story.txt"]) == ["extract", "--input", "story.txt"]


def test_read_text_file_accepts_utf16_power_shell_output(tmp_path: Path) -> None:
    sample_path = tmp_path / "story.txt"
    sample_path.write_text("阿尔图尔救出了公主。", encoding="utf-16")

    assert read_text_file(sample_path) == "阿尔图尔救出了公主。"
