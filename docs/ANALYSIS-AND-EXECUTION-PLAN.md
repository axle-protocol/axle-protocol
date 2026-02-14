# Option C: 분산형 에이전트 프로토콜 - 종합 분석 및 실행 플랜

> 작성일: 2026-02-06
> 목적: 기술 보고서 검증 + 경쟁사 분석 + Must Fix 실행 플랜
> 마감: 2026-02-18 (D-12), Hashed Vibe Labs 투자 유치용 MVP

---

## Part 1: 기술 보고서 검증 (솔직한 비판)

### 1.1 보고서의 강점

- **3계층 아키텍처(인지/실행/신뢰)**: 설계가 깔끔하고 관심사 분리가 명확
- **Solana 선택**: AI 에이전트 생태계에서 Solana가 점유율 77%(x402 프로토콜 기준), 합리적 선택
- **PDA 기반 에스크로**: Anchor 프레임워크의 정석적인 접근
- **Task 상태머신**: Created → Accepted → Delivered → Completed 흐름이 간결

### 1.2 보고서의 문제점

| 항목 | 보고서 주장 | 현실 |
|------|------------|------|
| **72시간 MVP** | "바이브 코딩으로 2주 작업을 3일에" | 현재 코드 완성도 ~40%. 보안 수정 + IDL 연동 + 테스트까지 72시간은 매우 빡빡하지만 가능. 단, 대시보드는 스킵해야 함 |
| **OpenClaw** | "에이전트의 신체 역할" | OpenClaw는 Peter Steinberger가 만든 **개인 AI 비서**(WhatsApp/Telegram 봇). P2P 에이전트 프로토콜과는 다른 프로젝트. 직접 연동하려면 상당한 커스텀 필요 |
| **5개 노드 동시** | "Day 3에 5개 에이전트 노드 스트레스 테스트" | 현재 노드 간 통신 레이어(Redis Pub/Sub)가 아예 없음. 5노드는 비현실적, **2노드 데모가 현실적** |
| **Docker 샌드박스** | "AppArmor 프로필 적용" | MVP에서 보안 샌드박스까지 구현하면 시간 초과. 데모에서는 스킵하고 "구현 예정"으로 문서화 |
| **Claude API 비용** | "$500-800" | 맞음. Anthropic 공식 사례: 16에이전트 2주 = $20K. 3에이전트 72시간 ≈ $500-800 합리적 |
| **P2P 통신** | "libp2p 또는 Redis Pub/Sub" | Redis Pub/Sub이 정답. libp2p는 MVP에 과도함 |

### 1.3 핵심 리스크 (보고서가 과소평가한 것)

1. **Anchor 컴파일 시간**: `anchor build` 한 번에 2-5분. 반복 수정하면 누적 시간 상당
2. **Devnet 불안정성**: 에어드롭 실패, RPC 타임아웃 빈번. localnet 우선 개발 권장
3. **IDL 연동 복잡도**: 현재 plugin이 로컬 Map만 사용 → Anchor IDL import + 트랜잭션 구성은 단순 "교체"가 아닌 **전면 재작성**에 가까움
4. **OpenClaw 의존성**: OpenClaw의 플러그인 시스템이 이 프로토콜과 맞는지 검증 필요

---

## Part 2: 경쟁사 분석

### 2.1 주요 경쟁자

| 프로젝트 | 핵심 | 차별점 | 약점 |
|----------|------|--------|------|
| **ElizaOS** | AI 에이전트 프레임워크 | 50,000+ 에이전트, $20B 자산 관리, 크로스체인 | 프레임워크일 뿐 마켓플레이스가 아님 |
| **Olas (Autonolas)** | 자율 에이전트 프로토콜 | 700K+ txn/월, $13.8M 펀딩(1kx 리드, 2026.01), 앱스토어 | 아키텍처 복잡, 진입장벽 높음 |
| **Virtuals Protocol** | 에이전트 토큰화 | $40M 바이백, 런치패드 모델 | 폐쇄적 생태계 |
| **Fetch.ai (ASI Alliance)** | 인프라 + uAgents | 엔터프라이즈 타겟, ASI 얼라이언스 | 소비자 접근성 낮음 |
| **CrewAI** | 오픈소스 오케스트레이션 | 100K+ 개발자, Python 네이티브 | 블록체인 없음, 중앙화 |
| **Solana Agent Kit** | Solana 에이전트 도구 | 60+ 액션, 100K+ 다운로드 | 프로토콜이 아닌 라이브러리 |

