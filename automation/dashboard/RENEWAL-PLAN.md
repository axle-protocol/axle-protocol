# SmartStore 풀자동화 시스템 — 종합 리뉴얼 계획서

**작성일:** 2026-02-15
**작성자:** Claude Opus 4.6
**목적:** ChatGPT 포함 외부 피드백용 종합 계획서
**관련 문서:** `AUDIT-SMARTSTORE.md`, `COMPETITIVE-ANALYSIS.md`

---

## 1. 프로젝트 개요

### 1-1. 비전
> "당신이 잠든 사이, AI가 주문부터 CS까지 전부 처리합니다."

1인 위탁판매 셀러를 위한 **풀자동화 시스템**. 주문 수집 → 공급사 배분 → 송장 수집 → 발송 처리 → CS 응답까지 AI 에이전트가 24/7 자율 운영.

### 1-2. 핵심 차별화 (시장에 없는 것 3가지)
1. **벤더 포탈** — 공급사가 직접 웹에서 주문 확인/송장 입력 (경쟁사 7개 중 0개 제공)
2. **AI 에이전트 24/7** — OpenClaw 기반 자율 운영 (크론잡이 아닌 AI 의사결정)
3. **AI CS 자동응답** — LLM + 주문데이터 연동 맥락 인식 CS (시장 전무)

### 1-3. 타겟
- **Primary:** 1인 위탁판매 셀러 (공급사 3-10개, 일 주문 10-100건)
- **Secondary:** 소규모 팀 (2-5명, 일 주문 100-500건)

### 1-4. 직접 경쟁자
- **스윕(Sweep):** 2024년 10억 시드 투자, 위탁판매 발주 자동화 특화. 벤더 포탈 없음, AI 없음
- **사방넷:** 시장 점유율 80%, 650+ 채널 연동. 복잡/고가, 위탁판매 비특화

---

## 2. 현재 상태 평가

### 2-1. 기술 스택
- **서버:** Node.js 단일 프로세스 (`server.mjs`, ~2500줄)
- **저장소:** JSON 파일 기반 (MVP)
- **인증:** Owner=BasicAuth + Cookie, Vendor=Cookie Session
- **프론트엔드:** Vanilla HTML/JS (admin + vendor 포탈)
- **외부 의존:** Python 2개 (xlsx 파싱/내보내기)
- **호스팅:** 로컬 (localhost:3030), Cloudflare Tunnel로 임시 외부 노출

### 2-2. 코드 감사 결과 요약

**판정: 수정해서 쓸 수 있음 (재구축 불필요)**

| 등급 | 개수 | 대표 이슈 |
|------|------|-----------|
| CRITICAL | 3 | readMultipart 인자 불일치, 세션 만료 없음, 쿠키 secure:false |
| HIGH | 10 | 로그인 rate limit 없음, XSS, CSRF 없음, 택배사 라벨 미완성 |
| MEDIUM | 11 | 벤더 CRUD 미완성, 주문 lifecycle 없음, 페이지네이션 없음 |

**핵심 플로우 동작 상태:**
```
상품CSV 업로드 ✅ → 매핑 설정 ✅ → 주문 엑셀 업로드 ✅(버그有) → 자동배분 ✅
→ 벤더 로그인 ✅ → 주문 확인 ✅ → 송장 입력 ✅ → 발송처리 엑셀 ✅
```

### 2-3. OpenClaw 에이전트 런타임 평가

**OpenClaw = 24/7 AI 에이전트 플랫폼** (로컬 Mac에서 상주 실행)

| 역량 | 상태 | SmartStore 활용 |
|------|------|----------------|
| 크론 스케줄링 | ✅ 28개 작업 운용 경험 | 주문 폴링, 송장 감시, 정산 리포트 |
| 텔레그램 봇 | ✅ 양방향 메시지 | 셀러 알림, 승인 요청, 상태 보고 |
| 브라우저 자동화 | ✅ Chromium + Playwright | 스마트스토어 셀러센터 자동 조작 |
| 메모리 시스템 | ✅ SQLite + 파일 기반 | 주문 이력, 공급사 패턴 학습 |
| 서브에이전트 | ✅ 최대 8개 동시 | 병렬 작업 처리 |
| 스킬 시스템 | ✅ 12개 설치됨 | **korean-delivery-tracker** (택배 추적 이미 있음!) |
| 외부 API 호출 | ✅ | SmartStore 서버 API 호출 |

