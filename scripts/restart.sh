#!/usr/bin/env bash
# 재시작: 정지 후 기동. (git pull 후 코드 반영용)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$ROOT/scripts/stop.sh"
"$ROOT/scripts/start.sh"
