# SmartStore 실행 계획 V2 (ChatGPT 피드백 반영)

**작성일:** 2026-02-15
**기준:** AUDIT-SMARTSTORE.md + ChatGPT 외부 리뷰 피드백 통합

---

## 핵심 변경 (V1 → V2)

| 항목 | V1 | V2 (피드백 반영) |
|------|----|----|
| Phase 구조 | 1→2→3 (3단계) | 1→2A→2B→3→4 (5단계) |
| Phase 1 범위 | 보안만 | 보안 + **데이터 정합성** (매핑충돌/export중복) |
| Phase 2 | 기능 28개 한번에 | **2A**(파일럿MVP) + **2B**(실운영MVP) 분리 |
| 클레임 처리 | Phase 4 | **Phase 2A로 승격** (최소 안전장치) |
| 자동화 접근 | 완전자율 | **승인형 자동화** → 점진적 자율화 |
| 멀티테넌시 | 미고려 | **tenantId 설계** Phase 2A부터 선반영 |

---

## Phase 1: 보안 + 데이터 정합성 (파일럿 안전장치)

> 목표: "사고가 나지 않는 시스템"으로 만들기

### 1-A) CRITICAL 버그 3개 (즉시)

#### ① readMultipart 인자 불일치 (server.mjs:1702-1754)
- **문제:** 로컬 `readMultipart(boundaryStr, maxBytes)` 가 모듈 레벨 함수를 가림. line 1754에서 `readMultipart(req, boundary)` 호출 → req가 boundaryStr로 들어감
- **수정:** 로컬 함수 삭제, 모듈 레벨 `readMultipart(req, boundary)` 직접 호출
- **파일:** `server.mjs` line 1702-1754

#### ② Owner 세션 만료 없음 (server.mjs:1309-1317)
- **문제:** `getOwnerFromSession()` 에서 expiresAt 체크 없음. 세션 영구 유효
- **수정:** 세션 생성 시 `expiresAt` 추가 (24h), 검증 시 만료 체크, 만료 세션 정리
- **파일:** `server.mjs` line 1309-1317, 1391-1397

#### ③ Vendor 쿠키 secure:false 하드코딩 (server.mjs:1970)
- **문제:** Owner 로그인은 `x-forwarded-proto` 기반 동적 처리하는데, vendor는 항상 false
- **수정:** Owner와 동일하게 `isHttps` 동적 처리
- **파일:** `server.mjs` line 1966-1972

### 1-B) 보안 HIGH 7개

#### ④ 로그인 rate limit
- IP 기반 시도 제한 (5회/5분 → 15분 락아웃)
- 인메모리 Map으로 구현 (`loginAttempts = new Map()`)
- Owner + Vendor 로그인 양쪽 적용
- **파일:** `server.mjs` — 새 함수 `checkRateLimit(ip)` + 로그인 핸들러 2곳

#### ⑤ CSRF 방어
- `SameSite=Strict` 으로 강화 (현재 Lax)
- POST/PUT/DELETE 요청에 Origin 헤더 검증
- **파일:** `server.mjs` — 메인 핸들러 초입부

#### ⑥ XSS 방지
- `escapeHtml()` 유틸 추가 → 모든 사용자 입력에 적용
- 특히 `productName`, `optionInfo`, `recipientName` 등
- **파일:** `server.mjs` + `setup.js`

#### ⑦ demo credential 표시 제거
- 로그인 페이지에서 기본 계정 힌트 제거
- **파일:** `public/admin/login.html`, `public/vendor/login.html`

#### ⑧ 업로드 파일 검증 강화
- 확장자 + 크기 제한 (xlsx 10MB, 이미지 5MB)
- **파일:** `server.mjs` — 업로드 핸들러들

### 1-C) 데이터 정합성 (Phase 1로 승격 — ChatGPT 추천)

#### ⑨ 매핑 충돌 방지 (1 productNo : 1 vendor 강제)
- **문제:** mapping.json이 다대다 허용 → Map()이 마지막만 살림 → 조용히 잘못 배정
- **수정:**
  - `POST /api/admin/mapping` 에서 저장 시 충돌 검증
  - 다른 vendor에 이미 매핑된 productNo 있으면 → 400 + 충돌 목록 반환
  - 프론트에서 "이미 X벤더에 매핑됨, 변경하시겠습니까?" 경고
  - 기존 mapping.json 정리 (중복 제거 마이그레이션)