**특히 주목할 기존 스킬:**
- `korean-delivery-tracker` — CJ대한통운/한진/롯데/우체국/로젠 추적 **이미 구현됨**
- 텔레그램 봇 — Han에게 실시간 알림 인프라 **이미 동작 중**

---

## 3. 아키텍처 설계 (리뉴얼 후)

### 3-1. 전체 구조

```
┌──────────────────────────────────────────────────┐
│                    셀러 (Han)                     │
│              텔레그램 / 웹 대시보드                  │
└───────────┬──────────────────────┬───────────────┘
            │ 승인/확인              │ 알림/보고
            ▼                      ▲
┌──────────────────────────────────────────────────┐
│              OpenClaw 에이전트 (Clo)               │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐            │
│  │주문 감시 │ │송장 추적 │ │CS 응답  │ ...        │
│  │(크론)   │ │(크론)   │ │(크론)   │            │
│  └────┬────┘ └────┬────┘ └────┬────┘            │
│       │           │           │                  │
│       ▼           ▼           ▼                  │
│  ┌──────────────────────────────────────┐        │
│  │     SmartStore Server (server.mjs)    │        │
│  │     localhost:3030 / API 엔드포인트     │        │
│  └──────────┬────────────────┬──────────┘        │
│             │                │                    │
│  ┌──────────▼──┐  ┌─────────▼──────────┐        │
│  │ JSON 파일 DB │  │  벤더 포탈 (웹)     │        │
│  │ data/*.json  │  │  공급사가 직접 접속  │        │
│  └─────────────┘  └────────────────────┘        │
└──────────────────────────────────────────────────┘
            │
            ▼ (Phase 2+)
┌──────────────────────────────────────────────────┐
│  외부 서비스                                       │
│  • 네이버 커머스 API (주문 수집/발송 처리)          │
│  • 네이버 톡톡 챗봇 API (CS 자동응답)              │
│  • 택배사 API (배송 추적) ← korean-delivery-tracker│
│  • 스마트스토어 셀러센터 (Playwright 자동 조작)     │
└──────────────────────────────────────────────────┘
```

### 3-2. OpenClaw 에이전트 역할 설계

| 크론 작업 | 주기 | 동작 | sessionTarget |
|-----------|------|------|---------------|
| `order-check` | 5분 | 새 주문 확인 → 자동 배분 → 텔레그램 알림 | isolated |
| `tracking-monitor` | 15분 | 미입력 송장 확인 → 벤더 독촉 알림 | isolated |
| `dispatch-auto` | 10분 | 신규 송장 수집 → 발송처리 엑셀 생성 → Han 승인 요청 | isolated |
| `delivery-track` | 30분 | 배송 추적 → 지연 감지 → 고객/셀러 알림 | isolated |
| `cs-respond` | 실시간 | 톡톡 문의 수신 → AI 답변 생성 → Han 승인 후 전송 | isolated |
| `daily-report` | 매일 21:00 | 일일 운영 리포트 → 텔레그램 전송 | main |
| `anomaly-detect` | 1시간 | 이상 패턴 감지 (주문 급증, 클레임 증가) | isolated |

### 3-3. 셀러의 하루 (리뉴얼 후)

```
07:00  텔레그램 알림: "어젯밤 신규 주문 23건, 자동 배분 완료"
       → 확인만 하면 끝 (이미 벤더에게 전달됨)

10:00  텔레그램 알림: "벤더 A가 송장 15건 입력 완료, 발송처리 준비됨"
       → "확인" 버튼 한 번 → 자동 업로드

14:00  텔레그램 알림: "고객 문의 3건, AI 자동응답 완료 (배송문의 2, 교환문의 1)"
       → 답변 내용 확인만 (이미 전송됨)

18:00  텔레그램 알림: "벤더 C 송장 미입력 5건 (24시간 초과)"
       → "독촉" 버튼 → 벤더에게 자동 알림

21:00  텔레그램 일일 리포트:
       "오늘 주문 42건 / 발송 38건 / CS 7건(AI 자동 5건) / 미처리 4건"
```

**셀러가 직접 하는 일: 텔레그램 확인 + 승인 버튼 몇 번 = 하루 10분**

---

