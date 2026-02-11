# BTS v5.3.0 - Cycle 1 Review

## 버전: 5.2.0 → 5.3.0

## 수정된 이슈

### 🔴 Critical (보안/안정성)

1. **Thread-safe NTP offset**
   - 문제: `_ntp_offset` 전역 변수가 멀티 세션에서 race condition
   - 해결: `_threading.Lock()` 추가, get/set 시 락 사용

2. **JS 문자 이스케이프 안전성**
   - 문제: `human_type()`에서 특수문자 이스케이프 불완전 (injection 위험)
   - 해결: `_escape_js_char()` 함수 분리, 체계적 이스케이프 처리

3. **User-Agent 탐지 패턴**
   - 문제: `Chrome/120.0.0.{session_id}` 패턴 → 봇 탐지 가능
   - 해결: 실제 Chrome 버전 목록에서 랜덤 선택, 플랫폼도 랜덤화

### 🟡 Medium (리소스 누수/성능)

4. **임시 디렉토리 누수**
   - 문제: `user_data_dir` 임시 디렉토리가 정리되지 않음
   - 해결: `cleanup_browser()`에 디렉토리 정리 로직 추가

5. **HTTP Session 경고**
   - 문제: `get_http_session()` deprecated 함수 문서화 부족
   - 해결: docstring에 경고 추가

### 🟢 Low (multi_runner.py 호환성)

6. **import 오류**
   - 문제: `init_browser`, `handle_turnstile` 존재하지 않는 함수 import
   - 해결: 올바른 함수 import (`step_click_booking`, `detect_captcha` 등)

7. **브라우저 정리 방식**
   - 문제: `browser.__aexit__()` 잘못된 호출
   - 해결: `cleanup_browser()` 함수 사용

8. **Config 호환성**
   - 문제: multi_runner의 Config와 main_nodriver_v5의 Config 구조 불일치
   - 해결: V5Config 객체 직접 생성하여 호환성 보장

9. **Race condition in victory claim**
   - 문제: 여러 인스턴스가 동시에 성공 시 중복 선언 가능
   - 해결: `claim_victory()` 원자적 연산으로 변경

## 현재 점수 (예상)

| 항목 | 이전 | 현재 | 변화 |
|------|------|------|------|
| 코드 품질 | 8.5 | 8.8 | +0.3 |
| 안정성 | 7.5 | 8.2 | +0.7 |
| 성공률 | 7.0 | 7.3 | +0.3 |

## 다음 사이클 목표

- Turnstile 대기 로직 최적화
- 좌석 선택 병렬화
- 에러 처리 강화
- 로깅 일관성 개선
