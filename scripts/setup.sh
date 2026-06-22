#!/usr/bin/env bash
# One-time bootstrap: backend venv/dependencies (+ editable install), frontend dependencies & build.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "▶ backend: venv + dependencies (+ editable package install)"
cd "$ROOT/backend"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install --upgrade pip >/dev/null
.venv/bin/pip install -r requirements.txt
.venv/bin/pip install -e .          # install `quillo` as an importable package
mkdir -p uploads

echo "▶ frontend: dependencies + production build"
cd "$ROOT/frontend"
if [ -f package-lock.json ]; then npm ci; else npm install; fi
npm run build

echo "✅ setup complete — start it with 'scripts/start.sh'."
