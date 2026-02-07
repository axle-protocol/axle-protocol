# 🚨 긴급 리네이밍 요청: PACT → AXLE

## 이유
- `github.com/pact-protocol` 이미 다른 프로젝트가 사용 중
- AXLE는 GitHub, 도메인, npm 전부 사용 가능 확인됨

## 변경 사항

### 이름 변경
- PACT → AXLE
- pact → axle
- Pact → Axle

### 구체적 변경
1. **npm 패키지**: `@pact-protocol/sdk` → `@axle-protocol/sdk`
2. **클래스명**: `PactSDK` → `AxleSDK`, `PactConfig` → `AxleConfig`
3. **채널명**: `pact:tasks` → `axle:tasks`, `pact:claims` → `axle:claims` 등
4. **GitHub org**: `pact-protocol` → `axle-protocol`
5. **문서**: WHITEPAPER.md, README.md 등 모든 pact/PACT 언급

### 대상 파일/폴더
- `sdk/` — package.json, index.ts, types.ts, README.md, test/*
- `demo/` — pubsub.ts, run-demo.ts
- `plugin/` — index.ts
- `docs/` — WHITEPAPER.md, WHITEPAPER_KR.md, *.md
- `README.md`
- `dashboard/` — 필요시

## 완료 후
이 파일 삭제하고 완료 보고해줘.

---
요청자: Clo (via Telegram)
시간: 2026-02-07 13:15 KST
