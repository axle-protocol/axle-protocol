#!/bin/bash
# X API 마케팅 스크립트

source /Users/hyunwoo/projects/ai-market/.env.local

# OAuth 1.0a 서명 생성 함수
generate_oauth() {
  local method="$1"
  local url="$2"
  local params="$3"
  
  local timestamp=$(date +%s)
  local nonce=$(openssl rand -hex 16)
  
  # OAuth 파라미터
  local oauth_params="oauth_consumer_key=${X_API_KEY}&oauth_nonce=${nonce}&oauth_signature_method=HMAC-SHA1&oauth_timestamp=${timestamp}&oauth_token=${X_ACCESS_TOKEN}&oauth_version=1.0"
  
  # 모든 파라미터 정렬
  local all_params=$(echo -e "${oauth_params}\n${params}" | tr '&' '\n' | sort | tr '\n' '&' | sed 's/&$//')
  
  # 서명 베이스 문자열
  local base_string="${method}&$(python3 -c "import urllib.parse; print(urllib.parse.quote('${url}', safe=''))")&$(python3 -c "import urllib.parse; print(urllib.parse.quote('${all_params}', safe=''))")"
  
  # 서명 키
  local signing_key="${X_API_SECRET}&${X_ACCESS_TOKEN_SECRET}"
  
  # HMAC-SHA1 서명
  local signature=$(echo -n "$base_string" | openssl dgst -sha1 -hmac "$signing_key" -binary | base64 | python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.stdin.read().strip(), safe=''))")
  
  echo "OAuth oauth_consumer_key=\"${X_API_KEY}\", oauth_nonce=\"${nonce}\", oauth_signature=\"${signature}\", oauth_signature_method=\"HMAC-SHA1\", oauth_timestamp=\"${timestamp}\", oauth_token=\"${X_ACCESS_TOKEN}\", oauth_version=\"1.0\""
}

# Bearer 토큰으로 검색
BEARER=$(echo "$X_BEARER_TOKEN" | python3 -c "import urllib.parse,sys; print(urllib.parse.unquote(sys.stdin.read().strip()))")

echo "=== @solana 최근 트윗 검색 ==="
curl -s -X GET "https://api.twitter.com/2/tweets/search/recent?query=from:solana&max_results=5" \
  -H "Authorization: Bearer $BEARER" | jq '.data[0:3] | .[] | {id, text: .text[0:80]}'
