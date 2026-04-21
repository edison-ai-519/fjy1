#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export ONTOGIT_AGENT_DIR="${SCRIPT_DIR}"
PYTHON_BIN="${PYTHON_BIN:-}"

resolve_python() {
  if [[ -n "${PYTHON_BIN}" ]] && command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
    printf '%s\n' "${PYTHON_BIN}"
    return
  fi
  for candidate in python.exe python3.exe py.exe python3 python py; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      printf '%s\n' "${candidate}"
      return
    fi
  done
  if command -v powershell.exe >/dev/null 2>&1; then
    local resolved
    resolved="$(powershell.exe -NoProfile -Command "(Get-Command python -ErrorAction SilentlyContinue).Source")"
    resolved="${resolved//$'\r'/}"
    if [[ -n "${resolved}" ]]; then
      printf '%s\n' "${resolved}"
      return
    fi
    resolved="$(powershell.exe -NoProfile -Command "(Get-Command python3 -ErrorAction SilentlyContinue).Source")"
    resolved="${resolved//$'\r'/}"
    if [[ -n "${resolved}" ]]; then
      printf '%s\n' "${resolved}"
      return
    fi
    resolved="$(powershell.exe -NoProfile -Command "(Get-Command py -ErrorAction SilentlyContinue).Source")"
    resolved="${resolved//$'\r'/}"
    if [[ -n "${resolved}" ]]; then
      printf '%s\n' "${resolved}"
      return
    fi
  fi
  printf '%s\n' "python"
}

PYTHON_BIN="$(resolve_python)"

cd "${SCRIPT_DIR}"
exec "${PYTHON_BIN}" - "$@" <<'PY'
from __future__ import annotations

from typing import Any

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

from git_query_agent import GitQueryAgent
from git_query_tools import GatewayClient

EXIT_OK = 0
EXIT_CLI_ERROR = 2
EXIT_UNSUPPORTED = 3
EXIT_AUTH_ERROR = 4
EXIT_RUNTIME_ERROR = 1
DEFAULT_GATEWAY_DIR = Path(os.environ.get("ONTOGIT_AGENT_DIR", Path.cwd())).parent / "gateway"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the natural-language git query agent.")
    parser.add_argument("question", nargs="?", help="Natural-language question to ask the git query agent.")
    parser.add_argument("--query", dest="query_arg", help="Same as question, for CLI compatibility.")
    parser.add_argument("--project-id", help="Default project ID, for example demo.")
    parser.add_argument("--filename", help="Default filename, for example student.json.")
    parser.add_argument("--base-url", help="Gateway base URL, for example http://127.0.0.1:8080.")
    parser.add_argument("--api-key", help="Gateway service API key.")
    parser.add_argument("--bearer-token", help="Gateway bearer token.")
    parser.add_argument("--username", help="Gateway login username.")
    parser.add_argument("--password", help="Gateway login password.")
    parser.add_argument(
        "--start-gateway",
        action="store_true",
        help="If the gateway is unreachable, try to start it automatically before querying.",
    )
    parser.add_argument(
        "--gateway-dir",
        help="Gateway project directory. Defaults to ../gateway next to the agent directory.",
    )
    parser.add_argument(
        "--gateway-start-mode",
        choices=("auto", "go", "docker"),
        default="auto",
        help="How to start the gateway when --start-gateway is enabled.",
    )
    parser.add_argument(
        "--gateway-wait-seconds",
        type=int,
        default=30,
        help="How long to wait for the gateway to become healthy after startup.",
    )
    parser.add_argument("--include-raw", action="store_true", help="Include raw LLM responses.")
    return parser


def _emit(payload: dict[str, object]) -> None:
    content = json.dumps(payload, ensure_ascii=False, indent=2)
    sys.stdout.buffer.write(content.encode("utf-8"))
    sys.stdout.buffer.flush()


def _error_payload(error_type: str, message: str, details: dict[str, object] | None = None) -> dict[str, object]:
    payload: dict[str, object] = {
        "status": "error",
        "error_type": error_type,
        "message": message,
    }
    if details:
        payload["details"] = details
    return payload


