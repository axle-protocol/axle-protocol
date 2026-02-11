# BTS Ticketing Bot 🎫

Camoufox + AI 하이브리드 티켓팅 봇

## 특징

### 🚀 하이브리드 모드
- **정상**: 하드코딩 셀렉터로 0.01초 클릭
- **예외**: AI 폴백으로 화면 분석

### 🤖 AI 기능
- 예상 못한 팝업 감지 및 닫기
- UI 변경시 새 셀렉터 자동 탐색
- 에러 원인 분석 및 해결책 제시

### ⏰ 정시 시작
- 밀리초 단위 정확도
- NTP 동기화 지원

### 🔊 음성 알림
- 성공: "티켓 잡았어!"
- 실패: "실패했어, 다시 시도해"

## 설치

```bash
pip install -r requirements.txt
playwright install firefox
```

## 환경변수

```bash
export ANTHROPIC_API_KEY="sk-..."
export TICKET_URL="https://ticket.example.com/bts"
export TICKET_USER_ID="your_id"
export TICKET_USER_PW="your_password"
export TICKET_START_HOUR="8"
export TICKET_DEBUG="1"
```

## 실행

```bash
# 즉시 실행
python src/main_camoufox.py

# 8시 정각 대기 후 실행
python src/main_camoufox.py --wait --hour 8 --minute 0

# 디버그 모드
python src/main_camoufox.py --debug

# 헤드리스
python src/main_camoufox.py --headless
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
