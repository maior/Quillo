#!/usr/bin/env bash
# Production startup: launch backend (:8675) + frontend (:8678) in the background.
# Logs: logs/backend.log, logs/frontend.log · Stop: scripts/stop.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/logs"; mkdir -p "$LOG"

port_busy() { lsof -ti tcp:"$1" >/dev/null 2>&1; }

echo "▶ backend  : http://0.0.0.0:8675 (docs: /docs)"
if port_busy 8675; then
  echo "  ↳ 8675 already in use — skipping (recommend restarting after stop.sh)"
else
  cd "$ROOT/backend"
  mkdir -p uploads
  nohup .venv/bin/python -m uvicorn quillo.main:app --host 0.0.0.0 --port 8675 \
    > "$LOG/backend.log" 2>&1 &
  echo $! > "$LOG/backend.pid"
fi

echo "▶ frontend : http://0.0.0.0:8678"
if port_busy 8678; then
  echo "  ↳ 8678 already in use — skipping (recommend restarting after stop.sh)"
else
  cd "$ROOT/frontend"
  [ -d .next ] || { echo "  ↳ no .next → running build first"; npm run build; }
  nohup npm run start > "$LOG/frontend.log" 2>&1 &
  echo $! > "$LOG/frontend.pid"
fi

echo "✅ Startup requested. Logs: tail -f $LOG/backend.log $LOG/frontend.log"
