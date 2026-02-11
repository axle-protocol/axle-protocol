# Budgeted Agent Ops — MVP 설계/착수 문서

## 목표
OpenClaw 위에 **Budget + Receipts + Escrow**를 최소 기능으로 얹어서:
- 비용 폭주/루프를 막고
- 위험 행동은 승인으로 게이트하고
- 작업 위임/납품/정산을 “증거 기반”으로 굴린다.

---

## MVP 범위 (딱 2주제)
1) **Budget Guardrails**
2) **Escrowed Task Delegation (with Receipts)**

---

## 아키텍처(현실적인 최소)
- OpenClaw 쪽 변경은 최소화(가능하면 “스킬/플러그인”으로 구현)
- AXLE는 devnet로 시작, 메인넷은 나중

### 컴포넌트
1) `@axle-protocol/plugin-openclaw` 확장 (또는 별도 스킬 팩)
- 인터셉터: tool call 전/후에 budget 체크
- receipt: 결과물 해시 + 요약 생성 후 저장

2) `axle-budget-service` (경량)
- budget 상태 저장(파일/DB) + 정책(allowlist/deny)
- projected cost 계산(단순 휴리스틱부터)

3) `axle-escrow-client`
- createEscrow/releaseEscrow 호출 래퍼

---

## 데이터 모델(초안)
### BudgetPolicy
- scope: {workspace, cronJob, toolName, channelId, repo}
- limit: {usdCents, tokens, runs}
- period: {day, week, month}
- action: {pause, requireApproval, deny}

### Receipt
- taskId
- timestamps
- inputsSummary
- outputsSummary
- artifacts: [{type: screenshot|url|diff|file, sha256, meta}]
- approvals: [{by, at, note}]

---

## 동작 플로우
### A) Budget
1) cron/job 실행 시 → `budget.check(scope)`
2) 한도 근접/초과 → 자동 pause + 텔레그램 승인 요청
3) 승인 시에만 계속 진행

### B) Escrow + Receipt
1) requester가 작업 생성 → `createEscrow(taskId, amount, conditions)`
2) provider(OpenClaw agent)가 수행
3) 결과물 산출 → receipt 생성(아티팩트 해시 포함)
4) human 승인/검수 → `releaseEscrow(taskId, proof=receiptHash)`

---

## 데모 2개(필수)
1) **Budgeted Daily Ops**
- 예산 1달러/일 설정
- 반복 루프 감지 시 자동 stop + 승인 요청

2) **Escrowed Code Review**
- PR 리뷰 리포트 생성
- 리포트 해시가 proof
- 승인 시 정산

---

## 오늘 할 일(착수 체크리스트)
- [ ] 어떤 형태로 구현할지 결정: (1) OpenClaw 스킬 패키지 (2) plugin-openclaw 확장
- [ ] receipt 포맷 결정(sha256 대상: markdown report + metadata json)
- [ ] budget scope 최소 3개: cron, tool, repo
- [ ] 데모 리포트 템플릿 1개 작성(PR 리뷰용)

