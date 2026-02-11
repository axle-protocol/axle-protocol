# SeleniumBase UC Mode 구현

## 날짜
2026-02-11

## 구현 내용

### 새 파일
- `src/main_seleniumbase.py` - SeleniumBase UC Mode 기반 티켓팅 스크립트
- `docs/SELENIUMBASE.md` - 사용 가이드

### SeleniumBase UC Mode 핵심 메서드

1. **`uc_open_with_reconnect(url, reconnect_time)`**
   - 페이지 로드 후 chromedriver 연결 해제
   - 봇 탐지 시점에 chromedriver가 없으므로 통과

2. **`uc_gui_handle_captcha()`**
   - PyAutoGUI로 Turnstile/reCAPTCHA 클릭
   - 실제 마우스 움직임 = 인간처럼 보임

3. **`uc_click(selector, reconnect_time)`**
   - 클릭 후 chromedriver 연결 해제
   - 민감한 버튼 클릭 시 사용

### 구조

```python
from seleniumbase import SB

with SB(uc=True, incognito=True) as sb:
    sb.uc_open_with_reconnect(url, 4)  # 봇 탐지 우회
    sb.uc_gui_handle_captcha()         # CAPTCHA 처리
    sb.uc_click(button, 2)             # 안전한 클릭
```

### 설치
```bash
pip3 install seleniumbase  # v4.46.5 설치됨
```

### 테스트 명령어
```bash
# 로그인 테스트
python3 src/main_seleniumbase.py --test-login

# 실제 실행
python3 src/main_seleniumbase.py
```

## nodriver vs SeleniumBase

| 항목 | nodriver | SeleniumBase UC |
|------|----------|-----------------|
| 기반 | CDP 직접 | undetected-chromedriver |
| 유지보수 | 적음 | 활발 |
| CAPTCHA | 수동 | PyAutoGUI 자동 |
| 문서화 | 부족 | 우수 |
| 커뮤니티 | 작음 | 큼 |

## 다음 단계

1. 로그인 테스트 (실제 계정)
2. 공연 페이지 테스트 (실제 URL)
3. Turnstile 처리 검증
4. 좌석 선택 로직 개선 (Canvas 픽셀 분석)
5. 2captcha 연동 (CAPTCHA 자동 해결)

## 참고
- https://seleniumbase.io/help_docs/uc_mode/
- https://github.com/seleniumbase/SeleniumBase