### 2.2 Option C의 포지셔닝

**빈 곳(Gap)**: "Solana 네이티브 에이전트 작업 마켓플레이스 프로토콜"

- ElizaOS = 에이전트를 **만드는** 프레임워크
- Olas = **복잡한** 자율 에이전트 네트워크
- Virtuals = 에이전트를 **투자하는** 플랫폼
- **Option C = 에이전트가 서로 일을 주고받는 "Upwork for AI Agents"**

### 2.3 시장 데이터

- CoinGecko 기준 AI 에이전트 크립토 프로젝트: 550+ 개, 합산 시가총액 $4.34B
- x402 프로토콜: 20M+ 트랜잭션, 1M+ 자율 에이전트 온체인
- Agentic AI 시장: $7.8B → $52B by 2030
- 2026년 말까지 엔터프라이즈 앱의 40%가 AI 에이전트 내장 (vs 2025년 5%)

---

## Part 3: 비용 분석

### 3.1 개발 비용 (MVP)

| 항목 | 비용 | 비고 |
|------|------|------|
| Claude API (Team Agents) | $500-800 | 3 에이전트 x 72시간 |
| Solana RPC (Helius Free) | $0 | Free tier: 1M credits/월, 10 RPS |
| Devnet SOL | $0 | 에어드롭 무료 |
| 서버 (로컬 개발) | $0 | 로컬 머신 사용 |
| **합계** | **~$500-800** | |

### 3.2 운영 비용 (데모 후 월간)

| 항목 | 월 비용 | 비고 |
|------|---------|------|
| Helius Developer | $49/월 | 10M credits, 50 RPS |
| VPS (2 노드) | $40/월 | DigitalOcean 4GB x 2 |
| Claude API (에이전트 운영) | $100-300/월 | 사용량에 따라 |
| **합계** | **~$200-400/월** | |

### 3.3 Solana 트랜잭션 비용

- 에이전트 등록: ~0.003 SOL (PDA 생성 + rent)
- 태스크 생성: ~0.005 SOL (PDA + escrow)
- 태스크 완료: ~0.00001 SOL (상태 변경)
- 1,000 태스크 사이클: ~8 SOL

---

## Part 4: 실현 가능성 판단

### 4.1 현재 코드 상태

| 컴포넌트 | 완성도 | 파일 | 이슈 수 |
|----------|--------|------|---------|
| lib.rs (Solana 컨트랙트) | 70% | 385 lines | 보안 이슈 5개 |
| index.ts (Plugin) | 40% | 418 lines | 온체인 연동 없음, 버그 7개 |
| types.ts (타입 정의) | 100% | 138 lines | - |
| tests | 5% | 16 lines | 템플릿만 존재 |
| dashboard | 0% | 없음 | 미구현 |

### 4.2 D-12 로드맵

| 기간 | 작업 | 산출물 |
|------|------|--------|
| Days 1-2 | Must Fix 7개 보안 수정 (Agent Teams 병렬) | 보안 패치된 lib.rs, index.ts |
| Days 3-5 | Devnet 배포 + IDL 연동 테스트 | 배포된 프로그램 + 연동된 플러그인 |
| Days 6-8 | 2노드 데모 시나리오 구현 (Redis Pub/Sub) | E2E 워크플로우 |
| Days 9-10 | 간단한 웹 대시보드 (God View) | Next.js 페이지 |
| Days 11-12 | 데모 영상 + 문서화 | 투자자용 자료 |

### 4.3 투자 유치 가능성

- Olas가 비슷한 포지션에서 $13.8M 펀딩 (2026.01)
- AI 에이전트 인프라가 2026 투자 메가트렌드
- Solana 네이티브 + 심플한 프로토콜 = Hashed에 어필 가능
- **핵심**: 작동하는 데모 > 완벽한 코드

---

## Part 5: Must Fix 7개 항목 상세

### Fix #1: Escrow PDA seeds 제약 조건 추가 [보안 치명적]

