# BTS 광화문 티켓팅 자동화 - 기술 아키텍처

> CTO 결정문서 | 2026-02-10
> 모든 결정은 /research/ 폴더 리서치 결과 기반

---

## 📋 Executive Summary

| 항목 | 결정 | 근거 |
|------|------|------|
| **브라우저 자동화** | SeleniumBase UC Mode | 안정성 최고, CAPTCHA 헬퍼 내장, 활발한 유지보수 |
| **백업 브라우저** | Camoufox | 최고 스텔스, Firefox 기반 (감지 우회용) |
| **CAPTCHA 서비스** | CapSolver (1순위) | 속도 1-3초, 가장 저렴 ($0.10-0.30/1000건) |
| **CAPTCHA 백업** | 2Captcha | 정확도 95-99%, 안정성 검증됨 |
| **프록시** | IPRoyal | $7/GB, 한국 IP 66,000+, 최소구매 없음 |
| **프록시 백업** | Smartproxy | $4부터 시작, 3일 100MB 무료체험 |

---

## 1. 기술 스택 결정

### 1.1 브라우저 자동화: SeleniumBase UC Mode ✅

**선정 근거** (browser-comparison.md):
- ✅ 자동 드라이버 관리 (버전 매칭 자동화)
- ✅ `uc_gui_click_captcha()` 내장 헬퍼
- ✅ 2025-2026 지속 업데이트 (가장 활발한 유지보수)
- ✅ CDP Mode 지원 (WebDriver 연결 해제 상태에서도 동작)
- ✅ 문서화 우수, 안정성 최고

**Camoufox 미채택 이유**:
- ⚠️ 2025년 1년간 유지보수 공백 (현재 재개)
- ⚠️ 브라우저 바이너리 수백 MB 다운로드 필요
- ⚠️ Windows 지원 불완전
- 백업 옵션으로 유지 (감지 심할 때 사용)

```python
# 핵심 코드 구조
from seleniumbase import SB

with SB(uc=True, headless=False) as sb:
    sb.uc_open_with_reconnect("https://tickets.interpark.com", 4)
    sb.uc_gui_click_captcha()  # CAPTCHA 자동 처리
```

### 1.2 CAPTCHA: CapSolver 1순위 ✅

**선정 근거** (captcha-services.md):
- ✅ 이미지 CAPTCHA 속도: **1-3초** (2Captcha: 7-15초)
- ✅ 가격: $0.10-0.30/1000건 (가장 저렴)
- ✅ 인터파크 CAPTCHA 타입 = 이미지 텍스트 → AI 기반이 효율적
- ⚠️ 정확도 90-95% (2Captcha 95-99%보다 낮음)

**Fallback 전략**:
```
CapSolver 시도 (1-3초)
    ↓ 실패 시
2Captcha 시도 (7-15초, 정확도 우선)
```

**예상 비용**: 100회 시도 기준 ~$0.10-0.50

```python
import capsolver
capsolver.api_key = "YOUR_API_KEY"

solution = capsolver.solve({
    "type": "ImageToTextTask",
    "body": "BASE64_ENCODED_IMAGE"
})
```

### 1.3 프록시: IPRoyal ✅

**선정 근거** (proxy-comparison.md):
- ✅ **$7/GB** (벌크 $1.75/GB)
- ✅ 한국 IP: **66,000+** (서울 370,000+)
- ✅ **최소 구매 없음** (Pay-As-You-Go)
- ✅ 트래픽 만료 없음
- ✅ 99.9% 업타임

**ISP 프록시 vs 주거용**:
| 유형 | 속도 | 탐지 회피 | 티켓팅 적합도 |
|------|------|-----------|---------------|
| ISP 프록시 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | **최적** |
| 주거용 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 좋음 |

**권장**: ISP 프록시 우선 ($2.40/IP/월)

```python
proxy = {
    "http": "http://customer-USERNAME-country-kr:PASSWORD@geo.iproyal.com:12321",
    "https": "http://customer-USERNAME-country-kr:PASSWORD@geo.iproyal.com:12321"
}
```