## 4. 실행 계획

### Phase 1: 기반 안정화 — 보안 + 치명 버그 수정

**목표:** 현재 코드의 치명적 문제를 제거하여 안전한 기반 확보
**예상 소요:** 2-3시간
**방식:** 병렬 에이전트로 동시 수정

#### 1-1. CRITICAL 버그 수정 (3개)

| # | 이슈 | 파일:라인 | 수정 내용 | 영향 |
|---|------|----------|----------|------|
| C1 | `readMultipart` 인자 불일치 | server.mjs:1702-1754 | 로컬 함수 제거, 모듈 레벨 함수 사용 | 주문 엑셀 업로드 깨짐 방지 |
| C2 | Owner 세션 만료 없음 | server.mjs:1300-1317 | `expiresAt` 체크 추가 (24시간) | 세션 탈취 시 영구 접근 차단 |
| C3 | Vendor 쿠키 `secure:false` | server.mjs:1970 | Owner 로그인과 동일하게 동적 처리 | HTTPS 시 쿠키 보안 |

#### 1-2. HIGH 보안 이슈 수정 (7개)

| # | 이슈 | 수정 내용 |
|---|------|----------|
| H1 | 로그인 rate limit 없음 | IP 기반 5회/분 제한, 10회 실패 시 15분 락아웃 |
| H2 | CSRF 보호 없음 | SameSite=Strict 쿠키 + Origin 헤더 검증 |
| H3 | XSS in setup.js | `escapeHtml()` 유틸 추가, 모든 동적 삽입에 적용 |
| H4 | 누락 audit log | 벤더 생성, 상품 업로드, 매핑 변경에 auditLog 추가 |
| H5 | 택배사 라벨 미완성 | lotte("롯데택배"), epost("우체국"), logen("로젠택배") 추가 |
| H6 | 데모 계정 표시 | vendor/login.html에서 데모 힌트 제거 |
| H7 | 클라이언트/서버 송장 검증 불일치 | 서버 기준으로 통일 (alphanumeric 허용) |

#### 1-3. 코드 정리 (3개)

| # | 이슈 | 수정 내용 |
|---|------|----------|
| M1 | dead code 엔드포인트 | `/api/vendor/orders/export.xlsx` 제거 |
| M2 | 중복 readMultipart 함수 | 로컬 정의 제거 (C1과 합침) |
| M3 | silent catch 블록 | 최소한 console.error 추가 |

---

### Phase 2: 기능 완성 — 실운영 MVP

**목표:** "내일 사장님한테 줘도 사고 없는" 실운영 수준
**예상 소요:** 5-7시간
**방식:** 독립 작업은 병렬 에이전트, 의존성 있는 작업은 순차

#### 2-1. 벤더 관리 완성

| # | 기능 | 엔드포인트 | 상세 |
|---|------|----------|------|
| F1 | 벤더 수정 | `PUT /api/admin/vendors/:id` | name, username 변경 |
| F2 | 벤더 비활성화 | `POST /api/admin/vendors/:id/deactivate` | 로그인 차단, 세션 전부 무효화 |
| F3 | 벤더 비밀번호 리셋 | `POST /api/admin/vendors/:id/reset-password` | 새 비밀번호 설정 |
| F4 | 벤더 삭제 방지 | 삭제 대신 비활성화만 허용 | 데이터 무결성 보호 |
| F5 | Admin UI | setup.js 수정 | 벤더 목록에 수정/비활성 버튼 추가 |

#### 2-2. 주문 관리 강화

| # | 기능 | 상세 |
|---|------|------|
| F6 | 주문 상태 lifecycle | pending → assigned → shipped → delivered → completed |
| F7 | 전화/주소 파싱 | Python 파서에서 스마트스토어 엑셀 전화/주소 열 매핑 수정 |
| F8 | 매핑 충돌 방지 | 1 productNo : 1 vendor 강제, 기존 매핑 덮어쓰기 경고 |
| F9 | 이중 할당 방지 | 이미 할당된 주문 재할당 시 확인 필요 |
| F10 | "이미 업로드됨" 추적 | 발송처리 엑셀 다운로드 시 해당 주문에 `exportedAt` 마킹 |

#### 2-3. 벤더 포탈 UX 강화

