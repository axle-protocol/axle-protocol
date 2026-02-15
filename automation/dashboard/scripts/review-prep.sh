#!/usr/bin/env bash
# review-prep.sh — REVIEW-REQUEST.md + 변경 코드 스니펫을 클립보드에 복사
# 용도: Codex에 붙여넣기용 리뷰 패키지 생성

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
REVIEW_MD="$ROOT/REVIEW-REQUEST.md"
SERVER="$ROOT/server.mjs"
APPJS="$ROOT/public/app.js"

if [ ! -f "$REVIEW_MD" ]; then
  echo "ERROR: $REVIEW_MD not found"
  exit 1
fi

# Validate format: first line must be "# REVIEW-REQUEST", last non-empty line must be "# READY_FOR_CODEX"
FIRST_LINE=$(head -1 "$REVIEW_MD")
LAST_LINE=$(grep -v '^$' "$REVIEW_MD" | tail -1)

if [ "$FIRST_LINE" != "# REVIEW-REQUEST" ]; then
  echo "ERROR: First line must be '# REVIEW-REQUEST', got: $FIRST_LINE"
  exit 1
fi

if [ "$LAST_LINE" != "# READY_FOR_CODEX" ]; then
  echo "ERROR: Last non-empty line must be '# READY_FOR_CODEX', got: $LAST_LINE"
  exit 1
fi

# Build clipboard content
{
  cat "$REVIEW_MD"
  echo ""
  echo "---"
  echo "## Code Snippets (key sections)"
  echo ""

  echo '### NAVER_LIVE + NAVER_CARRIER_MAP (server.mjs L506-520)'
  echo '```js'
  sed -n '506,520p' "$SERVER"
  echo '```'
  echo ""

  echo '### doNaverShipBatch dry-run branch (server.mjs L604-663)'
  echo '```js'
  sed -n '604,663p' "$SERVER"
  echo '```'
  echo ""

  echo '### doNaverConfirmBatch (server.mjs L671-704)'
  echo '```js'
  sed -n '671,704p' "$SERVER"
  echo '```'
  echo ""

  echo '### validateTransition (server.mjs L721-733)'
  echo '```js'
  sed -n '721,733p' "$SERVER"
  echo '```'
  echo ""

  echo '### automationEnabled + autoSyncOrders + autoExecuteApproved guards (server.mjs L3415-3530)'
  echo '```js'
  sed -n '3415,3530p' "$SERVER"
  echo '```'
  echo ""

  echo '### app.js cardTitle/cardSubtitle/cardPreview (app.js L19-60)'
  echo '```js'
  sed -n '19,60p' "$APPJS"
  echo '```'
  echo ""
  echo "# READY_FOR_CODEX"
} | pbcopy

echo "✓ Review package copied to clipboard"
echo "  - REVIEW-REQUEST.md (full)"
echo "  - 6 code snippets"
echo "  - First line: REVIEW-REQUEST"
echo "  - Last line: READY_FOR_CODEX"
echo ""
echo "→ Paste into Codex for review"
