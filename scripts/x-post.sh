#!/bin/bash
# X/Twitter API v2 - Post Tweet with OAuth 1.0a
# Usage: ./x-post.sh "Your tweet text here"

set -euo pipefail

# Load credentials from ai-market .env.local
ENV_FILE="/Users/hyunwoo/projects/ai-market/.env.local"
if [[ -f "$ENV_FILE" ]]; then
  export $(grep -E "^X_" "$ENV_FILE" | xargs)
fi

TWEET_TEXT="$1"
API_URL="https://api.twitter.com/2/tweets"
METHOD="POST"

# OAuth 1.0a parameters
OAUTH_CONSUMER_KEY="$X_API_KEY"
OAUTH_TOKEN="$X_ACCESS_TOKEN"
OAUTH_NONCE=$(openssl rand -hex 16)
OAUTH_TIMESTAMP=$(date +%s)
OAUTH_SIGNATURE_METHOD="HMAC-SHA1"
OAUTH_VERSION="1.0"

# Percent-encode function
urlencode() {
  python3 -c "import urllib.parse; print(urllib.parse.quote('$1', safe=''))"
}

# Build signature base string
ENCODED_URL=$(urlencode "$API_URL")

# Parameter string (sorted)
PARAM_STRING="oauth_consumer_key=${OAUTH_CONSUMER_KEY}&oauth_nonce=${OAUTH_NONCE}&oauth_signature_method=${OAUTH_SIGNATURE_METHOD}&oauth_timestamp=${OAUTH_TIMESTAMP}&oauth_token=${OAUTH_TOKEN}&oauth_version=${OAUTH_VERSION}"
ENCODED_PARAMS=$(urlencode "$PARAM_STRING")

SIG_BASE="${METHOD}&${ENCODED_URL}&${ENCODED_PARAMS}"

# Signing key
SIGNING_KEY="$(urlencode "$X_API_SECRET")&$(urlencode "$X_ACCESS_TOKEN_SECRET")"

# Generate signature
OAUTH_SIGNATURE=$(echo -n "$SIG_BASE" | openssl dgst -sha1 -hmac "$SIGNING_KEY" -binary | base64)
ENCODED_SIGNATURE=$(urlencode "$OAUTH_SIGNATURE")

# Build Authorization header
AUTH_HEADER="OAuth oauth_consumer_key=\"${OAUTH_CONSUMER_KEY}\", oauth_nonce=\"${OAUTH_NONCE}\", oauth_signature=\"${ENCODED_SIGNATURE}\", oauth_signature_method=\"${OAUTH_SIGNATURE_METHOD}\", oauth_timestamp=\"${OAUTH_TIMESTAMP}\", oauth_token=\"${OAUTH_TOKEN}\", oauth_version=\"${OAUTH_VERSION}\""

# Send tweet
curl -s -X POST "$API_URL" \
  -H "Authorization: ${AUTH_HEADER}" \
  -H "Content-Type: application/json" \
  -d "{\"text\": $(echo "$TWEET_TEXT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))')}"
