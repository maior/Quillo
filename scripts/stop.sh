#!/usr/bin/env bash
# Production stop: terminate the processes occupying ports 8675/8678.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/logs"

kill_port() {
  local port=$1 pids
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "■ :$port terminating → $pids"
    kill $pids 2>/dev/null || true
    sleep 1
    pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
    [ -n "$pids" ] && { echo "  ↳ force kill"; kill -9 $pids 2>/dev/null || true; }
  else
    echo "□ :$port not running"
  fi
}

kill_port 8675
kill_port 8678
rm -f "$LOG/backend.pid" "$LOG/frontend.pid" 2>/dev/null || true
echo "✅ Stopped."
