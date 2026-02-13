# BTS Ticketing — Scorecard (Ralph Loop)

> 목표: 오픈타임 성공률을 “감”이 아니라 **점수/근거**로 관리.
> 각 루프마다 테스트 실행 → 산출물(덤프/스크린샷/로그) → 점수 업데이트 → 다음 액션.

## Metrics (0–5)

### M1. Pre-nav reliability (goods page 고정)
- 0: goods 진입 거의 불가
- 3: goods 진입은 되나 허브 리다이렉트가 잦음
- 5: 오픈 직전까지 goods 페이지 안정 유지

### M2. Booking entry (예매하기 → booking/seat/queue로 전환)
- 0: 예매하기 버튼 클릭/전환 실패
- 3: 클릭은 되나 모달/전환이 자주 실패
- 5: 전환이 매우 안정적 (새탭/동일탭 포함)

### M3. Queue handling (대기열 감지/통과)
- 0: 큐 오탐/미탐으로 막힘
- 3: 큐 감지 OK, 통과/복귀가 불안정
- 5: 큐 상태 분기/통과가 안정적

### M4. Seat selection (ifrmSeat 탐지 + 좌석 클릭)
- 0: 프레임/좌석 탐지 실패
- 3: 탐지 OK, 클릭/연석 선택이 불안정
- 5: 클릭/연석/다음단계까지 안정

### M5. Manual-resume UX (야놀자/Turnstile 수동 처리 후 resume)
- 0: 리다이렉트 시 흐름 끊김
- 3: 수동 처리 후 재실행 필요
- 5: 수동 처리 후 자동으로 복귀 감지/상태 저장

## Current Score (latest)
- Date: 2026-02-13
- Strategy: A (manual pre-nav + keepalive)
- M1: 2/5 (자동 pre-nav는 불안정. A전략으로 수동 pre-nav 전제)
- M2: 4/5 (direct booking(step1) 경로로 booking 단계 스킵 가능 → open-time 핵심 구간 집중)
- M3: 4/5 (direct booking에서 queue 통과까지 재현 성공. one-stop-error는 에러로 분기 추가)
- M4: 2/5 (좌석 프레임 없음 + 1석만 탐지 + one-stop-error로 종료 관측 → seat 진입/프레임 탐지 개선 필요)
- M5: 4/5 (manual-resume + storage_state save 구현)

## Evidence (latest)
- /tmp/bts-debug/20260213_150317_click_booking_button_failed/
- /tmp/bts-debug/20260213_150511_click_booking_button_failed/
- /tmp/bts-debug/20260213_150720_nol_search_wrong_goods/
- /tmp/bts-debug/20260213_150721_navigate_to_concert_failed/

## Next actions (this loop)
- [ ] Make navigate_to_concert() default to Strategy A: if hub redirect or wrong-goods, fail fast with actionable message ("수동으로 goods 페이지에서 대기 후 실행")
- [ ] Improve booking modal click: prioritize `.sideBtn.is-primary` JS handler (href="#") + verify transition via DOM, not only URL.

## Loop Log
- 2026-02-13: P0-4 listener cleanup; P0-5 yanolja manual-resume; A-strategy runbook tightened.
