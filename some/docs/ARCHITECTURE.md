# SOME Architecture (draft)

## Goals
- Run on user device (Win/Mac)
- Control KakaoTalk PC app via UI automation
- Provide Telegram control plane (logs + kill switch)

## Core packages
- packages/runtime: state machine + guardrails + event log schema
- packages/telegram-panel: Telegram buttons + rendering for event log
- apps/desktop-helper: keep-alive helper + auto-start setup
