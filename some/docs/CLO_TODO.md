# Clo TODO — SOME 프로젝트 (2026-02-10)

## ✅ 완료된 것 (ChatGPT)

### 문서
- [x] LLM_PROMPTS.md — Training/Autopilot 프롬프트 템플릿
- [x] STYLE_RULES_KR.md — 스타일 토글 룰표  
- [x] SAFETY_POLICY.md — boundaryFilter/금칙어 정책
- [x] ARCHITECTURE.md, KR_MARKET_RESEARCH.md, ONEPAGER_KR.md 등

### packages/runtime
- [x] stateMachine.ts — TRAINING → UNLOCKED → AUTOPILOT 상태 전이
- [x] events.ts — 이벤트 타입 정의
- [x] profile.ts — 파트너 프로필 구조

### packages/llm
- [x] types.ts — ReplyJson, RiskFlag 타입
- [x] validate.ts — JSON 스키마 검증
- [x] loadDocs.ts — 문서 로딩

### packages/telegram-panel
- [x] commands.ts — 텔레그램 명령어
- [x] handler.ts — 메시지 핸들링
- [x] persist.ts — 상태 저장

---

## ❌ 빠진 부분 (엔진)

### 1. KakaoTalk Adapter (kakaoAdapter.ts)
**현재:** 플레이스홀더만 있음 (interface만 정의)
```typescript
export interface KakaoAdapter {
  observe(): Promise<KakaoIncoming[]>; // TODO
  send(msg: KakaoOutgoing): Promise<void>; // TODO
}
```

**필요한 구현:**
- Peekaboo로 KakaoTalk 화면 캡처
- 새 메시지 감지 (OCR 또는 UI 요소)
- 입력창에 텍스트 입력 + 전송

### 2. LLM Reply Generator
**현재:** 타입/검증만 있고 실제 호출 없음

**필요한 구현:**
```typescript
// packages/llm/src/generateReply.ts
export async function generateReply(
  messages: KakaoIncoming[],
  profile: PartnerProfile,
  mode: 'training' | 'autopilot'
): Promise<ReplyJson> {
  // 1. 프롬프트 조립 (LLM_PROMPTS.md 기반)
  // 2. Claude/OpenAI API 호출
  // 3. 응답 파싱 + 검증
  // 4. ReplyJson 반환
}
```

### 3. Main Loop (Orchestrator)
**현재:** 없음

**필요한 구현:**
```typescript
// packages/runtime/src/engine.ts
export async function runLoop(sess: SomeSession) {
  while (true) {
    // 1. kakaoAdapter.observe() — 새 메시지 체크
    // 2. 새 메시지 있으면 generateReply()
    // 3. 상태에 따라:
    //    - TRAINING: 텔레그램에 승인 요청
    //    - AUTOPILOT: 자동 전송
    // 4. 이벤트 로깅
    // 5. tick() — autopilot 시간 체크
    await sleep(5000);
  }
}
```

### 4. Desktop Helper (apps/desktop-helper)
**현재:** 폴더 자체가 없음

**필요한 구현:**
- 맥미니 부팅 시 자동 시작
- KakaoTalk 앱 상태 모니터링
- 연결 끊김 감지 + 복구

---

## 🎯 우선순위

### P1 (핵심 엔진)
1. **generateReply.ts** — LLM 호출 + 답장 생성
2. **kakaoAdapter.ts** — Peekaboo 연동
3. **engine.ts** — 메인 루프

### P2 (기능 완성)
4. Telegram 승인 플로우 연결
5. 파트너 프로필 로딩/저장
6. 스타일 토글 적용

### P3 (안정화)
7. Desktop helper
8. 에러 처리/복구
9. 테스트 코드

---

## 📋 다음 단계

Clo가 진행할 순서:
1. `packages/llm/src/generateReply.ts` 작성
2. `packages/runtime/src/engine.ts` 작성
3. Peekaboo로 KakaoTalk 요소 탐색 (Han이 카톡 설치/로그인 필요)
4. `kakaoAdapter.ts` 실제 구현
5. 전체 연동 테스트