def _load_env_values() -> dict[str, str]:
    import os
    from dotenv import dotenv_values

    base_dir = Path(os.environ.get("ONTOGIT_AGENT_DIR", Path.cwd()))
    env_path = base_dir / ".env"
    return {**dotenv_values(env_path), **os.environ}  # type: ignore


def resolve_args(args: argparse.Namespace) -> argparse.Namespace:
    env_values = _load_env_values()

    DUMMY_VALUES = {
        "YOUR_API_KEY",
        "YOUR_BEARER_TOKEN",
        "https://api.example.com",
        "https://www.dmxapi.cn/v1",
    }

    def _is_dummy(val: Any) -> bool:
        return str(val).strip() in DUMMY_VALUES

    # 全局配置读取逻辑
    def _read_global_config():
        paths = [
            Path.home() / ".agent" / "config.json",
            Path(env_values.get("ONTOGIT_AGENT_DIR", Path.cwd())).parent / "QAgent" / ".agent" / "config.json"
        ]
        for p in paths:
            if p.exists():
                try:
                    with open(p, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        return data.get("model", {})
                except:
                    pass
        return {}

    global_config = _read_global_config()

    # 优先级：命令行参数 > 环境变量 > 全局 config.json > 本地 .env
    dmx_api_key = (
        os.environ.get("DMXAPI_API_KEY") 
        or global_config.get("apiKey") 
        or env_values.get("DMXAPI_API_KEY") 
        or ""
    )
    if dmx_api_key:
        os.environ["DMXAPI_API_KEY"] = dmx_api_key

    base_url = args.base_url if args.base_url and not _is_dummy(args.base_url) else (
        os.environ.get("GATEWAY_BASE_URL") 
        or global_config.get("baseUrl") 
        or env_values.get("GATEWAY_BASE_URL") 
        or "http://127.0.0.1:8080"
    )
    args.base_url = str(base_url).strip().rstrip("/")

    api_key = args.api_key if args.api_key and not _is_dummy(args.api_key) else (env_values.get("GATEWAY_SERVICE_API_KEY") or "")
    args.api_key = str(api_key).strip()

    bearer_token = args.bearer_token if args.bearer_token and not _is_dummy(args.bearer_token) else (env_values.get("GATEWAY_BEARER_TOKEN") or "")
    args.bearer_token = str(bearer_token).strip()
    return args


def _build_gateway_client(args: argparse.Namespace) -> GatewayClient:
    return GatewayClient(
        base_url=args.base_url,
        api_key=args.api_key,
        bearer_token=args.bearer_token,
    )


def _gateway_health_url(base_url: str | None) -> str:
    resolved = (base_url or "http://127.0.0.1:8080").strip().rstrip("/")
    return f"{resolved}/health"


def _gateway_is_healthy(base_url: str | None, timeout_seconds: float = 2.0) -> bool:
    try:
        with urlopen(_gateway_health_url(base_url), timeout=timeout_seconds) as response:
            if response.status != 200:
                return False
            response.read()
        return True
    except (URLError, TimeoutError, ValueError):
        return False


def _resolve_gateway_dir(value: str | None) -> Path:
    if value and str(value).strip():
        return Path(value).expanduser().resolve()
    return DEFAULT_GATEWAY_DIR


def _build_gateway_start_command(gateway_dir: Path, start_mode: str) -> list[str]:
    gateway_exe = gateway_dir / "gateway.exe"
    if start_mode == "go":
        go = shutil.which("go")
        if not go:
            raise RuntimeError("cannot start gateway with go: go command was not found")
        return [go, "run", "."]
    if start_mode == "docker":
        docker = shutil.which("docker")
        if not docker:
            raise RuntimeError("cannot start gateway with docker: docker command was not found")
        return [docker, "compose", "up", "-d", "--build"]

    if gateway_exe.exists():
        return [str(gateway_exe)]

    go = shutil.which("go")
    if go:
        return [go, "run", "."]

    docker = shutil.which("docker")
    if docker:
        return [docker, "compose", "up", "-d", "--build"]

    raise RuntimeError("cannot determine how to start gateway: neither gateway.exe, go, nor docker was found")


def _start_gateway_service(args: argparse.Namespace, gateway_client: GatewayClient) -> tuple[bool, str]:
    gateway_dir = _resolve_gateway_dir(args.gateway_dir)
    if not gateway_dir.exists():
        raise RuntimeError(f"gateway directory does not exist: {gateway_dir}")

    command = _build_gateway_start_command(gateway_dir, args.gateway_start_mode)
    subprocess.Popen(command, cwd=str(gateway_dir))

    deadline = time.monotonic() + max(1, int(args.gateway_wait_seconds))
    while time.monotonic() < deadline:
        if _gateway_is_healthy(gateway_client.base_url, timeout_seconds=2.0):
            return True, f"gateway started from {gateway_dir}"
        time.sleep(1)

    return False, (
        f"gateway was started from {gateway_dir}, but /health is still unreachable after "
        f"{args.gateway_wait_seconds} seconds"
    )


def _ensure_gateway_available(args: argparse.Namespace, gateway_client: GatewayClient) -> None:
    if _gateway_is_healthy(gateway_client.base_url):
        return

    if not args.start_gateway:
        raise RuntimeError(f"gateway is unreachable at {gateway_client.base_url}")

    started, message = _start_gateway_service(args, gateway_client)
    if started:
        return
    raise RuntimeError(message)


def _gateway_startup_hint(args: argparse.Namespace) -> dict[str, object]:
    gateway_dir = _resolve_gateway_dir(args.gateway_dir)
    return {
        "gateway_dir": str(gateway_dir),
        "start_gateway": bool(args.start_gateway),
        "gateway_start_mode": args.gateway_start_mode,
        "suggestion": (
            "可以先在 gateway 目录执行 `go run .`，"
            "或者重新运行脚本时加上 `--start-gateway` 自动拉起服务。"
        ),
    }


def _run(args: argparse.Namespace) -> tuple[int, dict[str, object]]:
    args = resolve_args(args)
    question = (args.query_arg or args.question or "").strip()
    if not question:
        return EXIT_CLI_ERROR, _error_payload("missing_argument", "question is required (via positional or --query)")

    try:
        gateway_client = _build_gateway_client(args)
    except Exception as exc:
        return EXIT_RUNTIME_ERROR, _error_payload("gateway_client_error", str(exc))

    try:
        _ensure_gateway_available(args, gateway_client)
    except Exception as exc:
        return EXIT_RUNTIME_ERROR, _error_payload(
            "gateway_unavailable",
            str(exc),
            {
                "gateway_dir": str(_resolve_gateway_dir(args.gateway_dir)),
                "start_gateway": bool(args.start_gateway),
                "gateway_start_mode": args.gateway_start_mode,
            },
        )

    if args.username or args.password:
        if not (args.username and args.password):
            return EXIT_CLI_ERROR, _error_payload("missing_argument", "--username and --password must be provided together")
        try:
            gateway_client.login(args.username, args.password)
        except PermissionError as exc:
            return EXIT_AUTH_ERROR, _error_payload("auth_error", str(exc))
        except Exception as exc:
            return EXIT_AUTH_ERROR, _error_payload("auth_error", str(exc))

    try:
        agent = GitQueryAgent(gateway_client=gateway_client)
        result = agent.answer(
            question=question,
            project_id=args.project_id,
            filename=args.filename,
            include_raw=args.include_raw,
        )
    except RuntimeError as exc:
        message = str(exc)
        error_type = "dependency_error"
        if "DMXAPI_API_KEY" in message:
            error_type = "missing_dependency"
        if "failed to connect to gateway" in message.lower() or "gateway is unreachable" in message.lower():
            error_type = "gateway_unavailable"
            return EXIT_RUNTIME_ERROR, _error_payload(error_type, message, _gateway_startup_hint(args))
        return EXIT_RUNTIME_ERROR, _error_payload(error_type, message)
    except PermissionError as exc:
        return EXIT_AUTH_ERROR, _error_payload("auth_error", str(exc))
    except Exception as exc:
        return EXIT_RUNTIME_ERROR, _error_payload("runtime_error", str(exc))

    status = str(result.get("status", "")).strip()
    if status == "unsupported":
        return EXIT_OK, result
    return EXIT_OK, result


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    exit_code, payload = _run(args)
    _emit(payload)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
PY
