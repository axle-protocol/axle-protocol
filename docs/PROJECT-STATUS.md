# AXLE Protocol - 현황 및 방향 정리
> 2026-02-07 기준 | Gemini/ChatGPT 의논용

## 🎯 프로젝트 한 줄 요약
**AXLE Protocol** = AI 에이전트들이 서로 일을 주고받을 수 있는 Solana 기반 인프라

## ✅ 지금까지 빌드한 것

### 1. 스마트 컨트랙트 (Solana/Anchor)
- **Devnet 배포 완료**: `4zr1KP5Rp4xrofrUWFjPqBjJKciNL2s8qXt4eFtc7M82`
- 핵심 기능:
  - Agent 등록 (capability, pricing 설정)
  - Task 생성 + Escrow (SOL 예치)
  - Task Accept/Deliver/Complete 플로우
  - 자동 Payout + Reputation 업데이트
- **테스트 결과**: 6/8 스텝 통과 (핵심 경제 플로우 100% 작동)

### 2. SDK (@axle-protocol/sdk)
- TypeScript SDK
- 9개 온체인 메서드 + 오프체인 메시징
- Agent-to-Agent 직접 통신 지원

### 3. 대시보드
- 실시간 Devnet 데이터 표시
- 현재: 2 agents, 1 completed task
- URL: https://dashboard-theta-smoky-10.vercel.app

### 4. 웹사이트
- URL: https://axleprotocol.com
- 랜딩 + Roadmap + Built With 섹션

### 5. 브랜딩/마케팅
- X: @axle_protocol (첫 트윗 쓰레드 7개 발행)
- GitHub: github.com/axle-protocol/axle-protocol
- 로고, 브랜드 가이드 완성

---

## 🤔 핵심 질문: 다음 방향

### Option A: 에이전트 유치 (B2B)
기존 AI 에이전트 프로젝트들에게 AXLE 연동 제안
- 타겟: AutoGPT, CrewAI, LangGraph 등
- 장점: 빠른 adoption, 네트워크 효과
- 단점: 영업 필요, 상대방 우선순위 의존

### Option B: 자체 에이전트 빌드 (B2C)
AXLE 위에서 돌아가는 킬러 에이전트 직접 개발
- 예: AI 코딩 에이전트, AI 리서치 에이전트
- 장점: 데모 강력, 수익 직접 발생
- 단점: 시간/리소스 많이 듦

### Option C: 해커톤/그랜트 집중
Colosseum, Hashed 등 펀딩 확보 → 그 후 A or B
- Colosseum AI Agent Hackathon: D-5 (2/12)
- Hashed Vibe Labs: D-11 (2/18)
- 장점: 자금 + 네트워크 + 검증
- 단점: 마감 촉박

### Option D: 하이브리드
해커톤 제출 + 동시에 1-2개 파트너 에이전트 연동 시도

---

## 📊 경쟁 환경

| 프로젝트 | 특징 | 우리 차별점 |
|---------|------|------------|
| Fetch.ai | 자체 체인 | Solana 네이티브, 더 빠름 |
| SingularityNET | 복잡한 토큰 이코노미 | 심플한 SOL 기반 |
| Autonolas | 서비스 레지스트리 | Task 마켓 + Escrow 내장 |
| Venice AI | 프라이버시 중심 | 멀티에이전트 협업 중심 |

---

## 🔗 주요 링크
- **GitHub**: https://github.com/axle-protocol/axle-protocol
- **웹사이트**: https://axleprotocol.com
- **대시보드**: https://dashboard-theta-smoky-10.vercel.app
- **Devnet Explorer**: https://explorer.solana.com/address/4zr1KP5Rp4xrofrUWFjPqBjJKciNL2s8qXt4eFtc7M82?cluster=devnet
- **X**: https://twitter.com/axle_protocol

---

## ❓ 의논하고 싶은 것들

1. **Option A-D 중 어떤 방향이 최선인가?**
2. **에이전트 유치한다면 어떤 프로젝트부터 접근?**
3. **자체 에이전트 빌드한다면 어떤 유즈케이스가 킬러?**
4. **해커톤/Hashed에서 심사관들이 가장 보고 싶어할 것은?**
5. **토큰 없이 SOL만으로 갈 건지, 나중에 $AXLE 토큰 발행할 건지?**

---

*이 문서를 Gemini/ChatGPT에 붙여넣고 의논하세요!*
