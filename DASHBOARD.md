# DASHBOARD.md — 2026-02-13 01:33 KST

## 🎯 현재 프로젝트

### BTS 티켓팅 매크로 (Interpark / NOL)

**현상 요약**
- `tickets.interpark.com/goods/...` URL로 바로 진입하면 종종 `https://nol.interpark.com/ticket` (대기/허브)로 리다이렉트되어 **goods 페이지의 “예매하기” 버튼을 못 찾는 케이스** 발생
- Turnstile(Cloudflare) 캡챠는 자동 클릭만으로는 불안정 → **사람이 미리 통과**하는 전략이 가장 안정

**현재 전략(실전형)**
- Han이 오픈 전:
  - NOL에서 공연 페이지까지 **수동으로 진입 + 로그인/Turnstile 해결**
  - “예매하기” 버튼 보이는 화면에서 대기
- 매크로는 오픈 직후:
  - 예매하기 → 팝업/iframe 전환 → 좌석 선택 → 다음 단계까지 자동화
  - 결제 자동화는 기본 OFF 유지(리스크/실수 방지)

**코드 상태 (최근 반영)**
- CapSolver: `--capsolver` **옵션일 때만** 사용 (기본 수동)
- 성능/안정화 리팩터링:
  - booking path `networkidle` 제거
  - selector 순차 탐색 → 콤마 selector로 단축
  - `expect_popup` 고정 대기 제거 → 새 탭 이벤트 vs URL change 레이스
  - 리소스 차단: interpark/nol 도메인만 + `.svg` 제외 (Turnstile/seatmap 안정)
  - 디버그 덤프 강화: frames + console buffer 저장
- 추가 우회(옵션): goods 리다이렉트 시 **NOL 메인에서 공연명 검색 → 결과 클릭**으로 goods 진입 (`--query` / `CONCERT_QUERY`)

**현재 블로커 / 리스크**
- (완화됨) goods 페이지는 오픈 전엔 예매 UI가 숨겨질 수 있음 → `navigate_to_concert()`에서 goods URL이면 UI 없어도 성공 처리 반영
- `browser.act`(OpenClaw 브라우저 컨트롤) 기반 자동화는 **act 타임아웃/불안정** → 오픈타임 핵심에는 비권장, Playwright 런 기반으로 고정
- 오픈타임 플로우에 P0 버그 3개 발견(리뷰 완료) → 지금부터 패치 적용 중
  1) 팝업/새탭에서 예매가 열려도 downstream이 원탭(`self.page`) 계속 참조
  2) seat iframe을 FrameLocator로 반환해 `.evaluate()` 등에서 터짐(SVG 폴백 무력화)
  3) 좌표 클릭(absolute bbox) vs `element.click(position=...)`(element-local) 불일치로 미스클릭 가능
  - 리뷰 노트: `bts-ticketing/review/main_playwright_review_2026-02-13.md`

### AXLE Protocol (Colosseum)
- ✅ Colosseum 필수 필드 완료 (상금 수령 자격 OK)
- 🔄 포럼 모니터링 중 (10분)
  - 최신 5개 포스트 중 AXLE 직접 언급은 없음
  - 신뢰/투명성/온체인 추적 관련 글(#6062 SlotScribe 등)은 시너지 후보
  - 우리 포스트(ID:2212) 새 댓글 없음(최신 2026-02-10)

---

## 📋 Han 할 일
- [ ] BTS 티켓팅 운영 방식 확정: **오픈 전 수동 진입 + 오픈 후 자동화**로 진행
- [ ] (Colosseum) Human Claim 완료 확인 (클레임 안 하면 상금 대상 제외 리스크)
- [ ] X OAuth 1.0a 설정 (자동 트윗용)

## 🐾 Clo 작업현황
- [x] 메모리 검색: local 고정( OpenAI billing 이슈 회피 )
- [x] BTS 코드: CapSolver opt-in + 성능/안티봇/관측 리팩터링 커밋 완료
- [x] BTS 런북: `bts-ticketing/RUNBOOK_OPEN_TIME.md`
- [x] BTS 안전장치: `--stop-after` + dry-run(결제 스킵 기본) 추가
- [ ] BTS P0 패치 적용 중 (팝업/iframe/좌표 클릭) → 적용 후 `--stop-after seats` 리허설 반복
- [ ] Colosseum: 시너지 포스트 댓글 초안 준비(한 승인 후 게시)
  - #6093 Farnsworth Assimilation Protocol: “capability badge + escrow로 federation task settlement” 방향
  - #6091 Vex Embeddings: memory_search/local embeddings와 연결 (agent infra 관점)
  - #6090 SIDEX: agent task + escrow 결제 레이어 제안

---

## 📊 세션 상태
- Model: openai-codex/gpt-5.2
- Context: 35% (142k/400k)
- Usage: session ~94% left (~3h29m)
