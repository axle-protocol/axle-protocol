# Telegram Panel — Inline Buttons 설계 (Step5 제외)

작성일: 2026-02-09

## 목표
- 텔레그램에서 버튼 클릭만으로 `some ...` 명령을 호출
- 이미 구현된 `handleText()` 엔진(명령어 기반)을 그대로 사용

## 원칙
- 버튼 callback_data는 **그대로 텍스트 메시지로 라우팅**되게 한다.
  - 예: callback_data = `some 10`
- 따라서 버튼 클릭 이벤트가 들어오면, 시스템은 그냥 해당 문자열을 유저 메시지처럼 처리하면 됨.

## 버튼 구성(최소)

### Autopilot
- 자율주행 10분: `some 10`
- 자율주행 30분: `some 30`
- 자율주행 60분: `some 60`
- +10분 연장: `some +10`

### Control
- 승인 +1: `some approve`
- 일시정지: `some pause`
- 정지: `some stop`
- 상태: `some status`
- 리셋: `some reset`

## 기대 동작
- 클릭 → `handleText(text, statePath, auditPath)` 호출 →
  - state 저장
  - audit.jsonl에 기록
  - replyText(한국어 상태 + 최근 로그) 반환

## 테스트(재현 가능)
- CLI 기준:
```bash
SOME_PANEL_STATE=.state/telegram-panel.json \
SOME_PANEL_AUDIT=.state/audit.jsonl \
node packages/telegram-panel/dist/handleCli.js "some status"
```

## 남은 구현(플랫폼 연결)
- OpenClaw 텔레그램 인라인 버튼의 callback_data를 위 텍스트로 설정
- callback 이벤트를 유저 메시지로 라우팅하거나, 동일한 텍스트를 `handleText`로 전달하는 glue만 추가하면 완성