| # | 기능 | 상세 |
|---|------|------|
| F11 | 택배사 드롭다운 확장 | 6개 전체: CJ대한통운, 한진, 롯데, 우체국, 로젠, 기타 |
| F12 | 날짜 필터 | 오늘/이번주/이번달/전체 필터 |
| F13 | 벌크 송장 입력 | 엑셀 업로드로 한 번에 여러 송장 입력 |
| F14 | 비밀번호 변경 | 벤더 본인이 비밀번호 변경 가능 |
| F15 | 주문 검색 | productName, recipientName 검색 |

#### 2-4. Admin 대시보드 개선

| # | 기능 | 상세 |
|---|------|------|
| F16 | 통계 대시보드 | 오늘 주문, 발송완료, 미처리, 공급사별 현황 카드 |
| F17 | 주문 목록 뷰 | 전체 주문 테이블 (필터/검색/페이지네이션) |
| F18 | 벤더별 현황 | 각 벤더의 미처리/처리완료 건수 |
| F19 | 업로드 히스토리 | 엑셀 업로드 이력 + 결과 요약 |
| F20 | 발송처리 상태 | 엑셀 다운로드 이력 + "미업로드" 건수 표시 |

#### 2-5. Python 의존성 제거

| # | 작업 | 상세 |
|---|------|------|
| F21 | xlsx 파싱 Node 전환 | `xlsx` npm 패키지로 CDFV2 암호화 xlsx 파싱 (또는 `msoffcrypto` 부분만 Python 유지) |
| F22 | xlsx 내보내기 통일 | 이미 Node.js 구현 존재 (endpoint 19), 필드명만 수정하면 됨 |
| F23 | 업로드 파일 자동 정리 | 24시간 후 자동 삭제 |

#### 2-6. 운영 안전장치

| # | 기능 | 상세 |
|---|------|------|
| F24 | 개인정보 마스킹 옵션 | 전화 뒷4자리, 주소 상세 숨김 토글 |
| F25 | audit log 로테이션 | 30일 초과 로그 자동 아카이브 |
| F26 | audit log 뷰어 | Admin에서 최근 로그 조회 UI |
| F27 | 에러 핸들링 강화 | 글로벌 에러 핸들러, uncaught exception 처리 |
| F28 | 백업 강화 | 일일 자동 백업 + 30일 보관 |

---

### Phase 3: OpenClaw 에이전트 통합 — 24/7 자동화

**목표:** SmartStore 서버를 OpenClaw 에이전트가 자율적으로 운영
**예상 소요:** 3-5시간 (외부 API 없이 가능한 범위)
**전제:** Phase 1+2 완료된 서버 API가 존재해야 함

#### 3-1. 에이전트 API 레이어 추가 (server.mjs)

OpenClaw 크론 작업이 호출할 전용 API 엔드포인트 추가:

```
GET  /api/agent/new-orders          — 마지막 체크 이후 신규 주문
GET  /api/agent/pending-tracking    — 송장 미입력 주문 (벤더별)
GET  /api/agent/ready-to-dispatch   — 발송처리 준비된 주문
POST /api/agent/auto-dispatch       — 자동 발송처리 (셀러 사전 승인 시)
GET  /api/agent/daily-summary       — 일일 운영 요약 통계
GET  /api/agent/anomalies           — 이상 패턴 (지연, 클레임, 급증)
```

인증: Agent 전용 토큰 (환경변수 `AGENT_TOKEN`)

#### 3-2. OpenClaw 크론 작업 등록

**작업 1: 주문 모니터링** (`order-monitor`)
```json
{
  "name": "smartstore-order-monitor",
  "schedule": { "kind": "every", "everyMs": 300000 },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "SmartStore 서버(localhost:3030)의 /api/agent/new-orders를 확인해. 새 주문이 있으면 건수와 배분 상태를 텔레그램으로 Han에게 알려줘. 없으면 NO_REPLY.",
    "deliver": true,
    "channel": "telegram",
    "to": "2084483598",
    "timeoutSeconds": 30
  }
}
```

**작업 2: 송장 미입력 감시** (`tracking-watch`)
```json
{
  "name": "smartstore-tracking-watch",
  "schedule": { "kind": "cron", "expr": "0 10,14,18 * * *", "tz": "Asia/Seoul" },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "SmartStore 서버의 /api/agent/pending-tracking을 확인해. 24시간 넘게 송장 미입력인 주문이 있으면 벤더별로 정리해서 Han에게 텔레그램으로 보고해. 없으면 NO_REPLY.",
    "deliver": true,
    "channel": "telegram",
    "to": "2084483598",
    "timeoutSeconds": 30
  }
}
```

