#!/usr/bin/env bash

# OntoGit Startup Script for Linux/macOS
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${ROOT_DIR}/.run-logs"
mkdir -p "${LOG_DIR}"

# Configuration
export GATEWAY_SERVICE_API_KEY="change-me"

stop_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    echo "Stopping process on port ${port}: ${pids}"
    kill ${pids} 2>/dev/null || true
  fi
}

start_service() {
  local dir="$1"
  local cmd="$2"
  local log="$3"
  local msg="$4"
  
  echo "${msg}..."
  (
    cd "${dir}"
    nohup bash -c "${cmd}" >"${log}" 2>&1 &
  )
}

# 1. Start Probability Reasoning Service (FastAPI)
stop_port 5000
start_service "${ROOT_DIR}/probability" \
  "python3 -m app.main" \
  "${LOG_DIR}/probability.log" \
  "Starting Probability Service"

# 2. Start XiaoGuGit (Uvicorn)
stop_port 8000
start_service "${ROOT_DIR}/xiaogugit" \
  "python3 -m uvicorn server:app --host 0.0.0.0 --port 8000" \
  "${LOG_DIR}/xiaogugit.log" \
  "Starting XiaoGuGit"

# 3. Start Gateway (Go Executable)
stop_port 8080
start_service "${ROOT_DIR}/gateway" \
  "./gateway" \
  "${LOG_DIR}/gateway.log" \
  "Starting Gateway"

echo "OntoGit Stack started successfully (Logs in .run-logs/)"
