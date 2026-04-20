from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
AGENT_DIR = ROOT / "agent"
MODULE_PATH = AGENT_DIR / "run_git_query_agent.py"

if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))


def load_module():
    spec = importlib.util.spec_from_file_location("run_git_query_agent", MODULE_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class GitQueryAgentCliTests(TestCase):
    def run_main(self, args: list[str], agent_result: dict[str, object] | None = None, login_error: Exception | None = None):
        module = load_module()

        class DummyGatewayClient:
            def __init__(self, base_url=None, api_key=None, bearer_token=None):
                self.base_url = base_url
                self.api_key = api_key
                self.bearer_token = bearer_token
                self.logged_in = False

            def login(self, username, password):
                if login_error is not None:
                    raise login_error
                self.logged_in = True

        class DummyAgent:
            def __init__(self, gateway_client=None):
                self.gateway_client = gateway_client

            def answer(self, **kwargs):
                return agent_result or {
                    "status": "success",
                    "question": kwargs.get("question"),
                    "plan": {"tool_name": "none", "arguments": {}, "reason": ""},
                    "tool_result": None,
                    "answer": "ok",
                }

        stdout: list[str] = []

        def fake_print(*items, **kwargs):
            stdout.append(" ".join(str(item) for item in items))

        with patch.object(module, "GatewayClient", DummyGatewayClient), patch.object(module, "GitQueryAgent", DummyAgent):
            with patch("builtins.print", side_effect=fake_print):
                with patch.object(module.sys, "argv", ["run_git_query_agent.py", *args]):
                    code = module.main()

        return code, stdout

    def test_cli_success_returns_zero_and_json(self):
        code, stdout = self.run_main(["学校当前社区推荐版本是什么？", "--project-id", "demo"])

        self.assertEqual(code, 0)
        payload = json.loads(stdout[-1])
        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["answer"], "ok")

    def test_cli_unsupported_returns_exit_code_three(self):
        code, stdout = self.run_main(
            ["这个问题当前工具集无法回答", "--project-id", "demo"],
            agent_result={
                "status": "unsupported",
                "question": "这个问题当前工具集无法回答",
                "plan": {"tool_name": "none", "arguments": {}, "reason": "not supported"},
                "tool_result": None,
                "answer": "当前工具集还不能直接回答这个问题。",
            },
        )

        self.assertEqual(code, 3)
        payload = json.loads(stdout[-1])
        self.assertEqual(payload["status"], "unsupported")

    def test_cli_missing_question_returns_json_error_and_exit_code_two(self):
        module = load_module()
        stdout: list[str] = []

        def fake_print(*items, **kwargs):
            stdout.append(" ".join(str(item) for item in items))

        with patch("builtins.print", side_effect=fake_print):
            with patch.object(module.sys, "argv", ["run_git_query_agent.py"]):
                code = module.main()

        self.assertEqual(code, 2)
        payload = json.loads(stdout[-1])
        self.assertEqual(payload["status"], "error")
        self.assertEqual(payload["error_type"], "missing_argument")

    def test_cli_login_failure_returns_json_error_and_exit_code_four(self):
        code, stdout = self.run_main(
            ["学校当前社区推荐版本是什么？", "--project-id", "demo", "--username", "mogong", "--password", "123456"],
            login_error=PermissionError("denied"),
        )

        self.assertEqual(code, 4)
        payload = json.loads(stdout[-1])
        self.assertEqual(payload["status"], "error")
        self.assertEqual(payload["error_type"], "auth_error")

    def test_skill_file_documents_agent_cli_path_and_capabilities(self):
        skill_path = ROOT / "docs" / "qagent-skills" / "git-query-agent-cli" / "SKILL.md"
        text = skill_path.read_text(encoding="utf-8")

        self.assertIn("agent/", text)
        self.assertIn("agent/run_git_query_agent.py", text)
        self.assertIn("get_community_top_version", text)
        self.assertIn("get_official_recommendation", text)
        self.assertIn("get_file_timeline", text)
        self.assertIn("get_version_content", text)
        self.assertIn("compare_versions", text)
        self.assertIn("find_governance_gaps", text)
        self.assertIn("run_git_tool.py", text)