- **파일:** `server.mjs` mapping 핸들러, `setup.js` UI

#### ⑩ 발송 export 중복 방지 (exportedAt 마킹)
- **문제:** tracking 있는 주문 전부 export → 중복 업로드 사고
- **수정:**
  - 주문에 `exportedAt` 필드 추가
  - export 생성 시 마킹
  - 기본: 미export 건만 포함 (쿼리파라미터 `?includeExported=true` 로 전체 가능)
  - "재발급" 별도 버튼
- **파일:** `server.mjs` shipping_export 핸들러, `setup.js` UI

### 1-D) 운영 관측 (최소)

#### ⑪ audit log 강화
- 벤더 생성/매핑 변경/송장 입력/export 생성에 빠짐없이 기록
- 현재 빠진 것: 벤더 생성 (line 1558-1575에 auditLog 호출 없음)
- **파일:** `server.mjs`

#### ⑫ healthcheck 확장
- `/api/health` 에 최근 import/export 성공 여부 + 시간 추가
- **파일:** `server.mjs` line 1348-1350

#### ⑬ 에러 시 텔레그램 알림 (Phase 3 대비 준비)
- `/api/agent/alert` 엔드포인트 추가 (OpenClaw가 호출할 수 있도록)
- Phase 1에서는 엔드포인트만 만들고, Phase 3에서 OpenClaw cron 연결

---

## Phase 2A: 파일럿 MVP (1셀러 3벤더 1주 무사고)

> 목표: 네 스토어 + 벤더 3개로 실제 운영 1주일 무사고

### 2A-A) 벤더 관리 완성

#### ⑭ 벤더 수정 (name/username)
- `PUT /api/admin/vendors/:id`
- **파일:** `server.mjs`, `setup.js`

#### ⑮ 벤더 비활성화
- `active: false` → 로그인 불가 + 세션 강제 만료
- **파일:** `server.mjs`, `setup.js`

#### ⑯ 비밀번호 리셋 (관리자)
- `POST /api/admin/vendors/:id/reset_password` → 임시 비번 반환
- **파일:** `server.mjs`, `setup.js`

#### ⑰ 벤더 비밀번호 변경 (벤더 포탈)
- `POST /api/vendor/change_password`
- **파일:** `server.mjs`, `orders.js` 또는 별도 UI

### 2A-B) 벤더 포탈 UX (공급사 채택 결정)

#### ⑱ 모바일 1스크린 "오늘 할 일" 뷰
- 미입력 주문이 최상단, 카운트 배지
- **파일:** `public/vendor/orders.html`, `orders.js`

#### ⑲ 택배사 6개 드롭다운 + 기타
- CJ대한통운, 한진, 롯데, 우체국, 로젠, 경동 + 기타(직접입력)
- **파일:** `orders.js` (이미 일부 구현 확인 필요)

#### ⑳ 송장 입력 수정/되돌리기
- 입력 후 30분 이내 수정 가능 (오입력 대응)
- **파일:** `server.mjs`, `orders.js`

#### ㉑ 주문 검색 (수령인/상품명)
- 벤더 포탈에 검색 바 + 날짜 필터 (오늘/이번주/전체)
- **파일:** `orders.js`

### 2A-C) 주문 라이프사이클 (최소)

#### ㉒ 주문 상태 필드 추가
```
pending → assigned → shipped → exported → completed
                  ↘ hold (품절/취소요청/보류)
```
- orders.json에 `status` 필드 추가
- 기존 주문 마이그레이션: tracking 있으면 `shipped`, 없으면 `assigned`
- **파일:** `server.mjs` 전반

#### ㉓ hold 상태 시 export 제외
- `status === 'hold'` 인 주문은 shipping_export에서 자동 제외
- **파일:** `server.mjs` shipping_export 핸들러

### 2A-D) 클레임/변동 최소 (Phase 2A로 승격 — ChatGPT 추천)

#### ㉔ 벤더 "불가/품절" 체크 기능
- 벤더 포탈에서 주문별 "품절/불가" 버튼
- 누르면 `status: 'hold'`, `holdReason: 'vendor_unavailable'`
- **파일:** `server.mjs`, `orders.js`

#### ㉕ hold 시 텔레그램 알림 + admin 작업 큐
- admin 대시보드에 "처리 필요" 목록 표시
- `/api/agent/holds` 엔드포인트 (OpenClaw 연동용)
- **파일:** `server.mjs`, `setup.js`

