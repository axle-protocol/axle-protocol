# AXLE 시장 조사 보고서

작성일: 2026-02-07

---

## 1. 프로젝트 이름 후보

### 옵션 분석

| 이름 | 장점 | 단점 | 추천 |
|------|------|------|------|
| **AXLE** | 짧음, 기억하기 쉬움, "Solana Agent Trust Infrastructure" | 다른 의미 있을 수 있음 | ⭐⭐⭐⭐⭐ |
| **AgentTrust** | 직관적, 기능 설명 | 너무 일반적 | ⭐⭐⭐ |
| **SolTrust** | Solana 명확, 짧음 | 평범함 | ⭐⭐⭐ |
| **Aegis** | 신화적 (방패), 보안 느낌 | AI 연관 약함 | ⭐⭐⭐⭐ |
| **Nexus** | 연결, 허브 의미 | 이미 많이 사용됨 | ⭐⭐ |
| **Sentinel** | 감시자, 보안 | 군사적 느낌 | ⭐⭐⭐ |
| **Veritas** | 진실 (라틴어) | 발음 어려움 | ⭐⭐⭐ |

### 추천: **AXLE**

이유:
1. 이미 Gemini 보고서에서 브랜딩됨
2. 4글자 = 기억하기 쉬움
3. "Solana Agent Trust Infrastructure" 약어
4. 도메인/핸들 가용성 확인 필요

**대안**: Aegis (그리스 신화의 방패, 보호 의미)

### GitHub Repo 이름 옵션

1. `axle-protocol` — 가장 깔끔
2. `sati-solana` — 체인 명시
3. `solana-agent-trust` — 설명적
4. `agent-passport` — ERC-8004 연관

---

## 2. 경쟁 프로젝트 분석

### 2.1 Solana AI Agent 생태계

| 프로젝트 | 역할 | GitHub Stars | 상태 |
|----------|------|--------------|------|
| **ElizaOS (ai16z)** | Agent Framework | 10K+ | 🟢 활발 |
| **Solana Agent Kit** | SDK | 2K+ | 🟢 활발 |
| **AgentiPy** | DeFi 자동화 | 500+ | 🟢 활발 |
| **Crossmint** | Agent Wallets | N/A (기업) | 🟢 활발 |
| **SAIMP** | 메시지 프로토콜 | 신규 | 🟡 초기 |

### 2.2 경쟁자 상세 분석

#### ElizaOS (ai16z)
- **역할**: AI 에이전트 프레임워크 (TypeScript)
- **GitHub**: github.com/ai16z/eliza (10K+ stars)
- **특징**: 
  - 가장 인기 있는 Solana AI 프레임워크
  - Twitter, Discord 통합
  - 자체 토큰 ($AI16Z)
- **약점**: 신뢰/평판 레이어 없음 → AXLE와 상호보완적
- **교훈**: 커뮤니티 빌딩이 핵심

#### Solana Agent Kit (SendAI)
- **역할**: Solana 도구 SDK
- **GitHub**: github.com/sendai/solana-agent-kit
- **특징**:
  - Solana 트랜잭션 간편화
  - DeFi 프로토콜 연동
  - LangChain 호환
- **관계**: AXLE 통합 논의 중 (Gemini 보고서)

#### Virtual Protocol (Base)
- **역할**: Agent 런치패드
- **체인**: Base (Ethereum L2)
- **특징**:
  - 에이전트 토큰 발행 플랫폼
  - $VIRTUAL 토큰
- **경쟁**: Solana vs Base 구도에서 경쟁자

### 2.3 ERC-8004 (이더리움)

- **상태**: Draft 표준, 아직 확정 안 됨
- **저자**: MetaMask, Google, Coinbase 출신
- **특징**:
  - 에이전트 신원/평판 표준
  - NFT 기반 신원
  - 오프체인 평판 (IPFS)
- **약점**:
  - 이더리움 가스비 높음
  - 느린 확정성
- **AXLE 우위**:
  - Solana 속도 (400ms vs 12초)
  - 비용 1/100
  - 온체인 평판 (ZK Compression)

---

## 3. 시장 데이터

### 3.1 x402 프로토콜 점유율

```
Solana: 77% ████████████████████████████░░░░
Base:   15% █████░░░░░░░░░░░░░░░░░░░░░░░░░░░
기타:    8% ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```

**의미**: AI 에이전트 결제의 77%가 Solana에서 발생
→ 신뢰 레이어도 Solana에 필요

### 3.2 AI 에이전트 시장 성장

- 2024: AI 에이전트 내러티브 시작
- 2025: ElizaOS, x402 등 인프라 성숙
- 2026: 신뢰/평판 레이어 필요성 대두
  - Moltbook 해킹 (150만 API 키 유출)
  - "누가 누구인지 모른다" 문제

