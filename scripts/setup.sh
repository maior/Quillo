#!/usr/bin/env bash
# 최초 1회 부트스트랩: 백엔드 venv/의존성(+editable 설치), 프론트엔드 의존성·빌드.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "▶ backend: venv + 의존성 (+ editable 패키지 설치)"
cd "$ROOT/backend"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install --upgrade pip >/dev/null
.venv/bin/pip install -r requirements.txt
.venv/bin/pip install -e .          # `quillo` 를 임포트 가능한 패키지로 설치
mkdir -p uploads

echo "▶ frontend: 의존성 + 프로덕션 빌드"
cd "$ROOT/frontend"
if [ -f package-lock.json ]; then npm ci; else npm install; fi
npm run build

echo "✅ setup 완료 — 'scripts/start.sh' 로 기동하세요."