### 2A-E) 멀티테넌시 선설계 (코드만, 기능 아님)

#### ㉖ tenantId 키 추가
- 모든 JSON 데이터에 `tenantId` 필드 추가 (현재는 기본값 `'default'`)
- 지금은 기능 없이 필드만 — 나중에 DB 이관/멀티셀러 전환 시 비용 최소화
- **파일:** `server.mjs` — loadOrders, loadProducts, loadMapping 등

---

## Phase 2B: 실운영 MVP (스윕 대응 + 스케일)

> 목표: 외부 셀러 온보딩 가능한 수준

#### ㉗ 합배송 그룹핑
- 동일 수령인+주소 기준 그룹핑 → 발송 export에서 1건으로 처리 옵션
- **파일:** `server.mjs` shipping_export

#### ㉘ 간이 정산 뷰
- 벤더별/기간별 주문 수, 총액 집계
- `/api/admin/settlement` 엔드포인트 + UI
- **파일:** `server.mjs`, `setup.js`

#### ㉙ 벌크 송장 입력 (엑셀 업로드)
- 벤더가 엑셀로 송장 일괄 입력 가능
- **파일:** `server.mjs`, `orders.js`

#### ㉚ 개인정보 마스킹 옵션
- 벤더 화면에서 전화번호/주소 부분 마스킹 (끝 4자리만)
- 설정으로 on/off
- **파일:** `server.mjs`, `orders.js`

#### ㉛ 주문/벤더 목록 페이지네이션
- 50건씩 + 검색/필터
- **파일:** `server.mjs`, `setup.js`, `orders.js`

#### ㉜ 업로드 파일 자동 정리
- `data/uploads/` 7일 이상 파일 삭제 cron
- **파일:** `server.mjs`

#### ㉝ 업로드 히스토리 뷰
- 언제 어떤 import/export를 했는지 audit log 기반 UI
- **파일:** `setup.js`

---

## Phase 3: OpenClaw 에이전트 연동 (승인형 자동화)

> 목표: "잠든 사이 자동 감시/독촉/보고" → 점진적 자동 발송

### 3-A) 에이전트 API (server.mjs에 추가)

```
GET  /api/agent/new_orders      — 미배정/신규 주문 목록
GET  /api/agent/pending_tracking — 송장 미입력 주문 목록
GET  /api/agent/holds           — hold 상태 주문 목록
POST /api/agent/dispatch_ready  — 발송 준비 (export 생성)
POST /api/agent/dispatch_confirm — 발송 확인 (승인형)
POST /api/agent/alert           — 알림 전송 트리거
GET  /api/agent/daily_summary   — 일일 요약 데이터
```
- 모든 에이전트 API에 별도 인증 (API Key 기반, `X-Agent-Key` 헤더)
- 모든 호출 audit log 기록
- **파일:** `server.mjs`

### 3-B) OpenClaw 크론 작업 (추천 순서)

| 순서 | 작업 | 주기 | 위험도 |
|------|------|------|--------|
| 1 | 주문 감시 → 텔레그램 알림 | 5분 | 없음 (읽기만) |
| 2 | 송장 미입력 독촉 | 매일 09:00, 14:00 | 없음 (알림만) |
| 3 | 배송 추적 (korean-delivery-tracker) | 30분 | 없음 (읽기만) |
| 4 | 배송 지연 알림 | 매일 10:00 | 없음 (알림만) |
| 5 | 일일 리포트 | 매일 21:00 | 없음 (읽기만) |
| 6 | **승인형 자동 발송** | 10분 | **중간** (승인 필요) |

### 3-C) 브릿지 자동화 (ChatGPT 제안 — 강력)

> API 확보 전까지 "수동 업로드 병목" 제거

- Playwright로 스마트스토어 셀러센터 → 주문 엑셀 다운로드 → 자동 import
- **반드시 수동 폴백 유지** (엑셀 직접 업로드 경로 살려둠)
- 셀렉터 실패 시 즉시 텔레그램 알림
- **파일:** OpenClaw 스킬로 구현 (server.mjs 외부)

### 3-D) 승인형 자동 발송

