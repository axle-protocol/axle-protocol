# Claude Code 온보딩 브리핑

## 🎯 미션

**"Option C: 분산형 에이전트 프로토콜"** MVP를 12일 안에 완성해서 **Hashed Vibe Labs** 투자 유치.

- **마감:** 2026-02-18 (D-12)
- **투자:** 1억원 / 5% 지분
- **필수:** 라이브 서비스 URL + 데모 영상

---

## 📋 프로젝트 개요

### Option C란?

**"AI 에이전트가 다른 OpenClaw 노드에게 일을 맡기고 토큰으로 지불하는 분산 네트워크"**

핵심 인사이트:
- AI는 "생각"은 잘하지만 "행동"은 못함
- AI가 못하는 것: 한국 IP로 네이버 접속, 실제 결제, CAPTCHA 풀기, 물리적 위치 확인
- 해결책: 전 세계 OpenClaw 노드들이 이런 작업을 대신 수행하고 보상 받음

**비유:** Amazon Mechanical Turk인데, 고객이 사람이 아니라 **AI 에이전트**

### 아키텍처 (3계층)

```
┌─────────────────────────────────────────────────────────┐
│  L3: COGNITION (Claude Opus)                            │
│  - 작업 계획 및 협상                                      │
│  - 결과 검증                                             │
│  - 추론 및 의사결정                                       │
├─────────────────────────────────────────────────────────┤
│  L2: RUNTIME (OpenClaw Node)                            │
│  - 브라우저 자동화                                        │
│  - 파일 시스템 접근                                       │
│  - 쉘 명령 실행                                          │
│  - 외부 API 호출                                         │
├─────────────────────────────────────────────────────────┤
│  L1: TRUST (Solana)                                     │
│  - 에이전트 신원 레지스트리                                │
│  - 작업 에스크로                                         │
│  - 평판 추적                                             │
│  - 결제 정산                                             │
└─────────────────────────────────────────────────────────┘
```

---

## 📁 현재 프로젝트 구조

```
/Users/hyunwoo/.openclaw/workspace/option-c/
├── docs/
│   └── ARCHITECTURE.md      # 전체 설계 문서 (읽어볼 것!)
├── plugin/
│   ├── package.json         # npm 패키지 설정
│   ├── tsconfig.json        # TypeScript 설정
│   └── src/
│       ├── types.ts         # 타입 정의 (Agent, Task, Message 등)
│       └── index.ts         # SolanaProtocol 클래스 (핵심 플러그인)
├── contracts/
│   └── agent_protocol/      # Anchor (Solana) 프로젝트
│       ├── Anchor.toml
│       ├── programs/agent_protocol/src/lib.rs  # 스마트 컨트랙트
│       └── target/deploy/agent_protocol.so     # 컴파일된 바이너리
├── dashboard/               # (미구현) Next.js 대시보드
└── scripts/                 # (미구현) 배포/테스트 스크립트
```

---

## ✅ 이미 완료된 것

### 1. 개발 환경
- Rust 1.93 ✅
- Solana CLI 3.0.15 ✅
- Anchor 0.32.1 ✅
- Node.js 22.x ✅

### 2. Solana 스마트 컨트랙트 (lib.rs)
- `register_agent()` - 에이전트 등록
- `update_agent()` - 정보 업데이트
- `create_task()` - 작업 생성 + 에스크로 예치
- `accept_task()` - 작업 수락
- `deliver_task()` - 결과 제출
- `complete_task()` - 완료 확인 + 지불 릴리스
- `cancel_task()` - 취소 + 환불
- **빌드 성공** (.so 파일 생성됨)

### 3. TypeScript 플러그인 (index.ts)
- 지갑 생성/로드
- 에이전트 등록/조회
- 작업 CRUD
- 메시지 서명/검증
- 이벤트 시스템
- **아직 테스트 안 됨**

---

## ❌ 아직 해야 할 것

1. **Devnet 배포** - SOL airdrop rate limit 걸림
2. **플러그인 테스트** - npm install 및 단위 테스트
3. **노드 간 통신** - Redis Pub/Sub 또는 간단한 시그널링
4. **대시보드** - Next.js로 작업 현황 시각화
5. **데모 영상** - 두 노드가 작업 교환하는 영상

