#!/usr/bin/env bash
#
# Quillo one-line installer.
#
#   curl -fsSL https://raw.githubusercontent.com/maior/Quillo/main/install.sh | bash
#
# It checks prerequisites, clones (or updates) the repo, runs the one-time
# setup, and starts both services in the background. Re-running is safe.
#
# Environment overrides:
#   QUILLO_DIR       install location           (default: ./Quillo)
#   QUILLO_REPO      git URL to clone           (default: github.com/maior/Quillo)
#   QUILLO_BRANCH    branch to track            (default: main)
#   QUILLO_ADMIN_EMAIL / QUILLO_ADMIN_PASSWORD  seeded on first boot
#
set -euo pipefail

REPO="${QUILLO_REPO:-https://github.com/maior/Quillo.git}"
BRANCH="${QUILLO_BRANCH:-main}"
DIR="${QUILLO_DIR:-$PWD/Quillo}"

# ── pretty output ───────────────────────────────────────────────────────────
if [ -t 1 ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; GRN=$'\033[32m'; YEL=$'\033[33m'; RED=$'\033[31m'; RST=$'\033[0m'
else
  B=""; DIM=""; GRN=""; YEL=""; RED=""; RST=""
fi
info() { printf '%s▸%s %s\n' "$B" "$RST" "$*"; }
ok()   { printf '%s✓%s %s\n' "$GRN" "$RST" "$*"; }
warn() { printf '%s!%s %s\n' "$YEL" "$RST" "$*"; }
die()  { printf '%s✗ %s%s\n' "$RED" "$*" "$RST" >&2; exit 1; }

printf '\n%sQuillo%s — collaborative LaTeX workspace, installer\n\n' "$B" "$RST"

# ── prerequisites ───────────────────────────────────────────────────────────
need() { command -v "$1" >/dev/null 2>&1 || die "missing required tool: $1 — please install it and re-run."; }
need git
need python3
need node
need npm

# python >= 3.10 (SQLAlchemy 2.0 / FastAPI stack)
pyok="$(python3 - <<'PY'
import sys
print("ok" if sys.version_info[:2] >= (3, 10) else "old")
PY
)"
[ "$pyok" = "ok" ] || die "Python 3.10+ required (found $(python3 -V 2>&1))."

if command -v xelatex >/dev/null 2>&1; then
  ok "xelatex found — PDF compilation enabled"
else
  warn "xelatex not found — the app runs, but the Compile endpoint stays disabled until you install a TeX distribution (e.g. TeX Live / MacTeX)."
fi

# ── locate or fetch the repo ────────────────────────────────────────────────
SELF="${BASH_SOURCE[0]:-}"
if [ -f "scripts/setup.sh" ] && [ -f "scripts/start.sh" ]; then
  ROOT="$(pwd)"
  info "using current checkout: $ROOT"
elif [ -n "$SELF" ] && [ -f "$(cd "$(dirname "$SELF")" 2>/dev/null && pwd)/scripts/setup.sh" ]; then
  ROOT="$(cd "$(dirname "$SELF")" && pwd)"
  info "using checkout next to installer: $ROOT"
elif [ -d "$DIR/.git" ]; then
  info "updating existing checkout: $DIR"
  git -C "$DIR" pull --ff-only || warn "could not fast-forward — using the checkout as-is."
  ROOT="$DIR"
else
  info "cloning $REPO → $DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$DIR"
  ROOT="$DIR"
fi
cd "$ROOT"

# ── setup + start ───────────────────────────────────────────────────────────
info "running one-time setup (backend venv + frontend build)…"
bash scripts/setup.sh

info "starting services…"
bash scripts/start.sh

# ── wait for health ─────────────────────────────────────────────────────────
wait_up() { # url, name
  for _ in $(seq 1 90); do
    if curl -fsS -o /dev/null "$1" 2>/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}
info "waiting for services to come up…"
wait_up "http://localhost:8675/docs"  "backend"  && ok "backend  ready → http://localhost:8675/docs" || warn "backend did not answer in time — check logs/backend.log"
wait_up "http://localhost:8678/"      "frontend" && ok "frontend ready → http://localhost:8678"       || warn "frontend did not answer in time — check logs/frontend.log"

# ── done ────────────────────────────────────────────────────────────────────
EMAIL="${QUILLO_ADMIN_EMAIL:-admin@quillo.local}"
PASS="${QUILLO_ADMIN_PASSWORD:-change-me-quillo}"
cat <<EOF

${GRN}${B}Quillo is running.${RST}

  App        ${B}http://localhost:8678${RST}
  API docs   ${B}http://localhost:8675/docs${RST}

  Sign in    ${EMAIL} / ${PASS}
EOF
if [ "$PASS" = "change-me-quillo" ]; then
  printf '  %s! change this default before exposing the server%s\n' "$YEL" "$RST"
fi
cat <<EOF

  Manage     cd "${ROOT}"
             scripts/stop.sh      # stop
             scripts/restart.sh   # git pull + restart
             tail -f logs/*.log   # follow logs

EOF