---

## 2. 인터파크 감지 시스템 대응

### 2.1 알려진 감지 기준 (interpark-detection.md)

| 감지 조건 | 결과 | 대응 |
|-----------|------|------|
| 1초 5회+ 클릭 | IP밴 (E_02), 1시간 정지 | 랜덤 딜레이 0.3-1초 |
| Selenium 감지 | 계정 정지 30일 | SeleniumBase UC Mode |
| 반복 사용 | 영구 정지 가능 | 세션 분리, 프록시 로테이션 |
| PC+모바일 동시 | 2024.08부터 차단 | 단일 디바이스만 |

### 2.2 우회 전략

```python
# 필수 설정
import random
import time

def human_delay():
    """인간적인 딜레이 (0.3-1.0초)"""
    time.sleep(random.uniform(0.3, 1.0))

def click_with_limit(element, click_count):
    """1초당 5회 미만 클릭 보장"""
    if click_count >= 4:
        time.sleep(1.1)  # 1초 대기 후 리셋
        click_count = 0
    element.click()
    return click_count + 1
```

---

## 3. 얼굴패스 대응 전략

### 3.1 현황 (interpark-detection.md)

- **2024.12**: TWS 공연에서 얼굴인식 입장 런칭
- **2024.08**: 하이브+토스+인터파크 MOU 체결
- **BTS 광화문 적용 여부**: ❓ 확인 필요 (공식 발표 없음)

### 3.2 얼굴패스 적용 시 전략

얼굴패스 = **본인 확인 강제** → 매크로 무력화

**대응 방안: 본인 계정 수작업 최적화**

```
┌─────────────────────────────────────────────────────────┐
│  얼굴패스 적용 시 → Semi-Automation 전략               │
├─────────────────────────────────────────────────────────┤
│  1. 자동화 가능 영역:                                   │
│     - 페이지 자동 새로고침 (카운트다운 감시)           │
│     - 좌석 자동 선택 (우선순위 기반)                   │
│     - 폼 자동 입력 (개인정보, 결제정보)               │
│                                                         │
│  2. 수동 필요 영역:                                     │
│     - CAPTCHA 입력 (자동화 실패 시)                    │
│     - 최종 결제 확인                                    │
│     - 얼굴 등록 (사전 1회)                             │
│                                                         │
│  3. 최적화 포인트:                                      │
│     - 클릭 타겟 하이라이트 (빠른 수동 클릭 지원)       │
│     - 오디오 알림 (티켓 오픈 순간 알림)                │
│     - 자동 스크롤 (좌석 뷰 최적화)                     │
└─────────────────────────────────────────────────────────┘
```

### 3.3 구현 모드

```python
class TicketingMode(Enum):
    FULL_AUTO = "full_auto"      # 얼굴패스 미적용 시
    SEMI_AUTO = "semi_auto"      # 얼굴패스 적용 시 (본인 계정)
    ASSIST = "assist"            # 수작업 보조만 (가장 안전)
```

---

## 4. 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                    BTS Ticketing Bot                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Config     │    │   Browser    │    │   Captcha    │  │
│  │   Manager    │───▶│   Engine     │───▶│   Solver     │  │
│  │              │    │ (SeleniumBase)│    │ (CapSolver)  │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                   │                   │           │
│         ▼                   ▼                   ▼           │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Proxy      │    │   Seat       │    │   Payment    │  │
│  │   Rotator    │    │   Selector   │    │   Handler    │  │
│  │  (IPRoyal)   │    │              │    │              │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                    Alert System                        │  │
│  │   - 텔레그램 알림                                     │  │
│  │   - 데스크톱 알림                                     │  │
│  │   - 오디오 알림 (티켓 오픈 시)                        │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. 개발 우선순위

### Phase 1: Core (필수, 1주차)

