# BTS 티켓팅 매크로 리뷰 Cycle 3/10
**날짜**: 2026-02-11 14:50 KST

## 발견된 이슈

### 1. Canvas CORS 에러 처리 부족 (High)
- `getImageData()`는 cross-origin canvas에서 SecurityError 발생
- 에러 발생 시 폴백 로직은 있지만 CORS 특정 처리 없음
- rect 정보를 잃어서 폴백 클릭 정확도 저하

### 2. multi_runner.py RunnerState Lock 초기화 (Medium)
- `asyncio.Lock()`을 dataclass `__post_init__`에서 생성하면 이벤트 루프 없이 생성됨
- Python 3.10+ 이전에서는 문제 발생 가능

## 수정 사항

### main_nodriver_v5.py
1. **Canvas CORS 처리**:
   - `getImageData` 전에 rect 정보 먼저 추출
   - CORS 에러 시 `cors_blocked` 에러 타입과 함께 rect 정보 반환
   - CORS 에러 로깅 추가

### multi_runner.py
2. **RunnerState Lock 지연 초기화**:
   - `__post_init__`에서 Lock 생성 제거
   - `_ensure_lock()` 메서드 추가 (이벤트 루프 내에서 호출)
   - `claim_victory`, `record_result`에서 `_ensure_lock()` 사용

## 구문 검사
✅ python3 -m py_compile 통과 (두 파일 모두)
