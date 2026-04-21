#!/usr/bin/env bash

set -euo pipefail

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SCRIPT_DIR
PYTHON_BIN="${PYTHON_BIN:-}"

# 寻找可用的 python 命令 (兼容 Windows/Git Bash)
resolve_python() {
  if [[ -n "${PYTHON_BIN}" ]] && command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
    printf '%s\n' "${PYTHON_BIN}"
    return
  fi
  # 按照优先级查找
  for candidate in python.exe python3.exe py.exe python3 python py; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      # 验证是否为有效的 Python（排除 Windows 商店占位符）
      if "${candidate}" --version >/dev/null 2>&1; then
        printf '%s\n' "${candidate}"
        return
      fi
    fi
  done
  printf '%s\n' "python"
}

PYTHON_BIN="$(resolve_python)"

# 执行嵌入的 Python 逻辑
exec "${PYTHON_BIN}" - "$@" <<'PY'
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ORIGINAL_ENV = dict(os.environ)

def get_script_dir() -> Path:
    script_dir_env = os.environ.get("SCRIPT_DIR")
    if script_dir_env:
        return Path(script_dir_env).resolve()

    return Path.cwd().resolve()


SCRIPT_DIR = get_script_dir()


# 尝试加载 .env 配置
def load_env() -> None:
    # 查找顺序：当前目录 -> 脚本目录 -> 脚本目录下的 probability / agent
    paths = [
        Path.cwd() / ".env",
        SCRIPT_DIR / ".env",
        SCRIPT_DIR / "probability" / ".env",
        SCRIPT_DIR / "agent" / ".env",
    ]
    for p in paths:
        if p.exists():
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, val = line.split("=", 1)
                        os.environ.setdefault(key.strip(), val.strip())
            break


def read_json_if_exists(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def get_model_section(config: dict) -> dict:
    model = config.get("model")
    return model if isinstance(model, dict) else {}


def get_config_api_key(config: dict) -> str:
    model = get_model_section(config)
    value = model.get("apiKey") or config.get("apiKey")
    return value.strip() if isinstance(value, str) else ""


def get_config_base_url(config: dict) -> str:
    model = get_model_section(config)
    value = model.get("baseUrl") or config.get("baseUrl")
    return value.strip() if isinstance(value, str) else ""


REPO_ROOT = SCRIPT_DIR.parent
HOME_AGENT_CONFIG = Path.home() / ".agent" / "config.json"
REPO_AGENT_CONFIG = REPO_ROOT / "QAgent" / ".agent" / "config.json"

home_global_config = read_json_if_exists(HOME_AGENT_CONFIG)
repo_global_config = read_json_if_exists(REPO_AGENT_CONFIG)
global_configs = [home_global_config, repo_global_config]

load_env()

try:
    from openai import OpenAI
except ImportError:
    print(json.dumps({"status": "error", "message": "Missing dependency: openai. Please run 'pip install openai'"}, ensure_ascii=False))
    sys.exit(1)

GLOBAL_API_KEY = ""
GLOBAL_BASE_URL = ""
for config in global_configs:
    if not GLOBAL_API_KEY:
        GLOBAL_API_KEY = get_config_api_key(config)
    if not GLOBAL_BASE_URL:
        GLOBAL_BASE_URL = get_config_base_url(config)

def first_non_empty(*values: str | None) -> str:
    for value in values:
        if isinstance(value, str):
            candidate = value.strip()
            if candidate:
                return candidate
    return ""


API_KEY = first_non_empty(
    ORIGINAL_ENV.get("DMXAPI_API_KEY"),
    ORIGINAL_ENV.get("QAGENT_API_KEY"),
    ORIGINAL_ENV.get("OPENAI_API_KEY"),
    ORIGINAL_ENV.get("OPENROUTER_API_KEY"),
    GLOBAL_API_KEY,
    os.environ.get("DMXAPI_API_KEY"),
    os.environ.get("QAGENT_API_KEY"),
    os.environ.get("OPENAI_API_KEY"),
    os.environ.get("OPENROUTER_API_KEY"),
)

if not API_KEY:
    print(json.dumps({"status": "error", "message": "API key not found. Please configure it in ~/.agent/config.json, QAgent/.agent/config.json, or .env file."}, ensure_ascii=False))
    sys.exit(1)

BASE_URL = first_non_empty(
    ORIGINAL_ENV.get("DMXAPI_BASE_URL"),
    ORIGINAL_ENV.get("QAGENT_BASE_URL"),
    GLOBAL_BASE_URL,
    os.environ.get("DMXAPI_BASE_URL"),
    os.environ.get("QAGENT_BASE_URL"),
    "https://openrouter.ai/api/v1",
)
MODEL = os.environ.get("DMXAPI_MODEL", "openai/gpt-4o-mini")

# 简单校验，防止误用网关密钥
if API_KEY.startswith("xgk_"):
    # 如果误用了网关密钥，尝试重新加载以确保能拿到正确的配置
    load_env()
    API_KEY = os.environ.get("DMXAPI_API_KEY") or API_KEY

SYSTEM_PROMPT = os.environ.get(
    "DMXAPI_SYSTEM_PROMPT_PROBABILITY_REASON",
    (
        "你是一个专业、准确的本体概率判断专家。你的任务是根据用户输入内容，判断该对象作为真实本体的概率，"
        "并给出简明中文原因。你必须严格遵守以下规则：\n"
        "1. 只能输出一个 JSON 对象，禁止输出 Markdown、代码块、额外说明或任何非 JSON 内容。\n"
        '2. 输出结构必须严格为 {"probability":"97%","reason":"中文原因"}，且只能包含这两个字段。\n'
        "3. probability 必须是百分比字符串，例如 97%、2%、100%，不得使用小数。\n"
        "4. reason 必须使用中文，简要说明判断依据。"
    )
)

def predict(name: str, details: str = "") -> str:
    try:
        client = OpenAI(api_key=API_KEY, base_url=BASE_URL)
        message = f"对象名称: {name}"
        if details:
            message += f"\n详细描述: {details}"
        
        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": message}
            ],
            temperature=0.3
        )
        content = response.choices[0].message.content.strip()
        
        # 尝试清理可能存在的 Markdown 代码块标记包围
        if content.startswith("```"):
            content = content.split("\n", 1)[-1].rsplit("\n", 1)[0].strip()
            if content.startswith("json"):
                content = content[4:].strip()
                
        return content
    except Exception as e:
        return json.dumps({"status": "error", "message": str(e)}, ensure_ascii=False)

def main() -> int:
    parser = argparse.ArgumentParser(description="OntoGit Probability Prediction CLI")
    parser.add_argument("name", nargs="?", help="本体对象名称")
    parser.add_argument("--details", default="", help="可选的详细描述或 JSON 字符串")
    parser.add_argument("--json", help="直接传入完整的 JSON payload")
    
    args = parser.parse_args()
    
    name = args.name
    details = args.details
    
    if args.json:
        try:
            data = json.loads(args.json)
            name = data.get("name", name)
            details = data.get("details", data.get("abilities", ""))
        except:
            pass

    if not name:
        parser.print_help()
        return 1

    result = predict(name, details)
    print(result)
    return 0

if __name__ == "__main__":
    sys.exit(main())
PY
