# BTS 티켓팅 v2.0 - 코드 리뷰

---

## Opus 4.6 실용적 리뷰 (2026-02-12)

> **검토 대상:** `src/v2/` 전체 (config.py, session.py, api.py, pre_login.py, worker.py, main_v2.py)
> **평가 관점:** 실전 투입 가능성 + 구체적 다음 단계
> **모드:** 실용적 피드백 (O3 딥추론과 다른 관점)

---

## 📊 v1.0 vs v2.0 비교

| 항목 | v1.0 (main_playwright.py) | v2.0 (src/v2/) |
|------|---------------------------|----------------|
| 구조 | 1800줄 모놀리식 | 6개 모듈 분리 ✅ |
| 멀티계정 | ❌ 싱글 | ✅ 설계됨 |
| 세션 관리 | 매번 로그인 | ✅ 풀 + 저장/복원 |
| 브라우저 의존 | 100% | 로그인만 (API 직접) ✅ |
| 병렬 실행 | ❌ | ✅ 멀티프로세스 |
| **실제 작동** | 로그인까지 | 로그인까지 (동일) |

**아키텍처 진화:** A+ → 방향은 완벽
**실제 진전:** 제자리 → API가 작동 안 함

---

## 🔴 핵심 문제: 가짜 API

### api.py의 현실

```python
# 현재 코드
API_URL = "https://poapi.interpark.com"

def enter_queue(self, goods_id, schedule_id):
    url = f"{self.API_URL}/api/queue/enter"  # ← 존재하지 않음
    
def get_seat_map(self, schedule_id):
    url = f"{self.API_URL}/api/seats/{schedule_id}/map"  # ← 존재하지 않음
```

**냉정한 현실:**
- `poapi.interpark.com/api/queue/enter` → 404
- `poapi.interpark.com/api/seats/*/map` → 404
- **모든 예매 관련 API가 추측값**

**증거:**
```
테스트 결과:
- 사전 로그인: 성공 (95초)
- 세션 저장/복원: 작동
- 워커 생성/병렬 실행: 작동
- 좌석맵 API: 실패 ← 여기서 막힘
```

**결론:** v2.0은 "빈 총"이다. 설계는 있지만 총알(API)이 없다.

---

## 🟢 좋은 점 (제대로 평가)

### 1. SessionPool - 깔끔한 설계
```python
class SessionPool:
    def add(self, session: AuthSession) -> bool:
        with self._lock:  # 스레드 안전
            self._sessions[session.account_id] = session
            self._save_session(session)  # 영구 저장

    def get_all_valid(self) -> List[AuthSession]:
        # 만료 체크 + 유효한 것만 반환
```
- Lock 기반 동시성 처리 ✅
- 파일 기반 영속성 ✅  
- TTL 관리 ✅

### 2. Worker 아키텍처 - 올바른 방향
```python
class BookingWorker(mp.Process):
    def run(self):
        self.start_event.wait()  # 동시 시작
        if result.success:
            self.stop_event.set()  # 성공 시 전체 중지
```
- 멀티프로세스로 GIL 회피 ✅
- Event 기반 조율 ✅
- 성공 시 즉시 중단 ✅

### 3. Config 분리 - 확장 가능
```python
@dataclass
class Account:
    id: str
    password: str
    name: str = ""

@dataclass  
class SystemConfig:
    accounts: List[Account]  # 멀티 계정
    prefer_zones: List[str]  # 선호 구역
```

---

## 🔧 API 역공학 - 실제 방법

### Step 1: 트래픽 캡처 환경

```bash
# mitmproxy 설치
pip install mitmproxy

# 프록시 시작 (포트 8080)
mitmweb --listen-port 8080

# Playwright에서 프록시 사용
playwright.chromium.launch(
    proxy={"server": "http://127.0.0.1:8080"}
)
```

### Step 2: 실제 예매 플로우 캡처

**필요한 것:** 실제 티켓 (테스트용 저가 공연)

```
1. mitmweb 실행
2. 브라우저에서 예매 진행 (끝까지)
3. 캡처된 요청 분석
```

**찾아야 할 엔드포인트:**
| 기능 | 예상 URL 패턴 |
|------|--------------|
| 대기열 진입 | `*/queue/*`, `*/waiting/*` |
| 좌석맵 조회 | `*/seatmap/*`, `*/layout/*` |
| 좌석 선점 | `*/hold/*`, `*/select/*`, `*/lock/*` |
| 결제 초기화 | `*/payment/*`, `*/order/*` |

### Step 3: 요청 분석 포인트

```javascript
// 캡처된 요청에서 확인할 것
{
  "url": "실제 엔드포인트",
  "method": "POST/GET",
  "headers": {
    "Authorization": "Bearer xxx 또는 커스텀 토큰",
    "X-Custom-Header": "서버가 요구하는 특수 헤더"
  },
  "body": {
    // 필수 파라미터
  }
}
```

### Step 4: HAR 파일 활용

```python
# Playwright HAR 녹화
context = browser.new_context(record_har_path="booking.har")
# ... 예매 진행 ...
context.close()  # HAR 저장됨

# HAR 분석 스크립트
import json
with open('booking.har') as f:
    har = json.load(f)
    
for entry in har['log']['entries']:
    req = entry['request']
    if 'seat' in req['url'].lower() or 'book' in req['url'].lower():
        print(f"URL: {req['url']}")
        print(f"Method: {req['method']}")
        print(f"Headers: {req['headers']}")
        print("---")
```

