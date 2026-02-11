# SeleniumBase UC Mode 버전

## 개요

SeleniumBase UC (Undetected Chrome) 모드를 사용한 봇 탐지 우회 버전입니다.

### 왜 SeleniumBase UC?

- **undetected-chromedriver** 기반으로 검증된 탐지 우회
- **CDP 탐지 우회** - Chrome DevTools Protocol 탐지 방어
- **Cloudflare/Turnstile 우회** - PyAutoGUI 기반 CAPTCHA 클릭
- **활발한 유지보수** - SeleniumBase 프로젝트가 지속 업데이트

## 설치

```bash
cd /Users/hyunwoo/.openclaw/workspace/bts-ticketing
pip3 install -r requirements.txt
```

## 설정

`.env.local` 파일에 환경변수 설정:

```bash
# 인터파크 로그인 정보
INTERPARK_ID=your_email@example.com
INTERPARK_PWD=your_password

# 공연 URL (실제 URL로 교체)
CONCERT_URL=https://tickets.interpark.com/goods/XXXXXXX

# 오픈 시간 (KST)
OPEN_TIME=2026-02-23 20:00:00

# 좌석 우선순위 (선택)
SEAT_PRIORITY=VIP,R석,S석,A석
```

## 사용법

### 1. 로그인 테스트 (먼저 실행 권장)

```bash
python3 src/main_seleniumbase.py --test-login
```

- 브라우저가 열리고 로그인 시도
- Turnstile CAPTCHA 자동 처리
- 성공/실패 확인 후 5초 뒤 종료

### 2. 실제 티켓팅 실행

```bash
python3 src/main_seleniumbase.py
```

순서:
1. 로그인
2. 공연 페이지 이동
3. 오픈 시간 대기
4. 예매 버튼 클릭
5. 좌석 선택
6. 결제 (수동)

## UC 모드 핵심 기술

### 1. `uc_open_with_reconnect()`

```python
sb.uc_open_with_reconnect(url, reconnect_time=4)
```

- 페이지 로드 후 `reconnect_time`초 동안 chromedriver 연결 해제
- 이 시간 동안 봇 탐지가 작동해도 chromedriver가 없으므로 통과

### 2. `uc_gui_handle_captcha()`

```python
sb.uc_gui_handle_captcha()
```

- PyAutoGUI로 Turnstile/reCAPTCHA 체크박스 클릭
- 마우스가 실제로 움직이므로 봇으로 감지 안됨

### 3. `uc_click()`

```python
sb.uc_click(selector, reconnect_time=2)
```

- 클릭 후 chromedriver 연결 해제
- 민감한 버튼 (예매하기 등) 클릭 시 사용

## 주의사항

1. **Headless 모드 금지**: UC 모드는 headless에서 탐지됨
2. **시크릿 모드 권장**: `incognito=True`로 탐지 우회 강화
3. **PyAutoGUI 필요**: CAPTCHA 클릭에 마우스 제어 사용
4. **macOS**: 손쉬운 사용 → 화면 기록 권한 필요

## 트러블슈팅

### Turnstile CAPTCHA 실패

```python
# 대안 1: 더 긴 reconnect_time
sb.uc_open_with_reconnect(url, reconnect_time=8)

# 대안 2: 수동 클릭
sb.uc_gui_click_captcha()
```

### 요소 못 찾음

셀렉터가 변경되었을 수 있음. 브라우저 개발자 도구로 확인 후 `SELECTORS` 업데이트.

### 로그인 실패

1. 비밀번호 특수문자 확인 (이스케이프 필요할 수 있음)
2. 2단계 인증 비활성화 필요
3. 수동 로그인 후 쿠키 저장 방식 고려

## 파일 구조

```
bts-ticketing/
├── src/
│   ├── main_seleniumbase.py  # 이 버전
│   ├── main_nodriver_v5.py   # nodriver 버전
│   └── config.py
├── logs/
│   └── seleniumbase_YYYYMMDD_HHMMSS.log
├── .env.local
└── requirements.txt
```

## 참고 자료

- [SeleniumBase UC Mode 문서](https://seleniumbase.io/help_docs/uc_mode/)
- [SeleniumBase GitHub](https://github.com/seleniumbase/SeleniumBase)
- [UC Mode 예제](https://github.com/seleniumbase/SeleniumBase/tree/master/examples)
