#!/usr/bin/env bash
# 로컬 개발: 백엔드(:8675, --reload) + 프론트엔드(:8678, dev) 포그라운드 동시 실행.
# Ctrl-C 로 둘 다 종료. (운영 기동은 scripts/start.sh)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "▶ backend  : http://localhost:8675 (docs: /docs)"
( cd "$ROOT/backend" && .venv/bin/python -m uvicorn quillo.main:app --host 0.0.0.0 --port 8675 --reload ) &

echo "▶ frontend : http://localhost:8678 (dev)"
( cd "$ROOT/frontend" && npm run dev ) &

wait
