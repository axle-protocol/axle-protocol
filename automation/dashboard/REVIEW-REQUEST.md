# REVIEW-REQUEST
# Automation Pipeline — Phase 5 Rev 2 (가드레일 강화)
# STATE: WAITING_FOR_CODEX

## 변경 파일

| File | Lines | What |
|------|-------|------|
| `server.mjs` | L508 | `NAVER_LIVE` 선언 (기본 `false`) |
| `server.mjs` | L510-519 | `NAVER_CARRIER_MAP` 모듈 스코프 이동 |
| `server.mjs` | L527-597 | `doNaverSync(from, to)` 추출 |
| `server.mjs` | L604-663 | `doNaverShipBatch(orderIds)` 추출 + dry-run 분기 (L630) |
| `server.mjs` | L671-704 | `doNaverConfirmBatch(orderIds)` 추출 + dry-run 분기 (L683) + `saveOrders` + `transitionOrder(confirmed)` |
| `server.mjs` | L721-733 | `validateTransition` — `approved: ['running', 'failed']` 추가 |
| `server.mjs` | L2696-2737 | `POST /api/agent/request_ship` |
| `server.mjs` | L2739-2773 | `POST /api/agent/request_confirm` |
| `server.mjs` | L2775-2800 | `GET /api/agent/automation_status` |
| `server.mjs` | L3378-3405 | `GET /api/admin/automation/status` + `POST /api/admin/automation/toggle` |
| `server.mjs` | L3417 | `automationEnabled` 선언 (기본 `false`) |
| `server.mjs` | L3424-3441 | `autoSyncOrders()` — L3425 `if (!automationEnabled) return;` |
| `server.mjs` | L3448-3495 | `autoCreateBatches()` — 중복 방지 로직 |
| `server.mjs` | L3522-3566 | `autoExecuteApproved()` — L3523 `if (!automationEnabled) return;` |
| `server.mjs` | L3578,3581 | `setInterval` 스케줄러 등록 |
| `public/app.js` | L25-26 | `cardTitle` — ship/confirm batch 타입 |
| `public/app.js` | L43-46 | `cardSubtitle` — 건수 + 자동/수동 |
| `public/app.js` | L48-59 | `cardPreview` — 주문ID 미리보기 |

## 사고 방지 핵심 — 리뷰 기준 (필수 확인)

### G1. automationEnabled 기본값 = false
- **L3417**: `(process.env.AUTO_SYNC_ENABLED || 'false') === 'true'`
- ENV 미설정 시 스케줄러가 절대 돌아가지 않음
- `POST /api/admin/automation/toggle` (L3397)로 명시적 ON만 가능

### G2. NAVER_LIVE 기본값 = false → dry-run
- **L508**: `(process.env.NAVER_LIVE || 'false') === 'true'`
- `NAVER_LIVE=false` (기본):
  - `doNaverShipBatch` L630: `transitionOrder` 호출 전에 분기 → API 미호출, 상태 미변경, audit만
  - `doNaverConfirmBatch` L683: API 미호출, 상태 미변경, audit만
- `NAVER_LIVE=true`: 실제 `naverCommerce.shipOrder()` / `.confirmOrder()` 호출

### G3. 승인 없이 ship/confirm 절대 불가 (2-step 유지)
- `autoCreateBatches` → 큐 아이템 `state: 'pending'` 생성
- `autoExecuteApproved` → `state === 'approved'` 인 것만 실행 (L3525)
- pending → approved 전이는 오너가 `/api/queue/:id/approve` 호출해야만 발생
- **pending 상태에서는 어떤 자동 실행 경로도 없음**

### G4. validateTransition edge-case
- **L725**: `approved: ['running', 'failed']` — empty orderIds 같은 edge-case에서 approved→failed 허용
- 기존: `approved: ['running']`만 있어서 empty batch가 stuck 상태

### G5. phantom _history 방지
- `doNaverShipBatch`: dry-run 분기가 `transitionOrder()` 호출 **전에** 위치 (L630)
- 따라서 `order._history`에 phantom entry가 남지 않음
- `doNaverConfirmBatch`: dry-run 시 `transitionOrder` 자체를 호출하지 않음

## Codex 리뷰에서 반영한 버그 수정 (Rev 1 → Rev 2)

| # | Severity | Bug | Fix | Line |
|---|----------|-----|-----|------|
| 3A | **CRITICAL** | `doNaverConfirmBatch`에 `saveOrders()` 없음 — confirm 결과 디스크 미저장 → 중복 confirm | `saveOrders(db)` 추가 | L703 |
| 3C | **HIGH** | `doNaverConfirmBatch`에 `transitionOrder(confirmed)` 없음 — 주문이 영구 exported 상태 | `transitionOrder` + `naverConfirmedAt` 추가 | L697-698 |
| 3B | **MEDIUM** | `doNaverConfirmBatch`에서 `loadOrders()` 루프 안 호출 — N회 파일 I/O | 루프 밖 1회로 이동 | L673 |
| 5A | **LOW** | `validateTransition`에 `approved→failed` 없음 — empty batch stuck | 전이 추가 | L725 |
| 2A | **LOW** | `doNaverShipBatch` dry-run 후 `_history` phantom | dry-run 분기를 `transitionOrder` 전으로 이동 | L630 |

## 환경변수

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTO_SYNC_ENABLED` | **`false`** | 자동화 ON/OFF (명시적 `true` 필요) |
| `AUTO_SYNC_INTERVAL_MIN` | `30` | sync 주기 (분) |
| `AUTO_EXECUTE_INTERVAL_SEC` | `60` | approved 배치 실행 체크 주기 (초) |
| `NAVER_LIVE` | **`false`** | Naver API 실호출 (명시적 `true` 필요) |

## Codex 리뷰 요청 사항

아래 5개 항목을 **PASS/FAIL + 근거 라인**으로 판정해주세요:

1. `automationEnabled` 기본값이 `false`인가? (L3417)
2. `NAVER_LIVE` 기본값이 `false`이고, `true`일 때만 실호출인가? (L508, L630, L683)
3. 승인 없이 ship/confirm이 절대 실행 안 되는가? (autoExecuteApproved L3525 조건)
4. `validateTransition`이 `approved→failed` edge-case를 허용하는가? (L725)
5. dry-run 시 phantom `_history` 꼬임이 방지되는가? (L630 분기 위치)

추가로 P0/P1 이슈가 있으면 보고해주세요.

# READY_FOR_CODEX