**작업 3: 자동 발송처리** (`auto-dispatch`)
```json
{
  "name": "smartstore-auto-dispatch",
  "schedule": { "kind": "every", "everyMs": 600000 },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "SmartStore 서버의 /api/agent/ready-to-dispatch를 확인해. 발송처리 가능한 주문이 있으면 건수를 Han에게 텔레그램으로 알리고 '자동 발송' 또는 '대기' 중 선택하게 해. Han이 자동 발송을 선택하면 /api/agent/auto-dispatch를 호출해.",
    "deliver": true,
    "channel": "telegram",
    "to": "2084483598",
    "timeoutSeconds": 60
  }
}
```

**작업 4: 배송 추적** (`delivery-track`)
```json
{
  "name": "smartstore-delivery-track",
  "schedule": { "kind": "every", "everyMs": 1800000 },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "korean-delivery-tracker 스킬을 사용해서, SmartStore 서버에서 shipped 상태인 주문들의 송장번호를 조회하고 배송 상태를 확인해. 3일 이상 '배송중'이거나 상태 이상인 건이 있으면 Han에게 텔레그램으로 알려줘. 정상이면 NO_REPLY.",
    "deliver": true,
    "channel": "telegram",
    "to": "2084483598",
    "timeoutSeconds": 120
  }
}
```

**작업 5: 일일 리포트** (`daily-report`)
```json
{
  "name": "smartstore-daily-report",
  "schedule": { "kind": "cron", "expr": "0 21 * * *", "tz": "Asia/Seoul" },
  "sessionTarget": "main",
  "payload": {
    "kind": "agentTurn",
    "message": "SmartStore 서버의 /api/agent/daily-summary를 호출해서 오늘의 운영 리포트를 만들어. 포함 항목: 신규 주문, 발송 완료, 미처리, 공급사별 현황, 이상 징후. 포맷을 깔끔하게 정리해서 텔레그램으로 Han에게 보내줘.",
    "deliver": true,
    "channel": "telegram",
    "to": "2084483598",
    "timeoutSeconds": 60
  }
}
```

#### 3-3. 스마트스토어 셀러센터 Playwright 자동화 (준비)

현재 수동으로 하는 "발송처리 엑셀 업로드"를 Playwright로 자동화하는 모듈 구조 설계:

```
automation/dashboard/
  agents/
    smartstore-uploader.mjs    — Playwright로 셀러센터 로그인 → 엑셀 업로드
    cs-responder.mjs           — (Phase 후기) 톡톡 CS 자동응답
    delivery-checker.mjs       — 택배 추적 API 래퍼
```

**smartstore-uploader.mjs 동작 플로우:**
1. Chromium 프로필로 네이버 셀러센터 접속 (OpenClaw 브라우저 프로필 재사용)
2. 로그인 (저장된 세션/쿠키 활용)
3. 발주/발송 관리 → 발송처리 → 엑셀 업로드
4. 업로드 결과 캡처 → 성공/실패 리포트
5. 텔레그램으로 결과 전송

**주의:** 네이버는 자동화 탐지가 있으므로, 실제 운영 시 속도 제한/랜덤 딜레이 필요.

#### 3-4. Phase 3에서 빠지는 것 (외부 API 의존)

| 기능 | 필요한 것 | 시점 |
|------|----------|------|
| 네이버 커머스 API 주문 자동 수집 | API 앱 등록 + 심사 | Phase 4 |
| 네이버 커머스 API 자동 발송처리 | 동일 | Phase 4 |
| 톡톡 챗봇 AI CS | 챗봇 API 등록 + TLS 인증서 | Phase 4 |
| 카카오 알림톡 | 비즈니스 채널 등록 | Phase 4+ |

---

## 5. 기술 결정 사항

### 5-1. 왜 프레임워크를 도입하지 않는가?

현재 raw `http.createServer`로 동작 중. Express/Koa 등으로 전환하면:
- **장점:** 라우팅 깔끔, 미들웨어 체인, 에러 핸들링
- **단점:** 전체 라우팅 코드 리팩토링 필요 (33개 엔드포인트), 시간 소모

