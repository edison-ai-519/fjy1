from __future__ import annotations

import subprocess
import unittest
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
AGENT_DIR = ROOT_DIR / "agent"


class RunGitQueryAgentShellTest(unittest.TestCase):
    def test_run_git_query_agent_help(self) -> None:
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

    def test_run_git_tool_help(self) -> None:
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

    def test_ontogit_tools_help(self) -> None:
        result = subprocess.run(
            ["bash", "ontogit_tools.sh", "--help"],
            cwd=str(ROOT_DIR),
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertIn("OntoGit QAgent Tool Bridge", result.stdout)


if __name__ == "__main__":
    unittest.main()
