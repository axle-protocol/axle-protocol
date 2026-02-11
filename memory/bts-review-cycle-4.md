# BTS 티켓팅 매크로 리뷰 Cycle 4/10
**날짜**: 2026-02-11 14:52 KST

## 발견된 이슈

### 1. Turnstile Timeout 불일치 (Medium)
- 함수 default: 90초
- 호출 시: 30초
- 실제 필요: 티켓팅 환경에서 60초 권장

### 2. 로그인 검증 쿠키 확인 누락 (Medium)
- 텍스트/URL 기반 확인이 실패하면 "불확실" 반환
- 실제로는 인증 쿠키가 있으면 로그인 성공

### 3. Turnstile 체크박스 1회만 시도 (Medium)
- Turnstile이 재로드되거나 처음 실패 시 재시도 없음
- 여러 번 시도하면 성공률 증가

## 수정 사항

1. **Turnstile Timeout 통일**:
   - 함수 default: 90초 → 60초
   - 호출 시: 30초 → 60초

2. **Turnstile 체크박스 재시도**:
   - 5초, 15초, 30초에 각각 클릭 시도
   - `max_checkbox_attempts = 3`
   - 클릭 성공 시 로깅

3. **로그인 쿠키 검증 추가**:
   - `cdp.network.get_cookies()` 사용
   - token/session/auth 포함 쿠키 확인
   - 인증 쿠키 발견 시 성공 처리

## 구문 검사
✅ python3 -m py_compile 통과