**결정:** Phase 1-3에서는 현재 구조 유지. 미들웨어 패턴만 수동 추가 (rate limiter, auth checker). 프레임워크 전환은 Phase 4+에서 고려.

### 5-2. 왜 DB를 도입하지 않는가?

현재 JSON 파일 기반. SQLite/PostgreSQL로 전환하면:
- **장점:** 쿼리, 인덱싱, 동시성, 트랜잭션
- **단점:** 마이그레이션 비용, 배포 복잡도 증가

**결정:** MVP에서는 JSON 유지. 주문 1,000건/벤더 50개 이하에서는 성능 문제 없음. `safeWriteJson`(tmp+rename)으로 데이터 무결성 확보됨. 확장 시점(Phase 4+)에서 SQLite 전환.

### 5-3. Python 의존성 처리

| 스크립트 | 용도 | 대체 가능? |
|---------|------|-----------|
| `parse_smartstore_orders.py` | CDFV2 암호화 xlsx 파싱 | **부분적** — `msoffcrypto` 대체 Node 라이브러리 없음. 암호화 해제만 Python, 파싱은 Node로 분리 가능 |
| `export_vendor_orders_xlsx.py` | 벤더 주문 xlsx 내보내기 | **완전 대체 가능** — Node.js `xlsx` 패키지로 이미 구현 존재 |

**결정:** export는 Node로 통일. import의 암호화 해제만 Python 유지 (최소 의존).

---

## 6. 우선순위 매트릭스

### Phase 1+2 작업을 Impact × Effort로 분류

```
                   HIGH IMPACT
                      │
        ┌─────────────┼─────────────┐
        │ C1,C2,C3    │ F6,F7       │
        │ H1,H3       │ F16,F17     │
   LOW  │ H5,H6,H7   │ F13,F21     │ HIGH
  EFFORT│ M1          │             │ EFFORT
        │             │             │
        ├─────────────┼─────────────┤
        │ H4,H2       │ F23,F25     │
        │ M3          │ F22         │
        │ F4,F8,F9    │ F24,F26     │
        │ F10,F11     │ F27,F28     │
        │ F12,F14,F15 │             │
        │ F1,F2,F3    │             │
        └─────────────┼─────────────┘
                      │
                   LOW IMPACT
```

**실행 순서 (가장 효율적):**
1. 좌상단 (High Impact, Low Effort) 먼저 — C1~C3, H1~H7, M1
2. 좌하단 (Low Impact, Low Effort) 동시 병렬 — F1~F15
3. 우상단 (High Impact, High Effort) 그 다음 — F6, F7, F16, F17
4. 우하단 (Low Impact, High Effort) 마지막 — F21~F28

---

## 7. 리스크와 대응

| 리스크 | 확률 | 영향 | 대응 |
|--------|------|------|------|
| server.mjs 수정 중 기존 기능 깨짐 | 중 | 높 | 수정 전 git commit, 각 Phase 후 스모크 테스트 |
| CDFV2 xlsx 파싱 Python 제거 실패 | 중 | 중 | Python 최소 유지 (암호화 해제만) |
| OpenClaw 크론이 서버 과부하 | 낮 | 중 | 호출 간격 조정, 서버 상태 체크 후 호출 |
| 벤더가 포탈 사용 거부 | 중 | 높 | 모바일 최적화 + 카카오톡 링크 전달 + 교육 자료 |
| 스윕이 벤더 포탈 출시 | 중 | 높 | 빠른 시장 진입 + AI 기능으로 차별화 |
| 네이버 셀러센터 자동화 탐지 | 높 | 중 | 랜덤 딜레이 + 실패 시 수동 폴백 + API 전환 준비 |

---

## 8. 성공 기준

### Phase 1 완료 기준
- [ ] 3개 CRITICAL 버그 전부 수정
- [ ] `node --check server.mjs` 통과
- [ ] 로그인 rate limit 동작 확인
- [ ] XSS 공격 벡터 차단 확인

### Phase 2 완료 기준
- [ ] 벤더 생성 → 로그인 → 주문확인 → 송장입력 → 발송처리 엔드투엔드 테스트 통과
- [ ] 벤더 수정/비활성화 동작
- [ ] 주문 상태 lifecycle (pending→shipped) 동작
- [ ] Admin 대시보드에서 통계/주문목록/벤더현황 확인 가능
- [ ] 벌크 송장 입력 동작

