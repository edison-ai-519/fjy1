from __future__ import annotations

import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import run_git_query_agent as cli


class RunGitQueryAgentStartupTest(unittest.TestCase):
    def test_auto_start_prefers_gateway_exe_when_present(self) -> None:
        gateway_dir = Path(r"D:\code\FJY\OntoGit\gateway")

        with (
            patch.object(cli, "shutil") as mock_shutil,
            patch.object(cli, "subprocess") as mock_subprocess,
        ):
            mock_shutil.which.return_value = None
            with patch.object(Path, "exists", return_value=True):
                command = cli._build_gateway_start_command(gateway_dir, "auto")

        self.assertEqual(command, [str(gateway_dir / "gateway.exe")])
        mock_subprocess.Popen.assert_not_called()

    def test_auto_start_uses_go_when_gateway_exe_missing(self) -> None:
        gateway_dir = Path(r"D:\code\FJY\OntoGit\gateway")

        with (
            patch.object(cli, "shutil") as mock_shutil,
            patch.object(Path, "exists", return_value=False),
        ):
            mock_shutil.which.side_effect = lambda name: r"C:\Go\bin\go.exe" if name == "go" else None
            command = cli._build_gateway_start_command(gateway_dir, "auto")

        self.assertEqual(command, [r"C:\Go\bin\go.exe", "run", "."])

    def test_start_gateway_waits_until_health_is_ready(self) -> None:
        args = SimpleNamespace(
            gateway_dir=None,
            gateway_start_mode="go",
            gateway_wait_seconds=5,
            start_gateway=True,
        )
        gateway_client = SimpleNamespace(base_url="http://127.0.0.1:8080")

        with (
            patch.object(cli, "_resolve_gateway_dir", return_value=Path(r"D:\code\FJY\OntoGit\gateway")),
            patch.object(cli, "_build_gateway_start_command", return_value=["go", "run", "."]),
            patch.object(cli.subprocess, "Popen") as mock_popen,
            patch.object(cli, "_gateway_is_healthy", side_effect=[False, True]),
            patch.object(cli.time, "monotonic", side_effect=[0, 1, 2, 3, 4, 5]),
            patch.object(cli.time, "sleep") as mock_sleep,
        ):
            started, message = cli._start_gateway_service(args, gateway_client)

        self.assertTrue(started)
        self.assertIn("gateway started", message)
        mock_popen.assert_called_once()
        mock_sleep.assert_called()


if __name__ == "__main__":
    unittest.main()
