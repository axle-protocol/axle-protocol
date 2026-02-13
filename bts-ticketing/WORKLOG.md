# WORKLOG — bts-ticketing

> Single source of truth for **current state**.
> Keep it short. Update when you start/finish a ticket.

## Now
- Owner: Clo (with Han)
- Ticket: P0-3 (booking→queue→seats reliability)
- Goal: Reduce open-time failure modes (yanolja redirect, popup/tab drift, queue false-positive, wrong goods from search).
- Current branch: main
- Last commit: 11bef8d (NOL search target matching + queue/yanolja handling)

## Decisions (append-only)
- 2026-02-13: Codex(통합) + Claude Code(워커) 병렬 작업은 WORKLOG/HANDOFF 기반으로 운영.
- 2026-02-13: Captcha/Turnstile은 기본 수동. CapSolver는 opt-in 유지.

## Open questions / risks
- Yanolja login redirect는 세션/Turnstile 상태에 따라 빈번. 완전 무인 자동화 승률 낮음 → 오픈 전 수동 준비가 핵심.
- NOL UI/DOM이 자주 바뀌어 selector drift 가능.

## Next up (Backlog)
- P0-4: click_booking_button() context.on('page') 리스너 누적 방지 (cleanup) + 새탭/동일탭 race 안정화.
- P0-5: handle_yanolja_redirect()에서 “수동 해결 후 resume” UX 개선 + storage_state 갱신 타이밍 강화.
- P1-1: navigate_to_concert() search 결과에서 goodsCode 매칭 안 되면 2~3개 후보를 순차 시도.
- P1-2: handle_waiting_queue() queue/seat 판별 개선(특정 DOM/텍스트) + max_wait 전략(짧은 빠른 재시도).
- P2-1: RUNBOOK_OPEN_TIME.md에 ‘세션 유지(주기적 스크롤/새로고침)’ 및 ‘오픈 직후 재시도 시나리오’ 추가.