### Phase 3 완료 기준
- [ ] OpenClaw 크론 작업 5개 등록 및 실행 확인
- [ ] 텔레그램으로 주문 알림 수신 확인
- [ ] 송장 미입력 감시 동작 확인
- [ ] 일일 리포트 텔레그램 수신 확인
- [ ] korean-delivery-tracker로 배송 추적 동작 확인

---

## 9. 비교: 기존 솔루션 vs 리뉴얼 후 우리 제품

| | 사방넷 | 스윕 | **리뉴얼 후 우리** |
|--|--------|------|------------------|
| 주문 수집 | API 자동 | API 자동 | 엑셀+수동 (Phase 4에서 API) |
| 공급사 배분 | 수동 | 반자동 | **완전 자동** |
| 공급사 포탈 | ❌ | ❌ | **✅ (시장 최초)** |
| 송장 수집 | 엑셀 | 반자동 | **벤더 포탈 자동** |
| 발송 처리 | API 자동 | API 자동 | Playwright 반자동 (Phase 4에서 API) |
| CS 자동화 | ❌ | ❌ | **AI 준비 (Phase 4)** |
| 24/7 운영 | 스케줄러 | ❌ | **OpenClaw AI 에이전트** |
| 알림 | 이메일 | 카톡 | **텔레그램 실시간** |
| 배송 추적 | 제한적 | ❌ | **택배사 직접 추적** |
| 가격 | 월 15만원+ | 비공개 | **월 2-5만원** |

**리뉴얼 후 우위:** 벤더 포탈 + AI 에이전트 + 배송 추적
**리뉴얼 후 열위:** 주문 수집/발송 처리가 아직 API가 아닌 엑셀/Playwright 기반 (Phase 4에서 해결)

---

## 부록 A: 파일 구조 (리뉴얼 후)

```
automation/dashboard/
  server.mjs                    — 메인 서버 (Phase 1-2 수정)
  agents/                       — NEW: OpenClaw 에이전트 모듈
    smartstore-uploader.mjs     — Playwright 셀러센터 자동화
    cs-responder.mjs            — CS 자동응답 (Phase 4)
    delivery-checker.mjs        — 배송 추적 래퍼
  public/
    admin/
      index.html + setup.js     — Admin 대시보드 (Phase 2 개선)
      login.html + login.js     — Admin 로그인
      instagram.html + instagram.js — IG (유지, 미리캔버스로 전환)
    vendor/
      login.html + login.js     — Vendor 로그인
      orders.html + orders.js   — Vendor 주문관리 (Phase 2 UX 강화)
  scripts/
    parse_smartstore_orders.py  — xlsx 암호화 해제만 유지
  data/
    *.json                      — 데이터 파일
  AUDIT-SMARTSTORE.md           — 코드 감사 보고서
  COMPETITIVE-ANALYSIS.md       — 경쟁사 분석 + 마케팅 자료
  RENEWAL-PLAN.md               — 본 문서
```

## 부록 B: OpenClaw 크론 작업 전체 목록

```json
[
  { "name": "smartstore-order-monitor",   "every": "5m",  "desc": "신규 주문 감시" },
  { "name": "smartstore-tracking-watch",  "cron": "10,14,18시", "desc": "송장 미입력 감시" },
  { "name": "smartstore-auto-dispatch",   "every": "10m", "desc": "자동 발송처리 준비 알림" },
  { "name": "smartstore-delivery-track",  "every": "30m", "desc": "배송 추적 + 지연 감지" },
  { "name": "smartstore-daily-report",    "cron": "21시", "desc": "일일 운영 리포트" },
  { "name": "smartstore-anomaly-detect",  "every": "1h",  "desc": "이상 패턴 탐지 (Phase 4)" },
  { "name": "smartstore-cs-respond",      "every": "2m",  "desc": "CS 자동응답 (Phase 4)" }
]
```

---

*본 계획서는 `AUDIT-SMARTSTORE.md` (코드 감사)와 `COMPETITIVE-ANALYSIS.md` (경쟁 분석)를 기반으로 작성되었습니다.*
*ChatGPT 등 외부 피드백을 받아 수정/보완할 수 있습니다.*