```
1. OpenClaw가 "발송 준비 완료 N건" 텔레그램 전송
2. 셀러가 "확인" 버튼 누르면 → dispatch_confirm API 호출
3. 서버가 shipping export 생성 + exportedAt 마킹
4. (Phase 4에서) API로 직접 스마트스토어 발송처리
```
- 완전자율은 Phase 4 API 전환 후에만

---

## Phase 4: 네이버 커머스 API 연동

> 목표: UI 자동화 의존도 제거, 진짜 풀자동화

### 4-A) 인증 모듈

```javascript
// 토큰 발급 플로우
const tokenUrl = 'https://api.commerce.naver.com/external/v1/oauth2/token';
// client_id + timestamp → bcrypt(client_secret) → base64 → client_secret_sign
// grant_type: client_credentials
// type: SELF (테스트) / SELLER (SaaS)
```

- 테스트: 내스토어 앱 (SELF) — 네 API 키로
- SaaS: 솔루션 앱 (SELLER) — `account_id` 기반 멀티셀러
- **파일:** `server.mjs` 새 모듈 또는 `lib/naver-commerce.mjs`

### 4-B) API 연동 범위

| 기능 | API | 대체 |
|------|-----|------|
| 주문 자동 수집 | `GET /api/v1/pay-order/seller/orders` | XLSX 업로드 |
| 주문 상세 | `GET /api/v1/orders/{orderId}` | — |
| 발주 확인 | 상태 변경 → `PREPARING` | 수동 |
| **발송 처리** | `POST /api/v1/orders/{orderId}/shipments` | XLSX export → 수동 업로드 |
| 반품 처리 | 반품 승인/보류/거부 API | 수동 |
| 교환 처리 | 교환 수거완료/재배송 API | 수동 |

### 4-C) SaaS 전환 설계

```
셀러 가입 → 네이버 커머스 API 솔루션 연결 동의
→ 우리가 SELLER 토큰 발급 (account_id 기반)
→ 해당 셀러 주문/배송/CS 전체 접근
```

---

## 실행 우선순위 + 예상 소요

| Phase | 작업 수 | 핵심 목표 | 예상 소요 |
|-------|---------|-----------|-----------|
| **1** | 13개 | 사고 방지 | 3-4시간 |
| **2A** | 13개 | 파일럿 1주 무사고 | 5-6시간 |
| **2B** | 7개 | 외부 셀러 온보딩 | 4-5시간 |
| **3** | 크론 6개 + API 7개 | 승인형 자동화 | 3-4시간 |
| **4** | API 모듈 + 6개 연동 | 풀자동화 | API 키 확보 후 |

### 오늘 실행 가능 범위: Phase 1 + Phase 2A (+ 2B 일부)

---

## 파일럿 스모크 테스트 (ChatGPT Appendix A 기반)

- [ ] 주문 XLSX 업로드 성공 (readMultipart 버그 수정 후)
- [ ] 매핑된 상품이 벤더에 자동 배정됨
- [ ] **매핑 충돌 시 UI 경고 표시** (신규)
- [ ] 벤더 포탈에서 주문 확인 (모바일)
- [ ] 벤더 송장 입력 → admin 반영
- [ ] **벤더 "품절/불가" 체크 → hold 상태 전환** (신규)
- [ ] 발송 export 생성 시 택배사 한글 정상
- [ ] **export 2번 해도 중복 미포함** (exportedAt 기준, 신규)
- [ ] **hold 주문은 export 제외** (신규)
- [ ] 로그인 rate limit 동작 (5회 실패 → 락)
- [ ] CSRF Origin 차단 확인
- [ ] XSS 시도 시 스크립트 실행 안 됨
- [ ] audit log에 핵심 액션 남음

---

## 핵심 파일 변경 목록

| 파일 | Phase | 변경 내용 |
|------|-------|-----------|
| `server.mjs` | 1,2A,2B,3 | 보안/정합성/벤더CRUD/주문상태/에이전트API |
| `public/admin/setup.js` | 1,2A,2B | 매핑충돌UI/벤더관리/export중복/정산 |
| `public/admin/index.html` | 2A | hold 작업큐 표시 |
| `public/admin/login.html` | 1 | demo 힌트 제거 |
| `public/vendor/orders.js` | 2A | 모바일UX/검색/품절체크/송장수정 |
| `public/vendor/orders.html` | 2A | 모바일 레이아웃 개선 |
| `public/vendor/login.html` | 1 | demo 힌트 제거 |
