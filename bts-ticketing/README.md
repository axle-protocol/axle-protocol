# BTS Ticketing Bot 🎫

Camoufox + AI 하이브리드 티켓팅 봇

## 🔥 v2.0 - 하이브리드 모드 (2026-02)

### 핵심 개선사항
- **CDP 탐지 회피**: Camoufox (Firefox 기반) 사용
- **Turnstile 자동 해결**: 2captcha API 연동
- **수동 폴백**: CAPTCHA 실패 시 사용자 개입 요청
- **멀티 세션**: 프록시 로테이션 지원

## 특징

### 🚀 하이브리드 모드
- **정상**: 하드코딩 셀렉터로 0.01초 클릭
- **예외**: AI 폴백으로 화면 분석
- **CAPTCHA**: 자동 → 수동 폴백

### 🔐 Turnstile CAPTCHA 자동 해결
- 2captcha/CapSolver API 연동
- sitekey 자동 추출
- token 자동 주입
- 실패 시 수동 폴백 + 음성 알림

### 🤖 AI 기능
- 예상 못한 팝업 감지 및 닫기
- UI 변경시 새 셀렉터 자동 탐색
- 에러 원인 분석 및 해결책 제시

### ⏰ 정시 시작
- 밀리초 단위 정확도
- NTP 동기화 지원

### 🔊 음성 알림
- 성공: "티켓 잡았어!"
- CAPTCHA 필요: "캡챠 해결 필요해요!"
- 실패: "실패했어, 다시 시도해"

## 설치

```bash
# 의존성 설치
pip install -r requirements.txt

# Camoufox 브라우저 다운로드 (자동)
# 첫 실행 시 자동으로 다운로드됨
```

## 환경변수

```bash
# .env.local 파일 생성
cp .env.example .env.local

# 필수 설정
TICKET_USER_ID="your_interpark_id"
TICKET_USER_PW="your_password"
TICKET_URL="https://tickets.interpark.com/goods/12345678"

# CAPTCHA 자동 해결 (권장)
TWOCAPTCHA_API_KEY="your_2captcha_api_key"

# 멀티 세션 (선택)
NUM_SESSIONS=2
PROXY_LIST="proxy1:8080:user:pass,proxy2:8080:user:pass"

# 알림 (선택)
TELEGRAM_BOT_TOKEN="your_bot_token"
TELEGRAM_CHAT_ID="your_chat_id"
```

## 실행

### 하이브리드 모드 (권장) ⭐

```bash
# 즉시 실행
python src/main_hybrid.py --url "https://tickets.interpark.com/goods/12345"

# 20시 정각 대기 후 실행
python src/main_hybrid.py --wait --hour 20 --minute 0

# 멀티 세션 (2개)
python src/main_hybrid.py --sessions 2 --wait

# 헤드리스 + 디버그
python src/main_hybrid.py --headless --debug
```

### 레거시 모드

```bash
# Camoufox 버전
python src/main_camoufox.py --wait --hour 8 --minute 0

# nodriver 버전 (v5)
python src/main_nodriver_v5.py
```

### 테스트

```bash
# 전체 테스트
python src/test_hybrid.py
```

## 크론 설정 (8시 정각)

```bash
# crontab -e
55 7 * * * cd /path/to/bts-ticketing && python src/main_camoufox.py --wait
```

## 파일 구조

```
bts-ticketing/
├── src/
│   ├── main_camoufox.py   # 메인 봇
│   └── ai_helper.py       # AI 기능
├── requirements.txt
└── README.md
```

## AI Helper 사용법

```python
from ai_helper import AIHelper, HybridClicker, PreciseTimer

# AI 초기화
ai = AIHelper(debug=True)

# 화면에서 요소 찾기
selector = await ai.ai_find_element(page, "결제하기 버튼")
coords = await ai.ai_find_element(page, "로그인 버튼", return_type="coordinates")

# 팝업 처리
await ai.handle_unexpected_popup(page)

# 하이브리드 클릭 (빠른 셀렉터 + AI 폴백)
clicker = HybridClicker(ai, page)
await clicker.click("#buy-btn", "구매 버튼")

# 정시 대기
await PreciseTimer.wait_until(8, 0, 0)  # 8시 정각

# TTS 알림
ai.announce_success()
```