---

## 4. 성공 프로젝트 런칭 전략 분석

### 4.1 ElizaOS 케이스 스터디

**성공 요인:**
1. **오픈소스 우선**: GitHub에서 커뮤니티 형성
2. **Build in Public**: 매일 진행 상황 공유
3. **토큰 인센티브**: $AI16Z로 기여자 보상
4. **해커톤 활용**: Colosseum 등에서 노출

**런칭 타임라인:**
```
Week 1-2: GitHub 공개 + 문서화
Week 3-4: 해커톤 제출 + 첫 통합 파트너
Week 5-8: 커뮤니티 그로스 + 그랜트 신청
Week 9+: 토큰 런칭 (선택)
```

### 4.2 성공 프로젝트 공통점

| 요소 | 설명 |
|------|------|
| **명확한 문제 정의** | "X 문제를 Y로 해결" |
| **오픈소스** | GitHub에서 신뢰 구축 |
| **문서화** | 개발자가 바로 시작 가능 |
| **커뮤니티** | Discord/Telegram 활성화 |
| **얼리 어답터** | 첫 10개 통합 확보 |
| **타이밍** | 위기/트렌드에 맞춤 |

---

## 5. AXLE 포지셔닝 전략

### 5.1 핵심 메시지

**One-liner:**
> "The trust layer for AI agents on Solana"

**Problem-Solution:**
> "AI agents can transact, but can't trust each other. 
> AXLE brings on-chain identity and reputation to the 77% of agent payments happening on Solana."

### 5.2 차별화 포인트

| vs | AXLE 우위 |
|----|-----------|
| ERC-8004 | 속도 (400ms), 비용 (1/100), 온체인 평판 |
| ElizaOS | 신뢰 레이어 (상호보완적) |
| 중앙화 DB | 불변성, 탈중앙화, Moltbook 안전 |

### 5.3 타겟 청중

1. **1차**: Solana 에이전트 개발자
2. **2차**: DeFi 프로토콜 (에이전트 통합 원하는)
3. **3차**: VC/투자자 (Hashed 등)

---

## 6. 런칭 로드맵 제안

### Phase 1: 기반 구축 (2/7-2/10)

- [ ] GitHub 레포 공개 (`axle-protocol`)
- [ ] README.md (영어)
- [ ] 기술 문서 (GitBook/Docusaurus)
- [ ] X 계정 셋업 (@axle_protocol)

### Phase 2: 노출 (2/11-2/14)

- [ ] 데모 영상 제작
- [ ] 첫 트윗 시리즈 (Build in Public)
- [ ] Solana 개발자 커뮤니티 공유
- [ ] Colosseum 해커톤 제출

### Phase 3: 투자 유치 (2/15-2/18)

- [ ] Hashed Vibe Labs 지원서
- [ ] 피치 덱 완성
- [ ] 랜딩 페이지 라이브

### Phase 4: 그로스 (2/19+)

- [ ] Solana Agent Kit 통합
- [ ] ElizaOS 플러그인
- [ ] Solana Foundation Grant 신청
- [ ] 첫 10개 에이전트 온보딩

---

## 7. 리소스 필요 사항

### 필수

| 항목 | 비용 | 상태 |
|------|------|------|
| 도메인 (sati.network) | $15/년 | 미확보 |
| GitHub Pro (선택) | $4/월 | 불필요 |
| X Premium (선택) | $8/월 | 선택 |

### 선택

| 항목 | 비용 | 용도 |
|------|------|------|
| Vercel Pro | $20/월 | 랜딩 페이지 |
| Helius RPC | $50/월 | 프로덕션 노드 |
| GitBook | 무료 | 문서화 |

---

## 8. 결론 및 권장사항

### 즉시 실행

1. **프로젝트 이름: AXLE** 확정
2. **GitHub: axle-protocol** 레포 생성
3. **X: @axle_protocol** 핸들 확보
4. **도메인: sati.network** 또는 sati.so

### 다음 주 목표

1. Hashed Vibe Labs 제출 (D-11)
2. GitHub + 문서 공개
3. 데모 영상 촬영
4. 커뮤니티 시작 (Discord/Telegram)

### 핵심 성공 요인

1. **타이밍**: Moltbook 해킹 직후 = 신뢰 필요성 부각
2. **시장 포지션**: Solana x402 77% 위에 레이어
3. **기술 우위**: Token-2022, 온체인 평판
4. **팀 속도**: Phase 1-4를 하룻밤에 완료

---

*다음 업데이트: 경쟁사 GitHub 분석, 커뮤니티 반응 조사*
