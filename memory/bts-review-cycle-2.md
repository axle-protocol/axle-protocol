# BTS 티켓팅 매크로 리뷰 Cycle 2/10
**날짜**: 2026-02-11 14:47 KST

## 발견된 이슈

### 1. NTP 함수 반환 타입 문서화 불일치 (Low)
- docstring에 `Tuple[bool, float]`라고 되어 있지만 실제로는 3개 값 반환
- 타입 힌트 불일치로 IDE 경고 발생 가능

### 2. step_wait_open Rate Limiting 위험 (High)
- 오픈 5초 전 0.1초 간격 새로고침은 서버에서 rate limiting 당할 수 있음
- 최대 50회 새로고침 (5초 동안) → 과도함

### 3. AdaptiveRefreshStrategy.rate_limited 미사용 (Medium)
- 필드는 정의되어 있지만 실제로 활용되지 않음
- Rate limiting 감지 및 대응 로직 부재

## 수정 사항

1. **NTP docstring**: 반환 타입을 `Tuple[bool, float, Optional[str]]`로 수정
2. **step_wait_open**: 
   - 0.1초 → 0.3초로 변경
   - 최대 고속 새로고침 횟수 15회 제한 추가
3. **AdaptiveRefreshStrategy**:
   - `is_rate_limited` 파라미터 추가
   - Rate limiting 감지 시 2초 백오프
   - `_rate_limit_until` 쿨다운 타이머 추가

## 구문 검사
✅ python3 -m py_compile 통과
