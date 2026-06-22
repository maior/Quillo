#!/usr/bin/env bash
# Restart: stop then start. (For applying code changes after git pull)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$ROOT/scripts/stop.sh"
"$ROOT/scripts/start.sh"