**파일**: `contracts/.../src/lib.rs` — `CompleteTask`, `CancelTask` 구조체
**문제**: escrow 계정에 seeds 제약이 없어 공격자가 아무 계정을 escrow로 전달 가능
**수정**: escrow에 `seeds = [b"escrow", task_account.id.as_ref()], bump` 추가

### Fix #2: timeout_task 인스트럭션 추가

**파일**: `lib.rs` — 새 인스트럭션
**문제**: 데드라인 지나도 Provider 잠수 시 Requester 자금 영구 잠김
**수정**: deadline 초과 시 Requester가 에스크로 회수하는 `timeout_task` 인스트럭션 추가
- 상태 체크: Created 또는 Accepted만 가능
- 시간 체크: `Clock::get()?.unix_timestamp > task.deadline`
- Accepted 상태였으면 Provider의 `tasks_failed += 1`

### Fix #3: CompleteTask agent_account PDA 검증

**파일**: `lib.rs` — `CompleteTask` 구조체
**문제**: agent_account가 provider의 것인지 확인 안 함 → reputation 조작 가능
**수정**: `seeds = [b"agent", provider.key().as_ref()], bump` 추가

### Fix #4: AcceptTask capability 매칭

**파일**: `lib.rs` — `accept_task` 함수
**문제**: 아무 에이전트가 아무 작업 수락 가능
**수정**: `agent.capabilities.contains(&task.required_capability)` 검증 + `CapabilityMismatch` 에러코드

### Fix #5: Anchor IDL 연동 (index.ts 전면 리팩터)

**파일**: `plugin/src/index.ts`
**문제**: 모든 함수가 로컬 Map만 사용, Solana 트랜잭션 전혀 없음
**수정**: Anchor IDL import + Program 인스턴스로 실제 트랜잭션 전송
- `registerAgent` → `program.methods.registerAgent(nodeId, caps, fee).accounts({...}).rpc()`
- `createTask` → `program.methods.createTask(taskId, hash, cap, reward, deadline).accounts({...}).rpc()`
- 등등 모든 메서드를 실제 트랜잭션으로 교체

### Fix #6: 해시 함수 SHA-256으로 교체

**파일**: `plugin/src/index.ts` — `hashData` 메서드
**문제**: `nacl.hash`는 SHA-512, 컨트랙트는 `[u8; 32]` SHA-256 기대
**수정**: `crypto.createHash('sha256')` 사용

### Fix #7: 메시지 서명 canonical JSON

**파일**: `plugin/src/index.ts` — `createMessage`, `verifyMessage`
**문제**: `JSON.stringify` 키 순서가 런타임마다 다를 수 있음
**수정**: 키 정렬된 canonical JSON 함수 구현 및 적용

---

## Part 6: Agent Teams 실행 구성

### 팀 구성

| 에이전트 | 역할 | 담당 항목 | 예상 시간 |
|----------|------|-----------|-----------|
| **contract-fixer** | Rust/Anchor | Fix #1, #2, #3, #4 | 2-3시간 |
| **plugin-fixer** | TypeScript | Fix #5, #6, #7 | 2-3시간 |
| **test-writer** | 테스트 작성 | 수정 완료 후 통합 테스트 | 1-2시간 |

### 검증 방법

1. `anchor build` 성공
2. `npm run build` 성공 (tsc 에러 없음)
3. `anchor test` — localnet에서 전체 흐름 테스트
4. 잘못된 escrow 계정으로 completeTask 호출 시 에러 확인

---

## 결론

Option C는 실현 가능하다. 시장에 빈자리가 있고(Solana 네이티브 에이전트 마켓플레이스),
기술적으로 기반이 잘 잡혀 있으며, 비용도 합리적이다. 72시간은 무리지만 12일이면 충분하다.
핵심은 "작동하는 데모"를 만드는 것이지 완벽한 시스템을 만드는 것이 아니다.

---

## 참고 소스

- ElizaOS: docs.elizaos.ai, 50K+ agents, $20B+ assets
- Olas: olas.network, $13.8M funding (1kx, Jan 2026)
- Virtuals: whitepaper.virtuals.io, $40M buyback
- Solana Agent Kit: github.com/sendaifun/solana-agent-kit, 1400+ stars
- x402 Protocol: 20M+ transactions, 1M+ agents
- Agentic AI Market: $7.8B → $52B by 2030
- Anchor PDA Docs: anchor-lang.com/docs/basics/pda
