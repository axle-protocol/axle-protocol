#!/usr/bin/env bash
set -euo pipefail

# Quick correctness gate for SOME.
# Run before commits / releases.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[verify] pnpm install (no-op if already)"
command -v pnpm >/dev/null

# Keep this fast: build + typecheck via tsup, then a smoke run.
echo "[verify] build"
pnpm -r --filter @some/telegram-panel --filter @some/runtime build

echo "[verify] smoke: panel status"
SOME_PANEL_STATE=.state/telegram-panel.json node packages/telegram-panel/dist/handleCli.js "some status" >/dev/null

echo "[verify] OK"
