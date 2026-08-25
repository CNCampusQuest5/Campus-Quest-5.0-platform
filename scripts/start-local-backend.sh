#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3002}"
HOST="${HOST:-0.0.0.0}"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use. Stop that process or run with a different PORT."
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
  exit 1
fi

cd "$ROOT_DIR"
HOST="$HOST" PORT="$PORT" npm run dev:backend