---

## 📋 남은 작업 목록 (우선순위)

### P0: 없으면 불가능

| # | 작업 | 예상 시간 | 난이도 |
|---|------|----------|--------|
| 1 | 실제 API 엔드포인트 역공학 | 4-8시간 | 🔴 |
| 2 | 대기열 API 분석 | 2-4시간 | 🟡 |
| 3 | 좌석 선점 API 분석 | 2-4시간 | 🟡 |

### P1: 있어야 경쟁력

| # | 작업 | 예상 시간 | 난이도 |
|---|------|----------|--------|
| 4 | 결제 플로우 분석 | 2-3시간 | 🟡 |
| 5 | 봇 탐지 우회 (헤더/타이밍) | 1-2시간 | 🟢 |
| 6 | 실시간 알림 (텔레그램) | 1시간 | 🟢 |

### P2: 안정성

| # | 작업 | 예상 시간 | 난이도 |
|---|------|----------|--------|
| 7 | 에러 복구/재시도 로직 | 2시간 | 🟢 |
| 8 | 로깅 강화 | 1시간 | 🟢 |
| 9 | 단위 테스트 | 2시간 | 🟢 |

**총 예상 시간:** 16-27시간 (API 역공학 성공 가정)

---

## 🎯 예상 성공률

### 현재 상태 (v2.0)

| 시나리오 | 확률 | 이유 |
|----------|------|------|
| **모든 공연** | **0%** | API 작동 안 함 |

### API 역공학 완료 후

| 시나리오 | 확률 | 조건 |
|----------|------|------|
| 일반 공연 | 40-60% | 경쟁 낮음 + 멀티계정(5개) |
| 인기 아이돌 | 15-25% | 중간 경쟁 + 멀티계정(10개) |
| **BTS 콘서트** | **5-15%** | 극심한 경쟁 + 최적 타이밍 |

### 성공률 계산 근거

```
BTS 티켓팅 가정:
- 동시 접속: 100만 명
- 좌석: 5만 석
- 기본 확률: 5%

v2.0 멀티계정 효과:
- 10개 계정 × 독립 시도
- 실효 확률: 1 - (0.95)^10 = 40% (이론)
- 실제: 서버 차단, 네트워크 지연으로 10-15%

타이밍 요소:
- API 직접 호출: +5% (브라우저 대비)
- 사전 로그인: +5% (콜드스타트 제거)
- 프록시/IP 분산: +5% (미구현)
```

---

## 💡 실용적 제안

### 즉시 해야 할 것

1. **테스트 티켓 구매**
   - 저렴한 공연(뮤지컬/연극) 실제 예매
   - mitmproxy로 전체 플로우 캡처
   - 이게 없으면 모든 것이 추측

2. **HAR 녹화 스크립트**
```python
# tools/capture_har.py 생성
# 실제 예매 시 자동 녹화
```

3. **API 분석 문서화**
```markdown
# API_SPEC.md
## 엔드포인트 목록
1. 대기열 진입: POST /xxx
2. 좌석 조회: GET /xxx
...
```

### 하지 말아야 할 것

1. **추가 아키텍처 작업** - 설계는 충분함
2. **더 많은 모듈 분리** - 과설계 위험
3. **API 추측 계속** - 실제 캡처 필요

---

## 🔮 현실적 로드맵

```
Day 1: API 역공학
├── 테스트 티켓 구매/예매 (1회)
├── mitmproxy 캡처
└── 엔드포인트 문서화

Day 2: API 구현
├── 실제 API로 api.py 수정
├── 헤더/토큰 처리 구현
└── 단위 테스트

Day 3: 통합 테스트
├── 전체 플로우 테스트
├── 멀티계정 동시 테스트
└── 에러 핸들링 보강

Day 4: 실전 테스트
├── 실제 (저경쟁) 티켓팅 시도
├── 실패 원인 분석
└── 튜닝
```

**최단 경로:** 3-4일 (풀타임), 1주 (파트타임)

---

## 📈 v1.0 vs v2.0 결론

| 관점 | v1.0 | v2.0 |
|------|------|------|
| 즉시 사용 가능 | △ (로그인까지) | △ (동일) |
| 확장 가능성 | ✗ | ✓ |
| 유지보수성 | ✗ | ✓ |
| 실전 성공률 | 2-5% | **0%** (현재) → **5-15%** (완성 시) |

**핵심 메시지:**

> v2.0은 **설계는 A+, 구현은 0점**이다.
> 
> 아키텍처를 더 만지지 말고, **API 역공학에 올인**하라.
> 
> 실제 엔드포인트 하나 찾는 게 코드 100줄보다 가치 있다.

---

## ✅ 체크리스트: 다음 세션에서 할 일

- [ ] mitmproxy 설치 및 설정
- [ ] 테스트용 공연 선정 (저가, 좌석 충분)
- [ ] 실제 예매 1회 진행 (수동, HAR 녹화)
- [ ] 캡처된 API 분석 → API_SPEC.md 작성
- [ ] api.py를 실제 엔드포인트로 수정
- [ ] 통합 테스트 실행

---

*"코드를 더 짜기 전에, 먼저 총알을 구해라."* — Opus 4.6

*리뷰 완료: 2026-02-12 18:05 KST*
