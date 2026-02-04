#!/bin/bash
# Post-deploy QA check script
# Run after every deployment to verify core functionality

BASE="https://agentmarket.kr"
PASS=0
FAIL=0

check_page() {
  local url="$1"
  local expect="$2"
  local status=$(curl -s -o /dev/null -w "%{http_code}" "$url" --max-time 10)
  if [ "$status" = "$expect" ]; then
    echo "✅ $url → $status"
    PASS=$((PASS+1))
  else
    echo "❌ $url → $status (expected $expect)"
    FAIL=$((FAIL+1))
  fi
}

check_api() {
  local url="$1"
  local field="$2"
  local response=$(curl -s "$url" --max-time 10)
  if echo "$response" | jq -e ".$field" > /dev/null 2>&1; then
    echo "✅ $url → .$field exists"
    PASS=$((PASS+1))
  else
    echo "❌ $url → .$field missing"
    FAIL=$((FAIL+1))
  fi
}

echo "=== Page Checks ==="
check_page "$BASE/" "200"
check_page "$BASE/ko" "200"
check_page "$BASE/spectate" "200"
check_page "$BASE/ko/spectate" "200"
check_page "$BASE/terms" "200"
check_page "$BASE/privacy" "200"
check_page "$BASE/spectate/agent/analyst" "200"

echo ""
echo "=== API Checks ==="
check_api "$BASE/api/economy/stats" "totalAgents"
check_api "$BASE/api/economy/stats" "latestEpoch"
check_api "$BASE/api/economy/stats" "agents"
check_api "$BASE/api/economy/feed?limit=3" "feed"
check_api "$BASE/api/economy/agents/analyst" "agent"
check_api "$BASE/api/economy/agents/analyst" "stats"

echo ""
echo "=== i18n Checks ==="
# English page should have English title
EN_TITLE=$(curl -s "$BASE/" | grep -o '<title>[^<]*</title>')
if echo "$EN_TITLE" | grep -q "AgentMarket"; then
  echo "✅ English title: $EN_TITLE"
  PASS=$((PASS+1))
else
  echo "❌ English title unexpected: $EN_TITLE"
  FAIL=$((FAIL+1))
fi

# Stats epoch should not be 0
EPOCH=$(curl -s "$BASE/api/economy/stats" | jq '.latestEpoch')
if [ "$EPOCH" != "0" ] && [ "$EPOCH" != "null" ]; then
  echo "✅ Epoch: $EPOCH (not 0)"
  PASS=$((PASS+1))
else
  echo "❌ Epoch: $EPOCH (should not be 0)"
  FAIL=$((FAIL+1))
fi

echo ""
echo "========================"
echo "Results: $PASS passed, $FAIL failed"
echo "========================"

exit $FAIL
