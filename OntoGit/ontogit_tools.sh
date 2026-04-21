#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export ONTOGIT_ROOT_DIR="${SCRIPT_DIR}"
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

exec "${PYTHON_BIN}" - "$@" <<'PY'
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
import os

GATEWAY_URL = os.environ.get("GATEWAY_BASE_URL", "http://127.0.0.1:8080")
API_KEY = os.environ.get("GATEWAY_SERVICE_API_KEY", "xgk_79689a3af4225035d2de7551ff1b2b69070636b2fbb12205")


def call_api(path: str, method: str = "GET", data: dict | None = None):
    url = f"{GATEWAY_URL}{path}"
    headers = {
        "X-API-Key": API_KEY,
        "Content-Type": "application/json",
    }
    encoded_data = None
    if data is not None:
        encoded_data = json.dumps(data).encode("utf-8")

    req = urllib.request.Request(url, data=encoded_data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        return {"error": str(exc)}


def write_and_infer(project_id: str, filename: str, data: dict, message: str):
    payload = {
        "project_id": project_id,
        "filename": filename,
        "data": data,
        "message": message,
    }
    return call_api("/xg/write-and-infer", method="POST", data=payload)


def read_ontology(project_id: str, filename: str):
    return call_api(f"/xg/read/{project_id}/{filename}")


def get_timelines(project_id: str):
    return call_api(f"/xg/timelines/{project_id}")


def get_projects():
    return call_api("/xg/projects")


def analyze_probability(data: dict):
    return call_api("/probability/api/llm/probability-reason", method="POST", data=data)


def main() -> int:
    parser = argparse.ArgumentParser(description="OntoGit QAgent Tool Bridge")
    subparsers = parser.add_subparsers(dest="command")

    p_write = subparsers.add_parser("write")
    p_write.add_argument("--project", required=True)
    p_write.add_argument("--file", required=True)
    p_write.add_argument("--data", required=True, help="JSON string of ontology data")
    p_write.add_argument("--msg", default="QAgent update")

    p_read = subparsers.add_parser("read")
    p_read.add_argument("--project", required=True)
    p_read.add_argument("--file", required=True)

    subparsers.add_parser("list")

    p_infer = subparsers.add_parser("infer")
    p_infer.add_argument("--data", required=True)

    args = parser.parse_args()

    if args.command == "write":
        result = write_and_infer(args.project, args.file, json.loads(args.data), args.msg)
    elif args.command == "read":
        result = read_ontology(args.project, args.file)
    elif args.command == "list":
        result = get_projects()
    elif args.command == "infer":
        result = analyze_probability(json.loads(args.data))
    else:
        parser.print_help()
        return 1

    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
PY