---

## 🤝 하이브리드 작업 방식

현재 **Clo (OpenClaw 에이전트, Opus 4.5)** 와 **Claude Code (Opus 4.6)** 가 협업 중.

### 역할 분담

| 역할 | 담당 | 설명 |
|------|------|------|
| 설계/조율 | Clo (Opus 4.5) | 전체 아키텍처, 진행 상황 추적 |
| 코드 생성 | Claude Code (Opus 4.6) | 복잡한 코드 구현, 리팩토링 |
| 리뷰/검증 | 둘 다 | 서로의 코드 검토 |
| 배포/테스트 | Clo | 실제 환경에서 실행 |

### 커뮤니케이션

- Han이 중간에서 조율
- 작업 결과는 파일로 저장해서 공유
- 중요한 결정은 `docs/` 폴더에 문서화

---

## 🎯 지금 Claude Code가 할 일

### 우선순위 1: 기존 코드 리뷰

다음 파일들을 읽고 비판적으로 검토해줘:

1. `docs/ARCHITECTURE.md` - 설계가 합리적인지
2. `plugin/src/types.ts` - 타입 정의가 완전한지
3. `plugin/src/index.ts` - 구현이 올바른지
4. `contracts/agent_protocol/programs/agent_protocol/src/lib.rs` - 보안 취약점 있는지

**검토 포인트:**
- 보안 (에스크로 로직, 권한 체크)
- 확장성 (다수 노드 지원)
- MVP 범위 (72시간에 가능한지)
- 누락된 기능

### 우선순위 2: 개선 구현

리뷰 후 발견된 문제점 수정하거나, 다음 중 하나 구현:

1. **테스트 코드** - `plugin/src/__tests__/` 작성
2. **Redis 통신** - 노드 간 메시지 교환
3. **CLI 도구** - 에이전트 등록/작업 생성 명령어

### 우선순위 3: 대시보드

`dashboard/` 폴더에 Next.js 프로젝트 생성:
- 실시간 작업 목록
- 에이전트 상태
- 트랜잭션 히스토리

---

## 🔧 개발 환경 명령어

```bash
# Solana 설정
export PATH="/Users/hyunwoo/.local/share/solana/install/active_release/bin:$PATH"
source "$HOME/.cargo/env"

# 컨트랙트 빌드
cd /Users/hyunwoo/.openclaw/workspace/option-c/contracts/agent_protocol
anchor build

# 플러그인 설치
cd /Users/hyunwoo/.openclaw/workspace/option-c/plugin
pnpm install
pnpm build

# Devnet 배포 (SOL 필요)
anchor deploy --provider.cluster devnet
```

---

## 💰 리소스

- **Solana Devnet 지갑:** `5mpooTDrxAGnvbHjdX4xbKe8Gb9JrSDnJpS9SWKwUXJu` (SOL 필요)
- **기존 지갑:** `47FAJfAoRZqgKPuAPgWfhaTRwLie8kBNQcu7X8p5xKR1` (0 SOL)
- **Faucet:** https://faucet.solana.com (rate limit 주의)

---

## 📚 참고 자료

- Solana Agent Kit: https://github.com/sendai/solana-agent-kit
- Anchor Framework: https://www.anchor-lang.com/
- OpenClaw: https://github.com/openclaw/openclaw

---

## ⚠️ 주의사항

1. **시간 제약** - 12일 안에 데모 가능한 범위로 집중
2. **보안** - 에스크로 로직은 신중하게 (실제 돈이 오갈 수 있음)
3. **단순화** - 완벽보다 작동하는 MVP 우선
4. **문서화** - 변경사항은 반드시 기록

---

## 🚀 시작하기

```bash
# 1. 프로젝트 폴더로 이동
cd /Users/hyunwoo/.openclaw/workspace/option-c

# 2. 설계 문서 읽기
cat docs/ARCHITECTURE.md

# 3. 현재 코드 확인
cat plugin/src/index.ts
cat contracts/agent_protocol/programs/agent_protocol/src/lib.rs

# 4. 리뷰 시작!
```

---

**질문 있으면 Han한테 물어봐. 작업 결과는 파일로 저장해서 공유해줘!** 🐾
