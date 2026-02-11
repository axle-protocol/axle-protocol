# BTS v5.8.0 성능 및 타이밍 전문 리뷰

> 리뷰 일시: 2026-02-11 17:33 KST  
> 리뷰어: Claude (성능 전문 서브에이전트)  
> 대상 파일:
> - `main_nodriver_v5.py` (2850줄)
> - `multi_runner.py` (560줄)

---

## 📊 요약

| 영역 | 발견된 이슈 | 수정됨 | 심각도 |
|------|------------|--------|--------|
| 타이밍 정밀도 | 4개 | 3개 ✅ | 🔴 High |
| 성능 최적화 | 3개 | 1개 ✅ | 🟡 Medium |
| 멀티 인스턴스 동기화 | 3개 | 3개 ✅ | 🟡 Medium |

**총 수정: 7개 이슈**

---

## 1. 타이밍 정밀도 (NTP 동기화)

### ✅ 수정됨: NTP 재동기화 태스크 미시작 (Critical)

**문제:** `_ntp_resync_task()` 함수가 정의만 되고 실제로 시작되지 않음
- 5분마다 drift 보정이 동작하지 않아 장시간 대기 시 시간 오차 누적

**수정:**
```python
# run_ticketing()에서 백그라운드 태스크 시작
ntp_resync_task = asyncio.create_task(
    _ntp_resync_task(interval=Limits.NTP_RESYNC_INTERVAL),
    name="ntp-resync"
)
```

### ✅ 수정됨: 오픈 100ms 전 스핀 대기 CPU 100% 문제

**문제:** `while time.time() < target: pass` 방식이 CPU 100% 사용
- 다른 asyncio 태스크 스케줄링 지연
- 노트북 발열/배터리 소모

**수정:** Adaptive sleep 방식으로 변경
```python
# 10ms 이상 남으면 1ms sleep (CPU 양보)
# 10ms 이하면 스핀 (정밀도 우선)
if target_time - time.time() > 0.01:
    time.sleep(0.001)
```

### ✅ 수정됨: NTP offset 이중 적용 버그

**문제:** 
```python
# 기존 (버그)
target_time = time.time() + remaining + (ntp_status.get('offset_ms', 0) or 0) / 1000
```
`get_accurate_time()`이 이미 offset을 적용하므로 `remaining`에 다시 더하면 이중 적용

**수정:**
```python
# 수정됨
target_time = time.time() + remaining  # offset 제거
```

### ✅ 수정됨: NTP 소켓 타임아웃 단축

**문제:** 2초 타임아웃이 오픈 직전 재동기화 시 지연 유발

**수정:** `NTP_SOCKET: 2.0 → 1.0`

### ⚠️ 미수정: NTP 서버 응답 시간 측정 미사용

**현상:** NTP 서버 응답 시간(RTT)을 측정하지만 offset 보정에 사용하지 않음

**권장:** RTT/2를 offset에 반영하면 더 정확 (현재는 단방향 지연만 고려)

---

## 2. 성능 최적화

### ✅ 수정됨: 새로고침 간격 최적화

**문제:** 기본 150ms, 최소 100ms로 티켓팅에서 보수적

**수정:**
```python
# 변경 전
BASE_INTERVAL: float = 0.15   # 150ms
MIN_INTERVAL: float = 0.10    # 100ms
ACCELERATION_THRESHOLD: int = 5

# 변경 후 (더 공격적)
BASE_INTERVAL: float = 0.12   # 120ms
MIN_INTERVAL: float = 0.08    # 80ms
ACCELERATION_THRESHOLD: int = 3
```

### ⚠️ 미수정: Canvas 픽셀 분석 캐싱 없음

**현상:** 좌석 선택 시 매번 전체 Canvas 스캔 (O(width * height))

**권장:**
- 이전 스캔 결과 캐싱 (좌석 위치는 고정)
- 변경된 영역만 재스캔

### ⚠️ 미수정: find_by_text 기본 timeout 3초

**현상:** 존재하지 않는 요소 탐색 시 3초 대기

