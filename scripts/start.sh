#!/usr/bin/env bash
# 운영 기동: 백엔드(:8675) + 프론트엔드(:8678) 를 백그라운드로 띄운다.
# 로그: logs/backend.log, logs/frontend.log · 종료: scripts/stop.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/logs"; mkdir -p "$LOG"

port_busy() { lsof -ti tcp:"$1" >/dev/null 2>&1; }

echo "▶ backend  : http://0.0.0.0:8675 (docs: /docs)"
if port_busy 8675; then
  echo "  ↳ 이미 8675 사용 중 — 건너뜀 (stop.sh 후 재시작 권장)"
else
  cd "$ROOT/backend"
  mkdir -p uploads
  nohup .venv/bin/python -m uvicorn quillo.main:app --host 0.0.0.0 --port 8675 \
    > "$LOG/backend.log" 2>&1 &
  echo $! > "$LOG/backend.pid"
fi

echo "▶ frontend : http://0.0.0.0:8678"
if port_busy 8678; then
  echo "  ↳ 이미 8678 사용 중 — 건너뜀 (stop.sh 후 재시작 권장)"
else
  cd "$ROOT/frontend"
  [ -d .next ] || { echo "  ↳ .next 없음 → 빌드 먼저 수행"; npm run build; }
  nohup npm run start > "$LOG/frontend.log" 2>&1 &
  echo $! > "$LOG/frontend.pid"
fi

echo "✅ 기동 요청 완료. 로그: tail -f $LOG/backend.log $LOG/frontend.log"
