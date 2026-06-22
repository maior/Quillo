#!/usr/bin/env bash
# 운영 정지: 8675/8678 포트를 점유한 프로세스를 종료한다.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/logs"

kill_port() {
  local port=$1 pids
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "■ :$port 종료 → $pids"
    kill $pids 2>/dev/null || true
    sleep 1
    pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
    [ -n "$pids" ] && { echo "  ↳ 강제 종료"; kill -9 $pids 2>/dev/null || true; }
  else
    echo "□ :$port 실행 중 아님"
  fi
}

kill_port 8675
kill_port 8678
rm -f "$LOG/backend.pid" "$LOG/frontend.pid" 2>/dev/null || true
echo "✅ 정지 완료."