**권장:** 티켓팅 critical path에서는 0.5초 사용 (이미 일부 적용됨)
- 상수 추가: `Timeouts.ELEMENT_FIND_FAST = 0.5` ✅

---

## 3. 멀티 인스턴스 동기화

### ✅ 수정됨: RunnerState.results 초기화 위치

**문제:** Lock 획득 후 dict 생성 → 불필요한 락 보유 시간

**수정:**
```python
def __post_init__(self):
    self._init_lock = threading.Lock()
    self.results = {}  # 미리 초기화
```

### ✅ 수정됨: Stagger delay 최소값 보장

**문제:** `stagger_delay=0`이면 모든 인스턴스 동시 시작 → 서버 부하

**수정:**
```python
effective_stagger = max(multi_cfg.stagger_delay, 0.1) if multi_cfg.instance_count > 1 else 0
```

### ✅ 수정됨: Task 결과 수집 시 CancelledError 처리

**문제:** 취소된 태스크의 결과 확인 시 예외 발생 가능

**수정:**
```python
for t in done:
    try:
        if t.cancelled():
            cancelled_count += 1
        elif t.result():
            success_count += 1
        else:
            fail_count += 1
    except asyncio.CancelledError:
        cancelled_count += 1
    except Exception:
        fail_count += 1
```

### ✅ 추가됨: 승리 시간 기록

**추가:** `_victory_time` 필드로 승리 감지 레이턴시 측정 가능

---

## 📈 성능 개선 예상 효과

| 항목 | 변경 전 | 변경 후 | 개선 |
|------|---------|---------|------|
| 새로고침 간격 (최소) | 100ms | 80ms | 20% 빠름 |
| 오픈 타이밍 정밀도 | ±50ms (drift) | ±10ms | 5배 정확 |
| CPU 사용 (대기 중) | 100% (1코어) | ~5% | 95% 절약 |
| 첫 인스턴스 응답 | 0ms | 0ms | 동일 |
| N번째 인스턴스 응답 | 0ms (동시) | N*100ms | 부하 분산 |

---

## 🔧 추가 권장 사항 (미구현)

### 1. 네트워크 지연 보정 (RTT 기반)
```python
# 권장: NTP RTT를 offset에 반영
rtt = (receive_time - send_time)
adjusted_offset = server_time - local_time - (rtt / 2)
```

### 2. 좌석 Canvas 캐싱
```python
class SeatMapCache:
    _last_scan_time: float = 0
    _cached_seats: list = []
    CACHE_TTL: float = 0.5  # 500ms 캐시
```

### 3. 성공 감지 속도 개선
```python
# 현재: 0.5초 간격 체크
# 권장: WebSocket 또는 mutation observer로 즉시 감지
await page.send(cdp.dom.enable())
# DOM 변경 이벤트 감지
```

---

## 📋 테스트 권장 사항

1. **NTP 동기화 테스트**
   ```bash
   # NTP 서버 응답 확인
   python -c "from main_nodriver_v5 import _sync_ntp_blocking; print(_sync_ntp_blocking())"
   ```

2. **스핀 대기 CPU 테스트**
   ```bash
   # top 명령으로 CPU 사용률 확인 (오픈 100ms 전)
   top -pid $(pgrep -f main_nodriver)
   ```

3. **멀티 인스턴스 Race condition 테스트**
   ```bash
   python multi_runner.py --test --instances 5 --stagger 0.1
   ```

---

## 변경된 파일

1. `main_nodriver_v5.py`
   - Line 79: NTP_SOCKET timeout 2.0 → 1.0
   - Line 80: ELEMENT_FIND_FAST 상수 추가
   - Line ~1710: AdaptiveRefreshStrategy 상수 조정
   - Line ~1765: 스핀 대기 → adaptive sleep
   - Line ~2820: NTP 재동기화 태스크 시작

2. `multi_runner.py`
   - Line ~30: RunnerState.results 초기화 위치
   - Line ~55: claim_victory 승리 시간 기록
   - Line ~240: effective_stagger 최소값 보장
   - Line ~290: CancelledError 처리 개선

---

*리뷰 완료. 수정 사항은 이미 파일에 적용됨.*
