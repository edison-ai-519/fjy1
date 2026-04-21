from __future__ import annotations

import json
import os
import tempfile
import subprocess
from pathlib import Path
from unittest import TestCase


ROOT = Path(__file__).resolve().parents[1]
AGENT_DIR = ROOT / "agent"


class GitQueryAgentCliTests(TestCase):
    def test_query_agent_shell_help(self) -> None:
        result = subprocess.run(
            ["bash", "run_git_query_agent.sh", "--help"],
            cwd=str(AGENT_DIR),
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertIn("Run the natural-language git query agent.", result.stdout)

    def test_tool_shell_help(self) -> None:
        result = subprocess.run(
            ["bash", "run_git_tool.sh", "--help"],
            cwd=str(AGENT_DIR),
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertIn("Run agent git query tools against the gateway.", result.stdout)

    def test_ontogit_tools_shell_help(self) -> None:
        result = subprocess.run(
            ["bash", "ontogit_tools.sh", "--help"],
            cwd=str(ROOT),
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertIn("OntoGit QAgent Tool Bridge", result.stdout)

    def test_readme_documents_shell_cli_paths_and_capabilities(self) -> None:
        readme_path = ROOT / "agent" / "README.md"
        text = readme_path.read_text(encoding="utf-8")

        self.assertIn("agent/run_git_query_agent.sh", text)
        self.assertIn("run_git_tool.sh", text)
        self.assertIn("get_community_top_version", text)
        self.assertIn("get_official_recommendation", text)
        self.assertIn("get_file_timeline", text)
        self.assertIn("get_version_content", text)
        self.assertIn("compare_versions", text)
        self.assertIn("find_governance_gaps", text)


class OntoGitProbabilityScriptTests(TestCase):
    def test_probability_script_reads_global_agent_config(self) -> None:
        with (
            tempfile.TemporaryDirectory() as temp_home,
            tempfile.TemporaryDirectory() as temp_module_dir,
        ):
            home_dir = Path(temp_home)
            agent_dir = home_dir / ".agent"
            agent_dir.mkdir(parents=True, exist_ok=True)
            (agent_dir / "config.json").write_text(
                json.dumps(
                    {
                        "model": {
                            "apiKey": "home-global-api-key",
                            "baseUrl": "https://example.invalid/v1",
                        }
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            module_root = Path(temp_module_dir)
            (module_root / "openai").mkdir(parents=True, exist_ok=True)
            (module_root / "openai" / "__init__.py").write_text(
                """
import json
import os
from pathlib import Path


class _Message:
    def __init__(self, content: str) -> None:
        self.content = content


class _Choice:
    def __init__(self, content: str) -> None:
        self.message = _Message(content)


class _Response:
    def __init__(self, content: str) -> None:
        self.choices = [_Choice(content)]


class _Completions:
    def create(self, *, model, messages, temperature):
        record_path = Path(os.environ["FAKE_OPENAI_CALL_RECORD"])
        record_path.write_text(
            json.dumps(
                {
                    "model": model,
                    "messages": messages,
                    "temperature": temperature,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        return _Response('{"probability":"88%","reason":"ok"}')


class _Chat:
    def __init__(self) -> None:
        self.completions = _Completions()


class OpenAI:
    def __init__(self, api_key=None, base_url=None) -> None:
        Path(os.environ["FAKE_OPENAI_INIT_RECORD"]).write_text(
            json.dumps(
                {
                    "api_key": api_key,
                    "base_url": base_url,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        self.chat = _Chat()
""",
                encoding="utf-8",
            )

            init_record_path = module_root / "init-record.json"
            call_record_path = module_root / "call-record.json"
            env = os.environ.copy()
            env.pop("DMXAPI_API_KEY", None)
            env.pop("OPENAI_API_KEY", None)
            env.pop("OPENROUTER_API_KEY", None)
            env["HOME"] = str(home_dir)
            env["USERPROFILE"] = str(home_dir)
            env["PYTHONPATH"] = str(module_root)
            env["FAKE_OPENAI_INIT_RECORD"] = str(init_record_path)
            env["FAKE_OPENAI_CALL_RECORD"] = str(call_record_path)

            result = subprocess.run(
                ["bash", "probability.sh", "测试对象"],
                cwd=str(ROOT),
                env=env,
                capture_output=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            self.assertTrue(init_record_path.exists(), msg=result.stderr)
            self.assertTrue(call_record_path.exists(), msg=result.stderr)

            record = json.loads(init_record_path.read_text(encoding="utf-8"))
            self.assertEqual(record["api_key"], "home-global-api-key")
            self.assertEqual(record["base_url"], "https://example.invalid/v1")
            self.assertIn('"probability":"88%"', result.stdout)


if __name__ == "__main__":
    import unittest

    unittest.main()
