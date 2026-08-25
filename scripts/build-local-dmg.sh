#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3002}"
LOCAL_API_URL="${LOCAL_API_URL:-http://localhost:$PORT}"

cd "$ROOT_DIR"
VITE_API_URL="$LOCAL_API_URL" \
VITE_SOCKET_URL="$LOCAL_API_URL" \
CQ_API_URL="$LOCAL_API_URL" \
npm run build:electron

echo
echo "Built local Electron DMGs for backend: $LOCAL_API_URL"
find "$ROOT_DIR/apps/electron/release/1.0.0" -maxdepth 1 -name "*.dmg" -print
