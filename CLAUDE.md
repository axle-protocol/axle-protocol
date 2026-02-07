# Option C: 분산형 에이전트 프로토콜

## 프로젝트 컨텍스트
- 브리핑: `CLAUDE_CODE_BRIEFING.md` 참조
- 설계: `docs/ARCHITECTURE.md`
- 마감: 2026-02-18 (D-12), Hashed Vibe Labs 투자 유치용 MVP

## 코드 리뷰 완료 (2026-02-06)

4개 파일 리뷰 완료. 아래 작업을 병렬로 진행해야 함.

### Must Fix (데모 전 필수)

#### 1. lib.rs — Escrow PDA seeds 제약 조건 추가 (보안 치명적)
- `CompleteTask`, `CancelTask`의 escrow 계정에 seeds 제약 없음
- 공격자가 아무 계정을 escrow로 전달 가능
- 수정: `seeds = [b"escrow", task_account.id.as_ref()], bump` 추가

#### 2. lib.rs — timeout_task 인스트럭션 추가
- 데드라인 지나도 Provider가 잠수타면 Requester 자금 영구 잠김
- 수정: deadline 초과 시 Requester가 에스크로 회수하는 인스트럭션 추가

#### 3. lib.rs — CompleteTask agent_account PDA 검증
- agent_account가 provider의 것인지 확인 안 함 → reputation 조작 가능
- 수정: `seeds = [b"agent", provider.key().as_ref()], bump` 추가

#### 4. lib.rs — AcceptTask capability 매칭
- 아무 에이전트가 아무 작업 수락 가능
- 수정: agent.capabilities에 task.required_capability 포함 여부 검증

#### 5. index.ts — Anchor IDL 연동
- 현재 Solana와 전혀 상호작용 안 함 (전부 로컬 Map)
- 수정: Anchor IDL import해서 실제 트랜잭션 전송

#### 6. index.ts — 해시 함수 SHA-256으로 교체
- nacl.hash는 SHA-512인데 컨트랙트는 [u8; 32] SHA-256 기대
- 수정: `crypto.createHash('sha256')` 또는 `@noble/hashes/sha256` 사용

#### 7. index.ts — 메시지 서명 canonical JSON
- JSON.stringify 키 순서가 런타임마다 다를 수 있음
- 수정: 키 정렬된 canonical JSON 사용

### Should Fix (안정성)
- deliverTask 상태 체크 (Accepted 상태만 허용)
- cancelTask 메서드 추가 (컨트랙트에는 있으나 플러그인에 없음)
- 비동기 이벤트 핸들러 await 처리
- maxConcurrentTasks 실제 검사 로직

### 이후 작업
- Redis Pub/Sub 노드간 통신
- 테스트 코드 작성
- Next.js 대시보드
- Devnet 배포
- 데모 영상

## 개발 환경
```bash
export PATH="/Users/hyunwoo/.local/share/solana/install/active_release/bin:$PATH"
source "$HOME/.cargo/env"
```