| 순위 | 태스크 | 담당 | 예상시간 |
|------|--------|------|----------|
| P0 | SeleniumBase UC 환경 구축 | - | 2h |
| P0 | 인터파크 로그인 자동화 | - | 4h |
| P0 | 좌석 선택 로직 | - | 4h |
| P0 | CapSolver 연동 | - | 2h |

### Phase 2: Enhancement (중요, 2주차)

| 순위 | 태스크 | 담당 | 예상시간 |
|------|--------|------|----------|
| P1 | IPRoyal 프록시 연동 | - | 2h |
| P1 | 좌석 우선순위 알고리즘 | - | 4h |
| P1 | 에러 핸들링/재시도 로직 | - | 3h |
| P1 | 텔레그램 알림 | - | 2h |

### Phase 3: Optimization (권장, 3주차)

| 순위 | 태스크 | 담당 | 예상시간 |
|------|--------|------|----------|
| P2 | Semi-Auto 모드 (얼굴패스 대응) | - | 4h |
| P2 | 2Captcha Fallback | - | 2h |
| P2 | 프록시 로테이션 | - | 2h |
| P2 | 성능 최적화 | - | 3h |

### Phase 4: Safety (선택)

| 순위 | 태스크 | 담당 | 예상시간 |
|------|--------|------|----------|
| P3 | Camoufox 백업 모드 | - | 4h |
| P3 | 계정 정지 감지 | - | 2h |
| P3 | 로그/감사 시스템 | - | 2h |

---

## 6. 폴더 구조

```
bts-ticketing/
├── ARCHITECTURE.md          # 이 문서
├── README.md
├── requirements.txt
├── .env.example
├── research/                # 리서치 결과 (완료)
│   ├── browser-comparison.md
│   ├── captcha-services.md
│   ├── interpark-detection.md
│   └── proxy-comparison.md
├── src/
│   ├── __init__.py
│   ├── config.py            # 설정 관리
│   ├── browser.py           # SeleniumBase 래퍼
│   ├── captcha.py           # CapSolver/2Captcha 연동
│   ├── proxy.py             # IPRoyal 프록시 관리
│   ├── interpark/
│   │   ├── __init__.py
│   │   ├── login.py         # 로그인 자동화
│   │   ├── seat.py          # 좌석 선택
│   │   └── payment.py       # 결제 처리
│   └── utils/
│       ├── delay.py         # 인간적 딜레이
│       └── alert.py         # 알림 시스템
├── tests/
│   └── test_interpark.py
└── scripts/
    └── run_ticketing.py     # 메인 실행 스크립트
```

---

## 7. 예상 비용

| 항목 | 서비스 | 예상 비용 |
|------|--------|----------|
| CAPTCHA | CapSolver | ~$5 (테스트 + 본티켓팅) |
| 프록시 | IPRoyal | ~$7-15 (1-2GB) |
| **합계** | | **~$12-20** |

---

## 8. 리스크 및 대응

| 리스크 | 확률 | 영향 | 대응 |
|--------|------|------|------|
| 얼굴패스 적용 | 중 | 높음 | Semi-Auto 모드 준비 |
| IP밴 | 중 | 중 | 프록시 로테이션 |
| 계정 정지 | 낮 | 높음 | 테스트 계정 분리 |
| CAPTCHA 변경 | 낮 | 중 | 2Captcha Fallback |
| 인터파크 감지 업데이트 | 중 | 중 | Camoufox 백업 |

---

## 9. 다음 액션

- [ ] requirements.txt 생성
- [ ] .env.example 생성
- [ ] CapSolver 계정 생성 + $5 충전
- [ ] IPRoyal 계정 생성 + 테스트 구매
- [ ] SeleniumBase UC Mode 테스트
- [ ] 인터파크 CAPTCHA 샘플 수집

---

## 참고 문서

- `/research/browser-comparison.md` - 브라우저 비교
- `/research/captcha-services.md` - CAPTCHA 서비스 비교
- `/research/interpark-detection.md` - 감지 시스템 분석
- `/research/proxy-comparison.md` - 프록시 비교
