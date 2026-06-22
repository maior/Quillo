#!/usr/bin/env bash
# Local development: run backend (:8675, --reload) + frontend (:8678, dev) concurrently in the foreground.
# Ctrl-C stops both. (For production startup, use scripts/start.sh)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "▶ backend  : http://localhost:8675 (docs: /docs)"
( cd "$ROOT/backend" && .venv/bin/python -m uvicorn quillo.main:app --host 0.0.0.0 --port 8675 --reload ) &

echo "▶ frontend : http://localhost:8678 (dev)"
( cd "$ROOT/frontend" && npm run dev ) &

wait
